import { Workout } from '../core/types';
import { IWorkoutRepository } from '../domain/repositories/IWorkoutRepository';
import { IUserSettingsRepository } from '../domain/repositories/IUserSettingsRepository';

/** Return a receipt for existing callers, but retain no discarded workout or sets. */
export async function discardWorkoutRecord(
  workoutRepo: IWorkoutRepository,
  workoutId: string,
  settingsRepo?: IUserSettingsRepository,
): Promise<Workout> {
  const workout = await workoutRepo.findById(workoutId);
  if (!workout) throw new Error(`Workout with ID '${workoutId}' not found.`);
  if (workout.status === 'completed') {
    throw new Error('Completed workouts cannot be discarded. Delete them from session history instead.');
  }
  await workoutRepo.delete(workoutId);
  await settingsRepo?.delete(`active_completed_set_ids_${workoutId}`).catch(() => {});
  return { ...workout, status: 'discarded', completed_at: new Date().toISOString() };
}

/** Clean up records retained by older app versions, preserving real sessions. */
export async function removeDiscardedWorkouts(
  workoutRepo: IWorkoutRepository,
  settingsRepo?: IUserSettingsRepository,
): Promise<number> {
  const discarded = await workoutRepo.findAll({ status: 'discarded' });
  let removed = 0;
  for (const workout of discarded) {
    if (workout.status !== 'discarded') continue;
    await discardWorkoutRecord(workoutRepo, workout.id, settingsRepo);
    removed++;
  }
  return removed;
}
