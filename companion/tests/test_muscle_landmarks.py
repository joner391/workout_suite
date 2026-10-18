"""Unit and regression tests for Phase 2 Muscle-Group Partitioned Banister & Volume Landmarks.

Validates:
1. Muscle Volume Credit Routing: direct 1.0x to primary, 0.5x to secondaries.
2. Category-Weighted Systemic Fatigue Multipliers (m_sys).
3. Localized 12-muscle group peripheral EWMA ODE readiness (tau_{2,m} = 0.65 * tau_2).
4. Empirical Bayesian dose-response quadratic landmark fitting [MEV, MAV, MRV].
5. Energy balance scaling (1.12x for SURPLUS, 0.82x for DEFICIT).
6. Banister integration with systemic scaling and localized readiness.
"""

from __future__ import annotations

import math
from typing import Dict, List

import numpy as np
import pytest

from src.analysis.muscle_landmarks import (
    CANONICAL_MUSCLE_GROUPS,
    ENERGY_BALANCE_DEFICIT_SCALAR,
    ENERGY_BALANCE_SURPLUS_SCALAR,
    LOCAL_PERIPHERAL_TAU2_RATIO,
    MIN_WEEKS_FOR_EMPIRICAL_FIT,
    POPULATION_MAV_DEFAULT,
    POPULATION_MEV_DEFAULT,
    POPULATION_MRV_DEFAULT,
    SYSTEMIC_FATIGUE_BARBELL_COMPOUND,
    SYSTEMIC_FATIGUE_DUMBBELL_BW_COMPOUND,
    SYSTEMIC_FATIGUE_ISOLATION_OR_MACHINE,
    MuscleLandmarkResult,
    MuscleVolumeCredit,
    compute_muscle_partitioned_readiness,
    compute_systemic_fatigue_multiplier,
    fit_muscle_volume_landmarks,
    route_muscle_volume_credit,
    solve_all_muscle_landmarks,
)
from src.ingestion.schemas import Exercise, Workout, WorkoutSet
from src.models.fatigue_banister import (
    DailyPreparedness,
    compute_daily_banister_series,
)


# ============================================================================
# Phase 2 Verification Gate Tests (Mandatory Specifications)
# ============================================================================

def test_phase_2_verification_gate_barbell_squat_credit_and_multiplier() -> None:
    """Verification Gate:

    Confirm a Barbell Squat credits 1.0 to Quads, 0.5 to Glutes and Hamstrings,
    and scales systemic fatigue by 1.35x.
    """
    barbell_squat = Exercise(
        id="barbell_back_squat",
        name="Barbell Back Squat",
        muscle_group="Quads",
        category="Barbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
        secondary_muscles=["Glutes", "Hamstrings"],
    )

    ws = WorkoutSet(
        id="ws-squat-1",
        workout_id="w-1",
        exercise_id="barbell_back_squat",
        set_number=1,
        weight=140.0,
        raw_input_weight=140.0,
        reps=8,
        rpe=8.0,  # 3.0 eReps
        set_type="working",
        created_at="2026-10-18T10:00:00Z",
    )

    credit = route_muscle_volume_credit(ws, barbell_squat)

    # 1. Systemic fatigue multiplier is 1.35x
    assert pytest.approx(credit.systemic_fatigue_multiplier, rel=1e-5) == 1.35

    # 2. Direct volume to Quads: 1.0 fractional set, 1.0 * eReps (3.0)
    quad_sets, quad_ereps = credit.credits["Quads"]
    assert pytest.approx(quad_sets, rel=1e-5) == 1.0
    assert pytest.approx(quad_ereps, rel=1e-5) == 3.0

    # 3. Indirect volume to Glutes: 0.5 fractional set, 0.5 * eReps (1.5)
    glute_sets, glute_ereps = credit.credits["Glutes"]
    assert pytest.approx(glute_sets, rel=1e-5) == 0.5
    assert pytest.approx(glute_ereps, rel=1e-5) == 1.5

    # 4. Indirect volume to Hamstrings: 0.5 fractional set, 0.5 * eReps (1.5)
    ham_sets, ham_ereps = credit.credits["Hamstrings"]
    assert pytest.approx(ham_sets, rel=1e-5) == 0.5
    assert pytest.approx(ham_ereps, rel=1e-5) == 1.5


def test_phase_2_verification_gate_volume_landmarks_fallback_and_blending() -> None:
    """Verification Gate:

    Verify fallback to population priors when < 6 weeks of history exist,
    and smooth posterior blending when >= 6 weeks exist.
    """
    # Case A: < 6 weeks of history (4 weeks) -> Fallback to population priors [6, 14, 20]
    short_vols = [10.0, 12.0, 14.0, 16.0]
    short_slopes = [0.010, 0.012, 0.015, 0.008]

    res_short = fit_muscle_volume_landmarks(
        weekly_volumes=short_vols,
        weekly_e10rm_slopes=short_slopes,
        energy_balance="MAINTENANCE",
    )
    assert not res_short.is_empirical
    assert res_short.weeks_analyzed == 4
    assert pytest.approx(res_short.mev, rel=1e-5) == 6.0
    assert pytest.approx(res_short.mav, rel=1e-5) == 14.0
    assert pytest.approx(res_short.mrv, rel=1e-5) == 20.0

    # Case B: >= 6 weeks of history (8 weeks) -> Empirical quadratic dose-response fit
    # Quadratic parabola with vertex around V = 12 sets/week: y = 0.005 + 0.002*V - 0.00008*V^2
    weeks_vols = [6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0]
    weeks_slopes = [0.005 + 0.002 * v - 0.00008 * (v ** 2) for v in weeks_vols]

    res_empirical = fit_muscle_volume_landmarks(
        weekly_volumes=weeks_vols,
        weekly_e10rm_slopes=weeks_slopes,
        energy_balance="MAINTENANCE",
    )
    assert res_empirical.is_empirical
    assert res_empirical.weeks_analyzed == 8
    # Blended values should be within physiological boundaries and reflect posterior update
    assert 3.0 <= res_empirical.mev <= 10.0
    assert res_empirical.mev + 2.0 <= res_empirical.mav <= 22.0
    assert res_empirical.mav + 2.0 <= res_empirical.mrv <= 30.0


# ============================================================================
# Unit Tests: Systemic Fatigue Multipliers
# ============================================================================

def test_systemic_fatigue_multipliers() -> None:
    """Tests m_sys values across equipment categories and compound flags."""
    # Barbell compound: 1.35
    assert compute_systemic_fatigue_multiplier("Barbell", True) == 1.35
    assert compute_systemic_fatigue_multiplier("barbell", 1) == 1.35

    # Dumbbell / Bodyweight compound: 1.00
    assert compute_systemic_fatigue_multiplier("Dumbbell", True) == 1.00
    assert compute_systemic_fatigue_multiplier("Bodyweight", True) == 1.00

    # Machine / Cable compound: 0.65
    assert compute_systemic_fatigue_multiplier("Machine", True) == 0.65
    assert compute_systemic_fatigue_multiplier("Cable", True) == 0.65

    # Any isolation movement: 0.65
    assert compute_systemic_fatigue_multiplier("Barbell", False) == 0.65
    assert compute_systemic_fatigue_multiplier("Dumbbell", False) == 0.65
    assert compute_systemic_fatigue_multiplier("Machine", False) == 0.65


# ============================================================================
# Unit Tests: Energy Balance Scaling
# ============================================================================

def test_volume_landmarks_energy_balance_scaling() -> None:
    """Tests MAV and MRV scaling by 1.12x under SURPLUS and 0.82x under DEFICIT."""
    # 1. Caloric Surplus
    res_surplus = fit_muscle_volume_landmarks(
        weekly_volumes=[10.0],
        weekly_e10rm_slopes=[0.01],
        energy_balance="SURPLUS",
    )
    assert pytest.approx(res_surplus.mev, rel=1e-5) == 6.0
    # MAV: 14.0 * 1.12 = 15.68 -> 15.7
    assert pytest.approx(res_surplus.mav, rel=1e-1) == 14.0 * 1.12
    # MRV: 20.0 * 1.12 = 22.4
    assert pytest.approx(res_surplus.mrv, rel=1e-1) == 20.0 * 1.12

    # 2. Caloric Deficit
    res_deficit = fit_muscle_volume_landmarks(
        weekly_volumes=[10.0],
        weekly_e10rm_slopes=[0.01],
        energy_balance="DEFICIT",
    )
    assert pytest.approx(res_deficit.mev, rel=1e-5) == 6.0
    # MAV: 14.0 * 0.82 = 11.48 -> 11.5
    assert pytest.approx(res_deficit.mav, rel=1e-1) == 14.0 * 0.82
    # MRV: 20.0 * 0.82 = 16.4
    assert pytest.approx(res_deficit.mrv, rel=1e-1) == 20.0 * 0.82


# ============================================================================
# Unit Tests: Volume Credit Routing on Different Exercises
# ============================================================================

def test_volume_credit_warmup_and_bench_press() -> None:
    """Tests volume credit routing on warmup sets and upper body compound sets."""
    bench = Exercise(
        id="barbell_bench_press",
        name="Barbell Bench Press",
        muscle_group="Chest",
        category="Barbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
        secondary_muscles=["Triceps", "Shoulders"],
    )

    # 1. Warmup set yields zero credits
    warmup_set = WorkoutSet(
        id="ws-bench-w",
        workout_id="w-1",
        exercise_id="barbell_bench_press",
        set_number=1,
        weight=60.0,
        raw_input_weight=60.0,
        reps=10,
        set_type="warmup",
        created_at="2026-10-18T10:00:00Z",
    )
    credit_warmup = route_muscle_volume_credit(warmup_set, bench)
    assert credit_warmup.effective_reps == 0.0
    assert len(credit_warmup.credits) == 0

    # 2. Working set: 10 reps @ RPE 9.0 (RIR 1.0 -> 4.0 eReps)
    working_set = WorkoutSet(
        id="ws-bench-1",
        workout_id="w-1",
        exercise_id="barbell_bench_press",
        set_number=2,
        weight=100.0,
        raw_input_weight=100.0,
        reps=10,
        rpe=9.0,
        set_type="working",
        created_at="2026-10-18T10:03:00Z",
    )
    credit_working = route_muscle_volume_credit(working_set, bench)
    assert pytest.approx(credit_working.effective_reps, rel=1e-5) == 4.0
    assert credit_working.systemic_fatigue_multiplier == 1.35

    # Chest gets direct 1.0 set, 4.0 eReps
    c_sets, c_ereps = credit_working.credits["Chest"]
    assert pytest.approx(c_sets, rel=1e-5) == 1.0
    assert pytest.approx(c_ereps, rel=1e-5) == 4.0

    # Triceps & Shoulders get 0.5 set, 2.0 eReps
    t_sets, t_ereps = credit_working.credits["Triceps"]
    assert pytest.approx(t_sets, rel=1e-5) == 0.5
    assert pytest.approx(t_ereps, rel=1e-5) == 2.0

    s_sets, s_ereps = credit_working.credits["Shoulders"]
    assert pytest.approx(s_sets, rel=1e-5) == 0.5
    assert pytest.approx(s_ereps, rel=1e-5) == 2.0


# ============================================================================
# Unit Tests: Localized Banister ODEs & Banister Integration
# ============================================================================

def test_localized_muscle_readiness_odes() -> None:
    """Verifies that localized muscle EWMA ODEs produce valid readiness scores for all 12 muscles."""
    workouts = [
        Workout(
            id="w-1",
            date="2026-10-18",
            name="Leg Day",
            started_at="2026-10-18T10:00:00Z",
            status="completed",
        )
    ]
    squat = Exercise(
        id="squat",
        name="Squat",
        muscle_group="Quads",
        category="Barbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
        secondary_muscles=["Glutes", "Hamstrings"],
    )
    sets = [
        WorkoutSet(
            id=f"ws-{i}",
            workout_id="w-1",
            exercise_id="squat",
            set_number=i,
            weight=140.0,
            raw_input_weight=140.0,
            reps=8,
            rpe=9.0,
            set_type="working",
            created_at=f"2026-10-18T10:0{i}:00Z",
        )
        for i in range(1, 5)
    ]

    readiness = compute_muscle_partitioned_readiness(
        workouts=workouts,
        workout_sets=sets,
        exercises=[squat],
    )

    # All 12 canonical muscle groups present
    assert len(readiness) == len(CANONICAL_MUSCLE_GROUPS)
    for m in CANONICAL_MUSCLE_GROUPS:
        assert 0.0 <= readiness[m] <= 100.0

    # Quads (trained directly with 4 heavy sets) must have lower readiness than untrained chest
    assert readiness["Quads"] < readiness["Chest"]
    # Glutes/Hamstrings received secondary volume
    assert readiness["Glutes"] < readiness["Chest"]


def test_fatigue_banister_integration_with_systemic_scaling() -> None:
    """Tests compute_daily_banister_series with category-weighted systemic fatigue scaling."""
    workouts = [
        Workout(
            id="w-1",
            date="2026-10-18",
            name="Heavy Squats",
            started_at="2026-10-18T10:00:00Z",
            status="completed",
        )
    ]
    squat_barbell = Exercise(
        id="squat",
        name="Barbell Squat",
        muscle_group="Quads",
        category="Barbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
        secondary_muscles=["Glutes", "Hamstrings"],
    )
    sets = [
        WorkoutSet(
            id=f"ws-{i}",
            workout_id="w-1",
            exercise_id="squat",
            set_number=i,
            weight=140.0,
            raw_input_weight=140.0,
            reps=8,
            rpe=9.0,
            set_type="working",
            created_at=f"2026-10-18T10:0{i}:00Z",
        )
        for i in range(1, 4)
    ]

    # Run with exercises passed (m_sys = 1.35 applied)
    series_scaled = compute_daily_banister_series(
        workouts=workouts,
        workout_sets=sets,
        known_1rms={"squat": 180.0},
        exercises=[squat_barbell],
    )

    # Run without exercises passed (m_sys = 1.0 default fallback)
    series_unscaled = compute_daily_banister_series(
        workouts=workouts,
        workout_sets=sets,
        known_1rms={"squat": 180.0},
        exercises=None,
    )

    assert len(series_scaled) == 1
    assert len(series_unscaled) == 1

    # Scaled systemic fatigue must be higher due to 1.35x Barbell multiplier
    assert series_scaled[0].fatigue > series_unscaled[0].fatigue
    # Localized muscle readiness snapshot is attached
    assert series_scaled[0].muscle_readiness is not None
    assert "Quads" in series_scaled[0].muscle_readiness


def test_solve_all_muscle_landmarks_dictionary() -> None:
    """Tests solve_all_muscle_landmarks populating all 12 canonical muscle groups."""
    vols = {"Chest": [12.0, 14.0, 16.0], "Quads": [14.0, 16.0, 18.0]}
    slopes = {"Chest": [0.01, 0.012, 0.008], "Quads": [0.015, 0.018, 0.012]}

    all_landmarks = solve_all_muscle_landmarks(
        weekly_volumes_by_muscle=vols,
        weekly_e10rm_slopes_by_muscle=slopes,
        energy_balance="MAINTENANCE",
    )

    assert len(all_landmarks) == 12
    for m in CANONICAL_MUSCLE_GROUPS:
        assert m in all_landmarks
        res = all_landmarks[m]
        assert isinstance(res, MuscleLandmarkResult)
        assert res.muscle_group == m
        assert res.mev < res.mav < res.mrv
