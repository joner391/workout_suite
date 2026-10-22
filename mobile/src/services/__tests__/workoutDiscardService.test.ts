import { discardWorkoutRecord, removeDiscardedWorkouts } from '../workoutDiscardService';
import { MockWorkoutRepository, MockUserSettingsRepository } from '../../database/mocks';
import { Workout, WorkoutSet } from '../../core/types';

function workout(id: string, status: Workout['status']): Workout {
  return { id, status, name: id, template_id: null, date: '2026-10-21', started_at: '2026-10-21T10:00:00Z', completed_at: null, notes: null, duration_seconds: null, imported_from: null };
}
function set(workoutId: string): WorkoutSet {
  return { id: `set-${workoutId}`, workout_id: workoutId, exercise_id: 'squat', gear_id: null, set_number: 1, weight: 100, raw_input_weight: 100, added_weight: null, reps: 5, reps_right: null, rpe: 8, rir: null, set_type: 'working', set_notes: null, exercise_group_id: null, created_at: '2026-10-21T10:00:00Z' };
}

test('startup cleanup removes only discarded workouts, their sets and saved completion state', async () => {
  const repo = new MockWorkoutRepository([
    workout('discarded', 'discarded'), workout('completed', 'completed'), workout('active', 'in_progress'),
  ], ['discarded', 'completed', 'active'].map(set));
  const settings = new MockUserSettingsRepository();
  await settings.set('active_completed_set_ids_discarded', '["set-discarded"]');
  await settings.set('active_completed_set_ids_active', '["set-active"]');

  expect(await removeDiscardedWorkouts(repo, settings)).toBe(1);
  expect(await repo.findById('discarded')).toBeNull();
  expect(await repo.getSetsByWorkoutId('discarded')).toEqual([]);
  expect(await settings.get('active_completed_set_ids_discarded')).toBeNull();
  expect((await repo.findAll()).map(w => w.id).sort()).toEqual(['active', 'completed']);
  expect(await repo.getSetsByWorkoutIds(['active', 'completed'])).toHaveLength(2);
  expect(await settings.get('active_completed_set_ids_active')).toBe('["set-active"]');
  expect(await removeDiscardedWorkouts(repo, settings)).toBe(0);
});

test('discard cannot delete a completed workout or its sets', async () => {
  const repo = new MockWorkoutRepository([workout('completed', 'completed')], [set('completed')]);
  await expect(discardWorkoutRecord(repo, 'completed')).rejects.toThrow('Completed workouts cannot be discarded');
  expect(await repo.findById('completed')).not.toBeNull();
  expect(await repo.getSetsByWorkoutId('completed')).toHaveLength(1);
});

test('discarding a missing session reports the error without deleting other work', async () => {
  const repo = new MockWorkoutRepository([workout('active', 'in_progress')]);
  await expect(discardWorkoutRecord(repo, 'missing')).rejects.toThrow('not found');
  expect(await repo.getInProgressWorkout()).not.toBeNull();
});
