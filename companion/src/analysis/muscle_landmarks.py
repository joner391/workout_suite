"""Muscle-Group Partitioned Banister & Empirical Bayesian Volume Landmark Estimator.

Implements the mathematical specifications for:
1. Muscle Volume Credit Routing:
   Direct volume (1.0x eReps, 1.0 fractional set) to exercises.muscle_group,
   and indirect volume (0.5x eReps, 0.5 fractional set) to exercises.secondary_muscles.
2. Category-Weighted Systemic vs. Local Fatigue:
   m_sys multipliers based on category and compound status:
   - Barbell + is_compound == 1: m_sys = 1.35
   - Dumbbell / Bodyweight + is_compound == 1: m_sys = 1.00
   - Machine / Cable or is_compound == 0: m_sys = 0.65
   Local recovery constant tau_{2,m} = 0.65 * tau_2(t).
3. Empirical Bayesian Volume Landmarks (MEV, MAV, MRV):
   Dose-response quadratic parabola: Delta ln(e10RM_{m,w}) = beta_0 + beta_1 * V - beta_2 * V^2.
   Solved via bounded constrained regression with fallback to population priors when < 6 weeks of data exist,
   and energy balance scaling (1.12x for SURPLUS, 0.82x for DEFICIT).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import math
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple, Union

import numpy as np
import numpy.typing as npt
import pandas as pd  # type: ignore[import-untyped]
from pydantic import BaseModel, ConfigDict, Field
from scipy.optimize import lsq_linear  # type: ignore[import-untyped]

from src.analysis.hypertrophy_signals import (
    DEFAULT_UNRATED_WORKING_RIR,
    compute_effective_reps,
    parse_timestamp,
)
from src.ingestion.schemas import BodyMetric, Exercise, Workout, WorkoutSet
from src.models.recovery_modifier import (
    DEFAULT_TAU2_BASE_DAYS,
    RecoveryState,
    compute_recovery_modifier,
)

# ============================================================================
# Constants & Hyperparameters
# ============================================================================

CANONICAL_MUSCLE_GROUPS: Tuple[str, ...] = (
    "Chest",
    "Back",
    "Quads",
    "Hamstrings",
    "Glutes",
    "Shoulders",
    "Biceps",
    "Triceps",
    "Forearms",
    "Calves",
    "Abs",
    "Traps",
)

# Population Priors for Volume Landmarks (Sets / Week)
POPULATION_MEV_DEFAULT: float = 6.0
POPULATION_MAV_DEFAULT: float = 14.0
POPULATION_MRV_DEFAULT: float = 20.0

# Systemic Fatigue Multipliers (m_sys)
SYSTEMIC_FATIGUE_BARBELL_COMPOUND: float = 1.35
SYSTEMIC_FATIGUE_DUMBBELL_BW_COMPOUND: float = 1.00
SYSTEMIC_FATIGUE_ISOLATION_OR_MACHINE: float = 0.65

# Local Peripheral Recovery Scaling
LOCAL_PERIPHERAL_TAU2_RATIO: float = 0.65

# Minimum weeks required for empirical quadratic dose-response fit
MIN_WEEKS_FOR_EMPIRICAL_FIT: int = 6

# Energy Balance Scaling Factors
ENERGY_BALANCE_SURPLUS_SCALAR: float = 1.12
ENERGY_BALANCE_DEFICIT_SCALAR: float = 0.82

# Fallback secondary muscle synergies when exercises do not explicitly define them
DEFAULT_EXERCISE_SYNERGIES: Dict[str, List[str]] = {
    # Quads
    "barbell_back_squat": ["Glutes", "Hamstrings"],
    "barbell_squat": ["Glutes", "Hamstrings"],
    "barbell_front_squat": ["Glutes"],
    "barbell_low_bar_squat": ["Glutes", "Hamstrings"],
    "barbell_box_squat": ["Glutes"],
    "leg_press": ["Glutes"],
    "machine_leg_press": ["Glutes"],
    "dumbbell_goblet_squat": ["Glutes"],
    "goblet_squat": ["Glutes"],
    "dumbbell_bulgarian_split_squat": ["Glutes"],
    "bulgarian_split_squat": ["Glutes"],
    "dumbbell_walking_lunge": ["Glutes"],
    "walking_lunge": ["Glutes"],
    # Chest
    "barbell_bench_press": ["Triceps", "Shoulders"],
    "barbell_incline_bench_press": ["Triceps", "Shoulders"],
    "incline_barbell_bench_press": ["Shoulders", "Triceps"],
    "barbell_close_grip_bench_press": ["Chest", "Shoulders"],
    "dumbbell_bench_press": ["Triceps", "Shoulders"],
    "dumbbell_incline_bench_press": ["Triceps", "Shoulders"],
    "incline_dumbbell_bench_press": ["Shoulders", "Triceps"],
    "machine_chest_press": ["Triceps", "Shoulders"],
    "bodyweight_push_up": ["Triceps", "Shoulders"],
    "push_up": ["Triceps", "Shoulders"],
    "bodyweight_dip": ["Triceps", "Shoulders"],
    "chest_dip": ["Triceps", "Shoulders"],
    # Back
    "barbell_deadlift": ["Back", "Hamstrings", "Glutes", "Traps", "Forearms"],
    "barbell_sumo_deadlift": ["Quads", "Glutes", "Traps", "Forearms"],
    "barbell_rdl": ["Glutes", "Back"],
    "barbell_romanian_deadlift": ["Glutes", "Back"],
    "barbell_deficit_deadlift": ["Glutes", "Hamstrings", "Traps"],
    "dumbbell_romanian_deadlift": ["Glutes", "Back"],
    "good_morning": ["Glutes", "Back"],
    "barbell_good_morning": ["Glutes", "Back"],
    "hip_thrust": ["Hamstrings"],
    "barbell_hip_thrust": ["Hamstrings"],
    "barbell_bent_over_row": ["Biceps", "Traps", "Forearms"],
    "barbell_pendlay_row": ["Biceps", "Traps", "Forearms"],
    "barbell_row": ["Biceps", "Traps", "Forearms"],
    "dumbbell_single_arm_row": ["Biceps", "Traps", "Forearms"],
    "dumbbell_row": ["Biceps", "Traps", "Forearms"],
    "cable_lat_pulldown": ["Biceps", "Forearms"],
    "lat_pulldown": ["Biceps", "Forearms"],
    "cable_seated_row": ["Biceps", "Forearms"],
    "bodyweight_pull_up": ["Biceps", "Forearms"],
    "pull_up": ["Biceps", "Forearms"],
    "bodyweight_chin_up": ["Biceps", "Forearms"],
    "chin_up": ["Biceps", "Forearms"],
    # Shoulders
    "barbell_overhead_press": ["Triceps", "Traps"],
    "barbell_ohp": ["Triceps", "Traps"],
    "barbell_push_press": ["Triceps", "Traps", "Quads"],
    "dumbbell_shoulder_press": ["Triceps"],
}


# ============================================================================
# Pydantic v2 Models
# ============================================================================

class MuscleVolumeCredit(BaseModel):
    """Credit routing breakdown for a single workout set."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    set_id: Optional[str] = None
    exercise_id: str
    primary_muscle: str
    secondary_muscles: List[str] = Field(default_factory=list)
    effective_reps: float = Field(ge=0.0)
    systemic_fatigue_multiplier: float = Field(gt=0.0)
    direct_fractional_sets: float = 1.0
    indirect_fractional_sets: float = 0.5
    # Aggregated volume map: {muscle_name: (fractional_sets, ereps)}
    credits: Dict[str, Tuple[float, float]] = Field(default_factory=dict)


class MuscleLandmarkResult(BaseModel):
    """Calibrated volume landmarks [MEV, MAV, MRV] and localized readiness."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    muscle_group: str
    mev: float = Field(ge=0.0, description="Minimum Effective Volume (sets/week).")
    mav: float = Field(ge=0.0, description="Maximum Adaptive Volume (sets/week).")
    mrv: float = Field(ge=0.0, description="Maximum Recoverable Volume (sets/week).")
    readiness_pct: float = Field(ge=0.0, le=100.0, description="Current local muscle readiness (0-100%).")
    is_empirical: bool = Field(description="True if solved from quadratic dose-response fit; False if population prior.")
    weeks_analyzed: int = Field(ge=0, description="Number of historical mesocycle weeks evaluated.")
    energy_balance: str = Field(default="MAINTENANCE", description="Nutritional energy balance state.")


# ============================================================================
# Helpers
# ============================================================================

def _get_val(obj: Any, key: str, default: Any = None) -> Any:
    """Safe accessor for dicts and object attributes."""
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def compute_systemic_fatigue_multiplier(
    category: Optional[str],
    is_compound: Union[bool, int, None],
) -> float:
    """Calculates category-weighted systemic axial fatigue multiplier m_sys.

    Rules:
        - Barbell + is_compound == 1: m_sys = 1.35
        - Dumbbell / Bodyweight + is_compound == 1: m_sys = 1.00
        - Machine / Cable or is_compound == 0: m_sys = 0.65

    Args:
        category: Equipment category string ('Barbell', 'Dumbbell', 'Cable', etc.)
        is_compound: Boolean or integer flag (1 for compound, 0 for isolation)

    Returns:
        Systemic axial fatigue multiplier float.
    """
    cat = str(category or "").strip().lower()
    compound = bool(is_compound)

    if not compound:
        return SYSTEMIC_FATIGUE_ISOLATION_OR_MACHINE

    if cat == "barbell":
        return SYSTEMIC_FATIGUE_BARBELL_COMPOUND
    if cat in ("dumbbell", "bodyweight"):
        return SYSTEMIC_FATIGUE_DUMBBELL_BW_COMPOUND
    if cat in ("machine", "cable"):
        return SYSTEMIC_FATIGUE_ISOLATION_OR_MACHINE

    # Default fallback for unknown category compound movements
    return SYSTEMIC_FATIGUE_DUMBBELL_BW_COMPOUND


def get_exercise_synergies(
    exercise_id: str,
    explicit_secondaries: Optional[Sequence[str]] = None,
) -> List[str]:
    """Resolves secondary synergy muscles for an exercise."""
    if explicit_secondaries is not None and len(explicit_secondaries) > 0:
        return [str(m).strip() for m in explicit_secondaries if str(m).strip()]

    ex_id_norm = str(exercise_id).strip().lower()
    return DEFAULT_EXERCISE_SYNERGIES.get(ex_id_norm, [])


# ============================================================================
# Core Implementation: Volume Credit Routing
# ============================================================================

def route_muscle_volume_credit(
    set_obj: Union[WorkoutSet, Mapping[str, Any], Any],
    exercise: Optional[Union[Exercise, Mapping[str, Any], Any]] = None,
    *,
    default_working_rir: float = DEFAULT_UNRATED_WORKING_RIR,
) -> MuscleVolumeCredit:
    """Routes direct (1.0x) and indirect (0.5x) volume credits to primary & secondary muscles.

    Mathematical Specification:
        - For every completed non-warmup set:
          - Direct volume: 1.0 x eReps and 1.0 fractional set to exercises.muscle_group.
          - Indirect volume: 0.5 x eReps and 0.5 fractional set to each muscle in exercises.secondary_muscles.
        - Exclude sets where set_type == 'warmup' or reps <= 0 (yields 0.0).

    Args:
        set_obj: Completed workout set.
        exercise: Target exercise metadata (muscle_group, secondary_muscles, category, is_compound).
        default_working_rir: Fallback RIR for unrated working sets.

    Returns:
        MuscleVolumeCredit detailing fractional sets, eReps, and systemic fatigue multiplier.
    """
    set_id = str(_get_val(set_obj, "id", "")) or None
    ex_id = str(_get_val(set_obj, "exercise_id", _get_val(exercise, "id", "unknown")))
    st = str(_get_val(set_obj, "set_type", "working")).strip().lower()
    reps_raw = _get_val(set_obj, "reps", 0)

    try:
        reps = int(reps_raw)
    except (ValueError, TypeError):
        reps = 0

    # Primary muscle group
    primary = str(_get_val(exercise, "muscle_group", "Other")).strip()
    if not primary:
        primary = "Other"

    # Secondary muscles
    secondaries_raw = _get_val(exercise, "secondary_muscles", None)
    secondary_muscles = get_exercise_synergies(ex_id, secondaries_raw)

    # Category and compound status for m_sys
    cat = _get_val(exercise, "category", "Barbell")
    compound = _get_val(exercise, "is_compound", True)
    m_sys = compute_systemic_fatigue_multiplier(cat, compound)

    credits_map: Dict[str, Tuple[float, float]] = {}

    # Exclude warmup sets or zero rep sets
    if st == "warmup" or reps <= 0:
        return MuscleVolumeCredit(
            set_id=set_id,
            exercise_id=ex_id,
            primary_muscle=primary,
            secondary_muscles=secondary_muscles,
            effective_reps=0.0,
            systemic_fatigue_multiplier=m_sys,
            direct_fractional_sets=0.0,
            indirect_fractional_sets=0.0,
            credits=credits_map,
        )

    # Compute effective reps
    ereps = compute_effective_reps(set_obj, default_working_rir=default_working_rir)

    # 1. Direct volume to primary muscle group: 1.0 fractional set, 1.0 * eReps
    credits_map[primary] = (1.0, ereps)

    # 2. Indirect volume to secondary muscles: 0.5 fractional set, 0.5 * eReps
    for sec_m in secondary_muscles:
        if sec_m and sec_m != primary:
            prev_sets, prev_ereps = credits_map.get(sec_m, (0.0, 0.0))
            credits_map[sec_m] = (prev_sets + 0.5, prev_ereps + 0.5 * ereps)

    return MuscleVolumeCredit(
        set_id=set_id,
        exercise_id=ex_id,
        primary_muscle=primary,
        secondary_muscles=secondary_muscles,
        effective_reps=ereps,
        systemic_fatigue_multiplier=m_sys,
        direct_fractional_sets=1.0,
        indirect_fractional_sets=0.5,
        credits=credits_map,
    )


# ============================================================================
# Core Implementation: Localized Banister ODEs per Muscle Group
# ============================================================================

def compute_muscle_partitioned_readiness(
    workouts: Sequence[Union[Workout, Mapping[str, Any], Any]],
    workout_sets: Sequence[Union[WorkoutSet, Mapping[str, Any], Any]],
    exercises: Optional[Sequence[Union[Exercise, Mapping[str, Any], Any]]] = None,
    body_metrics: Sequence[Union[BodyMetric, Mapping[str, Any], Any]] = (),
    base_tau2: float = DEFAULT_TAU2_BASE_DAYS,
    tau1: float = 42.0,
    k1: float = 1.0,
    k2: float = 1.25,
) -> Dict[str, float]:
    """Calculates current localized athletic readiness (0-100%) for each of the 12 muscle groups.

    Mathematical Specification:
        Runs lightweight localized EWMA ODEs per muscle group m in {1 ... 12}
        using local recovery time constant tau_{2,m} = 0.65 * tau_2(t)
        (local peripheral recovery is faster than systemic CNS recovery).
    """
    # Build exercise dictionary lookup
    ex_map: Dict[str, Any] = {}
    if exercises:
        for ex in exercises:
            eid = str(_get_val(ex, "id", ""))
            if eid:
                ex_map[eid] = ex

    # Build workout date map
    workout_dates: Dict[str, str] = {}
    for w in workouts:
        wid = str(_get_val(w, "id", ""))
        d_val = _get_val(w, "date", None)
        if wid and d_val:
            s_d = str(d_val)[:10]
            workout_dates[wid] = s_d

    # Map daily muscle stimulus
    daily_muscle_stimulus: Dict[str, Dict[str, float]] = {}

    for s in workout_sets:
        st = str(_get_val(s, "set_type", "working")).strip().lower()
        if st == "warmup":
            continue

        wid = str(_get_val(s, "workout_id", ""))
        set_date = workout_dates.get(wid)
        if not set_date:
            c_at = _get_val(s, "created_at", None)
            if c_at:
                set_date = str(c_at)[:10]
        if not set_date:
            continue

        ex_id = str(_get_val(s, "exercise_id", ""))
        ex_obj = ex_map.get(ex_id)

        # Route volume credit
        credit = route_muscle_volume_credit(s, ex_obj)
        day_muscles = daily_muscle_stimulus.setdefault(set_date, {m: 0.0 for m in CANONICAL_MUSCLE_GROUPS})

        for m_name, (frac_sets, e_reps) in credit.credits.items():
            if m_name in day_muscles:
                day_muscles[m_name] += frac_sets * (1.0 + min(1.0, e_reps / 5.0))

    if not daily_muscle_stimulus:
        # Default readiness is 100% when no training fatigue is recorded
        return {m: 100.0 for m in CANONICAL_MUSCLE_GROUPS}

    sorted_dates = sorted(daily_muscle_stimulus.keys())
    first_date = datetime.strptime(sorted_dates[0], "%Y-%m-%d").date()
    last_date = datetime.strptime(sorted_dates[-1], "%Y-%m-%d").date()

    # Track state vectors per muscle: fitness P_m and fatigue F_m
    curr_fit: Dict[str, float] = {m: 0.0 for m in CANONICAL_MUSCLE_GROUPS}
    curr_fat: Dict[str, float] = {m: 0.0 for m in CANONICAL_MUSCLE_GROUPS}

    decay_p = math.exp(-1.0 / tau1)
    alpha_p = 1.0 - decay_p

    total_days = (last_date - first_date).days + 1
    for day_offset in range(total_days):
        curr_dt = first_date + timedelta(days=day_offset)
        curr_date_str = curr_dt.isoformat()

        # Compute systemic recovery state
        rec_state: RecoveryState = compute_recovery_modifier(
            metrics=body_metrics,
            target_date=curr_dt,
            base_tau2=base_tau2,
        )
        # Local peripheral recovery constant tau_{2,m} = 0.65 * tau_2(t)
        eff_tau2_local = LOCAL_PERIPHERAL_TAU2_RATIO * rec_state.effective_tau2
        decay_f_local = math.exp(-1.0 / eff_tau2_local)
        alpha_f_local = 1.0 - decay_f_local

        day_map = daily_muscle_stimulus.get(curr_date_str, {})
        for m in CANONICAL_MUSCLE_GROUPS:
            raw_stim = day_map.get(m, 0.0)
            if raw_stim > 0.0:
                # Diminishing returns saturation on local muscle stimulus
                sat_stim = 100.0 * (1.0 - math.exp(-raw_stim / 4.0))
            else:
                sat_stim = 0.0

            curr_fit[m] = (curr_fit[m] * decay_p) + (alpha_p * sat_stim)
            curr_fat[m] = (curr_fat[m] * decay_f_local) + (alpha_f_local * sat_stim)

    # Compute final localized readiness
    readiness_map: Dict[str, float] = {}
    for m in CANONICAL_MUSCLE_GROUPS:
        p_m = curr_fit[m]
        f_m = curr_fat[m]
        prep_m = (k1 * p_m) - (k2 * f_m)
        scale_m = max(12.0, 0.35 * p_m)
        r_score = 100.0 / (1.0 + math.exp(-prep_m / scale_m))
        readiness_map[m] = round(float(r_score), 1)

    return readiness_map


# ============================================================================
# Core Implementation: Empirical Bayesian Volume Landmarks (MEV, MAV, MRV)
# ============================================================================

def fit_muscle_volume_landmarks(
    weekly_volumes: Sequence[float],
    weekly_e10rm_slopes: Sequence[float],
    energy_balance: str = "MAINTENANCE",
    prior_mev: float = POPULATION_MEV_DEFAULT,
    prior_mav: float = POPULATION_MAV_DEFAULT,
    prior_mrv: float = POPULATION_MRV_DEFAULT,
) -> MuscleLandmarkResult:
    """Solves for empirical Bayesian volume landmarks [MEV, MAV, MRV] for a muscle group.

    Mathematical Specification:
        1. If < 6 weeks of data exist:
           Return population priors [MEV_0 = 6, MAV_0 = 14, MRV_0 = 20] scaled by energy balance.
        2. If >= 6 weeks of data exist:
           Fit quadratic dose-response curve:
               Delta ln(e10RM_{m,w}) = beta_0 + beta_1 * V - beta_2 * V^2
           Subject to bounded constraints: beta_1 > 0, beta_2 > 0.
           - MEV_m: Smallest root where expected gain >= 0 (clamped to [3, 10]).
           - MAV_m: Vertex of parabola beta_1 / (2 * beta_2) (clamped to [MEV_m + 2, 22]).
           - MRV_m: Upper root where expected gain drops to 0 (clamped to [MAV_m + 2, 30]).
        3. Smooth posterior blending with population priors.
        4. Energy balance scaling from recovery_modifier.py:
           Multiply [MAV, MRV] by 1.12 if SURPLUS, or 0.82 if DEFICIT.
    """
    n_weeks = min(len(weekly_volumes), len(weekly_e10rm_slopes))
    eb_norm = str(energy_balance).strip().upper()

    # Determine energy balance scaling multiplier
    if eb_norm == "SURPLUS":
        eb_scalar = ENERGY_BALANCE_SURPLUS_SCALAR
    elif eb_norm == "DEFICIT":
        eb_scalar = ENERGY_BALANCE_DEFICIT_SCALAR
    else:
        eb_scalar = 1.0

    # 1. Fallback to population priors if insufficient history (< 6 weeks)
    if n_weeks < MIN_WEEKS_FOR_EMPIRICAL_FIT:
        scaled_mev = round(prior_mev, 1)
        scaled_mav = round(prior_mav * eb_scalar, 1)
        scaled_mrv = round(prior_mrv * eb_scalar, 1)
        # Ensure ordering
        scaled_mav = max(scaled_mev + 2.0, scaled_mav)
        scaled_mrv = max(scaled_mav + 2.0, scaled_mrv)

        return MuscleLandmarkResult(
            muscle_group="Target",
            mev=scaled_mev,
            mav=scaled_mav,
            mrv=scaled_mrv,
            readiness_pct=100.0,
            is_empirical=False,
            weeks_analyzed=n_weeks,
            energy_balance=eb_norm,
        )

    # 2. Fit quadratic dose-response curve: y = beta_0 + beta_1 * V - beta_2 * V^2
    V = np.asarray(weekly_volumes[:n_weeks], dtype=np.float64)
    y = np.asarray(weekly_e10rm_slopes[:n_weeks], dtype=np.float64)

    # Design matrix: col 0 = 1, col 1 = V, col 2 = -V^2
    # So model prediction is A @ [beta_0, beta_1, beta_2]^T = beta_0 + beta_1*V - beta_2*V^2
    A = np.column_stack([np.ones_like(V), V, -(V ** 2)])

    # Bounded parameter constraints:
    # beta_0 in [-0.05, 0.05], beta_1 in [1e-5, 0.05], beta_2 in [1e-6, 0.005]
    lb = np.array([-0.05, 1e-5, 1e-6], dtype=np.float64)
    ub = np.array([0.05, 0.05, 0.005], dtype=np.float64)

    res = lsq_linear(A, y, bounds=(lb, ub))
    beta_0 = float(res.x[0])
    beta_1 = float(res.x[1])
    beta_2 = float(res.x[2])

    # Vertex: MAV = beta_1 / (2 * beta_2)
    mav_fit = beta_1 / (2.0 * beta_2)

    # Roots of -beta_2 * V^2 + beta_1 * V + beta_0 = 0
    # Discriminant: D = beta_1^2 + 4 * beta_2 * beta_0
    disc = (beta_1 ** 2) + (4.0 * beta_2 * beta_0)
    if disc >= 0:
        sqrt_disc = math.sqrt(disc)
        root_low = (beta_1 - sqrt_disc) / (2.0 * beta_2)
        root_high = (beta_1 + sqrt_disc) / (2.0 * beta_2)
        mev_fit = max(0.0, root_low) if root_low > 0 else 6.0
        mrv_fit = root_high if root_high > mav_fit else mav_fit + 6.0
    else:
        mev_fit = POPULATION_MEV_DEFAULT
        mrv_fit = mav_fit + 6.0

    # Clamp empirical values
    mev_clamped = min(10.0, max(3.0, mev_fit))
    mav_clamped = min(22.0, max(mev_clamped + 2.0, mav_fit))
    mrv_clamped = min(30.0, max(mav_clamped + 2.0, mrv_fit))

    # 3. Smooth Bayesian Posterior Blending
    # Blending weight w scales from ~0.10 at 6 weeks to 1.0 at 15+ weeks
    w_empirical = min(1.0, (float(n_weeks) - 5.0) / 10.0)
    blended_mev = (1.0 - w_empirical) * prior_mev + w_empirical * mev_clamped
    blended_mav = (1.0 - w_empirical) * prior_mav + w_empirical * mav_clamped
    blended_mrv = (1.0 - w_empirical) * prior_mrv + w_empirical * mrv_clamped

    # 4. Energy Balance Scaling
    final_mev = round(blended_mev, 1)
    final_mav = round(blended_mav * eb_scalar, 1)
    final_mrv = round(blended_mrv * eb_scalar, 1)

    # Enforce physiological ordering
    final_mav = max(final_mev + 2.0, final_mav)
    final_mrv = max(final_mav + 2.0, final_mrv)

    return MuscleLandmarkResult(
        muscle_group="Target",
        mev=final_mev,
        mav=final_mav,
        mrv=final_mrv,
        readiness_pct=100.0,
        is_empirical=True,
        weeks_analyzed=n_weeks,
        energy_balance=eb_norm,
    )


def solve_all_muscle_landmarks(
    weekly_volumes_by_muscle: Mapping[str, Sequence[float]],
    weekly_e10rm_slopes_by_muscle: Mapping[str, Sequence[float]],
    energy_balance: str = "MAINTENANCE",
    current_readiness_by_muscle: Optional[Mapping[str, float]] = None,
) -> Dict[str, MuscleLandmarkResult]:
    """Computes calibrated [MEV, MAV, MRV] volume landmarks for all 12 canonical muscle groups."""
    results: Dict[str, MuscleLandmarkResult] = {}
    readiness_map = current_readiness_by_muscle or {}

    for m in CANONICAL_MUSCLE_GROUPS:
        vols = weekly_volumes_by_muscle.get(m, [])
        slopes = weekly_e10rm_slopes_by_muscle.get(m, [])
        landmark_res = fit_muscle_volume_landmarks(
            weekly_volumes=vols,
            weekly_e10rm_slopes=slopes,
            energy_balance=energy_balance,
        )
        landmark_res.muscle_group = m
        landmark_res.readiness_pct = float(readiness_map.get(m, 100.0))
        results[m] = landmark_res

    return results
