import { Exercise, ExperienceLevel, TemplateExercise, UserProfile, WorkoutTemplate } from '../types';
import { estimateSessionMinutes } from '../rules/sessionPlanning';
import { exerciseAvailable } from '../rules/trainingAdaptation';
import { CandidateScoringContext, computeCandidateScore } from './candidateScorer';
import { ExercisePreference } from '../types';

/** Initial programming defaults, not universal biological minimums or fixed eRep equivalences. */
export function weeklyVolumeTargets(experience: ExperienceLevel): Record<string, number> {
  const big = experience === 'advanced' ? 16 : experience === 'beginner' ? 6 : 10;
  const arms = experience === 'advanced' ? 12 : experience === 'beginner' ? 4 : 6;
  return { Chest: big, Back: big, Quads: big, Hamstrings: big - 2,
    Shoulders: big - 2, Glutes: big - 2, Biceps: arms, Triceps: arms,
    Calves: experience === 'advanced' ? 10 : arms, Abs: experience === 'advanced' ? 8 : experience === 'beginner' ? 4 : 6 };
}

/** Conservative estimated stimulating reps; mini-sets are never presented as ordinary full sets. */
export function weeklyMuscleEReps(rows: TemplateExercise[], catalog: Map<string, Exercise>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const ex = catalog.get(row.exercise_id);
    if (!ex) continue;
    const rir = row.target_rir ?? 10 - (row.target_rpe ?? 8);
    const perSet = Math.max(0, Math.min(5, 5 - rir, row.target_reps_min ?? 8));
    const extra = row.rest_pause ? row.rest_pause.mini_sets * Math.min(perSet, row.rest_pause.mini_reps_min) : 0;
    for (const [muscle, credit] of Object.entries(exerciseMuscleCredits(ex))) {
      totals[muscle] = (totals[muscle] ?? 0) + (row.target_sets ?? 3) * credit * (perSet + extra);
    }
  }
  return totals;
}

export function weeklyMiniSetCounts(rows: TemplateExercise[], catalog: Map<string, Exercise>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const ex = catalog.get(row.exercise_id);
    if (!ex || !row.rest_pause) continue;
    for (const [muscle, credit] of Object.entries(exerciseMuscleCredits(ex))) {
      totals[muscle] = (totals[muscle] ?? 0) + (row.target_sets ?? 1) * row.rest_pause.mini_sets * credit;
    }
  }
  return totals;
}

function planningDose(rows: TemplateExercise[], catalog: Map<string, Exercise>): Record<string, number> {
  // Ordinary sets retain their full volume target irrespective of mood. Only compressed
  // protocols use conservative eRep estimates against a reference of 3 stimulating reps.
  const totals = weeklyMuscleSets(rows.filter(te => !te.rest_pause), catalog);
  for (const [muscle, reps] of Object.entries(weeklyMuscleEReps(rows.filter(te => te.rest_pause), catalog))) totals[muscle] = (totals[muscle] ?? 0) + reps / 3;
  return totals;
}

function highAxialOrHeavyHinge(ex: Exercise): boolean {
  return ex.axial_loading === 'high' || ['squat', 'deadlift'].includes(ex.standard_lift_type ?? '') || /\bsquat\b|deadlift|\brdl\b/i.test(ex.name);
}

export function restPauseEligible(ex: Exercise): boolean {
  return !highAxialOrHeavyHinge(ex) && ex.axial_loading != null;
}

/** Count actual resolved movements. Arms/core retain explicit direct-work targets. */
export function exerciseMuscleCredits(ex: Exercise): Record<string, number> {
  const result: Record<string, number> = { [ex.muscle_group]: 1 };
  if (/hammer curl/i.test(ex.name)) result.Biceps = 1;
  if (ex.standard_lift_type === 'deadlift') {
    delete result.Back;
    result.Hamstrings = 1;
    result.Glutes = 1;
  } else if (ex.secondary_muscles?.includes('Glutes')) result.Glutes = 0.5;
  return result;
}

export function weeklyMuscleSets(rows: TemplateExercise[], catalog: Map<string, Exercise>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const ex = catalog.get(row.exercise_id);
    if (!ex) continue;
    for (const [muscle, credit] of Object.entries(exerciseMuscleCredits(ex))) {
      totals[muscle] = (totals[muscle] ?? 0) + (row.target_sets ?? 3) * credit;
    }
  }
  return totals;
}

function canPair(a: Exercise | undefined, b: Exercise | undefined): boolean {
  if (!a || !b || a.id === b.id || highAxialOrHeavyHinge(a) || highAxialOrHeavyHinge(b)) return false;
  const pair = [a.muscle_group, b.muscle_group].sort().join('/');
  return ['Back/Chest', 'Back/Shoulders', 'Biceps/Triceps', 'Abs/Calves', 'Hamstrings/Quads', 'Abs/Shoulders', 'Calves/Glutes'].includes(pair);
}

/** Preserve strength recovery. Compression always changes the actual stored prescription. */
export function fitSessionToBudget(
  input: TemplateExercise[], profile: UserProfile, catalog: Map<string, Exercise>, protectedIds = new Set<string>()
): TemplateExercise[] {
  const rows = input.map(te => ({ ...te }));
  const strength = profile.primary_goal === 'strength' || profile.secondary_goals?.includes('strength');
  const hypertrophy = profile.primary_goal === 'hypertrophy' || profile.secondary_goals?.includes('hypertrophy');
  const protectedRow = (te: TemplateExercise) => protectedIds.has(te.id) || Boolean(strength && catalog.get(te.exercise_id)?.is_compound);
  for (const te of rows) {
    if (!te.exercise_group_id) continue;
    const group = rows.filter(row => row.exercise_group_id === te.exercise_group_id);
    if (new Set(group.map(row => row.exercise_id)).size < 2 || group.some(protectedRow) ||
        group.some(row => row.rest_pause != null)) {
      for (const member of group) member.exercise_group_id = null;
    }
  }
  const budget = profile.preferred_session_duration_mins || 60;
  const shouldCompress = estimateSessionMinutes(rows, catalog) > budget || profile.training_mentality === 'get_out';
  if (!shouldCompress) return rows;
  // Pair only equal set counts so every round follows the same prescribed rest policy.
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].exercise_group_id || protectedRow(rows[i]) || rows[i].rest_pause) continue;
    const j = rows.findIndex((te, idx) => idx > i && !te.exercise_group_id && !protectedRow(te) &&
      !te.rest_pause && canPair(catalog.get(rows[i].exercise_id), catalog.get(te.exercise_id)));
    if (j < 0) continue;
    const id = `ss-${rows[i].id}-${rows[j].id}`;
    rows[i].exercise_group_id = id;
    rows[j].exercise_group_id = id;
  }
  if (hypertrophy && estimateSessionMinutes(rows, catalog) > budget) {
    for (const te of rows) {
      if (protectedRow(te)) continue;
      te.rest_seconds = catalog.get(te.exercise_id)?.is_compound ? 90 : 45;
    }
  }
  if (hypertrophy && estimateSessionMinutes(rows, catalog) > budget) {
    for (const te of [...rows].reverse()) {
      if (te.exercise_group_id || protectedRow(te) || te.rest_pause || (te.target_sets ?? 2) < 2) continue;
      const ex = catalog.get(te.exercise_id);
      if (!ex || !restPauseEligible(ex) || profile.experience_level === 'beginner') continue;
      const before = { ...te };
      const duration = estimateSessionMinutes(rows, catalog);
      te.target_sets = 1;
      te.set_type = ex.is_compound ? 'dc' : 'myorep';
      te.target_reps_min = ex.is_compound ? 8 : 12;
      te.target_reps_max = ex.is_compound ? 12 : 15;
      te.target_rir = 1; te.target_rpe = 9;
      te.rest_pause = { mini_sets: ex.is_compound ? 2 : 3, mini_reps_min: 3, mini_reps_max: 5,
        rest_seconds: ex.is_compound ? 30 : 15 };
      if (estimateSessionMinutes(rows, catalog) >= duration) Object.assign(te, before, { rest_pause: before.rest_pause ?? null });
      if (estimateSessionMinutes(rows, catalog) <= budget) break;
    }
  }
  return rows;
}

interface Selection { preferences?: Map<string, ExercisePreference>; scoringContext?: CandidateScoringContext }

export function distributeExerciseWork(input: TemplateExercise[], profile: UserProfile, catalog: Map<string, Exercise>, protectedIds: Set<string>, selection: Selection = {}): TemplateExercise[] {
  const rows = input.map(te => ({ ...te }));
  const limit = profile.training_mentality === 'fury' ? 3 : 5;
  for (const te of [...rows]) {
    if ((te.target_sets ?? 2) <= limit || te.rest_pause) continue;
    const original = catalog.get(te.exercise_id)!;
    const muscle = original.standard_lift_type === 'deadlift' ? 'Hamstrings' : original.muscle_group;
    const candidates = [...catalog.values()].filter(ex => ex.muscle_group === muscle &&
      exerciseAvailable(ex, profile.equipment_access) && !rows.some(row => row.template_id === te.template_id && row.exercise_id === ex.id) &&
      !['disliked', 'blacklisted'].includes(selection.preferences?.get(ex.id)?.sentiment ?? '') &&
      !computeCandidateScore(ex, { ...selection.scoringContext, preference: selection.preferences?.get(ex.id) }).isExcluded);
    candidates.sort((a, b) => {
      const rank = (ex: Exercise) => computeCandidateScore(ex, { ...selection.scoringContext, preference: selection.preferences?.get(ex.id) }).score +
        (original.is_compound && !ex.is_compound ? 50 : 0);
      return rank(b) - rank(a) || a.id.localeCompare(b.id);
    });
    const variant = candidates[0];
    if (!variant) continue;
    const amount = te.target_sets!;
    te.target_sets = protectedIds.has(te.id) ? limit : Math.ceil(amount / 2);
    rows.push({ ...te, id: `${te.id}-variation-${variant.id}`, exercise_id: variant.id, gear_id: null,
      target_sets: Math.max(2, amount - te.target_sets), target_reps_min: variant.is_compound ? 8 : 10,
      target_reps_max: variant.is_compound ? 12 : 15, target_rir: variant.is_compound ? 2 : 1,
      target_rpe: variant.is_compound ? 8 : 9, exercise_group_id: null,
      rest_seconds: variant.default_rest_seconds, order_index: te.order_index + 0.1 });
  }
  return rows;
}

export function planProgramVolume(
  profile: UserProfile, templates: WorkoutTemplate[], input: TemplateExercise[], catalog: Map<string, Exercise>,
  protectedIds: Set<string>, selection: Selection = {}
): { rows: TemplateExercise[]; minutes: number[]; coverage: Record<string, number>; warnings: string[] } {
  let rows: TemplateExercise[] = input.map(te => ({ ...te, exercise_group_id: null as string | null,
    rest_seconds: catalog.get(te.exercise_id)?.default_rest_seconds ?? 90 }));
  const hypertrophy = profile.primary_goal === 'hypertrophy' || profile.secondary_goals?.includes('hypertrophy');
  const targets = hypertrophy ? weeklyVolumeTargets(profile.experience_level ?? 'intermediate') : {};
  // Reserve direct arms/core before filling redundant compound work. These must not
  // depend on spare minutes left after every chest/quad variation is prescribed.
  for (const muscle of ['Biceps', 'Triceps', 'Abs']) {
    if (!targets[muscle]) continue;
    const directRows = rows.filter(te => (exerciseMuscleCredits(catalog.get(te.exercise_id)!)[muscle] ?? 0) >= 1);
    for (const te of directRows) te.target_sets = Math.max(te.target_sets ?? 2,
      Math.min(5, Math.ceil(targets[muscle] / directRows.length)));
  }
  rows = distributeExerciseWork(rows, profile, catalog, protectedIds, selection);
  const budget = profile.preferred_session_duration_mins || 60;
  const fit = (templateId: string, candidates: TemplateExercise[]) =>
    fitSessionToBudget(candidates.filter(te => te.template_id === templateId), profile, catalog, protectedIds);
  const replaceDay = (templateId: string, day: TemplateExercise[]) => {
    rows = rows.filter(te => te.template_id !== templateId).concat(day);
  };
  // Start with real recovery, then remove redundant movements rather than losing whole muscle groups.
  for (const template of templates) {
    let day = fit(template.id, rows);
    replaceDay(template.id, day);
    while (estimateSessionMinutes(day, catalog) > budget) {
      const totals = planningDose(rows, catalog);
      const removable = day.filter(te => !protectedIds.has(te.id)).filter(te => {
        const ex = catalog.get(te.exercise_id);
        if (!ex) return false;
        const removedDose = planningDose([te], catalog);
        return Object.keys(exerciseMuscleCredits(ex)).filter(muscle => !hypertrophy || muscle in targets).every(muscle =>
          (totals[muscle] ?? 0) - (removedDose[muscle] ?? 0) >= (profile.training_mentality !== 'get_out' && ['Biceps', 'Triceps', 'Abs'].includes(muscle)
            ? targets[muscle] ?? 2 : Math.min(targets[muscle] ?? 2, profile.training_mentality === 'get_out' ? 2 : 4)));
      }).sort((a, b) => {
        const priority = (te: TemplateExercise) => Math.min(...Object.keys(exerciseMuscleCredits(catalog.get(te.exercise_id)!))
          .filter(m => !hypertrophy || m in targets).map(m => (totals[m] ?? 0) / (targets[m] ?? 2)));
        return priority(b) - priority(a) ||
          estimateSessionMinutes([b], catalog) - estimateSessionMinutes([a], catalog);
      })[0];
      if (!removable) break;
      day = day.filter(te => te.id !== removable.id);
      replaceDay(template.id, day);
      day = fit(template.id, rows);
    }
    replaceDay(template.id, day);
    if (profile.training_mentality === 'get_out') {
      while (estimateSessionMinutes(day, catalog) > budget) {
        const candidate = [...day].reverse().find(te => !protectedIds.has(te.id) && !te.rest_pause && (te.target_sets ?? 2) > 2);
        if (!candidate) break;
        candidate.target_sets!--;
        day = fitSessionToBudget(day, profile, catalog, protectedIds);
      }
      replaceDay(template.id, day);
    }
  }
  // Allocate deficits across the week; mood cannot override these targets with a fixed low set count.
  for (let step = 0; step < 250; step++) {
    const totals = planningDose(rows, catalog);
    const deficits = Object.entries(targets).filter(([m, target]) => (totals[m] ?? 0) < target)
      .sort((a, b) => (totals[a[0]] ?? 0) / a[1] - (totals[b[0]] ?? 0) / b[1]);
    let added = false;
    for (const [muscle] of deficits) {
      const candidates = rows.filter(te => !te.rest_pause && (te.target_sets ?? 2) < (profile.training_mentality === 'fury' ? 5 : 6) &&
        (exerciseMuscleCredits(catalog.get(te.exercise_id)!)[muscle] ?? 0) > 0)
        .sort((a, b) => (a.target_sets ?? 2) - (b.target_sets ?? 2) ||
          estimateSessionMinutes(fit(a.template_id, rows), catalog) - estimateSessionMinutes(fit(b.template_id, rows), catalog));
      for (const te of candidates) {
        const trial = distributeExerciseWork(rows.map(row => ({ ...row, target_sets: row.id === te.id ? (row.target_sets ?? 2) + 1 : row.target_sets })), profile, catalog, protectedIds, selection);
        // Rebuild compression so unequal rounds never inherit an obsolete pair.
        const day = fit(te.template_id, trial.map(row => ({ ...row, exercise_group_id: null })));
        if (estimateSessionMinutes(day, catalog) > budget) continue;
        replaceDay(te.template_id, day);
        added = true;
        break;
      }
      if (added) break;
    }
    if (!added) break;
  }
  rows.sort((a, b) => templates.findIndex(t => t.id === a.template_id) - templates.findIndex(t => t.id === b.template_id) || a.order_index - b.order_index);
  const coverage = weeklyMuscleSets(rows, catalog);
  const minutes = templates.map(t => Math.ceil(estimateSessionMinutes(rows.filter(te => te.template_id === t.id), catalog)));
  if (profile.training_mentality === 'get_out' && minutes.some(mins => mins > budget)) {
    throw new Error(`Cannot fit Get Out into ${budget} minutes with the available equipment and protected recovery. Estimated sessions: ${minutes.join(', ')} minutes. Reduce the training scope or choose a feasible time budget.`);
  }
  const dose = planningDose(rows, catalog);
  const warnings = Object.entries(targets).filter(([m, target]) => (dose[m] ?? 0) < target)
    .map(([m, target]) => rows.some(te => te.rest_pause) ? `${m}: estimated ${Math.round((dose[m] ?? 0) * 3)}/${target * 3} stimulating reps; compressed-dose estimate is uncertain.`
      : `${m}: ${coverage[m] ?? 0}/${target} weekly starting-target sets fit the available time/equipment.`);
  templates.forEach(template => rows.filter(te => te.template_id === template.id).forEach((te, index) => { te.order_index = index; }));
  minutes.forEach((mins, i) => { if (mins > budget) warnings.push(`${templates[i].name}: estimated ${mins} minutes exceeds the ${budget}-minute budget with recovery preserved.`); });
  return { rows, minutes, coverage, warnings };
}
