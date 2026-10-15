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

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence

from src.models.fatigue_banister import DailyPreparedness


# ============================================================================
# Constants & Thresholds (Rough_sketch.md Section 4.5)
# ============================================================================

ACWR_ACUTE_WINDOW_DAYS: int = 7
ACWR_CHRONIC_WINDOW_DAYS: int = 28

ACWR_UNDER_STIMULATION_THRESHOLD: float = 0.80
ACWR_OPTIMAL_MAX_THRESHOLD: float = 1.30
ACWR_DELOAD_THRESHOLD: float = 1.50


# ============================================================================
# Data Structures
# ============================================================================

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
