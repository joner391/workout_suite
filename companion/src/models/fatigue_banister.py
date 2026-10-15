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

    2. Two-Component Impulse-Response Integration:
       Daily Fitness (P) accumulates long-term adaptation with slow decay (tau_1 = 42 d):
           P(t) = P(t-1) * exp(-1 / tau_1) + Stimulus(t)
       Daily Fatigue (F) accumulates acute exhaustion with fast, dynamically modulated
       decay (dynamic tau_2 ~ 7 to 14 d):
           F(t) = F(t-1) * exp(-1 / tau_2(t)) + Stimulus(t)
       Net Preparedness represents athletic readiness:
           Preparedness(t) = k_1 * P(t) - k_2 * F(t)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
import math
from typing import Any, Dict, List, Mapping, Optional, Sequence, Union

from src.ingestion.schemas import BodyMetric, Workout, WorkoutSet
from src.models.recovery_modifier import (
    DEFAULT_TAU2_BASE_DAYS,
    RecoveryState,
    compute_recovery_modifier,
)


# ============================================================================
# Constants & Hyperparameters (Rough_sketch.md Section 4.3)
# ============================================================================

DEFAULT_TAU1_DAYS: float = 42.0     # Long-term fitness adaptation time constant
DEFAULT_K1: float = 1.0            # Fitness magnitude scaling factor
DEFAULT_K2: float = 2.0            # Acute fatigue magnitude scaling factor
MIN_STIMULATING_RPE: float = 7.0   # Exertion threshold (sets below this are non-stimulating)


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


def calculate_set_stimulus(
    set_obj: Union[WorkoutSet, Mapping[str, Any], Any],
    known_1rm: Optional[float] = None,
) -> float:
    """Computes Effective Stimulating Set stimulus.

    Formula (Rough_sketch.md §4.2):
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


# ============================================================================
# Banister Integration Engine
# ============================================================================

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
) -> List[DailyPreparedness]:
    """Integrates the two-component Banister fitness-fatigue differential equations.

    Steps:
    1. Aggregates workout sets into session stimulus scores.
    2. Maps session stimulus scores into calendar days.
    3. Traverses daily from start_date to end_date.
    4. Computes daily dynamic tau_2 from 14-day rolling bodyweight slope.
    5. Recursively integrates Fitness P(t) and Fatigue F(t).
    6. Computes Net Preparedness(t) = k1 * P(t) - k2 * F(t).
    """
    if not workouts and not workout_sets:
        return []

    # 1. Map workout_id to date
    workout_dates: Dict[str, str] = {}
    for w in workouts:
        wid = str(_get_val(w, "id", ""))
        d_val = _get_val(w, "date", None)
        if wid and d_val:
            workout_dates[wid] = _parse_date_str(d_val)

    # 2. Compute stimulus per set and group by date
    daily_stimulus: Dict[str, float] = {}
    for s in workout_sets:
        wid = str(_get_val(s, "workout_id", ""))
        set_date = workout_dates.get(wid)
        if not set_date:
            created_at = _get_val(s, "created_at", None)
            if created_at:
                set_date = _parse_date_str(created_at)

        if not set_date:
            continue

        ex_id = str(_get_val(s, "exercise_id", ""))
        ex_1rm = known_1rms.get(ex_id) if known_1rms else None
        stim = calculate_set_stimulus(s, known_1rm=ex_1rm)

        daily_stimulus[set_date] = daily_stimulus.get(set_date, 0.0) + stim

    if not daily_stimulus:
        return []

    # 3. Determine calendar boundaries
    all_logged_dates = sorted(daily_stimulus.keys())
    earliest_date = datetime.strptime(all_logged_dates[0], "%Y-%m-%d").date()
    latest_date = datetime.strptime(all_logged_dates[-1], "%Y-%m-%d").date()

    if start_date is not None:
        first_date = datetime.strptime(_parse_date_str(start_date), "%Y-%m-%d").date()
    else:
        first_date = earliest_date

    if end_date is not None:
        last_date = datetime.strptime(_parse_date_str(end_date), "%Y-%m-%d").date()
    else:
        last_date = latest_date

    if first_date > last_date:
        return []

    # 4. Integrate day-by-day
    series: List[DailyPreparedness] = []
    curr_fitness: float = 0.0
    curr_fatigue: float = 0.0
    decay_p = math.exp(-1.0 / tau1)

    total_days = (last_date - first_date).days + 1
    for day_offset in range(total_days):
        curr_dt = first_date + timedelta(days=day_offset)
        curr_date_str = curr_dt.isoformat()

        # Stimulus today (0.0 on rest days)
        stim_today = daily_stimulus.get(curr_date_str, 0.0)

        # Dynamic recoverability for today
        rec_state: RecoveryState = compute_recovery_modifier(
            metrics=body_metrics,
            target_date=curr_dt,
            base_tau2=base_tau2,
        )
        eff_tau2 = rec_state.effective_tau2
        decay_f = math.exp(-1.0 / eff_tau2)

        # Discrete Banister state recursion
        curr_fitness = curr_fitness * decay_p + stim_today
        curr_fatigue = curr_fatigue * decay_f + stim_today
        curr_preparedness = (k1 * curr_fitness) - (k2 * curr_fatigue)

        series.append(
            DailyPreparedness(
                date=curr_date_str,
                stimulus=round(stim_today, 3),
                fitness=round(curr_fitness, 3),
                fatigue=round(curr_fatigue, 3),
                preparedness=round(curr_preparedness, 3),
                tau2=round(eff_tau2, 2),
                energy_balance=rec_state.energy_balance,
            )
        )

    return series
