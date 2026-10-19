"""Headless smoke tests for companion Streamlit UI and Plotly chart builders."""

from datetime import date
from pathlib import Path
import numpy as np
import pytest

from src.ingestion.schemas import BodyMetric
from src.models.fatigue_banister import DailyPreparedness
from src.models.kalman_1rm import KalmanState
from src.models.mesocycle_analyzer import (
    MesocycleRecommendation,
    WeeklyBlockMetrics,
)
from src.models.recovery_modifier import RecoveryState
from src.ui.app import load_payload_from_file
from src.ui.charts import (
    build_banister_chart,
    build_bodyweight_recovery_chart,
    build_endurance_k_chart,
    build_kalman_trajectory_chart,
    build_mesocycle_inflection_chart,
    build_muscle_landmarks_chart,
    build_sfr_matrix_chart,
)



def test_build_kalman_trajectory_chart_empty() -> None:
    fig = build_kalman_trajectory_chart("Bench Press", [], [])
    assert fig is not None
    assert len(fig.layout.annotations) > 0


def test_build_kalman_trajectory_chart_populated() -> None:
    dates = ["2026-10-01", "2026-10-05"]
    states = [
        KalmanState(
            x=np.array([np.log(100.0), 0.085]),
            P=np.diag([0.002, 0.0004]),
            step_count=1,
        ),
        KalmanState(
            x=np.array([np.log(102.5), 0.084]),
            P=np.diag([0.0015, 0.0003]),
            step_count=2,
        ),
    ]
    obs = [("2026-10-01", 100.0, 1.0), ("2026-10-05", 90.0, 5.0)]

    fig = build_kalman_trajectory_chart("Bench Press", dates, states, obs)
    assert fig is not None
    # Traces: upper band, lower band, Kalman posterior, submaximal sets, actual 1RMs
    assert len(fig.data) >= 4

    trace_names = [t.name for t in fig.data]
    assert "Actual 1RM (Tested)" in trace_names
    assert "Submaximal Sets (e1RM)" in trace_names

    actual_trace = next(t for t in fig.data if t.name == "Actual 1RM (Tested)")
    assert actual_trace.marker.symbol == "star"
    assert actual_trace.marker.color == "#EF4444"
    assert actual_trace.marker.size == 15
    assert actual_trace.y[0] == 100.0

    submax_trace = next(t for t in fig.data if t.name == "Submaximal Sets (e1RM)")
    assert submax_trace.marker.symbol == "diamond"
    assert submax_trace.marker.color == "#F59E0B"


def test_build_kalman_trajectory_chart_rich_observations() -> None:
    """Verifies that rich 7-element observation tuples cleanly segregate actual singles."""
    dates = ["2026-10-01", "2026-10-05"]
    states = [
        KalmanState(x=np.array([np.log(100.0), 0.085]), P=np.diag([0.002, 0.0004]), step_count=1),
        KalmanState(x=np.array([np.log(102.5), 0.084]), P=np.diag([0.0015, 0.0003]), step_count=2),
    ]
    # (date, weight, r_eff, reps, is_actual_1rm, rir, rpe)
    obs = [
        ("2026-10-01", 110.0, 1.0, 1, True, 0.0, 10.0),   # True 1RM single
        ("2026-10-05", 95.0, 7.0, 5, False, 2.0, 8.0),    # 5-rep submaximal set
    ]
    fig = build_kalman_trajectory_chart("Squat", dates, states, obs)
    actual_trace = next(t for t in fig.data if t.name == "Actual 1RM (Tested)")
    assert len(actual_trace.x) == 1
    assert actual_trace.y[0] == 110.0
    assert actual_trace.marker.symbol == "star"

    submax_trace = next(t for t in fig.data if t.name == "Submaximal Sets (e1RM)")
    assert len(submax_trace.x) == 1
    # 95 * 7^0.10 ~ 115.3
    assert submax_trace.y[0] > 95.0
    assert submax_trace.marker.symbol == "diamond"


def test_build_endurance_k_chart() -> None:
    dates = ["2026-10-01", "2026-10-05"]
    states = [
        KalmanState(
            x=np.array([np.log(100.0), 0.085]),
            P=np.diag([0.002, 0.0004]),
            step_count=1,
        ),
        KalmanState(
            x=np.array([np.log(102.5), 0.084]),
            P=np.diag([0.0015, 0.0003]),
            step_count=2,
        ),
    ]
    fig = build_endurance_k_chart("Bench Press", dates, states)
    assert fig is not None
    assert len(fig.data) >= 2


def test_build_banister_chart() -> None:
    points = [
        DailyPreparedness(
            date="2026-10-01",
            stimulus=12.5,
            fitness=10.0,
            fatigue=15.0,
            preparedness=-5.0,
            tau2=11.0,
            energy_balance="neutral",
        ),
        DailyPreparedness(
            date="2026-10-02",
            stimulus=0.0,
            fitness=9.8,
            fatigue=12.0,
            preparedness=-2.2,
            tau2=11.0,
            energy_balance="neutral",
        ),
    ]
    fig = build_banister_chart(points)
    assert fig is not None
    assert len(fig.data) == 3


def test_build_bodyweight_recovery_chart() -> None:
    bms = [
        BodyMetric(
            id="bm-1",
            date="2026-10-01",
            bodyweight=80.0,
        ),
        BodyMetric(
            id="bm-2",
            date="2026-10-08",
            bodyweight=80.5,
        ),
    ]
    rec_states = [
        (
            date(2026, 10, 8),
            RecoveryState(
                slope_kg_per_day=0.071,
                slope_kg_per_week=0.5,
                energy_balance="SURPLUS",
                tau2_multiplier=0.75,
                effective_tau2=8.25,
                sample_count=2,
                as_of_date="2026-10-08",
            ),
        )
    ]
    fig = build_bodyweight_recovery_chart(bms, rec_states)
    assert fig is not None
    assert len(fig.data) == 2


def test_load_payload_from_file_dummy() -> None:
    dummy_dir = Path(__file__).resolve().parents[2] / "dummy_data"
    dummy_files = sorted(dummy_dir.glob("workout_suite_export_*.json"), reverse=True)
    if not dummy_files:
        pytest.skip("Dummy export file not present")

    dummy_path = dummy_files[0]
    payload = load_payload_from_file(dummy_path)
    assert payload is not None
    assert len(payload.workouts) > 0
    assert len(payload.workout_sets) > 0


def test_build_mesocycle_inflection_chart_empty() -> None:
    rec = MesocycleRecommendation(
        optimal_accumulation_weeks=5.0,
        ci_lower_weeks=2.5,
        ci_upper_weeks=7.5,
        deficit_adjusted_weeks=4.0,
        confidence_score=35.0,
        confidence_tier="LOW",
        detected_blocks_count=0,
        explicit_rpe_coverage=0.1,
        weekly_profile=[],
        summary_message="Insufficient data.",
    )
    fig = build_mesocycle_inflection_chart(rec)
    assert fig is not None
    assert len(fig.layout.annotations) > 0


def test_build_mesocycle_inflection_chart_populated() -> None:
    profile = [
        WeeklyBlockMetrics(
            week_index=1,
            mean_e1rm_pct_change=0.5,
            e1rm_weekly_slope_pct=0.5,
            mean_rpe_drift=0.0,
            standardized_cusum_neg=0.0,
            sample_count=8,
        ),
        WeeklyBlockMetrics(
            week_index=2,
            mean_e1rm_pct_change=1.4,
            e1rm_weekly_slope_pct=0.9,
            mean_rpe_drift=0.1,
            standardized_cusum_neg=0.0,
            sample_count=8,
        ),
        WeeklyBlockMetrics(
            week_index=3,
            mean_e1rm_pct_change=2.1,
            e1rm_weekly_slope_pct=0.7,
            mean_rpe_drift=0.4,
            standardized_cusum_neg=0.0,
            sample_count=8,
        ),
        WeeklyBlockMetrics(
            week_index=4,
            mean_e1rm_pct_change=2.3,
            e1rm_weekly_slope_pct=0.2,
            mean_rpe_drift=0.8,
            standardized_cusum_neg=0.3,
            sample_count=7,
        ),
        WeeklyBlockMetrics(
            week_index=5,
            mean_e1rm_pct_change=2.1,
            e1rm_weekly_slope_pct=-0.2,
            mean_rpe_drift=1.2,
            standardized_cusum_neg=1.4,
            sample_count=5,
        ),
    ]
    rec = MesocycleRecommendation(
        optimal_accumulation_weeks=4.2,
        ci_lower_weeks=3.6,
        ci_upper_weeks=4.8,
        deficit_adjusted_weeks=3.2,
        confidence_score=82.0,
        confidence_tier="HIGH",
        detected_blocks_count=8,
        explicit_rpe_coverage=0.85,
        weekly_profile=profile,
        summary_message="Optimal accumulation around Week 4.2.",
    )
    fig = build_mesocycle_inflection_chart(rec)
    assert fig is not None
    # Traces: Bar slope, Scatter trend, Scatter drift, Scatter cusum
    assert len(fig.data) == 4
    trace_names = [t.name for t in fig.data]
    assert "Marginal e1RM Velocity (%/wk)" in trace_names
    assert "Iso-Load RPE Drift" in trace_names
    assert "CUSUM Exhaustion (C-)" in trace_names


def test_build_muscle_landmarks_chart() -> None:
    from src.analysis.muscle_landmarks import MuscleLandmarkResult

    # Test empty
    fig_empty = build_muscle_landmarks_chart({})
    assert fig_empty is not None
    assert len(fig_empty.layout.annotations) > 0

    # Test populated
    landmarks = {
        "Chest": MuscleLandmarkResult(
            muscle_group="Chest",
            mev=8.0,
            mav=16.0,
            mrv=22.0,
            readiness_pct=85.0,
            is_empirical=True,
            weeks_analyzed=8,
            energy_balance="MAINTENANCE",
        ),
        "Back": MuscleLandmarkResult(
            muscle_group="Back",
            mev=10.0,
            mav=18.0,
            mrv=24.0,
            readiness_pct=90.0,
            is_empirical=False,
            weeks_analyzed=4,
            energy_balance="MAINTENANCE",
        ),
    }
    volumes = {"Chest": 14.0, "Back": 20.0}

    fig = build_muscle_landmarks_chart(landmarks, volumes)
    assert fig is not None
    assert len(fig.data) == 4  # Bar (current), Scatter MEV, Scatter MAV, Scatter MRV
    trace_names = [t.name for t in fig.data]
    assert "Current Weekly Volume (Sets)" in trace_names
    assert "MEV (Maintenance / Min Gain)" in trace_names
    assert "MAV (Optimal Hypertrophy)" in trace_names
    assert "MRV (Fatigue Ceiling)" in trace_names


def test_build_sfr_matrix_chart() -> None:
    from src.analysis.sfr_evaluator import ExerciseSFRResult

    # Test empty
    fig_empty = build_sfr_matrix_chart({})
    assert fig_empty is not None
    assert len(fig_empty.layout.annotations) > 0

    # Test populated with mix of evaluable and non-evaluable (sfr_score=None) exercises
    sfr_results = {
        "bench": ExerciseSFRResult(
            exercise_id="bench",
            sfr_score=75.0,
            sfr_tier="OPTIMAL",
            is_evaluable=True,
            sessions_evaluated=5,
            mean_effective_reps=4.2,
            intra_session_dropoff=0.08,
            e10rm_slope_28d=0.02,
            joint_pain_sum=0,
            muscle_pain_sum=1,
            has_severe_joint_pain=False,
            recommended_swap_exercise_id=None,
        ),
        "squat": ExerciseSFRResult(
            exercise_id="squat",
            sfr_score=35.0,
            sfr_tier="POOR_SWAP_RECOMMENDED",
            is_evaluable=True,
            sessions_evaluated=4,
            mean_effective_reps=3.0,
            intra_session_dropoff=0.22,
            e10rm_slope_28d=-0.01,
            joint_pain_sum=6,
            muscle_pain_sum=2,
            has_severe_joint_pain=True,
            recommended_swap_exercise_id="leg_press",
        ),
        "unperformed": ExerciseSFRResult(
            exercise_id="unperformed",
            sfr_score=None,
            sfr_tier="MODERATE",
            is_evaluable=False,
            sessions_evaluated=0,
            mean_effective_reps=0.0,
            intra_session_dropoff=0.0,
            e10rm_slope_28d=0.0,
            joint_pain_sum=0,
            muscle_pain_sum=0,
            has_severe_joint_pain=False,
            recommended_swap_exercise_id=None,
        ),
    }
    names = {"bench": "Bench Press", "squat": "Barbell Squat", "leg_press": "Leg Press", "unperformed": "Unperformed"}

    fig = build_sfr_matrix_chart(sfr_results, names)
    assert fig is not None
    assert len(fig.data) == 2  # Traces for OPTIMAL and POOR_SWAP_RECOMMENDED (unperformed excluded)

    # Test only non-evaluable exercises with None scores
    only_non_evaluable = {
        "unperformed": ExerciseSFRResult(
            exercise_id="unperformed",
            sfr_score=None,
            sfr_tier="MODERATE",
            is_evaluable=False,
            sessions_evaluated=1,
            mean_effective_reps=0.0,
            intra_session_dropoff=0.0,
            e10rm_slope_28d=0.0,
            joint_pain_sum=0,
            muscle_pain_sum=0,
            has_severe_joint_pain=False,
            recommended_swap_exercise_id=None,
        )
    }
    fig_none = build_sfr_matrix_chart(only_non_evaluable)
    assert fig_none is not None
    assert len(fig_none.layout.annotations) > 0
    assert "minimum 3 sessions" in fig_none.layout.annotations[0].text



