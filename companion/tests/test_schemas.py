"""Unit tests for Pydantic v2 data models and contract synchronization in Workout Suite Companion."""

from typing import Any, Dict, List
import pytest
from pydantic import ValidationError

from src.ingestion.schemas import (
    BodyMetric,
    CalibratedParameter,
    CalibratedParametersEnvelope,
    Exercise,
    GearInventory,
    Program,
    ProgramBlock,
    ProgressionRule,
    TemplateExercise,
    UserProfile,
    Workout,
    WorkoutExportPayload,
    WorkoutSet,
    WorkoutTemplate,
)


# ============================================================================
# Fixtures: Valid Data Payloads
# ============================================================================

@pytest.fixture
def valid_program_dict() -> Dict[str, Any]:
    return {
        "id": "prog-001",
        "name": "Upper/Lower Hypertrophy",
        "color_hex": "#3B82F6",
        "notes": "4-day split focusing on progressive overload",
        "created_at": "2026-10-13T12:00:00Z",
    }


@pytest.fixture
def valid_program_block_dict() -> Dict[str, Any]:
    return {
        "id": "block-001",
        "program_id": "prog-001",
        "start_date": "2026-10-01",
        "end_date": None,
    }


@pytest.fixture
def valid_template_dict() -> Dict[str, Any]:
    return {
        "id": "tmpl-001",
        "program_id": "prog-001",
        "name": "Upper A",
        "notes": "Focus on horizontal press and vertical pull",
        "order_index": 0,
        "created_at": "2026-10-13T12:00:00Z",
    }


@pytest.fixture
def valid_template_exercise_dict() -> Dict[str, Any]:
    return {
        "id": "te-001",
        "template_id": "tmpl-001",
        "exercise_id": "ex-bench",
        "gear_id": "gear-bar-20",
        "target_sets": 4,
        "target_reps_min": 6,
        "target_reps_max": 8,
        "target_rpe": 8.5,
        "target_rir": 1.5,
        "order_index": 0,
        "exercise_group_id": None,
    }


@pytest.fixture
def valid_progression_rule_dict() -> Dict[str, Any]:
    return {
        "id": "pr-001",
        "template_exercise_id": "te-001",
        "priority": 1,
        "rule_json": {
            "conditions": [{"type": "ALL_SETS_HIT_TARGET_REPS"}],
            "actions": [{"type": "INCREASE_LOAD_FIXED", "value": 2.5}],
        },
    }


@pytest.fixture
def valid_workout_dict() -> Dict[str, Any]:
    return {
        "id": "wo-001",
        "template_id": "tmpl-001",
        "date": "2026-10-13",
        "name": "Upper A Session",
        "notes": "Felt strong throughout",
        "started_at": "2026-10-13T18:00:00Z",
        "duration_seconds": 3600,
        "status": "completed",
        "completed_at": "2026-10-13T19:00:00Z",
        "imported_from": None,
    }


@pytest.fixture
def valid_workout_set_dict() -> Dict[str, Any]:
    return {
        "id": "set-001",
        "workout_id": "wo-001",
        "exercise_id": "ex-bench",
        "gear_id": "gear-bar-20",
        "set_number": 1,
        "weight": 100.0,
        "raw_input_weight": 100.0,
        "added_weight": None,
        "reps": 8,
        "reps_right": None,
        "rpe": 8.0,
        "rir": 2.0,
        "set_type": "working",
        "set_notes": "Solid bar path",
        "exercise_group_id": None,
        "created_at": "2026-10-13T18:15:00Z",
    }


@pytest.fixture
def valid_exercise_dict() -> Dict[str, Any]:
    return {
        "id": "ex-bench",
        "name": "Barbell Bench Press",
        "muscle_group": "Chest",
        "category": "Barbell",
        "is_compound": True,
        "is_bodyweight": False,
        "is_unilateral": False,
        "load_mode": "total",
        "default_cable_ratio": 1.0,
        "default_bar_weight_kg": 20.0,
        "is_custom": False,
        "parent_exercise_id": None,
        "standard_lift_type": "bench",
        "default_rest_seconds": 180,
    }


@pytest.fixture
def valid_gear_dict() -> Dict[str, Any]:
    return {
        "id": "gear-bar-20",
        "name": "Olympic Barbell",
        "type": "barbell",
        "tare_weight_kg": 20.0,
        "cable_ratio": 1.0,
        "is_default": True,
        "notes": "Standard 28mm bar",
    }


@pytest.fixture
def valid_body_metric_dict() -> Dict[str, Any]:
    return {
        "id": "bm-001",
        "date": "2026-10-13",
        "bodyweight": 82.5,
        "body_fat_manual": 14.5,
        "waist_cm": 81.0,
        "neck_cm": 39.0,
        "hip_cm": None,
        "bicep_cm": 38.5,
        "chest_cm": 104.0,
        "thigh_cm": 61.0,
        "calf_cm": 38.0,
        "navy_body_fat": 13.8,
    }


@pytest.fixture
def valid_user_profile_dict() -> Dict[str, Any]:
    return {
        "id": "prof-001",
        "gender": "male",
        "birthdate": "1995-05-15",
        "height_cm": 180.0,
        "training_mentality": "precision",
        "primary_goal": "hypertrophy",
        "secondary_goals": ["strength"],
        "preferred_days_per_week": 4,
        "preferred_session_duration_mins": 75,
        "equipment_access": "commercial_gym",
        "created_at": "2026-10-13T10:00:00Z",
        "updated_at": "2026-10-13T10:00:00Z",
    }


@pytest.fixture
def valid_full_export_payload(
    valid_program_dict: Dict[str, Any],
    valid_program_block_dict: Dict[str, Any],
    valid_template_dict: Dict[str, Any],
    valid_template_exercise_dict: Dict[str, Any],
    valid_progression_rule_dict: Dict[str, Any],
    valid_workout_dict: Dict[str, Any],
    valid_workout_set_dict: Dict[str, Any],
    valid_exercise_dict: Dict[str, Any],
    valid_gear_dict: Dict[str, Any],
    valid_body_metric_dict: Dict[str, Any],
    valid_user_profile_dict: Dict[str, Any],
) -> Dict[str, Any]:
    return {
        "version": "1.0.0",
        "exported_at": "2026-10-13T20:00:00Z",
        "programs": [valid_program_dict],
        "program_blocks": [valid_program_block_dict],
        "workout_templates": [valid_template_dict],
        "template_exercises": [valid_template_exercise_dict],
        "progression_rules": [valid_progression_rule_dict],
        "workouts": [valid_workout_dict],
        "workout_sets": [valid_workout_set_dict],
        "exercises": [valid_exercise_dict],
        "gear_inventory": [valid_gear_dict],
        "body_metrics": [valid_body_metric_dict],
        "user_settings": {
            "unit_system": "kg",
            "intensity_metric": "RPE",
            "pure_utility_mode": "1",
        },
        "user_profiles": [valid_user_profile_dict],
        "calibrated_params": [
            {
                "id": "cal-001",
                "exercise_id": "ex-bench",
                "calibrated_1rm": 125.0,
                "calibrated_k": 0.085,
                "cov_p00": 0.001,
                "cov_p11": 0.001,
                "calibrated_at": "2026-10-13T20:00:00Z",
            }
        ],
    }


# ============================================================================
# Tests: Workout Export Payload Validation
# ============================================================================

def test_valid_workout_export_payload(valid_full_export_payload: Dict[str, Any]) -> None:
    """Verifies that a valid full export dictionary successfully parses into WorkoutExportPayload."""
    payload = WorkoutExportPayload.model_validate(valid_full_export_payload)
    assert payload.version == "1.0.0"
    assert len(payload.programs) == 1
    assert payload.programs[0].name == "Upper/Lower Hypertrophy"
    assert len(payload.workout_sets) == 1
    # Verify ADR-026 dual load persistence
    assert payload.workout_sets[0].weight == 100.0
    assert payload.workout_sets[0].raw_input_weight == 100.0
    assert payload.user_settings["pure_utility_mode"] == "1"


def test_invalid_workout_export_version() -> None:
    """Fails validation if version does not conform to semver regex."""
    with pytest.raises(ValidationError) as exc_info:
        WorkoutExportPayload.model_validate({
            "version": "not-semver",
            "exported_at": "2026-10-13T20:00:00Z",
        })
    assert "version" in str(exc_info.value)


def test_extra_field_forbidden(valid_program_dict: Dict[str, Any]) -> None:
    """Ensures extra undeclared fields raise ValidationError (strict schema compliance)."""
    invalid_data = {**valid_program_dict, "unauthorized_column": "malicious"}
    with pytest.raises(ValidationError) as exc_info:
        Program.model_validate(invalid_data)
    assert "extra_forbidden" in str(exc_info.value)


def test_workout_set_validation_boundaries(valid_workout_set_dict: Dict[str, Any]) -> None:
    """Ensures out-of-range constraints are enforced."""
    # Negative weight forbidden
    with pytest.raises(ValidationError):
        WorkoutSet.model_validate({**valid_workout_set_dict, "weight": -5.0})

    # RPE > 10.0 forbidden
    with pytest.raises(ValidationError):
        WorkoutSet.model_validate({**valid_workout_set_dict, "rpe": 10.5})

    # 'dc' set type is valid
    dc_set = WorkoutSet.model_validate({**valid_workout_set_dict, "set_type": "dc"})
    assert dc_set.set_type == "dc"

    # 'failure' set type was purged and is forbidden
    with pytest.raises(ValidationError):
        WorkoutSet.model_validate({**valid_workout_set_dict, "set_type": "failure"})

    # Reps < 0 forbidden
    with pytest.raises(ValidationError):
        WorkoutSet.model_validate({**valid_workout_set_dict, "reps": -1})


def test_body_metric_boundaries(valid_body_metric_dict: Dict[str, Any]) -> None:
    """Ensures bodyweight and circumference boundaries are enforced."""
    # Bodyweight below 20 kg
    with pytest.raises(ValidationError):
        BodyMetric.model_validate({**valid_body_metric_dict, "bodyweight": 15.0})

    # Invalid date pattern
    with pytest.raises(ValidationError):
        BodyMetric.model_validate({**valid_body_metric_dict, "date": "13-10-2026"})


# ============================================================================
# Tests: Calibrated Parameters Schema Models
# ============================================================================

def test_valid_calibrated_parameter() -> None:
    """Verifies valid CalibratedParameter creation."""
    param = CalibratedParameter(
        exercise_id="ex-bench",
        calibrated_1rm=125.5,
        calibrated_k=0.085,
        cov_p00=0.0012,
        cov_p11=0.0003,
        calibrated_at="2026-10-13T20:00:00Z",
    )
    assert param.exercise_id == "ex-bench"
    assert param.calibrated_1rm == 125.5
    assert param.calibrated_k == 0.085


def test_calibrated_parameter_invalid_bounds() -> None:
    """Ensures fatigue exponent k and 1RM bounds are enforced."""
    # Zero or negative 1RM
    with pytest.raises(ValidationError):
        CalibratedParameter(
            exercise_id="ex-bench",
            calibrated_1rm=0.0,
            calibrated_k=0.085,
            cov_p00=0.001,
            cov_p11=0.001,
            calibrated_at="2026-10-13T20:00:00Z",
        )

    # k < 0.03 (unphysiologically low)
    with pytest.raises(ValidationError):
        CalibratedParameter(
            exercise_id="ex-bench",
            calibrated_1rm=100.0,
            calibrated_k=0.01,
            cov_p00=0.001,
            cov_p11=0.001,
            calibrated_at="2026-10-13T20:00:00Z",
        )

    # k > 0.20 (unphysiologically high)
    with pytest.raises(ValidationError):
        CalibratedParameter(
            exercise_id="ex-bench",
            calibrated_1rm=100.0,
            calibrated_k=0.25,
            cov_p00=0.001,
            cov_p11=0.001,
            calibrated_at="2026-10-13T20:00:00Z",
        )


def test_valid_calibrated_envelope() -> None:
    """Verifies CalibratedParametersEnvelope validation."""
    envelope = CalibratedParametersEnvelope.model_validate({
        "version": "1.0.0",
        "exported_at": "2026-10-13T20:00:00Z",
        "parameters": [
            {
                "exercise_id": "ex-bench",
                "calibrated_1rm": 125.0,
                "calibrated_k": 0.085,
                "cov_p00": 0.001,
                "cov_p11": 0.001,
                "calibrated_at": "2026-10-13T20:00:00Z",
            }
        ],
    })
    assert envelope.version == "1.0.0"
    assert len(envelope.parameters) == 1
    assert envelope.parameters[0].calibrated_1rm == 125.0


# ============================================================================
# Tests: Step 2.3 Generated Fixture Contract Verification
# ============================================================================

def test_sample_workout_export_fixture() -> None:
    """Verifies that the mobile SQLite export fixture conforms to both the Draft-07 JSON Schema and Companion Pydantic v2 models."""
    import json
    from pathlib import Path
    import jsonschema  # type: ignore[import-untyped]

    repo_root = Path(__file__).resolve().parent.parent.parent
    fixture_path = repo_root / "schemas" / "fixtures" / "sample_workout_export.json"
    schema_path = repo_root / "schemas" / "workout_export.schema.json"

    assert fixture_path.exists(), f"Sample export fixture missing at {fixture_path}"
    assert schema_path.exists(), f"Workout export schema missing at {schema_path}"

    with open(fixture_path, "r", encoding="utf-8") as f:
        fixture_data = json.load(f)

    with open(schema_path, "r", encoding="utf-8") as f:
        schema_data = json.load(f)

    # 1. Validate against canonical Draft-07 JSON Schema
    jsonschema.validate(instance=fixture_data, schema=schema_data)

    # 2. Validate against Companion Pydantic v2 data model
    payload = WorkoutExportPayload.model_validate(fixture_data)

    assert payload.version == "1.0.0"
    assert len(payload.programs) >= 1
    assert len(payload.exercises) >= 2
    assert len(payload.workouts) >= 1
    assert len(payload.workout_sets) >= 2

    # Verify ADR-026 dual-weight persistence in the exported fixture
    bench_set = payload.workout_sets[0]
    assert bench_set.weight == 100.0
    assert bench_set.raw_input_weight == 100.0
    assert bench_set.reps == 8

    # Verify user profile goals & equipment access
    user_prof = payload.user_profiles[0]
    assert user_prof.gender == "male"
    assert user_prof.equipment_access == "commercial_gym"
    assert user_prof.secondary_goals == ["strength", "powerbuilding"]

    # Verify user settings dictionary
    assert payload.user_settings["unit_system"] == "kg"
    assert payload.user_settings["intensity_metric"] == "RPE"

