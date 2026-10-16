"""Workout Suite — Interactive Streamlit Scientific Analytics Dashboard.

Implements Step 6.4:
- File uploader / bundled dummy data ingestion (Pydantic v2 validated)
- Tier 2 Adaptive Linear Kalman Filter 1RM trajectories & endurance drift (k)
- Banister two-component impulse-response fatigue & fitness modeling
- 14-day rolling bodyweight slope (Delta BW / Delta t) & recovery modulation
- 1-click download for calibrated_parameters.json

Launch command:
    companion\\.venv\\Scripts\\streamlit run companion\\src\\ui\\app.py
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
import json
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional, Tuple

# Ensure companion root directory is in sys.path
_COMPANION_ROOT = str(Path(__file__).resolve().parents[2])
if _COMPANION_ROOT not in sys.path:
    sys.path.insert(0, _COMPANION_ROOT)

import pandas as pd  # type: ignore[import-untyped]
import streamlit as st

from src.export.param_exporter import export_calibrated_parameters
from src.ingestion.schemas import (
    BodyMetric,
    Exercise,
    Workout,
    WorkoutExportPayload,
    WorkoutSet,
)
from src.models.fatigue_banister import (
    DailyPreparedness,
    compute_daily_banister_series,
)
from src.models.kalman_1rm import Adaptive1RMKalmanFilter, KalmanState, is_amrap_set
from src.models.recommendations import get_latest_advisory
from src.models.recovery_modifier import (
    compute_recovery_modifier,
    RecoveryState,
)
from src.ui.charts import (
    build_banister_chart,
    build_bodyweight_recovery_chart,
    build_endurance_k_chart,
    build_kalman_trajectory_chart,
)


def load_payload_from_bytes(file_bytes: bytes) -> WorkoutExportPayload:
    """Parses and validates JSON bytes using Pydantic v2."""
    raw = json.loads(file_bytes.decode("utf-8"))
    return WorkoutExportPayload.model_validate(raw)


def load_payload_from_file(file_path: Path) -> Optional[WorkoutExportPayload]:
    """Reads a JSON file from disk and parses into WorkoutExportPayload."""
    if not file_path.exists():
        return None
    with open(file_path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    return WorkoutExportPayload.model_validate(raw)


def run_kalman_on_exercise(
    exercise_id: str,
    standard_lift_type: Optional[str],
    workouts: List[Workout],
    sets: List[WorkoutSet],
    default_working_rir: Optional[float] = None,
) -> Tuple[List[str], List[KalmanState], List[Tuple[str, float, float]]]:
    """Runs Kalman filter step-by-step and collects history for plotting."""
    sets_by_workout: Dict[str, List[WorkoutSet]] = defaultdict(list)
    for s in sets:
        sets_by_workout[s.workout_id].append(s)

    sorted_workouts = sorted(workouts, key=lambda w: (w.date, w.started_at))
    kf = Adaptive1RMKalmanFilter(
        exercise_id=exercise_id,
        standard_lift_type=standard_lift_type,
    )

    dates: List[str] = []
    states: List[KalmanState] = []
    observations: List[Tuple[str, float, float]] = []

    for w in sorted_workouts:
        if w.id in sets_by_workout:
            session_sets = sets_by_workout[w.id]
            for s in session_sets:
                eff_rir = s.rir
                if eff_rir is None and s.rpe is not None:
                    eff_rir = max(0.0, 10.0 - s.rpe)
                elif eff_rir is None and is_amrap_set(s):
                    eff_rir = 0.0
                elif eff_rir is None and default_working_rir is not None and s.set_type != "warmup":
                    eff_rir = default_working_rir

                if s.reps > 0 and s.weight > 0 and eff_rir is not None and eff_rir <= 3.0:
                    r_eff = s.reps + eff_rir
                    observations.append((w.date, s.weight, r_eff))

            new_states = kf.process_session(
                session_sets,
                default_working_rir=default_working_rir,
                session_date=w.date,
            )
            for state in new_states:
                dates.append(w.date)
                states.append(state)

    return dates, states, observations


def main() -> None:
    st.set_page_config(
        page_title="Workout Suite — Scientific Dashboard",
        page_icon="⚡",
        layout="wide",
        initial_sidebar_state="expanded",
    )

    st.markdown(
        """
        <style>
        .stApp { background-color: #0E0E10; color: #E4E4E7; }
        .metric-card {
            background-color: #18181B;
            border: 1px solid #27272A;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 12px;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )

    st.title("⚡ Workout Suite — Scientific Analysis Dashboard")
    st.caption("Tier 2 Adaptive Linear Kalman Filter & Banister Impulse-Response Engine")

    # -------------------------------------------------------------------------
    # Sidebar: Data Ingestion
    # -------------------------------------------------------------------------
    st.sidebar.header("📁 Data Exchange")
    uploaded_file = st.sidebar.file_uploader(
        "Upload workout_data_export.json",
        type=["json"],
        help="Upload exported JSON from your mobile app (Settings > Export Data)",
    )

    dummy_dir = Path(__file__).resolve().parents[3] / "dummy_data"
    dummy_files = sorted(
        dummy_dir.glob("workout_suite_export_*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    dummy_data_path = (
        dummy_files[0]
        if dummy_files
        else dummy_dir / "workout_suite_export_2026-10-15T21-13-03-987Z.json"
    )
    payload: Optional[WorkoutExportPayload] = None

    if uploaded_file is not None:
        try:
            payload = load_payload_from_bytes(uploaded_file.getvalue())
            st.sidebar.success(f"Loaded {len(payload.workouts)} workouts from upload!")
        except Exception as err:
            st.sidebar.error(f"Failed to parse uploaded JSON: {err}")
    elif dummy_data_path.exists():
        if st.sidebar.button("⚡ Load Exported Dummy Data", use_container_width=True):
            st.session_state["use_dummy"] = True

        if st.session_state.get("use_dummy", True):
            try:
                payload = load_payload_from_file(dummy_data_path)
                if payload:
                    st.sidebar.info(f"Using dummy export ({len(payload.workouts)} workouts).")
            except Exception as err:
                st.sidebar.error(f"Error loading dummy data: {err}")

    if not payload:
        st.warning("Please upload a `workout_data_export.json` file in the sidebar to begin analysis.")
        return

    # -------------------------------------------------------------------------
    # Sidebar: Model & Analysis Settings
    # -------------------------------------------------------------------------
    st.sidebar.markdown("---")
    st.sidebar.header("⚙️ Analysis Settings")
    include_unrated = st.sidebar.checkbox(
        "Include unrated working sets",
        value=True,
        help="Applies standard working set exertion (RIR 2.0 / RPE 8.0) to sets lacking explicit exertion ratings (e.g. StrengthLog imports). Warmups are always excluded.",
    )
    fallback_rir: Optional[float] = None
    fallback_rpe: Optional[float] = None
    if include_unrated:
        fallback_rir = st.sidebar.slider(
            "Default Working Set RIR",
            min_value=0.0,
            max_value=3.0,
            value=2.0,
            step=0.5,
            help="Assumed proximity to failure for unrated working sets. 2.0 RIR corresponds to RPE 8.0.",
        )
        fallback_rpe = 10.0 - fallback_rir
        st.sidebar.caption(
            f"Unrated working sets mapped to **{fallback_rir:.1f} RIR** (**{fallback_rpe:.1f} RPE**)."
        )
    else:
        st.sidebar.caption("Only sets with explicit RIR/RPE will be evaluated.")

    # -------------------------------------------------------------------------
    # Overview KPI Cards
    # -------------------------------------------------------------------------
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("Total Sessions", len(payload.workouts))
    with col2:
        st.metric("Completed Sets", len(payload.workout_sets))
    with col3:
        st.metric("Catalog Exercises", len(payload.exercises))
    with col4:
        bw_count = sum(
            1
            for m in payload.body_metrics
            if m.bodyweight is not None and m.bodyweight > 0
        )
        st.metric("Bodyweight Logs", bw_count)

    # -------------------------------------------------------------------------
    # Tabs
    # -------------------------------------------------------------------------
    tab_kalman, tab_banister, tab_recovery, tab_export = st.tabs([
        "📈 1RM Trajectory & Endurance (k)",
        "⚡ Banister Fitness-Fatigue",
        "⚖️ Bodyweight & Recovery Modifiers",
        "💾 Export Calibrated Parameters",
    ])

    # -------------------------------------------------------------------------
    # Tab 1: Kalman 1RM Trajectory & Endurance Exponent k
    # -------------------------------------------------------------------------
    with tab_kalman:
        st.subheader("Tier 2 Adaptive Linear Kalman Filter")
        st.markdown(
            "Estimates true $\\text{1RM}_t$ and movement-specific repetition endurance $k_t$ "
            "using the linearized Lombardi power law $w = \\text{1RM} \\cdot r_{\\text{eff}}^{-k}$ "
            "with quadratic measurement noise variance $R_t = \\sigma_0^2(1 + \\lambda r_{\\text{eff}}^2)$."
        )

        exercise_map = {e.id: e for e in payload.exercises}
        sets_by_exercise: Dict[str, List[WorkoutSet]] = defaultdict(list)
        for s in payload.workout_sets:
            sets_by_exercise[s.exercise_id].append(s)

        available_exercises: List[Tuple[str, str]] = []
        for ex_id in sets_by_exercise.keys():
            if len(sets_by_exercise[ex_id]) > 0:
                ex_match = exercise_map.get(ex_id)
                name_str = ex_match.name if ex_match is not None else ex_id
                available_exercises.append((ex_id, name_str))
        available_exercises.sort(key=lambda x: x[1])

        if not available_exercises:
            st.info("No exercises with logged sets found in payload.")
        else:
            selected_tuple = st.selectbox(
                "Select Exercise for Analysis",
                options=available_exercises,
                format_func=lambda x: x[1],
            )
            selected_ex_id = selected_tuple[0]
            selected_name = selected_tuple[1]
            ex_obj = exercise_map.get(selected_ex_id)
            std_lift = ex_obj.standard_lift_type if ex_obj else None

            # Exercise Coverage Statistics
            exercise_sets = sets_by_exercise[selected_ex_id]
            unique_sessions = len(set(s.workout_id for s in exercise_sets))
            total_sets = len(exercise_sets)
            warmup_count = sum(1 for s in exercise_sets if s.set_type == "warmup")
            working_count = total_sets - warmup_count
            rated_working = sum(
                1
                for s in exercise_sets
                if s.set_type != "warmup" and (s.rir is not None or s.rpe is not None)
            )
            unrated_working = working_count - rated_working

            # Display coverage strip
            cov_col1, cov_col2, cov_col3, cov_col4 = st.columns(4)
            with cov_col1:
                st.metric("Total Sessions Logged", unique_sessions)
            with cov_col2:
                st.metric("Total Completed Sets", f"{total_sets} ({working_count} work, {warmup_count} warm)")
            with cov_col3:
                st.metric("Explicitly Rated Sets", f"{rated_working} sets")
            with cov_col4:
                unrated_label = (
                    f"{unrated_working} sets (Included)"
                    if include_unrated
                    else f"{unrated_working} sets (Excluded)"
                )
                st.metric("Unrated Working Sets", unrated_label)

            dates, states, obs = run_kalman_on_exercise(
                exercise_id=selected_ex_id,
                standard_lift_type=std_lift,
                workouts=payload.workouts,
                sets=exercise_sets,
                default_working_rir=fallback_rir,
            )

            if states:
                last_state = states[-1]
                mcol1, mcol2, mcol3, mcol4 = st.columns(4)
                with mcol1:
                    st.metric(
                        "Estimated True 1RM",
                        f"{last_state.e1rm:.1f} kg",
                        f"± {last_state.e1rm_std_err:.1f} kg",
                    )
                with mcol2:
                    st.metric(
                        "Endurance Exponent (k)",
                        f"{last_state.k:.4f}",
                        f"± {last_state.k_std_err:.4f}",
                    )
                with mcol3:
                    session_count = len(set(dates))
                    st.metric(
                        "Total Updates",
                        f"{last_state.step_count} ({session_count} sessions)",
                    )
                with mcol4:
                    std_label = std_lift.upper() if std_lift else "CUSTOM / ISOLATION"
                    st.metric("Lift Biomechanics", std_label)

                fig_traj = build_kalman_trajectory_chart(
                    exercise_name=selected_name,
                    dates=dates,
                    states=states,
                    observations=obs,
                )
                st.plotly_chart(fig_traj, use_container_width=True)

                fig_k = build_endurance_k_chart(
                    exercise_name=selected_name,
                    dates=dates,
                    states=states,
                )
                st.plotly_chart(fig_k, use_container_width=True)
            else:
                if not include_unrated and unrated_working > 0:
                    st.warning(
                        f"No rated sets (RIR ≤ 3) found for {selected_name}. "
                        f"Enable 'Include unrated working sets' in the sidebar to calibrate using the {unrated_working} unrated working sets."
                    )
                else:
                    st.warning(
                        f"Not enough high-effort sets (RIR ≤ 3) to calibrate {selected_name}."
                    )

    # -------------------------------------------------------------------------
    # Tab 2: Banister Fitness-Fatigue
    # -------------------------------------------------------------------------
    with tab_banister:
        st.subheader("Banister Two-Component Impulse-Response Model")
        st.markdown(
            "Calculates daily training stimulus (Effective Stimulating Sets scaled by relative intensity) "
            "and integrates Fitness $P(t)$ ($\\tau_1 \\approx 42\\text{d}$) and dynamic Fatigue $F(t)$ "
            "to model Net Preparedness."
        )

        daily_series = compute_daily_banister_series(
            workouts=payload.workouts,
            workout_sets=payload.workout_sets,
            body_metrics=payload.body_metrics,
            default_working_rpe=fallback_rpe,
        )

        if daily_series:
            fig_banister = build_banister_chart(daily_series)
            st.plotly_chart(fig_banister, use_container_width=True)

            latest_point = daily_series[-1]
            advisory = get_latest_advisory(daily_series)

            bcol1, bcol2, bcol3, bcol4 = st.columns(4)
            with bcol1:
                st.metric("Current Fitness P(t)", f"{latest_point.fitness:.1f} AU")
            with bcol2:
                st.metric("Current Fatigue F(t)", f"{latest_point.fatigue:.1f} AU")
            with bcol3:
                st.metric(
                    "Net Preparedness",
                    f"{latest_point.preparedness:+.1f} AU",
                )
            with bcol4:
                acwr_display = f"{advisory.acwr:.2f}" if advisory is not None else "N/A"
                st.metric(
                    "Acute:Chronic Ratio (ACWR)",
                    acwr_display,
                )

            if advisory is not None:
                st.info(f"**Recommendation ({advisory.advisory_type}):** {advisory.message}")
        else:
            st.info("No training data available for Banister modeling.")

    # -------------------------------------------------------------------------
    # Tab 3: Bodyweight & Dynamic Recovery
    # -------------------------------------------------------------------------
    with tab_recovery:
        st.subheader("Longitudinal Body Composition & Recovery Scaling")
        st.markdown(
            "Computes 14-day rolling Ordinary Least Squares slope ($\\Delta BW / \\Delta t$). "
            "Caloric surplus shortens fatigue decay $\\tau_2$ by up to 25%, while caloric deficit "
            "lengthens $\\tau_2$ by up to 30% per ADR-003."
        )

        if payload.body_metrics:
            sorted_bm = sorted(payload.body_metrics, key=lambda m: m.date)
            valid_bm = [
                m
                for m in sorted_bm
                if m.bodyweight is not None and m.bodyweight > 0
            ]
            unique_dates = (
                sorted(list(set(m.date for m in valid_bm))) if valid_bm else []
            )
            recovery_states: List[Tuple[date, RecoveryState]] = []

            for d_str in unique_dates:
                d_obj = datetime.strptime(d_str, "%Y-%m-%d").date()
                rec = compute_recovery_modifier(sorted_bm, target_date=d_obj)
                recovery_states.append((d_obj, rec))

            fig_bw = build_bodyweight_recovery_chart(payload.body_metrics, recovery_states)
            st.plotly_chart(fig_bw, use_container_width=True)
        else:
            st.info("No body metrics logged in this export.")

    # -------------------------------------------------------------------------
    # Tab 4: Export Calibrated Parameters (Round-Trip)
    # -------------------------------------------------------------------------
    with tab_export:
        st.subheader("Calibrated Parameters Generator")
        st.markdown(
            "Export the latest Kalman posterior $(1\\text{RM}_t, k_t, \\mathbf{P}_t)$ "
            "for all exercises into `calibrated_parameters.json` to import back into your mobile app."
        )

        envelope = export_calibrated_parameters(payload, default_working_rir=fallback_rir)

        if envelope.parameters:
            table_data = [
                {
                    "Exercise ID": p.exercise_id,
                    "Name": (
                        exercise_map[p.exercise_id].name
                        if p.exercise_id in exercise_map
                        else p.exercise_id
                    ),
                    "Calibrated 1RM (kg)": p.calibrated_1rm,
                    "Calibrated k": p.calibrated_k,
                    "Var ln(1RM) (cov_p00)": p.cov_p00,
                    "Var k (cov_p11)": p.cov_p11,
                    "Calibrated At": p.calibrated_at,
                }
                for p in envelope.parameters
            ]
            df = pd.DataFrame(table_data)
            st.dataframe(df, use_container_width=True)

            json_output = envelope.model_dump_json(indent=2)
            st.download_button(
                label="⬇️ Download calibrated_parameters.json",
                data=json_output,
                file_name="calibrated_parameters.json",
                mime="application/json",
                use_container_width=True,
            )
            st.success(f"Ready to export {len(envelope.parameters)} calibrated exercise parameters.")
        else:
            st.warning("No exercises had sufficient filtered sets for calibration.")


if __name__ == "__main__":
    main()
