/**
 * Workout Suite — Active Session Service
 *
 * Implements ADR-010: Write-Through Crash Recovery for Active Sessions
 * Implements ADR-026: Mechanical Load Normalization and Persistence Contract
 *
 * Orchestrates:
 * - Session lifecycle: start, finish, discard, query active in-progress session
 * - Immediate write-through persistence for every set addition, edit, reorder, or deletion
 * - Canonical mechanical load normalization via `loadNormalizer`
 * - Progressive overload ghost-set retrieval from the most recent global completed session
 */

import {
  Workout,
  WorkoutSet,
  WorkoutWithSets,
  SetType,
  Exercise,
  GearInventory,
  WeightUnit,
} from '../core/types';
import { normalizeExerciseLoad } from '../core/math/loadNormalizer';
import { lbsToKg } from '../core/math/unitConversion';
import {
  generateWarmupSets,
  calculateWarmupAutoregulation,
  WarmupPerceptionRating,
  AutoregulatedLoadAdjustment,
} from '../core/math/warmupEstimator';
import { IWorkoutRepository } from '../domain/repositories/IWorkoutRepository';
import { IExerciseRepository } from '../domain/repositories/IExerciseRepository';
import { IGearRepository } from '../domain/repositories/IGearRepository';

// ============================================================================
// Service DTOs & Input Types
// ============================================================================

export interface StartWorkoutInput {
  name?: string;
  templateId?: string | null;
  date?: string; // ISO date 'YYYY-MM-DD' (defaults to today)
  startedAt?: string; // ISO timestamp (defaults to current time)
  notes?: string | null;
}

export interface AddSetInput {
  exerciseId: string;
  rawInputWeight: number; // Exact weight typed by user
  reps: number;
  repsRight?: number | null; // Unilateral right limb reps
  rpe?: number | null;
  rir?: number | null;
  setType?: SetType;
  setNotes?: string | null;
  gearId?: string | null;
  exerciseGroupId?: string | null;
  bodyweightKg?: number | null; // Athlete's active bodyweight for bodyweight movements
  addedWeight?: number | null; // Explicit added/assisted delta (+10, -15)
  setNumber?: number; // Optional; calculated contiguously if omitted
  unitSystem?: WeightUnit;
}

export interface UpdateSetInput {
  rawInputWeight?: number;
  reps?: number;
  repsRight?: number | null;
  rpe?: number | null;
  rir?: number | null;
  setType?: SetType;
  setNotes?: string | null;
  gearId?: string | null;
  exerciseGroupId?: string | null;
  bodyweightKg?: number | null;
  addedWeight?: number | null;
  setNumber?: number;
  unitSystem?: WeightUnit;
}

export interface FinishWorkoutInput {
  completedAt?: string;
  notes?: string | null;
}

/**
 * Portable unique ID generator across Expo, React Native, Node.js, and Jest.
 */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns today's ISO date in YYYY-MM-DD format.
 */
function getTodayIsoDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class ActiveSessionService {
  private readonly exerciseCache: Map<string, Exercise> = new Map();
  private readonly gearCache: Map<string, GearInventory> = new Map();

  constructor(
    private readonly workoutRepo: IWorkoutRepository,
    private readonly exerciseRepo: IExerciseRepository,
    private readonly gearRepo?: IGearRepository
  ) {}

  private async resolveExercise(exerciseId: string): Promise<Exercise | null> {
    if (this.exerciseCache.has(exerciseId)) {
      return this.exerciseCache.get(exerciseId)!;
    }
    const exercise = await this.exerciseRepo.findById(exerciseId);
    if (exercise) {
      this.exerciseCache.set(exerciseId, exercise);
    }
    return exercise;
  }

  private async resolveGear(gearId: string): Promise<GearInventory | null> {
    if (this.gearCache.has(gearId)) {
      return this.gearCache.get(gearId)!;
    }
    if (!this.gearRepo) return null;
    const gear = await this.gearRepo.findById(gearId);
    if (gear) {
      this.gearCache.set(gearId, gear);
    }
    return gear;
  }

  // ==========================================================================
  // Session Lifecycle Management
  // ==========================================================================

  /**
   * Starts a new workout session with 'in_progress' status and writes it to SQLite.
   *
   * @param input Workout initialization options.
   * @param options.allowMultipleInProgress If false (default), throws if another session is already in progress.
   */
  public async startWorkout(
    input?: StartWorkoutInput,
    options?: { allowMultipleInProgress?: boolean }
  ): Promise<Workout> {
    if (!options?.allowMultipleInProgress) {
      const active = await this.workoutRepo.getInProgressWorkout();
      if (active) {
        throw new Error(
          `Cannot start workout: session '${active.id}' is already in progress.`
        );
      }
    }

    const now = new Date();
    const startedAt = input?.startedAt ?? now.toISOString();
    const date = input?.date ?? getTodayIsoDate();
    const name = input?.name?.trim() || `Workout on ${date}`;

    const newWorkout: Workout = {
      id: generateUuid(),
      template_id: input?.templateId ?? null,
      date,
      name,
      notes: input?.notes ?? null,
      started_at: startedAt,
      duration_seconds: null,
      status: 'in_progress',
      completed_at: null,
      imported_from: null,
    };

    return this.workoutRepo.create(newWorkout);
  }

  /**
   * Completes an active workout session, calculates elapsed duration, and marks status 'completed'.
   */
  public async finishWorkout(
    workoutId: string,
    input?: FinishWorkoutInput
  ): Promise<Workout> {
    const workout = await this.workoutRepo.findById(workoutId);
    if (!workout) {
      throw new Error(`Workout with ID '${workoutId}' not found.`);
    }

    const completedAt = input?.completedAt ?? new Date().toISOString();
    const startTimeMs = new Date(workout.started_at).getTime();
    const endTimeMs = new Date(completedAt).getTime();
    const durationSeconds = Math.max(0, Math.round((endTimeMs - startTimeMs) / 1000));

    const updatedWorkout: Workout = {
      ...workout,
      status: 'completed',
      completed_at: completedAt,
      duration_seconds: isNaN(durationSeconds) ? 0 : durationSeconds,
      notes: input?.notes !== undefined ? input.notes : workout.notes,
    };

    return this.workoutRepo.update(updatedWorkout);
  }

  /**
   * Discards an in-progress workout by updating its status to 'discarded'.
   */
  public async discardWorkout(workoutId: string): Promise<Workout> {
    const workout = await this.workoutRepo.findById(workoutId);
    if (!workout) {
      throw new Error(`Workout with ID '${workoutId}' not found.`);
    }

    const updatedWorkout: Workout = {
      ...workout,
      status: 'discarded',
      completed_at: new Date().toISOString(),
    };

    return this.workoutRepo.update(updatedWorkout);
  }

  /**
   * Permanently deletes a workout and cascades through all its sets.
   */
  public async deleteWorkout(workoutId: string): Promise<void> {
    await this.workoutRepo.delete(workoutId);
  }

  /**
   * Retrieves the currently active in-progress workout, if any.
   */
  public async getInProgressWorkout(): Promise<Workout | null> {
    return this.workoutRepo.getInProgressWorkout();
  }

  /**
   * Retrieves a workout session and all of its associated sets ordered by set_number.
   */
  public async getActiveWorkout(workoutId: string): Promise<WorkoutWithSets | null> {
    return this.workoutRepo.getWorkoutWithSets(workoutId);
  }

  // ==========================================================================
  // Set Logging & Write-Through Persistence
  // ==========================================================================

  /**
   * Logs a new set for an exercise in the active workout.
   * Automatically resolves exercise metadata, calculates canonical normalized load,
   * determines contiguous set numbering, and writes through immediately to storage.
   */
  public async addSet(workoutId: string, input: AddSetInput): Promise<WorkoutSet> {
    const workout = await this.workoutRepo.findById(workoutId);
    if (!workout) {
      throw new Error(`Workout with ID '${workoutId}' not found.`);
    }

    // Resolve exercise definition for load normalization
    const exercise = await this.resolveExercise(input.exerciseId);
    if (!exercise) {
      throw new Error(`Exercise with ID '${input.exerciseId}' not found in catalog.`);
    }

    // Resolve gear if specified
    const gear = input.gearId ? await this.resolveGear(input.gearId) : null;

    // Convert input weight to canonical kilograms if entered in lbs
    const inputWeightKg = input.unitSystem === 'lbs'
      ? lbsToKg(input.rawInputWeight)
      : input.rawInputWeight;

    const addedWeightKg = input.addedWeight != null
      ? (input.unitSystem === 'lbs' ? lbsToKg(input.addedWeight) : input.addedWeight)
      : (exercise.is_bodyweight ? inputWeightKg : null);

    // Normalize mechanical load per ADR-026
    const normalized = normalizeExerciseLoad(
      inputWeightKg,
      exercise,
      gear,
      input.bodyweightKg,
      addedWeightKg
    );

    // Determine contiguous set number and auto-inherit group id if not explicitly provided
    const existingSets = await this.workoutRepo.getSetsByWorkoutId(workoutId);
    const exerciseSets = existingSets.filter((s) => s.exercise_id === input.exerciseId);

    let setNumber = input.setNumber;
    if (setNumber === undefined || setNumber === null) {
      setNumber = exerciseSets.length > 0
        ? Math.max(...exerciseSets.map((s) => s.set_number)) + 1
        : 1;
    }

    let exerciseGroupId = input.exerciseGroupId;
    if (exerciseGroupId === undefined) {
      const existingWithGroup = exerciseSets.find((s) => s.exercise_group_id !== null);
      exerciseGroupId = existingWithGroup ? existingWithGroup.exercise_group_id : null;
    }

    const newSet: WorkoutSet = {
      id: generateUuid(),
      workout_id: workoutId,
      exercise_id: input.exerciseId,
      gear_id: input.gearId ?? null,
      set_number: setNumber,
      weight: normalized.effectiveWeightKg,
      raw_input_weight: input.rawInputWeight,
      added_weight: input.addedWeight ?? (exercise.is_bodyweight ? input.rawInputWeight : null),
      reps: Math.max(0, input.reps),
      reps_right: input.repsRight ?? null,
      rpe: input.rpe ?? null,
      rir: input.rir ?? null,
      set_type: input.setType ?? 'working',
      set_notes: input.setNotes ?? null,
      exercise_group_id: exerciseGroupId ?? null,
      created_at: new Date().toISOString(),
    };

    return this.workoutRepo.addSet(newSet);
  }

  /**
   * Updates an existing logged set and re-normalizes mechanical load if weight or gear was modified.
   */
  public async updateSet(
    workoutId: string,
    setId: string,
    input: UpdateSetInput
  ): Promise<WorkoutSet> {
    const existingSets = await this.workoutRepo.getSetsByWorkoutId(workoutId);
    const existingSet = existingSets.find((s) => s.id === setId);
    if (!existingSet) {
      throw new Error(`Set with ID '${setId}' not found in workout '${workoutId}'.`);
    }

    const exercise = await this.resolveExercise(existingSet.exercise_id);
    if (!exercise) {
      throw new Error(`Exercise '${existingSet.exercise_id}' not found.`);
    }

    const gearId = input.gearId !== undefined ? input.gearId : existingSet.gear_id;
    const gear = gearId ? await this.resolveGear(gearId) : null;

    const rawInputWeight = input.rawInputWeight !== undefined
      ? input.rawInputWeight
      : existingSet.raw_input_weight;

    const addedWeight = input.addedWeight !== undefined
      ? input.addedWeight
      : existingSet.added_weight;

    const inputWeightKg = input.unitSystem === 'lbs'
      ? lbsToKg(rawInputWeight)
      : rawInputWeight;

    const addedWeightKg = addedWeight != null
      ? (input.unitSystem === 'lbs' ? lbsToKg(addedWeight) : addedWeight)
      : (exercise.is_bodyweight ? inputWeightKg : null);

    const normalized = normalizeExerciseLoad(
      inputWeightKg,
      exercise,
      gear,
      input.bodyweightKg,
      addedWeightKg
    );

    const updatedSet: WorkoutSet = {
      ...existingSet,
      gear_id: gearId,
      set_number: input.setNumber !== undefined ? input.setNumber : existingSet.set_number,
      weight: normalized.effectiveWeightKg,
      raw_input_weight: rawInputWeight,
      added_weight: addedWeight ?? (exercise.is_bodyweight ? rawInputWeight : null),
      reps: input.reps !== undefined ? Math.max(0, input.reps) : existingSet.reps,
      reps_right: input.repsRight !== undefined ? input.repsRight : existingSet.reps_right,
      rpe: input.rpe !== undefined ? input.rpe : existingSet.rpe,
      rir: input.rir !== undefined ? input.rir : existingSet.rir,
      set_type: input.setType !== undefined ? input.setType : existingSet.set_type,
      set_notes: input.setNotes !== undefined ? input.setNotes : existingSet.set_notes,
      exercise_group_id: input.exerciseGroupId !== undefined
        ? input.exerciseGroupId
        : existingSet.exercise_group_id,
    };

    return this.workoutRepo.updateSet(updatedSet);
  }

  /**
   * Deletes a set from the workout.
   *
   * @param workoutId Unique ID of the workout.
   * @param setId Unique ID of the set to delete.
   * @param renumberRemaining If true (default), renumbers the remaining sets for this exercise to 1, 2, 3...
   */
  public async deleteSet(
    workoutId: string,
    setId: string,
    renumberRemaining: boolean = true
  ): Promise<void> {
    const existingSets = await this.workoutRepo.getSetsByWorkoutId(workoutId);
    const targetSet = existingSets.find((s) => s.id === setId);
    if (!targetSet) {
      return; // Already deleted
    }

    await this.workoutRepo.deleteSet(setId);

    if (renumberRemaining) {
      const remainingForExercise = existingSets
        .filter((s) => s.exercise_id === targetSet.exercise_id && s.id !== setId)
        .sort((a, b) => a.set_number - b.set_number);

      let changed = false;
      const updatedList: WorkoutSet[] = [];
      for (let i = 0; i < remainingForExercise.length; i++) {
        const expectedNumber = i + 1;
        if (remainingForExercise[i].set_number !== expectedNumber) {
          changed = true;
          updatedList.push({
            ...remainingForExercise[i],
            set_number: expectedNumber,
          });
        }
      }

      if (changed && updatedList.length > 0) {
        await this.workoutRepo.saveSets(updatedList);
      }
    }
  }

  /**
   * Reorders sets for a specific exercise within a workout.
   *
   * @param workoutId Unique ID of the workout.
   * @param exerciseId Exercise whose sets are being reordered.
   * @param orderedSetIds Array of set IDs in their desired order.
   */
  public async reorderSets(
    workoutId: string,
    exerciseId: string,
    orderedSetIds: string[]
  ): Promise<WorkoutSet[]> {
    const existingSets = await this.workoutRepo.getSetsByWorkoutId(workoutId);
    const exerciseSets = existingSets.filter((s) => s.exercise_id === exerciseId);
    const setMap = new Map(exerciseSets.map((s) => [s.id, s]));

    const reordered: WorkoutSet[] = [];
    for (let index = 0; index < orderedSetIds.length; index++) {
      const id = orderedSetIds[index];
      const set = setMap.get(id);
      if (set) {
        reordered.push({
          ...set,
          set_number: index + 1,
        });
      }
    }

    if (reordered.length > 0) {
      await this.workoutRepo.saveSets(reordered);
    }

    return reordered;
  }

  // ==========================================================================
  // Ghost Set Progressive Overload Lookup
  // ==========================================================================

  /**
   * Global ghost-set lookup:
   * Retrieves the sets from the most recently completed workout session containing
   * the specified exercise, ordered by set_number ASC.
   */
  public async getGhostSetsForExercise(exerciseId: string): Promise<WorkoutSet[]> {
    return this.workoutRepo.getMostRecentCompletedSetsForExercise(exerciseId);
  }

  /**
   * Returns ghost values (weight, rawInputWeight, reps, rpe, rir) for a specific set number.
   * If the user is on Set 2, returns Set 2 from their previous completed session.
   */
  public async getGhostSet(
    exerciseId: string,
    setNumber: number
  ): Promise<WorkoutSet | null> {
    const ghostSets = await this.getGhostSetsForExercise(exerciseId);
    const match = ghostSets.find((s) => s.set_number === setNumber);
    return match || null;
  }

  /**
   * Retrieves all sets for a specific workout ordered by set_number ASC.
   */
  public async getWorkoutSets(workoutId: string): Promise<WorkoutSet[]> {
    return this.workoutRepo.getSetsByWorkoutId(workoutId);
  }

  /**
   * Generates individualized warm-up progression sets for an exercise within an active workout.
   *
   * Target Load Resolution Fallback Chain:
   * 1. Explicit `options.targetWorkingWeightKg` if > 0.
   * 2. First non-warmup set's `raw_input_weight` (or `weight`) in active workout if > 0.
   * 3. Most recent completed ghost set's `raw_input_weight` (or `weight`) if > 0.
   * 4. Default fallback load: bar tare weight (2 acclimating sets) for barbell lifts, or sensible baseline.
   *
   * Context-Aware Volume Reduction:
   * Attenuates redundant empty-bar steps to at most 1-2 potentiation sets if the exercise's primary muscle group
   * has already been warmed up earlier in the session.
   *
   * Prepend & Renumber:
   * Sets are inserted contiguously at the start of the exercise (set 1..N) and subsequent sets are renumbered.
   * All sets are immediately persisted via write-through.
   */
  public async generateWarmupSetsForExercise(
    workoutId: string,
    exerciseId: string,
    options?: {
      targetWorkingWeightKg?: number;
      alreadyWarmedMuscleGroups?: Set<string>;
    }
  ): Promise<WorkoutSet[]> {
    const workout = await this.workoutRepo.findById(workoutId);
    if (!workout) {
      throw new Error(`Workout with ID '${workoutId}' not found.`);
    }

    const exercise = await this.resolveExercise(exerciseId);
    if (!exercise) {
      throw new Error(`Exercise with ID '${exerciseId}' not found in catalog.`);
    }

    const existingSets = await this.workoutRepo.getSetsByWorkoutId(workoutId);
    const exerciseSets = existingSets
      .filter((s) => s.exercise_id === exerciseId)
      .sort((a, b) => a.set_number - b.set_number);

    // If warmup sets already exist for this exercise, do not duplicate
    const existingWarmups = exerciseSets.filter((s) => s.set_type === 'warmup');
    if (existingWarmups.length > 0) {
      return existingWarmups;
    }

    // 1. Target load resolution fallback chain
    let resolvedWorkingWeight = 0;
    if (options?.targetWorkingWeightKg && options.targetWorkingWeightKg > 0) {
      resolvedWorkingWeight = options.targetWorkingWeightKg;
    }

    const firstWorkingSet = exerciseSets.find((s) => s.set_type !== 'warmup');
    if (resolvedWorkingWeight <= 0 && firstWorkingSet) {
      if (firstWorkingSet.raw_input_weight > 0) {
        resolvedWorkingWeight = firstWorkingSet.raw_input_weight;
      } else if (firstWorkingSet.weight > 0) {
        resolvedWorkingWeight = firstWorkingSet.weight;
      }
    }

    if (resolvedWorkingWeight <= 0) {
      const ghostSets = await this.getGhostSetsForExercise(exerciseId);
      const ghostWorking =
        ghostSets.find(
          (s) => s.set_type !== 'warmup' && (s.raw_input_weight > 0 || s.weight > 0)
        ) || ghostSets[0];
      if (ghostWorking) {
        resolvedWorkingWeight =
          ghostWorking.raw_input_weight > 0
            ? ghostWorking.raw_input_weight
            : ghostWorking.weight;
      }
    }

    const barTareWeight = exercise.default_bar_weight_kg || 20;

    // 2. Generate raw progression ladder
    let steps: { setNumber: number; weight: number; reps: number; isDiagnosticSingle: boolean; notes: string }[] = [];

    if (resolvedWorkingWeight > 0) {
      steps = generateWarmupSets({
        workingWeightKg: resolvedWorkingWeight,
        barTareWeightKg: barTareWeight,
        minimumPlateIncrementKg: 2.5,
        isBodyweight: exercise.is_bodyweight || false,
      });
    }

    // Fallback: If working weight is still 0 or empty steps returned, avoid silent failure
    if (steps.length === 0) {
      if (exercise.is_bodyweight) {
        steps = [
          {
            setNumber: 1,
            weight: 0,
            reps: 10,
            isDiagnosticSingle: false,
            notes: 'Bodyweight activation set',
          },
        ];
      } else if (exercise.category === 'Barbell' || barTareWeight > 0) {
        steps = [
          {
            setNumber: 1,
            weight: barTareWeight,
            reps: 10,
            isDiagnosticSingle: false,
            notes: 'Empty bar - mobility and motor pattern rehearsal',
          },
          {
            setNumber: 2,
            weight: barTareWeight,
            reps: 5,
            isDiagnosticSingle: true,
            notes: 'Empty bar - movement groove & readiness check',
          },
        ];
      } else {
        steps = [
          {
            setNumber: 1,
            weight: 10,
            reps: 10,
            isDiagnosticSingle: false,
            notes: 'Light preparation set',
          },
          {
            setNumber: 2,
            weight: 15,
            reps: 6,
            isDiagnosticSingle: false,
            notes: 'Movement rehearsal',
          },
        ];
      }
    }

    // 3. Context-Aware Synergist / Muscle Group Volume Reduction
    let isMuscleGroupAlreadyWarmed = false;
    if (options?.alreadyWarmedMuscleGroups?.has(exercise.muscle_group)) {
      isMuscleGroupAlreadyWarmed = true;
    } else {
      for (const set of existingSets) {
        if (set.exercise_id !== exerciseId) {
          const ex = await this.resolveExercise(set.exercise_id);
          if (ex && ex.muscle_group === exercise.muscle_group && set.set_type !== 'warmup') {
            isMuscleGroupAlreadyWarmed = true;
            break;
          }
        }
      }
    }

    if (isMuscleGroupAlreadyWarmed && steps.length > 2) {
      steps = steps.slice(-2);
    }

    // Re-index step numbers
    steps = steps.map((s, idx) => ({ ...s, setNumber: idx + 1 }));

    // 4. Prepend & Renumber Contiguously
    const gear = firstWorkingSet?.gear_id ? await this.resolveGear(firstWorkingSet.gear_id) : null;
    const now = new Date().toISOString();

    const createdWarmupSets: WorkoutSet[] = steps.map((step, idx) => {
      const normalized = normalizeExerciseLoad(
        step.weight,
        exercise,
        gear
      );
      return {
        id: generateUuid(),
        workout_id: workoutId,
        exercise_id: exerciseId,
        gear_id: firstWorkingSet?.gear_id ?? null,
        set_number: idx + 1,
        weight: normalized.effectiveWeightKg,
        raw_input_weight: normalized.rawInputWeightKg,
        added_weight: normalized.addedWeightKg,
        reps: step.reps,
        reps_right: null,
        rpe: null,
        rir: null,
        set_type: 'warmup',
        set_notes: step.notes,
        exercise_group_id: firstWorkingSet?.exercise_group_id ?? null,
        created_at: now,
      };
    });

    // Shift existing non-warmup sets for this exercise
    const workingSets = exerciseSets.filter((s) => s.set_type !== 'warmup');
    const shiftedWorkingSets: WorkoutSet[] = workingSets.map((s, idx) => ({
      ...s,
      set_number: createdWarmupSets.length + idx + 1,
    }));

    await this.workoutRepo.saveSets([...createdWarmupSets, ...shiftedWorkingSets]);

    return createdWarmupSets;
  }

  /**
   * Applies subjective warm-up autoregulation (Light, Normal, Hard/Heavy) from the diagnostic
   * warm-up single to all remaining uncompleted working sets for the specified exercise.
   *
   * Implements ADR-082 & Warm_up_estimator.md:
   * - Light: +2.5% to +5.0%
   * - Normal: 0.0%
   * - Heavy / Hard: -5.0% to -7.5%
   * - Boundary clamping: [-10.0%, +5.0%]
   * - Immediate write-through normalization and persistence to SQLite.
   */
  public async applyWarmupAutoregulation(
    workoutId: string,
    exerciseId: string,
    rating: WarmupPerceptionRating,
    options?: {
      minimumIncrementKg?: number;
      hasRecentFatigueFlag?: boolean;
      completedSetIds?: Set<string>;
    }
  ): Promise<{
    adjustment: AutoregulatedLoadAdjustment;
    updatedSets: WorkoutSet[];
  }> {
    const workout = await this.workoutRepo.findById(workoutId);
    if (!workout) {
      throw new Error(`Workout with ID '${workoutId}' not found.`);
    }

    const exercise = await this.resolveExercise(exerciseId);
    if (!exercise) {
      throw new Error(`Exercise with ID '${exerciseId}' not found in catalog.`);
    }

    const existingSets = await this.workoutRepo.getSetsByWorkoutId(workoutId);
    const exerciseSets = existingSets
      .filter((s) => s.exercise_id === exerciseId)
      .sort((a, b) => a.set_number - b.set_number);

    const completedIds = options?.completedSetIds ?? new Set<string>();
    const uncompletedWorkSets = exerciseSets.filter(
      (s) => s.set_type !== 'warmup' && !completedIds.has(s.id)
    );

    if (uncompletedWorkSets.length === 0) {
      throw new Error(`No uncompleted working sets found for exercise '${exerciseId}'.`);
    }

    const firstWorkSet = uncompletedWorkSets[0];
    const workingWeight = firstWorkSet.raw_input_weight > 0
      ? firstWorkSet.raw_input_weight
      : firstWorkSet.weight;

    const minIncrement = options?.minimumIncrementKg ?? 2.5;
    const hasFatigue = options?.hasRecentFatigueFlag ?? false;

    const adjustment = calculateWarmupAutoregulation(
      workingWeight,
      rating,
      minIncrement,
      hasFatigue
    );

    const gear = firstWorkSet.gear_id ? await this.resolveGear(firstWorkSet.gear_id) : null;

    const updatedSets: WorkoutSet[] = uncompletedWorkSets.map((s) => {
      const normalized = normalizeExerciseLoad(
        adjustment.adjustedLoadKg,
        exercise,
        gear
      );
      return {
        ...s,
        raw_input_weight: normalized.rawInputWeightKg,
        weight: normalized.effectiveWeightKg,
        added_weight: normalized.addedWeightKg,
      };
    });

    await this.workoutRepo.saveSets(updatedSets);

    return {
      adjustment,
      updatedSets,
    };
  }

  // ==========================================================================
  // Superset & Exercise Grouping Management (ADR-009)
  // ==========================================================================

  /**
   * Groups two or more exercises in an active workout into a superset or giant set sharing an `exercise_group_id`.
   * Immediately updates all existing sets for these exercises in storage.
   *
   * @param workoutId Unique ID of the workout session.
   * @param exerciseIds Array of 2+ exercise IDs to group.
   * @param groupId Optional custom group ID; generates a new UUID if omitted.
   * @returns The assigned `exercise_group_id`.
   */
  public async groupExercises(
    workoutId: string,
    exerciseIds: string[],
    groupId?: string
  ): Promise<string> {
    const workout = await this.workoutRepo.findById(workoutId);
    if (!workout) {
      throw new Error(`Workout with ID '${workoutId}' not found.`);
    }

    const uniqueIds = Array.from(new Set(exerciseIds));
    if (uniqueIds.length < 2) {
      throw new Error('A superset or giant set must contain at least 2 distinct exercises.');
    }

    const assignedGroupId = groupId || generateUuid();
    const existingSets = await this.workoutRepo.getSetsByWorkoutId(workoutId);

    const targetIdSet = new Set(uniqueIds);
    const setsToUpdate: WorkoutSet[] = [];

    for (const set of existingSets) {
      if (targetIdSet.has(set.exercise_id)) {
        if (set.exercise_group_id !== assignedGroupId) {
          setsToUpdate.push({
            ...set,
            exercise_group_id: assignedGroupId,
          });
        }
      }
    }

    if (setsToUpdate.length > 0) {
      await this.workoutRepo.saveSets(setsToUpdate);
    }

    return assignedGroupId;
  }

  /**
   * Ungroups a specific exercise from its superset group.
   * If the remaining group has fewer than 2 exercises, the remaining exercise is also automatically dissolved.
   *
   * @param workoutId Unique ID of the workout session.
   * @param exerciseId Exercise to ungroup.
   */
  public async ungroupExercise(
    workoutId: string,
    exerciseId: string
  ): Promise<void> {
    const existingSets = await this.workoutRepo.getSetsByWorkoutId(workoutId);
    const targetSets = existingSets.filter(
      (s) => s.exercise_id === exerciseId && s.exercise_group_id !== null
    );

    if (targetSets.length === 0) {
      return; // Not in any group
    }

    const groupId = targetSets[0].exercise_group_id;
    const setsToUpdate: WorkoutSet[] = [];

    // Remove group id from this exercise's sets
    for (const set of targetSets) {
      setsToUpdate.push({
        ...set,
        exercise_group_id: null,
      });
    }

    // Check how many other exercises remain in this group
    if (groupId) {
      const remainingSetsInGroup = existingSets.filter(
        (s) => s.exercise_group_id === groupId && s.exercise_id !== exerciseId
      );
      const remainingDistinctExerciseIds = Array.from(
        new Set(remainingSetsInGroup.map((s) => s.exercise_id))
      );

      // If only 1 or 0 exercises remain in the group, dissolve the group completely
      if (remainingDistinctExerciseIds.length <= 1) {
        for (const set of remainingSetsInGroup) {
          setsToUpdate.push({
            ...set,
            exercise_group_id: null,
          });
        }
      }
    }

    if (setsToUpdate.length > 0) {
      await this.workoutRepo.saveSets(setsToUpdate);
    }
  }

  /**
   * Disbands an entire superset group, setting `exercise_group_id = null` for all member sets.
   *
   * @param workoutId Unique ID of the workout session.
   * @param groupId Group ID to dissolve.
   */
  public async ungroupSuperset(
    workoutId: string,
    groupId: string
  ): Promise<void> {
    const existingSets = await this.workoutRepo.getSetsByWorkoutId(workoutId);
    const groupSets = existingSets.filter((s) => s.exercise_group_id === groupId);

    if (groupSets.length === 0) {
      return;
    }

    const setsToUpdate: WorkoutSet[] = groupSets.map((s) => ({
      ...s,
      exercise_group_id: null,
    }));

    await this.workoutRepo.saveSets(setsToUpdate);
  }

  /**
   * Retrieves active superset groups for a workout, returning a mapping of `exercise_group_id` -> `exerciseId[]`.
   */
  public async getSupersetGroups(
    workoutId: string
  ): Promise<Map<string, string[]>> {
    const existingSets = await this.workoutRepo.getSetsByWorkoutId(workoutId);
    const groupMap = new Map<string, Set<string>>();

    for (const set of existingSets) {
      if (set.exercise_group_id) {
        const currentSet = groupMap.get(set.exercise_group_id) ?? new Set<string>();
        currentSet.add(set.exercise_id);
        groupMap.set(set.exercise_group_id, currentSet);
      }
    }

    const result = new Map<string, string[]>();
    for (const [groupId, exIdSet] of groupMap.entries()) {
      result.set(groupId, Array.from(exIdSet));
    }

    return result;
  }
}

