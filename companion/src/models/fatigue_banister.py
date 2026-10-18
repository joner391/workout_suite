"""Banister Two-Component Impulse-Response Engine for Workout Suite Companion.

Implements the stimulus, fitness, fatigue, and net preparedness ODE modeling specified in:
- Rough_sketch.md Section 4.2 & Section 4.3
- IMPLEMENTATION_PLAN.md Step 6.2
- ADR-003: Dynamic Recoverability in Banister Impulse-Response Modeling

Mathematical Foundations:
    1. Training Stimulus Quantification:
       Raw sets and tonnage overestimate submaximal junk volume. Effective stimulus
       weights each working set by proximity to failure (RPE >= 7.0 / RIR <= 3.0) and
       relative load (weight / 1RM):
           Stimulus_set = (1.0 + (eff_rpe - 7.0) / 3.0) * (weight / 1RM)

    2. Diminishing Returns & Scale-Invariant EWMA:
       Exponential saturation per exercise movement (kappa_ex = 4.0) prevents junk
       volume explosion. Session impulses are bounded to [0, 100].
       Unit-gain Exponentially Weighted Moving Average (EWMA) discretization guarantees
       both Fitness P(t) and Fatigue F(t) remain strictly within [0, 100]:
           P(t) = P(t-1) * exp(-1 / tau_1) + (1 - exp(-1 / tau_1)) * S_fitness(t)
           F(t) = F(t-1) * exp(-1 / tau_2(t)) + (1 - exp(-1 / tau_2(t))) * S_fatigue(t)
       Net Preparedness represents athletic readiness:
           Preparedness(t) = k_1 * P(t) - k_2 * F(t)  (in [-100, +100])
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
import math
from typing import Any, Dict, List, Mapping, Optional, Sequence, Union

from src.ingestion.schemas import BodyMetric, Exercise, Workout, WorkoutSet
from src.models.recovery_modifier import (
    DEFAULT_TAU2_BASE_DAYS,
    RecoveryState,
    compute_recovery_modifier,
)


# ============================================================================
# Constants & Hyperparameters
# ============================================================================

DEFAULT_TAU1_DAYS: float = 42.0          # Long-term fitness adaptation time constant
DEFAULT_K1: float = 1.0                  # Fitness weight in unit-gain EWMA
DEFAULT_K2: float = 1.25                 # Fatigue weight in unit-gain EWMA
MIN_STIMULATING_RPE: float = 7.0         # Exertion threshold

EXERCISE_SATURATION_KAPPA: float = 4.0   # Diminishing returns per exercise (~4 hard sets)
SESSION_FITNESS_KAPPA: float = 10.0      # Whole-session saturation for fitness impulse
SESSION_FATIGUE_KAPPA: float = 14.0      # Whole-session saturation for fatigue impulse
MAX_DAILY_IMPULSE: float = 100.0         # Bounded 0-100 daily stimulus scale


# ============================================================================
# Data Structures
# ============================================================================

@dataclass
class SetStimulus:
    """Evaluated stimulus contribution of an individual working set."""

    set_id: Optional[str]
    exercise_id: str
    weight: float
    reps: int
    eff_rpe: float
    intensity_ratio: float  # weight / 1RM
    exertion_scalar: float  # 1.0 + (eff_rpe - 7) / 3
    stimulus: float


@dataclass
class DailyPreparedness:
    """Athletic fitness, fatigue, and net readiness snapshot for a single calendar date."""

    date: str
    stimulus: float
    fitness: float
    fatigue: float
    preparedness: float
    tau2: float
    energy_balance: str
    readiness: Optional[float] = None
    muscle_readiness: Optional[Dict[str, float]] = None

    def __post_init__(self) -> None:
        if self.readiness is None:
            scale = max(12.0, 0.35 * self.fitness)
            self.readiness = round(float(100.0 / (1.0 + math.exp(-self.preparedness / scale))), 2)


# ============================================================================
# Pure Helper Functions
# ============================================================================

def _parse_date_str(d: Union[str, date, datetime]) -> str:
    """Normalizes any date or ISO string into YYYY-MM-DD format."""
    if isinstance(d, datetime):
        return d.date().isoformat()
    if isinstance(d, date):
        return d.isoformat()
    return d[:10]


def _get_val(obj: Any, key: str, default: Any = None) -> Any:
    """Safe attribute/dict accessor."""
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def calculate_readiness_score(preparedness: float, fitness: float) -> float:
    """Maps net preparedness to a normalized 0-100 readiness score via logistic transform."""
    scale = max(12.0, 0.35 * fitness)
    return float(100.0 / (1.0 + math.exp(-preparedness / scale)))


def is_amrap_set(obj: Any) -> bool:
    """Returns True if a workout set is designated as an AMRAP or failure set.

    AMRAP sets ("As Many Reps As Possible") are performed until muscular failure,
    corresponding to RPE 10.0 (0 RIR).
    """
    set_type = str(_get_val(obj, "set_type", "")).lower()
    if set_type in ("amrap", "failure"):
        return True
    if bool(_get_val(obj, "is_amrap", False)):
        return True
    notes = str(
        _get_val(obj, "set_notes", _get_val(obj, "notes", "")) or ""
    ).lower()
    return "amrap" in notes


def calculate_set_stimulus(
    set_obj: Union[WorkoutSet, Mapping[str, Any], Any],
    known_1rm: Optional[float] = None,
    default_working_rpe: Optional[float] = None,
) -> float:
    """Computes Effective Stimulating Set stimulus.

    Formula:
        Stimulus = (1.0 + (eff_rpe - 7.0) / 3.0) * (weight / 1RM)
    Invariants:
        - Sets with completed reps <= 0 or load <= 0 return 0.0.
        - Sets with set_type == 'warmup' return 0.0.
        - Sets with eff_rpe < 7.0 (or RIR > 3.0) return 0.0 (non-stimulating).
        - If known_1rm is absent, estimates 1RM via Lombardi power law:
          1RM ~ weight * (reps + (10 - eff_rpe))^0.10
    """
    reps_raw = _get_val(set_obj, "reps", 0)
    weight_raw = _get_val(set_obj, "weight", 0.0)
    set_type_raw = str(_get_val(set_obj, "set_type", "working")).lower()
    rpe_raw = _get_val(set_obj, "rpe", None)
    rir_raw = _get_val(set_obj, "rir", None)

    if reps_raw is None or weight_raw is None:
        return 0.0

    try:
        reps = int(reps_raw)
        weight = float(weight_raw)
    except (ValueError, TypeError):
        return 0.0

    if reps <= 0 or weight <= 0.0:
        return 0.0

    if set_type_raw == "warmup":
        return 0.0

    # Resolve effective RPE
    eff_rpe: Optional[float] = None
    if rpe_raw is not None:
        try:
            val = float(rpe_raw)
            if not math.isnan(val):
                eff_rpe = val
        except (ValueError, TypeError):
            pass
    elif rir_raw is not None:
        try:
            val = float(rir_raw)
            if not math.isnan(val):
                eff_rpe = max(0.0, 10.0 - val)
        except (ValueError, TypeError):
            pass
    elif is_amrap_set(set_obj):
        # AMRAP sets are by definition performed to failure (RPE 10.0 / 0 RIR)
        eff_rpe = 10.0
    elif default_working_rpe is not None and set_type_raw != "warmup":
        eff_rpe = max(0.0, float(default_working_rpe))

    if eff_rpe is None or eff_rpe < MIN_STIMULATING_RPE:
        return 0.0

    # Resolve 1RM
    if known_1rm is not None and known_1rm > 0.0:
        e1rm = known_1rm
    else:
        # Lombardi fallback: 1RM = weight * r_eff^0.10
        r_eff = max(1.0, float(reps) + max(0.0, 10.0 - eff_rpe))
        e1rm = weight * (r_eff ** 0.10)

    # Relative load ratio (weight / 1RM), clamped <= 1.05
    intensity_ratio = min(1.05, weight / e1rm)

    # Exertion scalar: 1.0 at RPE 7; 1.5 at RPE 8.5; 2.0 at RPE 10
    exertion_scalar = 1.0 + (eff_rpe - 7.0) / 3.0

    return float(exertion_scalar * intensity_ratio)


def calculate_hypertrophic_effective_reps(
    set_obj: Union[WorkoutSet, Mapping[str, Any], Any],
    known_1rm: Optional[float] = None,
) -> float:
    """Computes hypertrophic effective reps (0.0 to 5.0) for a given set.

    Invariants:
        - reps <= 0 or load <= 0 returns 0.0.
        - set_type == 'warmup' returns 0.0.
        - auto-failure set types ('amrap', 'dc', 'myorep', 'drop') return min(reps, 5.0).
        - unrated sets (missing RPE & RIR) return 0.0.
        - heavy loads (weight / 1RM >= 0.85) return min(reps, 5.0).
        - submaximal sets return max(0.0, min(reps, 5.0 - eff_rir)).
    """
    reps_raw = _get_val(set_obj, "reps", 0)
    weight_raw = _get_val(set_obj, "weight", 0.0)
    set_type_raw = str(_get_val(set_obj, "set_type", "working")).lower()
    rpe_raw = _get_val(set_obj, "rpe", None)
    rir_raw = _get_val(set_obj, "rir", None)

    try:
        reps = int(reps_raw)
        weight = float(weight_raw)
    except (ValueError, TypeError):
        return 0.0

    if reps <= 0 or weight <= 0.0 or set_type_raw == "warmup":
        return 0.0

    if set_type_raw in ("amrap", "dc", "myorep", "drop", "failure") or is_amrap_set(set_obj):
        return float(min(reps, 5))

    has_rpe = rpe_raw is not None
    has_rir = rir_raw is not None

    if not has_rpe and not has_rir:
        return 0.0

    eff_rir = 0.0
    if has_rir:
        try:
            eff_rir = max(0.0, float(rir_raw))
        except (ValueError, TypeError):
            return 0.0
    elif has_rpe:
        try:
            eff_rir = max(0.0, 10.0 - float(rpe_raw))
        except (ValueError, TypeError):
            return 0.0

    if known_1rm is not None and known_1rm > 0.0:
        if (weight / known_1rm) >= 0.85:
            return float(min(reps, 5))

    return float(max(0.0, min(reps, round(5.0 - eff_rir))))


# ============================================================================
# Banister Integration Engine
# ============================================================================

def compute_systemic_fatigue_multiplier(
    category: Optional[str],
    is_compound: Union[bool, int, None],
) -> float:
    """Calculates category-weighted systemic axial fatigue multiplier m_sys.

    Rules:
        - Barbell + is_compound == 1: m_sys = 1.35
        - Dumbbell / Bodyweight + is_compound == 1: m_sys = 1.00
        - Machine / Cable or is_compound == 0: m_sys = 0.65
    """
    cat = str(category or "").strip().lower()
    compound = bool(is_compound)

    if not compound:
        return 0.65

    if cat == "barbell":
        return 1.35
    if cat in ("dumbbell", "bodyweight"):
        return 1.00
    if cat in ("machine", "cable"):
        return 0.65

    return 1.00


def compute_daily_banister_series(
    workouts: Sequence[Union[Workout, Mapping[str, Any], Any]],
    workout_sets: Sequence[Union[WorkoutSet, Mapping[str, Any], Any]],
    body_metrics: Sequence[Union[BodyMetric, Mapping[str, Any], Any]] = (),
    known_1rms: Optional[Mapping[str, float]] = None,
    tau1: float = DEFAULT_TAU1_DAYS,
    base_tau2: float = DEFAULT_TAU2_BASE_DAYS,
    k1: float = DEFAULT_K1,
    k2: float = DEFAULT_K2,
    start_date: Optional[Union[str, date]] = None,
    end_date: Optional[Union[str, date]] = None,
    default_working_rpe: Optional[float] = None,
    exercises: Optional[Sequence[Union[Exercise, Mapping[str, Any], Any]]] = None,
) -> List[DailyPreparedness]:
    """Integrates normalized unit-gain Banister fitness-fatigue differential equations."""
    if not workouts and not workout_sets:
        return []

    # Map exercise metadata for category-weighted systemic fatigue and muscle routing
    ex_metadata_map: Dict[str, Any] = {}
    m_sys_map: Dict[str, float] = {}
    if exercises:
        for ex in exercises:
            eid = str(_get_val(ex, "id", ""))
            if eid:
                ex_metadata_map[eid] = ex
                cat = _get_val(ex, "category", "Barbell")
                compound = _get_val(ex, "is_compound", True)
                m_sys_map[eid] = compute_systemic_fatigue_multiplier(cat, compound)

    workout_dates: Dict[str, str] = {}
    for w in workouts:
        wid = str(_get_val(w, "id", ""))
        d_val = _get_val(w, "date", None)
        if wid and d_val:
            workout_dates[wid] = _parse_date_str(d_val)

    # Group raw stimulus by (date, exercise_id) for diminishing returns
    daily_ex_stimulus: Dict[str, Dict[str, float]] = {d: {} for d in workout_dates.values()}
    # Also track daily localized muscle stimulus if exercises provided
    daily_muscle_stimulus: Dict[str, Dict[str, float]] = {}

    for s in workout_sets:
        wid = str(_get_val(s, "workout_id", ""))
        set_date = workout_dates.get(wid)
        if not set_date:
            created_at = _get_val(s, "created_at", None)
            if created_at:
                set_date = _parse_date_str(created_at)
        if not set_date:
            continue

        day_map = daily_ex_stimulus.setdefault(set_date, {})
        ex_id = str(_get_val(s, "exercise_id", "unknown"))
        ex_1rm = known_1rms.get(ex_id) if known_1rms else None
        stim = calculate_set_stimulus(
            s,
            known_1rm=ex_1rm,
            default_working_rpe=default_working_rpe,
        )
        if stim > 0.0:
            day_map[ex_id] = day_map.get(ex_id, 0.0) + stim

            if exercises and ex_id in ex_metadata_map:
                ex_obj = ex_metadata_map[ex_id]
                prim = str(_get_val(ex_obj, "muscle_group", "")).strip()
                sec_list = _get_val(ex_obj, "secondary_muscles", []) or []

                m_day = daily_muscle_stimulus.setdefault(set_date, {})
                if prim:
                    m_day[prim] = m_day.get(prim, 0.0) + stim
                for sec_m in sec_list:
                    if sec_m and sec_m != prim:
                        m_day[sec_m] = m_day.get(sec_m, 0.0) + 0.5 * stim

    if not daily_ex_stimulus:
        return []

    all_logged_dates = sorted(daily_ex_stimulus.keys())
    earliest_date = datetime.strptime(all_logged_dates[0], "%Y-%m-%d").date()
    latest_date = datetime.strptime(all_logged_dates[-1], "%Y-%m-%d").date()

    first_date = (
        datetime.strptime(_parse_date_str(start_date), "%Y-%m-%d").date()
        if start_date is not None
        else earliest_date
    )
    last_date = (
        datetime.strptime(_parse_date_str(end_date), "%Y-%m-%d").date()
        if end_date is not None
        else latest_date
    )
    if first_date > last_date:
        return []

    series: List[DailyPreparedness] = []
    curr_fitness: float = 0.0
    curr_fatigue: float = 0.0
    decay_p = math.exp(-1.0 / tau1)
    alpha_p = 1.0 - decay_p

    # Localized muscle state vectors if exercises provided
    curr_muscle_fit: Dict[str, float] = {}
    curr_muscle_fat: Dict[str, float] = {}
    all_muscles_set: set[str] = set()
    if exercises:
        for m_day in daily_muscle_stimulus.values():
            all_muscles_set.update(m_day.keys())
        curr_muscle_fit = {m: 0.0 for m in all_muscles_set}
        curr_muscle_fat = {m: 0.0 for m in all_muscles_set}

    total_days = (last_date - first_date).days + 1
    for day_offset in range(total_days):
        curr_dt = first_date + timedelta(days=day_offset)
        curr_date_str = curr_dt.isoformat()

        ex_map = daily_ex_stimulus.get(curr_date_str, {})
        if ex_map:
            # Diminishing returns per exercise, then session-level saturation in [0, 100]
            eff_ex_sum = sum(
                EXERCISE_SATURATION_KAPPA * (1.0 - math.exp(-raw / EXERCISE_SATURATION_KAPPA))
                for raw in ex_map.values()
            )
            # Apply category-weighted systemic fatigue multiplier m_sys if exercises provided
            if exercises and m_sys_map:
                raw_fatigue_total = sum(
                    raw * m_sys_map.get(ex_id, 1.0)
                    for ex_id, raw in ex_map.items()
                )
            else:
                raw_fatigue_total = sum(ex_map.values())

            fit_impulse = MAX_DAILY_IMPULSE * (
                1.0 - math.exp(-eff_ex_sum / SESSION_FITNESS_KAPPA)
            )
            fat_impulse = MAX_DAILY_IMPULSE * (
                1.0 - math.exp(-raw_fatigue_total / SESSION_FATIGUE_KAPPA)
            )
        else:
            fit_impulse = 0.0
            fat_impulse = 0.0

        rec_state: RecoveryState = compute_recovery_modifier(
            metrics=body_metrics,
            target_date=curr_dt,
            base_tau2=base_tau2,
        )
        eff_tau2 = rec_state.effective_tau2
        decay_f = math.exp(-1.0 / eff_tau2)
        alpha_f = 1.0 - decay_f

        # Unit-gain EWMA recursion: strictly bounds P(t) and F(t) within [0, 100]
        curr_fitness = (curr_fitness * decay_p) + (alpha_p * fit_impulse)
        curr_fatigue = (curr_fatigue * decay_f) + (alpha_f * fat_impulse)
        curr_preparedness = (k1 * curr_fitness) - (k2 * curr_fatigue)

        # Localized muscle readiness calculation if exercises provided
        muscle_readiness_snapshot: Optional[Dict[str, float]] = None
        if exercises and all_muscles_set:
            eff_tau2_local = 0.65 * eff_tau2
            decay_f_local = math.exp(-1.0 / eff_tau2_local)
            alpha_f_local = 1.0 - decay_f_local

            m_day_map = daily_muscle_stimulus.get(curr_date_str, {})
            muscle_readiness_snapshot = {}
            for m in all_muscles_set:
                raw_m_stim = m_day_map.get(m, 0.0)
                sat_m_stim = 100.0 * (1.0 - math.exp(-raw_m_stim / 4.0)) if raw_m_stim > 0.0 else 0.0
                curr_muscle_fit[m] = (curr_muscle_fit[m] * decay_p) + (alpha_p * sat_m_stim)
                curr_muscle_fat[m] = (curr_muscle_fat[m] * decay_f_local) + (alpha_f_local * sat_m_stim)

                prep_m = (k1 * curr_muscle_fit[m]) - (k2 * curr_muscle_fat[m])
                scale_m = max(12.0, 0.35 * curr_muscle_fit[m])
                r_score = 100.0 / (1.0 + math.exp(-prep_m / scale_m))
                muscle_readiness_snapshot[m] = round(r_score, 1)

        series.append(
            DailyPreparedness(
                date=curr_date_str,
                stimulus=round(fit_impulse, 2),
                fitness=round(curr_fitness, 2),
                fatigue=round(curr_fatigue, 2),
                preparedness=round(curr_preparedness, 2),
                tau2=round(eff_tau2, 2),
                energy_balance=rec_state.energy_balance,
                muscle_readiness=muscle_readiness_snapshot,
            )
        )

    return series
