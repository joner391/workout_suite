import { Exercise, WeightUnit, Workout, WorkoutSet } from '../core/types';
import { WorkoutTemplateDetail } from '../domain/repositories/IProgramRepository';
import { IWorkoutRepository } from '../domain/repositories';
import { evaluateProgressionRules } from '../core/rules/progressionRuleEngine';
import { formatWeight } from '../core/math/unitConversion';

/** Shared by Home and Workout; don't truncate history before finding the last matching session. */
export function selectNextTemplate(templates: WorkoutTemplateDetail[], workouts: Workout[]): WorkoutTemplateDetail | null {
  const ordered = [...templates].sort((a, b) => a.order_index - b.order_index);
  const ids = new Set(ordered.map(t => t.id));
  const latest = workouts.filter(w => w.status === 'completed' && w.template_id && ids.has(w.template_id))
    .sort((a, b) => b.date.localeCompare(a.date) || b.started_at.localeCompare(a.started_at))[0];
  const index = latest ? ordered.findIndex(t => t.id === latest.template_id) : -1;
  return ordered.length ? ordered[(index + 1) % ordered.length] : null;
}

export interface ExercisePrescription {
  id: string;
  name: string;
  target: string;
  load: string;
}

export async function buildWorkoutPreview(
  template: WorkoutTemplateDetail,
  repo: IWorkoutRepository,
  catalog: Map<string, Exercise>,
  unit: WeightUnit,
): Promise<ExercisePrescription[]> {
  return Promise.all([...template.exercises].sort((a, b) => a.order_index - b.order_index).map(async te => {
    const exercise = catalog.get(te.exercise_id);
    const history = await repo.getHistoricalSetsForExercise(te.exercise_id, { onlyCompletedWorkouts: true });
    const groups = new Map<string, WorkoutSet[]>();
    for (const set of history) {
      const group = groups.get(set.workout_id) ?? [];
      group.push(set);
      groups.set(set.workout_id, group);
    }
    const sessions = Array.from(groups, ([id, sets]) => ({ id, date: sets[0]?.created_at.split('T')[0] ?? '', sets }));
    const proposal = te.rules.length ? evaluateProgressionRules(te.rules, sessions, te).primaryProposal : null;
    const last = (await repo.getMostRecentCompletedSetsForExercise(te.exercise_id))
      .filter(s => s.set_type !== 'warmup' && s.reps > 0 && s.gear_id === te.gear_id);
    const min = proposal?.suggestedTargetReps ?? te.target_reps_min ?? 8;
    const max = proposal?.suggestedTargetReps ?? te.target_reps_max ?? min;
    const sets = proposal?.suggestedTargetSets ?? te.target_sets ?? 3;
    const effort = te.target_rpe != null ? ` · RPE ${te.target_rpe}` : te.target_rir != null ? ` · ${te.target_rir} RIR` : '';
    // Progression weights are effective loads. Label them explicitly instead of
    // misrepresenting cable, per-hand, assisted, or bodyweight input loads.
    const proposed = proposal?.setProposals?.map(p => p.suggestedWeightKg) ??
      (proposal?.suggestedWeightKg != null ? [proposal.suggestedWeightKg] : []);
    let load = 'Set load in workout';
    if (proposed.length && proposed.every(w => Number.isFinite(w) && w >= 0)) {
      const low = Math.min(...proposed), high = Math.max(...proposed);
      load = `Suggested ${formatWeight(low, unit)}${high !== low ? `–${formatWeight(high, unit)}` : ''}`;
      if (exercise?.load_mode !== 'total' || exercise?.is_bodyweight) load += ' effective';
    } else if (last.length) {
      const weights = last.map(s => s.raw_input_weight);
      const low = Math.min(...weights), high = Math.max(...weights);
      load = `Last ${formatWeight(low, unit)}${high !== low ? `–${formatWeight(high, unit)}` : ''}`;
      if (exercise?.load_mode === 'per_hand') load += ' / hand';
    }
    return { id: te.id, name: exercise?.name ?? te.exercise_id, target: `${sets} × ${min}${max !== min ? `–${max}` : ''}${effort}${te.exercise_group_id ? ' · Superset' : ''}${proposal ? ' · suggested' : ''}`, load };
  }));
}
