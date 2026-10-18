"""Unit and regression tests for Phase 3 Empirical SFR, Variant Substitution & Asymmetry Engine.

Validates:
1. Empirical Exercise SFR Score (SFR_ex in [0, 100]):
   - Formula:
     ((mean_eReps / 5.0) * (1 + max(-0.5, 10 * x_dot_10RM))) /
     ((1 + 3.0 * mean_delta_drop) * (1 + 0.25 * sum(joint_pain) + 0.08 * sum(muscle_pain)))
   - Severe joint pain guardrail: any joint pain >= 5 forces tier to POOR_SWAP_RECOMMENDED
     and clamps sfr_score <= 39.0.
2. Variant Tree Substitution Resolver:
   - Sibling/parent/child lookup via parent_exercise_id.
   - Equipment and gear inventory accessibility filtering.
   - Ranking by lowest historical joint pain and lowest systemic fatigue (m_sys).
3. Unilateral Limb Repetition Asymmetry Index:
   - (1/M) * sum(|reps - reps_right| / max(reps, reps_right)).
   - Flags when asymmetry > 0.12 across M >= 3 consecutive sessions.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List

import pytest

from src.analysis.sfr_evaluator import (
    DEFAULT_10RM_SLOPE_WINDOW_DAYS,
    DEFAULT_PAIN_EVAL_WINDOW_DAYS,
    DEFAULT_SFR_EVAL_WINDOW_DAYS,
    E10RM_SLOPE_FLOOR,
    E10RM_SLOPE_MULTIPLIER,
    INTRA_SESSION_DROPOFF_WEIGHT,
    JOINT_PAIN_PENALTY_WEIGHT,
    MIN_SESSIONS_FOR_SFR_EVAL,
    MUSCLE_PAIN_PENALTY_WEIGHT,
    SEVERE_JOINT_PAIN_THRESHOLD,
    SFR_MODERATE_THRESHOLD,
    SFR_OPTIMAL_THRESHOLD,
    UNILATERAL_ASYMMETRY_THRESHOLD,
    UNILATERAL_MIN_CONSECUTIVE_SESSIONS,
    ExerciseSFRResult,
    UnilateralAsymmetryResult,
    compute_exercise_sfr,
    compute_unilateral_asymmetry,
    evaluate_all_exercises_sfr,
    evaluate_all_unilateral_asymmetries,
    resolve_variant_substitutions,
)
from src.ingestion.schemas import (
    Exercise,
    GearInventory,
    PainReport,
    UserProfile,
    Workout,
    WorkoutSet,
)


# ============================================================================
# Phase 3 Verification Gate Tests (Mandatory Specifications)
# ============================================================================

def test_phase_3_verification_gate_joint_pain_drops_sfr_and_recommends_sibling() -> None:
    """Verification Gate 1:

    Unit test demonstrating that injecting two joint pain reports (severity = 6)
    drops an exercise's SFR into POOR_SWAP_RECOMMENDED and returns a valid sibling
    exercise_id from the parent_exercise_id tree.
    """
    ref_time = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

    # Catalog variant tree: Bench press parent family
    barbell_bench = Exercise(
        id="ex_bb_bench",
        name="Barbell Flat Bench Press",
        muscle_group="Chest",
        category="Barbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
        parent_exercise_id="family_bench_press",
    )
    dumbbell_bench = Exercise(
        id="ex_db_bench",
        name="Dumbbell Flat Bench Press",
        muscle_group="Chest",
        category="Dumbbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
        parent_exercise_id="family_bench_press",
    )
    machine_chest_press = Exercise(
        id="ex_machine_press",
        name="Machine Chest Press",
        muscle_group="Chest",
        category="Machine",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
        parent_exercise_id="family_bench_press",
    )

    all_exercises = [barbell_bench, dumbbell_bench, machine_chest_press]

    # Create 3 workouts over last 20 days
    workouts = [
        Workout(
            id=f"w_{i}",
            date=(ref_time - timedelta(days=20 - i * 7)).strftime("%Y-%m-%d"),
            name=f"Push Workout {i}",
            started_at=(ref_time - timedelta(days=20 - i * 7)).isoformat(),
            status="completed",
        )
        for i in range(3)
    ]

    # Log sets for barbell bench (3 sets per workout, working sets)
    workout_sets: List[WorkoutSet] = []
    set_counter = 0
    for w in workouts:
        for s_idx in range(1, 4):
            set_counter += 1
            workout_sets.append(
                WorkoutSet(
                    id=f"set_{set_counter}",
                    workout_id=w.id,
                    exercise_id=barbell_bench.id,
                    set_number=s_idx,
                    weight=100.0,
                    raw_input_weight=100.0,
                    reps=8,
                    rpe=8.0,
                    rir=2.0,
                    set_type="working",
                    created_at=w.started_at,
                )
            )

    # Inject two joint pain reports with severity = 6 (severe articular irritation)
    pain_reports = [
        PainReport(
            id="pain_1",
            workout_id=workouts[1].id,
            exercise_id=barbell_bench.id,
            pain_type="joint",
            severity=6,
            created_at=workouts[1].started_at,
        ),
        PainReport(
            id="pain_2",
            workout_id=workouts[2].id,
            exercise_id=barbell_bench.id,
            pain_type="joint",
            severity=6,
            created_at=workouts[2].started_at,
        ),
    ]

    user_profile = UserProfile(
        id="user_1",
        gender="male",
        equipment_access="commercial_gym",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    # Compute SFR
    result: ExerciseSFRResult = compute_exercise_sfr(
        exercise_id=barbell_bench.id,
        workout_sets=workout_sets,
        pain_reports=pain_reports,
        workouts=workouts,
        exercises=all_exercises,
        user_profile=user_profile,
        as_of_date=ref_time,
    )

    # Verification assertions:
    # 1. Exercise must be evaluable (>= 3 sessions)
    assert result.is_evaluable is True
    assert result.sessions_evaluated == 3
    # 2. Pain reports correctly captured
    assert result.joint_pain_sum == 12
    assert result.has_severe_joint_pain is True
    # 3. Guardrail: severe joint pain forces tier into POOR_SWAP_RECOMMENDED and caps score <= 39
    assert result.sfr_tier == "POOR_SWAP_RECOMMENDED"
    assert result.sfr_score is not None
    assert result.sfr_score <= 39.0

    # 4. Substitution resolver returns valid sibling from parent variant tree
    assert result.recommended_swap_exercise_id is not None
    assert result.recommended_swap_exercise_id in {dumbbell_bench.id, machine_chest_press.id}
    # Machine press has m_sys = 0.65 vs DB = 1.00, so machine is preferred for joint deloading
    assert result.recommended_swap_exercise_id == machine_chest_press.id
    assert dumbbell_bench.id in result.swap_candidates


def test_phase_3_verification_gate_unilateral_asymmetry_detection() -> None:
    """Verification Gate 2:

    Unit test verifying unilateral asymmetry detection when reps = 10
    and reps_right = 8 over 3 sessions.
    Discrepancy: |10 - 8| / max(10, 8) = 2 / 10 = 0.20 (20% > 12% threshold).
    """
    ref_time = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

    db_lunge = Exercise(
        id="ex_db_lunge",
        name="Dumbbell Walking Lunge",
        muscle_group="Quads",
        category="Dumbbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=True,
    )

    workouts = [
        Workout(
            id=f"w_asym_{i}",
            date=(ref_time - timedelta(days=14 - i * 5)).strftime("%Y-%m-%d"),
            name=f"Legs {i}",
            started_at=(ref_time - timedelta(days=14 - i * 5)).isoformat(),
            status="completed",
        )
        for i in range(3)
    ]

    workout_sets: List[WorkoutSet] = []
    set_idx = 0
    for w in workouts:
        set_idx += 1
        workout_sets.append(
            WorkoutSet(
                id=f"set_lunge_{set_idx}",
                workout_id=w.id,
                exercise_id=db_lunge.id,
                set_number=1,
                weight=24.0,
                raw_input_weight=24.0,
                reps=10,        # Left limb
                reps_right=8,   # Right limb
                rpe=8.5,
                rir=1.5,
                set_type="working",
                created_at=w.started_at,
            )
        )

    result: UnilateralAsymmetryResult = compute_unilateral_asymmetry(
        exercise_id=db_lunge.id,
        workout_sets=workout_sets,
        workouts=workouts,
        exercise=db_lunge,
    )

    assert result.is_unilateral is True
    assert result.sessions_evaluated == 3
    # Fractional difference: |10 - 8| / 10 = 0.20
    assert result.asymmetry_ratio == pytest.approx(0.20, abs=1e-3)
    assert result.consecutive_breaches == 3
    assert result.is_asymmetry_flagged is True


# ============================================================================
# Additional Comprehensive Tests for Robustness
# ============================================================================

def test_sfr_optimal_for_pain_free_progressing_movement() -> None:
    """Test that a movement with strong eReps, progressive 10RM gain, low dropoff,

    and zero joint/muscle pain receives an OPTIMAL tier classification.
    """
    ref_time = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

    lat_pulldown = Exercise(
        id="ex_lat_pulldown",
        name="Cable Lat Pulldown",
        muscle_group="Lats",
        category="Cable",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
    )

    workouts = [
        Workout(
            id=f"w_pull_{i}",
            date=(ref_time - timedelta(days=21 - i * 7)).strftime("%Y-%m-%d"),
            name=f"Pull {i}",
            started_at=(ref_time - timedelta(days=21 - i * 7)).isoformat(),
            status="completed",
        )
        for i in range(4)
    ]

    workout_sets: List[WorkoutSet] = []
    # Progressive load: 60kg, 62.5kg, 65kg, 67.5kg @ 10 reps, RPE 9.0 (4 eReps)
    for i, w in enumerate(workouts):
        load = 60.0 + i * 2.5
        for s_num in range(1, 4):
            workout_sets.append(
                WorkoutSet(
                    id=f"set_pd_{i}_{s_num}",
                    workout_id=w.id,
                    exercise_id=lat_pulldown.id,
                    set_number=s_num,
                    weight=load,
                    raw_input_weight=load,
                    reps=10,
                    rpe=9.0,
                    rir=1.0,
                    set_type="working",
                    created_at=w.started_at,
                )
            )

    result = compute_exercise_sfr(
        exercise_id=lat_pulldown.id,
        workout_sets=workout_sets,
        pain_reports=[],
        workouts=workouts,
        exercises=[lat_pulldown],
        as_of_date=ref_time,
    )

    assert result.is_evaluable is True
    assert result.sessions_evaluated == 4
    assert result.joint_pain_sum == 0
    assert result.muscle_pain_sum == 0
    assert result.has_severe_joint_pain is False
    assert result.sfr_tier == "OPTIMAL"
    assert result.sfr_score is not None and result.sfr_score >= 65.0
    assert result.recommended_swap_exercise_id is None


def test_sfr_insufficient_sessions_not_evaluable() -> None:
    """Test that an exercise with < 3 sessions returns is_evaluable=False and None score."""
    ref_time = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

    ex = Exercise(
        id="ex_calf_raise",
        name="Standing Calf Raise",
        muscle_group="Calves",
        category="Machine",
        is_compound=False,
        is_bodyweight=False,
        is_unilateral=False,
    )

    workouts = [
        Workout(
            id=f"w_calf_{i}",
            date=(ref_time - timedelta(days=10 - i * 5)).strftime("%Y-%m-%d"),
            name="Legs",
            started_at=(ref_time - timedelta(days=10 - i * 5)).isoformat(),
            status="completed",
        )
        for i in range(2)  # Only 2 sessions
    ]

    workout_sets = [
        WorkoutSet(
            id=f"set_calf_{i}",
            workout_id=workouts[i].id,
            exercise_id=ex.id,
            set_number=1,
            weight=50.0,
            raw_input_weight=50.0,
            reps=15,
            rpe=8.0,
            rir=2.0,
            set_type="working",
            created_at=workouts[i].started_at,
        )
        for i in range(2)
    ]

    result = compute_exercise_sfr(
        exercise_id=ex.id,
        workout_sets=workout_sets,
        pain_reports=[],
        workouts=workouts,
        exercises=[ex],
        as_of_date=ref_time,
    )

    assert result.is_evaluable is False
    assert result.sessions_evaluated == 2
    assert result.sfr_score is None
    assert result.sfr_tier == "MODERATE"


def test_variant_substitution_equipment_filtering() -> None:
    """Test that variant substitutions respect athlete equipment_access constraints."""
    current_ex = Exercise(
        id="ex_heavy_bb_squat",
        name="Barbell Back Squat",
        muscle_group="Quads",
        category="Barbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
        parent_exercise_id="family_squat",
    )
    barbell_front_squat = Exercise(
        id="ex_front_squat",
        name="Barbell Front Squat",
        muscle_group="Quads",
        category="Barbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
        parent_exercise_id="family_squat",
    )
    goblet_squat = Exercise(
        id="ex_goblet_squat",
        name="Dumbbell Goblet Squat",
        muscle_group="Quads",
        category="Dumbbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
        parent_exercise_id="family_squat",
    )

    all_ex = [current_ex, barbell_front_squat, goblet_squat]

    # User profile restricted to dumbbells only
    db_only_profile = UserProfile(
        id="user_home",
        gender="female",
        equipment_access="dumbbells_only",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    candidates = resolve_variant_substitutions(
        current_exercise_id=current_ex.id,
        exercises=all_ex,
        user_profile=db_only_profile,
    )

    # Barbell front squat must be filtered out, leaving goblet squat
    assert barbell_front_squat.id not in candidates
    assert candidates == [goblet_squat.id]


def test_unilateral_asymmetry_symmetric_not_flagged() -> None:
    """Test that perfectly balanced bilateral performance does not trigger asymmetry flag."""
    ref_time = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

    db_curl = Exercise(
        id="ex_db_curl",
        name="Alternating Dumbbell Curl",
        muscle_group="Biceps",
        category="Dumbbell",
        is_compound=False,
        is_bodyweight=False,
        is_unilateral=True,
    )

    workouts = [
        Workout(
            id=f"w_curl_{i}",
            date=(ref_time - timedelta(days=14 - i * 5)).strftime("%Y-%m-%d"),
            name="Arms",
            started_at=(ref_time - timedelta(days=14 - i * 5)).isoformat(),
            status="completed",
        )
        for i in range(3)
    ]

    workout_sets = [
        WorkoutSet(
            id=f"set_curl_{i}",
            workout_id=workouts[i].id,
            exercise_id=db_curl.id,
            set_number=1,
            weight=14.0,
            raw_input_weight=14.0,
            reps=10,        # Left limb: 10 reps
            reps_right=10,  # Right limb: 10 reps
            rpe=8.0,
            rir=2.0,
            set_type="working",
            created_at=workouts[i].started_at,
        )
        for i in range(3)
    ]

    result = compute_unilateral_asymmetry(
        exercise_id=db_curl.id,
        workout_sets=workout_sets,
        workouts=workouts,
        exercise=db_curl,
    )

    assert result.is_unilateral is True
    assert result.asymmetry_ratio == 0.0
    assert result.consecutive_breaches == 0
    assert result.is_asymmetry_flagged is False


def test_batch_sfr_and_asymmetry_suites() -> None:
    """Test batch processing across all exercises in a workout history."""
    ref_time = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

    ex_squat = Exercise(
        id="ex_squat",
        name="Barbell Squat",
        muscle_group="Quads",
        category="Barbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
    )
    ex_lunge = Exercise(
        id="ex_lunge",
        name="Dumbbell Lunge",
        muscle_group="Quads",
        category="Dumbbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=True,
    )

    workouts = [
        Workout(
            id=f"w_batch_{i}",
            date=(ref_time - timedelta(days=14 - i * 5)).strftime("%Y-%m-%d"),
            name="Leg Day",
            started_at=(ref_time - timedelta(days=14 - i * 5)).isoformat(),
            status="completed",
        )
        for i in range(3)
    ]

    workout_sets = []
    for i, w in enumerate(workouts):
        workout_sets.append(
            WorkoutSet(
                id=f"set_sq_{i}",
                workout_id=w.id,
                exercise_id=ex_squat.id,
                set_number=1,
                weight=120.0,
                raw_input_weight=120.0,
                reps=6,
                rpe=8.5,
                rir=1.5,
                set_type="working",
                created_at=w.started_at,
            )
        )
        workout_sets.append(
            WorkoutSet(
                id=f"set_lu_{i}",
                workout_id=w.id,
                exercise_id=ex_lunge.id,
                set_number=1,
                weight=20.0,
                raw_input_weight=20.0,
                reps=10,
                reps_right=10,
                rpe=8.0,
                rir=2.0,
                set_type="working",
                created_at=w.started_at,
            )
        )

    sfr_results = evaluate_all_exercises_sfr(
        workout_sets=workout_sets,
        workouts=workouts,
        exercises=[ex_squat, ex_lunge],
        as_of_date=ref_time,
    )

    asym_results = evaluate_all_unilateral_asymmetries(
        workout_sets=workout_sets,
        workouts=workouts,
        exercises=[ex_squat, ex_lunge],
    )

    assert ex_squat.id in sfr_results
    assert ex_lunge.id in sfr_results
    assert sfr_results[ex_squat.id].sessions_evaluated == 3

    assert ex_lunge.id in asym_results
    assert asym_results[ex_lunge.id].is_unilateral is True
