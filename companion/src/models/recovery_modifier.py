"""Dynamic Recoverability Engine for Workout Suite Companion.

Implements the biological recovery scaling specified in:
- Rough_sketch.md Section 4.4
- IMPLEMENTATION_PLAN.md Step 6.2
- ADR-003: Dynamic Recoverability in Banister Impulse-Response Modeling

Physiological Principles:
    1. Nutritional Energy Balance:
       Athletes in a caloric surplus (positive bodyweight trend) experience enhanced
       glycogen repletion, elevated mTOR signaling, and accelerated protein synthesis,
       shortening fatigue decay constant tau_2 by 10% to 25%.
       Conversely, athletes in a caloric deficit (negative bodyweight trend) suffer from
       suppressed recovery capacity, lengthening tau_2 by 15% to 30%.
    2. Mathematical Formulation:
       Calculates the 14-day rolling Ordinary Least Squares (OLS) slope of bodyweight:
           beta = Cov(t, BW) / Var(t)   [kg / day]
           Delta BW / Delta t = beta * 7.0 [kg / week]
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
import math
from typing import Any, List, Mapping, Optional, Sequence, Tuple, Union

import numpy as np

from src.ingestion.schemas import BodyMetric


# ============================================================================
# Constants & Recovery Scaling Limits (Rough_sketch.md Section 4.4)
# ============================================================================

DEFAULT_TAU2_BASE_DAYS: float = 11.0  # Baseline fatigue decay time constant (days)
DEFAULT_WINDOW_DAYS: int = 14         # Rolling evaluation window for bodyweight slope

# Thresholds for energy balance classification in kg / week
SURPLUS_THRESHOLD_WEEKLY: float = 0.10
DEFICIT_THRESHOLD_WEEKLY: float = -0.10

# Maximum scaling caps:
# - Max surplus shortening: up to 25% (multiplier = 0.75) at +0.5 kg/week
# - Max deficit lengthening: up to 30% (multiplier = 1.30) at -0.5 kg/week
MAX_SURPLUS_SHORTENING: float = 0.25
MAX_DEFICIT_LENGTHENING: float = 0.30
SATURATION_SLOPE_WEEKLY: float = 0.50


# ============================================================================
# Data Structures
# ============================================================================

@dataclass
class RecoveryState:
    """Athlete physiological recovery and energy balance snapshot."""

    slope_kg_per_day: float
    slope_kg_per_week: float
    energy_balance: str  # "SURPLUS" | "DEFICIT" | "MAINTENANCE" | "INSUFFICIENT_DATA"
    tau2_multiplier: float
    effective_tau2: float
    sample_count: int
    as_of_date: str


# ============================================================================
# Helper Functions
# ============================================================================

def _parse_date(d: Union[str, date, datetime]) -> date:
    """Parses ISO date string or datetime into a standard date object."""
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    # String format: YYYY-MM-DD or full ISO timestamp
    if "T" in d:
        return datetime.fromisoformat(d.replace("Z", "+00:00")).date()
    return datetime.strptime(d[:10], "%Y-%m-%d").date()


def _extract_metric_point(point: Union[BodyMetric, Mapping[str, Any], Any]) -> Optional[Tuple[date, float]]:
    """Extracts (date, bodyweight) tuple from diverse input formats."""
    if isinstance(point, Mapping):
        d_val = point.get("date")
        w_val = point.get("bodyweight")
    else:
        d_val = getattr(point, "date", None)
        w_val = getattr(point, "bodyweight", None)

    if d_val is None or w_val is None:
        return None

    try:
        dt = _parse_date(d_val)
        bw = float(w_val)
        if bw <= 0.0 or math.isnan(bw):
            return None
        return (dt, bw)
    except (ValueError, TypeError):
        return None


# ============================================================================
# Core Recoverability Solver
# ============================================================================

def compute_bodyweight_slope(
    metrics: Sequence[Union[BodyMetric, Mapping[str, Any], Any]],
    target_date: Optional[Union[str, date, datetime]] = None,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> Tuple[float, float, int]:
    """Computes the OLS slope of bodyweight over the specified rolling window.

    Returns:
        (slope_kg_per_day, slope_kg_per_week, sample_count)
    """
    if not metrics:
        return (0.0, 0.0, 0)

    # 1. Parse and extract valid points
    parsed_points: List[Tuple[date, float]] = []
    for item in metrics:
        pt = _extract_metric_point(item)
        if pt is not None:
            parsed_points.append(pt)

    if len(parsed_points) < 2:
        return (0.0, 0.0, len(parsed_points))

    # 2. Determine target evaluation date
    if target_date is not None:
        anchor_date = _parse_date(target_date)
    else:
        # Default to the most recent measurement date
        anchor_date = max(p[0] for p in parsed_points)

    start_date = anchor_date - timedelta(days=window_days)

    # 3. Filter points strictly within [anchor_date - window_days, anchor_date]
    window_points = [p for p in parsed_points if start_date <= p[0] <= anchor_date]

    if len(window_points) < 2:
        return (0.0, 0.0, len(window_points))

    # 4. Group by date and average in case of multiple logs on the same day
    daily_weights: dict[date, List[float]] = {}
    for d, w in window_points:
        daily_weights.setdefault(d, []).append(w)

    sorted_dates = sorted(daily_weights.keys())
    if len(sorted_dates) < 2:
        return (0.0, 0.0, len(window_points))

    # Represent time as continuous float days from start_date
    t_vals: List[float] = [(d - start_date).days for d in sorted_dates]
    bw_vals: List[float] = [float(np.mean(daily_weights[d])) for d in sorted_dates]

    t_arr = np.array(t_vals, dtype=np.float64)
    bw_arr = np.array(bw_vals, dtype=np.float64)

    # OLS Linear Regression: beta = slope (kg / day)
    fit_coeffs = np.polyfit(t_arr, bw_arr, deg=1)
    slope_per_day = float(fit_coeffs[0])
    slope_per_week = slope_per_day * 7.0

    return (float(slope_per_day), float(slope_per_week), len(window_points))


def compute_recovery_modifier(
    metrics: Sequence[Union[BodyMetric, Mapping[str, Any], Any]],
    target_date: Optional[Union[str, date, datetime]] = None,
    base_tau2: float = DEFAULT_TAU2_BASE_DAYS,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> RecoveryState:
    """Calculates dynamic recoverability state and scaled fatigue constant tau_2.

    Scaling Rules (ADR-003):
    - Surplus (Delta BW > 0): Shortens tau_2 by 10% to 25% (accelerated recovery).
    - Deficit (Delta BW < 0): Lengthens tau_2 by 15% to 30% (impaired recovery).
    - Maintenance: Multiplier near 1.0 (baseline tau_2).
    """
    if target_date is not None:
        anchor_date_str = _parse_date(target_date).isoformat()
    elif metrics:
        valid_pts = [_extract_metric_point(m) for m in metrics]
        non_null_pts = [p[0] for p in valid_pts if p is not None]
        anchor_date_str = max(non_null_pts).isoformat() if non_null_pts else date.today().isoformat()
    else:
        anchor_date_str = date.today().isoformat()

    slope_per_day, slope_per_week, count = compute_bodyweight_slope(
        metrics=metrics,
        target_date=target_date,
        window_days=window_days,
    )

    if count < 2:
        return RecoveryState(
            slope_kg_per_day=0.0,
            slope_kg_per_week=0.0,
            energy_balance="INSUFFICIENT_DATA",
            tau2_multiplier=1.0,
            effective_tau2=base_tau2,
            sample_count=count,
            as_of_date=anchor_date_str,
        )

    # Classify energy balance
    if slope_per_week >= SURPLUS_THRESHOLD_WEEKLY:
        energy_balance = "SURPLUS"
        # Interpolate shortening between 10% and 25%
        # Saturation slope is SATURATION_SLOPE_WEEKLY (0.5 kg/week)
        ratio = min(1.0, max(0.0, (slope_per_week - SURPLUS_THRESHOLD_WEEKLY) / (SATURATION_SLOPE_WEEKLY - SURPLUS_THRESHOLD_WEEKLY)))
        shortening_fraction = 0.10 + ratio * (MAX_SURPLUS_SHORTENING - 0.10)
        multiplier = 1.0 - shortening_fraction
    elif slope_per_week <= DEFICIT_THRESHOLD_WEEKLY:
        energy_balance = "DEFICIT"
        # Interpolate lengthening between 15% and 30%
        abs_slope = abs(slope_per_week)
        abs_threshold = abs(DEFICIT_THRESHOLD_WEEKLY)
        ratio = min(1.0, max(0.0, (abs_slope - abs_threshold) / (SATURATION_SLOPE_WEEKLY - abs_threshold)))
        lengthening_fraction = 0.15 + ratio * (MAX_DEFICIT_LENGTHENING - 0.15)
        multiplier = 1.0 + lengthening_fraction
    else:
        energy_balance = "MAINTENANCE"
        multiplier = 1.0

    effective_tau2 = base_tau2 * multiplier

    return RecoveryState(
        slope_kg_per_day=round(slope_per_day, 4),
        slope_kg_per_week=round(slope_per_week, 3),
        energy_balance=energy_balance,
        tau2_multiplier=round(multiplier, 4),
        effective_tau2=round(effective_tau2, 2),
        sample_count=count,
        as_of_date=anchor_date_str,
    )
