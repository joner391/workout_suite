"""Tier 2 Adaptive Linear Kalman Filter for Individualized 1RM and Endurance (k) Tracking.

Implements the mathematical specification from:
- 1RM_calculation.txt
- Deep_research_1RM.md
- ADR-002: Dual-Tier 1RM Estimation Architecture
- ADR-026: Mechanical Load Normalization and Persistence Contract

Model Formulation:
    Linearized Lombardi power-law:
        w = 1RM * r_eff^(-k)  <==>  ln(w) = ln(1RM) - k * ln(r_eff)

State Vector:
    x_t = [ln(1RM_t), k_t]^T
Observation:
    z_t = ln(w_t)
    H_t = [1.0, -ln(r_eff, t)]
Measurement Noise:
    R_t = sigma_base^2 * (1 + lambda * r_eff,t^2)
Process Noise:
    Q = diag([q_ln_1rm, q_k])
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple, Union

import numpy as np
import numpy.typing as npt

from src.ingestion.schemas import (
    CalibratedParameter,
    StandardLiftType,
    Workout,
    WorkoutSet,
)


# ============================================================================
# Hyperparameters & Constants (1RM_calculation.txt Section 4)
# ============================================================================

DEFAULT_SIGMA_BASE: float = 0.025  # ~2.5% baseline measurement noise
DEFAULT_LAMBDA: float = 0.015      # Variance amplification factor for high reps
DEFAULT_Q_LN_1RM: float = 1.0e-4   # Process noise for strength drift
DEFAULT_Q_K: float = 1.0e-6        # Process noise for repetition endurance slope

# Operational physiological corridor for human repetition endurance
MIN_PLAUSIBLE_K: float = 0.03
MAX_PLAUSIBLE_K: float = 0.16

# Lift-specific initial priors (1RM_calculation.txt Section 4)
PRIOR_K_BY_LIFT: Dict[str, float] = {
    "bench": 0.085,
    "squat": 0.095,
    "deadlift": 0.075,
    "default": 0.10,
}

PRIOR_COVARIANCE_DIAG: Tuple[float, float] = (0.04, 0.002)


# ============================================================================
# Data Structures
# ============================================================================

@dataclass
class KalmanState:
    """State vector and covariance estimate of the Tier 2 Kalman filter."""

    x: npt.NDArray[np.float64]  # [ln(1RM), k]^T
    P: npt.NDArray[np.float64]  # 2x2 error covariance matrix
    step_count: int = 0
    last_weight: Optional[float] = None
    last_r_eff: Optional[float] = None

    @property
    def e1rm(self) -> float:
        """Estimated true 1-Repetition Maximum load in kg: exp(x_0)."""
        return float(math.exp(self.x[0]))

    @property
    def k(self) -> float:
        """Movement-specific repetition fatigue exponent: x_1."""
        return float(self.x[1])

    @property
    def e1rm_std_err(self) -> float:
        """Standard error of estimated 1RM: e1RM * sqrt(P[0,0])."""
        variance = max(0.0, float(self.P[0, 0]))
        return float(self.e1rm * math.sqrt(variance))

    @property
    def k_std_err(self) -> float:
        """Standard error of endurance slope k: sqrt(P[1,1])."""
        variance = max(0.0, float(self.P[1, 1]))
        return float(math.sqrt(variance))

    @property
    def cov_p00(self) -> float:
        """Posterior covariance element P[0,0] for ln(1RM)."""
        return float(self.P[0, 0])

    @property
    def cov_p11(self) -> float:
        """Posterior covariance element P[1,1] for endurance k."""
        return float(self.P[1, 1])


@dataclass
class FilteredSet:
    """Accepted workout set passing intra-session reliability criteria."""

    weight: float
    reps: int
    r_eff: float
    rir: Optional[float] = None
    rpe: Optional[float] = None
    set_number: Optional[int] = None
    set_type: str = "working"
    workout_id: Optional[str] = None
    exercise_id: Optional[str] = None
    created_at: Optional[str] = None
    original_index: int = 0


# ============================================================================
# Pure Helper Functions
# ============================================================================

def calculate_effective_reps(
    reps: int,
    rir: Optional[float] = None,
    rpe: Optional[float] = None,
) -> float:
    """Calculates proximity-adjusted effective repetitions (r_eff).

    Formulation (1RM_calculation.txt):
        r_eff = reps + RIR  OR  reps + max(0, 10 - RPE)
    Invariants:
        - If completed reps <= 0, returns 0.0 (failed set cannot extrapolate work).
        - For completed sets (reps > 0), enforces lower bound r_eff >= 1.0.
    """
    if reps <= 0:
        return 0.0

    reserve: float = 0.0
    if rir is not None and not math.isnan(rir):
        reserve = max(0.0, float(rir))
    elif rpe is not None and not math.isnan(rpe):
        reserve = max(0.0, 10.0 - float(rpe))

    return float(max(1.0, float(reps) + reserve))


def _extract_field(obj: Any, name: str, default: Any = None) -> Any:
    """Extracts field from Pydantic model, dictionary, or generic object."""
    if isinstance(obj, Mapping):
        return obj.get(name, default)
    return getattr(obj, name, default)


def filter_session_sets(
    sets: Sequence[Union[WorkoutSet, Mapping[str, Any], Any]],
    max_rir_threshold: float = 3.0,
) -> List[FilteredSet]:
    """Filters workout sets within a single session according to 1RM_calculation.txt rules:

    1. Discard failed sets (completed reps <= 0 or load <= 0).
    2. Discard sets with 'warmup' set_type.
    3. Discard sets with RIR > 3 (or RPE < 7.0), or sets with no intensity ratings.
    4. Select the top 2 sets with the lowest RIR.
    5. If > 2 sets share the lowest RIR, break ties by selecting the sets with highest load.
    6. Retain original chronological order among the selected sets.
    """
    candidates: List[Tuple[float, float, int, FilteredSet]] = []

    for idx, s in enumerate(sets):
        reps_val = _extract_field(s, "reps", 0)
        weight_val = _extract_field(s, "weight", 0.0)
        set_type_val = str(_extract_field(s, "set_type", "working")).lower()
        rir_val = _extract_field(s, "rir", None)
        rpe_val = _extract_field(s, "rpe", None)
        set_num_val = _extract_field(s, "set_number", idx + 1)
        workout_id_val = _extract_field(s, "workout_id", None)
        exercise_id_val = _extract_field(s, "exercise_id", None)
        created_at_val = _extract_field(s, "created_at", None)

        if reps_val is None or weight_val is None:
            continue

        try:
            reps = int(reps_val)
            weight = float(weight_val)
        except (ValueError, TypeError):
            continue

        if reps <= 0 or weight <= 0.0:
            continue

        if set_type_val == "warmup":
            continue

        # Compute effective proximity to failure
        eff_rir: Optional[float] = None
        if rir_val is not None:
            try:
                val = float(rir_val)
                if not math.isnan(val):
                    eff_rir = max(0.0, val)
            except (ValueError, TypeError):
                pass
        elif rpe_val is not None:
            try:
                val = float(rpe_val)
                if not math.isnan(val):
                    eff_rir = max(0.0, 10.0 - val)
            except (ValueError, TypeError):
                pass

        if eff_rir is None or eff_rir > max_rir_threshold:
            # Subjective intensity missing or effort too submaximal (warmup)
            continue

        r_eff = calculate_effective_reps(reps, rir=eff_rir)

        filtered = FilteredSet(
            weight=weight,
            reps=reps,
            r_eff=r_eff,
            rir=eff_rir,
            rpe=float(rpe_val) if rpe_val is not None else None,
            set_number=int(set_num_val) if set_num_val is not None else idx + 1,
            set_type=set_type_val,
            workout_id=str(workout_id_val) if workout_id_val is not None else None,
            exercise_id=str(exercise_id_val) if exercise_id_val is not None else None,
            created_at=str(created_at_val) if created_at_val is not None else None,
            original_index=idx,
        )

        # Candidate tuple: (eff_rir ASC, -weight ASC [heaviest first], original_idx, filtered_obj)
        candidates.append((eff_rir, -weight, idx, filtered))

    if not candidates:
        return []

    # Sort candidates by (lowest RIR, highest weight)
    candidates.sort(key=lambda item: (item[0], item[1]))

    # Pick top 2 sets
    top_candidates = candidates[:2]

    # Re-sort selected sets chronologically by original execution order
    top_candidates.sort(key=lambda item: item[2])

    return [item[3] for item in top_candidates]


def update_1rm_filter(
    x: npt.NDArray[np.float64],
    P: npt.NDArray[np.float64],
    weight: float,
    r_eff: float,
    Q: Optional[npt.NDArray[np.float64]] = None,
    base_sigma: float = DEFAULT_SIGMA_BASE,
    lam: float = DEFAULT_LAMBDA,
) -> Tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    """Performs a single discrete Kalman filter time and measurement update.

    Implements the algorithm from 1RM_calculation.txt Section 5:
        1. Predict:
           x_pred = x
           P_pred = P + Q
        2. Measurement:
           z = ln(w)
           H = [1.0, -ln(r_eff)]
           R = sigma_base^2 * (1 + lambda * r_eff^2)
        3. Correct:
           y = z - H @ x_pred
           S = H @ P_pred @ H^T + R
           K = (P_pred @ H^T) / S
           x_new = x_pred + K * y
           P_new = (I - K @ H) @ P_pred
           x_new[1] in [0.03, 0.16] (box-clipping heuristic)

    Edge Case Invariant:
        When r_eff = 1.0 (True 1RM Test), H = [1.0, 0.0]. If P is diagonal or has zero
        cross-covariance, Kalman gain K_1 = 0, leaving k entirely unchanged and updating
        only 1RM.
    """
    if weight <= 0.0:
        raise ValueError(f"Weight must be strictly positive (> 0), got {weight}")
    if r_eff < 1.0:
        raise ValueError(f"Effective reps must be >= 1.0, got {r_eff}")

    # 1. Time Update (Predict)
    x_pred: npt.NDArray[np.float64] = np.array(x, dtype=np.float64).copy()
    if Q is not None:
        q_mat: npt.NDArray[np.float64] = np.array(Q, dtype=np.float64)
    else:
        q_mat = np.diag([DEFAULT_Q_LN_1RM, DEFAULT_Q_K]).astype(np.float64)

    P_pred: npt.NDArray[np.float64] = np.array(P, dtype=np.float64) + q_mat

    # 2. Measurement Vector and Noise
    z: float = float(math.log(weight))
    ln_r_eff: float = float(math.log(r_eff))
    H: npt.NDArray[np.float64] = np.array([[1.0, -ln_r_eff]], dtype=np.float64)
    R: float = float((base_sigma ** 2) * (1.0 + lam * (r_eff ** 2)))

    # 3. Measurement Update (Correct)
    y: float = float(z - float((H @ x_pred)[0]))
    S: float = float((H @ P_pred @ H.T)[0, 0] + R)
    K: npt.NDArray[np.float64] = (P_pred @ H.T) / S  # Shape (2, 1)

    x_new: npt.NDArray[np.float64] = x_pred + K.flatten() * y

    # Covariance update with symmetry enforcement
    I_2 = np.eye(2, dtype=np.float64)
    P_raw: npt.NDArray[np.float64] = (I_2 - K @ H) @ P_pred
    P_new: npt.NDArray[np.float64] = 0.5 * (P_raw + P_raw.T)

    # Box-clipping k in [0.03, 0.16] heuristic stability override
    x_new[1] = float(np.clip(x_new[1], MIN_PLAUSIBLE_K, MAX_PLAUSIBLE_K))

    return x_new, P_new


def get_initial_prior(
    standard_lift_type: Optional[str] = None,
    initial_1rm: Optional[float] = None,
    initial_k: Optional[float] = None,
    initial_covariance: Optional[npt.NDArray[np.float64]] = None,
) -> KalmanState:
    """Constructs the initial Kalman state prior for an exercise stream.

    Priors per 1RM_calculation.txt Section 4:
    - Bench Press: k_0 = 0.085, P_0 = diag(0.04, 0.002)
    - Back Squat:  k_0 = 0.095, P_0 = diag(0.04, 0.002)
    - Deadlift:    k_0 = 0.075, P_0 = diag(0.04, 0.002)
    - Default/Other: k_0 = 0.10, P_0 = diag(0.04, 0.002)

    NOTE on Deadlift Scalar (ADR-026):
    The +10% deadlift compensatory multiplier documented in empirical literature applies
    exclusively to static linear heuristic formulas. In this Tier 2 Kalman Filter, deadlift
    fatigue kinetics are modeled natively through k_0 = 0.075. No +10% heuristic scalar
    is applied.
    """
    lift_key = standard_lift_type.lower() if standard_lift_type else "default"
    k_0 = (
        initial_k
        if initial_k is not None
        else PRIOR_K_BY_LIFT.get(lift_key, PRIOR_K_BY_LIFT["default"])
    )

    if initial_1rm is not None:
        if initial_1rm <= 0.0:
            raise ValueError(f"initial_1rm must be strictly positive, got {initial_1rm}")
        ln_1rm_0 = float(math.log(initial_1rm))
    else:
        # Default placeholder prior load (100 kg)
        ln_1rm_0 = float(math.log(100.0))

    x_0: npt.NDArray[np.float64] = np.array([ln_1rm_0, k_0], dtype=np.float64)

    if initial_covariance is not None:
        P_0: npt.NDArray[np.float64] = np.array(initial_covariance, dtype=np.float64)
    else:
        P_0 = np.diag(PRIOR_COVARIANCE_DIAG).astype(np.float64)

    return KalmanState(x=x_0, P=P_0, step_count=0)


# ============================================================================
# Stateful Kalman Filter Engine
# ============================================================================

class Adaptive1RMKalmanFilter:
    """Stateful Tier 2 Adaptive Linear Kalman Filter for an individual exercise stream."""

    def __init__(
        self,
        exercise_id: str,
        standard_lift_type: Optional[str] = None,
        initial_1rm: Optional[float] = None,
        initial_k: Optional[float] = None,
        initial_covariance: Optional[npt.NDArray[np.float64]] = None,
        Q: Optional[npt.NDArray[np.float64]] = None,
        base_sigma: float = DEFAULT_SIGMA_BASE,
        lam: float = DEFAULT_LAMBDA,
    ) -> None:
        self.exercise_id = exercise_id
        self.standard_lift_type = standard_lift_type
        self.base_sigma = base_sigma
        self.lam = lam
        self.Q = Q if Q is not None else np.diag([DEFAULT_Q_LN_1RM, DEFAULT_Q_K]).astype(np.float64)

        self._has_explicit_1rm: bool = initial_1rm is not None
        self.state: KalmanState = get_initial_prior(
            standard_lift_type=standard_lift_type,
            initial_1rm=initial_1rm,
            initial_k=initial_k,
            initial_covariance=initial_covariance,
        )
        self.history: List[KalmanState] = [self.state]

    def step(self, weight: float, r_eff: float) -> KalmanState:
        """Executes a single Kalman update with observation (weight, r_eff)."""
        # If initial 1RM was not explicitly provided by user, bootstrap from the 1st set
        if not self._has_explicit_1rm and self.state.step_count == 0:
            k_init = self.state.k
            # Lombardi approximation: 1RM = weight * r_eff^k
            bootstrapped_1rm = weight * (r_eff ** k_init)
            self.state.x[0] = float(math.log(bootstrapped_1rm))
            self._has_explicit_1rm = True

        x_new, P_new = update_1rm_filter(
            x=self.state.x,
            P=self.state.P,
            weight=weight,
            r_eff=r_eff,
            Q=self.Q,
            base_sigma=self.base_sigma,
            lam=self.lam,
        )

        self.state = KalmanState(
            x=x_new,
            P=P_new,
            step_count=self.state.step_count + 1,
            last_weight=weight,
            last_r_eff=r_eff,
        )
        self.history.append(self.state)
        return self.state

    def process_filtered_set(self, filtered_set: FilteredSet) -> KalmanState:
        """Processes an accepted FilteredSet instance."""
        return self.step(weight=filtered_set.weight, r_eff=filtered_set.r_eff)

    def process_session(
        self,
        sets: Sequence[Union[WorkoutSet, Mapping[str, Any], Any]],
    ) -> List[KalmanState]:
        """Applies intra-session filtering and steps the filter for all accepted sets."""
        accepted_sets = filter_session_sets(sets)
        states: List[KalmanState] = []
        for s in accepted_sets:
            states.append(self.process_filtered_set(s))
        return states

    def process_workout_history(
        self,
        workouts: Sequence[Workout],
        workout_sets: Sequence[WorkoutSet],
    ) -> List[KalmanState]:
        """Processes full longitudinal workout history for this exercise.

        Workouts are ordered chronologically, sets for this exercise are grouped by
        session, intra-session filtering is applied, and Kalman updates are executed.
        """
        # 1. Map workout_id to workout date / timestamp
        workout_meta: Dict[str, Tuple[str, str]] = {}
        for w in workouts:
            started = w.started_at or f"{w.date}T00:00:00Z"
            workout_meta[w.id] = (w.date, started)

        # 2. Filter sets belonging to this exercise
        exercise_sets = [s for s in workout_sets if s.exercise_id == self.exercise_id]

        # 3. Group by workout_id
        session_groups: Dict[str, List[WorkoutSet]] = {}
        for s in exercise_sets:
            session_groups.setdefault(s.workout_id, []).append(s)

        # 4. Sort sessions chronologically
        sorted_workout_ids = sorted(
            session_groups.keys(),
            key=lambda wid: workout_meta.get(wid, ("9999-99-99", "9999-99-99T00:00:00Z"))[1],
        )

        all_states: List[KalmanState] = []
        for wid in sorted_workout_ids:
            group_sets = session_groups[wid]
            # Ensure within-session sets are sorted by set_number
            group_sets.sort(key=lambda s: s.set_number)
            states = self.process_session(group_sets)
            all_states.extend(states)

        return all_states

    def to_calibrated_parameter(
        self,
        calibrated_at: Optional[str] = None,
    ) -> CalibratedParameter:
        """Serializes current filter posterior state into a validated CalibratedParameter."""
        timestamp = calibrated_at or datetime.now(timezone.utc).isoformat()
        return CalibratedParameter(
            exercise_id=self.exercise_id,
            calibrated_1rm=round(self.state.e1rm, 2),
            calibrated_k=round(self.state.k, 4),
            cov_p00=float(self.state.cov_p00),
            cov_p11=float(self.state.cov_p11),
            calibrated_at=timestamp,
        )
