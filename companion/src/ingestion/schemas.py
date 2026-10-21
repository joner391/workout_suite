"""Pydantic v2 data models for Workout Suite data ingestion and contract synchronization.

Mirrors:
- schemas/workout_export.schema.json
- schemas/calibrated_parameters.schema.json
- mobile/src/core/types/index.ts
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, ConfigDict, Field, field_validator

# ============================================================================
# Enums / Literal Type Aliases
# ============================================================================

LoadMode = Literal["total", "per_hand"]
StandardLiftType = Literal["squat", "bench", "deadlift", "ohp", "row"]
GearType = Literal[
    "barbell",
    "cable_machine",
    "plate_loaded_machine",
    "specialty_bar",
    "accessory",
]
WorkoutStatus = Literal["in_progress", "completed", "discarded"]
SetType = Literal["warmup", "working", "drop", "myorep", "dc", "amrap"]
Gender = Literal["male", "female"]
PainType = Literal["joint", "muscle"]
TrainingMentality = Literal["fury", "precision", "get_out"]
TrainingEnjoyment = Literal["enthusiast", "neutral", "minimalist"]
IntensityStyle = Literal[
    "high_intensity_low_volume",
    "volume_accumulation",
    "balanced",
]
PrimaryGoal = Literal[
    "strength",
    "hypertrophy",
    "powerbuilding",
    "endurance",
    "longevity",
]
EquipmentAccess = Literal[
    "commercial_gym",
    "garage_gym",
    "dumbbells_only",
    "bodyweight_only",
]
ExperienceLevel = Literal["beginner", "intermediate", "advanced"]
AxialLoading = Literal["none", "low", "moderate", "high"]
RomTier = Literal["deep_stretch", "standard_full", "shortened_restricted"]
ExerciseSentiment = Literal["liked", "neutral", "disliked", "blacklisted"]
JointLocation = Literal[
    "shoulder",
    "elbow",
    "wrist",
    "lower_back",
    "hip",
    "knee",
    "ankle",
    "neck",
    "chest_pec",
    "other",
]

SEMVER_REGEX = r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
HEX_COLOR_REGEX = r"^#[0-9a-fA-F]{6}$"
DATE_REGEX = r"^\d{4}-\d{2}-\d{2}$"


# ============================================================================
# Base Configuration
# ============================================================================

class StrictSchemaModel(BaseModel):
    """Base model enforcing strict schema validation with no undeclared properties."""

    model_config = ConfigDict(
        extra="forbid",
        validate_assignment=True,
        str_strip_whitespace=True,
    )


# ============================================================================
# Workout Export Schema Models (schemas/workout_export.schema.json)
# ============================================================================

class Program(StrictSchemaModel):
    """Multi-day training program split (e.g. Upper/Lower, PPL)."""

    id: str = Field(description="Unique identifier for the program.")
    name: str = Field(description="Human-readable name of the program split.")
    color_hex: str = Field(
        pattern=HEX_COLOR_REGEX,
        description="Hex color code for calendar and chart shading.",
    )
    notes: Optional[str] = Field(
        default=None,
        description="Optional program description or objectives.",
    )
    created_at: str = Field(description="ISO 8601 creation timestamp.")


class ProgramBlock(StrictSchemaModel):
    """Active or historical meso-cycle training era interval."""

    id: str = Field(description="Unique identifier for the program block.")
    program_id: str = Field(description="Foreign key referencing programs.id.")
    start_date: str = Field(
        pattern=DATE_REGEX,
        description="ISO 8601 calendar start date (YYYY-MM-DD).",
    )
    end_date: Optional[str] = Field(
        default=None,
        pattern=DATE_REGEX,
        description="ISO 8601 calendar end date (YYYY-MM-DD) or null if active.",
    )


class WorkoutTemplate(StrictSchemaModel):
    """Daily workout session template belonging to a program split."""

    id: str = Field(description="Unique identifier for the workout template.")
    program_id: Optional[str] = Field(
        default=None,
        description="Foreign key referencing programs.id, or null if standalone.",
    )
    name: str = Field(description="Name of the daily workout session.")
    notes: Optional[str] = Field(
        default=None,
        description="Optional template instructions or focus cues.",
    )
    order_index: int = Field(
        ge=0,
        description="Sequential sorting order within the parent program split.",
    )
    created_at: str = Field(description="ISO 8601 creation timestamp.")


class TemplateExercise(StrictSchemaModel):
    """Prescribed exercise slot within a workout template."""

    id: str = Field(description="Unique identifier for the prescription.")
    template_id: str = Field(description="Foreign key referencing workout_templates.id.")
    exercise_id: str = Field(description="Foreign key referencing exercises.id.")
    gear_id: Optional[str] = Field(
        default=None,
        description="Optional foreign key referencing gear_inventory.id.",
    )
    target_sets: Optional[int] = Field(
        default=None,
        ge=1,
        description="Target working set count.",
    )
    target_reps_min: Optional[int] = Field(
        default=None,
        ge=1,
        description="Bottom of target rep bracket.",
    )
    target_reps_max: Optional[int] = Field(
        default=None,
        ge=1,
        description="Top of target rep bracket.",
    )
    target_rpe: Optional[float] = Field(
        default=None,
        ge=5.0,
        le=10.0,
        description="Target Rate of Perceived Exertion (5.0-10.0).",
    )
    target_rir: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=5.0,
        description="Target Reps in Reserve (0.0-5.0).",
    )
    order_index: int = Field(
        ge=0,
        description="Execution order index within the session.",
    )
    exercise_group_id: Optional[str] = Field(
        default=None,
        description="Group ID for supersets, giant sets, or circuits.",
    )
    set_type: Optional[SetType] = Field(
        default="working",
        description="Default set execution style (e.g. 'working', 'myorep', 'amrap').",
    )


class ProgressionRule(StrictSchemaModel):
    """Declarative condition-action rule assigned to a template exercise."""

    id: str = Field(description="Unique identifier for the progression rule.")
    template_exercise_id: str = Field(
        description="Foreign key referencing template_exercises.id.",
    )
    priority: int = Field(
        default=0,
        description="Evaluation priority order (lower = evaluated first).",
    )
    rule_json: Union[Dict[str, Any], str] = Field(
        description="Structured rule payload (object or serialized JSON string).",
    )


class Workout(StrictSchemaModel):
    """Logged workout session."""

    id: str = Field(description="Unique identifier for the workout.")
    template_id: Optional[str] = Field(
        default=None,
        description="Foreign key referencing workout_templates.id.",
    )
    date: str = Field(
        pattern=DATE_REGEX,
        description="Calendar date of the workout (YYYY-MM-DD).",
    )
    name: str = Field(description="Session title.")
    notes: Optional[str] = Field(
        default=None,
        description="Session-level athlete notes.",
    )
    started_at: str = Field(description="ISO 8601 timestamp when workout commenced.")
    duration_seconds: Optional[int] = Field(
        default=None,
        ge=0,
        description="Elapsed duration in seconds.",
    )
    status: WorkoutStatus = Field(description="Lifecycle state of the workout.")
    completed_at: Optional[str] = Field(
        default=None,
        description="ISO 8601 timestamp when completed.",
    )
    imported_from: Optional[str] = Field(
        default=None,
        description="Provenance identifier if imported from external app.",
    )


class WorkoutSet(StrictSchemaModel):
    """Individual exercise set logged during a workout session.

    Implements ADR-026 dual-weight persistence:
    - weight: normalized effective load in kg for fatigue and 1RM calculation.
    - raw_input_weight: exact number typed by user in the UI.
    """

    id: str = Field(description="Unique identifier for the set.")
    workout_id: str = Field(description="Foreign key referencing workouts.id.")
    exercise_id: str = Field(description="Foreign key referencing exercises.id.")
    gear_id: Optional[str] = Field(
        default=None,
        description="Optional foreign key referencing gear_inventory.id.",
    )
    set_number: int = Field(ge=1, description="Sequential set index.")
    weight: float = Field(
        ge=0.0,
        description="Normalized effective mechanical load in kg (ADR-026).",
    )
    raw_input_weight: float = Field(
        ge=0.0,
        description="Exact load typed by user in the UI (ADR-026).",
    )
    added_weight: Optional[float] = Field(
        default=None,
        description="External added load (+10 kg) or assistance (-15 kg).",
    )
    reps: int = Field(ge=0, description="Repetitions completed (or Left limb reps).")
    reps_right: Optional[int] = Field(
        default=None,
        ge=0,
        description="Right limb repetitions if unilateral movement.",
    )
    rpe: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=10.0,
        description="Rate of Perceived Exertion (0.0-10.0).",
    )
    rir: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=10.0,
        description="Reps in Reserve (0.0-10.0).",
    )
    set_type: SetType = Field(
        default="working",
        description="Classification tag for the set.",
    )
    set_notes: Optional[str] = Field(
        default=None,
        description="Optional per-set annotations.",
    )
    exercise_group_id: Optional[str] = Field(
        default=None,
        description="Group ID for superset/giant set pairing.",
    )
    created_at: str = Field(description="ISO 8601 timestamp when checked off.")


class Exercise(StrictSchemaModel):
    """Exercise catalog item (standard movement or custom user-created)."""

    id: str = Field(description="Unique identifier for the exercise.")
    name: str = Field(description="Canonical exercise name.")
    muscle_group: str = Field(description="Primary muscle group.")
    category: str = Field(description="Equipment category.")
    is_compound: bool = Field(description="True if compound; False if isolation.")
    is_bodyweight: bool = Field(description="True if movement utilizes body mass.")
    is_unilateral: bool = Field(description="True if movement trains limbs independently.")
    load_mode: LoadMode = Field(
        default="total",
        description="Load mode ('total' or 'per_hand' auto-doubled for dumbbells).",
    )
    default_cable_ratio: float = Field(
        default=1.0,
        ge=0.1,
        le=5.0,
        description="Pulley ratio (1.0 for 1:1, 0.5 for 2:1).",
    )
    default_bar_weight_kg: float = Field(
        default=20.0,
        ge=0.0,
        description="Standard barbell tare weight in kg.",
    )
    is_custom: bool = Field(
        default=False,
        description="True if user-created custom exercise.",
    )
    parent_exercise_id: Optional[str] = Field(
        default=None,
        description="Foreign key referencing parent exercise in variant tree.",
    )
    standard_lift_type: Optional[StandardLiftType] = Field(
        default=None,
        description="Powerlifting standard category for SBD benchmarking.",
    )
    default_rest_seconds: int = Field(
        default=120,
        ge=0,
        description="Default rest timer duration in seconds.",
    )
    secondary_muscles: Optional[List[str]] = Field(
        default=None,
        description="Assisting / synergist muscle groups receiving 0.5 set volume credit.",
    )
    axial_loading: Optional[AxialLoading] = Field(
        default="none",
        description="Spinal compressive loading classification.",
    )
    rom_tier: Optional[RomTier] = Field(
        default="standard_full",
        description="Range of motion excursion tier.",
    )
    muscle_biases: Optional[List[str]] = Field(
        default=None,
        description="Regional bodybuilding sub-target biases.",
    )
    primary_joints: Optional[List[str]] = Field(
        default=None,
        description="Primary mechanically loaded joints.",
    )
    secondary_joints: Optional[List[str]] = Field(
        default=None,
        description="Secondary assisting loaded joints.",
    )
    baseline_sfr: Optional[float] = Field(
        default=50.0,
        ge=0.0,
        le=100.0,
        description="Baseline Stimulus-to-Fatigue score (0-100).",
    )
    required_gear: Optional[List[str]] = Field(
        default=None,
        description="Required equipment tags.",
    )
    exercise_tier: Optional[int] = Field(
        default=2,
        ge=1,
        le=3,
        description="Differentiated progression tier (1 = Anchor, 2 = Variant, 3 = Isolation).",
    )


class GearInventory(StrictSchemaModel):
    """Equipment inventory item (specialty barbell or custom cable stack)."""

    id: str = Field(description="Unique identifier for the gear item.")
    name: str = Field(description="Name of the gear item.")
    type: GearType = Field(description="Equipment category.")
    tare_weight_kg: float = Field(
        default=20.0,
        ge=0.0,
        description="Unloaded tare weight in kg.",
    )
    cable_ratio: float = Field(
        default=1.0,
        ge=0.1,
        le=10.0,
        description="Mechanical pulley ratio.",
    )
    is_default: bool = Field(
        default=False,
        description="True if default for its equipment category.",
    )
    notes: Optional[str] = Field(
        default=None,
        description="Optional equipment notes.",
    )


class BodyMetric(StrictSchemaModel):
    """Longitudinal anthropometric and body composition entry."""

    id: str = Field(description="Unique identifier for the measurement log.")
    date: str = Field(
        pattern=DATE_REGEX,
        description="Measurement date (YYYY-MM-DD).",
    )
    bodyweight: Optional[float] = Field(
        default=None,
        ge=20.0,
        le=500.0,
        description="Bodyweight in kilograms, or None if unmeasured.",
    )

    @field_validator("bodyweight", mode="before")
    @classmethod
    def coerce_unrecorded_bodyweight(cls, v: Any) -> Any:
        """Coerce 0, non-positive numbers, or empty sentinels to None."""
        if v is None:
            return None
        try:
            val = float(v)
            if val <= 0.0:
                return None
        except (ValueError, TypeError):
            pass
        return v
    body_fat_manual: Optional[float] = Field(
        default=None,
        ge=2.0,
        le=70.0,
        description="Manually entered body fat percentage.",
    )
    waist_cm: Optional[float] = Field(
        default=None,
        ge=30.0,
        le=250.0,
        description="Waist circumference in cm.",
    )
    neck_cm: Optional[float] = Field(
        default=None,
        ge=15.0,
        le=100.0,
        description="Neck circumference in cm.",
    )
    hip_cm: Optional[float] = Field(
        default=None,
        ge=30.0,
        le=250.0,
        description="Hip circumference in cm.",
    )
    bicep_cm: Optional[float] = Field(
        default=None,
        ge=10.0,
        le=100.0,
        description="Bicep circumference in cm.",
    )
    chest_cm: Optional[float] = Field(
        default=None,
        ge=40.0,
        le=250.0,
        description="Chest circumference in cm.",
    )
    thigh_cm: Optional[float] = Field(
        default=None,
        ge=20.0,
        le=150.0,
        description="Thigh circumference in cm.",
    )
    calf_cm: Optional[float] = Field(
        default=None,
        ge=15.0,
        le=100.0,
        description="Calf circumference in cm.",
    )
    navy_body_fat: Optional[float] = Field(
        default=None,
        ge=2.0,
        le=70.0,
        description="Calculated U.S. Navy formula body fat percentage.",
    )
    imported_from: Optional[str] = Field(
        default=None,
        description="Provenance identifier if imported from external app.",
    )


class UserProfile(StrictSchemaModel):
    """User physiological demographics and training psychology matrix."""

    id: str = Field(description="Unique identifier for the user profile.")
    gender: Gender = Field(description="Biological sex.")
    birthdate: Optional[str] = Field(
        default=None,
        pattern=DATE_REGEX,
        description="Date of birth (YYYY-MM-DD).",
    )
    height_cm: Optional[float] = Field(
        default=None,
        ge=80.0,
        le=260.0,
        description="Height in centimeters.",
    )
    training_mentality: TrainingMentality = Field(
        default="precision",
        description="Athlete training mentality and volume/intensity profile.",
    )
    primary_goal: PrimaryGoal = Field(
        default="hypertrophy",
        description="Primary training objective.",
    )
    secondary_goals: Optional[List[str]] = Field(
        default=None,
        description="Secondary training goals.",
    )
    preferred_days_per_week: int = Field(
        default=4,
        ge=1,
        le=7,
        description="Preferred training days per week.",
    )
    preferred_session_duration_mins: int = Field(
        default=60,
        ge=15,
        le=240,
        description="Preferred workout duration in minutes.",
    )
    equipment_access: EquipmentAccess = Field(
        default="commercial_gym",
        description="Gym equipment environment access level.",
    )
    experience_level: Optional[ExperienceLevel] = Field(
        default="intermediate",
        description="Athlete resistance training experience tier.",
    )
    pending_meso_mood: Optional[bool] = Field(
        default=False,
        description="Whether mid-flight mood changes are staged for deferred Meso N+1 evolution.",
    )
    has_axial_fatigue_sensitivity: Optional[bool] = Field(
        default=False,
        description="Whether athlete is sensitive to spinal compressive / axial loading fatigue.",
    )
    is_caloric_deficit: Optional[bool] = Field(
        default=False,
        description="Whether athlete is currently training in a caloric deficit / cutting phase.",
    )
    created_at: str = Field(description="ISO 8601 creation timestamp.")
    updated_at: str = Field(description="ISO 8601 last update timestamp.")


class CalibratedParam(StrictSchemaModel):
    """Calibrated 1RM and endurance parameter record stored in mobile SQLite."""

    id: str = Field(description="Unique identifier for calibrated parameter record.")
    exercise_id: str = Field(
        description="Foreign key referencing exercises.id in mobile SQLite.",
    )
    calibrated_1rm: float = Field(
        gt=0.0,
        description="Estimated true 1-Repetition Maximum strength in kg (exp(x_0)).",
    )
    calibrated_k: float = Field(
        ge=0.03,
        le=0.20,
        description="Individualized endurance fatigue exponent (k).",
    )
    cov_p00: float = Field(
        description="Posterior error covariance element P[0,0] for ln(1RM).",
    )
    cov_p11: float = Field(
        description="Posterior error covariance element P[1,1] for k uncertainty.",
    )
    calibrated_at: str = Field(
        description="ISO 8601 UTC timestamp when calibration was computed.",
    )
    calibrated_10rm: Optional[float] = Field(
        default=None,
        gt=0.0,
        description="Projected 10-Repetition Maximum strength in kg.",
    )
    sfr_score: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=100.0,
        description="0-100 normalized Stimulus-to-Fatigue Ratio score.",
    )
    sfr_tier: Optional[Literal["OPTIMAL", "MODERATE", "POOR_SWAP_RECOMMENDED"]] = Field(
        default=None,
        description="SFR tier classification.",
    )
    recommended_swap_exercise_id: Optional[str] = Field(
        default=None,
        description="Suggested replacement exercise ID from parent_exercise_id variant hierarchy.",
    )
    optimal_rest_seconds: Optional[int] = Field(
        default=None,
        ge=0,
        description="Recommended inter-set rest timer in seconds.",
    )
    asymmetry_ratio: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Mean fractional unilateral limb repetition asymmetry ratio.",
    )


class PainReport(StrictSchemaModel):
    """In-gym or post-workout pain and discomfort report."""

    id: str = Field(description="Unique identifier for the pain report.")
    workout_id: str = Field(description="Foreign key referencing workouts.id.")
    exercise_id: str = Field(description="Foreign key referencing exercises.id.")
    set_id: Optional[str] = Field(
        default=None,
        description="Optional foreign key referencing workout_sets.id where discomfort occurred.",
    )
    pain_type: PainType = Field(
        description="Clinical category: joint (articular/tendon) vs muscle (belly strain).",
    )
    severity: int = Field(
        ge=1,
        le=10,
        description="Self-reported pain intensity on 1-10 numerical scale.",
    )
    joint_location: Optional[JointLocation] = Field(
        default=None,
        description="Optional anatomical location selected for a joint pain report.",
    )
    notes: Optional[str] = Field(
        default=None,
        description="Optional notes describing symptoms or sensations.",
    )
    created_at: str = Field(
        description="ISO 8601 UTC timestamp recording when pain was reported.",
    )


class ExercisePreference(StrictSchemaModel):
    """Exercise sentiment, soft affinity, and pain correlation record."""

    exercise_id: str = Field(description="Foreign key referencing exercises.id.")
    sentiment: ExerciseSentiment = Field(
        default="neutral",
        description="Explicit user sentiment towards the exercise.",
    )
    swap_in_count: int = Field(
        default=0,
        ge=0,
        description="Count of times this exercise was chosen as a substitute.",
    )
    swap_out_count: int = Field(
        default=0,
        ge=0,
        description="Count of times this exercise was swapped out.",
    )
    affinity_score: float = Field(
        default=0.0,
        description="Computed soft affinity score (-999.0 to +25.0).",
    )
    last_pain_reported_at: Optional[str] = Field(
        default=None,
        description="ISO 8601 timestamp of the last pain report.",
    )
    max_pain_severity: Optional[int] = Field(
        default=None,
        ge=1,
        le=10,
        description="Maximum pain severity (1-10) reported.",
    )
    pain_joint: Optional[str] = Field(
        default=None,
        description="Joint location where pain was reported.",
    )
    updated_at: str = Field(
        description="ISO 8601 timestamp of last preference update.",
    )


class WorkoutExportPayload(StrictSchemaModel):
    """Complete Workout Suite relational export payload."""

    version: str = Field(
        pattern=SEMVER_REGEX,
        description="Semantic version of export schema (e.g., 1.0.0).",
    )
    exported_at: str = Field(description="ISO 8601 UTC export timestamp.")
    programs: List[Program] = Field(default_factory=list)
    program_blocks: List[ProgramBlock] = Field(default_factory=list)
    workout_templates: List[WorkoutTemplate] = Field(default_factory=list)
    template_exercises: List[TemplateExercise] = Field(default_factory=list)
    progression_rules: List[ProgressionRule] = Field(default_factory=list)
    workouts: List[Workout] = Field(default_factory=list)
    workout_sets: List[WorkoutSet] = Field(default_factory=list)
    exercises: List[Exercise] = Field(default_factory=list)
    gear_inventory: List[GearInventory] = Field(default_factory=list)
    body_metrics: List[BodyMetric] = Field(default_factory=list)
    user_settings: Dict[str, str] = Field(default_factory=dict)
    user_profiles: List[UserProfile] = Field(default_factory=list)
    calibrated_params: List[CalibratedParam] = Field(default_factory=list)
    pain_reports: List[PainReport] = Field(default_factory=list)
    exercise_preferences: List[ExercisePreference] = Field(default_factory=list)


# ============================================================================
# Calibrated Parameters Schema Models (schemas/calibrated_parameters.schema.json)
# ============================================================================

class CalibratedParameter(StrictSchemaModel):
    """Estimated true 1RM and endurance exponent (k) from Tier 2 Kalman Filter."""

    exercise_id: str = Field(
        description="Foreign key referencing exercises.id in mobile SQLite.",
    )
    calibrated_1rm: float = Field(
        gt=0.0,
        description="Estimated true 1-Repetition Maximum strength in kg (exp(x_0)).",
    )
    calibrated_k: float = Field(
        ge=0.03,
        le=0.20,
        description="Individualized endurance fatigue exponent (k).",
    )
    cov_p00: float = Field(
        description="Posterior error covariance element P[0,0] for ln(1RM).",
    )
    cov_p11: float = Field(
        description="Posterior error covariance element P[1,1] for k uncertainty.",
    )
    calibrated_at: str = Field(
        description="ISO 8601 UTC timestamp when calibration was computed.",
    )
    calibrated_10rm: Optional[float] = Field(
        default=None,
        gt=0.0,
        description="Projected 10-Repetition Maximum strength in kg.",
    )
    sfr_score: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=100.0,
        description="0-100 normalized Stimulus-to-Fatigue Ratio score.",
    )
    sfr_tier: Optional[Literal["OPTIMAL", "MODERATE", "POOR_SWAP_RECOMMENDED"]] = Field(
        default=None,
        description="SFR tier classification.",
    )
    recommended_swap_exercise_id: Optional[str] = Field(
        default=None,
        description="Suggested replacement exercise ID from parent_exercise_id variant hierarchy.",
    )
    optimal_rest_seconds: Optional[int] = Field(
        default=None,
        ge=0,
        description="Recommended inter-set rest timer in seconds.",
    )
    asymmetry_ratio: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Mean fractional unilateral limb repetition asymmetry ratio.",
    )


class MuscleLandmarkPayload(StrictSchemaModel):
    """Localized volume landmarks and readiness percentage per muscle group."""

    mev: float = Field(ge=0.0, description="Minimum Effective Volume in sets/week.")
    mav: float = Field(ge=0.0, description="Maximum Adaptive Volume in sets/week.")
    mrv: float = Field(ge=0.0, description="Maximum Recoverable Volume in sets/week.")
    readiness_pct: float = Field(
        ge=0.0,
        le=100.0,
        description="Current localized muscle readiness percentage (0-100).",
    )


class ProgramAuditPayload(StrictSchemaModel):
    """Program parameter audit advisory payload."""

    rule_code: str = Field(
        description="Program parameter audit code (e.g. REST_TOO_SHORT, JUNK_VOLUME, AXIAL_BOTTLENECK, REP_MONOTONY).",
    )
    target_id: str = Field(description="Target identifier: exercise ID, muscle group name, or 'systemic'.")
    message: str = Field(description="Actionable explanation of why this audit rule fired.")
    suggested_parameter: str = Field(description="Name of parameter suggested for adjustment.")
    suggested_value: Optional[Union[float, int, str, bool]] = Field(
        default=None,
        description="Suggested parameter value.",
    )


class CalibratedParametersEnvelope(StrictSchemaModel):
    """Envelope wrapper for calibrated parameter export file."""

    version: str = Field(
        pattern=SEMVER_REGEX,
        description="Semantic version of calibrated parameters schema.",
    )
    exported_at: str = Field(
        description="ISO 8601 UTC calibration export timestamp.",
    )
    parameters: List[CalibratedParameter] = Field(
        description="List of calibrated exercise parameters.",
    )
    muscle_landmarks: Optional[Dict[str, MuscleLandmarkPayload]] = Field(
        default=None,
        description="Individualized volume landmarks and localized readiness per muscle group.",
    )
    program_audits: Optional[List[ProgramAuditPayload]] = Field(
        default=None,
        description="Deterministic program parameter audit advisories.",
    )


CalibratedParametersPayload = CalibratedParametersEnvelope

