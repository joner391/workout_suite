import { Exercise, TemplateExercise, WorkoutSet, UserProfile } from '../core/types';
import { IWorkoutRepository, IUserSettingsRepository, IProgramRepository, IUserProfileRepository,
  IExercisePreferenceRepository } from '../domain/repositories';
import { WorkoutTemplateDetail } from '../domain/repositories/IProgramRepository';
import type { CalibratedParamService } from './calibratedParamService';
import { ExerciseControls, PersonalCurve, TrainingExposure, isStrengthMain, prescribedRir, recentCapacity,
  predictTrainingLoad, trainingStatus } from '../core/rules/trainingAdaptation';
import { exerciseAvailable } from '../core/rules/trainingAdaptation';
import { executionSetTargets } from '../core/rules/sessionPlanning';

export const TRAINING_CONTROLS_KEY = 'training_exercise_controls';
export const CURVES_KEY = 'training_personal_curves';
export const MESO_FEEDBACK_KEY = 'training_meso_feedback';
export interface PainRecovery {
  phase: 'return' | 'rebuilding' | 'swap';
  sourceWorkoutId: string;
  returnWorkoutId?: string;
  factor: number;
  referenceKg?: number;
  targetFactor?: number;
}
export interface AdaptationState {
  weeks: number;
  mood?: string;
  exposures: Record<string, TrainingExposure[]>;
  deload?: { remaining: number; completed: string[] };
  restart?: boolean;
  pain: Record<string, PainRecovery>;
  adjustments: Record<string, number>;
  loadFactors: Record<string, number>;
  mainExercises?: Record<string, boolean>;
  processed?: string[];
  goal?: string;
}
export interface PrescriptionSnapshot {
  programId: string;
  blockId?: string;
  deload: boolean;
  exercises: { prescription: TemplateExercise; weights: number[]; main: boolean; painReturn: boolean; painRecovery?: boolean }[];
}
export interface AdaptationContext {
  settings?: IUserSettingsRepository;
  programs?: IProgramRepository;
  profiles?: IUserProfileRepository;
  preferences?: IExercisePreferenceRepository;
  calibration?: Pick<CalibratedParamService, 'getCalibratedParam'>;
}
export async function readTrainingJson<T>(settings: IUserSettingsRepository | undefined, key: string, fallback: T): Promise<T> {
  const raw = await settings?.get(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
export function initialAdaptationState(): AdaptationState {
  return { weeks: 4, exposures: {}, pain: {}, adjustments: {}, loadFactors: {} };
}
export class TrainingAdaptationService {
  constructor(private readonly workouts: IWorkoutRepository, public readonly context: AdaptationContext) {}

  async state(programId: string): Promise<AdaptationState> {
    return readTrainingJson(this.context.settings, `training_state_${programId}`, initialAdaptationState());
  }
  async save(programId: string, state: AdaptationState): Promise<void> {
    await this.context.settings?.set(`training_state_${programId}`, JSON.stringify(state));
  }
  async controls(): Promise<Record<string, ExerciseControls>> {
    return readTrainingJson(this.context.settings, TRAINING_CONTROLS_KEY, {});
  }
  async profile(): Promise<UserProfile | null> { return await this.context.profiles?.getProfile() ?? null; }

  async resolve(template: WorkoutTemplateDetail, catalog: Map<string, Exercise>): Promise<WorkoutTemplateDetail> {
    if (!template.program_id || !this.context.settings) return template;
    const state = await this.state(template.program_id);
    const preferences = await this.context.preferences?.getAll() ?? [];
    const profile = await this.profile();
    const excluded = new Set(preferences.filter(p => p.sentiment === 'disliked' || p.sentiment === 'blacklisted').map(p => p.exercise_id));
    const used = new Set(template.exercises.map(te => te.exercise_id));
    const exercises = template.exercises.map(original => {
      let te = { ...original };
      if (state.pain[te.exercise_id]?.phase === 'swap') {
        const old = catalog.get(te.exercise_id);
        const candidate = [...catalog.values()].filter(ex => ex.id !== old?.id && !used.has(ex.id) &&
          !excluded.has(ex.id) && ex.muscle_group === old?.muscle_group && ex.is_compound === old?.is_compound &&
          exerciseAvailable(ex, profile?.equipment_access))
          .sort((a, b) => (preferences.find(p => p.exercise_id === b.id)?.affinity_score ?? 0) -
            (preferences.find(p => p.exercise_id === a.id)?.affinity_score ?? 0) || a.id.localeCompare(b.id))[0];
        if (!candidate) return null; // No compatible substitute: keep painful work out of the plan.
        used.add(candidate.id);
        te = { ...te, exercise_id: candidate.id, gear_id: null };
      }
      const baseline = prescribedRir(te);
      const rir = state.deload ? Math.max(4, baseline + 2) : baseline;
      if (state.deload || state.pain[te.exercise_id]) te = { ...te, rest_pause: null, set_type: 'working' };
      return { ...te, target_rir: rir, target_rpe: 10 - rir, rules: state.deload ? [] : te.rules };
    }).filter((te): te is NonNullable<typeof te> => te !== null);
    return { ...template, exercises };
  }

  async loadFor(te: TemplateExercise, history: WorkoutSet[], programId: string | null, deload = false): Promise<number | null> {
    if (!this.context.settings || !programId) return null;
    const state = await this.state(programId);
    const recovery = state.pain[te.exercise_id];
    if (recovery?.referenceKg && recovery.phase !== 'swap') return recovery.referenceKg * recovery.factor;
    const curves = await readTrainingJson<Record<string, PersonalCurve>>(this.context.settings, CURVES_KEY, {});
    const curve = await this.context.calibration?.getCalibratedParam(te.exercise_id) ?? curves[te.exercise_id];
    const k = curve?.calibrated_k ?? 0.1;
    // Caller supplies workout-date order, which also handles late imports of older sessions.
    const usable = history.filter(s => s.exercise_id === te.exercise_id && s.gear_id === te.gear_id);
    let capacity: number | null = null;
    let latest: WorkoutSet[] = [];
    for (const id of [...new Set(usable.map(s => s.workout_id))].reverse()) {
      const snapshot = await readTrainingJson<PrescriptionSnapshot | null>(this.context.settings, `training_snapshot_${id}`, null);
      const pain = state.pain[te.exercise_id];
      if (snapshot?.deload || snapshot?.exercises.some(row => row.prescription.exercise_id === te.exercise_id && (row.painReturn || row.painRecovery)) ||
          pain?.sourceWorkoutId === id) continue;
      latest = usable.filter(s => s.workout_id === id);
      const workout = await this.workouts.findById(id);
      const startedAt = Date.parse(workout?.started_at ?? '');
      const observedAt = Number.isFinite(startedAt) ? startedAt : Date.parse(workout?.date ?? latest[0]?.created_at ?? '');
      if (curve && Number.isFinite(observedAt) && observedAt <= Date.parse(curve.calibrated_at)) break;
      capacity = recentCapacity(latest, k);
      if (capacity != null) break;
    }
    capacity ??= curve?.calibrated_1rm ?? null;
    const pain = state.pain[te.exercise_id];
    if (!capacity) {
      const last = usable.filter(s => s.set_type === 'working' && s.weight > 0 && s.reps > 0).at(-1);
      if (last && (pain?.phase === 'return' || pain?.phase === 'rebuilding')) return last.weight * pain.factor;
      if (last && deload) {
        const rir = last.rir ?? (last.rpe != null ? 10 - last.rpe : null);
        return rir != null ? last.weight * Math.pow((last.reps + rir) / ((te.target_reps_min ?? last.reps) + prescribedRir(te)), k) : last.weight * 0.85;
      }
      return null;
    }
    if (pain?.phase === 'return' || pain?.phase === 'rebuilding') return capacity * pain.factor;
    const predicted = predictTrainingLoad(capacity, k, te.target_reps_min ?? 8, prescribedRir(te));
    if (predicted == null) {
      // Recovery prediction may exceed the ordinary 1–10 rep range. Preserve its relative effort change.
      if (!deload) return null;
      const last = latest.at(-1);
      const rir = last?.rir ?? (last?.rpe != null ? 10 - last.rpe : 2);
      return last ? last.weight * Math.pow((last.reps + rir) / (last.reps + prescribedRir(te)), k) : null;
    }
    return predicted * (state.loadFactors[te.id] ?? 1);
  }

  async capture(workoutId: string, template: WorkoutTemplateDetail, catalog: Map<string, Exercise>): Promise<void> {
    if (!template.program_id || !this.context.settings) return;
    const state = await this.state(template.program_id);
    const controls = await this.controls();
    const profile = await this.profile();
    const sets = await this.workouts.getSetsByWorkoutId(workoutId);
    const block = (await this.context.programs?.findProgramBlocksByProgramId(template.program_id))?.find(b => b.end_date === null);
    const snapshot: PrescriptionSnapshot = { programId: template.program_id, blockId: block?.id, deload: Boolean(state.deload), exercises: [] };
    const program = await this.context.programs?.findById(template.program_id);
    state.mood ??= program?.notes?.match(/(fury|precision|get_out) mentality/)?.[1] ?? profile?.training_mentality;
    state.goal ??= profile?.primary_goal ?? 'hypertrophy';
    state.mainExercises ??= {};
    for (const te of template.exercises) {
      const pain = state.pain[te.exercise_id];
      const painReturn = pain?.phase === 'return';
      state.mainExercises[te.id] = isStrengthMain(state.goal, catalog.get(te.exercise_id), controls[te.exercise_id]);
      if (painReturn) pain.returnWorkoutId = workoutId;
      snapshot.exercises.push({ prescription: te,
        weights: sets.filter(s => s.exercise_id === te.exercise_id && s.set_type !== 'warmup').map(s => s.weight),
        main: state.mainExercises[te.id], painReturn, painRecovery: Boolean(pain) });
      const stored = await this.context.programs?.findTemplateExerciseById(te.id);
      if (stored && stored.exercise_id !== te.exercise_id) {
        delete state.pain[stored.exercise_id];
        await this.context.programs?.updateTemplateExercise({ ...stored, exercise_id: te.exercise_id, gear_id: te.gear_id });
      }
    }
    await this.save(template.program_id, state);
    await this.context.settings.set(`training_snapshot_${workoutId}`, JSON.stringify(snapshot));
  }

  async recordPain(workoutId: string, exerciseId: string, severity: number, completedIds: Set<string>): Promise<boolean> {
    const snapshot = await readTrainingJson<PrescriptionSnapshot | null>(this.context.settings, `training_snapshot_${workoutId}`, null);
    if (!snapshot) {
      if (severity < 7) return false;
      const sets = await this.workouts.getSetsByWorkoutId(workoutId);
      for (const set of sets.filter(s => s.exercise_id === exerciseId && !completedIds.has(s.id))) await this.workouts.deleteSet(set.id);
      return true;
    }
    const state = await this.state(snapshot.programId);
    if (state.processed?.includes(workoutId)) return false;
    const returning = Boolean(state.pain[exerciseId] && state.pain[exerciseId].sourceWorkoutId !== workoutId &&
      state.pain[exerciseId].phase !== 'swap');
    if (returning && severity > 0) {
      state.pain[exerciseId].phase = 'swap';
    } else if (severity >= 7) {
      const row = snapshot.exercises.find(item => item.prescription.exercise_id === exerciseId);
      const currentSets = await this.workouts.getSetsByWorkoutId(workoutId);
      const previous = (await this.workouts.getMostRecentCompletedSetsForExercise(exerciseId))
        .filter(s => s.gear_id === row?.prescription.gear_id);
      const curves = await readTrainingJson<Record<string, PersonalCurve>>(this.context.settings, CURVES_KEY, {});
      const curve = await this.context.calibration?.getCalibratedParam(exerciseId) ?? curves[exerciseId];
      const k = curve?.calibrated_k ?? 0.1;
      const capacity = recentCapacity(previous, k) ?? curve?.calibrated_1rm ??
        recentCapacity(currentSets.filter(s => completedIds.has(s.id) && s.exercise_id === exerciseId), k);
      const reference = capacity ?? previous.find(s => s.weight > 0)?.weight ??
        currentSets.find(s => s.exercise_id === exerciseId && s.weight > 0)?.weight;
      const te = row?.prescription;
      const targetFactor = capacity && te ? Math.min(1, 1 / Math.pow((te.target_reps_min ?? 8) + prescribedRir(te), k)) : 1;
      state.pain[exerciseId] = { phase: 'return', sourceWorkoutId: workoutId, factor: 0.5,
        referenceKg: reference, targetFactor };
    } else return false;
    for (const row of snapshot.exercises.filter(item => item.prescription.exercise_id === exerciseId)) row.painRecovery = true;
    await this.context.settings?.set(`training_snapshot_${workoutId}`, JSON.stringify(snapshot));
    await this.save(snapshot.programId, state);
    const sets = await this.workouts.getSetsByWorkoutId(workoutId);
    for (const set of sets.filter(s => s.exercise_id === exerciseId && !completedIds.has(s.id))) await this.workouts.deleteSet(set.id);
    return true;
  }

  async complete(workoutId: string): Promise<void> {
    const snapshot = await readTrainingJson<PrescriptionSnapshot | null>(this.context.settings, `training_snapshot_${workoutId}`, null);
    if (!snapshot) return;
    const doneKey = `training_processed_${workoutId}`;
    if (await this.context.settings?.get(doneKey)) return;
    const state = await this.state(snapshot.programId);
    if (state.processed?.includes(workoutId)) return;
    const sets = await this.workouts.getSetsByWorkoutId(workoutId);
    const profile = await this.profile();
    for (const row of snapshot.exercises) {
      const te = row.prescription;
      const pain = state.pain[te.exercise_id];
      const actual = sets.filter(s => s.exercise_id === te.exercise_id && s.gear_id === te.gear_id && s.set_type !== 'warmup');
      if (pain) {
        if (pain.sourceWorkoutId === workoutId || pain.phase === 'swap') continue;
        const ceiling = pain.targetFactor ?? 0.8;
        if (actual.length) { pain.phase = 'rebuilding'; pain.factor = Math.min(ceiling, pain.factor + 0.05); }
        if (pain.factor >= ceiling) delete state.pain[te.exercise_id];
        continue;
      }
      if (snapshot.deload || !actual.length) continue;
      const last = actual.at(-1)!;
      const effort = last.rir ?? (last.rpe != null ? 10 - last.rpe : null);
      const signature = JSON.stringify([te.exercise_id, te.gear_id, te.target_sets, te.target_reps_min,
        te.target_reps_max, prescribedRir(te), row.weights.map(w => Math.round(w * 100) / 100),
        actual.map(s => Math.round(s.weight * 100) / 100), te.rest_seconds ?? null, te.exercise_group_id, te.rest_pause ?? null]);
      const history = state.exposures[te.id] ?? [];
      if (!history.some(h => h.workoutId === workoutId)) history.push({ workoutId, signature, effort,
        totalReps: actual.reduce((sum, s) => sum + Math.min(s.reps, s.reps_right ?? s.reps), 0),
        belowMinimum: actual.length < executionSetTargets(te).length || actual.some((s, i) => Math.min(s.reps, s.reps_right ?? s.reps) < (executionSetTargets(te)[i]?.repsMin ?? 1)) });
      state.exposures[te.id] = history.slice(-8);
      // An easier first exposure lasts once per slot, then normal effort resumes.
      const normal = await this.context.programs?.findTemplateExerciseById(te.id);
      const marker = await this.context.settings?.get(`training_ease_${te.id}`);
      if (normal && marker) {
        const rir = Math.max(0, prescribedRir(normal) - 1);
        await this.context.programs?.updateTemplateExercise({ ...normal, target_rir: rir, target_rpe: 10 - rir });
        await this.context.settings?.delete(`training_ease_${te.id}`);
      }
      delete state.loadFactors[te.id];
    }
    if (snapshot.deload && state.deload && sets.some(s => s.set_type !== 'warmup' && s.reps > 0)) {
      if (!state.deload.completed.includes(workoutId)) {
        state.deload.completed.push(workoutId);
        state.deload.remaining--;
      }
      if (state.deload.remaining <= 0) { delete state.deload; state.restart = true; state.exposures = {}; }
    } else if (!state.deload) {
      const details = await this.context.programs?.getProgramWithDetails(snapshot.programId);
      const controls = await this.controls();
      const goal = state.goal ?? profile?.primary_goal;
      const strength = goal === 'strength' || goal === 'powerbuilding';
      const eligible = details?.templates.flatMap(t => t.exercises).filter(te => !strength ||
        (controls[te.exercise_id]?.main ?? state.mainExercises?.[te.id])) ?? [];
      // Count distinct exercises, never two slots of the same movement.
      const deteriorating = new Set(eligible.filter(te => trainingStatus(state.exposures[te.id] ?? []) === 'deteriorating').map(te => te.exercise_id));
      if (deteriorating.size >= 2) state.deload = { remaining: profile?.preferred_days_per_week ?? 4, completed: [] };
    }
    state.processed = [...(state.processed ?? []), workoutId].slice(-100);
    await this.save(snapshot.programId, state);
    await this.context.settings?.set(doneKey, '1');
  }
}
