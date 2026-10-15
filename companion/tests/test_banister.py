"""Unit and integration tests for Banister Impulse-Response & Dynamic Recoverability.

Verifies:
- Rough_sketch.md Section 4.2, 4.3, 4.4, 4.5
- IMPLEMENTATION_PLAN.md Step 6.2
- ADR-003: Dynamic Recoverability in Banister Impulse-Response Modeling
"""

from datetime import date, timedelta
import json
from pathlib import Path
import math
import pytest

from src.ingestion.schemas import BodyMetric, Workout, WorkoutExportPayload, WorkoutSet
from src.models.fatigue_banister import (
    DEFAULT_K1,
    DEFAULT_K2,
    DEFAULT_TAU1_DAYS,
    DailyPreparedness,
    calculate_set_stimulus,
    compute_daily_banister_series,
)
from src.models.recommendations import (
    ACWR_DELOAD_THRESHOLD,
    ACWR_UNDER_STIMULATION_THRESHOLD,
    TrainingAdvisory,
    calculate_acwr,
    compute_training_advisories,
    generate_advisory_for_day,
    get_latest_advisory,
)
from src.models.recovery_modifier import (
    DEFAULT_TAU2_BASE_DAYS,
    RecoveryState,
    compute_bodyweight_slope,
    compute_recovery_modifier,
)


# ============================================================================
# 1. Dynamic Recoverability (Delta BW / Delta t) Tests
# ============================================================================

def test_bodyweight_slope_surplus() -> None:
    """Verifies that steady weight gain is classified as SURPLUS with shortened tau_2."""
    # Athlete gaining 0.40 kg over 10 days (~0.28 kg/week)
    base_date = date(2026, 10, 1)
    metrics: list[BodyMetric] = []
    for day in range(11):
        log_date = base_date + timedelta(days=day)
        weight = 80.0 + (day * 0.04)  # 80.0 to 80.40 kg
        metrics.append(
            BodyMetric(
                id=f"bm-{day}",
                date=log_date.isoformat(),
                bodyweight=weight,
            )
        )

    rec = compute_recovery_modifier(metrics, target_date="2026-10-11")
    assert rec.energy_balance == "SURPLUS"
    assert rec.slope_kg_per_week == pytest.approx(0.28, abs=0.02)
    # Surplus shortens tau_2 (multiplier < 1.0)
    assert 0.75 <= rec.tau2_multiplier <= 0.90
    assert rec.effective_tau2 < DEFAULT_TAU2_BASE_DAYS


def test_bodyweight_slope_deficit() -> None:
    """Verifies that steady weight loss is classified as DEFICIT with lengthened tau_2."""
    # Athlete losing 0.50 kg over 10 days (~ -0.35 kg/week)
    base_date = date(2026, 10, 1)
    metrics: list[BodyMetric] = []
    for day in range(11):
        log_date = base_date + timedelta(days=day)
        weight = 85.0 - (day * 0.05)  # 85.0 down to 84.5 kg
        metrics.append(
            BodyMetric(
                id=f"bm-{day}",
                date=log_date.isoformat(),
                bodyweight=weight,
            )
        )

    rec = compute_recovery_modifier(metrics, target_date="2026-10-11")
    assert rec.energy_balance == "DEFICIT"
    assert rec.slope_kg_per_week < -0.20
    # Deficit lengthens tau_2 (multiplier > 1.0)
    assert 1.15 <= rec.tau2_multiplier <= 1.30
    assert rec.effective_tau2 > DEFAULT_TAU2_BASE_DAYS


def test_bodyweight_slope_maintenance_and_insufficient() -> None:
    """Verifies maintenance slope and handling of insufficient data (< 2 points)."""
    # 1 point only
    single_metric = [BodyMetric(id="bm-1", date="2026-10-10", bodyweight=80.0)]
    rec_insufficient = compute_recovery_modifier(single_metric, target_date="2026-10-10")
    assert rec_insufficient.energy_balance == "INSUFFICIENT_DATA"
    assert rec_insufficient.tau2_multiplier == 1.0
    assert rec_insufficient.effective_tau2 == DEFAULT_TAU2_BASE_DAYS

    # Stable weight across 14 days
    base_date = date(2026, 10, 1)
    flat_metrics = [
        BodyMetric(id="bm-1", date="2026-10-01", bodyweight=80.0),
        BodyMetric(id="bm-2", date="2026-10-07", bodyweight=80.05),
        BodyMetric(id="bm-3", date="2026-10-14", bodyweight=80.0),
    ]
    rec_flat = compute_recovery_modifier(flat_metrics, target_date="2026-10-14")
    assert rec_flat.energy_balance == "MAINTENANCE"
    assert rec_flat.tau2_multiplier == 1.0
    assert rec_flat.effective_tau2 == DEFAULT_TAU2_BASE_DAYS


def test_bodyweight_window_filtering() -> None:
    """Ensures logs older than 14 days from target date are excluded from slope."""
    metrics = [
        # Outside 14-day window (25 days ago)
        BodyMetric(id="bm-old", date="2026-09-15", bodyweight=70.0),
        # Inside 14-day window (target is 2026-10-15)
        BodyMetric(id="bm-1", date="2026-10-05", bodyweight=80.0),
        BodyMetric(id="bm-2", date="2026-10-15", bodyweight=80.0),
    ]
    rec = compute_recovery_modifier(metrics, target_date="2026-10-15")
    assert rec.sample_count == 2
    assert rec.energy_balance == "MAINTENANCE"


# ============================================================================
# 2. Effective Stimulating Set Stimulus Tests
# ============================================================================

def test_calculate_set_stimulus_exertion_scaling() -> None:
    """Verifies stimulus formula: (1.0 + (eff_rpe - 7) / 3) * (weight / 1RM)."""
    # 1RM = 100 kg, Load = 80 kg (intensity_ratio = 0.8)
    e1rm = 100.0

    # RPE 7.0: multiplier = 1.0 -> stimulus = 1.0 * 0.8 = 0.80
    set_rpe7 = {"weight": 80.0, "reps": 6, "rpe": 7.0, "set_type": "working"}
    assert calculate_set_stimulus(set_rpe7, known_1rm=e1rm) == pytest.approx(0.80, abs=1e-3)

    # RPE 8.5: multiplier = 1.5 -> stimulus = 1.5 * 0.8 = 1.20
    set_rpe85 = {"weight": 80.0, "reps": 6, "rpe": 8.5, "set_type": "working"}
    assert calculate_set_stimulus(set_rpe85, known_1rm=e1rm) == pytest.approx(1.20, abs=1e-3)

    # RPE 10.0: multiplier = 2.0 -> stimulus = 2.0 * 0.8 = 1.60
    set_rpe10 = {"weight": 80.0, "reps": 6, "rpe": 10.0, "set_type": "working"}
    assert calculate_set_stimulus(set_rpe10, known_1rm=e1rm) == pytest.approx(1.60, abs=1e-3)


def test_calculate_set_stimulus_rir_conversion() -> None:
    """Verifies RIR conversion: RIR 1.5 equates to RPE 8.5."""
    e1rm = 100.0
    set_rir15 = {"weight": 80.0, "reps": 6, "rir": 1.5, "set_type": "working"}
    assert calculate_set_stimulus(set_rir15, known_1rm=e1rm) == pytest.approx(1.20, abs=1e-3)

    # RIR 0.0 equates to RPE 10.0
    set_rir0 = {"weight": 80.0, "reps": 6, "rir": 0.0, "set_type": "working"}
    assert calculate_set_stimulus(set_rir0, known_1rm=e1rm) == pytest.approx(1.60, abs=1e-3)


def test_calculate_set_stimulus_exclusions() -> None:
    """Verifies warmups, low RPE (<7.0 / RIR > 3.0), and 0-rep sets return 0.0."""
    e1rm = 100.0
    # Warmup tag
    assert calculate_set_stimulus({"weight": 80.0, "reps": 5, "rpe": 8.0, "set_type": "warmup"}, known_1rm=e1rm) == 0.0

    # RPE < 7.0 (RIR > 3)
    assert calculate_set_stimulus({"weight": 80.0, "reps": 5, "rpe": 6.5, "set_type": "working"}, known_1rm=e1rm) == 0.0
    assert calculate_set_stimulus({"weight": 80.0, "reps": 5, "rir": 4.0, "set_type": "working"}, known_1rm=e1rm) == 0.0

    # 0 completed reps
    assert calculate_set_stimulus({"weight": 80.0, "reps": 0, "rpe": 10.0, "set_type": "working"}, known_1rm=e1rm) == 0.0


# ============================================================================
# 3. Banister Impulse-Response Integration Tests
# ============================================================================

def test_banister_single_workout_impulse_response() -> None:
    """Verifies the classic two-component impulse response curve.

    After an acute workout impulse:
    1. Acute Fatigue initially dominates Fitness (Net Preparedness dips negative).
    2. Fatigue dissipates rapidly (tau2 ~ 11d) while Fitness decays slowly (tau1 ~ 42d).
    3. Net Preparedness rebounds into positive territory ('supercompensation').
    """
    workouts = [
        Workout(
            id="w-01",
            date="2026-10-01",
            name="Heavy Upper",
            started_at="2026-10-01T10:00:00Z",
            status="completed",
        )
    ]
    # 4 stimulating sets generating ~5.0 total stimulus
    workout_sets = [
        WorkoutSet(
            id=f"s-{i}",
            workout_id="w-01",
            exercise_id="bench",
            set_number=i,
            weight=100.0,
            raw_input_weight=100.0,
            reps=5,
            rpe=9.0,
            set_type="working",
            created_at="2026-10-01T10:15:00Z",
        )
        for i in range(1, 5)
    ]

    # Integrate across 30 days
    series = compute_daily_banister_series(
        workouts=workouts,
        workout_sets=workout_sets,
        start_date="2026-10-01",
        end_date="2026-10-30",
        known_1rms={"bench": 120.0},
    )

    assert len(series) == 30

    day1 = series[0]
    assert day1.stimulus > 4.0
    # On day 1: k2 * Fatigue > k1 * Fitness -> Net Preparedness is negative
    assert day1.fatigue > 4.0
    assert day1.fitness > 4.0
    assert day1.preparedness < 0.0  # Acute fatigue dip

    # By Day 12-16: Fatigue has decayed substantially faster than Fitness
    day14 = series[13]
    assert day14.fatigue < day1.fatigue * 0.35  # ~e^(-13/11) ~ 0.30
    assert day14.fitness > day1.fitness * 0.70  # ~e^(-13/42) ~ 0.73
    # Supercompensation: Preparedness becomes positive!
    assert day14.preparedness > 0.0


def test_banister_surplus_accelerates_preparedness_recovery() -> None:
    """Verifies that nutritional surplus accelerates recovery compared to deficit."""
    workouts = [
        Workout(id="w-1", date="2026-10-01", name="Heavy Lower", started_at="2026-10-01T10:00:00Z", status="completed")
    ]
    sets = [
        WorkoutSet(
            id="s-1", workout_id="w-1", exercise_id="squat", set_number=1, weight=140.0, raw_input_weight=140.0, reps=5, rpe=9.5, set_type="working", created_at="2026-10-01T10:00:00Z"
        )
    ]

    # Surplus metrics (+0.4 kg/week)
    surplus_metrics = [
        BodyMetric(id="bm-1", date="2026-09-25", bodyweight=80.0),
        BodyMetric(id="bm-2", date="2026-10-05", bodyweight=80.6),
    ]

    # Deficit metrics (-0.4 kg/week)
    deficit_metrics = [
        BodyMetric(id="bm-3", date="2026-09-25", bodyweight=80.6),
        BodyMetric(id="bm-4", date="2026-10-05", bodyweight=80.0),
    ]

    series_surplus = compute_daily_banister_series(workouts, sets, body_metrics=surplus_metrics, start_date="2026-10-01", end_date="2026-10-10", known_1rms={"squat": 160.0})
    series_deficit = compute_daily_banister_series(workouts, sets, body_metrics=deficit_metrics, start_date="2026-10-01", end_date="2026-10-10", known_1rms={"squat": 160.0})

    # On Day 7, surplus should have dissipated more fatigue than deficit
    day7_surplus = series_surplus[6]
    day7_deficit = series_deficit[6]

    assert day7_surplus.fatigue < day7_deficit.fatigue
    assert day7_surplus.preparedness > day7_deficit.preparedness


# ============================================================================
# 4. ACWR & Structured Training Advisories Tests
# ============================================================================

def test_acwr_calculation_spike_and_deload_warning() -> None:
    """Verifies that an acute volume spike generates ACWR > 1.5 and a DELOAD_WARNING."""
    # Baseline steady training: 2.0 stimulus per day for 28 days
    history = [2.0] * 28

    # Day 28: sudden spike to 8.0 stimulus for 3 days
    history.extend([8.0, 8.0, 8.0])

    acute, chronic, acwr = calculate_acwr(history, index=len(history) - 1)
    assert acwr > ACWR_DELOAD_THRESHOLD  # ACWR > 1.5

    day_state = DailyPreparedness(
        date="2026-10-31",
        stimulus=8.0,
        fitness=15.0,
        fatigue=25.0,
        preparedness=-10.0,
        tau2=11.0,
        energy_balance="MAINTENANCE",
    )
    advisory = generate_advisory_for_day(day_state, acute, chronic, acwr)

    assert advisory.advisory_type == "DELOAD_WARNING"
    assert advisory.recommended_volume_multiplier == 0.70
    assert advisory.recommended_intensity_delta_percent == -10.0


def test_acwr_under_stimulation() -> None:
    """Verifies that a drop in training generates ACWR < 0.8 and UNDER_STIMULATION."""
    # Chronic baseline: 5.0 stimulus per day
    history = [5.0] * 28
    # Past 7 days: dropped to 1.0 stimulus per day
    history.extend([1.0] * 7)

    acute, chronic, acwr = calculate_acwr(history, index=len(history) - 1)
    assert acwr < ACWR_UNDER_STIMULATION_THRESHOLD  # ACWR < 0.80

    day_state = DailyPreparedness(
        date="2026-11-07",
        stimulus=1.0,
        fitness=10.0,
        fatigue=2.0,
        preparedness=5.0,
        tau2=11.0,
        energy_balance="MAINTENANCE",
    )
    advisory = generate_advisory_for_day(day_state, acute, chronic, acwr)

    assert advisory.advisory_type == "UNDER_STIMULATION"
    assert advisory.recommended_volume_multiplier == 1.20
    assert advisory.recommended_intensity_delta_percent == 0.0


def test_acwr_optimal_overload() -> None:
    """Verifies that stable progressive workload with positive preparedness yields OPTIMAL_OVERLOAD."""
    # Consistent progressive training: 3.0 stimulus per day
    history = [3.0] * 35

    acute, chronic, acwr = calculate_acwr(history, index=len(history) - 1)
    assert 0.80 <= acwr <= 1.30

    day_state = DailyPreparedness(
        date="2026-11-15",
        stimulus=3.0,
        fitness=12.0,
        fatigue=5.0,
        preparedness=2.0,  # Positive net preparedness
        tau2=11.0,
        energy_balance="MAINTENANCE",
    )
    advisory = generate_advisory_for_day(day_state, acute, chronic, acwr)

    assert advisory.advisory_type == "OPTIMAL_OVERLOAD"
    assert advisory.recommended_volume_multiplier == 1.00
    assert advisory.recommended_intensity_delta_percent == 2.5


# ============================================================================
# 5. Full Real-World Fixture Integration
# ============================================================================

def test_sample_workout_export_banister_pipeline() -> None:
    """Verifies complete end-to-end integration with sample_workout_export.json."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    fixture_path = repo_root / "schemas" / "fixtures" / "sample_workout_export.json"

    assert fixture_path.exists(), f"Fixture missing at {fixture_path}"

    with open(fixture_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    payload = WorkoutExportPayload.model_validate(data)

    # 1. Run Banister integration
    series = compute_daily_banister_series(
        workouts=payload.workouts,
        workout_sets=payload.workout_sets,
        body_metrics=payload.body_metrics,
        known_1rms={"barbell_bench_press": 125.0},
    )

    assert len(series) >= 1
    assert series[0].stimulus > 0.0

    # 2. Run recommendations engine
    advisories = compute_training_advisories(series)
    assert len(advisories) == len(series)

    latest = get_latest_advisory(series)
    assert latest is not None
    assert latest.advisory_type in [
        "OPTIMAL_OVERLOAD",
        "DELOAD_WARNING",
        "UNDER_STIMULATION",
        "OVERREACHING",
        "MAINTENANCE",
    ]
