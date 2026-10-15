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

export type SetType = 'warmup' | 'working' | 'drop' | 'myorep' | 'dc';

export type ImportSource =
  | 'strong'
  | 'hevy'
  | 'csv'
  | 'fitnotes'
  | 'strengthlog'
  | 'liftosaur';

export type Gender = 'male' | 'female';

export type TrainingMentality = 'fury' | 'precision' | 'get_out';

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
  secondary_muscles?: (MuscleGroup | string)[];
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
  imported_from?: string | null;
}

/**
 * Calibrated 1RM and fatigue endurance exponent (k) from Companion Kalman engine.
 */
export interface CalibratedParam {
  id: string;
  exercise_id: string;
  calibrated_1rm: number;
  calibrated_k: number;
  cov_p00: number;
  cov_p11: number;
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
  training_mentality: TrainingMentality;
  training_enjoyment?: TrainingEnjoyment;
  intensity_style?: IntensityStyle;
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
  | 'ANY_SET_HIT_TOP_REP_RANGE'
  | 'AVERAGE_RPE_LESS_THAN'
  | 'CONSECUTIVE_SUCCESSFUL_SESSIONS'
  | 'CONSECUTIVE_FAILED_SESSIONS'
  | 'MISSED_REPS_COUNT'
  | 'TOP_SET_RIR_GREATER_THAN';

export type ProgressionActionType =
  | 'INCREASE_LOAD_FIXED'
  | 'INCREASE_LOAD_PERCENT'
  | 'DECREASE_LOAD_FIXED'
  | 'INCREASE_TARGET_REPS'
  | 'ADD_WORKING_SET'
  | 'RESET_TO_BASELINE'
  | 'TRIGGER_DELOAD'
  | 'RESET_WEIGHT_PERCENT';

export interface ProgressionCondition {
  type: ProgressionConditionType;
  threshold?: number;
  comparison?: 'lt' | 'lte' | 'eq' | 'gte' | 'gt';
}

export interface ProgressionAction {
  type: ProgressionActionType;
  value: number; // e.g. 2.5 kg, 0.05 (5%), or rep/set delta
}

export interface ProgressionRuleDefinition {
  conditions: ProgressionCondition[];
  actions: ProgressionAction[];
  notes?: string;
}

export interface WorkoutSession {
  workoutId?: string;
  date?: string;
  workout?: Workout;
  sets: WorkoutSet[];
}

export interface SetProgressionProposal {
  setIndex: number; // 1-based index matching set_number
  currentWeightKg: number;
  suggestedWeightKg: number;
  currentReps: number;
  targetHit: boolean;
  status: 'increase' | 'maintain' | 'decrease';
  explanation: string;
}

export interface ProgressionProposal {
  ruleId: string;
  rulePriority: number;
  ruleNotes?: string;
  actionType: ProgressionActionType;
  actionValue?: number;
  explanation: string;
  currentWeightKg?: number;
  suggestedWeightKg?: number;
  suggestedTargetReps?: number;
  suggestedTargetSets?: number;
  isDeload?: boolean;
  setProposals?: SetProgressionProposal[];
}

export interface ProgressionEvaluationResult {
  hasMatches: boolean;
  primaryProposal: ProgressionProposal | null;
  matchedProposals: ProgressionProposal[];
  evaluatedRulesCount: number;
  recentSessionsEvaluated: number;
}

export interface SynthesizedProgramSummary {
  splitType: 'full_body' | 'upper_lower' | 'pplul' | 'ppl';
  daysPerWeek: number;
  estimatedSessionDurationMins: number;
  totalWeeklySets: number;
  hasSupersets: boolean;
  progressionSchemeSummary: string;
}

export interface SynthesizedProgram {
  program: Program;
  templates: WorkoutTemplate[];
  templateExercises: TemplateExercise[];
  progressionRules: ProgressionRule[];
  summary: SynthesizedProgramSummary;
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
  setDate: string; // ISO8601 YYYY-MM-DD
  workoutId?: string;
  setId?: string;
  rpe?: number | null;
  rir?: number | null;
  rawInputWeight?: number;
  exerciseId?: string;
  isEnveloped?: boolean;
  derivedFromReps?: number;
  originalWeightKg?: number;
  originalSetDate?: string;
  originalWorkoutId?: string;
  originalSetId?: string;
}

export interface RepMaxQueryOptions {
  exerciseIds: string[];
  startDate?: string;
  endDate?: string;
}

export interface RawRepMaxRow {
  setId: string;
  workoutId: string;
  exerciseId: string;
  reps: number;
  weight: number;
  rawInputWeight: number;
  rpe: number | null;
  rir: number | null;
  workoutDate: string;
}

export interface PRBoardOptions {
  exerciseId: string;
  scope?: 'all_time' | 'program_block';
  startDate?: string;
  endDate?: string;
  includeVariants?: boolean;
}

export interface PRBoardResult {
  exerciseId: string;
  records: RepMaxRecord[]; // Ordered by reps ASC: 1RM, 2RM, 3RM, etc.
  peakRecord: RepMaxRecord | null; // Set that yielded the highest overall e1RM
  allTimeBest1RM: RepMaxRecord | null; // True 1RM set (reps === 1) if present
  totalPRCount: number;
}

export interface StrengthStandardSummaryResult {
  isStandardLift: boolean;
  liftType?: StandardLiftType;
  standardResult?: StrengthStandardResult;
}

export interface ExerciseInspectionOverview {
  exercise: Exercise;
  prBoard: PRBoardResult;
  standardSummary: StrengthStandardSummaryResult;
  historySummary: {
    totalSessions: number;
    totalSets: number;
    totalVolumeKg: number;
    firstLoggedDate: string | null;
    lastLoggedDate: string | null;
  };
}

export interface DotsResult {
  score: number;
  totalKg: number;
  bodyweightKg: number;
  gender: Gender;
}

export interface InterpolatedStandards {
  untrained: number;
  novice: number;
  intermediate: number;
  advanced: number;
  elite: number;
}

export interface StrengthStandardResult {
  liftType: StandardLiftType;
  e1rmKg: number;
  bodyweightKg: number;
  tier: StrengthStandardTier;
  continuousScore: number; // 0.0 - 100.0+
  deltaKgToNextTier: number | null; // null if elite
  nextTierName: StrengthStandardTier | null; // null if elite
  kgNeededForNextTier: number; // 0 if elite
  demographicPercentile: number; // 0.1 - 99.9%
}

export interface SBDBalanceProfile {
  squatScore: number;
  benchScore: number;
  deadliftScore: number;
  totalScore: number;
  averageScore: number;
  totalKg: number;
  dotsScore: number;
  dominantLift: 'squat' | 'bench' | 'deadlift' | 'balanced';
  laggingLift: 'squat' | 'bench' | 'deadlift' | 'none';
  radarCoordinates: {
    squat: number; // 0 - 100 normalized
    bench: number; // 0 - 100 normalized
    deadlift: number; // 0 - 100 normalized
  };
}

// ============================================================================
// Standardized JSON Export Contract Models
// ============================================================================

/**
 * Complete Workout Suite relational data export payload.
 * Canonical contract synchronized with schemas/workout_export.schema.json
 * and companion/src/ingestion/schemas.py.
 */
export interface WorkoutExportPayload {
  version: string;
  exported_at: string;
  programs: Program[];
  program_blocks: ProgramBlock[];
  workout_templates: WorkoutTemplate[];
  template_exercises: TemplateExercise[];
  progression_rules: ProgressionRule[];
  workouts: Workout[];
  workout_sets: WorkoutSet[];
  exercises: Exercise[];
  gear_inventory: GearInventory[];
  body_metrics: BodyMetric[];
  user_settings: Record<string, string>;
  user_profiles: UserProfile[];
  calibrated_params: CalibratedParam[];
}

