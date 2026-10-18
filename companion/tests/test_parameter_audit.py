"""Unit and regression tests for Phase 4 Anthropometric Partitioning (P-Ratio) & Parameter Audit Rules.

Validates:
1. Anthropometric Partitioning (P-Ratio Proxy):
   - Computes 28-day rolling OLS slopes for bodyweight, waist_cm, body fat %, limb girths, and eLBM.
   - Triggers CALORIC_OVERSHOOT if beta_BW > +0.35 kg/wk AND (beta_waist > +0.20 cm/wk OR P-ratio < 0.45).
2. Deterministic Program Parameter Audit Matrix:
   - REST_TOO_SHORT: is_compound == 1, median rest < 90s, delta_drop > 0.15 -> optimal_rest_seconds = 180.
   - JUNK_VOLUME: weekly sets > MAV, mean RPE < 7.3, e10RM slope <= 0 -> -25% volume, RPE 8.5-9.0.
   - AXIAL_BOTTLENECK: Banister F(t) > 1.35 P(t), muscle readiness > 70%, Barbell volume share > 60%.
   - REP_MONOTONY: > 85% of sets within +/- 1 rep band, e10RM slope <= 0 -> undulating rep brackets.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List

import pytest

from src.ingestion.schemas import (
    BodyMetric,
    Exercise,
    Workout,
    WorkoutSet,
)
from src.models.fatigue_banister import DailyPreparedness
from src.models.recommendations import (
    ProgramParameterAudit,
    generate_parameter_audits,
)
from src.models.recovery_modifier import (
    CALORIC_OVERSHOOT_BW_SLOPE_THRESHOLD,
    CALORIC_OVERSHOOT_LEAN_PARTITION_RATIO,
    CALORIC_OVERSHOOT_WAIST_SLOPE_THRESHOLD,
    PRatioPartitioningResult,
    compute_body_composition_partitioning,
    compute_recovery_modifier,
)


# ============================================================================
# Phase 4 Verification Gate Tests (Mandatory Specifications)
# ============================================================================

def test_phase_4_verification_gate_caloric_overshoot_via_waist_growth() -> None:
    """Verification Gate 1:

    Confirm CALORIC_OVERSHOOT triggers when bodyweight rises +0.5 kg/wk
    alongside +0.3 cm/wk waist growth.
    """
    ref_time = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

    # 4 weekly measurements over 28 days
    # Week 0 (day -21): BW = 80.0 kg, Waist = 82.0 cm
    # Week 1 (day -14): BW = 80.5 kg, Waist = 82.3 cm
    # Week 2 (day -7):  BW = 81.0 kg, Waist = 82.6 cm
    # Week 3 (day 0):   BW = 81.5 kg, Waist = 82.9 cm
    # Slope: +0.5 kg / week, +0.3 cm / week waist
    metrics: List[BodyMetric] = []
    for i in range(4):
        d_str = (ref_time - timedelta(days=21 - i * 7)).strftime("%Y-%m-%d")
        metrics.append(
            BodyMetric(
                id=f"metric_{i}",
                date=d_str,
                bodyweight=80.0 + i * 0.5,
                waist_cm=82.0 + i * 0.3,
                navy_body_fat=15.0 + i * 0.2,
            )
        )

    res: PRatioPartitioningResult = compute_body_composition_partitioning(
        metrics=metrics,
        target_date=ref_time,
        window_days=28,
    )

    assert res.sample_count == 4
    assert res.beta_bw_kg_per_week == pytest.approx(0.50, abs=0.02)
    assert res.beta_waist_cm_per_week is not None
    assert res.beta_waist_cm_per_week == pytest.approx(0.30, abs=0.02)
    assert res.is_caloric_overshoot is True
    assert "CALORIC_OVERSHOOT" in res.message
    assert "waist growth" in res.message

    # Also verify integration into compute_recovery_modifier
    rec_state = compute_recovery_modifier(
        metrics=metrics,
        target_date=ref_time,
    )
    assert rec_state.p_ratio is not None
    assert rec_state.p_ratio.is_caloric_overshoot is True


def test_caloric_overshoot_via_poor_pratio_partitioning() -> None:
    """Test CALORIC_OVERSHOOT triggering when BW rises rapidly (>0.35 kg/wk)

    with poor lean mass partitioning (P-ratio < 0.45), even if waist measurements are missing.
    """
    ref_time = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

    # BW gains +0.50 kg/wk (80kg -> 81.5kg).
    # Body fat climbs from 15.0% to 16.5% such that:
    # eLBM_0 = 80 * 0.85 = 68.0 kg
    # eLBM_3 = 81.5 * 0.835 = 68.05 kg (lean gain = +0.05 kg over 3 weeks -> +0.017 kg/wk)
    # P-ratio = 0.017 / 0.50 = 0.034 << 0.45
    metrics: List[BodyMetric] = []
    for i in range(4):
        d_str = (ref_time - timedelta(days=21 - i * 7)).strftime("%Y-%m-%d")
        metrics.append(
            BodyMetric(
                id=f"metric_pr_{i}",
                date=d_str,
                bodyweight=80.0 + i * 0.5,
                navy_body_fat=15.0 + i * 0.5,  # rapid body fat gain
            )
        )

    res = compute_body_composition_partitioning(
        metrics=metrics,
        target_date=ref_time,
        window_days=28,
    )

    assert res.beta_bw_kg_per_week == pytest.approx(0.50, abs=0.02)
    assert res.p_ratio_proxy is not None
    assert res.p_ratio_proxy < CALORIC_OVERSHOOT_LEAN_PARTITION_RATIO
    assert res.is_caloric_overshoot is True
    assert "lean mass partitioning ratio P" in res.message


# ============================================================================
# Verification Gate 2: Parameter Audit Rules Testing
# ============================================================================

def test_parameter_audit_rest_too_short() -> None:
    """Verification Gate 2.1:

    REST_TOO_SHORT fires for compound exercise when median rest < 90s
    and intra-session drop-off > 0.15, recommending optimal_rest_seconds = 180.
    """
    ref_time = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

    bb_bench = Exercise(
        id="ex_bench",
        name="Barbell Bench Press",
        muscle_group="Chest",
        category="Barbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
    )

    workouts = [
        Workout(
            id=f"w_bench_{i}",
            date=(ref_time - timedelta(days=20 - i * 6)).strftime("%Y-%m-%d"),
            name="Chest Day",
            started_at=(ref_time - timedelta(days=20 - i * 6)).isoformat(),
            status="completed",
        )
        for i in range(3)
    ]

    # Sets logged with 60s implicit rest and severe rep dropoff (10 reps -> 6 reps -> 4 reps)
    workout_sets: List[WorkoutSet] = []
    for w in workouts:
        w_start = datetime.fromisoformat(w.started_at)
        # Set 1: 10 reps @ 100kg
        t1 = w_start
        workout_sets.append(
            WorkoutSet(
                id=f"s_{w.id}_1",
                workout_id=w.id,
                exercise_id=bb_bench.id,
                set_number=1,
                weight=100.0,
                raw_input_weight=100.0,
                reps=10,
                rpe=8.5,
                rir=1.5,
                created_at=t1.isoformat(),
            )
        )
        # Set 2: 60s elapsed (30s rest < 90s), drops load to 70kg for 5 reps (dropoff ~ 35%)
        t2 = t1 + timedelta(seconds=60)
        workout_sets.append(
            WorkoutSet(
                id=f"s_{w.id}_2",
                workout_id=w.id,
                exercise_id=bb_bench.id,
                set_number=2,
                weight=70.0,
                raw_input_weight=70.0,
                reps=5,
                rpe=10.0,
                rir=0.0,
                created_at=t2.isoformat(),
            )
        )

    audits = generate_parameter_audits(
        workout_sets=workout_sets,
        workouts=workouts,
        exercises=[bb_bench],
        as_of_date=ref_time,
    )

    rest_audits = [a for a in audits if a.audit_type == "REST_TOO_SHORT"]
    assert len(rest_audits) == 1
    assert rest_audits[0].target_id == bb_bench.id
    assert rest_audits[0].parameter_adjustments.get("optimal_rest_seconds") == 180


def test_parameter_audit_junk_volume() -> None:
    """Verification Gate 2.2:

    JUNK_VOLUME fires when weekly sets exceed MAV (e.g. 18 > 14 sets/wk),
    mean working RPE < 7.3, and 10RM progress is non-positive.
    Recommends reducing sets by 25% and increasing RPE to 8.5-9.0.
    """
    ref_time = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

    db_fly = Exercise(
        id="ex_db_fly",
        name="Dumbbell Chest Fly",
        muscle_group="Chest",
        category="Dumbbell",
        is_compound=False,
        is_bodyweight=False,
        is_unilateral=False,
    )

    # 4 weeks of training in 28 days
    # Log 18 sets per week for Chest (total 72 sets) at low RPE 6.5 (RIR 3.5) with stagnant load
    workouts = [
        Workout(
            id=f"w_junk_{i}",
            date=(ref_time - timedelta(days=27 - i * 2)).strftime("%Y-%m-%d"),
            name="Chest",
            started_at=(ref_time - timedelta(days=27 - i * 2)).isoformat(),
            status="completed",
        )
        for i in range(12)  # 12 sessions = 3 per week
    ]

    workout_sets: List[WorkoutSet] = []
    set_id = 0
    for w in workouts:
        for s_idx in range(1, 7):  # 6 sets per workout * 3 workouts = 18 sets / week > 14 MAV
            set_id += 1
            workout_sets.append(
                WorkoutSet(
                    id=f"s_junk_{set_id}",
                    workout_id=w.id,
                    exercise_id=db_fly.id,
                    set_number=s_idx,
                    weight=16.0,  # Constant stagnant load
                    raw_input_weight=16.0,
                    reps=12,
                    rpe=6.5,  # Low intensity < 7.3 RPE
                    rir=3.5,
                    set_type="working",
                    created_at=w.started_at,
                )
            )

    audits = generate_parameter_audits(
        workout_sets=workout_sets,
        workouts=workouts,
        exercises=[db_fly],
        as_of_date=ref_time,
    )

    junk_audits = [a for a in audits if a.audit_type == "JUNK_VOLUME"]
    assert len(junk_audits) == 1
    assert junk_audits[0].target_id == "Chest"
    assert junk_audits[0].parameter_adjustments.get("recommended_volume_multiplier") == 0.75
    assert junk_audits[0].parameter_adjustments.get("target_rpe_min") == 8.5
    assert junk_audits[0].parameter_adjustments.get("target_rpe_max") == 9.0


def test_parameter_audit_axial_bottleneck() -> None:
    """Verification Gate 2.3:

    AXIAL_BOTTLENECK fires when global Banister F(t) > 1.35 P(t),
    local muscle readiness > 70%, and Barbell share of volume > 60%.
    """
    ref_time = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

    bb_squat = Exercise(
        id="ex_squat",
        name="Barbell Back Squat",
        muscle_group="Quads",
        category="Barbell",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
    )

    # 4 workouts with 100% Barbell Back Squat volume for Quads
    workouts = [
        Workout(
            id=f"w_sq_{i}",
            date=(ref_time - timedelta(days=21 - i * 7)).strftime("%Y-%m-%d"),
            name="Legs",
            started_at=(ref_time - timedelta(days=21 - i * 7)).isoformat(),
            status="completed",
        )
        for i in range(4)
    ]

    workout_sets = [
        WorkoutSet(
            id=f"set_sq_{i}_{s_idx}",
            workout_id=workouts[i].id,
            exercise_id=bb_squat.id,
            set_number=s_idx,
            weight=140.0,
            raw_input_weight=140.0,
            reps=6,
            rpe=8.5,
            rir=1.5,
            set_type="working",
            created_at=workouts[i].started_at,
        )
        for i in range(4)
        for s_idx in range(1, 4)
    ]

    # Synthetic Banister series showing high global systemic fatigue (fatigue = 50.0 > 1.35 * fitness = 30.0)
    # but Quads local readiness = 78.0% (> 70%)
    banister_series = [
        DailyPreparedness(
            date="2026-04-01",
            stimulus=25.0,
            fitness=30.0,
            fatigue=45.0,  # 45.0 > 1.35 * 30.0 (40.5)
            preparedness=-15.0,
            tau2=11.0,
            energy_balance="MAINTENANCE",
            readiness=40.0,
            muscle_readiness={"Quads": 78.0, "Chest": 85.0},
        )
    ]

    audits = generate_parameter_audits(
        workout_sets=workout_sets,
        workouts=workouts,
        exercises=[bb_squat],
        preparedness_series=banister_series,
        as_of_date=ref_time,
    )

    axial_audits = [a for a in audits if a.audit_type == "AXIAL_BOTTLENECK"]
    assert len(axial_audits) >= 1
    quad_axial = next(a for a in axial_audits if a.target_id == "Quads")
    assert quad_axial.parameter_adjustments.get("swap_barbell_for_machine_or_cable") is True


def test_parameter_audit_rep_monotony() -> None:
    """Verification Gate 2.4:

    REP_MONOTONY fires when > 85% of sets fall within a +/- 1 rep band
    and 10RM progress is stagnant.
    """
    ref_time = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

    lat_pulldown = Exercise(
        id="ex_lat_pd",
        name="Lat Pulldown",
        muscle_group="Lats",
        category="Cable",
        is_compound=True,
        is_bodyweight=False,
        is_unilateral=False,
    )

    workouts = [
        Workout(
            id=f"w_mono_{i}",
            date=(ref_time - timedelta(days=21 - i * 7)).strftime("%Y-%m-%d"),
            name="Pull",
            started_at=(ref_time - timedelta(days=21 - i * 7)).isoformat(),
            status="completed",
        )
        for i in range(4)
    ]

    # Log 12 sets all doing exactly 10 reps (or 9-11 reps) at fixed weight (100% in +/- 1 band)
    workout_sets = [
        WorkoutSet(
            id=f"s_mono_{i}_{s_idx}",
            workout_id=workouts[i].id,
            exercise_id=lat_pulldown.id,
            set_number=s_idx,
            weight=70.0,  # Fixed flat load
            raw_input_weight=70.0,
            reps=10,      # Monotonous 10 reps
            rpe=8.5,
            rir=1.5,
            set_type="working",
            created_at=workouts[i].started_at,
        )
        for i in range(4)
        for s_idx in range(1, 4)
    ]

    audits = generate_parameter_audits(
        workout_sets=workout_sets,
        workouts=workouts,
        exercises=[lat_pulldown],
        as_of_date=ref_time,
    )

    mono_audits = [a for a in audits if a.audit_type == "REP_MONOTONY"]
    assert len(mono_audits) == 1
    assert mono_audits[0].target_id == lat_pulldown.id
    assert mono_audits[0].parameter_adjustments.get("recommended_top_rep_min") == 5
    assert mono_audits[0].parameter_adjustments.get("recommended_top_rep_max") == 7
    assert mono_audits[0].parameter_adjustments.get("recommended_backoff_rep_min") == 10
    assert mono_audits[0].parameter_adjustments.get("recommended_backoff_rep_max") == 14
