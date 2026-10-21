"""Mesocycle Length & Overreaching Inflection Analyzer for Workout Suite Companion.

Combines Tier 2 Kalman e1RM trajectories, iso-load RPE drift, and Banister
stimulus troughs to estimate individualized optimal mesocycle length (in weeks)
with Bayesian credible intervals and data-quality confidence scoring.

Implements ADR-066.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

import numpy as np

from src.ingestion.schemas import Workout, WorkoutSet
from src.models.fatigue_banister import DailyPreparedness
from src.models.kalman_1rm import Adaptive1RMKalmanFilter, KalmanState


@dataclass
class WeeklyBlockMetrics:
    """Aggregated performance and fatigue markers for Week u of a mesocycle."""

    week_index: int                  # 1-based week index within mesocycle
    mean_e1rm_pct_change: float      # % e1RM change relative to Week 1 of block
    e1rm_weekly_slope_pct: float     # Marginal weekly % e1RM gain (velocity)
    mean_rpe_drift: float            # Logged RPE minus expected RPE at block peak
    standardized_cusum_neg: float    # Page's CUSUM for systemic underperformance
    sample_count: int                # Number of mesocycles reaching this week


@dataclass
class MesocycleRecommendation:
    """Bayesian optimal mesocycle length estimate and diagnostic summary."""

    optimal_accumulation_weeks: float
    ci_lower_weeks: float
    ci_upper_weeks: float
    deficit_adjusted_weeks: float
    confidence_score: float          # 0.0 to 100.0%
    confidence_tier: str             # "LOW" | "MODERATE" | "HIGH"
    detected_blocks_count: int
    explicit_rpe_coverage: float     # 0.0 to 1.0
    weekly_profile: List[WeeklyBlockMetrics]
    summary_message: str
    pathway: str = "SHORT_CYCLE"     # "SHORT_CYCLE" | "LONG_CYCLE"
    pathway_name: str = "HIT Agile Sprints (3-4 Weeks)"
    recommended_block_weeks: int = 4
    branching_reasons: List[str] = field(default_factory=list)


def _parse_dt(d_str: Union[str, date, datetime]) -> date:
    """Normalizes input string or date object into a date object."""
    if isinstance(d_str, date) and not isinstance(d_str, datetime):
        return d_str
    if isinstance(d_str, datetime):
        return d_str.date()
    return datetime.strptime(str(d_str)[:10], "%Y-%m-%d").date()


def detect_mesocycle_boundaries(
    banister_series: Sequence[DailyPreparedness],
    min_block_weeks: int = 3,
    max_block_weeks: int = 12,
) -> List[Tuple[date, date]]:
    """Segments longitudinal history into accumulation blocks between deload troughs.

    A deload/boundary trough is triggered when:
    1. The 7-day rolling stimulus drops below 55% of the preceding 21-day rolling
       average stimulus (after at least min_block_weeks of accumulation), OR
    2. A rest gap of >= 5 consecutive zero-stimulus days occurs following sustained training, OR
    3. The accumulation period reaches max_block_weeks.
    """
    if len(banister_series) < min_block_weeks * 7:
        return []

    dates = [_parse_dt(pt.date) for pt in banister_series]
    stimuli = np.array([pt.stimulus for pt in banister_series], dtype=np.float64)

    blocks: List[Tuple[date, date]] = []
    block_start_idx = 0

    # Advance start to first actual training day
    while block_start_idx < len(stimuli) and stimuli[block_start_idx] <= 0.0:
        block_start_idx += 1

    i = block_start_idx + (min_block_weeks * 7)
    while i < len(stimuli):
        days_in_block = (dates[i] - dates[block_start_idx]).days
        acute_7d = float(np.mean(stimuli[max(0, i - 6) : i + 1]))
        chronic_21d = float(np.mean(stimuli[max(0, i - 27) : max(1, i - 6)]))

        is_deload_trough = (chronic_21d > 5.0) and (acute_7d < 0.55 * chronic_21d)
        is_rest_gap = (chronic_21d > 5.0) and (float(np.sum(stimuli[max(0, i - 4) : i + 1])) == 0.0)
        is_max_cap = days_in_block >= (max_block_weeks * 7)

        if is_deload_trough or is_rest_gap or is_max_cap:
            end_idx = i - (5 if is_rest_gap else 7) if (is_deload_trough or is_rest_gap) else i
            end_idx = max(block_start_idx, end_idx)
            if (dates[end_idx] - dates[block_start_idx]).days >= (min_block_weeks * 7 - 3):
                blocks.append((dates[block_start_idx], dates[end_idx]))

            # Skip past the deload trough to start the next accumulation block
            next_start = i + 1
            while next_start < len(stimuli) and stimuli[next_start] <= 0.0:
                next_start += 1
            block_start_idx = next_start
            i = block_start_idx + (min_block_weeks * 7)
        else:
            i += 1

    # Include trailing active block if long enough
    if block_start_idx < len(dates):
        rem_days = (dates[-1] - dates[block_start_idx]).days
        if rem_days >= (min_block_weeks * 7):
            blocks.append((dates[block_start_idx], dates[-1]))

    return blocks


def compute_all_kalman_histories(
    workouts: Sequence[Workout],
    workout_sets: Sequence[WorkoutSet],
    exercises: Sequence[Any],
    default_working_rir: Optional[float] = 2.0,
    min_exercise_sets: int = 5,
) -> Dict[str, Tuple[List[str], List[KalmanState]]]:
    """Runs Adaptive1RMKalmanFilter on all exercises with sufficient volume.

    Returns mapping of exercise_id -> (session_dates, kalman_states).
    """
    sets_by_workout: Dict[str, List[WorkoutSet]] = defaultdict(list)
    for s in workout_sets:
        sets_by_workout[s.workout_id].append(s)

    sets_by_exercise: Dict[str, List[WorkoutSet]] = defaultdict(list)
    for s in workout_sets:
        sets_by_exercise[s.exercise_id].append(s)

    sorted_workouts = sorted(workouts, key=lambda w: (w.date, w.started_at or ""))
    exercise_map = {e.id: e for e in exercises}

    kalman_histories: Dict[str, Tuple[List[str], List[KalmanState]]] = {}
    for ex_id, ex_sets in sets_by_exercise.items():
        if len(ex_sets) < min_exercise_sets:
            continue
        ex_obj = exercise_map.get(ex_id)
        std_lift = getattr(ex_obj, "standard_lift_type", None) if ex_obj else None
        kf = Adaptive1RMKalmanFilter(exercise_id=ex_id, standard_lift_type=std_lift)
        dates: List[str] = []
        states: List[KalmanState] = []
        for w in sorted_workouts:
            if w.id in sets_by_workout:
                session_sets = [s for s in sets_by_workout[w.id] if s.exercise_id == ex_id]
                if session_sets:
                    new_states = kf.process_session(
                        session_sets,
                        default_working_rir=default_working_rir,
                        session_date=w.date,
                    )
                    for st in new_states:
                        dates.append(w.date)
                        states.append(st)
        if states:
            kalman_histories[ex_id] = (dates, states)

    return kalman_histories


def analyze_optimal_mesocycle_length(
    workouts: Sequence[Workout],
    workout_sets: Sequence[WorkoutSet],
    kalman_histories: Dict[str, Tuple[List[str], List[KalmanState]]],
    banister_series: Sequence[DailyPreparedness],
    exercises: Optional[Sequence[Any]] = None,
    energy_balance: Optional[str] = None,
    prior_mu: float = 3.5,
    prior_sigma: float = 1.5,
) -> MesocycleRecommendation:
    """Computes Bayesian optimal mesocycle length from e1RM velocity and RPE drift,

    and performs greedy branching between Short ('HIT Agile Sprints', 3-4 weeks)
    and Long ('Progressive Accumulation Waves', 6-8 weeks) mesocycles.
    """
    blocks = detect_mesocycle_boundaries(banister_series)

    # Calculate explicit RPE/RIR logging coverage across working sets
    working_sets = [
        s for s in workout_sets if getattr(s, "set_type", "working") != "warmup" and s.reps > 0
    ]
    rated_sets = [
        s for s in working_sets if s.rir is not None or s.rpe is not None
    ]
    rpe_coverage = len(rated_sets) / max(1, len(working_sets))

    # Map workout_id -> date
    w_date_map = {w.id: _parse_dt(w.date) for w in workouts}

    # Index sets by (date, exercise_id)
    sets_by_date_ex: Dict[Tuple[date, str], List[WorkoutSet]] = {}
    for s in rated_sets:
        dt = w_date_map.get(s.workout_id)
        if dt is not None:
            sets_by_date_ex.setdefault((dt, s.exercise_id), []).append(s)

    # Collect per-week metrics across all detected blocks
    week_gains: Dict[int, List[float]] = {}
    week_slopes: Dict[int, List[float]] = {}
    week_drifts: Dict[int, List[float]] = {}
    block_peak_weeks: List[Tuple[float, float]] = []  # (peak_week, precision_weight)

    for b_start, b_end in blocks:
        block_weeks = max(1, int(math.ceil((b_end - b_start).days / 7.0)))
        block_week_e1rm_gains: Dict[int, List[float]] = {}
        block_week_rpe_drifts: Dict[int, List[float]] = {}

        for ex_id, (k_dates, k_states) in kalman_histories.items():
            # Filter Kalman states for this exercise inside [b_start, b_end]
            block_pts = [
                (_parse_dt(d), st)
                for d, st in zip(k_dates, k_states)
                if b_start <= _parse_dt(d) <= b_end
            ]
            if len(block_pts) < 3:
                continue

            base_e1rm = block_pts[0][1].e1rm
            peak_ln_1rm_so_far = block_pts[0][1].x[0]

            for dt, st in block_pts:
                u = min(block_weeks, ((dt - b_start).days // 7) + 1)
                pct_gain = ((st.e1rm - base_e1rm) / base_e1rm) * 100.0
                block_week_e1rm_gains.setdefault(u, []).append(pct_gain)
                peak_ln_1rm_so_far = max(peak_ln_1rm_so_far, float(st.x[0]))

                # Compute RPE drift on explicitly rated sets for this date & exercise
                day_sets = sets_by_date_ex.get((dt, ex_id), [])
                for s in day_sets:
                    # Focus drift on working effort sets to avoid power-law divergence at low loads
                    if s.weight < 0.55 * st.e1rm or s.reps > 15:
                        continue
                    if s.rpe is not None:
                        logged_rpe = float(s.rpe)
                    elif s.rir is not None:
                        logged_rpe = max(0.0, 10.0 - float(s.rir))
                    else:
                        continue

                    # Expected r_eff from block peak strength, safely bounded
                    ratio = max(0.0, peak_ln_1rm_so_far - math.log(max(1.0, s.weight))) / max(0.03, st.k)
                    expected_r_eff = math.exp(min(4.0, ratio))
                    expected_rpe = max(0.0, min(10.0, 10.0 - max(0.0, expected_r_eff - s.reps)))
                    drift = max(-3.0, min(3.0, logged_rpe - expected_rpe))
                    block_week_rpe_drifts.setdefault(u, []).append(drift)

        if len(block_week_e1rm_gains) < 3:
            continue

        # Evaluate marginal weekly progression and find peak week u* for this block
        prev_gain = 0.0
        best_u = 4.0
        best_utility = -1e9

        for u in range(1, block_weeks + 1):
            gains_u = block_week_e1rm_gains.get(u, [])
            drifts_u = block_week_rpe_drifts.get(u, [])
            mean_g = float(np.mean(gains_u)) if gains_u else prev_gain
            slope_g = mean_g - prev_gain
            mean_d = float(np.mean(drifts_u)) if drifts_u else 0.0

            week_gains.setdefault(u, []).append(mean_g)
            week_slopes.setdefault(u, []).append(slope_g)
            if drifts_u:
                week_drifts.setdefault(u, []).append(mean_d)

            # Utility rewards net e1RM gain and penalizes positive RPE drift > 0.5
            utility = mean_g - 1.5 * max(0.0, mean_d - 0.5)
            if utility > best_utility:
                best_utility = utility
                best_u = float(u)
            prev_gain = mean_g

        # Precision weight of this block observation (higher if RPE was logged)
        has_rpe_in_block = len(block_week_rpe_drifts) >= 2
        obs_precision = 1.2 if has_rpe_in_block else 0.5
        block_peak_weeks.append((best_u, obs_precision))

    # Conjugate Normal-Normal Bayesian Update
    # Meso 0 Prior: mu_0 = 3.5 weeks (universal fast-calibration baseline), sigma_0 = 1.5 weeks
    mu_0 = prior_mu
    prec_0 = 1.0 / (prior_sigma ** 2)

    total_prec = prec_0 + sum(w for _, w in block_peak_weeks)
    post_var = 1.0 / total_prec
    post_std = math.sqrt(post_var)
    post_mean = post_var * (prec_0 * mu_0 + sum(u * w for u, w in block_peak_weeks))

    # Build weekly profile table
    weekly_profile: List[WeeklyBlockMetrics] = []
    cusum_neg = 0.0
    for u in sorted(week_gains.keys()):
        if u > 8:
            break
        m_gain = float(np.mean(week_gains[u]))
        m_slope = float(np.mean(week_slopes[u]))
        m_drift = float(np.mean(week_drifts.get(u, [0.0])))
        # Accumulate CUSUM when weekly slope drops below +0.15% or RPE drift > 0.5
        cusum_neg = max(0.0, cusum_neg - (m_slope - 0.15) + max(0.0, m_drift - 0.5))
        weekly_profile.append(
            WeeklyBlockMetrics(
                week_index=u,
                mean_e1rm_pct_change=round(m_gain, 2),
                e1rm_weekly_slope_pct=round(m_slope, 2),
                mean_rpe_drift=round(m_drift, 2),
                standardized_cusum_neg=round(cusum_neg, 2),
                sample_count=len(week_gains[u]),
            )
        )

    # Compute Confidence Score (0 - 100%)
    n_blocks = len(block_peak_weeks)
    block_factor = min(1.0, n_blocks / 10.0)
    rpe_factor = 0.4 + 0.6 * rpe_coverage
    precision_factor = max(0.0, min(1.0, (1.5 - post_std) / 1.1))
    confidence_score = round(100.0 * (0.45 * block_factor + 0.30 * rpe_factor + 0.25 * precision_factor), 1)

    if confidence_score >= 75.0 and n_blocks >= 8:
        tier = "HIGH"
    elif confidence_score >= 45.0 and n_blocks >= 4:
        tier = "MODERATE"
    else:
        tier = "LOW"

    ci_lower = max(2.5, round(post_mean - 1.645 * post_std, 1))
    ci_upper = min(12.0, round(post_mean + 1.645 * post_std, 1))
    opt_wks = round(post_mean, 1)
    deficit_wks = max(2.5, round(opt_wks - 1.0, 1))

    # -------------------------------------------------------------------------
    # Greedy Branching Decision Logic (Section 3.2):
    # Short Cycle (Path A: 'HIT Agile Sprints', 3-4 Weeks)
    #   - High Exertion (mean RPE >= 9.0 or single-set RPE >= 9.5)
    #   - Fast Velocity Stall (peaks or stalls by Wk 3, slope <= 0.15%)
    #   - High Axial Ratio (> 60% Barbell volume)
    #   - Caloric Deficit
    # Long Cycle (Path B: 'Progressive Accumulation Waves', 6-8 Weeks)
    #   - Submaximal Volume (mean RPE < 8.5)
    #   - Steady Velocity Gains into Wk 4+
    #   - Low Axial / Machine Focus (< 40% Barbell volume)
    #   - Caloric Surplus or Maintenance
    # -------------------------------------------------------------------------
    # 1. Rated RPE exertion profile
    rated_rpes: List[float] = []
    for s in rated_sets:
        if s.rpe is not None:
            rated_rpes.append(float(s.rpe))
        elif s.rir is not None:
            rated_rpes.append(max(0.0, 10.0 - float(s.rir)))
    mean_rated_rpe = float(np.mean(rated_rpes)) if rated_rpes else 8.2
    has_extreme_rpe = any(r >= 9.5 for r in rated_rpes)

    # 2. Caloric status
    is_deficit = False
    if energy_balance is not None:
        is_deficit = str(energy_balance).strip().lower() in ("deficit", "cut", "hypocaloric")
    elif banister_series:
        recent_pts = banister_series[-7:] if len(banister_series) >= 7 else banister_series
        is_deficit = any(str(getattr(pt, "energy_balance", "")).lower() in ("deficit", "cut") for pt in recent_pts)

    # 3. Axial ratio
    ex_map = {getattr(e, "id", ""): e for e in (exercises or [])}
    if working_sets and ex_map:
        bb_count = sum(
            1 for s in working_sets
            if str(getattr(ex_map.get(s.exercise_id), "category", "")).strip().lower() == "barbell"
        )
        axial_ratio = bb_count / float(len(working_sets))
    else:
        axial_ratio = 0.5  # Neutral baseline

    # 4. Strength velocity progression characteristics
    stalls_early = (opt_wks <= 3.5) or (len(weekly_profile) >= 3 and weekly_profile[2].e1rm_weekly_slope_pct <= 0.15)
    steady_velocity_wk4 = (opt_wks >= 4.5) or (len(weekly_profile) >= 4 and weekly_profile[3].e1rm_weekly_slope_pct > 0.15)

    short_flags: List[str] = []
    long_flags: List[str] = []

    if mean_rated_rpe >= 9.0 or has_extreme_rpe:
        short_flags.append(f"High exertion profile (mean RPE {mean_rated_rpe:.1f} >= 9.0)")
    elif mean_rated_rpe < 8.5:
        long_flags.append(f"Submaximal fatigue profile (mean RPE {mean_rated_rpe:.1f} < 8.5)")

    if stalls_early:
        short_flags.append(f"Early strength velocity stall (peak accumulation around Week {opt_wks:.1f} <= 3.5)")
    elif steady_velocity_wk4:
        long_flags.append("Steady velocity gains progressing through Week 4+")

    if axial_ratio > 0.60:
        short_flags.append(f"High axial fatigue ratio ({axial_ratio:.0%} barbell volume)")
    elif axial_ratio < 0.40:
        long_flags.append(f"Low axial ratio ({axial_ratio:.0%} barbell volume) favoring guided machines/cables")

    if is_deficit:
        short_flags.append("Caloric deficit limits systemic recovery reserves")
    else:
        long_flags.append("Eucaloric or hypercaloric energy balance supports extended volume accumulation")

    # Greedy branch decision
    # If 2+ short flags or optimal weeks <= 4.0 (or Meso 0 baseline), branch to Short Cycle
    if len(short_flags) >= len(long_flags) or opt_wks <= 4.0:
        pathway = "SHORT_CYCLE"
        pathway_name = "HIT Agile Sprints (3-4 Weeks)"
        rec_block_wks = 4  # 3 weeks accumulation + 1 week deload
        branching_reasons = short_flags if short_flags else ["Meso 0 calibration baseline: 3 weeks accumulation + 1 week deload"]
    else:
        pathway = "LONG_CYCLE"
        pathway_name = "Progressive Accumulation Waves (6-8 Weeks)"
        rec_block_wks = min(8, max(6, int(round(opt_wks + 1.0))))
        branching_reasons = long_flags

    if n_blocks > 0:
        summary = (
            f"Across {n_blocks} historical training blocks, your strength velocity peaks around "
            f"**Week {opt_wks}** (90% Credible Interval: **{ci_lower}–{ci_upper} weeks**) before "
            f"marginal e1RM gains stall and RPE drift accumulates. Branching recommendation: "
            f"**{pathway_name}** ({rec_block_wks} total weeks with deload). Schedule a deload every "
            f"**{round(opt_wks)}th week** during maintenance/surplus, or every **{round(deficit_wks)}th week** "
            f"during a caloric deficit."
        )
    else:
        summary = (
            f"With insufficient historical training blocks (0 detected), mesocycle length defaults "
            f"to the Meso 0 fast-calibration baseline of **{opt_wks} weeks** (90% Credible Interval: "
            f"**{ci_lower}–{ci_upper} weeks**). Branching recommendation: **{pathway_name}** ({rec_block_wks} weeks). "
            f"Log at least 3–4 consistent accumulation blocks to unlock personalized Bayesian estimation."
        )

    return MesocycleRecommendation(
        optimal_accumulation_weeks=opt_wks,
        ci_lower_weeks=ci_lower,
        ci_upper_weeks=ci_upper,
        deficit_adjusted_weeks=deficit_wks,
        confidence_score=confidence_score,
        confidence_tier=tier,
        detected_blocks_count=n_blocks,
        explicit_rpe_coverage=round(rpe_coverage, 3),
        weekly_profile=weekly_profile,
        summary_message=summary,
        pathway=pathway,
        pathway_name=pathway_name,
        recommended_block_weeks=rec_block_wks,
        branching_reasons=branching_reasons,
    )
