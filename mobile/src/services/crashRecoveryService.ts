import { discardWorkoutRecord } from './workoutDiscardService';
/**
 * Workout Suite — Crash Recovery Service
 *
 * Implements ADR-010: Write-Through Crash Recovery for Active Sessions
 *
 * Detects interrupted or abandoned in-progress workouts upon application launch.
 * Provides frictionless options to:
 * 1. Inspect recovery metadata (elapsed duration, completed sets, exercises)
 * 2. Resume the in-progress session exactly where the lifter left off
 * 3. Discard the interrupted session and permanently delete its sets
 */

import { Workout, WorkoutSet, WorkoutWithSets } from '../core/types';
import { IWorkoutRepository } from '../domain/repositories/IWorkoutRepository';
import { IUserSettingsRepository } from '../domain/repositories/IUserSettingsRepository';

// ============================================================================
// Service DTOs & Output Types
// ============================================================================

export interface CrashRecoverySummary {
  totalSets: number;
  completedSets: number;
  uniqueExercises: number;
  elapsedSeconds: number;
  formattedElapsedTime: string;
  lastActiveTimestamp: string;
}

export interface CrashRecoveryPromptData {
  workout: Workout;
  sets: WorkoutSet[];
  summary: CrashRecoverySummary;
}

/**
 * Formats elapsed seconds into human-readable duration (e.g., "45m", "1h 15m", "< 1m").
 */
function formatElapsedDuration(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return '< 1m';
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export class CrashRecoveryService {
  constructor(
    private readonly workoutRepo: IWorkoutRepository,
    private readonly userSettingsRepo?: IUserSettingsRepository
  ) {}

  /**
   * Checks whether an interrupted in-progress workout exists in SQLite.
   * If found, returns full workout details and summary statistics for prompt display.
   * If no workout is in progress, returns null.
   */
  public async checkForInterruptedWorkout(): Promise<CrashRecoveryPromptData | null> {
    const activeWorkout = await this.workoutRepo.getInProgressWorkout();
    if (!activeWorkout) {
      return null;
    }

    const sets = await this.workoutRepo.getSetsByWorkoutId(activeWorkout.id);

    const now = Date.now();
    const startTimeMs = new Date(activeWorkout.started_at).getTime();
    const elapsedSeconds = isNaN(startTimeMs)
      ? 0
      : Math.max(0, Math.round((now - startTimeMs) / 1000));

    // Determine latest activity timestamp
    let lastActiveTimestamp = activeWorkout.started_at;
    if (sets.length > 0) {
      const sortedByTime = [...sets].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      lastActiveTimestamp = sortedByTime[0].created_at;
    }

    const uniqueExercises = new Set(sets.map((s) => s.exercise_id)).size;

    let completedSets: number | null = null;
    if (this.userSettingsRepo) {
      try {
        const saved = await this.userSettingsRepo.get(`active_completed_set_ids_${activeWorkout.id}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            completedSets = parsed.length;
          }
        }
      } catch {
        // Fall back to heuristic filter below
      }
    }

    if (completedSets === null) {
      completedSets = sets.filter(
        (s) => s.reps > 0 && (s.weight > 0 || s.rpe != null || s.rir != null)
      ).length;
    }

    const summary: CrashRecoverySummary = {
      totalSets: sets.length,
      completedSets,
      uniqueExercises,
      elapsedSeconds,
      formattedElapsedTime: formatElapsedDuration(elapsedSeconds),
      lastActiveTimestamp,
    };

    return {
      workout: activeWorkout,
      sets,
      summary,
    };
  }

  /**
   * Resumes an interrupted workout session.
   * Verifies the session is valid and in_progress, then returns workout and sets.
   */
  public async resumeSession(workoutId: string): Promise<WorkoutWithSets> {
    const workout = await this.workoutRepo.findById(workoutId);
    if (!workout) {
      throw new Error(`Workout with ID '${workoutId}' not found for recovery.`);
    }

    if (workout.status !== 'in_progress') {
      throw new Error(
        `Workout with ID '${workoutId}' cannot be resumed (status is '${workout.status}').`
      );
    }

    const sets = await this.workoutRepo.getSetsByWorkoutId(workoutId);
    return {
      workout,
      sets,
    };
  }

  /**
   * Permanently discards an interrupted session; the return value is a receipt only.
   */
  public async discardSession(workoutId: string): Promise<Workout> {
    return discardWorkoutRecord(this.workoutRepo, workoutId, this.userSettingsRepo);
  }

  /**
   * Permanently deletes an interrupted session and cascades through all its sets.
   */
  public async deleteSession(workoutId: string): Promise<void> {
    await this.workoutRepo.delete(workoutId);
  }
}
