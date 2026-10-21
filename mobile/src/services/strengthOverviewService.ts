import { BodyMetric, Exercise, Gender, Workout, WorkoutSet } from '../core/types';
import { calculateHeuristic1RM } from '../core/math/heuristic1rm';
import { calculateDotsScore } from '../core/math/dotsCoefficients';
import { isPerformedWorkingSet } from './trainingOverviewService';

export interface StrengthSnapshot {
  date: string;
  squat: number;
  bench: number;
  deadlift: number;
  total: number;
  dots: number | null;
  bodyweight: number | null;
}

/** Best estimated strength to date for the same canonical lifts used by inspection. */
export function buildStrengthTimeline(workouts: Workout[], sets: WorkoutSet[], exercises: Exercise[], metrics: BodyMetric[], gender: Gender): StrengthSnapshot[] {
  const liftIds = new Map<string, 'squat' | 'bench' | 'deadlift'>();
  for (const lift of ['squat', 'bench', 'deadlift'] as const) {
    const exercise = exercises.find(ex => ex.standard_lift_type === lift && !ex.parent_exercise_id) ?? exercises.find(ex => ex.standard_lift_type === lift);
    if (exercise) liftIds.set(exercise.id, lift);
  }
  const dates = new Map(workouts.filter(w => w.status === 'completed').map(w => [w.id, w.date]));
  const byDate = new Map<string, WorkoutSet[]>();
  for (const set of sets) {
    const date = dates.get(set.workout_id);
    if (!date || !liftIds.has(set.exercise_id) || !isPerformedWorkingSet(set) || !Number.isFinite(set.weight) || set.weight <= 0) continue;
    const group = byDate.get(date) ?? [];
    group.push(set); byDate.set(date, group);
  }
  const bodyweights = metrics.filter(m => m.bodyweight != null && m.bodyweight > 0).sort((a, b) => a.date.localeCompare(b.date));
  const best = { squat: 0, bench: 0, deadlift: 0 };
  return [...byDate.keys()].sort().map(date => {
    for (const set of byDate.get(date)!) {
      const lift = liftIds.get(set.exercise_id)!;
      best[lift] = Math.max(best[lift], calculateHeuristic1RM(set.weight, set.reps, { rpe: set.rpe, rir: set.rir }));
    }
    const bodyweight = bodyweights.filter(m => m.date <= date).at(-1)?.bodyweight ?? null;
    const total = best.squat + best.bench + best.deadlift;
    return { date, ...best, total, bodyweight, dots: bodyweight && best.squat && best.bench && best.deadlift ? calculateDotsScore(gender, bodyweight, total) : null };
  });
}
