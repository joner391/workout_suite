"""Interactive Plotly Chart Generators for Workout Suite Scientific Dashboard.

Implements Step 6.4:
- Kalman 1RM trajectory with +/- 1 SD uncertainty bands (exp(x_0) * sqrt(P[0,0]))
- Movement-specific endurance exponent drift (k_t) with +/- 1 SD corridor
- Banister two-component impulse-response model (Fitness, Fatigue, Net Preparedness)
- 14-day rolling bodyweight slope (Delta BW / Delta t) & recovery modulation
"""

from __future__ import annotations

from datetime import date
from typing import Any, List, Optional, Sequence, Tuple, Union

import numpy as np
import plotly.graph_objects as go  # type: ignore[import-untyped]
from plotly.subplots import make_subplots  # type: ignore[import-untyped]

from src.ingestion.schemas import BodyMetric
from src.models.fatigue_banister import DailyPreparedness
from src.models.kalman_1rm import KalmanState
from src.models.recovery_modifier import RecoveryState


DARK_LAYOUT_TEMPLATE = dict(
    paper_bgcolor="#121214",
    plot_bgcolor="#18181B",
    font=dict(color="#E4E4E7", family="system-ui, -apple-system, sans-serif"),
    margin=dict(l=40, r=40, t=50, b=40),
    hovermode="x unified",
    legend=dict(
        bgcolor="rgba(24, 24, 27, 0.8)",
        bordercolor="#27272A",
        borderwidth=1,
    ),
)


def build_kalman_trajectory_chart(
    exercise_name: str,
    dates: Sequence[Union[str, date]],
    states: Sequence[KalmanState],
    observations: Optional[Sequence[Tuple[Union[str, date], float, float]]] = None,
) -> go.Figure:
    """Builds interactive Kalman 1RM trajectory plot with +/- 1 SD uncertainty envelope.

    Args:
        exercise_name: Display name of the lift.
        dates: List of dates corresponding to each Kalman update.
        states: Sequence of KalmanState instances.
        observations: Optional list of tuples (date, weight, r_eff) for raw data points.
    """
    fig = go.Figure()

    if not states or not dates:
        fig.add_annotation(
            text="No filtered sets recorded for this exercise.",
            xref="paper",
            yref="paper",
            x=0.5,
            y=0.5,
            showarrow=False,
            font=dict(size=14, color="#A1A1AA"),
        )
        fig.update_layout(**DARK_LAYOUT_TEMPLATE)
        return fig

    date_strs = [str(d) for d in dates]
    e1rm_vals = [s.e1rm for s in states]
    upper_bounds = [s.e1rm + s.e1rm_std_err for s in states]
    lower_bounds = [max(0.0, s.e1rm - s.e1rm_std_err) for s in states]

    # 1. Shaded Uncertainty Band (+/- 1 SD)
    # Upper bound trace (invisible line)
    fig.add_trace(
        go.Scatter(
            x=date_strs,
            y=upper_bounds,
            mode="lines",
            line=dict(width=0),
            hoverinfo="skip",
            showlegend=False,
            name="Upper +1 SD",
        )
    )
    # Lower bound trace with fill
    fig.add_trace(
        go.Scatter(
            x=date_strs,
            y=lower_bounds,
            mode="lines",
            line=dict(width=0),
            fill="tonexty",
            fillcolor="rgba(59, 130, 246, 0.18)",
            hoverinfo="skip",
            name="±1 SD Uncertainty",
        )
    )

    # 2. Kalman Posterior 1RM Curve
    fig.add_trace(
        go.Scatter(
            x=date_strs,
            y=e1rm_vals,
            mode="lines+markers",
            line=dict(color="#3B82F6", width=3),
            marker=dict(size=7, color="#60A5FA"),
            name="Kalman Estimated 1RM (kg)",
            hovertemplate="<b>%{x}</b><br>Estimated 1RM: %{y:.1f} kg<extra></extra>",
        )
    )

    # 3. Raw Observed Sets (Submaximal Lombardi e1RM)
    if observations:
        obs_x = [str(o[0]) for o in observations]
        # w * r_eff^0.10
        obs_y = [round(o[1] * (o[2] ** 0.10), 1) for o in observations]
        obs_custom = [f"{o[1]} kg × {o[2]:.1f} r_eff" for o in observations]
        fig.add_trace(
            go.Scatter(
                x=obs_x,
                y=obs_y,
                mode="markers",
                marker=dict(
                    size=8,
                    color="#F59E0B",
                    symbol="diamond",
                    line=dict(color="#18181B", width=1),
                ),
                name="Raw Logged Sets",
                customdata=obs_custom,
                hovertemplate="<b>%{x}</b><br>Set: %{customdata}<br>Submaximal e1RM: %{y:.1f} kg<extra></extra>",
            )
        )

    fig.update_layout(
        title=f"<b>{exercise_name}</b> — Adaptive 1RM Trajectory & Uncertainty",
        xaxis=dict(title="Session Date", gridcolor="#27272A"),
        yaxis=dict(title="1-Rep Max Load (kg)", gridcolor="#27272A"),
        **DARK_LAYOUT_TEMPLATE,
    )
    return fig


def build_endurance_k_chart(
    exercise_name: str,
    dates: Sequence[Union[str, date]],
    states: Sequence[KalmanState],
) -> go.Figure:
    """Builds interactive endurance fatigue exponent (k_t) drift plot."""
    fig = go.Figure()

    if not states or not dates:
        fig.add_annotation(
            text="Insufficient data for endurance calibration.",
            xref="paper",
            yref="paper",
            x=0.5,
            y=0.5,
            showarrow=False,
            font=dict(size=14, color="#A1A1AA"),
        )
        fig.update_layout(**DARK_LAYOUT_TEMPLATE)
        return fig

    date_strs = [str(d) for d in dates]
    k_vals = [s.k for s in states]
    upper_k = [min(0.20, s.k + s.k_std_err) for s in states]
    lower_k = [max(0.03, s.k - s.k_std_err) for s in states]

    # Uncertainty Envelope for k
    fig.add_trace(
        go.Scatter(
            x=date_strs,
            y=upper_k,
            mode="lines",
            line=dict(width=0),
            hoverinfo="skip",
            showlegend=False,
        )
    )
    fig.add_trace(
        go.Scatter(
            x=date_strs,
            y=lower_k,
            mode="lines",
            line=dict(width=0),
            fill="tonexty",
            fillcolor="rgba(16, 185, 129, 0.15)",
            hoverinfo="skip",
            name="±1 SD Uncertainty (k)",
        )
    )

    # Main k Curve
    fig.add_trace(
        go.Scatter(
            x=date_strs,
            y=k_vals,
            mode="lines+markers",
            line=dict(color="#10B981", width=2.5),
            marker=dict(size=6, color="#34D399"),
            name="Endurance Exponent (k)",
            hovertemplate="<b>%{x}</b><br>Calibrated k: %{y:.4f}<extra></extra>",
        )
    )

    # Reference Default k = 0.10 Line
    fig.add_hline(
        y=0.10,
        line_dash="dash",
        line_color="#71717A",
        annotation_text="Population Default k = 0.10",
        annotation_position="bottom right",
    )

    fig.update_layout(
        title=f"<b>{exercise_name}</b> — Repetition Endurance Drift (k)",
        xaxis=dict(title="Session Date", gridcolor="#27272A"),
        yaxis=dict(
            title="Endurance Exponent k",
            range=[0.02, 0.18],
            gridcolor="#27272A",
        ),
        **DARK_LAYOUT_TEMPLATE,
    )
    return fig


def build_banister_chart(daily_points: Sequence[DailyPreparedness]) -> go.Figure:
    """Builds interactive Banister Impulse-Response Fitness, Fatigue & Preparedness curves."""
    fig = go.Figure()

    if not daily_points:
        fig.add_annotation(
            text="No training history available for Banister modeling.",
            xref="paper",
            yref="paper",
            x=0.5,
            y=0.5,
            showarrow=False,
            font=dict(size=14, color="#A1A1AA"),
        )
        fig.update_layout(**DARK_LAYOUT_TEMPLATE)
        return fig

    dates = [p.date for p in daily_points]
    fitness = [p.fitness for p in daily_points]
    fatigue = [p.fatigue for p in daily_points]
    preparedness = [p.preparedness for p in daily_points]

    # Fitness Curve (P_t, slow decay)
    fig.add_trace(
        go.Scatter(
            x=dates,
            y=fitness,
            mode="lines",
            line=dict(color="#10B981", width=2.5),
            name="Fitness P(t) [τ1 ≈ 42d]",
            hovertemplate="Fitness: %{y:.1f} AU<extra></extra>",
        )
    )

    # Fatigue Curve (F_t, fast decay)
    fig.add_trace(
        go.Scatter(
            x=dates,
            y=fatigue,
            mode="lines",
            line=dict(color="#EF4444", width=2),
            name="Fatigue F(t) [Dynamic τ2]",
            hovertemplate="Fatigue: %{y:.1f} AU<extra></extra>",
        )
    )

    # Net Preparedness Curve
    fig.add_trace(
        go.Scatter(
            x=dates,
            y=preparedness,
            mode="lines",
            line=dict(color="#38BDF8", width=3),
            fill="tozeroy",
            fillcolor="rgba(56, 189, 248, 0.10)",
            name="Net Preparedness",
            hovertemplate="Preparedness: %{y:.1f} AU<extra></extra>",
        )
    )

    # Zero Baseline
    fig.add_hline(y=0, line_dash="solid", line_color="#3F3F46", line_width=1)

    fig.update_layout(
        title="<b>Banister Impulse-Response Modeling</b> (Fitness, Fatigue & Readiness)",
        xaxis=dict(title="Calendar Date", gridcolor="#27272A"),
        yaxis=dict(title="Arbitrary Units (AU)", gridcolor="#27272A"),
        **DARK_LAYOUT_TEMPLATE,
    )
    return fig


def build_bodyweight_recovery_chart(
    body_metrics: Sequence[BodyMetric],
    recovery_states: Sequence[Tuple[date, RecoveryState]],
) -> go.Figure:
    """Builds 2-row subplot for longitudinal bodyweight and rolling 14-day slope."""
    fig = make_subplots(
        rows=2,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=0.12,
        subplot_titles=(
            "Bodyweight Trajectory (kg)",
            "14-Day Rolling ΔBW / Δt (kg / week) & Fatigue Decay (τ2) Modulation",
        ),
    )

    valid_metrics = [
        m for m in sorted(body_metrics, key=lambda m: m.date)
        if m.bodyweight is not None and m.bodyweight > 0
    ]
    if not valid_metrics:
        fig.add_annotation(
            text="No bodyweight logs recorded.",
            xref="paper",
            yref="paper",
            x=0.5,
            y=0.5,
            showarrow=False,
            font=dict(size=14, color="#A1A1AA"),
        )
        fig.update_layout(**DARK_LAYOUT_TEMPLATE)
        return fig

    dates = [m.date for m in valid_metrics]
    weights = [m.bodyweight for m in valid_metrics]

    # Row 1: Bodyweight Scatter & Trend
    fig.add_trace(
        go.Scatter(
            x=dates,
            y=weights,
            mode="lines+markers",
            line=dict(color="#A855F7", width=2),
            marker=dict(size=5, color="#C084FC"),
            name="Bodyweight (kg)",
            hovertemplate="<b>%{x}</b>: %{y:.1f} kg<extra></extra>",
        ),
        row=1,
        col=1,
    )

    # Row 2: Rolling 14-day slope (kg/week)
    if recovery_states:
        rec_dates = [str(r[0]) for r in recovery_states]
        slopes_weekly = [r[1].slope_kg_per_week for r in recovery_states]
        tau2_vals = [r[1].effective_tau2 for r in recovery_states]

        # Bar chart with positive/negative color coding
        colors = ["#10B981" if s >= 0 else "#F43F5E" for s in slopes_weekly]
        fig.add_trace(
            go.Bar(
                x=rec_dates,
                y=slopes_weekly,
                marker=dict(color=colors),
                name="ΔBW/Δt (kg/wk)",
                customdata=tau2_vals,
                hovertemplate="<b>%{x}</b><br>Rate: %{y:+.2f} kg/wk<br>Dynamic τ2: %{customdata:.1f} days<extra></extra>",
            ),
            row=2,
            col=1,
        )

        fig.add_hline(
            y=0.10,
            line_dash="dot",
            line_color="#10B981",
            annotation_text="Surplus Threshold (+0.10 kg/wk)",
            row=2,
            col=1,
        )
        fig.add_hline(
            y=-0.10,
            line_dash="dot",
            line_color="#F43F5E",
            annotation_text="Deficit Threshold (-0.10 kg/wk)",
            row=2,
            col=1,
        )

    fig.update_layout(
        **DARK_LAYOUT_TEMPLATE,
        height=650,
        showlegend=True,
    )
    fig.update_xaxes(gridcolor="#27272A")
    fig.update_yaxes(gridcolor="#27272A")
    return fig
