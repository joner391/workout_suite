"""Empirical SFR (Stimulus-to-Fatigue Ratio), Variant Tree Substitution, and Limb Asymmetry Engine.

Implements the mathematical specifications for:
1. Empirical Exercise SFR Score (SFR_ex in [0, 100]):
   Raw SFR = ((mean_eReps / 5.0) * (1 + max(-0.5, 10 * x_dot_10RM))) /
             ((1 + 3.0 * mean_delta_drop) * (1 + 0.25 * sum(joint_pain) + 0.08 * sum(muscle_pain)))
   Classified into tiers:
   - OPTIMAL (>= 65)
   - MODERATE (40-64)
   - POOR_SWAP_RECOMMENDED (< 40 or any single joint pain report with severity >= 5)

2. Variant Tree Substitution Resolver:
   When an exercise is flagged POOR_SWAP_RECOMMENDED, queries sibling/parent/child movements
   in the parent_exercise_id variant hierarchy, filtering by equipment access and gear inventory,
   and ranking candidates by lowest historical joint pain and lowest systemic fatigue (m_sys).

3. Unilateral Limb Asymmetry Index:
   For exercises with is_unilateral == 1 and non-null reps_right:
   Asymmetry_ex = (1 / M) * sum(|reps_m - reps_right_m| / max(reps_m, reps_right_m))
   Flags if Asymmetry_ex > 0.12 (12%) across M >= 3 consecutive sessions.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import math
from typing import Any, Dict, List, Literal, Mapping, Optional, Sequence, Set, Tuple, Union

import numpy as np
import numpy.typing as npt
import pandas as pd  # type: ignore[import-untyped]
from pydantic import BaseModel, ConfigDict, Field

from src.analysis.hypertrophy_signals import (
    DEFAULT_PRIOR_K,
    DEFAULT_UNRATED_WORKING_RIR,
    compute_effective_reps,
    compute_intra_session_dropoff,
    parse_timestamp,
    project_e10rm,
)
from src.analysis.muscle_landmarks import compute_systemic_fatigue_multiplier
from src.ingestion.schemas import (
    Exercise,
    GearInventory,
    PainReport,
    UserProfile,
    Workout,
    WorkoutSet,
)

# ============================================================================
# Constants & Hyperparameters
# ============================================================================

MIN_SESSIONS_FOR_SFR_EVAL: int = 3
DEFAULT_SFR_EVAL_WINDOW_DAYS: int = 56
DEFAULT_PAIN_EVAL_WINDOW_DAYS: int = 28
DEFAULT_10RM_SLOPE_WINDOW_DAYS: int = 28

JOINT_PAIN_PENALTY_WEIGHT: float = 0.25
MUSCLE_PAIN_PENALTY_WEIGHT: float = 0.08
INTRA_SESSION_DROPOFF_WEIGHT: float = 3.0
E10RM_SLOPE_MULTIPLIER: float = 10.0
E10RM_SLOPE_FLOOR: float = -0.5

SEVERE_JOINT_PAIN_THRESHOLD: int = 5
SFR_OPTIMAL_THRESHOLD: float = 65.0
SFR_MODERATE_THRESHOLD: float = 40.0

UNILATERAL_ASYMMETRY_THRESHOLD: float = 0.12  # 12% asymmetry threshold
UNILATERAL_MIN_CONSECUTIVE_SESSIONS: int = 3

SFRTier = Literal["OPTIMAL", "MODERATE", "POOR_SWAP_RECOMMENDED"]


# ============================================================================
# Pydantic v2 Models
# ============================================================================

class ExerciseSFRResult(BaseModel):
    """Evaluated Stimulus-to-Fatigue Ratio (SFR) and substitution recommendation."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    exercise_id: str
    sfr_score: Optional[float] = Field(default=None, ge=0.0, le=100.0, description="0-100 normalized SFR score.")
    sfr_tier: SFRTier = Field(description="Classification tier: OPTIMAL, MODERATE, or POOR_SWAP_RECOMMENDED.")
    is_evaluable: bool = Field(description="True if exercise has >= 3 sessions in evaluation window.")
    sessions_evaluated: int = Field(ge=0, description="Total sessions evaluated in the 56-day window.")
    mean_effective_reps: float = Field(ge=0.0, description="Mean effective reps per working set.")
    intra_session_dropoff: float = Field(ge=0.0, description="Mean intra-session fatigue decay slope delta_drop.")
    e10rm_slope_28d: float = Field(description="28-day rate of change of ln(e10RM_t).")
    joint_pain_sum: int = Field(ge=0, description="Sum of joint pain severities in the last 28 days.")
    muscle_pain_sum: int = Field(ge=0, description="Sum of muscle pain severities in the last 28 days.")
    has_severe_joint_pain: bool = Field(description="True if any joint pain report has severity >= 5.")
    recommended_swap_exercise_id: Optional[str] = Field(
        default=None,
        description="Suggested replacement exercise ID from parent_exercise_id variant tree.",
    )
    swap_candidates: List[str] = Field(
        default_factory=list,
        description="Ranked candidate replacement exercise IDs.",
    )


class UnilateralAsymmetryResult(BaseModel):
    """Unilateral limb repetition asymmetry evaluation across consecutive sessions."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    exercise_id: str
    is_unilateral: bool = Field(description="True if movement is cataloged as unilateral.")
    sessions_evaluated: int = Field(ge=0, description="Number of evaluated consecutive sessions.")
    asymmetry_ratio: float = Field(ge=0.0, le=1.0, description="Mean fractional rep asymmetry ratio.")
    is_asymmetry_flagged: bool = Field(description="True if asymmetry > 0.12 across >= 3 sessions.")
    consecutive_breaches: int = Field(ge=0, description="Number of consecutive sessions exceeding 12% asymmetry.")


# ============================================================================
# Helpers
# ============================================================================

def _get_val(obj: Any, key: str, default: Any = None) -> Any:
    """Safe accessor for dicts and object attributes."""
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _calculate_ols_slope(days: Sequence[float], y_vals: Sequence[float]) -> float:
    """Calculates ordinary least squares linear regression slope dy/dt."""
    n = len(days)
    if n < 2:
        return 0.0

    t_arr = np.asarray(days, dtype=np.float64)
    y_arr = np.asarray(y_vals, dtype=np.float64)

    t_var = float(np.var(t_arr))
    if t_var <= 1e-12:
        return 0.0

    cov_ty = float(np.cov(t_arr, y_arr, bias=True)[0, 1])
    return float(cov_ty / t_var)


# ============================================================================
# Core Implementation 1: Empirical SFR Evaluation
# ============================================================================

def compute_exercise_sfr(
    exercise_id: str,
    workout_sets: Sequence[Union[WorkoutSet, Mapping[str, Any], Any]],
    pain_reports: Sequence[Union[PainReport, Mapping[str, Any], Any]] = (),
    workouts: Sequence[Union[Workout, Mapping[str, Any], Any]] = (),
    exercises: Optional[Sequence[Union[Exercise, Mapping[str, Any], Any]]] = None,
    user_profile: Optional[Union[UserProfile, Mapping[str, Any], Any]] = None,
    gear_inventory: Sequence[Union[GearInventory, Mapping[str, Any], Any]] = (),
    as_of_date: Optional[Union[str, datetime]] = None,
    k_t: float = DEFAULT_PRIOR_K,
    default_working_rir: float = DEFAULT_UNRATED_WORKING_RIR,
    min_sessions: int = MIN_SESSIONS_FOR_SFR_EVAL,
) -> ExerciseSFRResult:
    """Calculates empirical Stimulus-to-Fatigue Ratio (SFR) and substitution recommendation.

    Mathematical Specification:
        Raw SFR = ((mean_eReps / 5.0) * (1 + max(-0.5, 10 * x_dot_10RM))) /
                  ((1 + 3.0 * mean_delta_drop) * (1 + 0.25 * sum(joint_pain) + 0.08 * sum(muscle_pain)))

        Classified into tiers:
        - OPTIMAL (>= 65)
        - MODERATE (40-64)
        - POOR_SWAP_RECOMMENDED (< 40 or any single joint pain report with severity >= 5)
    """
    ref_dt = parse_timestamp(as_of_date) or datetime.now(timezone.utc)
    eval_window_start = ref_dt - timedelta(days=DEFAULT_SFR_EVAL_WINDOW_DAYS)
    recent_28d_start = ref_dt - timedelta(days=DEFAULT_PAIN_EVAL_WINDOW_DAYS)

    # 1. Map workout dates
    workout_date_map: Dict[str, datetime] = {}
    for w in workouts:
        wid = str(_get_val(w, "id", ""))
        d_val = _get_val(w, "date", _get_val(w, "started_at", None))
        parsed = parse_timestamp(d_val)
        if wid and parsed:
            workout_date_map[wid] = parsed

    # 2. Filter working sets for this exercise within 56-day evaluation window
    exercise_sessions: Dict[str, List[Any]] = {}  # {session_key: [sets]}
    session_timestamps: Dict[str, datetime] = {}

    for s in workout_sets:
        if str(_get_val(s, "exercise_id", "")) != exercise_id:
            continue
        st = str(_get_val(s, "set_type", "working")).strip().lower()
        if st == "warmup":
            continue

        wid = str(_get_val(s, "workout_id", "default_workout"))
        c_at = parse_timestamp(_get_val(s, "created_at", None))
        s_dt = c_at or workout_date_map.get(wid)
        if s_dt is None or s_dt < eval_window_start or s_dt > ref_dt:
            continue

        session_key = f"{wid}_{s_dt.date().isoformat()}"
        exercise_sessions.setdefault(session_key, []).append(s)
        if session_key not in session_timestamps or s_dt < session_timestamps[session_key]:
            session_timestamps[session_key] = s_dt

    n_sessions = len(exercise_sessions)

    # 3. Sum pain reports in the last 28 days
    joint_pain_sum = 0
    muscle_pain_sum = 0
    has_severe_joint_pain = False

    for p in pain_reports:
        if str(_get_val(p, "exercise_id", "")) != exercise_id:
            continue
        p_dt = parse_timestamp(_get_val(p, "created_at", None))
        if p_dt is None or p_dt < recent_28d_start or p_dt > ref_dt:
            continue

        p_type = str(_get_val(p, "pain_type", "")).strip().lower()
        sev = int(_get_val(p, "severity", 0))

        if p_type == "joint":
            joint_pain_sum += sev
            if sev >= SEVERE_JOINT_PAIN_THRESHOLD:
                has_severe_joint_pain = True
        elif p_type == "muscle":
            muscle_pain_sum += sev

    # Check minimum session threshold
    if n_sessions < min_sessions:
        # Insufficient longitudinal volume to reliably score SFR
        tier: SFRTier = "POOR_SWAP_RECOMMENDED" if has_severe_joint_pain else "MODERATE"
        return ExerciseSFRResult(
            exercise_id=exercise_id,
            sfr_score=None,
            sfr_tier=tier,
            is_evaluable=False,
            sessions_evaluated=n_sessions,
            mean_effective_reps=0.0,
            intra_session_dropoff=0.0,
            e10rm_slope_28d=0.0,
            joint_pain_sum=joint_pain_sum,
            muscle_pain_sum=muscle_pain_sum,
            has_severe_joint_pain=has_severe_joint_pain,
            recommended_swap_exercise_id=None,
            swap_candidates=[],
        )

    # 4. Numerator components: mean eReps and 28-day e10RM slope
    all_ereps: List[float] = []
    session_dropoffs: List[float] = []
    session_e10rms: List[Tuple[float, float]] = []  # (days_elapsed, ln_e10rm)

    for session_key, s_list in exercise_sessions.items():
        s_dt = session_timestamps[session_key]

        # Intra-session dropoff
        dropoff = compute_intra_session_dropoff(
            s_list,
            k_t=k_t,
            default_working_rir=default_working_rir,
        )
        session_dropoffs.append(max(0.0, dropoff))

        # Effective reps and session peak e10RM
        top_e1rm = 0.0
        for s in s_list:
            erep = compute_effective_reps(s, default_working_rir=default_working_rir)
            all_ereps.append(erep)

            w_val = float(_get_val(s, "weight", 0.0))
            r_val = int(_get_val(s, "reps", 0))
            if w_val > 0.0 and r_val > 0:
                s_e1rm = w_val * ((r_val + default_working_rir) ** k_t)
                if s_e1rm > top_e1rm:
                    top_e1rm = s_e1rm

        # If in 28-day window, record e10RM
        if s_dt >= recent_28d_start and top_e1rm > 0.0:
            e10rm = project_e10rm(top_e1rm, k=k_t)
            days_from_start = (s_dt - recent_28d_start).total_seconds() / 86400.0
            # Normalized across 28-day span (t in [0, 1])
            session_e10rms.append((days_from_start / 28.0, math.log(max(1.0, e10rm))))

    mean_ereps = float(np.mean(all_ereps)) if all_ereps else 0.0
    mean_dropoff = float(np.mean(session_dropoffs)) if session_dropoffs else 0.0

    # Calculate 28-day OLS slope of ln(e10RM)
    if len(session_e10rms) >= 2:
        days_arr = [pt[0] for pt in session_e10rms]
        ln_arr = [pt[1] for pt in session_e10rms]
        e10rm_slope = _calculate_ols_slope(days_arr, ln_arr)
    else:
        e10rm_slope = 0.0

    # 5. Evaluate Raw SFR Formula
    erep_factor = mean_ereps / 5.0
    progression_factor = 1.0 + max(E10RM_SLOPE_FLOOR, E10RM_SLOPE_MULTIPLIER * e10rm_slope)
    dropoff_penalty = 1.0 + INTRA_SESSION_DROPOFF_WEIGHT * mean_dropoff
    pain_penalty = 1.0 + (JOINT_PAIN_PENALTY_WEIGHT * joint_pain_sum) + (MUSCLE_PAIN_PENALTY_WEIGHT * muscle_pain_sum)

    numerator = erep_factor * progression_factor
    denominator = max(0.1, dropoff_penalty * pain_penalty)

    raw_sfr = max(0.0, numerator / denominator)

    # 6. Map to [0, 100] score and classify into tiers
    sfr_score = round(min(100.0, max(0.0, raw_sfr * 100.0)), 1)

    if has_severe_joint_pain or sfr_score < SFR_MODERATE_THRESHOLD:
        tier = "POOR_SWAP_RECOMMENDED"
        # Severe joint pain caps score below 40
        if has_severe_joint_pain and sfr_score >= SFR_MODERATE_THRESHOLD:
            sfr_score = 39.0
    elif sfr_score >= SFR_OPTIMAL_THRESHOLD:
        tier = "OPTIMAL"
    else:
        tier = "MODERATE"

    # 7. Resolve substitution candidates if swap recommended
    swap_id: Optional[str] = None
    candidates: List[str] = []
    if tier == "POOR_SWAP_RECOMMENDED" and exercises:
        candidates = resolve_variant_substitutions(
            current_exercise_id=exercise_id,
            exercises=exercises,
            pain_reports=pain_reports,
            user_profile=user_profile,
            gear_inventory=gear_inventory,
        )
        if candidates:
            swap_id = candidates[0]

    return ExerciseSFRResult(
        exercise_id=exercise_id,
        sfr_score=sfr_score,
        sfr_tier=tier,
        is_evaluable=True,
        sessions_evaluated=n_sessions,
        mean_effective_reps=round(mean_ereps, 2),
        intra_session_dropoff=round(mean_dropoff, 4),
        e10rm_slope_28d=round(e10rm_slope, 4),
        joint_pain_sum=joint_pain_sum,
        muscle_pain_sum=muscle_pain_sum,
        has_severe_joint_pain=has_severe_joint_pain,
        recommended_swap_exercise_id=swap_id,
        swap_candidates=candidates,
    )


# ============================================================================
# Core Implementation 2: Variant Tree Substitution Resolver
# ============================================================================

def resolve_variant_substitutions(
    current_exercise_id: str,
    exercises: Sequence[Union[Exercise, Mapping[str, Any], Any]],
    pain_reports: Sequence[Union[PainReport, Mapping[str, Any], Any]] = (),
    user_profile: Optional[Union[UserProfile, Mapping[str, Any], Any]] = None,
    gear_inventory: Sequence[Union[GearInventory, Mapping[str, Any], Any]] = (),
) -> List[str]:
    """Resolves and ranks compatible replacement movements from the parent_exercise_id variant hierarchy.

    Matching Rules:
        1. Sibling: candidate.parent_exercise_id == current.parent_exercise_id
        2. Parent: candidate.id == current.parent_exercise_id
        3. Child: candidate.parent_exercise_id == current.id
        4. Same Muscle Group fallback: candidate.muscle_group == current.muscle_group
           and candidate.is_compound == current.is_compound.

    Ranking Criteria:
        1. Lower historical joint pain in pain_reports (lowest first).
        2. Lower systemic axial fatigue multiplier m_sys (Dumbbell/Machine ahead of Barbell).
        3. Same primary muscle match.
    """
    ex_by_id: Dict[str, Any] = {str(_get_val(e, "id", "")): e for e in exercises if _get_val(e, "id", "")}
    curr_ex = ex_by_id.get(current_exercise_id)
    if not curr_ex:
        return []

    curr_parent = _get_val(curr_ex, "parent_exercise_id", None)
    curr_muscle = str(_get_val(curr_ex, "muscle_group", "")).strip().lower()
    curr_compound = bool(_get_val(curr_ex, "is_compound", True))

    # Evaluate permitted categories from equipment_access
    eq_access = str(_get_val(user_profile, "equipment_access", "commercial_gym")).lower()
    permitted_categories: Optional[Set[str]] = None
    if eq_access == "barbell_only":
        permitted_categories = {"barbell", "bodyweight"}
    elif eq_access == "dumbbells_only":
        permitted_categories = {"dumbbell", "bodyweight"}
    elif eq_access == "bodyweight_only":
        permitted_categories = {"bodyweight"}

    # Tally recent joint pain by exercise
    joint_pain_by_ex: Dict[str, int] = {}
    for p in pain_reports:
        p_type = str(_get_val(p, "pain_type", "")).strip().lower()
        if p_type == "joint":
            eid = str(_get_val(p, "exercise_id", ""))
            joint_pain_by_ex[eid] = joint_pain_by_ex.get(eid, 0) + int(_get_val(p, "severity", 0))

    tree_candidates: List[Any] = []
    fallback_candidates: List[Any] = []

    for eid, cand in ex_by_id.items():
        if eid == current_exercise_id:
            continue

        cand_cat = str(_get_val(cand, "category", "")).strip().lower()
        if permitted_categories is not None and cand_cat not in permitted_categories:
            continue

        cand_parent = _get_val(cand, "parent_exercise_id", None)
        cand_muscle = str(_get_val(cand, "muscle_group", "")).strip().lower()
        cand_compound = bool(_get_val(cand, "is_compound", True))

        # Check variant hierarchy connection
        is_sibling = curr_parent is not None and cand_parent == curr_parent
        is_parent = curr_parent is not None and eid == curr_parent
        is_child = cand_parent == current_exercise_id

        if is_sibling or is_parent or is_child:
            tree_candidates.append(cand)
        elif cand_muscle == curr_muscle and cand_compound == curr_compound:
            fallback_candidates.append(cand)

    selected_pool = tree_candidates if tree_candidates else fallback_candidates

    # Sorting key: (historical_joint_pain ASC, m_sys ASC, name ASC)
    def _rank_key(ex_obj: Any) -> Tuple[int, float, str]:
        eid = str(_get_val(ex_obj, "id", ""))
        p_score = joint_pain_by_ex.get(eid, 0)
        cat = _get_val(ex_obj, "category", "Barbell")
        comp = _get_val(ex_obj, "is_compound", True)
        m_sys = compute_systemic_fatigue_multiplier(cat, comp)
        return (p_score, m_sys, eid)

    selected_pool.sort(key=_rank_key)
    return [str(_get_val(c, "id", "")) for c in selected_pool]


# ============================================================================
# Core Implementation 3: Unilateral Limb Asymmetry Index
# ============================================================================

def compute_unilateral_asymmetry(
    exercise_id: str,
    workout_sets: Sequence[Union[WorkoutSet, Mapping[str, Any], Any]],
    workouts: Sequence[Union[Workout, Mapping[str, Any], Any]] = (),
    exercise: Optional[Union[Exercise, Mapping[str, Any], Any]] = None,
    min_consecutive_sessions: int = UNILATERAL_MIN_CONSECUTIVE_SESSIONS,
    asymmetry_threshold: float = UNILATERAL_ASYMMETRY_THRESHOLD,
) -> UnilateralAsymmetryResult:
    """Calculates unilateral limb repetition asymmetry across consecutive sessions.

    Mathematical Specification:
        Asymmetry_ex = (1 / M) * sum(|reps_m - reps_right_m| / max(reps_m, reps_right_m))
        Flags if Asymmetry_ex > 0.12 (12%) across M >= 3 consecutive sessions.
    """
    is_unilateral = bool(_get_val(exercise, "is_unilateral", False)) if exercise else False

    # Group sets by session chronologically
    workout_date_map: Dict[str, datetime] = {}
    for w in workouts:
        wid = str(_get_val(w, "id", ""))
        d_val = _get_val(w, "date", _get_val(w, "started_at", None))
        parsed = parse_timestamp(d_val)
        if wid and parsed:
            workout_date_map[wid] = parsed

    session_sets: Dict[str, List[Any]] = {}
    session_timestamps: Dict[str, datetime] = {}

    for s in workout_sets:
        if str(_get_val(s, "exercise_id", "")) != exercise_id:
            continue
        st = str(_get_val(s, "set_type", "working")).strip().lower()
        if st == "warmup":
            continue

        r_left = _get_val(s, "reps", None)
        r_right = _get_val(s, "reps_right", None)
        if r_left is None or r_right is None:
            continue

        try:
            nl = int(r_left)
            nr = int(r_right)
            if nl <= 0 or nr <= 0:
                continue
        except (ValueError, TypeError):
            continue

        # If exercise has unilateral sets, mark as unilateral
        is_unilateral = True

        wid = str(_get_val(s, "workout_id", "default_workout"))
        c_at = parse_timestamp(_get_val(s, "created_at", None))
        s_dt = c_at or workout_date_map.get(wid) or datetime.now(timezone.utc)

        session_key = f"{wid}_{s_dt.date().isoformat()}"
        session_sets.setdefault(session_key, []).append((nl, nr))
        if session_key not in session_timestamps or s_dt < session_timestamps[session_key]:
            session_timestamps[session_key] = s_dt

    if not session_sets:
        return UnilateralAsymmetryResult(
            exercise_id=exercise_id,
            is_unilateral=is_unilateral,
            sessions_evaluated=0,
            asymmetry_ratio=0.0,
            is_asymmetry_flagged=False,
            consecutive_breaches=0,
        )

    # Sort sessions chronologically
    sorted_sessions = sorted(session_sets.keys(), key=lambda k: session_timestamps[k])

    session_asymmetries: List[float] = []
    for s_key in sorted_sessions:
        set_pairs = session_sets[s_key]
        ratios = [abs(nl - nr) / float(max(nl, nr)) for nl, nr in set_pairs]
        session_asymmetries.append(float(np.mean(ratios)))

    m_sessions = len(session_asymmetries)
    overall_mean_asymmetry = float(np.mean(session_asymmetries))

    # Evaluate consecutive session breaches (> threshold)
    consecutive_breaches = 0
    for asym in reversed(session_asymmetries):
        if asym > asymmetry_threshold:
            consecutive_breaches += 1
        else:
            break

    is_flagged = consecutive_breaches >= min_consecutive_sessions and overall_mean_asymmetry > asymmetry_threshold

    return UnilateralAsymmetryResult(
        exercise_id=exercise_id,
        is_unilateral=is_unilateral,
        sessions_evaluated=m_sessions,
        asymmetry_ratio=round(overall_mean_asymmetry, 4),
        is_asymmetry_flagged=is_flagged,
        consecutive_breaches=consecutive_breaches,
    )


# ============================================================================
# Batch Suite Solvers
# ============================================================================

def evaluate_all_exercises_sfr(
    workout_sets: Sequence[Union[WorkoutSet, Mapping[str, Any], Any]],
    pain_reports: Sequence[Union[PainReport, Mapping[str, Any], Any]] = (),
    workouts: Sequence[Union[Workout, Mapping[str, Any], Any]] = (),
    exercises: Optional[Sequence[Union[Exercise, Mapping[str, Any], Any]]] = None,
    user_profile: Optional[Union[UserProfile, Mapping[str, Any], Any]] = None,
    gear_inventory: Sequence[Union[GearInventory, Mapping[str, Any], Any]] = (),
    as_of_date: Optional[Union[str, datetime]] = None,
    k_t: float = DEFAULT_PRIOR_K,
) -> Dict[str, ExerciseSFRResult]:
    """Batch computes SFR evaluations and substitutions across all exercises present in workout sets."""
    unique_ex_ids: Set[str] = {
        str(_get_val(s, "exercise_id", ""))
        for s in workout_sets
        if str(_get_val(s, "exercise_id", ""))
    }
    if exercises:
        unique_ex_ids.update(str(_get_val(e, "id", "")) for e in exercises if _get_val(e, "id", ""))

    results: Dict[str, ExerciseSFRResult] = {}
    for eid in sorted(unique_ex_ids):
        res = compute_exercise_sfr(
            exercise_id=eid,
            workout_sets=workout_sets,
            pain_reports=pain_reports,
            workouts=workouts,
            exercises=exercises,
            user_profile=user_profile,
            gear_inventory=gear_inventory,
            as_of_date=as_of_date,
            k_t=k_t,
        )
        results[eid] = res

    return results


def evaluate_all_unilateral_asymmetries(
    workout_sets: Sequence[Union[WorkoutSet, Mapping[str, Any], Any]],
    workouts: Sequence[Union[Workout, Mapping[str, Any], Any]] = (),
    exercises: Optional[Sequence[Union[Exercise, Mapping[str, Any], Any]]] = None,
) -> Dict[str, UnilateralAsymmetryResult]:
    """Batch computes unilateral limb asymmetries for all exercises with reps_right logged."""
    ex_map: Dict[str, Any] = {str(_get_val(e, "id", "")): e for e in exercises or [] if _get_val(e, "id", "")}

    # Find exercises that have at least one set with non-null reps_right
    unilateral_ex_ids: Set[str] = set()
    for s in workout_sets:
        if _get_val(s, "reps_right", None) is not None:
            eid = str(_get_val(s, "exercise_id", ""))
            if eid:
                unilateral_ex_ids.add(eid)

    results: Dict[str, UnilateralAsymmetryResult] = {}
    for eid in sorted(unilateral_ex_ids):
        res = compute_unilateral_asymmetry(
            exercise_id=eid,
            workout_sets=workout_sets,
            workouts=workouts,
            exercise=ex_map.get(eid),
        )
        results[eid] = res

    return results
