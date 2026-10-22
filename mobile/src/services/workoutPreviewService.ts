import { Exercise, WeightUnit, Workout, WorkoutSet, SetType, TemplateExercise, ProgressionProposal } from '../core/types';
import { WorkoutTemplateDetail } from '../domain/repositories/IProgramRepository';
import { IWorkoutRepository, IGearRepository } from '../domain/repositories';
import { evaluateProgressionRules } from '../core/rules/progressionRuleEngine';
import { formatWeight } from '../core/math/unitConversion';
import { AdaptationContext, TrainingAdaptationService } from './trainingAdaptationService';
import { normalizeExerciseGroups } from '../core/exerciseGroups';
import { executionSetTargets } from '../core/rules/sessionPlanning';

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
  summary: string;
  groupId: string | null;
  explanation: string;
  proposal: ProgressionProposal | null;
  templateExercise: TemplateExercise;
  bodyweightKg: number | null;
  sets: { rawInputWeight: number | null; reps: number; setType: SetType }[];
}

export interface WorkoutProgressionSummary {
  name: string;
  summary: string;
  explanation: string;
}

/** Freeze the next prescription in the workout that earned it, before block evolution. */
export async function captureWorkoutProgression(
  workoutId: string,
  template: WorkoutTemplateDetail,
  repo: IWorkoutRepository,
  catalog: Map<string, Exercise>,
  unit: WeightUnit,
  gearRepo?: IGearRepository,
  bodyweightKg?: number | null,
  context?: AdaptationContext,
): Promise<WorkoutProgressionSummary[]> {
  const key = `training_progression_summary_${workoutId}`;
  const saved = await context?.settings?.get(key);
  if (saved) return JSON.parse(saved) as WorkoutProgressionSummary[];
  const workout = await repo.getWorkoutWithSets(workoutId);
  if (!workout || workout.workout.status !== 'completed' || workout.workout.template_id !== template.id) return [];
  const plan = await buildWorkoutPreview(template, repo, catalog, unit, gearRepo, bodyweightKg, context);
  const changes = plan.filter(row => {
    const previous = workout.sets.filter(s => s.exercise_id === row.templateExercise.exercise_id &&
      s.gear_id === row.templateExercise.gear_id && s.set_type !== 'warmup' && s.reps > 0)
      .sort((a, b) => a.set_number - b.set_number);
    return previous.length > 0 && row.sets.some((set, index) =>
      set.rawInputWeight != null && set.rawInputWeight > (previous[index] ?? previous.at(-1))!.raw_input_weight + 0.001);
  }).map(row => ({ name: row.name, summary: row.summary,
    explanation: row.proposal?.explanation ?? row.explanation }));
  await context?.settings?.set(key, JSON.stringify(changes));
  return changes;
}

/** Avoid offering progression already loaded at template startup or recovery. */
export function matchesWorkoutPrescription(row: ExercisePrescription, sets: WorkoutSet[]): boolean {
  const te = row.templateExercise;
  const working = sets.filter(s => s.exercise_id === te.exercise_id && s.gear_id === te.gear_id &&
    s.set_type !== 'warmup').sort((a, b) => a.set_number - b.set_number);
  return working.length === row.sets.length && working.every((s, i) =>
    Math.abs(s.raw_input_weight - (row.sets[i].rawInputWeight ?? 0)) < 0.001 &&
    s.reps === row.sets[i].reps && s.set_type === row.sets[i].setType);
}

export async function buildWorkoutPreview(
  template: WorkoutTemplateDetail,
  repo: IWorkoutRepository,
  catalog: Map<string, Exercise>,
  unit: WeightUnit,
  gearRepo?: IGearRepository,
  bodyweightKg?: number | null,
  adaptationContext?: AdaptationContext,
): Promise<ExercisePrescription[]> {
  const adaptation = adaptationContext?.settings ? new TrainingAdaptationService(repo, adaptationContext) : null;
  template = await adaptation?.resolve(template, catalog) ?? template;
  template = { ...template, exercises: normalizeExerciseGroups(template.exercises) };
  const adaptationState = template.program_id ? await adaptation?.state(template.program_id) : null;
  const recovery = Boolean(adaptationState?.deload);
  const completed = new Map((await repo.findAll({ status: 'completed' })).map(w => [w.id, w]));
  const sessionOrder = (id: string) => { const w = completed.get(id); return w ? `${w.date}:${w.started_at}` : ''; };
  return Promise.all([...template.exercises].sort((a, b) => a.order_index - b.order_index).map(async te => {
    const exercise = catalog.get(te.exercise_id);
    const history = (await repo.getHistoricalSetsForExercise(te.exercise_id, { onlyCompletedWorkouts: true }))
      .filter(s => s.gear_id === te.gear_id).sort((a, b) => sessionOrder(a.workout_id).localeCompare(sessionOrder(b.workout_id)) || a.set_number - b.set_number);
    const groups = new Map<string, WorkoutSet[]>();
    for (const set of history) {
      const group = groups.get(set.workout_id) ?? [];
      if (!te.rest_pause || set.set_type === 'working') group.push(set);
      groups.set(set.workout_id, group);
    }
    const sessions = Array.from(groups, ([id, sets]) => ({ id, date: completed.get(id)?.date ?? sets[0]?.created_at.split('T')[0] ?? '', sets }));
    // Session policy owns resets and recovery; legacy plateau rules must not race it.
    const rules = adaptation ? te.rules.filter(rule => {
      const json = typeof rule.rule_json === 'string' ? rule.rule_json : JSON.stringify(rule.rule_json);
      return !/RESET_WEIGHT_PERCENT|TRIGGER_DELOAD|DECREASE_LOAD_FIXED/.test(json);
    }) : te.rules;
    const proposal = !recovery && rules.length ? evaluateProgressionRules(rules, sessions, te).primaryProposal : null;
    const prescribedLoad = await adaptation?.loadFor(te, history, template.program_id, recovery);
    const lastId = history.at(-1)?.workout_id;
    const last = history.filter(s => s.workout_id === lastId && (te.rest_pause ? s.set_type === 'working' : s.set_type !== 'warmup') && s.reps > 0)
      .sort((a, b) => a.set_number - b.set_number);
    const min = proposal?.suggestedTargetReps ?? te.target_reps_min ?? 8;
    const max = proposal?.suggestedTargetReps ?? te.target_reps_max ?? min;
    const count = proposal?.suggestedTargetSets ?? te.target_sets ?? 3;
    const returning = adaptationState?.pain[te.exercise_id];
    const useRuleLoad = !returning && !recovery && (proposal?.setProposals?.some(set => set.suggestedWeightKg != null) ||
      (proposal?.suggestedWeightKg != null && proposal.suggestedWeightKg !== proposal.currentWeightKg));
    const effort = returning ? ' · easy return; stop for discomfort' : te.target_rpe != null ? ` · RPE ${te.target_rpe}` : te.target_rir != null ? ` · ${te.target_rir} RIR` : '';
    const gear = te.gear_id ? await gearRepo?.findById(te.gear_id) : null;
    const ratio = gear?.cable_ratio ?? exercise?.default_cable_ratio ?? 1;
    const multiplier = (exercise?.load_mode === 'per_hand' ? 2 : 1) * (ratio > 0 ? ratio : 1);
    const previousBodyweight = last.find(s => s.weight > 0);
    const resolvedBodyweight = bodyweightKg ?? (previousBodyweight && exercise?.is_bodyweight
      ? previousBodyweight.weight - (previousBodyweight.added_weight ?? previousBodyweight.raw_input_weight) : null);
    const targets = executionSetTargets({ ...te, target_sets: count, target_reps_min: min, target_reps_max: max });
    const sets = targets.map((phase, index) => {
      const activationIndex = te.rest_pause ? Math.floor(index / (te.rest_pause.mini_sets + 1)) : index;
      const previous = last[activationIndex] ?? last.at(-1);
      // Historical set numbers can include warmups; pair working sets by order.
      const individual = proposal?.setProposals?.[activationIndex];
      const effective = individual?.suggestedWeightKg ?? (proposal?.setProposals?.length ||
        proposal?.suggestedWeightKg === proposal?.currentWeightKg ? undefined : proposal?.suggestedWeightKg);
      let raw: number | null = previous?.raw_input_weight ?? (exercise?.is_bodyweight ? 0 : null);
      // Earned rule-based progression takes precedence over an estimated starting load.
      const resolvedEffective = useRuleLoad ? effective ?? prescribedLoad : prescribedLoad ?? effective;
      if (resolvedEffective != null && Number.isFinite(resolvedEffective) && resolvedEffective > 0) {
        raw = exercise?.is_bodyweight
          ? (resolvedBodyweight != null ? resolvedEffective - resolvedBodyweight : raw)
          : resolvedEffective / multiplier;
        if ((!useRuleLoad || effective == null) && prescribedLoad != null && raw != null) raw = Math.floor((raw + 1e-9) / 0.5) * 0.5;
      }
      if (!exercise?.is_bodyweight && raw === 0) raw = null;
      return { rawInputWeight: raw != null && Number.isFinite(raw) ? raw : null, reps: phase.repsMin,
        setType: te.rest_pause ? (phase.mini ? te.set_type ?? 'myorep' : 'working') : proposal?.suggestedSetType ?? te.set_type ?? 'working' as SetType };
    });
    const formatLoad = (raw: number | null) => {
      if (raw == null) return '–';
      if (exercise?.is_bodyweight) return raw === 0 ? 'Bodyweight' : raw < 0
        ? `${formatWeight(-raw, unit)} assistance` : `Bodyweight + ${formatWeight(raw, unit)}`;
      return formatWeight(raw, unit);
    };
    const reps = `${min}${max !== min ? `–${max}` : ''}`;
    const uniform = sets.every(s => s.rawInputWeight === sets[0]?.rawInputWeight);
    const load = uniform ? formatLoad(sets[0]?.rawInputWeight ?? null) : sets.map(s => formatLoad(s.rawInputWeight)).join(', ');
    const target = `${count} × ${reps}` + (te.rest_pause ? `${count > 1 ? ' each' : ''} + ${te.rest_pause.mini_sets} × ${te.rest_pause.mini_reps_min}–${te.rest_pause.mini_reps_max} mini (${te.set_type})` : '');
    const rest = te.rest_pause ? ` · ${te.rest_pause.rest_seconds}s between efforts` : te.rest_seconds != null ? ` · rest ${te.rest_seconds}s${te.exercise_group_id ? '/round' : ''}` : '';
    const summary = (uniform ? `${target} · ${load}` : sets.map(s => `${reps} × ${formatLoad(s.rawInputWeight)}`).join(', ')) + effort + rest;
    return { id: te.id, name: exercise?.name ?? te.exercise_id, target, load, summary,
      groupId: te.exercise_group_id, explanation: returning ? 'Pain recovery: start at half estimated 1RM, or half the last working load if no estimate is available. Rebuild gradually; stop remaining sets for discomfort.' :
        recovery ? 'Recovery session: easier effort, progression paused.' :
        useRuleLoad ? proposal?.explanation ?? '' : prescribedLoad != null ? 'Load estimated for the prescribed reps and effort using recent performance and the exercise curve.' : proposal?.explanation ?? '',
      proposal: useRuleLoad || prescribedLoad == null ? proposal : null, templateExercise: te,
      bodyweightKg: resolvedBodyweight, sets };
  }));
}
