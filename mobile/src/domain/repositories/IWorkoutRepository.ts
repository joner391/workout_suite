import {
  Workout,
  WorkoutFilter,
  WorkoutSet,
  WorkoutWithSets,
  RepMaxQueryOptions,
  RawRepMaxRow,
} from '../../core/types';

/**
 * Repository interface managing Workout sessions and WorkoutSet logging.
 *
 * Implements write-through persistence contracts, crash recovery queries,
 * and global ghost-set lookups for progressive overload auto-referencing.
 */
export interface IWorkoutRepository {
  // ==========================================================================
  // Workout Session Operations
  // ==========================================================================

  /**
   * Retrieves a workout session by its unique ID.
   */
  findById(id: string): Promise<Workout | null>;

  /**
   * Retrieves workout sessions matching optional filter criteria (status, dates, template).
   * Results are typically ordered by date DESC, started_at DESC.
   */
  findAll(filter?: WorkoutFilter): Promise<Workout[]>;

  /**
   * Persists a new workout session record.
   */
  create(workout: Workout): Promise<Workout>;

  /**
   * Updates an existing workout session (status, completion time, duration, notes).
   */
  update(workout: Workout): Promise<Workout>;

  /**
   * Deletes a workout session and all associated workout sets (cascading delete).
   */
  delete(id: string): Promise<void>;

  /**
   * Retrieves the currently active in-progress workout session for crash recovery.
   * If multiple in-progress sessions exist, returns the most recently started one.
   * Returns null if no workout is currently in progress.
   */
  getInProgressWorkout(): Promise<Workout | null>;

  /**
   * Retrieves a workout along with all of its associated sets ordered by set_number.
   */
  getWorkoutWithSets(workoutId: string): Promise<WorkoutWithSets | null>;

  // ==========================================================================
  // Workout Sets (Write-Through Logging) Operations
  // ==========================================================================

  /**
   * Retrieves all sets for a given workout session ordered by set_number ASC.
   */
  getSetsByWorkoutId(workoutId: string): Promise<WorkoutSet[]>;

  /**
   * Batch retrieves all sets for multiple workout sessions in a single query.
   * Results are ordered by workout_id, set_number ASC.
   */
  getSetsByWorkoutIds(workoutIds: string[]): Promise<WorkoutSet[]>;

  /**
   * Inserts a newly logged workout set.
   */
  addSet(set: WorkoutSet): Promise<WorkoutSet>;

  /**
   * Updates an existing workout set (e.g. weight, reps, RPE/RIR, notes).
   */
  updateSet(set: WorkoutSet): Promise<WorkoutSet>;

  /**
   * Deletes a single workout set by its ID.
   */
  deleteSet(setId: string): Promise<void>;

  /**
   * Bulk inserts or updates an array of workout sets.
   */
  saveSets(sets: WorkoutSet[]): Promise<WorkoutSet[]>;

  /**
   * Deletes all sets associated with a workout session.
   */
  deleteSetsByWorkoutId(workoutId: string): Promise<void>;

  // ==========================================================================
  // Historical & Ghosting Queries
  // ==========================================================================

  /**
   * Global ghost-set lookup:
   * Finds the most recently completed workout session globally containing sets for
   * the specified exercise, and returns all sets performed for that exercise in that
   * session, ordered by set_number ASC.
   *
   * Only looks at workouts with status === 'completed'.
   * Returns an empty array if no prior completed session contains sets for this exercise.
   */
  getMostRecentCompletedSetsForExercise(exerciseId: string): Promise<WorkoutSet[]>;

  /**
   * Retrieves all historical sets logged for a specific exercise across all workouts,
   * optionally filtering for completed workouts only.
   */
  getHistoricalSetsForExercise(
    exerciseId: string,
    options?: { onlyCompletedWorkouts?: boolean }
  ): Promise<WorkoutSet[]>;

  /**
   * Extracts the heaviest completed sets per unique completed repetition count
   * (e.g. 1RM, 2RM, 3RM, 5RM, etc.), with optional date scoping and cross-variant exercise filtering.
   */
  getRepMaxSets(options: RepMaxQueryOptions): Promise<RawRepMaxRow[]>;

  /**
   * Aggregates the highest estimated 1RM (e1RM = weight * (1 + reps/30)) across all historical sets
   * grouped by exercise_id via a single high-performance SQL aggregation.
   */
  getBestE1rmByExercise(): Promise<Map<string, number>>;
}

