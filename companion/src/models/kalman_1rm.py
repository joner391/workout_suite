"""Tier 2 Adaptive Linear Kalman Filter for Individualized 1RM and Endurance (k) Tracking.

Implements the mathematical specification for:
- State-space linearized Lombardi transform: ln(w) = ln(1RM) - k * ln(r_eff)
- Consolidated daily batch Kalman updates per session
- Outlier robustness with 3-stage gating pipeline (intra-session reference, asymmetric Huber M-estimation, physical load floor)
- Joseph stabilized covariance update
- Dual-defense boundary constraint: Soft Tikhonov prior anchor + Simon's covariance-weighted state projection
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
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
# Calibrated Hyperparameters & Constants
# ============================================================================

DEFAULT_SIGMA_BASE: float = 0.045       # ~4.5% baseline biological + RIR noise
DEFAULT_LAMBDA: float = 0.030           # High-rep variance amplification
DEFAULT_Q_LN_1RM_DAILY: float = 1.5e-5  # Daily variance drift for ln(1RM)
DEFAULT_Q_K_DAILY: float = 1.0e-8       # Daily variance drift for k
DEFAULT_SIGMA_K_PRIOR: float = 0.025    # Soft Tikhonov regularization std on k prior

# Backward compatibility aliases for existing imports
DEFAULT_Q_LN_1RM: float = DEFAULT_Q_LN_1RM_DAILY
DEFAULT_Q_K: float = DEFAULT_Q_K_DAILY

# Operational physiological corridor for human repetition endurance
MIN_PLAUSIBLE_K: float = 0.03
MAX_PLAUSIBLE_K: float = 0.16

# Lift-specific initial priors
PRIOR_K_BY_LIFT: Dict[str, float] = {
    "bench": 0.085,
    "squat": 0.095,
    "deadlift": 0.075,
    "default": 0.10,
}

# Tighter initial covariance: std(ln_1rm) = 0.10 (~10%), std(k) = 0.0122
PRIOR_COVARIANCE_DIAG: Tuple[float, float] = (0.010, 0.00015)


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
        return float(math.exp(self.x[0]))

    @property
    def k(self) -> float:
        return float(self.x[1])

    @property
    def e1rm_std_err(self) -> float:
        variance = max(0.0, float(self.P[0, 0]))
        return float(self.e1rm * math.sqrt(variance))

    @property
    def k_std_err(self) -> float:
        variance = max(0.0, float(self.P[1, 1]))
        return float(math.sqrt(variance))

    @property
    def cov_p00(self) -> float:
        return float(self.P[0, 0])

    @property
    def cov_p11(self) -> float:
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


def calculate_effective_reps(
    reps: int,
    rir: Optional[float] = None,
    rpe: Optional[float] = None,
) -> float:
    if reps <= 0:
        return 0.0
    reserve: float = 0.0
    if rir is not None and not math.isnan(rir):
        reserve = max(0.0, float(rir))
    elif rpe is not None and not math.isnan(rpe):
        reserve = max(0.0, 10.0 - float(rpe))
    return float(max(1.0, float(reps) + reserve))


def _extract_field(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(name, default)
    return getattr(obj, name, default)


def is_amrap_set(obj: Any) -> bool:
    set_type = str(_extract_field(obj, "set_type", "")).lower()
    if set_type in ("amrap", "failure"):
        return True
    if bool(_extract_field(obj, "is_amrap", False)):
        return True
    notes = str(
        _extract_field(obj, "set_notes", _extract_field(obj, "notes", "")) or ""
    ).lower()
    return "amrap" in notes


def filter_session_sets(
    sets: Sequence[Union[WorkoutSet, Mapping[str, Any], Any]],
    max_rir_threshold: float = 3.0,
    default_working_rir: Optional[float] = None,
    current_e1rm: Optional[float] = None,
    prior_k: float = 0.095,
) -> List[FilteredSet]:
    """Filters workout sets within a session with warmup & relative-load outlier rejection."""
    raw_valid: List[FilteredSet] = []

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

        if reps <= 0 or weight <= 0.0 or set_type_val == "warmup":
            continue

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
        elif is_amrap_set(s):
            eff_rir = 0.0
        elif default_working_rir is not None and set_type_val != "warmup":
            eff_rir = max(0.0, float(default_working_rir))

        if eff_rir is None or eff_rir > max_rir_threshold:
            continue

        r_eff = calculate_effective_reps(reps, rir=eff_rir)
        raw_valid.append(
            FilteredSet(
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
        )

    if not raw_valid:
        return []

    # Stage 1 Gate: Intra-session peak reference rejection (eliminates unflagged warmups)
    max_session_weight = max(fs.weight for fs in raw_valid)
    max_session_e1rm = max(fs.weight * (fs.r_eff ** prior_k) for fs in raw_valid)

    candidates: List[Tuple[float, float, int, FilteredSet]] = []
    for fs in raw_valid:
        set_e1rm = fs.weight * (fs.r_eff ** prior_k)
        # Reject sets < 65% of max session weight or < 82% of session peak heuristic 1RM
        if fs.weight < 0.65 * max_session_weight or set_e1rm < 0.82 * max_session_e1rm:
            continue
        # Reject sets < 55% of current filter e1RM (if already initialized)
        if current_e1rm is not None and current_e1rm > 0 and fs.weight < 0.55 * current_e1rm:
            continue

        candidates.append((fs.rir or 0.0, -set_e1rm, fs.original_index, fs))

    if not candidates:
        return []

    candidates.sort(key=lambda item: (item[0], item[1]))
    top_candidates = candidates[:2]
    top_candidates.sort(key=lambda item: item[2])
    return [item[3] for item in top_candidates]


def _project_constrained_state(
    x: npt.NDArray[np.float64],
    P: npt.NDArray[np.float64],
    k_min: float = MIN_PLAUSIBLE_K,
    k_max: float = MAX_PLAUSIBLE_K,
) -> Tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    """Simon's Covariance-Weighted Projection for state inequality constraints."""
    x_proj = x.copy()
    P_proj = P.copy()

    target_k: Optional[float] = None
    if x_proj[1] > k_max:
        target_k = k_max
    elif x_proj[1] < k_min:
        target_k = k_min

    if target_k is not None:
        p11 = max(float(P_proj[1, 1]), 1e-12)
        p01 = float(P_proj[0, 1])
        # Adjust ln(1RM) along the conditional Gaussian distribution
        x_proj[0] = float(x_proj[0] + (p01 / p11) * (target_k - x_proj[1]))
        x_proj[1] = target_k

        # Condition covariance on the active boundary constraint
        P_proj[0, 0] = max(1e-6, float(P_proj[0, 0] - (p01 ** 2) / p11))
        P_proj[0, 1] = 0.0
        P_proj[1, 0] = 0.0
        P_proj[1, 1] = min(p11, 1e-5)

    return x_proj, P_proj


def update_1rm_filter(
    x: npt.NDArray[np.float64],
    P: npt.NDArray[np.float64],
    weight: float,
    r_eff: float,
    Q: Optional[npt.NDArray[np.float64]] = None,
    base_sigma: float = DEFAULT_SIGMA_BASE,
    lam: float = DEFAULT_LAMBDA,
    k_prior: Optional[float] = None,
    sigma_k_prior: float = DEFAULT_SIGMA_K_PRIOR,
) -> Tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    """Single-measurement wrapper (retains backward compatibility with existing tests)."""
    return update_1rm_filter_batch(
        x=x,
        P=P,
        measurements=[(weight, r_eff)],
        Q=Q,
        base_sigma=base_sigma,
        lam=lam,
        k_prior=k_prior,
        sigma_k_prior=sigma_k_prior,
    )


def update_1rm_filter_batch(
    x: npt.NDArray[np.float64],
    P: npt.NDArray[np.float64],
    measurements: Sequence[Tuple[float, float]],
    Q: Optional[npt.NDArray[np.float64]] = None,
    base_sigma: float = DEFAULT_SIGMA_BASE,
    lam: float = DEFAULT_LAMBDA,
    k_prior: Optional[float] = None,
    sigma_k_prior: float = DEFAULT_SIGMA_K_PRIOR,
) -> Tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    """Consolidated session batch Kalman update with Huber robustness and projection."""
    if not measurements:
        return x.copy(), P.copy()

    for w, r in measurements:
        if w <= 0.0:
            raise ValueError(f"Weight must be strictly positive (> 0), got {w}")
        if r < 1.0:
            raise ValueError(f"Effective reps must be >= 1.0, got {r}")

    # 1. Time Update (Predict once per session)
    x_pred = np.array(x, dtype=np.float64).copy()
    q_mat = (
        np.array(Q, dtype=np.float64)
        if Q is not None
        else np.diag([DEFAULT_Q_LN_1RM_DAILY, DEFAULT_Q_K_DAILY]).astype(np.float64)
    )
    P_pred = np.array(P, dtype=np.float64) + q_mat

    # 2. Construct Batch Observation Matrices with Asymmetric Huber Gating
    z_list: List[float] = []
    H_rows: List[List[float]] = []
    R_diag: List[float] = []

    for w, r_eff in measurements:
        z_i = float(math.log(w))
        ln_r = float(math.log(r_eff))
        h_i = np.array([1.0, -ln_r], dtype=np.float64)
        r_i = float((base_sigma ** 2) * (1.0 + lam * (r_eff ** 2)))

        y_i = z_i - float(h_i @ x_pred)
        s_i = float(h_i @ P_pred @ h_i.T) + r_i
        std_innov = y_i / math.sqrt(max(s_i, 1e-12))

        # Downweight or reject anomalously light sets
        if std_innov < -3.0 and len(measurements) > 1:
            continue
        elif std_innov < -1.345:
            r_i *= (abs(std_innov) / 1.345) ** 2

        z_list.append(z_i)
        H_rows.append([1.0, -ln_r])
        R_diag.append(r_i)

    if not z_list:
        return x_pred, P_pred

    # Soft Tikhonov regularization toward biomechanical prior k_0
    has_multi_rep = any(r > 1.0 for _, r in measurements)
    if k_prior is not None and has_multi_rep:
        z_list.append(float(k_prior))
        H_rows.append([0.0, 1.0])
        R_diag.append(float(sigma_k_prior ** 2))

    z_vec = np.array(z_list, dtype=np.float64)
    H_mat = np.array(H_rows, dtype=np.float64)
    R_mat = np.diag(R_diag).astype(np.float64)

    # 3. Batch Measurement Update (Joseph Stabilized Form)
    y_vec = z_vec - (H_mat @ x_pred)
    S_mat = (H_mat @ P_pred @ H_mat.T) + R_mat
    K_mat = P_pred @ H_mat.T @ np.linalg.inv(S_mat)

    x_new = x_pred + (K_mat @ y_vec)
    I_2 = np.eye(2, dtype=np.float64)
    I_KH = I_2 - (K_mat @ H_mat)
    P_raw = (I_KH @ P_pred @ I_KH.T) + (K_mat @ R_mat @ K_mat.T)
    P_new = 0.5 * (P_raw + P_raw.T)

    # 4. Covariance-Weighted Constraint Projection for k in [0.03, 0.16]
    x_new, P_new = _project_constrained_state(x_new, P_new)

    # 5. Physical Floor Guarantee: 1RM cannot be lower than actual lifted load
    for w, r_eff in measurements:
        completed_reps = max(1.0, r_eff - 3.0)
        min_physical_ln_1rm = math.log(w) + MIN_PLAUSIBLE_K * math.log(completed_reps)
        if x_new[0] < min_physical_ln_1rm:
            x_new[0] = min_physical_ln_1rm

    return x_new, P_new


def get_initial_prior(
    standard_lift_type: Optional[str] = None,
    initial_1rm: Optional[float] = None,
    initial_k: Optional[float] = None,
    initial_covariance: Optional[npt.NDArray[np.float64]] = None,
) -> KalmanState:
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
        ln_1rm_0 = float(math.log(100.0))

    x_0 = np.array([ln_1rm_0, k_0], dtype=np.float64)
    P_0 = (
        np.array(initial_covariance, dtype=np.float64)
        if initial_covariance is not None
        else np.diag(PRIOR_COVARIANCE_DIAG).astype(np.float64)
    )
    return KalmanState(x=x_0, P=P_0, step_count=0)


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
        lift_key = standard_lift_type.lower() if standard_lift_type else "default"
        self.k_prior = (
            initial_k
            if initial_k is not None
            else PRIOR_K_BY_LIFT.get(lift_key, PRIOR_K_BY_LIFT["default"])
        )
        self.Q_daily = (
            Q
            if Q is not None
            else np.diag([DEFAULT_Q_LN_1RM_DAILY, DEFAULT_Q_K_DAILY]).astype(np.float64)
        )

        self._has_explicit_1rm: bool = initial_1rm is not None
        self._last_session_date: Optional[date] = None
        self.state: KalmanState = get_initial_prior(
            standard_lift_type=standard_lift_type,
            initial_1rm=initial_1rm,
            initial_k=initial_k,
            initial_covariance=initial_covariance,
        )
        self.history: List[KalmanState] = [self.state]

    def step(self, weight: float, r_eff: float, elapsed_days: float = 1.0) -> KalmanState:
        return self.step_batch([(weight, r_eff)], elapsed_days=elapsed_days)

    def step_batch(
        self,
        measurements: Sequence[Tuple[float, float]],
        elapsed_days: float = 1.0,
    ) -> KalmanState:
        """Executes a consolidated batch Kalman update for a workout session."""
        if not measurements:
            return self.state

        if not self._has_explicit_1rm and self.state.step_count == 0:
            k_init = self.state.k
            best_boot = max(w * (r ** k_init) for w, r in measurements)
            self.state.x[0] = float(math.log(best_boot))
            self._has_explicit_1rm = True

        dt = max(1.0, min(60.0, float(elapsed_days)))
        Q_step = self.Q_daily * dt

        x_new, P_new = update_1rm_filter_batch(
            x=self.state.x,
            P=self.state.P,
            measurements=measurements,
            Q=Q_step,
            base_sigma=self.base_sigma,
            lam=self.lam,
            k_prior=self.k_prior,
        )

        last_w, last_r = measurements[-1]
        self.state = KalmanState(
            x=x_new,
            P=P_new,
            step_count=self.state.step_count + 1,
            last_weight=last_w,
            last_r_eff=last_r,
        )
        self.history.append(self.state)
        return self.state

    def process_filtered_set(self, filtered_set: FilteredSet) -> KalmanState:
        return self.step(weight=filtered_set.weight, r_eff=filtered_set.r_eff)

    def process_session(
        self,
        sets: Sequence[Union[WorkoutSet, Mapping[str, Any], Any]],
        default_working_rir: Optional[float] = None,
        session_date: Optional[Union[str, date]] = None,
    ) -> List[KalmanState]:
        """Filters session sets and executes a single consolidated batch update."""
        curr_e1rm = self.state.e1rm if self._has_explicit_1rm else None
        accepted_sets = filter_session_sets(
            sets,
            default_working_rir=default_working_rir,
            current_e1rm=curr_e1rm,
            prior_k=self.k_prior,
        )
        if not accepted_sets:
            return []

        elapsed_days = 3.0
        if session_date is not None:
            dt_obj = (
                datetime.strptime(str(session_date)[:10], "%Y-%m-%d").date()
                if isinstance(session_date, str)
                else session_date
            )
            if self._last_session_date is not None:
                elapsed_days = max(1.0, float((dt_obj - self._last_session_date).days))
            self._last_session_date = dt_obj

        batch_obs = [(s.weight, s.r_eff) for s in accepted_sets]
        new_state = self.step_batch(batch_obs, elapsed_days=elapsed_days)
        return [new_state]

    def process_workout_history(
        self,
        workouts: Sequence[Workout],
        workout_sets: Sequence[WorkoutSet],
        default_working_rir: Optional[float] = None,
    ) -> List[KalmanState]:
        workout_meta: Dict[str, Tuple[str, str]] = {}
        for w in workouts:
            started = w.started_at or f"{w.date}T00:00:00Z"
            workout_meta[w.id] = (w.date, started)

        exercise_sets = [s for s in workout_sets if s.exercise_id == self.exercise_id]
        session_groups: Dict[str, List[WorkoutSet]] = {}
        for s in exercise_sets:
            session_groups.setdefault(s.workout_id, []).append(s)

        sorted_workout_ids = sorted(
            session_groups.keys(),
            key=lambda wid: workout_meta.get(wid, ("9999-99-99", "9999-99-99T00:00:00Z"))[1],
        )

        all_states: List[KalmanState] = []
        for wid in sorted_workout_ids:
            group_sets = session_groups[wid]
            group_sets.sort(key=lambda s: s.set_number)
            w_date = workout_meta.get(wid, ("", ""))[0] or None
            states = self.process_session(
                group_sets,
                default_working_rir=default_working_rir,
                session_date=w_date,
            )
            all_states.extend(states)

        return all_states

    def to_calibrated_parameter(
        self,
        calibrated_at: Optional[str] = None,
    ) -> CalibratedParameter:
        timestamp = calibrated_at or datetime.now(timezone.utc).isoformat()
        return CalibratedParameter(
            exercise_id=self.exercise_id,
            calibrated_1rm=round(self.state.e1rm, 2),
            calibrated_k=round(self.state.k, 4),
            cov_p00=float(self.state.cov_p00),
            cov_p11=float(self.state.cov_p11),
            calibrated_at=timestamp,
        )
