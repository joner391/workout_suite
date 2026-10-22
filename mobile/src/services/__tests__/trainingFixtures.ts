import { Exercise, UserProfile, TemplateExercise, WorkoutSet } from '../../core/types';
import { MockProgramRepository } from '../../database/mocks/MockProgramRepository';
import { MockUserProfileRepository } from '../../database/mocks/MockUserProfileRepository';
import { MockWorkoutRepository } from '../../database/mocks/MockWorkoutRepository';
import { MockUserSettingsRepository } from '../../database/mocks/MockUserSettingsRepository';
import { MockExercisePreferenceRepository } from '../../database/mocks/MockExercisePreferenceRepository';
import { MockExerciseRepository } from '../../database/mocks/MockExerciseRepository';
import { ProgramEvolutionService } from '../programEvolutionService';
import { TrainingAdaptationService } from '../trainingAdaptationService';

export const profile: UserProfile = { id: 'p', gender: 'male', birthdate: null, height_cm: null,
  primary_goal: 'strength', secondary_goals: null, training_mentality: 'precision',
  preferred_days_per_week: 3, preferred_session_duration_mins: 60, equipment_access: 'commercial_gym',
  experience_level: 'intermediate', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' };
export const catalog: Exercise[] = ['squat', 'bench', 'row'].map((name, i) => ({ id: name, name,
  muscle_group: ['Quads', 'Chest', 'Back'][i], category: 'Barbell', is_compound: true, is_bodyweight: false,
  is_unilateral: false, load_mode: 'total', default_cable_ratio: 1, default_bar_weight_kg: 20,
  is_custom: false, parent_exercise_id: null, standard_lift_type: name as 'squat' | 'bench' | 'row', default_rest_seconds: 180 }));
export const slot = (id: string, index = 0): TemplateExercise => ({ id: `te-${id}`, exercise_id: id, template_id: 't',
  gear_id: null, target_sets: 2, target_reps_min: 6, target_reps_max: 8,
  target_rir: 2, target_rpe: 8, order_index: index, exercise_group_id: null });
export async function harness(goal: UserProfile['primary_goal'] = 'strength') {
  const programs = new MockProgramRepository();
  const profiles = new MockUserProfileRepository();
  const workouts = new MockWorkoutRepository();
  const settings = new MockUserSettingsRepository();
  const preferences = new MockExercisePreferenceRepository();
  const exercises = new MockExerciseRepository(catalog);
  await profiles.saveProfile({ ...profile, primary_goal: goal });
  await programs.create({ id: 'program', name: 'Training', color_hex: '#123456', notes: null, created_at: profile.created_at });
  await programs.createTemplate({ id: 't', program_id: 'program', name: 'Day', notes: null, order_index: 0, created_at: profile.created_at });
  for (const [i, name] of ['squat', 'bench', 'row'].entries()) await programs.createTemplateExercise(slot(name, i));
  await programs.createProgramBlock({ id: 'block', program_id: 'program', start_date: '2026-10-01', end_date: null });
  const adaptation = new TrainingAdaptationService(workouts, { programs, profiles, settings, preferences });
  const evolution = new ProgramEvolutionService(programs, profiles, workouts, undefined, exercises, undefined, settings, preferences);
  const exerciseMap = new Map(catalog.map(ex => [ex.id, ex]));
  let sequence = 0;
  async function session(id: string, reps = 8, weights = 80, rir = 2, templateId = 't') {
    const at = new Date(Date.now() + sequence++ * 1000).toISOString();
    const template = await programs.getTemplateWithDetails(templateId);
    if (!template) throw new Error('missing template');
    const resolved = await adaptation.resolve(template, exerciseMap);
    await workouts.create({ id, template_id: templateId, date: '2026-10-21', started_at: `${id}`, name: 'Day',
      status: 'in_progress', completed_at: null, duration_seconds: null, notes: null, imported_from: null });
    for (const te of resolved.exercises) for (let i = 1; i <= (te.target_sets ?? 2); i++) {
      const set: WorkoutSet = { id: `${id}-${te.id}-${i}`, workout_id: id, exercise_id: te.exercise_id, gear_id: te.gear_id,
        set_number: i, weight: weights, raw_input_weight: weights, added_weight: null, reps, reps_right: null,
        rir, rpe: 10 - rir, set_type: 'working', set_notes: null, exercise_group_id: null, created_at: at };
      await workouts.addSet(set);
    }
    await adaptation.capture(id, resolved, exerciseMap);
    return resolved;
  }
  async function finish(id: string) {
    const w = await workouts.findById(id);
    if (!w) throw new Error('missing workout');
    await workouts.update({ ...w, status: 'completed', completed_at: '2026-10-21T13:00:00Z' });
    await adaptation.complete(id);
  }
  return { programs, profiles, workouts, settings, preferences, exercises, adaptation, evolution, exerciseMap, session, finish };
}
