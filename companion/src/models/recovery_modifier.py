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
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple, Union

import numpy as np

from pydantic import BaseModel, ConfigDict, Field
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

# Anthropometric Partitioning (P-Ratio Proxy) Constants
DEFAULT_PRATIO_WINDOW_DAYS: int = 28
CALORIC_OVERSHOOT_BW_SLOPE_THRESHOLD: float = 0.35      # kg / week (+0.35 kg/wk)
CALORIC_OVERSHOOT_WAIST_SLOPE_THRESHOLD: float = 0.20   # cm / week (+0.20 cm/wk)
CALORIC_OVERSHOOT_LEAN_PARTITION_RATIO: float = 0.45    # beta_eLBM / beta_BW < 0.45


# ============================================================================
# Data Structures
# ============================================================================

class PRatioPartitioningResult(BaseModel):
    """Anthropometric body composition partitioning (P-Ratio proxy) evaluation."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    as_of_date: str
    window_days: int = Field(default=DEFAULT_PRATIO_WINDOW_DAYS, ge=1)
    sample_count: int = Field(ge=0)
    beta_bw_kg_per_week: float = Field(description="28-day OLS rate of change of bodyweight in kg/wk.")
    beta_waist_cm_per_week: Optional[float] = Field(
        default=None,
        description="28-day OLS rate of change of waist circumference in cm/wk.",
    )
    beta_bf_pct_per_week: Optional[float] = Field(
        default=None,
        description="28-day OLS rate of change of body fat percentage in %/wk.",
    )
    beta_limb_cm_per_week: Optional[float] = Field(
        default=None,
        description="28-day OLS rate of change of aggregate limb girth in cm/wk.",
    )
    beta_elbm_kg_per_week: Optional[float] = Field(
        default=None,
        description="28-day OLS rate of change of estimated Lean Body Mass in kg/wk.",
    )
    p_ratio_proxy: Optional[float] = Field(
        default=None,
        description="Lean-mass partitioning ratio (beta_eLBM / beta_BW).",
    )
    is_caloric_overshoot: bool = Field(
        description="True if beta_BW > +0.35 kg/wk AND (beta_waist > +0.20 cm/wk OR P-ratio < 0.45).",
    )
    message: str = Field(description="Clinical and actionable dietary recommendation message.")


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
    p_ratio: Optional[PRatioPartitioningResult] = None


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

    # Evaluate body composition partitioning (P-Ratio proxy)
    p_ratio_eval: Optional[PRatioPartitioningResult] = None
    if metrics:
        try:
            p_ratio_eval = compute_body_composition_partitioning(
                metrics=metrics,
                target_date=target_date,
                window_days=DEFAULT_PRATIO_WINDOW_DAYS,
            )
        except Exception:
            p_ratio_eval = None

    return RecoveryState(
        slope_kg_per_day=round(slope_per_day, 4),
        slope_kg_per_week=round(slope_per_week, 3),
        energy_balance=energy_balance,
        tau2_multiplier=round(multiplier, 4),
        effective_tau2=round(effective_tau2, 2),
        sample_count=count,
        as_of_date=anchor_date_str,
        p_ratio=p_ratio_eval,
    )


# ============================================================================
# Core Implementation 2: Anthropometric Partitioning (P-Ratio Proxy)
# ============================================================================

def compute_body_composition_partitioning(
    metrics: Sequence[Union[BodyMetric, Mapping[str, Any], Any]],
    target_date: Optional[Union[str, date, datetime]] = None,
    window_days: int = DEFAULT_PRATIO_WINDOW_DAYS,
) -> PRatioPartitioningResult:
    """Computes 28-day rolling OLS slopes for bodyweight, waist circumference,

    body fat %, limb girths, and lean body mass partitioning (P-Ratio proxy).

    Flags CALORIC_OVERSHOOT if:
        beta_BW > +0.35 kg/wk AND (beta_waist > +0.20 cm/wk OR beta_eLBM / beta_BW < 0.45)
    """
    if target_date is not None:
        anchor_date = _parse_date(target_date)
    else:
        anchor_date = date.today()

    if not metrics:
        return PRatioPartitioningResult(
            as_of_date=anchor_date.isoformat(),
            window_days=window_days,
            sample_count=0,
            beta_bw_kg_per_week=0.0,
            is_caloric_overshoot=False,
            message="No body metric data available for P-ratio evaluation.",
        )

    # 1. Parse and extract valid metric points
    parsed_entries: List[Tuple[date, Dict[str, float]]] = []
    for item in metrics:
        if isinstance(item, Mapping):
            d_val = item.get("date")
        else:
            d_val = getattr(item, "date", None)

        if not d_val:
            continue

        try:
            dt = _parse_date(d_val)
        except Exception:
            continue

        entry: Dict[str, float] = {}
        for k in (
            "bodyweight",
            "waist_cm",
            "navy_body_fat",
            "body_fat_manual",
            "bicep_cm",
            "chest_cm",
            "thigh_cm",
            "calf_cm",
        ):
            val = item.get(k) if isinstance(item, Mapping) else getattr(item, k, None)
            if val is not None:
                try:
                    fval = float(val)
                    if not math.isnan(fval) and fval > 0.0:
                        entry[k] = fval
                except (ValueError, TypeError):
                    pass

        if entry:
            parsed_entries.append((dt, entry))

    if not parsed_entries:
        return PRatioPartitioningResult(
            as_of_date=anchor_date.isoformat(),
            window_days=window_days,
            sample_count=0,
            beta_bw_kg_per_week=0.0,
            is_caloric_overshoot=False,
            message="No valid anthropometric records found.",
        )

    # If target_date wasn't explicit, anchor to latest measurement date
    if target_date is None:
        anchor_date = max(p[0] for p in parsed_entries)

    start_date = anchor_date - timedelta(days=window_days)
    window_entries = [p for p in parsed_entries if start_date <= p[0] <= anchor_date]

    if len(window_entries) < 2:
        return PRatioPartitioningResult(
            as_of_date=anchor_date.isoformat(),
            window_days=window_days,
            sample_count=len(window_entries),
            beta_bw_kg_per_week=0.0,
            is_caloric_overshoot=False,
            message=f"Insufficient body composition points ({len(window_entries)}) in the {window_days}-day window.",
        )

    # Group by date and average in case of duplicate entries
    by_date: Dict[date, Dict[str, List[float]]] = {}
    for dt, entry in window_entries:
        d_dict = by_date.setdefault(dt, {})
        for k, v in entry.items():
            d_dict.setdefault(k, []).append(v)

    sorted_dates = sorted(by_date.keys())
    if len(sorted_dates) < 2:
        return PRatioPartitioningResult(
            as_of_date=anchor_date.isoformat(),
            window_days=window_days,
            sample_count=len(window_entries),
            beta_bw_kg_per_week=0.0,
            is_caloric_overshoot=False,
            message=f"Insufficient distinct measurement days ({len(sorted_dates)}) in the {window_days}-day window.",
        )

    t_days: List[float] = [(d - start_date).days for d in sorted_dates]

    def _calc_slope(t_sub: List[float], y_sub: List[float]) -> Optional[float]:
        if len(t_sub) < 2:
            return None
        t_arr = np.asarray(t_sub, dtype=np.float64)
        y_arr = np.asarray(y_sub, dtype=np.float64)
        var_t = float(np.var(t_arr))
        if var_t <= 1e-12:
            return None
        cov_ty = float(np.cov(t_arr, y_arr, bias=True)[0, 1])
        slope_per_day = cov_ty / var_t
        return float(slope_per_day * 7.0)  # Convert to per-week rate

    # 1. Bodyweight slope (beta_BW)
    t_bw: List[float] = []
    y_bw: List[float] = []
    for d, t in zip(sorted_dates, t_days):
        bw_vals = by_date[d].get("bodyweight")
        if bw_vals:
            t_bw.append(t)
            y_bw.append(float(np.mean(bw_vals)))
    beta_bw_val = _calc_slope(t_bw, y_bw)
    beta_bw = beta_bw_val if beta_bw_val is not None else 0.0

    # 2. Waist circumference slope (beta_waist)
    t_waist: List[float] = []
    y_waist: List[float] = []
    for d, t in zip(sorted_dates, t_days):
        w_vals = by_date[d].get("waist_cm")
        if w_vals:
            t_waist.append(t)
            y_waist.append(float(np.mean(w_vals)))
    beta_waist = _calc_slope(t_waist, y_waist)

    # 3. Body Fat % (prefer navy_body_fat, fallback to body_fat_manual)
    t_bf: List[float] = []
    y_bf: List[float] = []
    for d, t in zip(sorted_dates, t_days):
        d_vals = by_date[d]
        bf_vals = d_vals.get("navy_body_fat") or d_vals.get("body_fat_manual")
        if bf_vals:
            t_bf.append(t)
            y_bf.append(float(np.mean(bf_vals)))
    beta_bf = _calc_slope(t_bf, y_bf)

    # 4. Limb girths G_limb = bicep + chest + thigh + calf
    t_limb: List[float] = []
    y_limb: List[float] = []
    for d, t in zip(sorted_dates, t_days):
        d_vals = by_date[d]
        limb_parts = [
            float(np.mean(d_vals[k]))
            for k in ("bicep_cm", "chest_cm", "thigh_cm", "calf_cm")
            if k in d_vals
        ]
        if limb_parts:
            t_limb.append(t)
            y_limb.append(sum(limb_parts))
    beta_limb = _calc_slope(t_limb, y_limb)

    # 5. Estimated Lean Body Mass eLBM_i = BW_i * (1 - BF_i / 100)
    t_lbm: List[float] = []
    y_lbm: List[float] = []
    for d, t in zip(sorted_dates, t_days):
        d_vals = by_date[d]
        bw_vals = d_vals.get("bodyweight")
        bf_vals = d_vals.get("navy_body_fat") or d_vals.get("body_fat_manual")
        if bw_vals and bf_vals:
            bw_m = float(np.mean(bw_vals))
            bf_m = float(np.mean(bf_vals))
            elbm = bw_m * (1.0 - (bf_m / 100.0))
            if elbm > 0.0:
                t_lbm.append(t)
                y_lbm.append(elbm)
    beta_elbm = _calc_slope(t_lbm, y_lbm)

    # 6. P-Ratio proxy = beta_eLBM / beta_BW
    p_ratio: Optional[float] = None
    if beta_bw > 0.05 and beta_elbm is not None:
        p_ratio = round(beta_elbm / beta_bw, 3)

    # 7. Evaluate CALORIC_OVERSHOOT condition:
    # beta_BW > +0.35 kg/wk AND (beta_waist > +0.20 cm/wk OR (beta_BW > 0 AND beta_eLBM / beta_BW < 0.45))
    is_overshoot = False
    reasons: List[str] = []

    if beta_bw > CALORIC_OVERSHOOT_BW_SLOPE_THRESHOLD:
        waist_trigger = (
            beta_waist is not None
            and beta_waist > CALORIC_OVERSHOOT_WAIST_SLOPE_THRESHOLD
        )
        pratio_trigger = (
            p_ratio is not None
            and p_ratio < CALORIC_OVERSHOOT_LEAN_PARTITION_RATIO
        )

        if waist_trigger or pratio_trigger:
            is_overshoot = True
            if waist_trigger and beta_waist is not None:
                reasons.append(
                    f"waist growth of +{beta_waist:.2f} cm/wk exceeds +{CALORIC_OVERSHOOT_WAIST_SLOPE_THRESHOLD:.2f} cm/wk"
                )
            if pratio_trigger and p_ratio is not None:
                reasons.append(
                    f"lean mass partitioning ratio P={p_ratio:.2f} is below {CALORIC_OVERSHOOT_LEAN_PARTITION_RATIO:.2f}"
                )

    if is_overshoot:
        message = (
            f"CALORIC_OVERSHOOT detected: bodyweight is increasing at +{beta_bw:.2f} kg/wk "
            f"(>{CALORIC_OVERSHOOT_BW_SLOPE_THRESHOLD:.2f} kg/wk) with "
            + " and ".join(reasons)
            + ". Recommend tapering caloric surplus by 200-300 kcal/day to prioritize lean tissue accrual."
        )
    else:
        message = f"Body composition progression is balanced. BW slope: {beta_bw:+.2f} kg/wk."

    return PRatioPartitioningResult(
        as_of_date=anchor_date.isoformat(),
        window_days=window_days,
        sample_count=len(window_entries),
        beta_bw_kg_per_week=round(beta_bw, 3),
        beta_waist_cm_per_week=round(beta_waist, 3) if beta_waist is not None else None,
        beta_bf_pct_per_week=round(beta_bf, 3) if beta_bf is not None else None,
        beta_limb_cm_per_week=round(beta_limb, 3) if beta_limb is not None else None,
        beta_elbm_kg_per_week=round(beta_elbm, 3) if beta_elbm is not None else None,
        p_ratio_proxy=p_ratio,
        is_caloric_overshoot=is_overshoot,
        message=message,
    )

