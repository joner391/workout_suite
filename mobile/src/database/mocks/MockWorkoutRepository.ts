import { IWorkoutRepository } from '../../domain/repositories/IWorkoutRepository';
import {
  Workout,
  WorkoutFilter,
  WorkoutSet,
  WorkoutWithSets,
  RepMaxQueryOptions,
  RawRepMaxRow,
} from '../../core/types';

/**
 * In-memory mock implementation of IWorkoutRepository for headless unit tests.
 * Accurately mimics SQLite cascading deletes, in-progress crash recovery lookup,
 * and global ghost-set retrieval across completed workouts.
 */
export class MockWorkoutRepository implements IWorkoutRepository {
  private workouts: Map<string, Workout> = new Map();
  private sets: Map<string, WorkoutSet> = new Map();

  constructor(initialWorkouts?: Workout[], initialSets?: WorkoutSet[]) {
    if (initialWorkouts) {
      this.seed(initialWorkouts, initialSets);
    }
  }

  /**
   * Clears all workouts and sets from memory.
   */
  public clear(): void {
    this.workouts.clear();
    this.sets.clear();
  }

  /**
   * Seeds workouts and sets into memory for testing.
   */
  public seed(workouts: Workout[], sets: WorkoutSet[] = []): void {
    for (const w of workouts) {
      this.workouts.set(w.id, { ...w });
    }
    for (const s of sets) {
      this.sets.set(s.id, { ...s });
    }
  }

  // ==========================================================================
  // Workout Operations
  // ==========================================================================

  async findById(id: string): Promise<Workout | null> {
    const item = this.workouts.get(id);
    return item ? { ...item } : null;
  }

  async findAll(filter?: WorkoutFilter): Promise<Workout[]> {
    let list = Array.from(this.workouts.values());

    if (filter) {
      if (filter.status) {
        list = list.filter((w) => w.status === filter.status);
      }
      if (filter.startDate) {
        list = list.filter((w) => w.date >= filter.startDate!);
      }
      if (filter.endDate) {
        list = list.filter((w) => w.date <= filter.endDate!);
      }
      if (filter.templateId) {
        list = list.filter((w) => w.template_id === filter.templateId);
      }
    }

    // Sort by date DESC, then started_at DESC
    list.sort((a, b) => {
      if (a.date !== b.date) {
        return b.date.localeCompare(a.date);
      }
      return b.started_at.localeCompare(a.started_at);
    });

    if (filter?.offset !== undefined) {
      list = list.slice(filter.offset);
    }
    if (filter?.limit !== undefined) {
      list = list.slice(0, filter.limit);
    }

    return list.map((w) => ({ ...w }));
  }

  async create(workout: Workout): Promise<Workout> {
    const cloned = { ...workout };
    this.workouts.set(cloned.id, cloned);
    return { ...cloned };
  }

  async update(workout: Workout): Promise<Workout> {
    if (!this.workouts.has(workout.id)) {
      throw new Error(`Workout with id '${workout.id}' not found`);
    }
    const cloned = { ...workout };
    this.workouts.set(cloned.id, cloned);
    return { ...cloned };
  }

  async delete(id: string): Promise<void> {
    this.workouts.delete(id);
    // Mimic SQLite ON DELETE CASCADE
    await this.deleteSetsByWorkoutId(id);
  }

  async getInProgressWorkout(): Promise<Workout | null> {
    const inProgress = Array.from(this.workouts.values()).filter(
      (w) => w.status === 'in_progress'
    );

    if (inProgress.length === 0) {
      return null;
    }

    // Return the most recently started in-progress workout
    inProgress.sort((a, b) => b.started_at.localeCompare(a.started_at));
    return { ...inProgress[0] };
  }

  async getWorkoutWithSets(workoutId: string): Promise<WorkoutWithSets | null> {
    const workout = await this.findById(workoutId);
    if (!workout) {
      return null;
    }
    const sets = await this.getSetsByWorkoutId(workoutId);
    return {
      workout,
      sets,
    };
  }

  // ==========================================================================
  // Set Operations
  // ==========================================================================

  async getSetsByWorkoutId(workoutId: string): Promise<WorkoutSet[]> {
    return Array.from(this.sets.values())
      .filter((s) => s.workout_id === workoutId)
      .sort((a, b) => a.set_number - b.set_number)
      .map((s) => ({ ...s }));
  }

  async addSet(set: WorkoutSet): Promise<WorkoutSet> {
    const cloned = { ...set };
    this.sets.set(cloned.id, cloned);
    return { ...cloned };
  }

  async updateSet(set: WorkoutSet): Promise<WorkoutSet> {
    if (!this.sets.has(set.id)) {
      throw new Error(`WorkoutSet with id '${set.id}' not found`);
    }
    const cloned = { ...set };
    this.sets.set(cloned.id, cloned);
    return { ...cloned };
  }

  async deleteSet(setId: string): Promise<void> {
    this.sets.delete(setId);
  }

  async saveSets(sets: WorkoutSet[]): Promise<WorkoutSet[]> {
    const results: WorkoutSet[] = [];
    for (const s of sets) {
      const cloned = { ...s };
      this.sets.set(cloned.id, cloned);
      results.push({ ...cloned });
    }
    return results;
  }

  async deleteSetsByWorkoutId(workoutId: string): Promise<void> {
    for (const [id, s] of this.sets.entries()) {
      if (s.workout_id === workoutId) {
        this.sets.delete(id);
      }
    }
  }

  // ==========================================================================
  // Historical & Ghosting Queries
  // ==========================================================================

  async getMostRecentCompletedSetsForExercise(
    exerciseId: string
  ): Promise<WorkoutSet[]> {
    // 1. Identify all completed workouts
    const completedWorkouts = Array.from(this.workouts.values()).filter(
      (w) => w.status === 'completed'
    );

    // 2. Sort completed workouts descending by completion timestamp (or started_at/date fallback)
    completedWorkouts.sort((a, b) => {
      const timeA = a.completed_at || a.started_at || a.date;
      const timeB = b.completed_at || b.started_at || b.date;
      return timeB.localeCompare(timeA);
    });

    // 3. Find the newest completed workout containing sets for exerciseId
    for (const workout of completedWorkouts) {
      const matchingSets = Array.from(this.sets.values())
        .filter(
          (s) => s.workout_id === workout.id && s.exercise_id === exerciseId
        )
        .sort((a, b) => a.set_number - b.set_number);

      if (matchingSets.length > 0) {
        return matchingSets.map((s) => ({ ...s }));
      }
    }

    return [];
  }

  async getHistoricalSetsForExercise(
    exerciseId: string,
    options?: { onlyCompletedWorkouts?: boolean }
  ): Promise<WorkoutSet[]> {
    return Array.from(this.sets.values())
      .filter((s) => {
        if (s.exercise_id !== exerciseId) {
          return false;
        }
        if (options?.onlyCompletedWorkouts) {
          const workout = this.workouts.get(s.workout_id);
          return workout?.status === 'completed';
        }
        return true;
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((s) => ({ ...s }));
  }

  async getRepMaxSets(options: RepMaxQueryOptions): Promise<RawRepMaxRow[]> {
    const exerciseSet = new Set(options.exerciseIds);
    const matchingSets: { set: WorkoutSet; workoutDate: string }[] = [];

    for (const s of this.sets.values()) {
      if (!exerciseSet.has(s.exercise_id)) {
        continue;
      }
      if (s.reps <= 0 || s.weight <= 0) {
        continue;
      }
      const workout = this.workouts.get(s.workout_id);
      if (!workout || workout.status !== 'completed') {
        continue;
      }
      if (options.startDate && workout.date < options.startDate) {
        continue;
      }
      if (options.endDate && workout.date > options.endDate) {
        continue;
      }
      matchingSets.push({ set: s, workoutDate: workout.date });
    }

    const bestByRep = new Map<number, { set: WorkoutSet; workoutDate: string }>();

    for (const item of matchingSets) {
      const reps = item.set.reps;
      const currentBest = bestByRep.get(reps);

      if (!currentBest) {
        bestByRep.set(reps, item);
      } else {
        if (item.set.weight > currentBest.set.weight) {
          bestByRep.set(reps, item);
        } else if (item.set.weight === currentBest.set.weight) {
          const getIntensity = (set: WorkoutSet) => {
            if (set.rpe != null) return set.rpe;
            if (set.rir != null) return 10 - set.rir;
            return 0;
          };
          const itemScore = getIntensity(item.set);
          const currentScore = getIntensity(currentBest.set);

          if (itemScore > currentScore) {
            bestByRep.set(reps, item);
          } else if (itemScore === currentScore) {
            if (
              item.workoutDate > currentBest.workoutDate ||
              (item.workoutDate === currentBest.workoutDate &&
                item.set.created_at > currentBest.set.created_at)
            ) {
              bestByRep.set(reps, item);
            }
          }
        }
      }
    }

    const sortedReps = Array.from(bestByRep.keys()).sort((a, b) => a - b);

    return sortedReps.map((r) => {
      const item = bestByRep.get(r)!;
      return {
        setId: item.set.id,
        workoutId: item.set.workout_id,
        exerciseId: item.set.exercise_id,
        reps: item.set.reps,
        weight: item.set.weight,
        rawInputWeight: item.set.raw_input_weight,
        rpe: item.set.rpe,
        rir: item.set.rir,
        workoutDate: item.workoutDate,
      };
    });
  }
}
