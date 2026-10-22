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
from datetime import date, datetime, timezone, timedelta
import json
import math
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

import numpy as np

# Ensure companion root directory is in sys.path
_COMPANION_ROOT = str(Path(__file__).resolve().parents[2])
if _COMPANION_ROOT not in sys.path:
    sys.path.insert(0, _COMPANION_ROOT)

from src.analysis.hypertrophy_signals import project_e10rm
from src.analysis.muscle_landmarks import (
    CANONICAL_MUSCLE_GROUPS,
    compute_muscle_partitioned_readiness,
    route_muscle_volume_credit,
    solve_all_muscle_landmarks,
)
from src.analysis.sfr_evaluator import (
    evaluate_all_exercises_sfr,
    evaluate_all_unilateral_asymmetries,
)
from src.ingestion.schemas import (
    CalibratedParameter,
    CalibratedParametersEnvelope,
    Exercise,
    MuscleLandmarkPayload,
    MesocycleFeedbackPayload,
    ProgramAuditPayload,
    Workout,
    WorkoutExportPayload,
    WorkoutSet,
)
from src.models.fatigue_banister import compute_daily_banister_series
from src.models.kalman_1rm import Adaptive1RMKalmanFilter
from src.models.mesocycle_analyzer import analyze_optimal_mesocycle_length, compute_all_kalman_histories
from src.models.recommendations import generate_parameter_audits
from src.models.recovery_modifier import compute_recovery_modifier


def training_snapshot_evidence(
    payload: WorkoutExportPayload,
) -> Tuple[Dict[str, Dict[str, Any]], List[Tuple[date, date]]]:
    """Use explicit mobile block membership when available; date-only legacy blocks cannot overlap."""
    snapshots: Dict[str, Dict[str, Any]] = {}
    for key, value in payload.user_settings.items():
        if key.startswith("training_snapshot_"):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, dict):
                    snapshots[key.removeprefix("training_snapshot_")] = parsed
            except (ValueError, TypeError):
                continue
    boundaries: List[Tuple[date, date]] = []
    previous_end: Optional[date] = None
    for block in sorted(payload.program_blocks, key=lambda b: b.start_date):
        if block.end_date is None:
            continue
        dates = [date.fromisoformat(str(w.date)[:10]) for w in payload.workouts
                 if w.status == "completed" and snapshots.get(w.id, {}).get("blockId") == block.id]
        start = min(dates) if dates else date.fromisoformat(block.start_date[:10])
        end = max(dates) if dates else date.fromisoformat(block.end_date[:10])
        if previous_end is not None:
            start = max(start, previous_end + timedelta(days=1))
        if (end - start).days >= 14:
            boundaries.append((start, end))
            previous_end = end
    return snapshots, boundaries


def strength_observation_sets(payload: WorkoutExportPayload, snapshots: Dict[str, Dict[str, Any]]) -> List[WorkoutSet]:
    """Recovery work contributes training load but must not recalibrate strength."""
    painful = {(p.workout_id, p.exercise_id) for p in payload.pain_reports if p.severity >= 7}
    eligible = []
    for workout_set in payload.workout_sets:
        snapshot = snapshots.get(workout_set.workout_id, {})
        if snapshot.get("deload") or (workout_set.workout_id, workout_set.exercise_id) in painful:
            continue
        rows = snapshot.get("exercises", [])
        if not isinstance(rows, list):
            rows = []
        recovery = any(isinstance(row, dict) and (row.get("painRecovery") or row.get("painReturn")) and
                       isinstance(row.get("prescription"), dict) and
                       row["prescription"].get("exercise_id") == workout_set.exercise_id
                       for row in rows)
        if not recovery:
            eligible.append(workout_set)
    return eligible


def compute_weekly_volumes_and_slopes_by_muscle(
    workouts: Sequence[Workout],
    sets: Sequence[WorkoutSet],
    exercises: Sequence[Exercise],
) -> Tuple[Dict[str, List[float]], Dict[str, List[float]]]:
    """Aggregates weekly fractional set volumes and e10RM log-slopes per canonical muscle group."""
    ex_map = {str(getattr(e, "id", "")): e for e in exercises if getattr(e, "id", "")}

    workout_dates: Dict[str, date] = {}
    for w in workouts:
        wid = str(getattr(w, "id", ""))
        d_val = getattr(w, "date", None)
        if wid and d_val:
            try:
                dt = datetime.strptime(str(d_val)[:10], "%Y-%m-%d").date()
                workout_dates[wid] = dt
            except ValueError:
                pass

    if not workout_dates:
        return (
            {m: [] for m in CANONICAL_MUSCLE_GROUPS},
            {m: [] for m in CANONICAL_MUSCLE_GROUPS},
        )

    min_date = min(workout_dates.values())
    max_date = max(workout_dates.values())
    total_days = (max_date - min_date).days
    num_weeks = max(1, (total_days // 7) + 1)

    weekly_volumes: Dict[str, List[float]] = {m: [0.0] * num_weeks for m in CANONICAL_MUSCLE_GROUPS}
    weekly_e10rms: Dict[str, List[List[float]]] = {m: [[] for _ in range(num_weeks)] for m in CANONICAL_MUSCLE_GROUPS}

    for s in sets:
        st = str(getattr(s, "set_type", "working")).strip().lower()
        if st == "warmup":
            continue
        reps = int(getattr(s, "reps", 0) or 0)
        if reps <= 0:
            continue

        wid = str(getattr(s, "workout_id", ""))
        w_dt = workout_dates.get(wid)
        if not w_dt:
            continue

        week_idx = (w_dt - min_date).days // 7
        if week_idx < 0 or week_idx >= num_weeks:
            continue

        eid = str(getattr(s, "exercise_id", ""))
        ex_obj = ex_map.get(eid)

        credit = route_muscle_volume_credit(s, ex_obj)
        for m, (frac_sets, _) in credit.credits.items():
            if m in weekly_volumes:
                weekly_volumes[m][week_idx] += frac_sets

        weight = float(getattr(s, "weight", 0.0) or 0.0)
        if weight > 0.0:
            rir_raw = getattr(s, "rir", None)
            rpe_raw = getattr(s, "rpe", None)
            rir = float(rir_raw) if rir_raw is not None else (10.0 - float(rpe_raw) if rpe_raw is not None else 2.0)
            e1rm = weight * ((reps + rir) ** 0.10)
            e10rm = e1rm * (10.0 ** (-0.10))
            primary_m = credit.primary_muscle
            if primary_m in weekly_e10rms:
                weekly_e10rms[primary_m][week_idx].append(e10rm)

    weekly_slopes: Dict[str, List[float]] = {m: [] for m in CANONICAL_MUSCLE_GROUPS}
    for m in CANONICAL_MUSCLE_GROUPS:
        m_e10rms = weekly_e10rms[m]
        for week_i in range(num_weeks):
            if week_i == 0:
                weekly_slopes[m].append(0.0)
            else:
                prev_vals = m_e10rms[week_i - 1]
                curr_vals = m_e10rms[week_i]
                if prev_vals and curr_vals:
                    slope = math.log(max(1.0, float(np.mean(curr_vals)))) - math.log(max(1.0, float(np.mean(prev_vals))))
                    weekly_slopes[m].append(slope)
                else:
                    weekly_slopes[m].append(0.0)

    return (weekly_volumes, weekly_slopes)


def calibrate_exercise_stream(
    exercise_id: str,
    standard_lift_type: Optional[str],
    workouts: Sequence[Workout],
    sets: Sequence[WorkoutSet],
    default_working_rir: Optional[float] = 2.0,
    max_session_sets: int = 1,
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
                max_session_sets=max_session_sets,
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
    max_session_sets: int = 1,
) -> CalibratedParametersEnvelope:
    """Calibrates all exercises present in the payload and returns the validated envelope."""
    exercise_map = {e.id: e for e in payload.exercises}
    snapshots, explicit_blocks = training_snapshot_evidence(payload)
    observation_sets = strength_observation_sets(payload, snapshots)

    # Group all sets by exercise_id
    sets_by_exercise: Dict[str, List[WorkoutSet]] = defaultdict(list)
    for s in observation_sets:
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
            max_session_sets=max_session_sets,
        )
        if param is not None:
            # 1. Projected true 10RM
            param.calibrated_10rm = round(
                project_e10rm(e1rm=param.calibrated_1rm, k=param.calibrated_k),
                2,
            )
            parameters.append(param)

    # 2. Evaluate SFR for all exercises
    user_prof = payload.user_profiles[0] if payload.user_profiles else None
    sfr_map = evaluate_all_exercises_sfr(
        workout_sets=payload.workout_sets,
        pain_reports=payload.pain_reports,
        workouts=payload.workouts,
        exercises=payload.exercises,
        user_profile=user_prof,
        gear_inventory=payload.gear_inventory,
    )
    for p in parameters:
        if p.exercise_id in sfr_map:
            sfr_res = sfr_map[p.exercise_id]
            p.sfr_score = round(sfr_res.sfr_score, 1) if sfr_res.sfr_score is not None else None
            p.sfr_tier = sfr_res.sfr_tier
            p.recommended_swap_exercise_id = sfr_res.recommended_swap_exercise_id

    # 3. Evaluate Unilateral Asymmetries
    asym_map = evaluate_all_unilateral_asymmetries(
        workout_sets=payload.workout_sets,
        workouts=payload.workouts,
        exercises=payload.exercises,
    )
    for p in parameters:
        if p.exercise_id in asym_map:
            asym_res = asym_map[p.exercise_id]
            if asym_res.sessions_evaluated > 0 and asym_res.asymmetry_ratio is not None:
                p.asymmetry_ratio = round(asym_res.asymmetry_ratio, 4)

    # 4. Solve Muscle Landmarks & Localized Readiness
    rec_state = compute_recovery_modifier(payload.body_metrics)
    muscle_readiness = compute_muscle_partitioned_readiness(
        workouts=payload.workouts,
        workout_sets=payload.workout_sets,
        exercises=payload.exercises,
        body_metrics=payload.body_metrics,
    )
    weekly_vols, weekly_slopes = compute_weekly_volumes_and_slopes_by_muscle(
        workouts=payload.workouts,
        sets=payload.workout_sets,
        exercises=payload.exercises,
    )
    landmarks_res = solve_all_muscle_landmarks(
        weekly_volumes_by_muscle=weekly_vols,
        weekly_e10rm_slopes_by_muscle=weekly_slopes,
        energy_balance=rec_state.energy_balance,
        current_readiness_by_muscle=muscle_readiness,
    )
    muscle_landmarks_payload: Dict[str, MuscleLandmarkPayload] = {
        m: MuscleLandmarkPayload(
            mev=lm.mev,
            mav=lm.mav,
            mrv=lm.mrv,
            readiness_pct=lm.readiness_pct,
        )
        for m, lm in landmarks_res.items()
    }

    # 5. Program Parameter Audits
    daily_banister = compute_daily_banister_series(
        workouts=payload.workouts,
        workout_sets=payload.workout_sets,
        body_metrics=payload.body_metrics,
        default_working_rpe=8.0,
    )
    meso_rec = analyze_optimal_mesocycle_length(
        workouts=payload.workouts,
        workout_sets=observation_sets,
        kalman_histories=compute_all_kalman_histories(
            workouts=[w for w in payload.workouts if w.status == "completed"],
            workout_sets=observation_sets,
            exercises=payload.exercises,
            default_working_rir=None,
        ),
        banister_series=daily_banister,
        exercises=payload.exercises,
        energy_balance=rec_state.energy_balance,
        block_boundaries=explicit_blocks or None,
    )
    pref_duration = (
        int(payload.user_profiles[0].preferred_session_duration_mins)
        if payload.user_profiles and getattr(payload.user_profiles[0], "preferred_session_duration_mins", None)
        else 60
    )
    audits_raw = generate_parameter_audits(
        workout_sets=payload.workout_sets,
        workouts=payload.workouts,
        exercises=payload.exercises,
        landmarks_by_muscle=landmarks_res,
        preparedness_series=daily_banister,
        mesocycle_recommendation=meso_rec,
        preferred_session_duration_mins=pref_duration,
    )
    program_audit_payloads: List[ProgramAuditPayload] = []
    for audit in audits_raw:
        if audit.parameter_adjustments:
            param_name, param_val = next(iter(audit.parameter_adjustments.items()))
        else:
            param_name, param_val = "action", audit.recommended_action

        program_audit_payloads.append(
            ProgramAuditPayload(
                rule_code=audit.audit_type,
                target_id=audit.target_id,
                message=audit.message,
                suggested_parameter=param_name,
                suggested_value=param_val,
            )
        )

        # Wire REST_TOO_SHORT to exercise optimal_rest_seconds
        if audit.audit_type == "REST_TOO_SHORT" and audit.target_type == "exercise":
            for p in parameters:
                if p.exercise_id == audit.target_id:
                    p.optimal_rest_seconds = int(audit.parameter_adjustments.get("optimal_rest_seconds", 180))

    now_utc = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    envelope = CalibratedParametersEnvelope(
        version="1.0.0",
        exported_at=now_utc,
        parameters=parameters,
        muscle_landmarks=muscle_landmarks_payload,
        program_audits=program_audit_payloads if program_audit_payloads else None,
        mesocycle_feedback=MesocycleFeedbackPayload(
            recommended_accumulation_weeks=max(3, min(12, round(meso_rec.optimal_accumulation_weeks))),
            confidence_score=meso_rec.confidence_score,
            confidence_tier=meso_rec.confidence_tier,
            detected_blocks_count=meso_rec.detected_blocks_count,
            explicit_rpe_coverage=meso_rec.explicit_rpe_coverage,
            observed_through=max((str(w.date)[:10] for w in payload.workouts if w.status == "completed"), default=""),
            exported_at=now_utc,
            primary_goal=str(payload.user_profiles[0].primary_goal) if payload.user_profiles else "unknown",
        ),
    )
    return envelope


def export_calibrated_parameters_file(
    input_path: Union[str, Path],
    output_path: Union[str, Path],
    default_working_rir: Optional[float] = 2.0,
    max_session_sets: int = 1,
) -> CalibratedParametersEnvelope:
    """Reads a workout export JSON file, executes calibration, and writes calibrated_parameters.json."""
    in_file = Path(input_path)
    out_file = Path(output_path)

    with open(in_file, "r", encoding="utf-8") as f:
        raw_json = json.load(f)

    payload = WorkoutExportPayload.model_validate(raw_json)
    envelope = export_calibrated_parameters(
        payload,
        default_working_rir=default_working_rir,
        max_session_sets=max_session_sets,
    )

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
