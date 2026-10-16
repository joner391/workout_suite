"""Tier 2 Calibrated Parameter Exporter for Workout Suite.

Ingests a WorkoutExportPayload (or workout_data_export.json), runs the
Tier 2 Adaptive Linear Kalman Filter on all historical exercise sets in
chronological order, and serializes the posterior parameters (1RM, k, cov_p00, cov_p11)
into a contract-validated calibrated_parameters.json file conforming to
schemas/calibrated_parameters.schema.json.

Implements ADR-002, ADR-026, and Step 6.3 of IMPLEMENTATION_PLAN.md.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional, Sequence, Union

# Ensure companion root directory is in sys.path
_COMPANION_ROOT = str(Path(__file__).resolve().parents[2])
if _COMPANION_ROOT not in sys.path:
    sys.path.insert(0, _COMPANION_ROOT)

from src.ingestion.schemas import (
    CalibratedParameter,
    CalibratedParametersEnvelope,
    Workout,
    WorkoutExportPayload,
    WorkoutSet,
)
from src.models.kalman_1rm import Adaptive1RMKalmanFilter


def calibrate_exercise_stream(
    exercise_id: str,
    standard_lift_type: Optional[str],
    workouts: Sequence[Workout],
    sets: Sequence[WorkoutSet],
    default_working_rir: Optional[float] = 2.0,
) -> Optional[CalibratedParameter]:
    """Runs the Adaptive1RMKalmanFilter on chronological sessions for a single exercise.

    Returns a CalibratedParameter if at least one set passed intra-session filtering,
    or None if no valid sets were available for calibration.
    """
    # Group sets by workout_id
    sets_by_workout: Dict[str, List[WorkoutSet]] = defaultdict(list)
    for s in sets:
        sets_by_workout[s.workout_id].append(s)

    # Sort workouts chronologically by (date, started_at)
    sorted_workouts = sorted(workouts, key=lambda w: (w.date, w.started_at))

    kf = Adaptive1RMKalmanFilter(
        exercise_id=exercise_id,
        standard_lift_type=standard_lift_type,
    )

    for w in sorted_workouts:
        if w.id in sets_by_workout:
            session_sets = sets_by_workout[w.id]
            kf.process_session(
                session_sets,
                default_working_rir=default_working_rir,
                session_date=w.date,
            )

    if kf.state.step_count == 0:
        return None

    # Timestamp in ISO 8601 UTC format
    calibrated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    return CalibratedParameter(
        exercise_id=exercise_id,
        calibrated_1rm=round(kf.state.e1rm, 2),
        calibrated_k=round(kf.state.k, 4),
        cov_p00=round(kf.state.cov_p00, 6),
        cov_p11=round(kf.state.cov_p11, 6),
        calibrated_at=calibrated_at,
    )


def export_calibrated_parameters(
    payload: WorkoutExportPayload,
    target_exercise_ids: Optional[Sequence[str]] = None,
    default_working_rir: Optional[float] = 2.0,
) -> CalibratedParametersEnvelope:
    """Calibrates all exercises present in the payload and returns the validated envelope."""
    exercise_map = {e.id: e for e in payload.exercises}

    # Group all sets by exercise_id
    sets_by_exercise: Dict[str, List[WorkoutSet]] = defaultdict(list)
    for s in payload.workout_sets:
        sets_by_exercise[s.exercise_id].append(s)

    candidate_ids = (
        target_exercise_ids
        if target_exercise_ids is not None
        else list(sets_by_exercise.keys())
    )

    parameters: List[CalibratedParameter] = []

    for ex_id in sorted(candidate_ids):
        ex = exercise_map.get(ex_id)
        std_lift = ex.standard_lift_type if ex else None
        ex_sets = sets_by_exercise.get(ex_id, [])
        if not ex_sets:
            continue

        param = calibrate_exercise_stream(
            exercise_id=ex_id,
            standard_lift_type=std_lift,
            workouts=payload.workouts,
            sets=ex_sets,
            default_working_rir=default_working_rir,
        )
        if param is not None:
            parameters.append(param)

    now_utc = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    envelope = CalibratedParametersEnvelope(
        version="1.0.0",
        exported_at=now_utc,
        parameters=parameters,
    )
    return envelope


def export_calibrated_parameters_file(
    input_path: Union[str, Path],
    output_path: Union[str, Path],
    default_working_rir: Optional[float] = 2.0,
) -> CalibratedParametersEnvelope:
    """Reads a workout export JSON file, executes calibration, and writes calibrated_parameters.json."""
    in_file = Path(input_path)
    out_file = Path(output_path)

    with open(in_file, "r", encoding="utf-8") as f:
        raw_json = json.load(f)

    payload = WorkoutExportPayload.model_validate(raw_json)
    envelope = export_calibrated_parameters(payload, default_working_rir=default_working_rir)

    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(envelope.model_dump_json(indent=2))

    return envelope


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Workout Suite Tier 2 Kalman Filter Parameter Exporter",
    )
    parser.add_argument(
        "--input",
        "-i",
        type=str,
        required=True,
        help="Path to workout_data_export.json",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default="calibrated_parameters.json",
        help="Path to output calibrated_parameters.json",
    )
    parser.add_argument(
        "--default-working-rir",
        type=float,
        default=2.0,
        help="Default RIR for working sets lacking explicit exertion rating (default: 2.0)",
    )
    args = parser.parse_args()

    envelope = export_calibrated_parameters_file(
        args.input,
        args.output,
        default_working_rir=args.default_working_rir,
    )
    print(
        f"Successfully calibrated {len(envelope.parameters)} exercises. "
        f"Saved to {args.output}"
    )


if __name__ == "__main__":
    main()
