"""Unit and regression tests for Phase 1 Hypertrophy Signals & Intra-Session Kinetics.

Validates:
1. Effective Repetitions (eReps) under working sets, warmups, AMRAPs, and rest-pause sets (myoreps, drop, dc).
2. Implicit inter-set rest interval Delta t_rest with TUT adjustments and ISO 8601 parsing.
3. Intra-session multi-set fatigue decay slope delta_drop.
4. Tier 2 Kalman state e10RM projection.
5. Pydantic v2 schemas and vectorized pandas operations.
"""

from __future__ import annotations

from datetime import datetime, timezone
import math
from typing import List

import numpy as np
import pandas as pd  # type: ignore[import-untyped]
import pytest

from src.analysis.hypertrophy_signals import (
    DEFAULT_PRIOR_K,
    DEFAULT_REST_PAUSE_MAX_REST_SECONDS,
    DEFAULT_TUT_SECONDS_PER_REP,
    DEFAULT_UNRATED_WORKING_RIR,
    IntraSessionDropoffSignal,
    SetHypertrophySignal,
    compute_effective_reps,
    compute_effective_reps_vectorized,
    compute_implicit_rest_seconds,
    compute_intra_session_dropoff,
    compute_workout_implicit_rests,
    evaluate_intra_session_dropoff,
    extract_hypertrophy_signals,
    is_amrap_set,
    project_e10rm,
)
from src.ingestion.schemas import WorkoutSet
from src.models.kalman_1rm import KalmanState


# ============================================================================
# Phase 1 Verification Gate Tests (Mandatory Specifications)
# ============================================================================

def test_phase_1_verification_gate_effective_reps() -> None:
    """Verification Gate:

    - Warmup sets yield 0 eReps.
    - An 8-rep set @ RPE 8 (RIR 2) yields 3.0 eReps.
    - An 8-rep set @ RPE 10 (RIR 0) yields 5.0 eReps.
    """
    # 1. Warmup set yields 0 eReps
    warmup_ereps = compute_effective_reps(8, rpe=10.0, set_type="warmup")
    assert warmup_ereps == 0.0

    # 2. 8-rep set @ RPE 8 (RIR 2) yields 3.0 eReps
    rpe8_ereps = compute_effective_reps(8, rpe=8.0, set_type="working")
    assert pytest.approx(rpe8_ereps, rel=1e-5) == 3.0

    # Equivalent with explicit RIR = 2.0
    rir2_ereps = compute_effective_reps(8, rir=2.0, set_type="working")
    assert pytest.approx(rir2_ereps, rel=1e-5) == 3.0

    # 3. 8-rep set @ RPE 10 (RIR 0) yields 5.0 eReps
    rpe10_ereps = compute_effective_reps(8, rpe=10.0, set_type="working")
    assert pytest.approx(rpe10_ereps, rel=1e-5) == 5.0

    # Equivalent with explicit RIR = 0.0
    rir0_ereps = compute_effective_reps(8, rir=0.0, set_type="working")
    assert pytest.approx(rir0_ereps, rel=1e-5) == 5.0


def test_phase_1_verification_gate_implicit_rest_seconds() -> None:
    """Verification Gate:

    ISO 8601 timestamps 150 seconds apart on a 10-rep set yield Delta t_rest = 120s.
    TUT = 3.0 * 10 = 30s. Elapsed = 150s. Delta t_rest = 150 - 30 = 120s.
    """
    t_prev = "2026-10-18T10:00:00Z"
    t_curr = "2026-10-18T10:02:30Z"  # 150 seconds later

    rest_sec = compute_implicit_rest_seconds(t_prev, t_curr, reps=10)
    assert pytest.approx(rest_sec, rel=1e-5) == 120.0


# ============================================================================
# Comprehensive Unit Tests: compute_effective_reps
# ============================================================================

def test_effective_reps_submaximal_and_clamping() -> None:
    """Tests submaximal sets and low rep set clamping."""
    # Low rep set @ RPE 10 (reps < 5): eReps clamped to reps
    assert compute_effective_reps(2, rpe=10.0) == 2.0
    assert compute_effective_reps(4, rpe=10.0) == 4.0
    assert compute_effective_reps(5, rpe=10.0) == 5.0

    # High RIR (non-stimulating set): 10 reps @ RIR 5 -> max(0, 5 - 5) = 0.0
    assert compute_effective_reps(10, rir=5.0) == 0.0
    # 10 reps @ RPE 4 (RIR 6) -> 0.0
    assert compute_effective_reps(10, rpe=4.0) == 0.0

    # RIR 1.0 @ 12 reps -> min(12, 5 - 1) = 4.0
    assert compute_effective_reps(12, rir=1.0) == 4.0

    # Zero or negative reps
    assert compute_effective_reps(0, rpe=10.0) == 0.0
    assert compute_effective_reps(-5, rpe=10.0) == 0.0


def test_effective_reps_defaults_and_amrap() -> None:
    """Tests unrated working sets (default RIR 2.0) and AMRAP sets (RIR 0.0)."""
    # Unrated working set defaults to RIR 2.0 -> 5.0 - 2.0 = 3.0 eReps
    assert compute_effective_reps(8, set_type="working") == 3.0
    assert compute_effective_reps(2, set_type="working") == 2.0

    # AMRAP set defaults to RIR 0.0 -> 5.0 eReps
    assert compute_effective_reps(8, set_type="amrap") == 5.0
    assert compute_effective_reps(8, set_type="working", is_amrap=True) == 5.0

    # Explicit RIR takes precedence on AMRAP if recorded
    assert compute_effective_reps(8, rir=1.0, set_type="amrap") == 4.0


def test_effective_reps_rest_pause_boost() -> None:
    """Tests myorep, drop, and dc sets with Delta t_rest <= 45s applying the 0.5 * max(0, reps - 5) bonus."""
    # Myorep set of 8 reps @ RPE 10 (RIR 0) with 20s rest:
    # base = 5.0; bonus = 0.5 * (8 - 5) = 1.5; total = min(8, 6.5) = 6.5
    ereps_myo = compute_effective_reps(8, rpe=10.0, set_type="myorep", rest_seconds=20.0)
    assert pytest.approx(ereps_myo, rel=1e-5) == 6.5

    # Drop set of 10 reps @ RIR 0 with 15s rest:
    # base = 5.0; bonus = 0.5 * (10 - 5) = 2.5; total = min(10, 7.5) = 7.5
    ereps_drop = compute_effective_reps(10, rir=0.0, set_type="drop", rest_seconds=15.0)
    assert pytest.approx(ereps_drop, rel=1e-5) == 7.5

    # DC set of 4 reps @ RPE 10 with 30s rest (reps <= 5 -> bonus 0):
    # base = 5.0; bonus = 0; min(4, 5.0) = 4.0
    ereps_dc = compute_effective_reps(4, rpe=10.0, set_type="dc", rest_seconds=30.0)
    assert pytest.approx(ereps_dc, rel=1e-5) == 4.0

    # When rest > 45s, rest-pause sets lose the intra-session fatigue bonus and behave as regular sets
    ereps_myo_long_rest = compute_effective_reps(8, rpe=10.0, set_type="myorep", rest_seconds=60.0)
    assert pytest.approx(ereps_myo_long_rest, rel=1e-5) == 5.0


def test_effective_reps_pydantic_workout_set() -> None:
    """Tests compute_effective_reps on WorkoutSet Pydantic models."""
    ws = WorkoutSet(
        id="ws-1",
        workout_id="w-1",
        exercise_id="ex-bench",
        set_number=1,
        weight=100.0,
        raw_input_weight=100.0,
        reps=10,
        rpe=8.5,
        set_type="working",
        created_at="2026-10-18T10:00:00Z",
    )
    # RPE 8.5 -> RIR 1.5 -> base 3.5 -> min(10, 3.5) = 3.5
    assert pytest.approx(compute_effective_reps(ws), rel=1e-5) == 3.5


def test_effective_reps_vectorized() -> None:
    """Tests vectorized Pandas Series computation."""
    reps = pd.Series([8, 8, 10, 8, 8])
    rpes = pd.Series([8.0, 10.0, np.nan, 10.0, 10.0])
    rirs = pd.Series([np.nan, np.nan, np.nan, np.nan, np.nan])
    set_types = pd.Series(["working", "working", "working", "warmup", "myorep"])
    rests = pd.Series([np.nan, 120.0, np.nan, 90.0, 20.0])

    s_out = compute_effective_reps_vectorized(
        reps=reps,
        rpe=rpes,
        rir=rirs,
        set_type=set_types,
        rest_seconds=rests,
    )

    expected = [
        3.0,  # 8 reps @ RPE 8 working
        5.0,  # 8 reps @ RPE 10 working
        3.0,  # 10 reps unrated working (default RIR 2.0 -> 3.0)
        0.0,  # 8 reps warmup -> 0.0
        6.5,  # 8 reps myorep @ RPE 10 with 20s rest -> 6.5
    ]
    np.testing.assert_allclose(s_out.values, expected, rtol=1e-5)


# ============================================================================
# Comprehensive Unit Tests: compute_implicit_rest_seconds
# ============================================================================

def test_implicit_rest_timestamp_formats_and_clamping() -> None:
    """Tests various ISO 8601 string variations and TUT negative clamping."""
    # ISO string with UTC offset
    t1 = "2026-10-18T10:00:00+00:00"
    t2 = "2026-10-18T10:02:00+00:00"  # 120s elapsed
    # 10 reps -> 30s TUT -> 90s rest
    assert compute_implicit_rest_seconds(t1, t2, reps=10) == 90.0

    # Microseconds support
    t3 = "2026-10-18T10:00:00.000Z"
    t4 = "2026-10-18T10:01:00.000Z"  # 60s elapsed
    # 20 reps -> 60s TUT -> 0s rest
    assert compute_implicit_rest_seconds(t3, t4, reps=20) == 0.0

    # Negative elapsed (elapsed < TUT) clamped to 0.0
    assert compute_implicit_rest_seconds(t3, t4, reps=30) == 0.0


def test_workout_implicit_rests_multi_set_chronology() -> None:
    """Tests multi-set rest calculation across exercises and superset groups."""
    sets = [
        # Exercise A, Set 1
        {
            "workout_id": "w1",
            "exercise_id": "bench",
            "reps": 10,
            "created_at": "2026-10-18T10:00:00Z",
        },
        # Exercise B (different exercise), Set 1
        {
            "workout_id": "w1",
            "exercise_id": "squat",
            "reps": 5,
            "created_at": "2026-10-18T10:02:00Z",
        },
        # Exercise A, Set 2 (180s after Set 1 of bench)
        {
            "workout_id": "w1",
            "exercise_id": "bench",
            "reps": 8,  # TUT = 24s
            "created_at": "2026-10-18T10:03:00Z",
        },
        # Exercise A, Set 3 (150s after Set 2 of bench)
        {
            "workout_id": "w1",
            "exercise_id": "bench",
            "reps": 8,  # TUT = 24s
            "created_at": "2026-10-18T10:05:30Z",
        },
    ]

    rests = compute_implicit_rest_seconds(sets)
    assert isinstance(rests, list)
    assert len(rests) == 4
    # Set 0 (first bench): None
    assert rests[0] is None
    # Set 1 (first squat): None
    assert rests[1] is None
    # Set 2 (second bench): 180s - 24s = 156s
    assert pytest.approx(rests[2], rel=1e-5) == 156.0
    # Set 3 (third bench): 150s - 24s = 126s
    assert pytest.approx(rests[3], rel=1e-5) == 126.0


# ============================================================================
# Comprehensive Unit Tests: compute_intra_session_dropoff
# ============================================================================

def test_intra_session_dropoff_numeric_series() -> None:
    """Tests fractional drop-off slope delta_drop on direct e1RM sequences."""
    # N = 3 sets: e1RM = [100.0, 95.0, 90.0]
    # delta_drop = (100.0 - 90.0) / (100.0 * (3 - 1)) = 10 / 200 = 0.05
    e1rms = [100.0, 95.0, 90.0]
    dropoff = compute_intra_session_dropoff(e1rms)
    assert pytest.approx(dropoff, rel=1e-5) == 0.05

    # Single set (N = 1) -> 0.0 dropoff
    assert compute_intra_session_dropoff([100.0]) == 0.0
    assert compute_intra_session_dropoff([]) == 0.0

    # Stable performance (no dropoff)
    assert compute_intra_session_dropoff([100.0, 100.0, 100.0]) == 0.0

    # Potentiation (performance improved across sets) -> negative dropoff
    assert compute_intra_session_dropoff([100.0, 105.0]) == -0.05


def test_intra_session_dropoff_from_workout_sets() -> None:
    """Tests dropoff calculation from structured WorkoutSet models."""
    k_t = 0.10
    # Set 1: 100kg x 10 reps @ RPE 10 (RIR 0) -> 100 * 10^0.10
    # Set 2: 100kg x 9 reps @ RPE 10 (RIR 0)  -> 100 * 9^0.10
    # Set 3: 100kg x 8 reps @ RPE 10 (RIR 0)  -> 100 * 8^0.10
    e1 = 100.0 * (10.0 ** k_t)
    e3 = 100.0 * (8.0 ** k_t)
    expected_slope = (e1 - e3) / (e1 * 2.0)

    sets = [
        {"set_type": "warmup", "weight": 60.0, "reps": 10},
        {"set_type": "working", "weight": 100.0, "reps": 10, "rpe": 10.0},
        {"set_type": "working", "weight": 100.0, "reps": 9, "rpe": 10.0},
        {"set_type": "working", "weight": 100.0, "reps": 8, "rpe": 10.0},
    ]

    actual_slope = compute_intra_session_dropoff(sets, k_t=k_t)
    assert pytest.approx(actual_slope, rel=1e-5) == expected_slope

    # Test Pydantic signal model wrapper
    signal = evaluate_intra_session_dropoff(sets, k_t=k_t)
    assert isinstance(signal, IntraSessionDropoffSignal)
    assert signal.working_set_count == 3
    assert pytest.approx(signal.dropoff_slope, rel=1e-5) == expected_slope
    assert pytest.approx(signal.e1rm_first or 0.0, rel=1e-5) == e1
    assert pytest.approx(signal.e1rm_last or 0.0, rel=1e-5) == e3


# ============================================================================
# Comprehensive Unit Tests: project_e10rm
# ============================================================================

def test_project_e10rm_kalman_state_and_vectors() -> None:
    """Tests e10RM projection using KalmanState, state vectors, and scalars.

    Formula: e10RM_t = exp(x_{0, t}) * 10^{-k_t}
    If 1RM = 100 kg, k = 0.10:
    e10RM = 100 * 10^{-0.10} = 79.432823... kg
    """
    expected_10rm = 100.0 * (10.0 ** (-0.10))

    # 1. From KalmanState dataclass
    k_state = KalmanState(
        x=np.array([math.log(100.0), 0.10], dtype=np.float64),
        P=np.eye(2, dtype=np.float64) * 0.01,
    )
    assert pytest.approx(project_e10rm(k_state), rel=1e-5) == expected_10rm

    # 2. From 2-element state vector [ln(1RM), k]
    x_vec = np.array([math.log(100.0), 0.10], dtype=np.float64)
    assert pytest.approx(project_e10rm(x_vec), rel=1e-5) == expected_10rm

    # 3. Explicit keywords: e1rm and k
    assert pytest.approx(project_e10rm(e1rm=100.0, k=0.10), rel=1e-5) == expected_10rm

    # 4. Explicit keywords: ln_1rm and k
    assert pytest.approx(project_e10rm(ln_1rm=math.log(100.0), k=0.10), rel=1e-5) == expected_10rm

    # 5. Direct scalar 1RM in kg
    assert pytest.approx(project_e10rm(100.0, 0.10), rel=1e-5) == expected_10rm

    # 6. Direct scalar ln(1RM)
    assert pytest.approx(project_e10rm(math.log(100.0), 0.10, is_ln=True), rel=1e-5) == expected_10rm


# ============================================================================
# Integration Test: extract_hypertrophy_signals Pipeline
# ============================================================================

def test_extract_hypertrophy_signals_pipeline() -> None:
    """Verifies end-to-end signal extraction for a full workout session."""
    workout_sets = [
        WorkoutSet(
            id="ws-1",
            workout_id="w-1",
            exercise_id="bench",
            set_number=1,
            weight=60.0,
            raw_input_weight=60.0,
            reps=10,
            set_type="warmup",
            created_at="2026-10-18T10:00:00Z",
        ),
        WorkoutSet(
            id="ws-2",
            workout_id="w-1",
            exercise_id="bench",
            set_number=2,
            weight=100.0,
            raw_input_weight=100.0,
            reps=8,
            rpe=8.0,
            set_type="working",
            created_at="2026-10-18T10:03:00Z",  # 180s later; TUT=24s -> rest=156s
        ),
        WorkoutSet(
            id="ws-3",
            workout_id="w-1",
            exercise_id="bench",
            set_number=3,
            weight=80.0,
            raw_input_weight=80.0,
            reps=8,
            rpe=10.0,
            set_type="myorep",
            created_at="2026-10-18T10:03:45Z",  # 45s later; TUT=24s -> rest=21s (<= 45s)
        ),
    ]

    signals = extract_hypertrophy_signals(workout_sets, k_t=0.10)
    assert len(signals) == 3

    # Set 1 (warmup)
    assert signals[0].effective_reps == 0.0
    assert signals[0].implicit_rest_seconds is None
    assert signals[0].e1rm is None

    # Set 2 (working: 8 reps @ RPE 8)
    assert pytest.approx(signals[1].effective_reps, rel=1e-5) == 3.0
    assert pytest.approx(signals[1].implicit_rest_seconds or 0.0, rel=1e-5) == 156.0
    # e1RM = 100 * (8 + 2)^0.10
    assert pytest.approx(signals[1].e1rm or 0.0, rel=1e-5) == 100.0 * (10.0 ** 0.10)

    # Set 3 (myorep: 8 reps @ RPE 10 with 21s rest -> 6.5 eReps)
    assert pytest.approx(signals[2].effective_reps, rel=1e-5) == 6.5
    assert pytest.approx(signals[2].implicit_rest_seconds or 0.0, rel=1e-5) == 21.0
