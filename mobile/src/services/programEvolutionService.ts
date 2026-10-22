import { Exercise, TemplateExercise, ProgressionRule, UserProfile } from '../core/types';
import { IProgramRepository } from '../domain/repositories/IProgramRepository';
import { IUserProfileRepository } from '../domain/repositories/IUserProfileRepository';
import { IWorkoutRepository } from '../domain/repositories/IWorkoutRepository';
import { IPainReportRepository } from '../domain/repositories/IPainReportRepository';
import { IExerciseRepository } from '../domain/repositories/IExerciseRepository';
import { IUserSettingsRepository, IExercisePreferenceRepository } from '../domain/repositories';
import { ProgramBlockService } from './programBlockService';
import { formatMesocycleDiffMarkdown, MesocycleDiffItem } from './mesocycleDiffFormatter';
import { TrainingAdaptationService, readTrainingJson, MESO_FEEDBACK_KEY, PrescriptionSnapshot } from './trainingAdaptationService';
import { moodAdjustment, prescribedRir, trainingStatus, estimateSessionMinutes, exerciseAvailable } from '../core/rules/trainingAdaptation';
import { TransitionWaveStep } from '../core/generator/transitionWave';
import { fitSessionToBudget } from '../core/generator/programVolumePlanner';

export interface WeightMasteryOptions { rpeThreshold?: number; painSeverityThreshold?: number }
export interface WeightMasteryResult {
  passed: boolean; holdLoad: boolean; reason?: string; maxRpeLogged?: number;
  jointPainSeverity?: number; painArea?: string;
}
export interface EvolveProgramOptions {
  programId?: string; startDate?: string; userProfile?: UserProfile;
  exerciseCatalog?: Exercise[] | Map<string, Exercise>; forceEvolve?: boolean;
}
export interface EvolutionResult {
  programId: string; previousBlockId: string; newBlockId: string; mesoNumber: number;
  diffItems: MesocycleDiffItem[]; diffMarkdown: string; summaryBadge: string; conciseSummaries?: string[];
  evolvedTemplateExercises: TemplateExercise[]; evolvedProgressionRules: ProgressionRule[];
  weightMasteryGatedExercises: string[]; transitionWave?: TransitionWaveStep;
}
export interface MesocycleFeedback {
  recommended_accumulation_weeks: number;
  confidence_score: number;
  confidence_tier: 'LOW' | 'MODERATE' | 'HIGH';
  detected_blocks_count: number;
  explicit_rpe_coverage: number;
  observed_through: string;
  exported_at: string;
  primary_goal: string;
}
const reviewsInFlight = new WeakMap<IProgramRepository, Map<string, Promise<EvolutionResult>>>();

/** Block review preserves productive work. Fatigue/pain interventions live in the session policy. */
export class ProgramEvolutionService {
  constructor(
    private readonly programRepo: IProgramRepository,
    private readonly userProfileRepo: IUserProfileRepository,
    private readonly workoutRepo?: IWorkoutRepository,
    private readonly painReportRepo?: IPainReportRepository,
    private readonly exerciseRepo?: IExerciseRepository,
    private readonly programBlockService?: ProgramBlockService,
    private readonly settings?: IUserSettingsRepository,
    private readonly preferences?: IExercisePreferenceRepository,
  ) {}

  async queueMesoMood(updates: Partial<UserProfile>): Promise<UserProfile> {
    const profile = await this.userProfileRepo.getProfile();
    if (!profile) throw new Error('Create a training profile before staging changes.');
    return this.userProfileRepo.saveProfile({ ...profile, ...updates, pending_meso_mood: true, updated_at: new Date().toISOString() });
  }
  async hasPendingMesoMood(): Promise<boolean> { return Boolean((await this.userProfileRepo.getProfile())?.pending_meso_mood); }
  async clearPendingMesoMood(): Promise<void> {
    const profile = await this.userProfileRepo.getProfile();
    if (profile?.pending_meso_mood) await this.userProfileRepo.saveProfile({ ...profile, pending_meso_mood: false });
  }
  private adaptation(): TrainingAdaptationService | null {
    return this.workoutRepo ? new TrainingAdaptationService(this.workoutRepo, { settings: this.settings,
      programs: this.programRepo, profiles: this.userProfileRepo, preferences: this.preferences }) : null;
  }
  async isReadyForEvolution(programId?: string) {
    const block = programId ? (await this.programRepo.findProgramBlocksByProgramId(programId)).find(b => b.end_date === null)
      : await this.programRepo.getActiveProgramBlock();
    const profile = await this.userProfileRepo.getProfile();
    const state = block ? await this.adaptation()?.state(block.program_id) : null;
    const targetWeeks = state?.weeks ?? 4;
    const days = profile?.preferred_days_per_week ?? 4;
    const templates = block ? await this.programRepo.findTemplatesByProgramId(block.program_id) : [];
    const ids = new Set(templates.map(t => t.id));
    const candidates = block && this.workoutRepo ? (await this.workoutRepo.findAll({ status: 'completed', startDate: block.start_date }))
      .filter(w => w.status === 'completed' && w.template_id && ids.has(w.template_id)) : [];
    const qualified = await Promise.all(candidates.map(async w => {
      const snapshot = await readTrainingJson<PrescriptionSnapshot | null>(this.settings, `training_snapshot_${w.id}`, null);
      return snapshot?.blockId ? snapshot.blockId === block?.id : true;
    }));
    const workouts = candidates.filter((_, i) => qualified[i]);
    const ready = Boolean(block && !state?.deload && (state?.restart || workouts.length >= days * targetWeeks));
    const completedWeeks = block ? Math.max(0, Math.floor((Date.now() - new Date(block.start_date).getTime()) / 604800000)) : 0;
    return { ready, reason: ready ? 'Ready for next mesocycle review.' : `${workouts.length}/${days * targetWeeks} planned sessions completed.`,
      completedWeeks, targetWeeks, completedWorkouts: workouts.length, targetWorkouts: days * targetWeeks };
  }

  async checkWeightMastery(exerciseId: string, options?: WeightMasteryOptions): Promise<WeightMasteryResult> {
    const recent = await this.workoutRepo?.getMostRecentCompletedSetsForExercise(exerciseId) ?? [];
    const working = recent.filter(s => s.set_type === 'working');
    const rpes = working.flatMap(s => s.rpe != null ? [s.rpe] : s.rir != null ? [10 - s.rir] : []);
    const reports = await this.painReportRepo?.getByExerciseId(exerciseId) ?? [];
    const cutoff = Date.now() - 14 * 86400000;
    const active = reports.filter(p => new Date(p.created_at).getTime() >= cutoff);
    const worst = active.sort((a, b) => b.severity - a.severity)[0];
    const pain = worst?.severity;
    const maxRpe = rpes.length ? Math.max(...rpes) : undefined;
    const holdLoad = (pain ?? 0) >= (options?.painSeverityThreshold ?? 7) ||
      (maxRpe ?? 0) > (options?.rpeThreshold ?? 9.5);
    return { passed: !holdLoad, holdLoad, maxRpeLogged: maxRpe, jointPainSeverity: pain,
      painArea: worst?.joint_location ?? undefined, reason: holdLoad ? 'Recent discomfort or effort overshoot.' : undefined };
  }

  async evolveActiveProgramForNextMeso(options?: EvolveProgramOptions): Promise<EvolutionResult> {
    const programId = options?.programId ?? (await this.programRepo.getActiveProgramBlock())?.program_id ?? '';
    const reviews = reviewsInFlight.get(this.programRepo) ?? new Map<string, Promise<EvolutionResult>>();
    reviewsInFlight.set(this.programRepo, reviews);
    const existing = reviews.get(programId);
    if (existing) return existing;
    const review = this.evolveProgram({ ...options, programId: programId || undefined });
    reviews.set(programId, review);
    try { return await review; } finally { reviews.delete(programId); }
  }

  private async evolveProgram(options?: EvolveProgramOptions): Promise<EvolutionResult> {
    if (await this.workoutRepo?.getInProgressWorkout()) throw new Error('Finish or discard the active workout before evolving.');
    const active = options?.programId
      ? (await this.programRepo.findProgramBlocksByProgramId(options.programId)).find(b => b.end_date === null)
      : await this.programRepo.getActiveProgramBlock();
    const programId = options?.programId ?? active?.program_id;
    if (!programId) throw new Error('No active program found to evolve for next mesocycle.');
    const details = await this.programRepo.getProgramWithDetails(programId);
    const profile = options?.userProfile ?? await this.userProfileRepo.getProfile();
    if (!details || !profile) throw new Error('Program and training profile are required.');
    const catalog = options?.exerciseCatalog instanceof Map ? options.exerciseCatalog : new Map(
      (options?.exerciseCatalog ?? await this.exerciseRepo?.findAll() ?? []).map(ex => [ex.id, ex]));
    const adaptation = this.adaptation();
    const state = await adaptation?.state(programId);
    if (state?.deload) throw new Error('Complete the recovery sessions before evolving.');
    const controls = await adaptation?.controls() ?? {};
    const preferences = await this.preferences?.getAll() ?? [];
    const diffs: MesocycleDiffItem[] = [];
    const evolved: TemplateExercise[] = [];
    const rules: ProgressionRule[] = [];
    const oldMood = state?.mood ?? details.program.notes?.match(/(fury|precision|get_out) mentality/)?.[1];
    const mood = profile.training_mentality;
    const used = new Set(details.templates.flatMap(t => t.exercises.map(te => te.exercise_id)));
    const blocked = new Set(preferences.filter(p => p.sentiment === 'disliked' || p.sentiment === 'blacklisted').map(p => p.exercise_id));
    for (const template of details.templates) for (const original of template.exercises) {
      let te: TemplateExercise = { ...original };
      const status = trainingStatus(state?.exposures[te.id] ?? []);
      const justified = status === 'flat' || status === 'deteriorating';
      const stage = state?.adjustments[te.id] ?? 0;
      const name = catalog.get(te.exercise_id)?.name ?? te.exercise_id;
      if (justified) {
        if (stage % 4 === 0) {
          if (state) state.loadFactors[te.id] = 0.9;
          diffs.push({ category: 'load', title: `${name}: load reset by 10%`, explanation: `${status === 'flat' ? 'Four comparable exposures were flat' : 'Two comparable exposures missed performance'}. Rebuild at the next block.` });
        } else if (stage % 4 === 1) {
          const direction = mood === 'fury' ? -2 : 2;
          const min = Math.max(1, Math.min(15, (te.target_reps_min ?? 8) + direction));
          te = { ...te, target_reps_min: min, target_reps_max: min + Math.max(1, (te.target_reps_max ?? 12) - (te.target_reps_min ?? 8)) };
          diffs.push({ category: 'rep_rest', title: `${name}: rep range adjusted`, explanation: `Previous reset did not restore progress. Next range: ${te.target_reps_min}–${te.target_reps_max}.` });
        } else if (stage % 4 === 2 && !controls[te.exercise_id]?.anchor) {
          const old = catalog.get(te.exercise_id);
          const candidate = [...catalog.values()].filter(ex => !used.has(ex.id) && !blocked.has(ex.id) &&
            ex.muscle_group === old?.muscle_group && ex.is_compound === old?.is_compound && ex.category === old?.category &&
            exerciseAvailable(ex, profile.equipment_access))
            .sort((a, b) => (preferences.find(p => p.exercise_id === b.id)?.affinity_score ?? 0) -
              (preferences.find(p => p.exercise_id === a.id)?.affinity_score ?? 0) || a.id.localeCompare(b.id))[0];
          if (candidate) { used.add(candidate.id); te = { ...te, exercise_id: candidate.id, gear_id: null };
            diffs.push({ category: 'exercise_swap', title: `${name} → ${candidate.name}`, explanation: 'Persistent flat performance after a reset and rep-range adjustment; preferences and equipment category preserved.' }); }
        } else {
          te.target_sets = Math.max(1, (te.target_sets ?? 3) - 1);
          diffs.push({ category: 'volume', title: `${name}: one fewer set`, explanation: 'A small reduction in training demand after earlier adjustments did not restore progress.' });
        }
        const before = JSON.stringify(te);
        te = moodAdjustment(te, mood);
        if (before !== JSON.stringify(te)) diffs.push({ category: 'intensity_technique', title: `${name}: ${mood} preference applied`,
          explanation: `Next prescription: ${te.target_sets} sets at ${prescribedRir(te)} RIR. Training days and session limit retained.` });
        if (state) state.adjustments[te.id] = stage + 1;
      }
      // A change of explicitly staged mood is allowed to nudge next-block work, including main lifts.
      if (!justified && oldMood && oldMood !== mood && profile.pending_meso_mood) {
        te = moodAdjustment(te, mood);
        diffs.push({ category: 'intensity_technique', title: `${name}: training preference updated`, explanation: `${te.target_sets} sets at ${prescribedRir(te)} RIR for ${mood}.` });
      }
      if (blocked.has(te.exercise_id) && !controls[te.exercise_id]?.anchor) {
        const old = catalog.get(te.exercise_id);
        const replacement = [...catalog.values()].filter(ex => !used.has(ex.id) && !blocked.has(ex.id) &&
          ex.muscle_group === old?.muscle_group && ex.is_compound === old?.is_compound && exerciseAvailable(ex, profile.equipment_access))
          .sort((a, b) => (preferences.find(p => p.exercise_id === b.id)?.affinity_score ?? 0) -
            (preferences.find(p => p.exercise_id === a.id)?.affinity_score ?? 0) || a.id.localeCompare(b.id))[0];
        if (replacement) {
          used.add(replacement.id);
          te = { ...te, exercise_id: replacement.id, gear_id: null };
          diffs.push({ category: 'exercise_swap', title: `${name} → ${replacement.name}`, explanation: 'Avoid a disliked exercise using an available alternative for the same muscle group.' });
        } else throw new Error(`No acceptable alternative for ${name}. Update exercise preferences or equipment before evolving.`);
      }
      if (state?.restart) {
        const rir = Math.min(8, prescribedRir(te) + 1);
        te = { ...te, target_rir: rir, target_rpe: 10 - rir };
        await this.settings?.set(`training_ease_${te.id}`, '1');
      }
      evolved.push(te);
      rules.push(...original.rules);
    }
    // Fit real rest/group prescriptions before considering any loss of productive volume.
    for (const template of details.templates) {
      const rows = evolved.filter(te => te.template_id === template.id);
      const fitted = fitSessionToBudget(rows, profile, catalog);
      for (let i = 0; i < rows.length; i++) {
        const execution = (te: TemplateExercise) => JSON.stringify([te.target_sets, te.exercise_group_id, te.rest_seconds, te.rest_pause]);
        if (execution(rows[i]) !== execution(fitted[i])) diffs.push({ category: 'intensity_technique',
          title: `${catalog.get(rows[i].exercise_id)?.name ?? rows[i].exercise_id}: time-efficient execution`,
          explanation: fitted[i].rest_pause
            ? `${fitted[i].target_sets} activation set(s), each followed by ${fitted[i].rest_pause!.mini_sets} mini-sets at ${fitted[i].rest_pause!.rest_seconds}s rest. Full sets and mini-sets are tracked separately.`
            : `Accessory pairing/rest updated; ${fitted[i].target_sets} full sets retained.` });
        Object.assign(rows[i], fitted[i]);
      }
      if (estimateSessionMinutes(rows, catalog) > (profile.preferred_session_duration_mins ?? 60)) diffs.push({
        category: 'volume', title: `${template.name}: review session-time preference`,
        explanation: 'Preserving productive volume and required main-lift recovery exceeds the estimated session budget. Review the exercise allocation or time preference; sets were not silently removed.' });
    }
    let weeks = state?.weeks ?? 4;
    const feedback = await readTrainingJson<MesocycleFeedback | null>(this.settings, MESO_FEEDBACK_KEY, null);
    const current = feedback && Date.now() - Date.parse(feedback.observed_through) <= 42 * 86400000 &&
      Date.now() >= Date.parse(feedback.observed_through) && Date.now() - Date.parse(feedback.exported_at) <= 42 * 86400000;
    const histories = Object.values(state?.exposures ?? {});
    const productive = histories.length > 0 && histories.every(history => trainingStatus(history) === 'progressing') && !state?.restart;
    if (feedback && current && !productive && Date.parse(feedback.exported_at) <= Date.now() &&
        feedback.primary_goal === profile.primary_goal && feedback.detected_blocks_count >= 4 &&
        feedback.confidence_score >= 45 && feedback.confidence_tier !== 'LOW' && feedback.explicit_rpe_coverage >= 0.5 &&
        Number.isFinite(feedback.recommended_accumulation_weeks)) {
      weeks = Math.max(3, Math.min(12, Math.round(feedback.recommended_accumulation_weeks)));
    }
    if (weeks !== (state?.weeks ?? 4)) diffs.push({ category: 'block_length', title: `Block length: ${weeks} weeks`,
      explanation: 'Current companion feedback meets the individual-history, effort-coverage and confidence requirements.' });
    if (state?.restart) diffs.push({ category: 'intensity_technique', title: 'Easier return after recovery', explanation: 'First exposure per exercise is one RIR easier, then normal effort resumes.' });
    if (!diffs.length) diffs.push({ category: 'volume', title: 'Productive prescription retained', explanation: 'No supported adjustment. Repeat the existing exercises, sets, reps and effort.' });
    const date = options?.startDate ?? new Date().toISOString().slice(0, 10);
    const blocks = await this.programRepo.findProgramBlocksByProgramId(programId);
    const mesoNumber = blocks.length + 1;
    const newBlockId = `block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    for (const te of evolved) await this.programRepo.updateTemplateExercise(te);
    if (active) await this.programRepo.updateProgramBlock({ ...active, end_date: date });
    await this.programRepo.createProgramBlock({ id: newBlockId, program_id: programId, start_date: date, end_date: null });
    if (state) { state.weeks = weeks; state.goal = profile.primary_goal; state.mood = mood; state.restart = false; state.exposures = {}; await adaptation?.save(programId, state); }
    await this.clearPendingMesoMood();
    return { programId, previousBlockId: active?.id ?? 'initial_block', newBlockId, mesoNumber, diffItems: diffs,
      diffMarkdown: formatMesocycleDiffMarkdown(diffs, mesoNumber, { mode: 'detailed' }),
      summaryBadge: diffs.length === 1 && diffs[0].title === 'Productive prescription retained' ? 'Baseline Maintained' : `${diffs.length} adjustments applied`,
      conciseSummaries: diffs.map(diff => diff.title), evolvedTemplateExercises: evolved,
      evolvedProgressionRules: rules, weightMasteryGatedExercises: [] };
  }
}
