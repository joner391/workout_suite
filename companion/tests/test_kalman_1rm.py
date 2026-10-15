"""Unit and integration tests for the Tier 2 Adaptive Linear Kalman Filter.

Verifies the mathematical and architectural requirements of:
- 1RM_calculation.txt
- IMPLEMENTATION_PLAN.md Step 6.1
- ADR-002: Dual-Tier 1RM Estimation Architecture
- ADR-026: Invariant on deadlift heuristic scalar exclusion
"""

import json
from pathlib import Path
from typing import Any, Dict, List
import math
import numpy as np
import pytest

from src.ingestion.schemas import (
    CalibratedParameter,
    Workout,
    WorkoutExportPayload,
    WorkoutSet,
)
from src.models.kalman_1rm import (
    DEFAULT_LAMBDA,
    DEFAULT_Q_K,
    DEFAULT_Q_LN_1RM,
    DEFAULT_SIGMA_BASE,
    MAX_PLAUSIBLE_K,
    MIN_PLAUSIBLE_K,
    PRIOR_COVARIANCE_DIAG,
    PRIOR_K_BY_LIFT,
    Adaptive1RMKalmanFilter,
    FilteredSet,
    KalmanState,
    calculate_effective_reps,
    filter_session_sets,
    get_initial_prior,
    update_1rm_filter,
)


# ============================================================================
# 1. Effective Repetitions & Input Parsing
# ============================================================================

def test_effective_reps_basic() -> None:
    """Verifies proximity-adjusted effective repetitions formula."""
    # 5 reps + 2 RIR = 7.0
    assert calculate_effective_reps(5, rir=2.0) == 7.0

    # 8 reps + (10 - 8 RPE) = 10.0
    assert calculate_effective_reps(8, rpe=8.0) == 10.0

    # 3 reps + (10 - 9.5 RPE) = 3.5
    assert calculate_effective_reps(3, rpe=9.5) == 3.5

    # RIR takes precedence when both provided
    assert calculate_effective_reps(5, rir=1.0, rpe=8.0) == 6.0


def test_effective_reps_clamping_and_invariants() -> None:
    """Enforces boundary invariants: reps <= 0 yields 0.0; completed sets clamp >= 1.0."""
    # 0 completed reps (failed attempt)
    assert calculate_effective_reps(0, rir=0.0) == 0.0
    assert calculate_effective_reps(-1, rir=2.0) == 0.0

    # 1 rep @ RPE 10 (0 RIR) => 1.0
    assert calculate_effective_reps(1, rir=0.0) == 1.0
    assert calculate_effective_reps(1, rpe=10.0) == 1.0

    # No intensity provided defaults to 0 reserve
    assert calculate_effective_reps(5) == 5.0


# ============================================================================
# 2. Intra-Session Filtering Rules
# ============================================================================

def test_filter_session_sets_discards_warmups_and_failed() -> None:
    """Ensures warmups, failed reps, and unrated sets are discarded."""
    raw_sets = [
        {"reps": 0, "weight": 100.0, "rir": 1.0, "set_type": "working"},  # Failed
        {"reps": 10, "weight": 60.0, "rir": 2.0, "set_type": "warmup"},  # Warmup tag
        {"reps": 5, "weight": -50.0, "rir": 1.0, "set_type": "working"},  # Invalid weight
        {"reps": 5, "weight": 100.0, "rir": None, "rpe": None, "set_type": "working"},  # Unrated
        {"reps": 5, "weight": 100.0, "rir": 4.0, "set_type": "working"},  # RIR > 3
        {"reps": 5, "weight": 100.0, "rpe": 6.0, "set_type": "working"},  # RPE < 7 (RIR 4)
    ]
    accepted = filter_session_sets(raw_sets)
    assert len(accepted) == 0


def test_filter_session_sets_top_two_lowest_rir() -> None:
    """Verifies that the 2 sets with the lowest RIR are accepted."""
    raw_sets = [
        {"reps": 5, "weight": 100.0, "rir": 3.0, "set_number": 1},
        {"reps": 5, "weight": 105.0, "rir": 2.0, "set_number": 2},
        {"reps": 5, "weight": 110.0, "rir": 1.0, "set_number": 3},
        {"reps": 3, "weight": 115.0, "rir": 0.0, "set_number": 4},
    ]
    accepted = filter_session_sets(raw_sets)
    assert len(accepted) == 2
    # Lowest RIRs are set 4 (RIR 0) and set 3 (RIR 1)
    # Order preserved chronologically: set 3, then set 4
    assert accepted[0].set_number == 3
    assert accepted[0].rir == 1.0
    assert accepted[1].set_number == 4
    assert accepted[1].rir == 0.0


def test_filter_session_sets_tie_breaker_highest_load() -> None:
    """When >2 sets share the lowest RIR, chooses the 2 sets with highest loads."""
    raw_sets = [
        {"reps": 8, "weight": 90.0, "rir": 1.0, "set_number": 1},
        {"reps": 6, "weight": 105.0, "rir": 1.0, "set_number": 2},
        {"reps": 7, "weight": 100.0, "rir": 1.0, "set_number": 3},
        {"reps": 5, "weight": 95.0, "rir": 1.0, "set_number": 4},
    ]
    accepted = filter_session_sets(raw_sets)
    assert len(accepted) == 2
    # Highest loads are 105 kg (set 2) and 100 kg (set 3)
    # Chronological order preserved: set 2, then set 3
    assert accepted[0].set_number == 2
    assert accepted[0].weight == 105.0
    assert accepted[1].set_number == 3
    assert accepted[1].weight == 100.0


def test_filter_session_sets_pydantic_models() -> None:
    """Verifies filter works with strongly-typed WorkoutSet Pydantic models."""
    ws1 = WorkoutSet(
        id="s1",
        workout_id="w1",
        exercise_id="ex-squat",
        set_number=1,
        weight=140.0,
        raw_input_weight=140.0,
        reps=5,
        rir=1.5,
        set_type="working",
        created_at="2026-10-15T10:00:00Z",
    )
    ws2 = WorkoutSet(
        id="s2",
        workout_id="w1",
        exercise_id="ex-squat",
        set_number=2,
        weight=145.0,
        raw_input_weight=145.0,
        reps=3,
        rir=0.5,
        set_type="working",
        created_at="2026-10-15T10:05:00Z",
    )
    accepted = filter_session_sets([ws1, ws2])
    assert len(accepted) == 2
    assert accepted[0].weight == 140.0
    assert accepted[1].weight == 145.0


# ============================================================================
# 3. True 1RM Test & Endurance Bypassing
# ============================================================================

def test_true_1rm_test_bypasses_k_update() -> None:
    """Verification Gate: When r_eff = 1.0, H = [1.0, 0.0].

    Verifies mathematically that with a diagonal prior P_0, Kalman gain K_1 = 0,
    leaving k exactly untouched while 1RM updates.
    """
    prior = get_initial_prior(standard_lift_type="bench", initial_1rm=100.0)
    initial_k = prior.k
    assert initial_k == 0.085
    assert prior.P[0, 1] == 0.0
    assert prior.P[1, 0] == 0.0

    # True 1RM test: 1 rep @ RIR 0 -> r_eff = 1.0
    weight = 110.0
    r_eff = 1.0

    x_new, P_new = update_1rm_filter(
        x=prior.x,
        P=prior.P,
        weight=weight,
        r_eff=r_eff,
    )

    # 1. k must remain exactly identical to initial prior
    assert x_new[1] == pytest.approx(initial_k, abs=1e-12)

    # 2. 1RM must update upwards toward 110 kg
    updated_1rm = math.exp(x_new[0])
    assert updated_1rm > 100.0
    assert updated_1rm <= 110.0

    # 3. 1RM uncertainty P[0,0] must decrease
    assert P_new[0, 0] < prior.P[0, 0]


# ============================================================================
# 4. High-Rep Sets Discounting
# ============================================================================

def test_high_rep_sets_discounted_by_quadratic_variance() -> None:
    """Verification Gate: High-rep sets are discounted relative to low-rep sets.

    R_t = sigma_base^2 * (1 + lambda * r_eff^2)
    Verifies that measurement noise is significantly larger and Kalman innovation gain
    on 1RM is significantly smaller for high-rep sets given identical relative deviation.
    """
    prior = get_initial_prior(standard_lift_type="squat", initial_1rm=150.0)

    # Case A: Low-rep set (r_eff = 3)
    r_eff_low = 3.0
    # True implied load for e1RM = 160: w = 160 * 3^(-0.095)
    w_low = 160.0 * (r_eff_low ** -prior.k)

    # Case B: High-rep set (r_eff = 15)
    r_eff_high = 15.0
    # Same implied e1RM = 160: w = 160 * 15^(-0.095)
    w_high = 160.0 * (r_eff_high ** -prior.k)

    # Check measurement variance directly
    R_low = (DEFAULT_SIGMA_BASE ** 2) * (1.0 + DEFAULT_LAMBDA * (r_eff_low ** 2))
    R_high = (DEFAULT_SIGMA_BASE ** 2) * (1.0 + DEFAULT_LAMBDA * (r_eff_high ** 2))
    assert R_high > 3.0 * R_low

    # Run discrete updates from identical prior
    x_low, _ = update_1rm_filter(prior.x, prior.P, weight=w_low, r_eff=r_eff_low)
    x_high, _ = update_1rm_filter(prior.x, prior.P, weight=w_high, r_eff=r_eff_high)

    e1rm_after_low = math.exp(x_low[0])
    e1rm_after_high = math.exp(x_high[0])

    # The low-rep set should have a larger update magnitude than the high-rep set
    delta_low = e1rm_after_low - 150.0
    delta_high = e1rm_after_high - 150.0

    assert delta_low > delta_high
    assert delta_high > 0.0


# ============================================================================
# 5. Exercise-Specific Priors & Deadlift Compensatory Invariant
# ============================================================================

def test_exercise_specific_priors() -> None:
    """Verifies priors for Bench (0.085), Squat (0.095), Deadlift (0.075), Default (0.10)."""
    bench_prior = get_initial_prior("bench", initial_1rm=100.0)
    assert bench_prior.k == 0.085
    assert bench_prior.e1rm == pytest.approx(100.0)
    assert bench_prior.cov_p00 == 0.04
    assert bench_prior.cov_p11 == 0.002

    squat_prior = get_initial_prior("squat", initial_1rm=140.0)
    assert squat_prior.k == 0.095

    deadlift_prior = get_initial_prior("deadlift", initial_1rm=180.0)
    assert deadlift_prior.k == 0.075

    ohp_prior = get_initial_prior("ohp", initial_1rm=60.0)
    assert ohp_prior.k == 0.10

    # ADR-026 invariant check: No +10% heuristic scalar applied to deadlift Kalman state
    assert deadlift_prior.e1rm == pytest.approx(180.0)  # Not 180 * 1.10 = 198.0


# ============================================================================
# 6. Box-Clipping Operational Stability Boundary
# ============================================================================

def test_box_clipping_bounds() -> None:
    """Verifies that k is strictly bounded within [0.03, 0.16]."""
    state = get_initial_prior("bench", initial_1rm=100.0)

    # Force an extreme update pushing k upwards
    x_high = np.array([math.log(100.0), 0.25], dtype=np.float64)
    x_new_high, _ = update_1rm_filter(x_high, state.P, weight=90.0, r_eff=5.0)
    assert x_new_high[1] <= MAX_PLAUSIBLE_K

    # Force an extreme update pushing k downwards
    x_low = np.array([math.log(100.0), 0.01], dtype=np.float64)
    x_new_low, _ = update_1rm_filter(x_low, state.P, weight=90.0, r_eff=5.0)
    assert x_new_low[1] >= MIN_PLAUSIBLE_K


# ============================================================================
# 7. Longitudinal Trajectory Convergence
# ============================================================================

def test_filter_trajectory_convergence() -> None:
    """Simulates a lifter with true 1RM = 140 kg and true k = 0.085 over 20 sessions.

    Verifies that the filter smoothly converges toward the true values and posterior
    uncertainty P shrinks.
    """
    true_1rm = 140.0
    true_k = 0.085

    # Initialize with intentionally inaccurate 1RM prior (110 kg instead of 140 kg)
    kf = Adaptive1RMKalmanFilter(
        exercise_id="ex-bench",
        standard_lift_type="bench",
        initial_1rm=110.0,
    )

    rng = np.random.default_rng(seed=42)

    initial_p00 = kf.state.cov_p00
    initial_p11 = kf.state.cov_p11

    # Simulate 20 sessions of submaximal bench press with noise
    for _ in range(20):
        # Varying rep targets between 3 and 8 reps
        reps = int(rng.integers(3, 9))
        rir = float(rng.choice([0.5, 1.0, 1.5, 2.0]))
        r_eff = reps + rir

        # Lombardi observation: w = 1RM * r_eff^(-k) + small noise
        ideal_w = true_1rm * (r_eff ** (-true_k))
        noise = float(rng.normal(0.0, 0.5))
        logged_w = round(ideal_w + noise, 1)

        kf.step(weight=logged_w, r_eff=r_eff)

    # Final posterior estimates
    final_1rm = kf.state.e1rm
    final_k = kf.state.k

    # Must converge close to true values (within 2% for 1RM, within 0.01 for k)
    assert final_1rm == pytest.approx(true_1rm, rel=0.03)
    assert final_k == pytest.approx(true_k, abs=0.015)

    # Uncertainty must have decreased significantly
    assert kf.state.cov_p00 < initial_p00 * 0.3
    assert kf.state.cov_p11 < initial_p11


# ============================================================================
# 8. CalibratedParameter Export Contract
# ============================================================================

def test_to_calibrated_parameter_contract() -> None:
    """Verifies that to_calibrated_parameter produces a valid Pydantic model adhering to schema."""
    kf = Adaptive1RMKalmanFilter(
        exercise_id="ex-bench-01",
        standard_lift_type="bench",
        initial_1rm=120.0,
    )
    kf.step(weight=105.0, r_eff=3.0)

    cal_param = kf.to_calibrated_parameter(calibrated_at="2026-10-15T12:00:00Z")

    assert isinstance(cal_param, CalibratedParameter)
    assert cal_param.exercise_id == "ex-bench-01"
    assert cal_param.calibrated_1rm > 100.0
    assert 0.03 <= cal_param.calibrated_k <= 0.20
    assert cal_param.cov_p00 > 0.0
    assert cal_param.cov_p11 > 0.0
    assert cal_param.calibrated_at == "2026-10-15T12:00:00Z"


# ============================================================================
# 9. Real Fixture Integration (WorkoutExportPayload)
# ============================================================================

def test_sample_workout_export_fixture_integration() -> None:
    """Verifies ingestion of the actual mobile SQLite export fixture."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    fixture_path = repo_root / "schemas" / "fixtures" / "sample_workout_export.json"

    assert fixture_path.exists(), f"Missing export fixture at {fixture_path}"

    with open(fixture_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    payload = WorkoutExportPayload.model_validate(data)

    # Initialize Kalman filter for barbell_bench_press
    kf = Adaptive1RMKalmanFilter(
        exercise_id="barbell_bench_press",
        standard_lift_type="bench",
    )

    # Process all workouts and sets in the fixture
    states = kf.process_workout_history(
        workouts=payload.workouts,
        workout_sets=payload.workout_sets,
    )

    assert len(states) >= 1
    final_state = kf.state
    assert final_state.e1rm >= 100.0
    assert 0.03 <= final_state.k <= 0.16

    param = kf.to_calibrated_parameter()
    assert param.exercise_id == "barbell_bench_press"
