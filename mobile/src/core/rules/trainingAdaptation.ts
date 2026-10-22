import { Exercise, TemplateExercise, TrainingMentality, WorkoutSet } from '../types';
export { estimateSessionMinutes } from './sessionPlanning';

export interface ExerciseControls { anchor?: boolean; main?: boolean }
export interface TrainingExposure {
  workoutId: string;
  signature: string;
  totalReps: number;
  belowMinimum: boolean;
  effort: number | null;
}
export interface PersonalCurve { calibrated_1rm: number; calibrated_k: number; calibrated_at: string }

export function exerciseAvailable(ex: Exercise, access?: string): boolean {
  if (access === 'bodyweight_only') return ex.is_bodyweight;
  if (access === 'dumbbells_only') return ex.category === 'Dumbbell' || ex.is_bodyweight;
  if (access === 'garage_gym') return ex.category === 'Barbell' || ex.category === 'Dumbbell' || ex.is_bodyweight;
  return true;
}

export function prescribedRir(te: TemplateExercise): number {
  return te.target_rir ?? (te.target_rpe != null ? 10 - te.target_rpe : 2);
}

/** Prediction and observation eligibility are deliberately different. */
export function predictTrainingLoad(e1rm: number, k: number, reps: number, rir: number): number | null {
  if (![e1rm, k, reps, rir].every(Number.isFinite) || e1rm <= 0 || k < 0.03 || k > 0.20 ||
      reps < 1 || reps > 10 || rir < 0 || rir > 8) return null;
  return e1rm / Math.pow(reps + rir, k);
}

export function recentCapacity(sets: WorkoutSet[], k: number): number | null {
  const estimates = sets.filter(s => s.set_type === 'working' && s.reps >= 1 && s.reps <= 10 && s.weight > 0)
    .flatMap(s => {
      const rir = s.rir ?? (s.rpe != null ? 10 - s.rpe : null);
      return rir != null && Number.isFinite(rir) && rir >= 0 && rir <= 3
        ? [s.weight * Math.pow(s.reps + rir, k)] : [];
    }).sort((a, b) => a - b);
  if (!estimates.length) return null;
  const i = Math.floor(estimates.length / 2);
  return estimates.length % 2 ? estimates[i] : (estimates[i - 1] + estimates[i]) / 2;
}

export function trainingStatus(history: TrainingExposure[]): 'insufficient' | 'progressing' | 'flat' | 'deteriorating' {
  const last = history.at(-1);
  if (!last) return 'insufficient';
  // Never jump over an incomparable exposure to assemble an artificial streak.
  const comparable: TrainingExposure[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.signature !== last.signature || h.effort == null || last.effort == null ||
        Math.abs(h.effort - last.effort) > 1) break;
    comparable.unshift(h);
  }
  const n = comparable.length;
  const missed = (i: number) => comparable[i].belowMinimum ||
    (i > 0 && comparable[i].totalReps < comparable[i - 1].totalReps);
  if (n >= 2 && missed(n - 1) && missed(n - 2)) return 'deteriorating';
  if (n >= 4 && comparable.slice(-4).every(h => h.totalReps === last.totalReps)) return 'flat';
  return n >= 2 ? 'progressing' : 'insufficient';
}

export function isStrengthMain(goal: string, ex: Exercise | undefined, controls?: ExerciseControls): boolean {
  return (goal === 'strength' || goal === 'powerbuilding') &&
    (controls?.main ?? Boolean(ex?.standard_lift_type && ['squat', 'bench', 'deadlift', 'ohp'].includes(ex.standard_lift_type)));
}

/** Mood nudges a justified adjustment; it never forces novelty on successful work. */
export function moodAdjustment(te: TemplateExercise, mood: TrainingMentality): TemplateExercise {
  const rir = prescribedRir(te);
  if (mood === 'fury') return { ...te,
    target_rir: Math.max(0.5, rir - 0.5), target_rpe: 10 - Math.max(0.5, rir - 0.5) };
  if (mood === 'get_out') return { ...te };
  return { ...te, target_rir: Math.max(2, rir), target_rpe: 10 - Math.max(2, rir) };
}
