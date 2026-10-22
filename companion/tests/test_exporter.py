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
    training_snapshot_evidence,
)
from src.ingestion.schemas import (
    CalibratedParametersEnvelope,
    Workout,
    WorkoutExportPayload,
    WorkoutSet,
    ProgramBlock,
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


def test_export_includes_mesocycle_evidence(sample_payload: WorkoutExportPayload) -> None:
    envelope = export_calibrated_parameters(sample_payload)
    feedback = envelope.mesocycle_feedback
    assert feedback is not None
    assert 3 <= feedback.recommended_accumulation_weeks <= 12
    assert feedback.exported_at == envelope.exported_at
    assert feedback.observed_through == max(
        (str(w.date)[:10] for w in sample_payload.workouts if w.status == "completed"), default=""
    )
    if feedback.detected_blocks_count == 0:
        assert feedback.confidence_tier == "LOW"


def test_export_passes_actual_strength_histories_to_mesocycle_analysis(
    sample_payload: WorkoutExportPayload, monkeypatch: pytest.MonkeyPatch
) -> None:
    import src.export.param_exporter as exporter

    working = next(s for s in sample_payload.workout_sets if s.set_type == "working")
    sample_payload.workout_sets.extend([
        working.model_copy(update={"id": f"extra-{i}", "rir": 2.0}) for i in range(6)
    ])
    original = exporter.analyze_optimal_mesocycle_length
    captured: Dict[str, Any] = {}

    def observe(**kwargs: Any) -> Any:
        captured.update(kwargs)
        return original(**kwargs)

    monkeypatch.setattr(exporter, "analyze_optimal_mesocycle_length", observe)
    export_calibrated_parameters(sample_payload)
    assert captured["kalman_histories"]
    assert working.exercise_id in captured["kalman_histories"]


def test_recovery_work_cannot_change_calibrated_strength(sample_payload: WorkoutExportPayload) -> None:
    before = export_calibrated_parameters(sample_payload)
    source = next(s for s in sample_payload.workout_sets if s.set_type == "working")
    workout = sample_payload.workouts[0].model_copy(update={"id": "recovery", "date": "2026-10-21", "status": "completed"})
    sample_payload.workouts.append(workout)
    sample_payload.workout_sets.append(source.model_copy(update={
        "id": "recovery-set", "workout_id": "recovery", "weight": 1000.0, "rir": 0.0,
    }))
    sample_payload.user_settings["training_snapshot_recovery"] = json.dumps({"deload": True, "exercises": []})
    after = export_calibrated_parameters(sample_payload)
    assert [(p.exercise_id, p.calibrated_1rm, p.calibrated_k) for p in before.parameters] == [
        (p.exercise_id, p.calibrated_1rm, p.calibrated_k) for p in after.parameters
    ]


def test_explicit_block_membership_avoids_boundary_day_overlap(sample_payload: WorkoutExportPayload) -> None:
    sample_payload.program_blocks = [
        ProgramBlock(id="one", program_id="p", start_date="2026-09-01", end_date="2026-09-28"),
        ProgramBlock(id="two", program_id="p", start_date="2026-09-28", end_date="2026-10-21"),
    ]
    sample_payload.workouts = []
    for ident, block, day in [("a", "one", "2026-09-01"), ("b", "one", "2026-09-28"),
                              ("c", "two", "2026-10-01"), ("d", "two", "2026-10-21")]:
        sample_payload.workouts.append(Workout(id=ident, date=day, name="Training", status="completed", started_at=f"{day}T12:00:00Z"))
        sample_payload.user_settings[f"training_snapshot_{ident}"] = json.dumps({"blockId": block})
    _, boundaries = training_snapshot_evidence(sample_payload)
    assert len(boundaries) == 2
    assert str(boundaries[0][1]) == "2026-09-28"
    assert str(boundaries[1][0]) == "2026-10-01"


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
    dummy_dir = Path(__file__).resolve().parents[2] / "dummy_data"
    dummy_files = sorted(dummy_dir.glob("workout_suite_export_*.json"), reverse=True)
    if not dummy_files:
        pytest.skip("dummy_data export not found")

    dummy_path = dummy_files[0]

    with tempfile.TemporaryDirectory() as tmpdir:
        out_file = Path(tmpdir) / "calibrated_parameters.json"
        envelope = export_calibrated_parameters_file(dummy_path, out_file)

        assert len(envelope.parameters) > 0
        with open(out_file, "r", encoding="utf-8") as f:
            saved_json = json.load(f)

        jsonschema.validate(instance=saved_json, schema=calibrated_schema)
