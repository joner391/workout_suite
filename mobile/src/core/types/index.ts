/**
 * Workout Suite — Core Domain Types and Entity Interfaces
 *
 * Synchronized with:
 * - SQLite DDL in IMPLEMENTATION_PLAN.md Section 2
 * - JSON Schema Contract in schemas/workout_export.schema.json
 * - Companion Pydantic models in companion/src/ingestion/schemas.py
 */

// ============================================================================
// Enums & Primitive Value Unions
// ============================================================================

export type WeightUnit = 'kg' | 'lbs';
export type IntensityMetric = 'RPE' | 'RIR';

export type LoadMode = 'total' | 'per_hand';

export type ExerciseCategory =
  | 'Barbell'
  | 'Dumbbell'
  | 'Cable'
  | 'Bodyweight'
  | 'Machine'
  | 'Other';

export type MuscleGroup =
  | 'Chest'
  | 'Back'
  | 'Quads'
  | 'Hamstrings'
  | 'Glutes'
  | 'Shoulders'
  | 'Biceps'
  | 'Triceps'
  | 'Forearms'
  | 'Calves'
  | 'Abs'
  | 'Traps';

export type StandardLiftType = 'squat' | 'bench' | 'deadlift' | 'ohp' | 'row';

export type GearType =
  | 'barbell'
  | 'cable_machine'
  | 'plate_loaded_machine'
  | 'specialty_bar'
  | 'accessory';

export type WorkoutStatus = 'in_progress' | 'completed' | 'discarded';

export type SetType = 'warmup' | 'working' | 'drop' | 'myorep' | 'failure';

export type ImportSource = 'strong' | 'hevy' | 'csv' | 'fitnotes';

export type Gender = 'male' | 'female';

export type TrainingEnjoyment = 'enthusiast' | 'neutral' | 'minimalist';

export type IntensityStyle =
  | 'high_intensity_low_volume'
  | 'volume_accumulation'
  | 'balanced';

export type PrimaryGoal =
  | 'strength'
  | 'hypertrophy'
  | 'powerbuilding'
  | 'endurance'
  | 'longevity';

export type EquipmentAccess =
  | 'commercial_gym'
  | 'garage_gym'
  | 'dumbbells_only'
  | 'bodyweight_only';

export type StrengthStandardTier =
  | 'untrained'
  | 'novice'
  | 'intermediate'
  | 'advanced'
  | 'elite';

// ============================================================================
// Relational SQLite Domain Entities
// ============================================================================

/**
 * Exercise entity representing catalog library items and custom user movements.
 */
export interface Exercise {
  id: string;
  name: string;
  muscle_group: MuscleGroup | string;
  category: ExerciseCategory;
  is_compound: boolean;
  is_bodyweight: boolean;
  is_unilateral: boolean;
  load_mode: LoadMode;
  default_cable_ratio: number;
  default_bar_weight_kg: number;
  is_custom: boolean;
  parent_exercise_id: string | null;
  standard_lift_type: StandardLiftType | null;
  default_rest_seconds: number;
}

/**
 * Equipment & Gear Inventory (specialty bars, custom cable pulley stacks).
 */
export interface GearInventory {
  id: string;
  name: string;
  type: GearType;
  tare_weight_kg: number;
  cable_ratio: number;
  is_default: boolean;
  notes: string | null;
}

/**
 * Training program meso-cycle split (e.g. Upper/Lower, PPL).
 */
export interface Program {
  id: string;
  name: string;
  color_hex: string;
  notes: string | null;
  created_at: string;
}

/**
 * Active program meso-cycle interval tracking active program eras.
 */
export interface ProgramBlock {
  id: string;
  program_id: string;
  start_date: string; // ISO8601 YYYY-MM-DD
  end_date: string | null; // NULL if currently active
}

/**
 * Workout template / routine within a training program.
 */
export interface WorkoutTemplate {
  id: string;
  program_id: string | null;
  name: string;
  notes: string | null;
  order_index: number;
  created_at: string;
}

/**
 * Prescribed exercise slot within a workout template.
 */
export interface TemplateExercise {
  id: string;
  template_id: string;
  exercise_id: string;
  gear_id: string | null;
  target_sets: number | null;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_rpe: number | null;
  target_rir: number | null;
  order_index: number;
  exercise_group_id: string | null;
}

/**
 * Declarative progression rule attached to a template exercise.
 */
export interface ProgressionRule {
  id: string;
  template_exercise_id: string;
  priority: number;
  rule_json: string | ProgressionRuleDefinition;
}

/**
 * Completed or in-progress workout session.
 */
export interface Workout {
  id: string;
  template_id: string | null;
  date: string; // ISO8601 YYYY-MM-DD
  name: string;
  notes: string | null;
  started_at: string;
  duration_seconds: number | null;
  status: WorkoutStatus;
  completed_at: string | null;
  imported_from: ImportSource | string | null;
}

/**
 * Filter criteria for querying workout sessions.
 */
export interface WorkoutFilter {
  status?: WorkoutStatus;
  startDate?: string; // ISO8601 YYYY-MM-DD
  endDate?: string; // ISO8601 YYYY-MM-DD
  templateId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Composite entity linking a workout session with all its associated sets.
 */
export interface WorkoutWithSets {
  workout: Workout;
  sets: WorkoutSet[];
}


/**
 * Logged exercise set (implements ADR-026 dual-weight persistence).
 */
export interface WorkoutSet {
  id: string;
  workout_id: string;
  exercise_id: string;
  gear_id: string | null;
  set_number: number;
  weight: number; // Canonical effective mechanical load in kg
  raw_input_weight: number; // Exact user typed load prior to multiplier/ratio
  added_weight: number | null; // Delta in kg (+10 belt, -15 assist)
  reps: number;
  reps_right: number | null; // Unilateral right limb reps (NULL if bilateral)
  rpe: number | null; // 5.0 - 10.0
  rir: number | null; // 0.0 - 5.0
  set_type: SetType;
  set_notes: string | null;
  exercise_group_id: string | null;
  created_at: string;
}

/**
 * Longitudinal body composition & anthropometry measurement.
 */
export interface BodyMetric {
  id: string;
  date: string; // ISO8601 YYYY-MM-DD
  bodyweight: number; // Canonical kg
  body_fat_manual: number | null;
  waist_cm: number | null;
  neck_cm: number | null;
  hip_cm: number | null;
  bicep_cm: number | null;
  chest_cm: number | null;
  thigh_cm: number | null;
  calf_cm: number | null;
  navy_body_fat: number | null;
}

/**
 * Calibrated 1RM and fatigue endurance exponent (k) from Companion Kalman engine.
 */
export interface CalibratedParam {
  id: string;
  exercise_id: string;
  calibrated_1rm: number;
  calibrated_k: number;
  calibrated_at: string;
}

/**
 * System and user settings key-value entries.
 */
export interface UserSettings {
  [key: string]: string;
}

/**
 * Athlete psychological profile and goal matrix.
 */
export interface UserProfile {
  id: string;
  gender: Gender;
  birthdate: string | null;
  height_cm: number | null;
  training_enjoyment: TrainingEnjoyment;
  intensity_style: IntensityStyle;
  primary_goal: PrimaryGoal;
  secondary_goals: string[] | null;
  preferred_days_per_week: number;
  preferred_session_duration_mins: number;
  equipment_access: EquipmentAccess;
  created_at: string;
  updated_at: string;
}

/**
 * SBD Strength standard benchmarks.
 */
export interface StrengthStandard {
  id: string;
  lift_type: StandardLiftType;
  gender: Gender;
  bodyweight_kg: number;
  untrained_1rm: number;
  novice_1rm: number;
  intermediate_1rm: number;
  advanced_1rm: number;
  elite_1rm: number;
}

// ============================================================================
// Progression Engine Condition-Action Schema Types
// ============================================================================

export type ProgressionConditionType =
  | 'ALL_SETS_HIT_TARGET_REPS'
  | 'AVERAGE_RPE_LESS_THAN'
  | 'CONSECUTIVE_SUCCESSFUL_SESSIONS'
  | 'MISSED_REPS_COUNT'
  | 'TOP_SET_RIR_GREATER_THAN';

export type ProgressionActionType =
  | 'INCREASE_LOAD_FIXED'
  | 'INCREASE_LOAD_PERCENT'
  | 'INCREASE_TARGET_REPS'
  | 'TRIGGER_DELOAD'
  | 'RESET_WEIGHT_PERCENT';

export interface ProgressionCondition {
  type: ProgressionConditionType;
  threshold?: number;
  comparison?: 'lt' | 'lte' | 'eq' | 'gte' | 'gt';
}

export interface ProgressionAction {
  type: ProgressionActionType;
  value: number; // e.g. 2.5 kg or 0.05 (5%)
}

export interface ProgressionRuleDefinition {
  conditions: ProgressionCondition[];
  actions: ProgressionAction[];
  notes?: string;
}

// ============================================================================
// Pure Domain Math & Calculation Helper Contracts
// ============================================================================

export interface NormalizedLoadResult {
  effectiveWeightKg: number;
  rawInputWeightKg: number;
  addedWeightKg: number | null;
}

export interface PlateCalculationResult {
  targetWeightKg: number;
  barTareKg: number;
  weightPerSideKg: number;
  platesPerSide: number[];
  remainderKg: number;
}

export interface RepMaxRecord {
  reps: number;
  weightKg: number;
  effectiveReps: number;
  e1rmKg: number;
  setDate: string;
}

export interface DotsResult {
  score: number;
  totalKg: number;
  bodyweightKg: number;
  gender: Gender;
}

export interface StrengthStandardResult {
  liftType: StandardLiftType;
  e1rmKg: number;
  bodyweightKg: number;
  tier: StrengthStandardTier;
  continuousScore: number; // 0.0 - 100.0+
  deltaKgToNextTier: number | null;
}
