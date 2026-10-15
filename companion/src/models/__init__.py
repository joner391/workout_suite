"""Scientific modeling engines for Workout Suite Companion.

Includes:
- Tier 2 Adaptive Linear Kalman Filter for individualized 1RM and endurance (k) estimation.
- Dynamic recoverability and Banister impulse-response modeling.
- Actionable ACWR advisory engine.
"""

from src.models.fatigue_banister import (
    DEFAULT_K1,
    DEFAULT_K2,
    DEFAULT_TAU1_DAYS,
    MIN_STIMULATING_RPE,
    DailyPreparedness,
    SetStimulus,
    calculate_set_stimulus,
    compute_daily_banister_series,
)
from src.models.kalman_1rm import (
    DEFAULT_LAMBDA,
    DEFAULT_Q_K,
    DEFAULT_Q_LN_1RM,
    DEFAULT_SIGMA_BASE,
    MAX_PLAUSIBLE_K,
    MIN_PLAUSIBLE_K,
    PRIOR_COVARIANCE_DIAG,
    PRIOR_K_BY_LIFT,
    Adaptive1RMKalmanFilter,
    FilteredSet,
    KalmanState,
    calculate_effective_reps,
    filter_session_sets,
    get_initial_prior,
    update_1rm_filter,
)
from src.models.recommendations import (
    ACWR_ACUTE_WINDOW_DAYS,
    ACWR_CHRONIC_WINDOW_DAYS,
    ACWR_DELOAD_THRESHOLD,
    ACWR_OPTIMAL_MAX_THRESHOLD,
    ACWR_UNDER_STIMULATION_THRESHOLD,
    TrainingAdvisory,
    calculate_acwr,
    compute_training_advisories,
    generate_advisory_for_day,
    get_latest_advisory,
)
from src.models.recovery_modifier import (
    DEFAULT_TAU2_BASE_DAYS,
    DEFAULT_WINDOW_DAYS,
    RecoveryState,
    compute_bodyweight_slope,
    compute_recovery_modifier,
)

__all__ = [
    # Kalman 1RM
    "DEFAULT_LAMBDA",
    "DEFAULT_Q_K",
    "DEFAULT_Q_LN_1RM",
    "DEFAULT_SIGMA_BASE",
    "MAX_PLAUSIBLE_K",
    "MIN_PLAUSIBLE_K",
    "PRIOR_COVARIANCE_DIAG",
    "PRIOR_K_BY_LIFT",
    "Adaptive1RMKalmanFilter",
    "FilteredSet",
    "KalmanState",
    "calculate_effective_reps",
    "filter_session_sets",
    "get_initial_prior",
    "update_1rm_filter",
    # Recovery Modifier
    "DEFAULT_TAU2_BASE_DAYS",
    "DEFAULT_WINDOW_DAYS",
    "RecoveryState",
    "compute_bodyweight_slope",
    "compute_recovery_modifier",
    # Fatigue Banister
    "DEFAULT_K1",
    "DEFAULT_K2",
    "DEFAULT_TAU1_DAYS",
    "MIN_STIMULATING_RPE",
    "DailyPreparedness",
    "SetStimulus",
    "calculate_set_stimulus",
    "compute_daily_banister_series",
    # Recommendations & ACWR
    "ACWR_ACUTE_WINDOW_DAYS",
    "ACWR_CHRONIC_WINDOW_DAYS",
    "ACWR_DELOAD_THRESHOLD",
    "ACWR_OPTIMAL_MAX_THRESHOLD",
    "ACWR_UNDER_STIMULATION_THRESHOLD",
    "TrainingAdvisory",
    "calculate_acwr",
    "compute_training_advisories",
    "generate_advisory_for_day",
    "get_latest_advisory",
]
