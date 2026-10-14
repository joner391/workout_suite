import { MockProgramRepository } from '../MockProgramRepository';
import {
  Program,
  WorkoutTemplate,
  TemplateExercise,
  ProgressionRule,
  ProgramBlock,
  SynthesizedProgram,
} from '../../../core/types';

describe('MockProgramRepository', () => {
  let repo: MockProgramRepository;

  const sampleProgram: Program = {
    id: 'prog_ppl',
    name: 'Push Pull Legs Split',
    color_hex: '#EF4444',
    notes: '3-day hypertrophic meso-cycle',
    created_at: '2026-10-01T10:00:00Z',
  };

  const sampleTemplate: WorkoutTemplate = {
    id: 'tmpl_push',
    program_id: 'prog_ppl',
    name: 'Push Day A',
    notes: 'Heavy chest and triceps focus',
    order_index: 0,
    created_at: '2026-10-01T10:05:00Z',
  };

  const sampleTemplateExercise: TemplateExercise = {
    id: 'te_bench',
    template_id: 'tmpl_push',
    exercise_id: 'barbell_bench_press',
    gear_id: 'olympic_bar',
    target_sets: 3,
    target_reps_min: 8,
    target_reps_max: 12,
    target_rpe: 8.5,
    target_rir: 1.5,
    order_index: 0,
    exercise_group_id: null,
  };

  const sampleProgressionRule: ProgressionRule = {
    id: 'rule_bench_dp',
    template_exercise_id: 'te_bench',
    priority: 1,
    rule_json: {
      conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
      actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
    },
  };

  const sampleProgramBlock: ProgramBlock = {
    id: 'block_1',
    program_id: 'prog_ppl',
    start_date: '2026-10-01',
    end_date: null,
  };

  beforeEach(() => {
    repo = new MockProgramRepository();
  });

  describe('Programs CRUD', () => {
    it('creates and finds program by ID', async () => {
      await repo.create(sampleProgram);
      const found = await repo.findById(sampleProgram.id);
      expect(found).toEqual(sampleProgram);
    });

    it('returns null for non-existent program', async () => {
      const found = await repo.findById('non_existent');
      expect(found).toBeNull();
    });

    it('lists all programs ordered by created_at DESC', async () => {
      await repo.create(sampleProgram);
      await repo.create({
        id: 'prog_upper_lower',
        name: 'Upper Lower Split',
        color_hex: '#3B82F6',
        notes: null,
        created_at: '2026-10-05T10:00:00Z',
      });

      const all = await repo.findAll();
      expect(all.length).toBe(2);
      expect(all[0].id).toBe('prog_upper_lower');
      expect(all[1].id).toBe('prog_ppl');
    });

    it('updates an existing program', async () => {
      await repo.create(sampleProgram);
      const updated = await repo.update({
        ...sampleProgram,
        name: 'PPL Hypertrophy Split v2',
        color_hex: '#10B981',
      });

      expect(updated.name).toBe('PPL Hypertrophy Split v2');
      expect(updated.color_hex).toBe('#10B981');
      const found = await repo.findById(sampleProgram.id);
      expect(found?.name).toBe('PPL Hypertrophy Split v2');
    });

    it('deletes program and cascades deletion of templates, exercises, rules, and blocks', async () => {
      await repo.create(sampleProgram);
      await repo.createTemplate(sampleTemplate);
      await repo.createTemplateExercise(sampleTemplateExercise);
      await repo.createProgressionRule(sampleProgressionRule);
      await repo.createProgramBlock(sampleProgramBlock);

      await repo.delete(sampleProgram.id);

      expect(await repo.findById(sampleProgram.id)).toBeNull();
      expect(await repo.findTemplateById(sampleTemplate.id)).toBeNull();
      expect(await repo.findTemplateExerciseById(sampleTemplateExercise.id)).toBeNull();
      expect(await repo.findRulesByTemplateExerciseId(sampleTemplateExercise.id)).toEqual([]);
      expect(await repo.findProgramBlocksByProgramId(sampleProgram.id)).toEqual([]);
    });
  });

  describe('Workout Templates CRUD', () => {
    it('creates, finds, and lists templates by program_id', async () => {
      await repo.create(sampleProgram);
      await repo.createTemplate(sampleTemplate);
      await repo.createTemplate({
        id: 'tmpl_pull',
        program_id: 'prog_ppl',
        name: 'Pull Day A',
        notes: null,
        order_index: 1,
        created_at: '2026-10-01T10:06:00Z',
      });

      const templates = await repo.findTemplatesByProgramId('prog_ppl');
      expect(templates.length).toBe(2);
      expect(templates[0].id).toBe('tmpl_push');
      expect(templates[1].id).toBe('tmpl_pull');
    });

    it('updates template and deletes template with cascade', async () => {
      await repo.createTemplate(sampleTemplate);
      await repo.createTemplateExercise(sampleTemplateExercise);
      await repo.createProgressionRule(sampleProgressionRule);

      await repo.updateTemplate({
        ...sampleTemplate,
        name: 'Push Day A (Updated)',
      });

      const updated = await repo.findTemplateById(sampleTemplate.id);
      expect(updated?.name).toBe('Push Day A (Updated)');

      await repo.deleteTemplate(sampleTemplate.id);
      expect(await repo.findTemplateById(sampleTemplate.id)).toBeNull();
      expect(await repo.findTemplateExerciseById(sampleTemplateExercise.id)).toBeNull();
      expect(await repo.findRulesByTemplateExerciseId(sampleTemplateExercise.id)).toEqual([]);
    });
  });

  describe('Template Exercises and Progression Rules', () => {
    it('creates, updates, and sets template exercises', async () => {
      await repo.createTemplate(sampleTemplate);
      await repo.createTemplateExercise(sampleTemplateExercise);

      const exercises = await repo.findTemplateExercises(sampleTemplate.id);
      expect(exercises.length).toBe(1);
      expect(exercises[0].exercise_id).toBe('barbell_bench_press');

      // Update
      await repo.updateTemplateExercise({
        ...sampleTemplateExercise,
        target_sets: 4,
      });
      const updated = await repo.findTemplateExerciseById(sampleTemplateExercise.id);
      expect(updated?.target_sets).toBe(4);

      // setTemplateExercises
      const newTe: TemplateExercise = {
        id: 'te_incline',
        template_id: sampleTemplate.id,
        exercise_id: 'incline_dumbbell_press',
        gear_id: null,
        target_sets: 3,
        target_reps_min: 10,
        target_reps_max: 15,
        target_rpe: 8,
        target_rir: 2,
        order_index: 0,
        exercise_group_id: null,
      };

      await repo.setTemplateExercises(sampleTemplate.id, [newTe]);
      const replacedList = await repo.findTemplateExercises(sampleTemplate.id);
      expect(replacedList.length).toBe(1);
      expect(replacedList[0].id).toBe('te_incline');
    });

    it('creates, updates, queries, and sets progression rules', async () => {
      await repo.createTemplate(sampleTemplate);
      await repo.createTemplateExercise(sampleTemplateExercise);
      await repo.createProgressionRule(sampleProgressionRule);

      const rules = await repo.findRulesByTemplateExerciseId(sampleTemplateExercise.id);
      expect(rules.length).toBe(1);
      expect(rules[0].id).toBe(sampleProgressionRule.id);

      const templateRules = await repo.findRulesByTemplateId(sampleTemplate.id);
      expect(templateRules.length).toBe(1);

      // setProgressionRules
      const newRule: ProgressionRule = {
        id: 'rule_bench_lp',
        template_exercise_id: sampleTemplateExercise.id,
        priority: 0,
        rule_json: {
          conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 5.0 }],
        },
      };

      await repo.setProgressionRules(sampleTemplateExercise.id, [newRule]);
      const updatedRules = await repo.findRulesByTemplateExerciseId(sampleTemplateExercise.id);
      expect(updatedRules.length).toBe(1);
      expect(updatedRules[0].id).toBe('rule_bench_lp');
    });
  });

  describe('Program Blocks (Meso-Cycle Eras)', () => {
    it('manages active and historical program blocks', async () => {
      await repo.create(sampleProgram);
      await repo.createProgramBlock(sampleProgramBlock);

      const active = await repo.getActiveProgramBlock();
      expect(active).toEqual(sampleProgramBlock);

      // Update block to close it
      await repo.updateProgramBlock({
        ...sampleProgramBlock,
        end_date: '2026-10-31',
      });

      const closedActive = await repo.getActiveProgramBlock();
      expect(closedActive).toBeNull();

      const all = await repo.findAllProgramBlocks();
      expect(all.length).toBe(1);
      expect(all[0].end_date).toBe('2026-10-31');
    });
  });

  describe('Aggregate & Synthesized Program Operations', () => {
    it('persists and retrieves full synthesized program hierarchy', async () => {
      const synthesized: SynthesizedProgram = {
        program: sampleProgram,
        templates: [sampleTemplate],
        templateExercises: [sampleTemplateExercise],
        progressionRules: [sampleProgressionRule],
        summary: {
          splitType: 'ppl',
          daysPerWeek: 3,
          estimatedSessionDurationMins: 55,
          totalWeeklySets: 15,
          hasSupersets: false,
          progressionSchemeSummary: 'Dynamic Double Progression',
        },
      };

      await repo.saveSynthesizedProgram(synthesized);

      const details = await repo.getProgramWithDetails(sampleProgram.id);
      expect(details).not.toBeNull();
      expect(details?.program.id).toBe(sampleProgram.id);
      expect(details?.templates.length).toBe(1);
      expect(details?.templates[0].id).toBe(sampleTemplate.id);
      expect(details?.templates[0].exercises.length).toBe(1);
      expect(details?.templates[0].exercises[0].id).toBe(sampleTemplateExercise.id);
      expect(details?.templates[0].exercises[0].rules.length).toBe(1);
      expect(details?.templates[0].exercises[0].rules[0].id).toBe(sampleProgressionRule.id);
    });
  });
});
