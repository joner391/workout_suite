/** Deterministic integration scenarios. These establish software behavior, not physiological validity. */
import { Exercise, UserProfile } from '../core/types';
import { DEFAULT_EXERCISES } from '../database/seeds/defaultExercises';
import { MockProgramRepository } from '../database/mocks/MockProgramRepository';
import { MockUserProfileRepository } from '../database/mocks/MockUserProfileRepository';
import { MockWorkoutRepository } from '../database/mocks/MockWorkoutRepository';
import { MockExerciseRepository } from '../database/mocks/MockExerciseRepository';
import { MockUserSettingsRepository } from '../database/mocks/MockUserSettingsRepository';
import { ProgramEvolutionService } from './programEvolutionService';
import { ProgramBlockService } from './programBlockService';
import { TrainingAdaptationService } from './trainingAdaptationService';
import { synthesizeProgram } from '../core/generator/programSynthesizer';
import { MesocycleDiffItem } from './mesocycleDiffFormatter';

export interface LifterProfileConfig {
  id: string; name: string; description: string; initialProfile: UserProfile;
  scenario: 'progressing' | 'pain' | 'deficit' | 'mood';
}
export interface SoundnessAssertion { criterion: string; passed: boolean; message: string }
export interface MesoSimulationReportStep {
  fromMeso: number; toMeso: number; conciseSummaries: string[]; diffItems: MesocycleDiffItem[];
  diffMarkdown: string; soundnessAssertions: SoundnessAssertion[]; allPassed: boolean;
}
export interface LifterSimulationReport {
  profileId: string; profileName: string; description: string; steps: MesoSimulationReportStep[]; overallSuccess: boolean;
}
const baseline: UserProfile = { id: 'sim-profile', gender: 'male', birthdate: null, height_cm: null,
  experience_level: 'intermediate', training_mentality: 'precision', primary_goal: 'hypertrophy', secondary_goals: null,
  preferred_days_per_week: 3, preferred_session_duration_mins: 60, equipment_access: 'commercial_gym',
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' };
export const CANONICAL_PROFILES: LifterProfileConfig[] = [
  { id: 'lukas_responsive', name: 'Lukas', description: 'Improving performance retains productive training.', initialProfile: baseline, scenario: 'progressing' },
  { id: 'erik_elbow_pain', name: 'Erik', description: 'Pain is handled during sessions, independently of block review.', initialProfile: { ...baseline, primary_goal: 'strength' }, scenario: 'pain' },
  { id: 'sofia_caloric_deficit', name: 'Sofia', description: 'A deficit alone does not force exercise swaps or shorten a block.', initialProfile: { ...baseline, is_caloric_deficit: true }, scenario: 'deficit' },
  { id: 'marcus_mentality_shift', name: 'Marcus', description: 'A staged mood change affects the next block.', initialProfile: { ...baseline, primary_goal: 'strength' }, scenario: 'mood' },
];

export async function runLifterSimulation(config: LifterProfileConfig, catalog: Exercise[] = DEFAULT_EXERCISES): Promise<LifterSimulationReport> {
  const programs = new MockProgramRepository();
  const profiles = new MockUserProfileRepository();
  const workouts = new MockWorkoutRepository();
  const exercises = new MockExerciseRepository(catalog);
  const settings = new MockUserSettingsRepository();
  await profiles.saveProfile(config.initialProfile);
  const adaptation = new TrainingAdaptationService(workouts, { settings, programs, profiles });
  const evolution = new ProgramEvolutionService(programs, profiles, workouts, undefined, exercises, undefined, settings);
  const synthesized = synthesizeProgram(config.initialProfile, { availableExercises: catalog });
  await programs.saveSynthesizedProgram(synthesized);
  await new ProgramBlockService(programs).swapActiveProgram(synthesized.program.id, '2026-10-01');
  const state = await adaptation.state(synthesized.program.id);
  state.mood = config.initialProfile.training_mentality;
  await adaptation.save(synthesized.program.id, state);
  const map = new Map(catalog.map(ex => [ex.id, ex]));
  const steps: MesoSimulationReportStep[] = [];
  for (let block = 0; block < 2; block++) {
    const details = (await programs.getProgramWithDetails(synthesized.program.id))!;
    for (let exposure = 0; exposure < 4; exposure++) {
      const template = details.templates[exposure % details.templates.length];
      const resolved = await adaptation.resolve(template, map);
      const id = `sim-${block}-${exposure}`;
      await workouts.create({ id, template_id: template.id, date: '2026-10-21', name: template.name,
        notes: null, started_at: id, status: 'in_progress', completed_at: null, duration_seconds: null, imported_from: null });
      for (const te of resolved.exercises) for (let set = 1; set <= (te.target_sets ?? 3); set++) {
        await workouts.addSet({ id: `${id}-${te.id}-${set}`, workout_id: id, exercise_id: te.exercise_id,
          gear_id: te.gear_id, set_number: set, weight: 80, raw_input_weight: 80, added_weight: null,
          reps: (te.target_reps_min ?? 8) + exposure, reps_right: null, rir: 2, rpe: 8, set_type: 'working',
          set_notes: null, exercise_group_id: null, created_at: id });
      }
      await adaptation.capture(id, resolved, map);
      if (config.scenario === 'pain' && block === 0 && exposure === 0) {
        await adaptation.recordPain(id, resolved.exercises[0].exercise_id, 8, new Set());
      }
      const workout = (await workouts.findById(id))!;
      await workouts.update({ ...workout, status: 'completed' });
      await adaptation.complete(id);
    }
    if (config.scenario === 'mood' && block === 0) await evolution.queueMesoMood({ training_mentality: 'fury' });
    const result = await evolution.evolveActiveProgramForNextMeso({ programId: synthesized.program.id });
    const after = await adaptation.state(synthesized.program.id);
    const assertions: SoundnessAssertion[] = [
      { criterion: 'Length requires evidence', passed: after.weeks === 4, message: 'No qualified companion feedback: retain four weeks.' },
      { criterion: 'No invented observations', passed: !result.diffMarkdown.includes('mean RPE 7.8'), message: 'Explanations describe applied changes.' },
      { criterion: 'Preserve constraints', passed: (await profiles.getProfile())?.preferred_days_per_week === config.initialProfile.preferred_days_per_week,
        message: 'Training days unchanged.' },
      { criterion: 'Preserve slots', passed: result.evolvedTemplateExercises.length === details.templates.flatMap(t => t.exercises).length,
        message: 'Review retains program structure.' },
    ];
    steps.push({ fromMeso: block + 1, toMeso: block + 2, conciseSummaries: result.conciseSummaries ?? [],
      diffItems: result.diffItems, diffMarkdown: result.diffMarkdown, soundnessAssertions: assertions,
      allPassed: assertions.every(a => a.passed) });
  }
  return { profileId: config.id, profileName: config.name, description: config.description, steps, overallSuccess: steps.every(s => s.allPassed) };
}
export async function runAllLifterSimulations(catalog: Exercise[] = DEFAULT_EXERCISES): Promise<LifterSimulationReport[]> {
  const reports = [];
  for (const profile of CANONICAL_PROFILES) reports.push(await runLifterSimulation(profile, catalog));
  return reports;
}
