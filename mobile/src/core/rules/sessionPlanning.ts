import { Exercise, TemplateExercise, SetType } from '../types';

export function executionRestSeconds(te: TemplateExercise | undefined, exercise: Exercise | undefined, setType: SetType, clusterComplete = false): number {
  if (setType === 'warmup') return prescribedRestSeconds(te, exercise);
  if (te?.rest_pause && clusterComplete) return prescribedRestSeconds(te, exercise);
  if (te?.rest_pause) return te.rest_pause.rest_seconds;
  return setType === 'myorep' ? 10 : setType === 'dc' ? 30 : prescribedRestSeconds(te, exercise);
}

/** Activation and mini-set rows share one load; progression evaluates activations separately. */
export function executionSetTargets(te: TemplateExercise): { repsMin: number; repsMax: number; mini: boolean }[] {
  return Array.from({ length: te.target_sets ?? 3 }, () => [
    { repsMin: te.target_reps_min ?? 8, repsMax: te.target_reps_max ?? 12, mini: false },
    ...Array.from({ length: te.rest_pause?.mini_sets ?? 0 }, () => ({
      repsMin: te.rest_pause!.mini_reps_min, repsMax: te.rest_pause!.mini_reps_max, mini: true,
    })),
  ]).flat();
}

export function prescribedRestSeconds(te: TemplateExercise | undefined, exercise?: Exercise): number {
  return te?.rest_seconds ?? exercise?.default_rest_seconds ?? 90;
}

/** Scheduling allowance, not a stopwatch prediction. Includes setup and lift-specific ramp-up. */
export function estimateSessionMinutes(rows: TemplateExercise[], catalog: Map<string, Exercise>): number {
  if (!rows.length) return 0;
  let seconds = 300;
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.exercise_group_id ?? row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = row.exercise_group_id ? rows.filter(te => te.exercise_group_id === key) : [row];
    for (const te of group) {
      const exercise = catalog.get(te.exercise_id);
      seconds += 60; // station setup / transition
      if (exercise?.is_compound) seconds += ['squat', 'deadlift', 'bench'].includes(exercise.standard_lift_type ?? '') ? 180 : 90;
    }
    const rounds = Math.max(...group.map(te => te.target_sets ?? 3));
    for (let round = 0; round < rounds; round++) {
      const active = group.filter(te => (te.target_sets ?? 3) > round);
      for (const te of active) {
        const exercise = catalog.get(te.exercise_id);
        const unilateral = exercise?.is_unilateral ? 2 : 1;
        // Legacy cluster tags have no mini-set prescription. Do not pretend one tag is a 90s protocol.
        const clusterAllowance = te.rest_pause
          ? te.rest_pause.mini_sets * (te.rest_pause.mini_reps_max * 3 * unilateral + te.rest_pause.rest_seconds)
          : te.set_type === 'myorep' || te.set_type === 'dc' ? 60 : 0;
        seconds += (te.target_reps_max ?? 12) * 3 * unilateral + clusterAllowance;
      }
      if (round + 1 < rounds) seconds += Math.max(...active.map(te => prescribedRestSeconds(te, catalog.get(te.exercise_id))));
    }
  }
  return seconds / 60;
}
