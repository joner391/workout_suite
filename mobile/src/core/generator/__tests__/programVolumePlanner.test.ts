import { synthesizeProgram } from '../programSynthesizer';
import { DEFAULT_EXERCISES } from '../../../database/seeds/defaultExercises';
import { UserProfile, TemplateExercise } from '../../types';
import { estimateSessionMinutes, prescribedRestSeconds, executionRestSeconds } from '../../rules/sessionPlanning';
import { moodAdjustment } from '../../rules/trainingAdaptation';
import { distributeExerciseWork, restPauseEligible } from '../programVolumePlanner';
import { executionSetTargets } from '../../rules/sessionPlanning';

const catalog = new Map(DEFAULT_EXERCISES.map(ex => [ex.id, ex]));
const profile: UserProfile = { id: 'volume', gender: 'female', birthdate: null, height_cm: null,
  training_mentality: 'fury', primary_goal: 'hypertrophy', secondary_goals: [], experience_level: 'advanced',
  preferred_days_per_week: 5, preferred_session_duration_mins: 75, equipment_access: 'commercial_gym',
  created_at: '', updated_at: '' };

describe('weekly volume and actual scheduling', () => {
  it.each(['fury', 'precision', 'get_out'] as const)('retains advanced direct arms/core volume with %s', mood => {
    const result = synthesizeProgram({ ...profile, training_mentality: mood });
    for (const [muscle, target] of Object.entries({ Chest: 16, Back: 16, Biceps: 12, Triceps: 12, Abs: 8 })) {
      if (mood === 'fury') expect(result.summary.weeklyMuscleSets![muscle]).toBeGreaterThanOrEqual(target);
      else if (result.summary.weeklyMuscleSets![muscle] < target) {
        expect(result.summary.weeklyMiniSets![muscle]).toBeGreaterThan(0);
        expect(result.summary.weeklyMuscleEReps![muscle]).toBeGreaterThanOrEqual(target * 3);
      }
    }
    expect(result.summary.planningWarnings).toEqual([]);
    expect(result.templateExercises.every(te => te.target_sets! >= 2 || te.rest_pause != null)).toBe(true);
    expect(result.templateExercises.some(te => te.target_sets! >= 4)).toBe(true);
  });

  it('retains direct arms and core in the reported 4-day 45-minute case and exposes remaining tradeoffs', () => {
    const result = synthesizeProgram({ ...profile, experience_level: 'intermediate', primary_goal: 'strength',
      secondary_goals: ['hypertrophy'], preferred_days_per_week: 4, preferred_session_duration_mins: 45 });
    for (const muscle of ['Biceps', 'Triceps', 'Abs']) {
      expect(result.summary.weeklyMuscleSets![muscle]).toBeGreaterThanOrEqual(1);
      if (result.summary.weeklyMuscleSets![muscle] < 6) expect(result.summary.weeklyMuscleEReps![muscle]).toBeGreaterThanOrEqual(18);
    }
    expect(result.summary.planningWarnings!.length).toBeGreaterThan(0);
    expect(result.summary.sessionDurationsMins!.every(mins => mins <= 45)).toBe(true);
    expect(result.templateExercises.some(te => te.rest_seconds === 45)).toBe(true);
    for (const te of result.templateExercises.filter(te => catalog.get(te.exercise_id)?.standard_lift_type === 'bench')) {
      expect(te.exercise_group_id).toBeNull();
      expect(te.rest_seconds).toBe(catalog.get(te.exercise_id)!.default_rest_seconds);
    }
  });

  it('derives every summary duration from the same final prescription used in execution', () => {
    const result = synthesizeProgram(profile);
    const minutes = result.templates.map(t => Math.ceil(estimateSessionMinutes(result.templateExercises.filter(te => te.template_id === t.id), catalog)));
    expect(result.summary.sessionDurationsMins).toEqual(minutes);
    expect(result.summary.estimatedSessionDurationMins).toBe(Math.max(...minutes));
    expect(result.summary.totalWeeklySets).toBe(result.templateExercises.reduce((sum, te) => sum + te.target_sets!, 0));
  });

  it('keeps strength-only rest intact under time pressure and reports an impossible budget', () => {
    const result = synthesizeProgram({ ...profile, primary_goal: 'strength', secondary_goals: [], preferred_session_duration_mins: 15 });
    for (const te of result.templateExercises) {
      expect(prescribedRestSeconds(te)).toBe(catalog.get(te.exercise_id)!.default_rest_seconds);
      if (catalog.get(te.exercise_id)?.is_compound) expect(te.exercise_group_id).toBeNull();
    }
    expect(result.summary.planningWarnings!.some(w => w.includes('exceeds'))).toBe(true);
    expect(result.summary.estimatedSessionDurationMins).toBeGreaterThan(15);
  });

  it('does not let Fury mood changes strip sets from productive prescriptions', () => {
    const te = synthesizeProgram(profile).templateExercises.find(te => te.target_sets === 4)!;
    expect(moodAdjustment(te, 'fury').target_sets).toBe(4);
    expect(moodAdjustment(te, 'get_out').target_sets).toBe(4);
  });

  it('includes setup, ramp-up and full main-lift rest', () => {
    const row: TemplateExercise = { id: 'bench', template_id: 'day', exercise_id: 'barbell_bench_press', gear_id: null,
      target_sets: 3, target_reps_min: 3, target_reps_max: 5, target_rpe: 8, target_rir: 2,
      order_index: 0, exercise_group_id: null, rest_seconds: 180 };
    expect(estimateSessionMinutes([row], catalog)).toBe(15.75);
    expect(estimateSessionMinutes([{ ...row, rest_seconds: 240 }], catalog)).toBe(17.75);
  });

  it('splits four Fury pressing sets into two pressing sets and two complementary fly sets', () => {
    const base: TemplateExercise = { id: 'press', template_id: 'day', exercise_id: 'barbell_incline_bench_press', gear_id: null,
      target_sets: 4, target_reps_min: 8, target_reps_max: 12, target_rpe: 8, target_rir: 2, order_index: 0, exercise_group_id: null };
    const allowed = new Map(['barbell_incline_bench_press', 'cable_chest_fly'].map(id => [id, catalog.get(id)!]));
    const result = distributeExerciseWork([base], profile, allowed, new Set());
    expect(result.map(te => [te.exercise_id, te.target_sets])).toEqual([['barbell_incline_bench_press', 2], ['cable_chest_fly', 2]]);
  });

  it('fits the dumbbell Get Out example in 30 minutes using antagonist pairs and explicit rest-pause', () => {
    const result = synthesizeProgram({ ...profile, experience_level: 'intermediate', training_mentality: 'get_out',
      preferred_days_per_week: 2, preferred_session_duration_mins: 30, equipment_access: 'dumbbells_only' });
    expect(result.summary.sessionDurationsMins!.every(mins => mins <= 30)).toBe(true);
    const protocols = result.templateExercises.filter(te => te.rest_pause);
    expect(protocols.length).toBeGreaterThan(0);
    for (const te of protocols) {
      expect(restPauseEligible(catalog.get(te.exercise_id)!)).toBe(true);
      expect(te.exercise_group_id).toBeNull();
      expect(executionSetTargets(te)).toHaveLength(te.target_sets! * (1 + te.rest_pause!.mini_sets));
      expect(executionRestSeconds(te, catalog.get(te.exercise_id), 'working')).toBe(te.rest_pause!.rest_seconds);
      expect(executionRestSeconds(te, catalog.get(te.exercise_id), te.set_type!)).toBe(te.rest_pause!.rest_seconds);
      expect(executionRestSeconds(te, catalog.get(te.exercise_id), te.set_type!, true)).toBe(prescribedRestSeconds(te, catalog.get(te.exercise_id)));
      expect(executionRestSeconds(te, catalog.get(te.exercise_id), 'warmup')).toBe(prescribedRestSeconds(te, catalog.get(te.exercise_id)));
    }
    const press = result.templateExercises.find(te => te.exercise_id === 'dumbbell_bench_press')!;
    const row = result.templateExercises.find(te => te.exercise_id === 'dumbbell_single_arm_row')!;
    expect(press.exercise_group_id).toBeTruthy();
    expect(press.exercise_group_id).toBe(row.exercise_group_id);
    expect(result.summary.weeklyMuscleSets!.Abs).toBeGreaterThan(0);
  });

  it('rejects squats, hinges, high axial load and impossible Get Out schedules', () => {
    for (const id of ['barbell_back_squat', 'barbell_deadlift', 'barbell_rdl', 'dumbbell_bulgarian_split_squat']) {
      expect(restPauseEligible(catalog.get(id)!)).toBe(false);
    }
    expect(() => synthesizeProgram({ ...profile, primary_goal: 'strength', training_mentality: 'get_out',
      preferred_session_duration_mins: 15 })).toThrow('Cannot fit Get Out');
  });
});
