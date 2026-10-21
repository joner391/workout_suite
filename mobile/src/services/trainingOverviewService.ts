import { Workout, WorkoutSet } from '../core/types';
import { IWorkoutRepository } from '../domain/repositories';

/** Calendar dates in the device's local timezone, including across DST changes. */
export function localTrainingDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export interface TrainingRecord {
  exerciseId: string;
  workoutId: string;
  date: string;
  reps: number;
  weightKg: number;
}

export interface TrainingOverview {
  days: { date: string; sessions: number }[];
  sessions: { workout: Workout; workingSets: number; exerciseCount: number }[];
  workingSets: number;
  previousSessions: number;
  previousWorkingSets: number;
  records: TrainingRecord[];
}

export function isPerformedWorkingSet(set: WorkoutSet): boolean {
  return set.set_type !== 'warmup' && Number.isFinite(set.reps) && set.reps > 0;
}

export async function loadTrainingOverview(
  repo: IWorkoutRepository,
  period: 7 | 14,
  now = new Date(),
): Promise<TrainingOverview> {
  const dates = Array.from({ length: period * 2 }, (_, i) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (period * 2 - 1 - i));
    return localTrainingDate(date);
  });
  const today = dates[dates.length - 1];
  const start = dates[period];
  const workouts = (await repo.findAll({ status: 'completed', endDate: today }))
    .filter(w => w.status === 'completed' && w.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id));
  // One batch also supplies the historical baseline needed to recognize new records.
  const sets = workouts.length ? await repo.getSetsByWorkoutIds(workouts.map(w => w.id)) : [];
  const byWorkout = new Map<string, WorkoutSet[]>();
  for (const set of sets.filter(isPerformedWorkingSet)) {
    const group = byWorkout.get(set.workout_id) ?? [];
    group.push(set);
    byWorkout.set(set.workout_id, group);
  }
  const best = new Map<string, number>();
  const records: TrainingRecord[] = [];
  for (const workout of workouts) {
    // Collapse repeated sets in a session into one record per exercise/gear/rep count.
    const sessionBest = new Map<string, WorkoutSet>();
    for (const set of byWorkout.get(workout.id) ?? []) {
      if (!Number.isFinite(set.weight) || set.weight <= 0) continue;
      const key = `${set.exercise_id}:${set.gear_id ?? ''}:${set.reps}`;
      if (!sessionBest.has(key) || set.weight > sessionBest.get(key)!.weight) sessionBest.set(key, set);
    }
    for (const [key, set] of sessionBest) {
      const prior = best.get(key);
      if (workout.date >= start && prior !== undefined && set.weight > prior) {
        records.push({ exerciseId: set.exercise_id, workoutId: workout.id, date: workout.date, reps: set.reps, weightKg: set.weight });
      }
      best.set(key, Math.max(prior ?? 0, set.weight));
    }
  }
  const recent = workouts.filter(w => w.date >= start).reverse();
  const previous = workouts.filter(w => w.date >= dates[0] && w.date < start);
  return {
    days: dates.slice(period).map(date => ({ date, sessions: recent.filter(w => w.date === date).length })),
    sessions: recent.map(workout => {
      const working = byWorkout.get(workout.id) ?? [];
      return { workout, workingSets: working.length, exerciseCount: new Set(working.map(s => s.exercise_id)).size };
    }),
    workingSets: recent.reduce((total, w) => total + (byWorkout.get(w.id)?.length ?? 0), 0),
    previousSessions: previous.length,
    previousWorkingSets: previous.reduce((total, w) => total + (byWorkout.get(w.id)?.length ?? 0), 0),
    records: records.reverse(),
  };
}
