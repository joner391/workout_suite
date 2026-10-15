"""Headless smoke tests for companion Streamlit UI and Plotly chart builders."""

from datetime import date
from pathlib import Path
import numpy as np
import pytest

from src.ingestion.schemas import BodyMetric
from src.models.fatigue_banister import DailyPreparedness
from src.models.kalman_1rm import KalmanState
from src.models.recovery_modifier import RecoveryState
from src.ui.app import load_payload_from_file
from src.ui.charts import (
    build_banister_chart,
    build_bodyweight_recovery_chart,
    build_endurance_k_chart,
    build_kalman_trajectory_chart,
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
    # 2 traces for uncertainty band (upper/lower), 1 for estimated 1RM line, 1 for observations
    assert len(fig.data) >= 3


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
    dummy_path = (
        Path(__file__).resolve().parents[2]
        / "dummy_data"
        / "workout_suite_export_2026-10-15T21-13-03-987Z.json"
    )
    if not dummy_path.exists():
        pytest.skip("Dummy export file not present")

    payload = load_payload_from_file(dummy_path)
    assert payload is not None
    assert len(payload.workouts) > 0
    assert len(payload.workout_sets) > 0
