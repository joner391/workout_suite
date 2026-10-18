"""Actionable Decision Engine & ACWR Recommendations for Workout Suite Companion.

Implements the training advisories specified in:
- Rough_sketch.md Section 4.5
- IMPLEMENTATION_PLAN.md Step 6.2

Mathematical & Sports Science Foundations:
    1. Acute:Chronic Workload Ratio (ACWR):
       - Acute Workload: 7-day rolling mean of daily training stimulus.
       - Chronic Workload: 28-day rolling mean of daily training stimulus.
       - ACWR = Acute Workload / Chronic Workload
       - Sweet Spot: 0.8 <= ACWR <= 1.3 (optimal adaptation, minimal injury risk).
       - Danger Zone: ACWR > 1.5 (fatigue spike, high injury/overreaching risk).
       - Under-stimulation: ACWR < 0.8 (fitness decay, stimulus insufficient).

    2. Structured Advisories:
       - OPTIMAL_OVERLOAD: Athlete is recovered (Preparedness >= 0) and workload is safe.
         Recommends progressive overload (+2.5% load or +1 rep).
       - DELOAD_WARNING: ACWR > 1.5 or severe negative preparedness.
         Recommends deload (-30% volume, -10% load).
       - UNDER_STIMULATION: ACWR < 0.8.
         Recommends adding volume (+1 to 2 sets per muscle group).
       - OVERREACHING: 1.3 < ACWR <= 1.5.
         Monitors acute fatigue; hold steady without adding sets.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import math
from typing import Any, Dict, List, Literal, Mapping, Optional, Sequence, Set, Tuple, Union

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from src.models.fatigue_banister import DailyPreparedness


# ============================================================================
# Constants & Thresholds (Rough_sketch.md Section 4.5 & Phase 4)
# ============================================================================

ACWR_ACUTE_WINDOW_DAYS: int = 7
ACWR_CHRONIC_WINDOW_DAYS: int = 28

ACWR_UNDER_STIMULATION_THRESHOLD: float = 0.80
ACWR_OPTIMAL_MAX_THRESHOLD: float = 1.30
ACWR_DELOAD_THRESHOLD: float = 1.50

# Phase 4 Program Parameter Audit Thresholds
AUDIT_EVAL_WINDOW_DAYS: int = 28
REST_TOO_SHORT_MEDIAN_SECONDS: float = 90.0
REST_TOO_SHORT_DROPOFF_THRESHOLD: float = 0.15
REST_TOO_SHORT_RECOMMENDED_SECONDS: int = 180

JUNK_VOLUME_RPE_CEILING: float = 7.3
JUNK_VOLUME_REDUCTION_FACTOR: float = 0.25
JUNK_VOLUME_RECOMMENDED_RPE_MIN: float = 8.5
JUNK_VOLUME_RECOMMENDED_RPE_MAX: float = 9.0

AXIAL_FATIGUE_OVER_FITNESS_RATIO: float = 1.35
AXIAL_LOCAL_READINESS_THRESHOLD: float = 70.0
AXIAL_BARBELL_VOLUME_SHARE_THRESHOLD: float = 0.60

REP_MONOTONY_PERCENT_THRESHOLD: float = 0.85
REP_MONOTONY_BAND_DELTA: int = 1


# ============================================================================
# Data Structures
# ============================================================================

ProgramAuditType = Literal[
    "REST_TOO_SHORT",
    "JUNK_VOLUME",
    "AXIAL_BOTTLENECK",
    "REP_MONOTONY",
]

AuditSeverity = Literal["INFO", "WARNING", "CRITICAL"]


class ProgramParameterAudit(BaseModel):
    """Structured program parameter audit rule finding and adjustment recommendation."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    audit_type: ProgramAuditType
    severity: AuditSeverity = "WARNING"
    target_id: str = Field(description="Target identifier: exercise ID, muscle group name, or 'systemic'.")
    target_type: Literal["exercise", "muscle_group", "systemic"]
    message: str
    recommended_action: str
    parameter_adjustments: Dict[str, Any] = Field(default_factory=dict)


@dataclass
class TrainingAdvisory:
    """Actionable training advisory with recommended volume and intensity adjustments."""

    date: str
    acwr: float
    acute_workload: float
    chronic_workload: float
    preparedness: float
    advisory_type: str  # "OPTIMAL_OVERLOAD" | "DELOAD_WARNING" | "UNDER_STIMULATION" | "OVERREACHING" | "MAINTENANCE"
    message: str
    recommended_volume_multiplier: float
    recommended_intensity_delta_percent: float


# ============================================================================
# ACWR & Recommendation Engine
# ============================================================================

def calculate_acwr(
    stimulus_history: Sequence[float],
    index: int,
    acute_days: int = ACWR_ACUTE_WINDOW_DAYS,
    chronic_days: int = ACWR_CHRONIC_WINDOW_DAYS,
) -> tuple[float, float, float]:
    """Calculates Acute Workload, Chronic Workload, and ACWR for a specific index.

    Returns:
        (acute_workload, chronic_workload, acwr)
    """
    if not stimulus_history or index < 0 or index >= len(stimulus_history):
        return (0.0, 0.0, 1.0)

    # Acute slice: [index - acute_days + 1 : index + 1]
    acute_start = max(0, index - acute_days + 1)
    acute_slice = stimulus_history[acute_start : index + 1]
    acute_workload = float(sum(acute_slice) / float(len(acute_slice))) if acute_slice else 0.0

    # Chronic slice: [index - chronic_days + 1 : index + 1]
    chronic_start = max(0, index - chronic_days + 1)
    chronic_slice = stimulus_history[chronic_start : index + 1]
    chronic_workload = float(sum(chronic_slice) / float(len(chronic_slice))) if chronic_slice else 0.0

    if chronic_workload < 1e-6:
        # If no chronic history exists, return 1.0 (neutral baseline)
        acwr = 1.0
    else:
        acwr = acute_workload / chronic_workload

    return (round(acute_workload, 3), round(chronic_workload, 3), round(acwr, 2))


def generate_advisory_for_day(
    day_state: DailyPreparedness,
    acute_workload: float,
    chronic_workload: float,
    acwr: float,
) -> TrainingAdvisory:
    """Maps daily readiness and ACWR to an actionable training advisory."""
    prep = day_state.preparedness

    if acwr >= ACWR_DELOAD_THRESHOLD or (prep < -15.0 and day_state.fatigue > 2.0 * day_state.fitness):
        advisory_type = "DELOAD_WARNING"
        message = (
            f"Acute:Chronic Workload Ratio ({acwr:.2f}) exceeds 1.50 or acute fatigue is excessive. "
            "High non-functional overreaching / injury risk. Recommend a 1-week deload (-30% volume, -10% load)."
        )
        vol_multiplier = 0.70
        intensity_delta = -10.0

    elif acwr < ACWR_UNDER_STIMULATION_THRESHOLD:
        advisory_type = "UNDER_STIMULATION"
        message = (
            f"Acute:Chronic Workload Ratio ({acwr:.2f}) is below 0.80. Training stimulus is insufficient "
            "to optimize muscular adaptations. Recommend adding 1-2 working sets or increasing session frequency."
        )
        vol_multiplier = 1.20
        intensity_delta = 0.0

    elif ACWR_UNDER_STIMULATION_THRESHOLD <= acwr <= ACWR_OPTIMAL_MAX_THRESHOLD and prep >= 0.0:
        advisory_type = "OPTIMAL_OVERLOAD"
        message = (
            f"Workload is well-managed (ACWR {acwr:.2f}) and net preparedness is positive (+{prep:.1f}). "
            "Optimal window for progressive overload (+2.5% load or +1 rep on key movements)."
        )
        vol_multiplier = 1.00
        intensity_delta = 2.5

    elif acwr > ACWR_OPTIMAL_MAX_THRESHOLD:
        advisory_type = "OVERREACHING"
        message = (
            f"Acute workload is elevated (ACWR {acwr:.2f}). Functional overreaching phase. "
            "Hold volume steady and prioritize sleep, nutrition, and recovery."
        )
        vol_multiplier = 1.00
        intensity_delta = 0.0

    else:
        advisory_type = "MAINTENANCE"
        message = (
            f"Workload is stable (ACWR {acwr:.2f}). Net preparedness is {prep:.1f}. "
            "Maintain current template volume and prescriptions."
        )
        vol_multiplier = 1.00
        intensity_delta = 0.0

    return TrainingAdvisory(
        date=day_state.date,
        acwr=acwr,
        acute_workload=acute_workload,
        chronic_workload=chronic_workload,
        preparedness=prep,
        advisory_type=advisory_type,
        message=message,
        recommended_volume_multiplier=vol_multiplier,
        recommended_intensity_delta_percent=intensity_delta,
    )


def compute_training_advisories(
    preparedness_series: Sequence[DailyPreparedness],
    acute_days: int = ACWR_ACUTE_WINDOW_DAYS,
    chronic_days: int = ACWR_CHRONIC_WINDOW_DAYS,
) -> List[TrainingAdvisory]:
    """Computes daily ACWR and generates structured training advisories across the timeline."""
    if not preparedness_series:
        return []

    stimulus_vals = [d.stimulus for d in preparedness_series]
    advisories: List[TrainingAdvisory] = []

    for idx, day_state in enumerate(preparedness_series):
        acute, chronic, ratio = calculate_acwr(
            stimulus_history=stimulus_vals,
            index=idx,
            acute_days=acute_days,
            chronic_days=chronic_days,
        )

        adv = generate_advisory_for_day(
            day_state=day_state,
            acute_workload=acute,
            chronic_workload=chronic,
            acwr=ratio,
        )
        advisories.append(adv)

    return advisories


def get_latest_advisory(
    preparedness_series: Sequence[DailyPreparedness],
    acute_days: int = ACWR_ACUTE_WINDOW_DAYS,
    chronic_days: int = ACWR_CHRONIC_WINDOW_DAYS,
) -> Optional[TrainingAdvisory]:
    """Returns the most recent actionable training advisory."""
    if not preparedness_series:
        return None
    advisories = compute_training_advisories(
        preparedness_series=preparedness_series,
        acute_days=acute_days,
        chronic_days=chronic_days,
    )
    return advisories[-1] if advisories else None


# ============================================================================
# Phase 4 Program Parameter Audit Evaluator
# ============================================================================

def _get_val(obj: Any, key: str, default: Any = None) -> Any:
    """Safe accessor for dicts and object attributes."""
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _parse_ts(ts: Any) -> Optional[datetime]:
    """Parses ISO timestamp string or datetime into UTC datetime."""
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    if isinstance(ts, str):
        try:
            s = ts.replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            try:
                dt = datetime.strptime(ts[:10], "%Y-%m-%d")
                return dt.replace(tzinfo=timezone.utc)
            except Exception:
                return None
    return None


def _calc_ols_slope(t_days: Sequence[float], y_vals: Sequence[float]) -> float:
    """Calculates ordinary least squares linear regression slope dy/dt."""
    n = len(t_days)
    if n < 2:
        return 0.0
    t_arr = np.asarray(t_days, dtype=np.float64)
    y_arr = np.asarray(y_vals, dtype=np.float64)
    var_t = float(np.var(t_arr))
    if var_t <= 1e-12:
        return 0.0
    cov_ty = float(np.cov(t_arr, y_arr, bias=True)[0, 1])
    return float(cov_ty / var_t)


def generate_parameter_audits(
    workout_sets: Sequence[Any],
    workouts: Sequence[Any] = (),
    exercises: Optional[Sequence[Any]] = None,
    landmarks_by_muscle: Optional[Mapping[str, Any]] = None,
    preparedness_series: Optional[Sequence[DailyPreparedness]] = None,
    as_of_date: Optional[Union[str, datetime, date]] = None,
    k_t: float = 0.10,
) -> List[ProgramParameterAudit]:
    """Evaluates program parameter audit rules and returns structured advisories.

    Audits:
    1. REST_TOO_SHORT:
       is_compound == 1 AND median rest < 90s AND mean dropoff > 0.15
       -> optimal_rest_seconds = 180
    2. JUNK_VOLUME:
       Weekly volume > MAV_m AND mean RPE < 7.3 AND e10RM slope <= 0
       -> Reduce volume by 25%, increase target RPE to 8.5-9.0
    3. AXIAL_BOTTLENECK:
       Global Banister F(t) > 1.35 P(t) AND local muscle readiness > 70% AND Barbell volume > 60%
       -> Swap 1 compound Barbell exercise for Machine/Cable variant
    4. REP_MONOTONY:
       > 85% of working sets within +/- 1 rep band AND e10RM slope <= 0
       -> Undulate rep brackets (e.g. top set 5-7 reps + back-off 10-14 reps)
    """
    if not workout_sets:
        return []

    # 1. Resolve anchor date
    anchor_dt: datetime
    if as_of_date is not None:
        parsed_anchor = _parse_ts(as_of_date)
        anchor_dt = parsed_anchor if parsed_anchor is not None else datetime.now(timezone.utc)
    else:
        set_timestamps = [_parse_ts(_get_val(s, "created_at")) for s in workout_sets]
        valid_ts = [t for t in set_timestamps if t is not None]
        anchor_dt = max(valid_ts) if valid_ts else datetime.now(timezone.utc)

    window_start = anchor_dt - timedelta(days=AUDIT_EVAL_WINDOW_DAYS)

    # 2. Map exercises and workouts
    ex_map: Dict[str, Any] = {str(_get_val(e, "id", "")): e for e in exercises or [] if _get_val(e, "id", "")}
    w_map: Dict[str, Any] = {str(_get_val(w, "id", "")): w for w in workouts if _get_val(w, "id", "")}

    # 3. Filter sets within 28-day window
    window_sets: List[Any] = []
    for s in workout_sets:
        s_ts = _parse_ts(_get_val(s, "created_at"))
        if s_ts is None:
            # Fall back to workout date
            wid = str(_get_val(s, "workout_id", ""))
            w_obj = w_map.get(wid)
            if w_obj:
                s_ts = _parse_ts(_get_val(w_obj, "started_at") or _get_val(w_obj, "date"))

        if s_ts is not None and window_start <= s_ts <= anchor_dt:
            window_sets.append(s)

    audits: List[ProgramParameterAudit] = []

    # Group window sets by exercise
    sets_by_exercise: Dict[str, List[Any]] = {}
    for s in window_sets:
        eid = str(_get_val(s, "exercise_id", ""))
        if eid:
            sets_by_exercise.setdefault(eid, []).append(s)

    # Precompute e10RM slope for each exercise
    e10rm_slope_by_ex: Dict[str, float] = {}
    for eid, e_sets in sets_by_exercise.items():
        session_dates: List[float] = []
        ln_e10rms: List[float] = []

        # Group by workout / date
        sets_by_session: Dict[str, List[Any]] = {}
        for s in e_sets:
            stype = str(_get_val(s, "set_type", "working")).lower()
            if stype == "warmup":
                continue
            wid = str(_get_val(s, "workout_id", ""))
            sets_by_session.setdefault(wid, []).append(s)

        for wid, s_list in sets_by_session.items():
            best_e1rm = 0.0
            s_time: Optional[datetime] = None
            for s in s_list:
                w = float(_get_val(s, "weight", 0.0))
                r = int(_get_val(s, "reps", 0))
                rir_raw = _get_val(s, "rir", None)
                rpe_raw = _get_val(s, "rpe", None)
                if rir_raw is not None:
                    rir = float(rir_raw)
                elif rpe_raw is not None:
                    rir = max(0.0, 10.0 - float(rpe_raw))
                else:
                    rir = 2.0
                r_eff = r + rir
                if w > 0.0 and r_eff > 0.0:
                    e1rm = w * (r_eff ** k_t)
                    if e1rm > best_e1rm:
                        best_e1rm = e1rm
                if s_time is None:
                    s_time = _parse_ts(_get_val(s, "created_at"))

            if best_e1rm > 0.0 and s_time is not None:
                e10rm = best_e1rm * (10.0 ** (-k_t))
                day_offset = (s_time - window_start).total_seconds() / 86400.0
                session_dates.append(day_offset)
                ln_e10rms.append(math.log(max(1.0, e10rm)))

        if len(session_dates) >= 2:
            e10rm_slope_by_ex[eid] = _calc_ols_slope(session_dates, ln_e10rms)
        else:
            e10rm_slope_by_ex[eid] = 0.0

    # -------------------------------------------------------------------------
    # Rule 1: REST_TOO_SHORT
    # -------------------------------------------------------------------------
    for eid, e_sets in sets_by_exercise.items():
        ex = ex_map.get(eid)
        is_compound = bool(_get_val(ex, "is_compound", True))
        if not is_compound:
            continue

        ex_name = str(_get_val(ex, "name", eid))

        # Calculate implicit rest intervals
        rests: List[float] = []
        sets_by_wid: Dict[str, List[Any]] = {}
        for s in e_sets:
            wid = str(_get_val(s, "workout_id", ""))
            sets_by_wid.setdefault(wid, []).append(s)

        dropoffs: List[float] = []
        for wid, w_sets in sets_by_wid.items():
            # Sort chronologically
            sorted_sets = sorted(
                w_sets,
                key=lambda s: _parse_ts(_get_val(s, "created_at")) or datetime.min.replace(tzinfo=timezone.utc),
            )
            # Consecutive rests
            for i in range(1, len(sorted_sets)):
                t_prev = _parse_ts(_get_val(sorted_sets[i - 1], "created_at"))
                t_curr = _parse_ts(_get_val(sorted_sets[i], "created_at"))
                reps_prev = int(_get_val(sorted_sets[i - 1], "reps", 0))
                if t_prev and t_curr:
                    delta_t = (t_curr - t_prev).total_seconds() - (3.0 * reps_prev)
                    if 0.0 <= delta_t <= 1200.0:
                        rests.append(delta_t)

            # Dropoff across non-warmup working sets
            working_sets = [
                s for s in sorted_sets
                if str(_get_val(s, "set_type", "working")).lower() != "warmup"
                and float(_get_val(s, "weight", 0.0)) > 0.0
                and int(_get_val(s, "reps", 0)) > 0
            ]
            if len(working_sets) >= 2:
                w1 = float(_get_val(working_sets[0], "weight", 0.0))
                r1 = int(_get_val(working_sets[0], "reps", 0))
                rir1 = float(_get_val(working_sets[0], "rir", 2.0) or 2.0)
                e1 = w1 * ((r1 + rir1) ** k_t)

                wn = float(_get_val(working_sets[-1], "weight", 0.0))
                rn = int(_get_val(working_sets[-1], "reps", 0))
                rirn = float(_get_val(working_sets[-1], "rir", 2.0) or 2.0)
                en = wn * ((rn + rirn) ** k_t)

                if e1 > 0.0:
                    delta_d = (e1 - en) / (e1 * (len(working_sets) - 1))
                    dropoffs.append(max(0.0, delta_d))

        if rests and dropoffs:
            median_rest = float(np.median(rests))
            mean_drop = float(np.mean(dropoffs))
            if median_rest < REST_TOO_SHORT_MEDIAN_SECONDS and mean_drop > REST_TOO_SHORT_DROPOFF_THRESHOLD:
                audits.append(
                    ProgramParameterAudit(
                        audit_type="REST_TOO_SHORT",
                        severity="WARNING",
                        target_id=eid,
                        target_type="exercise",
                        message=(
                            f"Compound movement '{ex_name}' demonstrates excessive intra-session fatigue drop-off "
                            f"({mean_drop:.1%} > {REST_TOO_SHORT_DROPOFF_THRESHOLD:.1%}) with short inter-set rest "
                            f"(median {median_rest:.0f}s < {REST_TOO_SHORT_MEDIAN_SECONDS:.0f}s)."
                        ),
                        recommended_action=(
                            f"Increase inter-set rest intervals to {REST_TOO_SHORT_RECOMMENDED_SECONDS}s to restore "
                            "ATP/phosphocreatine reserves and maintain high-threshold motor unit recruitment."
                        ),
                        parameter_adjustments={"optimal_rest_seconds": REST_TOO_SHORT_RECOMMENDED_SECONDS},
                    )
                )

    # -------------------------------------------------------------------------
    # Rule 2: JUNK_VOLUME
    # -------------------------------------------------------------------------
    # Tally muscle volume credits and working RPEs
    muscle_volume_sets: Dict[str, float] = {}
    muscle_working_rpes: Dict[str, List[float]] = {}
    muscle_exercise_ids: Dict[str, Set[str]] = {}

    for s in window_sets:
        stype = str(_get_val(s, "set_type", "working")).lower()
        if stype == "warmup":
            continue

        eid = str(_get_val(s, "exercise_id", ""))
        ex = ex_map.get(eid)
        primary_m = str(_get_val(ex, "muscle_group", "Other")).strip().capitalize()
        sec_muscles = _get_val(ex, "secondary_muscles") or []

        # RPE
        rpe_val: Optional[float] = None
        rpe_raw = _get_val(s, "rpe")
        rir_raw = _get_val(s, "rir")
        if rpe_raw is not None:
            rpe_val = float(rpe_raw)
        elif rir_raw is not None:
            rpe_val = max(0.0, 10.0 - float(rir_raw))

        # Credit 1.0 to primary
        muscle_volume_sets[primary_m] = muscle_volume_sets.get(primary_m, 0.0) + 1.0
        muscle_exercise_ids.setdefault(primary_m, set()).add(eid)
        if rpe_val is not None:
            muscle_working_rpes.setdefault(primary_m, []).append(rpe_val)

        # Credit 0.5 to secondaries
        for sm in sec_muscles:
            sm_clean = str(sm).strip().capitalize()
            muscle_volume_sets[sm_clean] = muscle_volume_sets.get(sm_clean, 0.0) + 0.5
            muscle_exercise_ids.setdefault(sm_clean, set()).add(eid)
            if rpe_val is not None:
                muscle_working_rpes.setdefault(sm_clean, []).append(rpe_val)

    # Check each muscle against MAV
    for muscle, total_sets in muscle_volume_sets.items():
        weekly_sets = total_sets / 4.0  # 4 weeks in 28 days

        mav_val = 14.0  # default population prior
        if landmarks_by_muscle and muscle in landmarks_by_muscle:
            lm_obj = landmarks_by_muscle[muscle]
            mav_val = float(_get_val(lm_obj, "mav", 14.0))

        if weekly_sets > mav_val:
            rpes = muscle_working_rpes.get(muscle, [])
            mean_rpe = float(np.mean(rpes)) if rpes else 8.0

            if mean_rpe < JUNK_VOLUME_RPE_CEILING:
                # Check mean e10RM slope across exercises for this muscle
                eids = muscle_exercise_ids.get(muscle, set())
                slopes = [e10rm_slope_by_ex.get(eid, 0.0) for eid in eids]
                mean_slope = float(np.mean(slopes)) if slopes else 0.0

                if mean_slope <= 0.0:
                    audits.append(
                        ProgramParameterAudit(
                            audit_type="JUNK_VOLUME",
                            severity="WARNING",
                            target_id=muscle,
                            target_type="muscle_group",
                            message=(
                                f"Muscle group '{muscle}' is receiving excessive weekly volume "
                                f"({weekly_sets:.1f} sets/wk > MAV {mav_val:.1f}) at sub-hypertrophic intensity "
                                f"(mean {mean_rpe:.1f} RPE < {JUNK_VOLUME_RPE_CEILING}) with stagnant 10RM progress."
                            ),
                            recommended_action=(
                                f"Reduce weekly sets by {int(JUNK_VOLUME_REDUCTION_FACTOR * 100)}% and increase "
                                f"target intensity to {JUNK_VOLUME_RECOMMENDED_RPE_MIN}-{JUNK_VOLUME_RECOMMENDED_RPE_MAX} RPE "
                                "(1-1.5 RIR) to eliminate non-stimulating junk volume."
                            ),
                            parameter_adjustments={
                                "recommended_volume_multiplier": 1.0 - JUNK_VOLUME_REDUCTION_FACTOR,
                                "target_rpe_min": JUNK_VOLUME_RECOMMENDED_RPE_MIN,
                                "target_rpe_max": JUNK_VOLUME_RECOMMENDED_RPE_MAX,
                            },
                        )
                    )

    # -------------------------------------------------------------------------
    # Rule 3: AXIAL_BOTTLENECK
    # -------------------------------------------------------------------------
    if preparedness_series:
        latest_day = preparedness_series[-1]
        fatigue = float(latest_day.fatigue)
        fitness = float(latest_day.fitness)

        if fatigue > AXIAL_FATIGUE_OVER_FITNESS_RATIO * fitness:
            m_readiness = latest_day.muscle_readiness or {}
            for muscle, read_score in m_readiness.items():
                if read_score > AXIAL_LOCAL_READINESS_THRESHOLD:
                    # Calculate barbell volume share for this muscle
                    m_sets = [
                        s for s in window_sets
                        if str(_get_val(s, "set_type", "working")).lower() != "warmup"
                        and str(_get_val(ex_map.get(str(_get_val(s, "exercise_id", ""))), "muscle_group", "")).strip().capitalize() == muscle
                    ]
                    if m_sets:
                        bb_sets = sum(
                            1 for s in m_sets
                            if str(_get_val(ex_map.get(str(_get_val(s, "exercise_id", ""))), "category", "")).strip().lower() == "barbell"
                        )
                        bb_share = bb_sets / float(len(m_sets))
                        if bb_share > AXIAL_BARBELL_VOLUME_SHARE_THRESHOLD:
                            audits.append(
                                ProgramParameterAudit(
                                    audit_type="AXIAL_BOTTLENECK",
                                    severity="WARNING",
                                    target_id=muscle,
                                    target_type="systemic",
                                    message=(
                                        f"Axial fatigue bottleneck detected for '{muscle}': Global systemic fatigue "
                                        f"({fatigue:.1f} > 1.35 * {fitness:.1f}) exceeds fitness capacity despite high "
                                        f"local muscle readiness ({read_score:.1f}% > {AXIAL_LOCAL_READINESS_THRESHOLD:.0f}%), "
                                        f"driven by heavy barbell volume share ({bb_share:.1%} > {AXIAL_BARBELL_VOLUME_SHARE_THRESHOLD:.0%})."
                                    ),
                                    recommended_action=(
                                        "Swap 1 compound Barbell exercise for an equivalent Dumbbell, Machine, or Cable movement "
                                        "to deload spinal compression while preserving high local mechanical tension."
                                    ),
                                    parameter_adjustments={"swap_barbell_for_machine_or_cable": True},
                                )
                            )

    # -------------------------------------------------------------------------
    # Rule 4: REP_MONOTONY
    # -------------------------------------------------------------------------
    for eid, e_sets in sets_by_exercise.items():
        working_reps = [
            int(_get_val(s, "reps", 0))
            for s in e_sets
            if str(_get_val(s, "set_type", "working")).lower() != "warmup"
            and int(_get_val(s, "reps", 0)) > 0
        ]

        if len(working_reps) >= 4:
            counts = Counter(working_reps)
            r_mode, mode_count = counts.most_common(1)[0]
            # Count sets in [r_mode - 1, r_mode + 1]
            band_count = sum(
                cnt for r_val, cnt in counts.items()
                if abs(r_val - r_mode) <= REP_MONOTONY_BAND_DELTA
            )
            band_pct = band_count / float(len(working_reps))

            if band_pct > REP_MONOTONY_PERCENT_THRESHOLD:
                slope = e10rm_slope_by_ex.get(eid, 0.0)
                if slope <= 0.0:
                    ex = ex_map.get(eid)
                    ex_name = str(_get_val(ex, "name", eid))
                    audits.append(
                        ProgramParameterAudit(
                            audit_type="REP_MONOTONY",
                            severity="INFO",
                            target_id=eid,
                            target_type="exercise",
                            message=(
                                f"Exercise '{ex_name}' displays high repetition monotony "
                                f"({band_pct:.1%} of sets clustered within +/- 1 rep of {r_mode} reps) "
                                "with stagnant 10RM progress."
                            ),
                            recommended_action=(
                                "Introduce undulating repetition brackets (e.g., heavy top set of 5-7 reps followed by "
                                "hypertrophy back-off sets of 10-14 reps) to stimulate diverse motor unit recruitment pools."
                            ),
                            parameter_adjustments={
                                "recommended_top_rep_min": 5,
                                "recommended_top_rep_max": 7,
                                "recommended_backoff_rep_min": 10,
                                "recommended_backoff_rep_max": 14,
                            },
                        )
                    )

    return audits

