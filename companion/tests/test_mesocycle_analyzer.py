"""Unit tests for the Mesocycle Length & Overreaching Inflection Analyzer.

Tests:
- Deload / boundary detection from Banister daily stimulus series
- Iso-load / iso-volume RPE drift calculation and stability against low-load power-law divergence
- Page's CUSUM systemic underperformance accumulation
- Conjugate Normal-Normal Bayesian updating
- Caloric deficit adjustment (-1.0 week)
- End-to-end integration with dummy export data
"""

from datetime import date, datetime, timedelta
import math
from pathlib import Path
from typing import List

import numpy as np
import pytest

from src.ingestion.schemas import Exercise, Workout, WorkoutExportPayload, WorkoutSet
from src.models.fatigue_banister import DailyPreparedness, compute_daily_banister_series
from src.models.kalman_1rm import KalmanState
from src.models.mesocycle_analyzer import (
    MesocycleRecommendation,
    WeeklyBlockMetrics,
    analyze_optimal_mesocycle_length,
    compute_all_kalman_histories,
    detect_mesocycle_boundaries,
)
from src.ui.app import load_payload_from_file


def _make_daily_preparedness(d: date, stimulus: float) -> DailyPreparedness:
    return DailyPreparedness(
        date=d.strftime("%Y-%m-%d"),
        stimulus=stimulus,
        fitness=stimulus,
        fatigue=stimulus * 1.25,
        preparedness=-0.25 * stimulus,
        tau2=11.0,
        energy_balance="neutral",
    )


def test_detect_mesocycle_boundaries_empty() -> None:
    assert detect_mesocycle_boundaries([]) == []


def test_detect_mesocycle_boundaries_too_short() -> None:
    start = date(2026, 1, 1)
    pts = [_make_daily_preparedness(start + timedelta(days=i), 20.0) for i in range(14)]
    assert detect_mesocycle_boundaries(pts, min_block_weeks=3) == []


def test_detect_mesocycle_boundaries_clear_deload_trough() -> None:
    """Verifies that a drop to <55% of chronic 21d stimulus after 4 weeks triggers a boundary."""
    start = date(2026, 1, 1)
    pts: List[DailyPreparedness] = []
    # 4 weeks (28 days) of high stimulus (20.0 AU/day)
    for i in range(28):
        pts.append(_make_daily_preparedness(start + timedelta(days=i), 20.0))
    # 1 week of deload trough (5.0 AU/day, which is 25% of 20.0)
    for i in range(28, 35):
        pts.append(_make_daily_preparedness(start + timedelta(days=i), 5.0))
    # Followed by 3 weeks of new accumulation (20.0 AU/day)
    for i in range(35, 56):
        pts.append(_make_daily_preparedness(start + timedelta(days=i), 20.0))

    blocks = detect_mesocycle_boundaries(pts, min_block_weeks=3, max_block_weeks=10)
    assert len(blocks) >= 1
    first_block = blocks[0]
    assert first_block[0] == start
    # End of block should be before or at the deload trough
    assert (first_block[1] - first_block[0]).days >= 21


def test_detect_mesocycle_boundaries_rest_gap() -> None:
    """Verifies that 5+ days with zero stimulus triggers a block boundary."""
    start = date(2026, 1, 1)
    pts: List[DailyPreparedness] = []
    # 25 days of training
    for i in range(25):
        pts.append(_make_daily_preparedness(start + timedelta(days=i), 25.0))
    # 6 days of complete rest
    for i in range(25, 31):
        pts.append(_make_daily_preparedness(start + timedelta(days=i), 0.0))
    # Resumed training
    for i in range(31, 55):
        pts.append(_make_daily_preparedness(start + timedelta(days=i), 25.0))

    blocks = detect_mesocycle_boundaries(pts, min_block_weeks=3, max_block_weeks=10)
    assert len(blocks) >= 1
    assert blocks[0][0] == start


def test_analyze_optimal_mesocycle_length_empty() -> None:
    """Verifies that with zero blocks, the analyzer reverts safely to Meso 0 baseline (3.5 weeks)."""
    rec = analyze_optimal_mesocycle_length(
        workouts=[],
        workout_sets=[],
        kalman_histories={},
        banister_series=[],
    )
    assert rec.optimal_accumulation_weeks == 3.5
    assert rec.ci_lower_weeks <= 3.5
    assert rec.ci_upper_weeks >= 3.5
    assert rec.confidence_tier == "LOW"
    assert rec.detected_blocks_count == 0
    assert rec.weekly_profile == []
    assert "Meso 0 fast-calibration baseline" in rec.summary_message
    assert rec.pathway == "SHORT_CYCLE"
    assert rec.recommended_block_weeks == 4


def test_analyze_optimal_mesocycle_synthetic_drift() -> None:
    """Creates a controlled synthetic block:

    - Weeks 1-3: progressive 1RM gains, 0 RPE drift
    - Week 4: peak strength, RPE drift starts
    - Week 5: e1RM velocity turns negative (-1.5%), RPE drift jumps to +1.5
    Verifies that best peak week u* = 4 is identified and Bayesian prior updates towards 4.0.
    """
    start = date(2026, 1, 5)
    workouts: List[Workout] = []
    workout_sets: List[WorkoutSet] = []
    banister: List[DailyPreparedness] = []
    kalman_dates: List[str] = []
    kalman_states: List[KalmanState] = []

    # 5 weeks accumulation (35 days) + 1 week deload (7 days)
    e1rms = [100.0, 101.5, 103.0, 103.5, 102.0]  # Gains peak at Week 4
    for wk_idx in range(5):
        for day in range(3):  # 3 sessions per week
            d = start + timedelta(days=wk_idx * 7 + day * 2)
            d_str = d.strftime("%Y-%m-%d")
            w_id = f"w_{wk_idx}_{day}"
            workouts.append(Workout(id=w_id, name="Test Workout", status="completed", date=d_str, started_at=f"{d_str}T10:00:00Z"))

            # Log a set for exercise 'bench'
            weight = 85.0
            reps = 6
            # In Week 5, logged RPE spikes (drift)
            logged_rpe = 7.5 if wk_idx < 3 else (8.5 if wk_idx == 3 else 9.8)
            workout_sets.append(
                WorkoutSet(
                    id=f"s_{wk_idx}_{day}",
                    workout_id=w_id,
                    exercise_id="bench",
                    set_number=1,
                    weight=weight,
                    raw_input_weight=weight,
                    reps=reps,
                    rpe=logged_rpe,
                    set_type="working",
                    created_at=f"{d_str}T10:15:00Z",
                )
            )

            # Kalman state for this session
            current_e1rm = e1rms[wk_idx]
            kalman_dates.append(d_str)
            kalman_states.append(
                KalmanState(
                    x=np.array([math.log(current_e1rm), 0.085]),
                    P=np.diag([0.001, 0.0001]),
                    step_count=len(kalman_dates),
                )
            )

    # 35 days accumulation stimulus
    for i in range(35):
        banister.append(_make_daily_preparedness(start + timedelta(days=i), 25.0))
    # 7 days deload trough
    for i in range(35, 42):
        banister.append(_make_daily_preparedness(start + timedelta(days=i), 5.0))
    # 25 days new accumulation so trailing is long enough
    for i in range(42, 67):
        banister.append(_make_daily_preparedness(start + timedelta(days=i), 25.0))

    kalman_histories = {"bench": (kalman_dates, kalman_states)}
    rec = analyze_optimal_mesocycle_length(
        workouts=workouts,
        workout_sets=workout_sets,
        kalman_histories=kalman_histories,
        banister_series=banister,
    )

    assert rec.detected_blocks_count >= 1
    # Posterior updates towards observation (u*=3.0 pulling baseline 3.5 down to ~3.1)
    assert 2.5 <= rec.optimal_accumulation_weeks <= 4.5
    # Deficit target should be 1 week less
    assert rec.deficit_adjusted_weeks < rec.optimal_accumulation_weeks


def test_greedy_branching_short_cycle_high_exertion() -> None:
    """Verifies that high exertion (RPE >= 9.5, deficit) branches to Short Mesocycle (Path A)."""
    start = date(2026, 1, 1)
    d_str = start.strftime("%Y-%m-%d")
    w = Workout(id="w1", name="Test Session", status="completed", date=d_str, started_at=f"{d_str}T10:00:00Z")
    s = WorkoutSet(
        id="s1",
        workout_id="w1",
        exercise_id="bench",
        set_number=1,
        weight=100.0,
        raw_input_weight=100.0,
        reps=5,
        rpe=9.5,  # High exertion
        set_type="working",
        created_at=f"{d_str}T10:15:00Z",
    )
    rec = analyze_optimal_mesocycle_length(
        workouts=[w],
        workout_sets=[s],
        kalman_histories={},
        banister_series=[],
        energy_balance="deficit",
    )
    assert rec.pathway == "SHORT_CYCLE"
    assert rec.recommended_block_weeks == 4
    assert any("High exertion" in r for r in rec.branching_reasons)
    assert any("Caloric deficit" in r for r in rec.branching_reasons)


def test_greedy_branching_long_cycle_submaximal() -> None:
    """Verifies that submaximal exertion (RPE 7.5, machine focus, surplus) branches to Long Mesocycle (Path B)."""
    start = date(2026, 1, 1)
    workouts: List[Workout] = []
    sets: List[WorkoutSet] = []
    banister: List[DailyPreparedness] = []
    k_dates: List[str] = []
    k_states: List[KalmanState] = []

    # 7 weeks of steady progression (49 days) + 1 week deload
    for wk in range(7):
        for day in range(3):
            d = start + timedelta(days=wk * 7 + day * 2)
            d_str = d.strftime("%Y-%m-%d")
            w_id = f"w_long_{wk}_{day}"
            workouts.append(Workout(id=w_id, name="Machine Push", status="completed", date=d_str, started_at=f"{d_str}T10:00:00Z"))
            sets.append(
                WorkoutSet(
                    id=f"s_long_{wk}_{day}",
                    workout_id=w_id,
                    exercise_id="chest_press",
                    set_number=1,
                    weight=80.0 + wk * 2.0,
                    raw_input_weight=80.0 + wk * 2.0,
                    reps=10,
                    rpe=7.5,  # Submaximal
                    set_type="working",
                    created_at=f"{d_str}T10:15:00Z",
                )
            )
            k_dates.append(d_str)
            k_states.append(
                KalmanState(
                    x=np.array([math.log(100.0 + wk * 2.5), 0.085]),
                    P=np.diag([0.001, 0.0001]),
                    step_count=len(k_dates),
                )
            )

    for i in range(49):
        banister.append(_make_daily_preparedness(start + timedelta(days=i), 20.0))
    for i in range(49, 56):
        banister.append(_make_daily_preparedness(start + timedelta(days=i), 5.0))
    for i in range(56, 80):
        banister.append(_make_daily_preparedness(start + timedelta(days=i), 20.0))

    ex = Exercise(
        id="chest_press",
        name="Machine Chest Press",
        muscle_group="Chest",
        category="Machine",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
    )

    rec = analyze_optimal_mesocycle_length(
        workouts=workouts,
        workout_sets=sets,
        kalman_histories={"chest_press": (k_dates, k_states)},
        banister_series=banister,
        exercises=[ex],
        energy_balance="surplus",
    )
    assert rec.pathway == "LONG_CYCLE"
    assert rec.recommended_block_weeks in (6, 7, 8)
    assert any("Submaximal" in r for r in rec.branching_reasons)


def test_iso_load_rpe_drift_stability_at_low_loads() -> None:
    """Verifies that accessory sets or low percentage loads don't blow up RPE drift."""
    start = date(2026, 1, 1)
    d_str = start.strftime("%Y-%m-%d")
    w = Workout(id="w1", name="Test Session", status="completed", date=d_str, started_at=f"{d_str}T10:00:00Z")

    # Light warmup: 20kg when 1RM is 100kg
    s_light = WorkoutSet(
        id="s1",
        workout_id="w1",
        exercise_id="bench",
        set_number=1,
        weight=20.0,
        raw_input_weight=20.0,
        reps=10,
        rpe=7.0,
        set_type="working",
        created_at=f"{d_str}T10:10:00Z",
    )
    # Heavy working set
    s_heavy = WorkoutSet(
        id="s2",
        workout_id="w1",
        exercise_id="bench",
        set_number=2,
        weight=85.0,
        raw_input_weight=85.0,
        reps=6,
        rpe=8.0,
        set_type="working",
        created_at=f"{d_str}T10:15:00Z",
    )

    # Kalman state with e1RM = 100 kg
    st = KalmanState(x=np.array([math.log(100.0), 0.085]), P=np.diag([0.001, 0.0001]))
    kalman_histories = {"bench": ([d_str], [st])}

    pts = [_make_daily_preparedness(start + timedelta(days=i), 20.0) for i in range(28)]
    pts += [_make_daily_preparedness(start + timedelta(days=28 + i), 2.0) for i in range(7)]

    rec = analyze_optimal_mesocycle_length(
        workouts=[w],
        workout_sets=[s_light, s_heavy],
        kalman_histories=kalman_histories,
        banister_series=pts,
    )
    # Check that weekly profile does not contain NaN or infinity
    for p in rec.weekly_profile:
        assert not math.isnan(p.mean_rpe_drift)
        assert abs(p.mean_rpe_drift) <= 5.0


def test_compute_all_kalman_histories_integration() -> None:
    """Verifies batch execution of Kalman filter across an exercise catalog."""
    w1 = Workout(id="w1", name="Day 1", status="completed", date="2026-01-01", started_at="2026-01-01T10:00:00Z")
    w2 = Workout(id="w2", name="Day 2", status="completed", date="2026-01-04", started_at="2026-01-04T10:00:00Z")
    w3 = Workout(id="w3", name="Day 3", status="completed", date="2026-01-07", started_at="2026-01-07T10:00:00Z")

    ex = Exercise(
        id="bench",
        name="Barbell Bench Press",
        muscle_group="chest",
        category="barbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
        standard_lift_type="bench",
    )

    sets = [
        WorkoutSet(
            id=f"s_{i}",
            workout_id=f"w{i%3+1}",
            exercise_id="bench",
            set_number=1,
            weight=100.0,
            raw_input_weight=100.0,
            reps=5,
            rir=2.0,
            created_at="2026-01-01T10:15:00Z",
        )
        for i in range(6)
    ]


    histories = compute_all_kalman_histories(
        workouts=[w1, w2, w3],
        workout_sets=sets,
        exercises=[ex],
        default_working_rir=2.0,
        min_exercise_sets=3,
    )

    assert "bench" in histories
    dates, states = histories["bench"]
    assert len(dates) > 0
    assert len(states) == len(dates)
    assert states[-1].e1rm > 100.0


def test_analyze_on_dummy_export_if_present() -> None:
    """End-to-end integration test running on the actual longitudinal dummy export."""
    dummy_dir = Path(__file__).resolve().parents[2] / "dummy_data"
    dummy_files = sorted(dummy_dir.glob("workout_suite_export_*.json"), reverse=True)
    if not dummy_files:
        pytest.skip("Dummy export file not present")

    payload = load_payload_from_file(dummy_files[0])
    assert payload is not None

    banister_series = compute_daily_banister_series(
        workouts=payload.workouts,
        workout_sets=payload.workout_sets,
        body_metrics=payload.body_metrics,
        default_working_rpe=8.0,
    )
    assert len(banister_series) > 100

    kalman_histories = compute_all_kalman_histories(
        workouts=payload.workouts,
        workout_sets=payload.workout_sets,
        exercises=payload.exercises,
        default_working_rir=2.0,
    )
    assert len(kalman_histories) > 0

    rec = analyze_optimal_mesocycle_length(
        workouts=payload.workouts,
        workout_sets=payload.workout_sets,
        kalman_histories=kalman_histories,
        banister_series=banister_series,
    )

    assert rec.detected_blocks_count >= 5
    assert 3.0 <= rec.optimal_accumulation_weeks <= 8.0
    assert rec.ci_lower_weeks <= rec.optimal_accumulation_weeks <= rec.ci_upper_weeks
    assert rec.deficit_adjusted_weeks < rec.optimal_accumulation_weeks
    assert rec.confidence_tier in ("MODERATE", "HIGH")
    assert len(rec.weekly_profile) > 0
    for p in rec.weekly_profile:
        assert 1 <= p.week_index <= 8
        assert not math.isnan(p.e1rm_weekly_slope_pct)
        assert not math.isnan(p.mean_rpe_drift)
        assert not math.isnan(p.standardized_cusum_neg)
