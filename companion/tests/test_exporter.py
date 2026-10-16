import json
from pathlib import Path
import tempfile
from typing import Any, Dict
import jsonschema  # type: ignore[import-untyped]
import pytest

from src.export.param_exporter import (
    calibrate_exercise_stream,
    export_calibrated_parameters,
    export_calibrated_parameters_file,
)
from src.ingestion.schemas import (
    CalibratedParametersEnvelope,
    Workout,
    WorkoutExportPayload,
    WorkoutSet,
)


@pytest.fixture
def calibrated_schema() -> Dict[str, Any]:
    schema_path = Path(__file__).resolve().parents[2] / "schemas" / "calibrated_parameters.schema.json"
    with open(schema_path, "r", encoding="utf-8") as f:
        data: Dict[str, Any] = json.load(f)
        return data


@pytest.fixture
def sample_payload() -> WorkoutExportPayload:
    fixture_path = (
        Path(__file__).resolve().parents[2]
        / "schemas"
        / "fixtures"
        / "sample_workout_export.json"
    )
    with open(fixture_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return WorkoutExportPayload.model_validate(data)


def test_calibrate_exercise_stream_empty() -> None:
    param = calibrate_exercise_stream(
        exercise_id="barbell_bench_press",
        standard_lift_type="bench",
        workouts=[],
        sets=[],
    )
    assert param is None


def test_calibrate_exercise_stream_success() -> None:
    workouts = [
        Workout(
            id="w-01",
            date="2026-10-01",
            name="Push Day",
            started_at="2026-10-01T10:00:00Z",
            status="completed",
        ),
        Workout(
            id="w-02",
            date="2026-10-05",
            name="Push Day 2",
            started_at="2026-10-05T10:00:00Z",
            status="completed",
        ),
    ]
    sets = [
        WorkoutSet(
            id="s-01",
            workout_id="w-01",
            exercise_id="barbell_bench_press",
            set_number=1,
            weight=100.0,
            raw_input_weight=100.0,
            reps=5,
            rir=1.0,
            set_type="working",
            created_at="2026-10-01T10:05:00Z",
        ),
        WorkoutSet(
            id="s-02",
            workout_id="w-02",
            exercise_id="barbell_bench_press",
            set_number=1,
            weight=102.5,
            raw_input_weight=102.5,
            reps=5,
            rir=1.0,
            set_type="working",
            created_at="2026-10-05T10:05:00Z",
        ),
    ]

    param = calibrate_exercise_stream(
        exercise_id="barbell_bench_press",
        standard_lift_type="bench",
        workouts=workouts,
        sets=sets,
    )

    assert param is not None
    assert param.exercise_id == "barbell_bench_press"
    assert param.calibrated_1rm > 100.0
    assert 0.03 <= param.calibrated_k <= 0.20
    assert param.cov_p00 > 0.0
    assert param.cov_p11 > 0.0


def test_calibrate_exercise_stream_unrated_working_sets() -> None:
    workouts = [
        Workout(
            id="w-01",
            date="2026-10-01",
            name="Squat Day",
            started_at="2026-10-01T10:00:00Z",
            status="completed",
        ),
    ]
    sets = [
        WorkoutSet(
            id="s-01",
            workout_id="w-01",
            exercise_id="squat",
            set_number=1,
            weight=100.0,
            raw_input_weight=100.0,
            reps=5,
            rir=None,
            rpe=None,
            set_type="working",
            created_at="2026-10-01T10:05:00Z",
        ),
    ]
    # default_working_rir=None -> None (unrated sets discarded)
    assert calibrate_exercise_stream("squat", "squat", workouts, sets, default_working_rir=None) is None

    # default_working_rir=2.0 -> valid parameter
    param = calibrate_exercise_stream("squat", "squat", workouts, sets, default_working_rir=2.0)
    assert param is not None
    assert param.exercise_id == "squat"
    assert param.calibrated_1rm > 100.0


def test_export_calibrated_parameters_conforms_to_schema(
    sample_payload: WorkoutExportPayload,
    calibrated_schema: Dict[str, Any],
) -> None:
    envelope = export_calibrated_parameters(sample_payload)
    assert isinstance(envelope, CalibratedParametersEnvelope)
    assert envelope.version == "1.0.0"

    raw_dict = json.loads(envelope.model_dump_json())
    # Contract validation against schemas/calibrated_parameters.schema.json
    jsonschema.validate(instance=raw_dict, schema=calibrated_schema)


def test_export_calibrated_parameters_file(calibrated_schema: Dict[str, Any]) -> None:
    fixture_path = (
        Path(__file__).resolve().parents[2]
        / "schemas"
        / "fixtures"
        / "sample_workout_export.json"
    )
    with tempfile.TemporaryDirectory() as tmpdir:
        out_file = Path(tmpdir) / "calibrated_parameters.json"
        envelope = export_calibrated_parameters_file(fixture_path, out_file)

        assert out_file.exists()
        with open(out_file, "r", encoding="utf-8") as f:
            saved_json = json.load(f)

        jsonschema.validate(instance=saved_json, schema=calibrated_schema)
        assert envelope.version == "1.0.0"


def test_export_calibrated_parameters_on_dummy_data(calibrated_schema: Dict[str, Any]) -> None:
    dummy_path = (
        Path(__file__).resolve().parents[2]
        / "dummy_data"
        / "workout_suite_export_2026-10-15T21-13-03-987Z.json"
    )
    if not dummy_path.exists():
        pytest.skip("dummy_data export not found")

    with tempfile.TemporaryDirectory() as tmpdir:
        out_file = Path(tmpdir) / "calibrated_parameters.json"
        envelope = export_calibrated_parameters_file(dummy_path, out_file)

        assert len(envelope.parameters) > 0
        with open(out_file, "r", encoding="utf-8") as f:
            saved_json = json.load(f)

        jsonschema.validate(instance=saved_json, schema=calibrated_schema)
