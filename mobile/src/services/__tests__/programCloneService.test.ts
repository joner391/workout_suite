import { MockProgramRepository } from '../../database/mocks/MockProgramRepository';
import {
  isCustomProgram,
  generateCustomProgramId,
  cloneProgramAsCustom,
} from '../programCloneService';
import { Program, WorkoutTemplate, TemplateExercise, ProgressionRule } from '../../core/types';

describe('ProgramCloneService (Section 1.1)', () => {
  let programRepo: MockProgramRepository;

  beforeEach(() => {
    programRepo = new MockProgramRepository();
  });

  test('correctly identifies custom programs by id prefix', () => {
    expect(isCustomProgram('prog_custom_12345_abcde')).toBe(true);
    expect(isCustomProgram('prog_default_ppl')).toBe(false);
    expect(isCustomProgram('prog_synth_hypertrophy')).toBe(false);
  });

  test('generates valid custom program id format', () => {
    const id = generateCustomProgramId();
    expect(id).toMatch(/^prog_custom_\d+_[a-z0-9]+$/);
  });

  test('deep-clones pre-built program with templates, exercises, rules and supersets', async () => {
    const originalProgram: Program = {
      id: 'prog_default_upper_lower',
      name: 'Default Upper / Lower',
      color_hex: '#3B82F6',
      notes: 'Standard 4-day split',
      created_at: '2026-01-01T00:00:00Z',
    };
    await programRepo.create(originalProgram);

    const template1: WorkoutTemplate = {
      id: 'tpl_upper_1',
      program_id: originalProgram.id,
      name: 'Upper A',
      notes: 'Chest & Back focus',
      order_index: 0,
      created_at: '2026-01-01T00:00:00Z',
    };
    await programRepo.createTemplate(template1);

    const exercise1: TemplateExercise = {
      id: 'te_bench_1',
      rest_seconds: 45,
      rest_pause: { mini_sets: 3, mini_reps_min: 3, mini_reps_max: 5, rest_seconds: 15 },
      template_id: template1.id,
      exercise_id: 'barbell_bench_press',
      gear_id: null,
      target_sets: 3,
      target_reps_min: 8,
      target_reps_max: 12,
      target_rpe: 8.5,
      target_rir: null,
      order_index: 0,
      exercise_group_id: 'ss_group_1',
    };
    const exercise2: TemplateExercise = {
      id: 'te_row_1',
      template_id: template1.id,
      exercise_id: 'barbell_bent_over_row',
      gear_id: null,
      target_sets: 3,
      target_reps_min: 8,
      target_reps_max: 12,
      target_rpe: 8.5,
      target_rir: null,
      order_index: 1,
      exercise_group_id: 'ss_group_1',
    };
    await programRepo.createTemplateExercise(exercise1);
    await programRepo.createTemplateExercise(exercise2);

    const rule: ProgressionRule = {
      id: 'rule_bench_lp',
      template_exercise_id: exercise1.id,
      priority: 1,
      rule_json: {
        conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
        actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
      },
    };
    await programRepo.createProgressionRule(rule);

    // Perform clone
    const clonedProgId = await cloneProgramAsCustom(programRepo, originalProgram.id);

    expect(isCustomProgram(clonedProgId)).toBe(true);

    const clonedDetails = await programRepo.getProgramWithDetails(clonedProgId);
    expect(clonedDetails).not.toBeNull();
    expect(clonedDetails?.program.id).toBe(clonedProgId);
    expect(clonedDetails?.program.name).toBe('Default Upper / Lower (Custom)');
    expect(clonedDetails?.program.notes).toContain('Cloned from Default Upper / Lower on');

    // Templates
    expect(clonedDetails?.templates.length).toBe(1);
    const clonedTmpl = clonedDetails!.templates[0];
    expect(clonedTmpl.id).not.toBe(template1.id);
    expect(clonedTmpl.program_id).toBe(clonedProgId);
    expect(clonedTmpl.name).toBe('Upper A');

    // Exercises
    expect(clonedTmpl.exercises.length).toBe(2);
    const clonedEx1 = clonedTmpl.exercises[0];
    const clonedEx2 = clonedTmpl.exercises[1];

    expect(clonedEx1.id).not.toBe(exercise1.id);
    expect(clonedEx1.rest_seconds).toBe(45);
    expect(clonedEx1.rest_pause).toEqual(exercise1.rest_pause);
    expect(clonedEx1.rest_pause).not.toBe(exercise1.rest_pause);
    expect(clonedEx2.id).not.toBe(exercise2.id);
    expect(clonedEx1.template_id).toBe(clonedTmpl.id);
    expect(clonedEx2.template_id).toBe(clonedTmpl.id);

    // Superset grouping maintained with new group ID
    expect(clonedEx1.exercise_group_id).not.toBeNull();
    expect(clonedEx2.exercise_group_id).not.toBeNull();
    expect(clonedEx1.exercise_group_id).toBe(clonedEx2.exercise_group_id);
    expect(clonedEx1.exercise_group_id).not.toBe('ss_group_1');

    // Progression rules
    expect(clonedEx1.rules.length).toBe(1);
    expect(clonedEx1.rules[0].id).not.toBe(rule.id);
    expect(clonedEx1.rules[0].template_exercise_id).toBe(clonedEx1.id);
  });
});
