"""Hypertrophy Signal Extraction & Intra-Session Kinetics.

Implements the mathematical specifications for:
1. Effective Repetitions (eReps) per Set (standard working sets vs rest-pause drop/myorep/dc sets).
2. Implicit Inter-Set Rest Intervals (Delta t_rest) adjusted for Time Under Tension (t_TUT).
3. Intra-Exercise Multi-Set Fatigue Decay (delta_drop).
4. Hypertrophy-Specific 10-Repetition Maximum Projection (e10RM_t) from the Tier 2 Kalman state.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
import math
from typing import TYPE_CHECKING, Any, Dict, List, Mapping, Optional, Sequence, Union, overload

import numpy as np
import numpy.typing as npt
import pandas as pd  # type: ignore[import-untyped]
from pydantic import BaseModel, ConfigDict, Field

from src.ingestion.schemas import WorkoutSet

if TYPE_CHECKING:
    from src.models.kalman_1rm import KalmanState

# ============================================================================
# Constants & Hyperparameters
# ============================================================================

DEFAULT_PRIOR_K: float = 0.10
DEFAULT_TUT_SECONDS_PER_REP: float = 3.0
DEFAULT_REST_PAUSE_MAX_REST_SECONDS: float = 45.0
DEFAULT_UNRATED_WORKING_RIR: float = 2.0
REST_PAUSE_SET_TYPES: tuple[str, ...] = ("myorep", "drop", "dc")


# ============================================================================
# Pydantic v2 Models for Signal Ingestion & Audit
# ============================================================================

class SetHypertrophySignal(BaseModel):
    """Extracted hypertrophy metrics and kinetics for an individual workout set."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    set_id: Optional[str] = Field(default=None, description="Unique set identifier.")
    workout_id: Optional[str] = Field(default=None, description="Parent workout session ID.")
    exercise_id: Optional[str] = Field(default=None, description="Target exercise ID.")
    set_number: Optional[int] = Field(default=None, description="Sequential set number.")
    set_type: str = Field(default="working", description="Set classification tag.")
    reps: int = Field(ge=0, description="Completed repetitions.")
    weight: float = Field(ge=0.0, description="Effective mechanical load in kg.")
    effective_reps: float = Field(ge=0.0, description="Calculated stimulating effective repetitions.")
    rir: float = Field(ge=0.0, description="Resolved Reps In Reserve.")
    rpe: Optional[float] = Field(default=None, ge=0.0, le=10.0, description="Rate of Perceived Exertion.")
    implicit_rest_seconds: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Elapsed rest interval from previous set of same exercise (excluding TUT).",
    )
    e1rm: Optional[float] = Field(default=None, ge=0.0, description="Estimated 1RM for this set.")


class IntraSessionDropoffSignal(BaseModel):
    """Multi-set intra-exercise fatigue dropoff evaluation across an exercise in a session."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    workout_id: Optional[str] = Field(default=None, description="Parent workout session ID.")
    exercise_id: Optional[str] = Field(default=None, description="Target exercise ID.")
    working_set_count: int = Field(ge=0, description="Number of evaluated working sets.")
    e1rm_first: Optional[float] = Field(default=None, ge=0.0, description="e1RM of first working set.")
    e1rm_last: Optional[float] = Field(default=None, ge=0.0, description="e1RM of final working set.")
    dropoff_slope: float = Field(description="Fractional drop-off slope delta_drop across sets.")
    k_t: float = Field(default=DEFAULT_PRIOR_K, description="Athlete endurance exponent used for e1RM.")


# ============================================================================
# Helpers
# ============================================================================

def _get_field(obj: Any, name: str, default: Any = None) -> Any:
    """Safe attribute and dictionary accessor."""
    if isinstance(obj, Mapping):
        return obj.get(name, default)
    return getattr(obj, name, default)


def is_amrap_set(obj: Any) -> bool:
    """Detects whether a set is designated as AMRAP or trained to absolute failure."""
    set_type = str(_get_field(obj, "set_type", "")).strip().lower()
    if set_type in ("amrap", "failure"):
        return True
    if bool(_get_field(obj, "is_amrap", False)):
        return True
    notes = str(
        _get_field(obj, "set_notes", _get_field(obj, "notes", "")) or ""
    ).lower()
    return "amrap" in notes


def parse_timestamp(val: Any) -> Optional[datetime]:
    """Normalizes any date, datetime, or ISO 8601 string into a UTC-aware datetime."""
    if val is None:
        return None
    if isinstance(val, datetime):
        if val.tzinfo is None:
            return val.replace(tzinfo=timezone.utc)
        return val.astimezone(timezone.utc)
    if isinstance(val, date):
        return datetime(val.year, val.month, val.day, tzinfo=timezone.utc)
    s = str(val).strip()
    if not s:
        return None
    if s.endswith("Z") or s.endswith("z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        try:
            pdt = pd.to_datetime(s, utc=True)
            res = pdt.to_pydatetime()
            if isinstance(res, datetime):
                return res
            return None
        except Exception:
            return None


def _resolve_set_rir(
    set_type: str,
    rpe_val: Optional[float],
    rir_val: Optional[float],
    amrap_flag: bool,
    default_working_rir: float,
) -> float:
    """Resolves effective RIR according to failure tagging and rating defaults."""
    if rir_val is not None and not math.isnan(float(rir_val)):
        return max(0.0, float(rir_val))
    if rpe_val is not None and not math.isnan(float(rpe_val)):
        return max(0.0, 10.0 - float(rpe_val))
    if set_type in ("amrap", "failure") or amrap_flag:
        return 0.0
    return max(0.0, float(default_working_rir))


# ============================================================================
# Core Mathematical Implementations
# ============================================================================

def compute_effective_reps(
    set_or_reps: Union[int, float, WorkoutSet, Mapping[str, Any], Any],
    rpe: Optional[float] = None,
    rir: Optional[float] = None,
    set_type: Optional[str] = None,
    rest_seconds: Optional[float] = None,
    *,
    default_working_rir: float = DEFAULT_UNRATED_WORKING_RIR,
    is_amrap: Optional[bool] = None,
) -> float:
    """Computes hypertrophic effective repetitions (eReps) for a single workout set.

    Mathematical Specification:
        1. Exclude sets where set_type == 'warmup' -> return 0.0 eReps.
        2. Resolve RIR = 10.0 - RPE (defaulting unrated working sets to RIR = 2.0,
           and AMRAP sets to RIR = 0.0).
        3. For working sets:
           eReps_set = min(reps, max(0.0, 5.0 - RIR))
        4. For myorep, drop, or dc sets where implicit rest Delta t_rest <= 45s:
           eReps_set = min(reps, max(0.0, 5.0 - RIR) + 0.5 * max(0, reps - 5))

    Args:
        set_or_reps: Either completed repetition count (int/float) or a set model / dictionary.
        rpe: Optional Rate of Perceived Exertion (0.0 to 10.0).
        rir: Optional Reps in Reserve (0.0 to 10.0).
        set_type: Optional set classification tag ('working', 'warmup', 'drop', 'myorep', 'dc', 'amrap').
        rest_seconds: Implicit inter-set rest interval Delta t_rest in seconds.
        default_working_rir: Fallback RIR applied to unrated working sets (default 2.0).
        is_amrap: Explicit flag overriding AMRAP set detection.

    Returns:
        Effective repetitions as a non-negative float.
    """
    if isinstance(set_or_reps, (int, float, np.integer, np.floating)) and not isinstance(set_or_reps, bool):
        reps = int(set_or_reps)
        st = str(set_type or "working").strip().lower()
        rpe_val = rpe
        rir_val = rir
        amrap_flag = bool(is_amrap) if is_amrap is not None else (st in ("amrap", "failure"))
        rest_sec = rest_seconds
    else:
        reps_raw = _get_field(set_or_reps, "reps", 0)
        try:
            reps = int(reps_raw)
        except (ValueError, TypeError):
            return 0.0

        st = str(_get_field(set_or_reps, "set_type", set_type or "working")).strip().lower()
        rpe_val = _get_field(set_or_reps, "rpe", rpe)
        rir_val = _get_field(set_or_reps, "rir", rir)
        amrap_flag = is_amrap if is_amrap is not None else is_amrap_set(set_or_reps)
        rest_sec = rest_seconds if rest_seconds is not None else _get_field(
            set_or_reps, "implicit_rest_seconds", _get_field(set_or_reps, "rest_seconds", None)
        )

    if reps <= 0 or st == "warmup":
        return 0.0

    resolved_rir = _resolve_set_rir(
        set_type=st,
        rpe_val=rpe_val,
        rir_val=rir_val,
        amrap_flag=amrap_flag,
        default_working_rir=default_working_rir,
    )

    base_ereps = max(0.0, 5.0 - resolved_rir)

    if st in REST_PAUSE_SET_TYPES:
        is_short_rest = rest_sec is None or float(rest_sec) <= DEFAULT_REST_PAUSE_MAX_REST_SECONDS
        if is_short_rest:
            extra_ereps = 0.5 * max(0.0, float(reps) - 5.0)
            return float(min(float(reps), base_ereps + extra_ereps))

    return float(min(float(reps), base_ereps))


def compute_effective_reps_vectorized(
    reps: Union[pd.Series, npt.NDArray[np.int64], Sequence[int]],
    rpe: Optional[Union[pd.Series, npt.NDArray[np.float64], Sequence[Optional[float]]]] = None,
    rir: Optional[Union[pd.Series, npt.NDArray[np.float64], Sequence[Optional[float]]]] = None,
    set_type: Optional[Union[pd.Series, Sequence[str]]] = None,
    rest_seconds: Optional[Union[pd.Series, npt.NDArray[np.float64], Sequence[Optional[float]]]] = None,
    default_working_rir: float = DEFAULT_UNRATED_WORKING_RIR,
) -> pd.Series:
    """Vectorized calculation of effective reps across a series of workout sets."""
    reps_s = pd.Series(reps, dtype=float).fillna(0)
    n = len(reps_s)

    rpe_s = pd.Series(rpe, dtype=float) if rpe is not None else pd.Series(np.nan, index=reps_s.index)
    rir_s = pd.Series(rir, dtype=float) if rir is not None else pd.Series(np.nan, index=reps_s.index)
    st_s = pd.Series(set_type, dtype=str).str.lower().str.strip() if set_type is not None else pd.Series("working", index=reps_s.index)
    rest_s = pd.Series(rest_seconds, dtype=float) if rest_seconds is not None else pd.Series(np.nan, index=reps_s.index)

    # 1. Warmup mask
    is_warmup = (st_s == "warmup") | (reps_s <= 0)

    # 2. Resolve RIR
    eff_rir = pd.Series(default_working_rir, index=reps_s.index, dtype=float)
    is_amrap = st_s.isin(["amrap", "failure"])
    eff_rir = eff_rir.mask(is_amrap, 0.0)
    eff_rir = eff_rir.mask(~rpe_s.isna(), (10.0 - rpe_s).clip(lower=0.0))
    eff_rir = eff_rir.mask(~rir_s.isna(), rir_s.clip(lower=0.0))

    # 3. Base effective reps
    base_ereps = (5.0 - eff_rir).clip(lower=0.0)

    # 4. Rest-pause boost for myorep, drop, dc when rest <= 45s or NaN
    is_rest_pause = st_s.isin(REST_PAUSE_SET_TYPES)
    qualifies_rest = rest_s.isna() | (rest_s <= DEFAULT_REST_PAUSE_MAX_REST_SECONDS)
    rest_pause_mask = is_rest_pause & qualifies_rest

    extra_reps = pd.Series(0.0, index=reps_s.index, dtype=float)
    extra_reps.loc[rest_pause_mask] = 0.5 * (reps_s.loc[rest_pause_mask] - 5.0).clip(lower=0.0)

    total_ereps = pd.concat([reps_s, base_ereps + extra_reps], axis=1).min(axis=1)
    total_ereps.loc[is_warmup] = 0.0

    return pd.Series(total_ereps, index=reps_s.index, dtype=float)


@overload
def compute_implicit_rest_seconds(
    prev_or_sets: Union[str, datetime, WorkoutSet, Mapping[str, Any], Any],
    curr: Union[str, datetime, WorkoutSet, Mapping[str, Any], Any],
    reps: Optional[int] = None,
) -> float: ...


@overload
def compute_implicit_rest_seconds(
    prev_or_sets: Union[Sequence[Any], pd.DataFrame],
    curr: None = None,
    reps: None = None,
) -> List[Optional[float]]: ...


def compute_implicit_rest_seconds(
    prev_or_sets: Union[str, datetime, WorkoutSet, Mapping[str, Any], Sequence[Any], pd.DataFrame, Any],
    curr: Optional[Union[str, datetime, WorkoutSet, Mapping[str, Any], Any]] = None,
    reps: Optional[int] = None,
) -> Union[float, List[Optional[float]]]:
    """Computes implicit inter-set rest interval Delta t_rest adjusted for TUT.

    Mathematical Specification:
        Delta t_rest,i = max(0, (created_at_i - created_at_{i-1}) - t_TUT)
        where t_TUT = 3.0 * reps_i seconds.

    Usage Modes:
        1. Pair mode: compute_implicit_rest_seconds(prev_time_or_set, curr_time_or_set, reps=10) -> float
        2. Sequence mode: compute_implicit_rest_seconds(sets_sequence) -> List[Optional[float]]
    """
    if curr is not None:
        # Pair mode: evaluate single rest interval
        dt_prev = parse_timestamp(_get_field(prev_or_sets, "created_at", prev_or_sets))
        dt_curr = parse_timestamp(_get_field(curr, "created_at", curr))

        if dt_prev is None or dt_curr is None:
            return 0.0

        if reps is not None:
            reps_curr = int(reps)
        else:
            reps_raw = _get_field(curr, "reps", 0)
            try:
                reps_curr = int(reps_raw)
            except (ValueError, TypeError):
                reps_curr = 0

        elapsed = (dt_curr - dt_prev).total_seconds()
        tut = DEFAULT_TUT_SECONDS_PER_REP * float(reps_curr)
        return float(max(0.0, elapsed - tut))

    # Sequence mode: evaluate across a sequence of sets
    if isinstance(prev_or_sets, pd.DataFrame):
        records: List[Dict[str, Any]] = prev_or_sets.to_dict(orient="records")
        return compute_workout_implicit_rests(records)
    if isinstance(prev_or_sets, Sequence):
        return compute_workout_implicit_rests(prev_or_sets)

    return 0.0


def compute_workout_implicit_rests(
    sets: Sequence[Union[WorkoutSet, Mapping[str, Any], Any]],
) -> List[Optional[float]]:
    """Calculates chronological inter-set rest intervals within exercises/groups in a workout session.

    Sets are partitioned by workout_id, then by exercise_group_id (if present) or exercise_id,
    and sorted chronologically by created_at.
    """
    n = len(sets)
    if n == 0:
        return []

    results: List[Optional[float]] = [None] * n

    # Group by (workout_id, group_key)
    groups: Dict[tuple[str, str], List[tuple[int, datetime, int]]] = {}

    for idx, s in enumerate(sets):
        workout_id = str(_get_field(s, "workout_id", "default_workout") or "default_workout")
        exercise_id = str(_get_field(s, "exercise_id", "default_exercise") or "default_exercise")
        group_id = _get_field(s, "exercise_group_id", None)
        group_key = str(group_id) if group_id else exercise_id

        created_at_dt = parse_timestamp(_get_field(s, "created_at", None))
        if created_at_dt is None:
            continue

        reps_raw = _get_field(s, "reps", 0)
        try:
            reps_val = int(reps_raw)
        except (ValueError, TypeError):
            reps_val = 0

        key = (workout_id, group_key)
        if key not in groups:
            groups[key] = []
        groups[key].append((idx, created_at_dt, reps_val))

    for key, items in groups.items():
        # Sort chronologically by timestamp, preserving original index on ties
        items.sort(key=lambda item: (item[1], item[0]))
        for i in range(1, len(items)):
            prev_idx, dt_prev, _ = items[i - 1]
            curr_idx, dt_curr, reps_curr = items[i]

            elapsed = (dt_curr - dt_prev).total_seconds()
            tut = DEFAULT_TUT_SECONDS_PER_REP * float(reps_curr)
            rest = max(0.0, elapsed - tut)
            results[curr_idx] = float(rest)

    return results


def compute_intra_session_dropoff(
    sets_or_e1rms: Union[Sequence[Union[WorkoutSet, Mapping[str, Any], Any]], Sequence[float], npt.NDArray[np.float64]],
    k_t: float = DEFAULT_PRIOR_K,
    *,
    default_working_rir: float = DEFAULT_UNRATED_WORKING_RIR,
) -> float:
    """Calculates intra-exercise multi-set fatigue decay slope delta_drop across a session.

    Mathematical Specification:
        Using calibrated k_t (or prior k_0 = 0.10):
            e1RM_s = w_s * (reps_s + RIR_s)^k_t
        Fractional drop-off slope across sets s = 1 ... N (for N >= 2):
            delta_drop = (e1RM_1 - e1RM_N) / (e1RM_1 * (N - 1))

    Args:
        sets_or_e1rms: Sequence of WorkoutSet/dicts OR sequence of calculated e1RM values.
        k_t: Endurance exponent parameter (defaults to 0.10).
        default_working_rir: Fallback RIR for unrated working sets.

    Returns:
        Fractional drop-off slope delta_drop (e.g., 0.05 for 5% drop per set).
    """
    if len(sets_or_e1rms) < 2:
        return 0.0

    # Check if direct numeric sequence of e1RM values was provided
    first_elem = sets_or_e1rms[0]
    if isinstance(first_elem, (int, float, np.floating, np.integer)) and not isinstance(first_elem, bool):
        numeric_seq: Sequence[Any] = sets_or_e1rms  # type: ignore[assignment]
        e1rms = [float(x) for x in numeric_seq]
        n_sets = len(e1rms)
        e1 = e1rms[0]
        en = e1rms[-1]
        if e1 <= 0.0:
            return 0.0
        return float((e1 - en) / (e1 * (n_sets - 1)))

    # Sequence of set objects
    working_sets: List[tuple[int, float, int, float]] = []  # (orig_idx, weight, reps, rir)
    set_seq: Sequence[Any] = sets_or_e1rms  # type: ignore[assignment]
    for idx, s in enumerate(set_seq):
        st = str(_get_field(s, "set_type", "working")).strip().lower()
        if st == "warmup":
            continue

        weight_raw = _get_field(s, "weight", 0.0)
        reps_raw = _get_field(s, "reps", 0)
        try:
            w_val = float(weight_raw)
            r_val = int(reps_raw)
        except (ValueError, TypeError):
            continue

        if w_val <= 0.0 or r_val <= 0:
            continue

        rpe_val = _get_field(s, "rpe", None)
        rir_val = _get_field(s, "rir", None)
        amrap_flag = is_amrap_set(s)

        resolved_rir = _resolve_set_rir(
            set_type=st,
            rpe_val=rpe_val,
            rir_val=rir_val,
            amrap_flag=amrap_flag,
            default_working_rir=default_working_rir,
        )
        working_sets.append((idx, w_val, r_val, resolved_rir))

    if len(working_sets) < 2:
        return 0.0

    n_working = len(working_sets)
    e1rms_calc: List[float] = []
    for _, w_s, reps_s, rir_s in working_sets:
        eff_reps_total = max(1.0, float(reps_s) + rir_s)
        e1rm_s = w_s * (eff_reps_total ** k_t)
        e1rms_calc.append(e1rm_s)

    e1 = e1rms_calc[0]
    en = e1rms_calc[-1]
    if e1 <= 0.0:
        return 0.0

    return float((e1 - en) / (e1 * (n_working - 1)))


def evaluate_intra_session_dropoff(
    sets: Sequence[Union[WorkoutSet, Mapping[str, Any], Any]],
    k_t: float = DEFAULT_PRIOR_K,
    default_working_rir: float = DEFAULT_UNRATED_WORKING_RIR,
) -> IntraSessionDropoffSignal:
    """Evaluates intra-session fatigue dropoff and returns a validated Pydantic v2 signal model."""
    slope = compute_intra_session_dropoff(sets, k_t=k_t, default_working_rir=default_working_rir)

    working_e1rms: List[float] = []
    for s in sets:
        st = str(_get_field(s, "set_type", "working")).strip().lower()
        if st == "warmup":
            continue
        try:
            w = float(_get_field(s, "weight", 0.0))
            r = int(_get_field(s, "reps", 0))
        except (ValueError, TypeError):
            continue
        if w <= 0.0 or r <= 0:
            continue
        rir_val = _resolve_set_rir(
            set_type=st,
            rpe_val=_get_field(s, "rpe", None),
            rir_val=_get_field(s, "rir", None),
            amrap_flag=is_amrap_set(s),
            default_working_rir=default_working_rir,
        )
        working_e1rms.append(w * ((r + rir_val) ** k_t))

    w_id = str(_get_field(sets[0], "workout_id", "")) if sets else None
    ex_id = str(_get_field(sets[0], "exercise_id", "")) if sets else None

    return IntraSessionDropoffSignal(
        workout_id=w_id or None,
        exercise_id=ex_id or None,
        working_set_count=len(working_e1rms),
        e1rm_first=working_e1rms[0] if working_e1rms else None,
        e1rm_last=working_e1rms[-1] if working_e1rms else None,
        dropoff_slope=slope,
        k_t=k_t,
    )


def project_e10rm(
    state_or_1rm: Optional[Union[KalmanState, npt.NDArray[np.float64], Sequence[float], float]] = None,
    k: Optional[float] = None,
    *,
    is_ln: Optional[bool] = None,
    e1rm: Optional[float] = None,
    ln_1rm: Optional[float] = None,
) -> float:
    """Projects true 10-Repetition Maximum (e10RM_t) capacity from the Tier 2 Kalman state.

    Mathematical Specification:
        Using the Kalman state vector x_t = [ln(1RM_t), k_t]^T:
            e10RM_t = exp(x_{0, t}) * 10^{-k_t}

    Args:
        state_or_1rm: KalmanState instance, state vector [ln(1RM), k], or raw 1RM / ln(1RM).
        k: Repetition endurance exponent k_t (if not embedded in state vector).
        is_ln: Explicit flag indicating whether numeric scalar represents ln(1RM) vs 1RM.
        e1rm: Explicit keyword argument for 1RM in kg.
        ln_1rm: Explicit keyword argument for ln(1RM).

    Returns:
        Projected 10-Repetition Maximum load in kg.
    """
    if e1rm is not None:
        k_val = k if k is not None else DEFAULT_PRIOR_K
        return float(float(e1rm) * (10.0 ** (-k_val)))

    if ln_1rm is not None:
        k_val = k if k is not None else DEFAULT_PRIOR_K
        return float(math.exp(float(ln_1rm)) * (10.0 ** (-k_val)))

    if hasattr(state_or_1rm, "x") and getattr(state_or_1rm, "x") is not None:
        try:
            x_arr = getattr(state_or_1rm, "x")
            if len(x_arr) == 2:
                return float(math.exp(float(x_arr[0])) * (10.0 ** (-float(x_arr[1]))))
        except (TypeError, IndexError, ValueError):
            pass

    if isinstance(state_or_1rm, (list, tuple, np.ndarray)):
        arr = np.asarray(state_or_1rm, dtype=float)
        if arr.shape == (2,) and k is None:
            return float(math.exp(arr[0]) * (10.0 ** (-arr[1])))

    if isinstance(state_or_1rm, (int, float, np.floating, np.integer)):
        val = float(state_or_1rm)
        k_val = k if k is not None else DEFAULT_PRIOR_K
        if is_ln is True:
            return float(math.exp(val) * (10.0 ** (-k_val)))
        if is_ln is False:
            return float(val * (10.0 ** (-k_val)))
        # Auto-detect: Human 1RM in kg > 15 kg; ln(1RM) for realistic loads (15-400 kg) is ~2.7 - 6.0
        if val > 15.0:
            return float(val * (10.0 ** (-k_val)))
        return float(math.exp(val) * (10.0 ** (-k_val)))

    raise ValueError(f"Unsupported argument types for project_e10rm: {type(state_or_1rm)}")


def extract_hypertrophy_signals(
    sets: Sequence[Union[WorkoutSet, Mapping[str, Any], Any]],
    k_t: float = DEFAULT_PRIOR_K,
    default_working_rir: float = DEFAULT_UNRATED_WORKING_RIR,
) -> List[SetHypertrophySignal]:
    """Batch extracts validated hypertrophy signals and kinetics for all workout sets in a session."""
    rests = compute_workout_implicit_rests(sets)
    signals: List[SetHypertrophySignal] = []

    for s, rest in zip(sets, rests):
        st = str(_get_field(s, "set_type", "working")).strip().lower()
        reps_raw = _get_field(s, "reps", 0)
        weight_raw = _get_field(s, "weight", 0.0)
        try:
            reps = int(reps_raw)
            weight = float(weight_raw)
        except (ValueError, TypeError):
            reps = 0
            weight = 0.0

        rpe_val = _get_field(s, "rpe", None)
        rir_val = _get_field(s, "rir", None)
        amrap_flag = is_amrap_set(s)

        resolved_rir = _resolve_set_rir(
            set_type=st,
            rpe_val=rpe_val,
            rir_val=rir_val,
            amrap_flag=amrap_flag,
            default_working_rir=default_working_rir,
        )

        e_reps = compute_effective_reps(
            set_or_reps=reps,
            rpe=rpe_val,
            rir=rir_val,
            set_type=st,
            rest_seconds=rest,
            default_working_rir=default_working_rir,
            is_amrap=amrap_flag,
        )

        e1rm_val: Optional[float] = None
        if weight > 0.0 and reps > 0 and st != "warmup":
            e1rm_val = weight * ((reps + resolved_rir) ** k_t)

        signals.append(
            SetHypertrophySignal(
                set_id=str(_get_field(s, "id", "")) or None,
                workout_id=str(_get_field(s, "workout_id", "")) or None,
                exercise_id=str(_get_field(s, "exercise_id", "")) or None,
                set_number=_get_field(s, "set_number", None),
                set_type=st,
                reps=reps,
                weight=weight,
                effective_reps=e_reps,
                rir=resolved_rir,
                rpe=float(rpe_val) if rpe_val is not None else None,
                implicit_rest_seconds=rest,
                e1rm=e1rm_val,
            )
        )

    return signals
