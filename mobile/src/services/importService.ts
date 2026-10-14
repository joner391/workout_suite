/**
 * Workout Suite — External Data Import Application Service
 *
 * Implements Step 2.4:
 * - Exercise name matching against the existing catalog
 * - Automatic custom exercise fallback creation
 * - Duplicate session detection (matching date + exercise + set count)
 * - `imported_from` provenance tagging ('strong' | 'hevy' | 'csv')
 * - ADR-008 & ADR-026 dual-load persistence (canonical kilograms)
 */

import {
  Exercise,
  ImportSource,
  Workout,
  WorkoutSet,
  SetType,
  ExerciseCategory,
  MuscleGroup,
} from '../core/types';
import { IWorkoutRepository } from '../domain/repositories/IWorkoutRepository';
import { IExerciseRepository } from '../domain/repositories/IExerciseRepository';
import {
  ParsedCsvWorkout,
  CsvParseResult,
  parseWorkoutCsv,
  CsvColumnMapping,
} from '../core/parsers/csvImportParser';

// ============================================================================
// Service Contracts
// ============================================================================

export type ExerciseMatchType = 'exact' | 'alias' | 'fuzzy' | 'custom_fallback';

export interface ExerciseMatchResult {
  rawName: string;
  matchedExercise: Exercise | null;
  matchType: ExerciseMatchType;
  confidence: number; // 0.0 - 1.0
  proposedExercise: Exercise;
}

export interface WorkoutDuplicateCheck {
  workout: ParsedCsvWorkout;
  isDuplicate: boolean;
  duplicateOfWorkoutId?: string;
  duplicateReason?: string;
}

export interface WorkoutImportPreview {
  source: ImportSource;
  totalWorkouts: number;
  totalSets: number;
  duplicateWorkoutsCount: number;
  workouts: WorkoutDuplicateCheck[];
  exerciseMatches: ExerciseMatchResult[];
}

export interface ImportOptions {
  skipDuplicates?: boolean; // default: true
  exerciseOverrides?: Record<string, string>; // rawName -> exerciseId chosen by user
}

export interface ImportExecutionResult {
  success: boolean;
  importedWorkoutsCount: number;
  importedSetsCount: number;
  skippedDuplicatesCount: number;
  createdExercisesCount: number;
  workoutIds: string[];
  errors: string[];
}

// ============================================================================
// Standard Catalog Synonyms / Aliases Map
// ============================================================================

/**
 * Common names exported by Strong, Hevy, FitNotes, and community trackers
 * mapped to standard defaultExercise IDs.
 */
const COMMON_EXERCISE_ALIASES: Record<string, string> = {
  // Barbell Squat variants
  'bench press (barbell)': 'barbell_bench_press',
  'flat barbell bench press': 'barbell_bench_press',
  'barbell flat bench press': 'barbell_bench_press',
  'squat (barbell)': 'barbell_back_squat',
  'barbell squat': 'barbell_back_squat',
  'back squat (barbell)': 'barbell_back_squat',
  'back squat': 'barbell_back_squat',
  'front squat (barbell)': 'barbell_front_squat',
  'box squat (barbell)': 'barbell_box_squat',
  'low bar squat (barbell)': 'barbell_low_bar_squat',

  // Barbell Deadlift variants
  'deadlift (barbell)': 'barbell_deadlift',
  'barbell deadlift': 'barbell_deadlift',
  'sumo deadlift (barbell)': 'barbell_sumo_deadlift',
  'romanian deadlift (barbell)': 'barbell_rdl',
  'romanian deadlift (rdl)': 'barbell_rdl',
  'deficit deadlift (barbell)': 'barbell_deficit_deadlift',

  // Overhead & Rows
  'overhead press (barbell)': 'barbell_overhead_press',
  'standing overhead press': 'barbell_overhead_press',
  'military press (barbell)': 'barbell_overhead_press',
  'military press': 'barbell_overhead_press',
  'ohp': 'barbell_overhead_press',
  'push press (barbell)': 'barbell_push_press',
  'bent over row (barbell)': 'barbell_bent_over_row',
  'barbell row': 'barbell_bent_over_row',
  'pendlay row (barbell)': 'barbell_pendlay_row',
  'pendlay row': 'barbell_pendlay_row',
  'hip thrust (barbell)': 'barbell_hip_thrust',
  'good morning (barbell)': 'barbell_good_morning',
  'bicep curl (barbell)': 'barbell_bicep_curl',
  'skull crusher (barbell)': 'barbell_skull_crusher',
  'close grip bench press (barbell)': 'barbell_close_grip_bench_press',
  'incline bench press (barbell)': 'barbell_incline_bench_press',

  // Dumbbell movements
  'bench press (dumbbell)': 'dumbbell_bench_press',
  'dumbbell bench press': 'dumbbell_bench_press',
  'dumbbell press': 'dumbbell_bench_press',
  'incline bench press (dumbbell)': 'dumbbell_incline_bench_press',
  'incline dumbbell bench press': 'dumbbell_incline_bench_press',
  'incline dumbbell press': 'dumbbell_incline_bench_press',
  'shoulder press (dumbbell)': 'dumbbell_shoulder_press',
  'dumbbell shoulder press': 'dumbbell_shoulder_press',
  'dumbbell overhead press': 'dumbbell_shoulder_press',
  'lateral raise (dumbbell)': 'dumbbell_lateral_raise',
  'dumbbell lateral raise': 'dumbbell_lateral_raise',
  'side lateral raise': 'dumbbell_lateral_raise',
  'bicep curl (dumbbell)': 'dumbbell_bicep_curl',
  'dumbbell bicep curl': 'dumbbell_bicep_curl',
  'dumbbell curl': 'dumbbell_bicep_curl',
  'hammer curl (dumbbell)': 'dumbbell_hammer_curl',
  'dumbbell hammer curl': 'dumbbell_hammer_curl',
  'bulgarian split squat (dumbbell)': 'dumbbell_bulgarian_split_squat',
  'bulgarian split squat': 'dumbbell_bulgarian_split_squat',
  'walking lunge (dumbbell)': 'dumbbell_walking_lunge',
  'dumbbell walking lunge': 'dumbbell_walking_lunge',
  'single arm dumbbell row': 'dumbbell_single_arm_row',
  'one arm dumbbell row': 'dumbbell_single_arm_row',
  'dumbbell row': 'dumbbell_single_arm_row',
  'rear delt fly (dumbbell)': 'dumbbell_rear_delt_fly',

  // Cable movements
  'lat pulldown (cable)': 'cable_lat_pulldown',
  'lat pulldown': 'cable_lat_pulldown',
  'cable lat pulldown': 'cable_lat_pulldown',
  'seated cable row': 'cable_seated_row',
  'seated row (cable)': 'cable_seated_row',
  'cable row': 'cable_seated_row',
  'triceps pushdown (cable)': 'cable_tricep_pushdown',
  'tricep pushdown (cable)': 'cable_tricep_pushdown',
  'cable tricep pushdown': 'cable_tricep_pushdown',
  'cable triceps pushdown': 'cable_tricep_pushdown',
  'tricep pushdown': 'cable_tricep_pushdown',
  'bicep curl (cable)': 'cable_bicep_curl',
  'cable bicep curl': 'cable_bicep_curl',
  'cable curl': 'cable_bicep_curl',
  'cable lateral raise': 'cable_lateral_raise',
  'lateral raise (cable)': 'cable_lateral_raise',
  'face pull (cable)': 'cable_face_pull',
  'face pull': 'cable_face_pull',
  'cable face pull': 'cable_face_pull',
  'chest fly (cable)': 'cable_chest_fly',
  'cable fly': 'cable_chest_fly',
  'cable crossover': 'cable_chest_fly',

  // Machine movements
  'leg press': 'machine_leg_press',
  'leg press (machine)': 'machine_leg_press',
  'leg extension': 'machine_leg_extension',
  'leg extension (machine)': 'machine_leg_extension',
  'seated leg curl': 'machine_leg_curl',
  'leg curl (machine)': 'machine_leg_curl',
  'lying leg curl': 'machine_leg_curl',
  'standing calf raise': 'machine_standing_calf_raise',
  'calf raise (machine)': 'machine_standing_calf_raise',
  'chest press (machine)': 'machine_chest_press',
  'machine chest press': 'machine_chest_press',

  // Bodyweight movements
  'pull up': 'bodyweight_pull_up',
  'pull-up': 'bodyweight_pull_up',
  'pullups': 'bodyweight_pull_up',
  'pull up (bodyweight)': 'bodyweight_pull_up',
  'chin up': 'bodyweight_chin_up',
  'chin-up': 'bodyweight_chin_up',
  'chinups': 'bodyweight_chin_up',
  'chin up (bodyweight)': 'bodyweight_chin_up',
  'chest / triceps dip': 'bodyweight_dip',
  'dips': 'bodyweight_dip',
  'dip': 'bodyweight_dip',
  'dip (bodyweight)': 'bodyweight_dip',
  'push up': 'bodyweight_push_up',
  'push-up': 'bodyweight_push_up',
  'pushups': 'bodyweight_push_up',
  'push up (bodyweight)': 'bodyweight_push_up',
  'hanging knee raise': 'bodyweight_hanging_knee_raise',
  'hanging leg raise': 'bodyweight_hanging_knee_raise',
};

// ============================================================================
// ImportService Implementation
// ============================================================================

export class ImportService {
  constructor(
    private readonly workoutRepo: IWorkoutRepository,
    private readonly exerciseRepo: IExerciseRepository
  ) {}

  /**
   * Parses CSV string into structured intermediate representations.
   */
  parseCsv(
    csvText: string,
    formatHint?: ImportSource,
    columnMapping?: Partial<CsvColumnMapping>
  ): CsvParseResult {
    return parseWorkoutCsv(csvText, formatHint, columnMapping);
  }

  /**
   * Resolves an imported raw exercise name against the database catalog:
   * 1. Exact match (case-insensitive)
   * 2. Common synonyms / alias lookup table
   * 3. Structural inversion (e.g. "Bench Press (Barbell)" -> "Barbell Bench Press")
   * 4. Token similarity match
   * 5. Automatic custom exercise fallback creation
   */
  async matchExercise(
    rawName: string,
    catalog?: Exercise[]
  ): Promise<ExerciseMatchResult> {
    const trimmed = rawName.trim();
    const lower = trimmed.toLowerCase();
    const allExercises = catalog ?? (await this.exerciseRepo.findAll());

    // 1. Exact match
    const exactMatch = allExercises.find(
      (e) => e.name.trim().toLowerCase() === lower
    );
    if (exactMatch) {
      return {
        rawName: trimmed,
        matchedExercise: exactMatch,
        matchType: 'exact',
        confidence: 1.0,
        proposedExercise: exactMatch,
      };
    }

    // 2. Common alias table lookup
    const aliasTargetId = COMMON_EXERCISE_ALIASES[lower];
    if (aliasTargetId) {
      const aliasMatch = allExercises.find((e) => e.id === aliasTargetId);
      if (aliasMatch) {
        return {
          rawName: trimmed,
          matchedExercise: aliasMatch,
          matchType: 'alias',
          confidence: 0.95,
          proposedExercise: aliasMatch,
        };
      }
    }

    // 3. Structural inversion: e.g. "Bench Press (Barbell)" -> "Barbell Bench Press"
    const parenMatch = trimmed.match(/^(.+?)\s*\((Barbell|Dumbbell|Cable|Machine|Bodyweight)\)$/i);
    if (parenMatch) {
      const movement = parenMatch[1].trim();
      const category = parenMatch[2].trim();
      const inverted = `${category} ${movement}`.toLowerCase();

      const invertedMatch = allExercises.find(
        (e) => e.name.toLowerCase() === inverted
      );
      if (invertedMatch) {
        return {
          rawName: trimmed,
          matchedExercise: invertedMatch,
          matchType: 'alias',
          confidence: 0.9,
          proposedExercise: invertedMatch,
        };
      }
    }

    // 4. Token-based similarity search (find exercise sharing most significant tokens)
    const rawTokens = this.tokenize(lower);
    let bestMatch: Exercise | null = null;
    let bestScore = 0;

    for (const ex of allExercises) {
      const exTokens = this.tokenize(ex.name.toLowerCase());
      const intersection = rawTokens.filter((t) => exTokens.includes(t));
      const union = new Set([...rawTokens, ...exTokens]);
      const jaccard = union.size > 0 ? intersection.length / union.size : 0;

      if (jaccard > bestScore) {
        bestScore = jaccard;
        bestMatch = ex;
      }
    }

    if (bestMatch && bestScore >= 0.6) {
      return {
        rawName: trimmed,
        matchedExercise: bestMatch,
        matchType: 'fuzzy',
        confidence: Math.round(bestScore * 100) / 100,
        proposedExercise: bestMatch,
      };
    }

    // 5. Automatic custom exercise fallback creation
    const customExercise = this.synthesizeCustomExercise(trimmed);
    return {
      rawName: trimmed,
      matchedExercise: null,
      matchType: 'custom_fallback',
      confidence: 0.0,
      proposedExercise: customExercise,
    };
  }

  /**
   * Inspects parsed workouts against the existing database to flag duplicate sessions.
   * Matches on date + shared exercise + identical set count.
   */
  async detectDuplicates(
    workouts: ParsedCsvWorkout[],
    exerciseMatchesMap: Map<string, ExerciseMatchResult>
  ): Promise<WorkoutDuplicateCheck[]> {
    const checks: WorkoutDuplicateCheck[] = [];

    for (const w of workouts) {
      // Find all existing workouts on the same date
      const existingWorkoutsOnDate = await this.workoutRepo.findAll({
        startDate: w.date,
        endDate: w.date,
      });

      let isDuplicate = false;
      let duplicateOfWorkoutId: string | undefined;
      let duplicateReason: string | undefined;

      for (const existing of existingWorkoutsOnDate) {
        const existingSets = await this.workoutRepo.getSetsByWorkoutId(existing.id);
        if (existingSets.length === 0) continue;

        // Group existing sets by exercise_id and count
        const existingCounts = new Map<string, number>();
        for (const s of existingSets) {
          existingCounts.set(s.exercise_id, (existingCounts.get(s.exercise_id) || 0) + 1);
        }

        // Check if any exercise in the imported workout matches the exact set count
        let matchedExerciseCount = 0;
        let totalImportedExercises = w.exercises.length;

        for (const impEx of w.exercises) {
          const matchResult = exerciseMatchesMap.get(impEx.rawExerciseName);
          const exerciseId = matchResult?.matchedExercise?.id;
          if (exerciseId && existingCounts.has(exerciseId)) {
            const existingSetCount = existingCounts.get(exerciseId)!;
            if (existingSetCount === impEx.sets.length) {
              matchedExerciseCount++;
            }
          }
        }

        // Duplicate threshold: if at least 1 exercise matches identically on the same date,
        // or total sets count is identical on the same date
        if (
          matchedExerciseCount > 0 &&
          (matchedExerciseCount === totalImportedExercises || existingSets.length === w.exercises.reduce((acc, e) => acc + e.sets.length, 0))
        ) {
          isDuplicate = true;
          duplicateOfWorkoutId = existing.id;
          duplicateReason = `Matches existing workout "${existing.name}" on ${w.date} with ${existingSets.length} sets.`;
          break;
        }
      }

      checks.push({
        workout: w,
        isDuplicate,
        duplicateOfWorkoutId,
        duplicateReason,
      });
    }

    return checks;
  }

  /**
   * Generates a complete preview of the import including matched exercises,
   * proposed custom exercises, and duplicate sessions.
   */
  async generatePreview(parsedResult: CsvParseResult): Promise<WorkoutImportPreview> {
    const catalog = await this.exerciseRepo.findAll();

    // Extract all unique raw exercise names
    const rawNames = new Set<string>();
    for (const w of parsedResult.workouts) {
      for (const e of w.exercises) {
        rawNames.add(e.rawExerciseName);
      }
    }

    // Match each unique exercise
    const exerciseMatches: ExerciseMatchResult[] = [];
    const matchesMap = new Map<string, ExerciseMatchResult>();

    for (const name of rawNames) {
      const match = await this.matchExercise(name, catalog);
      exerciseMatches.push(match);
      matchesMap.set(name, match);
    }

    // Sort matches: matched first, custom fallbacks second
    exerciseMatches.sort((a, b) => b.confidence - a.confidence);

    // Detect duplicates
    const duplicateChecks = await this.detectDuplicates(parsedResult.workouts, matchesMap);
    const duplicateCount = duplicateChecks.filter((c) => c.isDuplicate).length;

    return {
      source: parsedResult.source,
      totalWorkouts: parsedResult.workouts.length,
      totalSets: parsedResult.totalSets,
      duplicateWorkoutsCount: duplicateCount,
      workouts: duplicateChecks,
      exerciseMatches,
    };
  }

  /**
   * Executes the import into the SQLite database.
   * Creates custom exercises if needed, persists workouts with status 'completed',
   * sets with canonical kg weights, and tags provenance with imported_from.
   */
  async executeImport(
    preview: WorkoutImportPreview,
    options?: ImportOptions
  ): Promise<ImportExecutionResult> {
    const skipDuplicates = options?.skipDuplicates !== false;
    const overrides = options?.exerciseOverrides || {};

    const errors: string[] = [];
    const workoutIds: string[] = [];
    let importedWorkoutsCount = 0;
    let importedSetsCount = 0;
    let skippedDuplicatesCount = 0;
    let createdExercisesCount = 0;

    // Map raw name -> resolved exerciseId
    const resolvedExerciseIds = new Map<string, string>();

    // Step 1: Ensure custom exercises exist or are created
    for (const match of preview.exerciseMatches) {
      const overrideId = overrides[match.rawName];
      if (overrideId) {
        resolvedExerciseIds.set(match.rawName, overrideId);
        continue;
      }

      if (match.matchedExercise) {
        resolvedExerciseIds.set(match.rawName, match.matchedExercise.id);
        continue;
      }

      // Need to create custom fallback
      try {
        const existing = await this.exerciseRepo.findById(match.proposedExercise.id);
        if (!existing) {
          await this.exerciseRepo.create(match.proposedExercise);
          createdExercisesCount++;
        }
        resolvedExerciseIds.set(match.rawName, match.proposedExercise.id);
      } catch (err: any) {
        errors.push(`Failed to create custom exercise "${match.rawName}": ${err?.message}`);
      }
    }

    // Step 2: Iterate over workouts and commit
    for (const check of preview.workouts) {
      if (check.isDuplicate && skipDuplicates) {
        skippedDuplicatesCount++;
        continue;
      }

      const w = check.workout;
      const workoutId = `workout_imp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      let completedAt: string | null = null;
      if (w.durationSeconds && w.durationSeconds > 0) {
        const startMs = new Date(w.startedAt).getTime();
        completedAt = new Date(startMs + w.durationSeconds * 1000).toISOString();
      } else {
        completedAt = w.startedAt;
      }

      const newWorkout: Workout = {
        id: workoutId,
        template_id: null,
        date: w.date,
        name: w.name,
        notes: w.notes || null,
        started_at: w.startedAt,
        duration_seconds: w.durationSeconds ?? null,
        status: 'completed',
        completed_at: completedAt,
        imported_from: preview.source,
      };

      try {
        await this.workoutRepo.create(newWorkout);
        workoutIds.push(workoutId);
        importedWorkoutsCount++;

        // Step 3: Insert workout sets
        const setsToInsert: WorkoutSet[] = [];

        for (const ex of w.exercises) {
          const exerciseId = resolvedExerciseIds.get(ex.rawExerciseName);
          if (!exerciseId) {
            errors.push(`Skipped sets for unmapped exercise "${ex.rawExerciseName}".`);
            continue;
          }

          for (const s of ex.sets) {
            const setId = `set_imp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const workoutSet: WorkoutSet = {
              id: setId,
              workout_id: workoutId,
              exercise_id: exerciseId,
              gear_id: null,
              set_number: s.setNumber,
              weight: s.weightKg,
              raw_input_weight: s.rawInputWeightKg,
              added_weight: null,
              reps: s.reps,
              reps_right: s.repsRight ?? null,
              rpe: s.rpe ?? null,
              rir: s.rir ?? (s.rpe != null ? Math.max(0, 10 - s.rpe) : null),
              set_type: s.setType,
              set_notes: s.notes ?? null,
              exercise_group_id: s.exerciseGroupId ?? null,
              created_at: w.startedAt,
            };
            setsToInsert.push(workoutSet);
          }
        }

        if (setsToInsert.length > 0) {
          await this.workoutRepo.saveSets(setsToInsert);
          importedSetsCount += setsToInsert.length;
        }
      } catch (err: any) {
        errors.push(`Failed to import workout "${w.name}" on ${w.date}: ${err?.message}`);
      }
    }

    return {
      success: errors.length === 0,
      importedWorkoutsCount,
      importedSetsCount,
      skippedDuplicatesCount,
      createdExercisesCount,
      workoutIds,
      errors,
    };
  }

  // ==========================================================================
  // Private Matching Helpers
  // ==========================================================================

  private tokenize(str: string): string[] {
    const stopwords = new Set(['the', 'a', 'an', 'of', 'and', 'with', 'for', 'to', 'in', 'on', 'at']);
    return str
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopwords.has(w));
  }

  private synthesizeCustomExercise(rawName: string): Exercise {
    const lower = rawName.toLowerCase();
    const id = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Infer category
    let category: ExerciseCategory = 'Other';
    if (lower.includes('dumbbell') || lower.includes(' db')) {
      category = 'Dumbbell';
    } else if (lower.includes('barbell') || lower.includes(' bb')) {
      category = 'Barbell';
    } else if (lower.includes('cable') || lower.includes('pulley')) {
      category = 'Cable';
    } else if (lower.includes('machine') || lower.includes('press machine')) {
      category = 'Machine';
    } else if (lower.includes('pull-up') || lower.includes('push-up') || lower.includes('dip') || lower.includes('bodyweight')) {
      category = 'Bodyweight';
    }

    // Infer muscle group
    let muscleGroup: MuscleGroup | string = 'Other';
    if (lower.includes('bench') || lower.includes('chest') || lower.includes('fly') || lower.includes('push-up') || lower.includes('dip')) {
      muscleGroup = 'Chest';
    } else if (lower.includes('squat') || lower.includes('leg press') || lower.includes('lunge') || lower.includes('quad')) {
      muscleGroup = 'Quads';
    } else if (lower.includes('deadlift') || lower.includes('pull-up') || lower.includes('row') || lower.includes('lat') || lower.includes('back')) {
      muscleGroup = 'Back';
    } else if (lower.includes('shoulder') || lower.includes('overhead') || lower.includes('press') || lower.includes('delt') || lower.includes('lateral')) {
      muscleGroup = 'Shoulders';
    } else if (lower.includes('rdl') || lower.includes('hamstring') || lower.includes('leg curl')) {
      muscleGroup = 'Hamstrings';
    } else if (lower.includes('tricep') || lower.includes('skull') || lower.includes('pushdown')) {
      muscleGroup = 'Triceps';
    } else if (lower.includes('bicep') || lower.includes('curl')) {
      muscleGroup = 'Biceps';
    } else if (lower.includes('calf') || lower.includes('calves')) {
      muscleGroup = 'Calves';
    } else if (lower.includes('abs') || lower.includes('knee raise') || lower.includes('core')) {
      muscleGroup = 'Abs';
    }

    return {
      id,
      name: rawName,
      muscle_group: muscleGroup,
      category,
      is_compound: false,
      is_bodyweight: category === 'Bodyweight',
      is_unilateral: false,
      load_mode: category === 'Dumbbell' ? 'per_hand' : 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: category === 'Barbell' ? 20.0 : 0.0,
      is_custom: true,
      parent_exercise_id: null,
      standard_lift_type: null,
      default_rest_seconds: 120,
    };
  }
}
