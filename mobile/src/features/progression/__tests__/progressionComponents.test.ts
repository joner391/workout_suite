/**
 * Workout Suite — Progression & Program Overview Test Suite
 *
 * Implements Step 4.4 Verification Gate
 * Validates:
 * - Declarative progression rule presets (LP, DP, DDP per ADR-004, ADR-037)
 * - Custom rule creation, condition evaluation, and action synthesis
 * - Program Overview hierarchy browsing and 1-tap program swapping
 * - Meso-cycle era management via ProgramBlockService
 */

import { MockProgramRepository } from '../../../database/mocks/MockProgramRepository';
import {
  detectProgressionBadge,
  formatLifterProgramNotes,
} from '../ProgramOverviewScreen';
import { ProgramBlockService } from '../../../services/programBlockService';
import {
  createLinearProgressionRule,
  createDoubleProgressionRule,
  createDynamicDoubleProgressionRule,
  createEstimatedCapacityProgressionRule,
  evaluateProgressionRules,
  parseRuleDefinition,
} from '../../../core/rules/progressionRuleEngine';
import {
  Program,
  WorkoutTemplate,
  TemplateExercise,
  ProgressionRule,
  WorkoutSession,
  WorkoutSet,
} from '../../../core/types';

describe('Progression Builder & Program Overview Management (Step 4.4)', () => {
  let programRepo: MockProgramRepository;
  let blockService: ProgramBlockService;

  const sampleTemplateExercise: TemplateExercise = {
    id: 'tex-bench-1',
    template_id: 'tmpl-push-1',
    exercise_id: 'barbell_bench_press',
    gear_id: null,
    order_index: 0,
    target_sets: 3,
    target_reps_min: 8,
    target_reps_max: 12,
    target_rpe: 8,
    target_rir: 2,
    exercise_group_id: null,
  };

  beforeEach(() => {
    programRepo = new MockProgramRepository();
    blockService = new ProgramBlockService(programRepo);
  });

  describe('Progression Builder Presets & Custom Rules', () => {
    test('shows effort-based progression ahead of the rep-based fallback', async () => {
      const rules = [createEstimatedCapacityProgressionRule('tex-bench-1'), ...createDoubleProgressionRule('tex-bench-1')];
      await programRepo.setProgressionRules('tex-bench-1', rules);
      expect(detectProgressionBadge(await programRepo.findRulesByTemplateExerciseId('tex-bench-1'))).toBe('Effort');
    });
    test('linear progression preset produces correct condition-action schema', () => {
      const lpRules = createLinearProgressionRule('tex-bench-1', {
        incrementKg: 2.5,
        plateauThresholdSessions: 3,
        deloadPercent: 0.10,
      });

      expect(lpRules.length).toBe(2);
      expect(lpRules[0].priority).toBe(1);
      expect(lpRules[1].priority).toBe(2);

      const successDef = parseRuleDefinition(lpRules[0].rule_json);
      expect(successDef).not.toBeNull();
      expect(successDef?.conditions[0].type).toBe('ALL_SETS_HIT_TARGET_REPS');
      expect(successDef?.actions[0].type).toBe('INCREASE_LOAD_FIXED');
      expect(successDef?.actions[0].value).toBe(2.5);

      const plateauDef = parseRuleDefinition(lpRules[1].rule_json);
      expect(plateauDef).not.toBeNull();
      expect(plateauDef?.conditions[0].type).toBe('CONSECUTIVE_FAILED_SESSIONS');
      expect(plateauDef?.conditions[0].threshold).toBe(3);
      expect(plateauDef?.actions[0].type).toBe('RESET_WEIGHT_PERCENT');
      expect(plateauDef?.actions[0].value).toBe(0.10);
    });

    test('double progression preset resets reps to baseline when bracket ceiling is met', () => {
      const dpRules = createDoubleProgressionRule('tex-bench-1', {
        incrementKg: 2.5,
      });

      expect(dpRules.length).toBeGreaterThan(0);
      const def = parseRuleDefinition(dpRules[0].rule_json);
      expect(def).not.toBeNull();
      expect(def?.conditions[0].type).toBe('ALL_SETS_HIT_TARGET_REPS');
      expect(def?.actions.some((a) => a.type === 'INCREASE_LOAD_FIXED')).toBe(true);
      expect(def?.actions.some((a) => a.type === 'RESET_TO_BASELINE')).toBe(true);
    });

    test('dynamic double progression preset produces set-level advancement rules', () => {
      const ddpRules = createDynamicDoubleProgressionRule('tex-bench-1', {
        incrementKg: 2.5,
      });

      expect(ddpRules.length).toBeGreaterThan(0);
      const def = parseRuleDefinition(ddpRules[0].rule_json);
      expect(def).not.toBeNull();
      expect(def?.conditions[0].type).toBe('ANY_SET_HIT_TOP_REP_RANGE');
      expect(def?.actions[0].type).toBe('INCREASE_LOAD_FIXED');
    });

    test('evaluates progression rules against workout history and yields proposal', () => {
      const lpRules = createLinearProgressionRule('tex-bench-1', { incrementKg: 2.5 });

      // Simulate a successful prior workout: 3 sets of 12 reps @ 80kg
      const completedSets: WorkoutSet[] = [
        {
          id: 'set-1',
          workout_id: 'w-1',
          exercise_id: 'barbell_bench_press',
          gear_id: null,
          set_number: 1,
          weight: 80,
          raw_input_weight: 80,
          added_weight: null,
          reps: 12,
          reps_right: null,
          rpe: 8,
          rir: 2,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: '2026-10-10T10:00:00Z',
        },
        {
          id: 'set-2',
          workout_id: 'w-1',
          exercise_id: 'barbell_bench_press',
          gear_id: null,
          set_number: 2,
          weight: 80,
          raw_input_weight: 80,
          added_weight: null,
          reps: 12,
          reps_right: null,
          rpe: 8.5,
          rir: 1.5,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: '2026-10-10T10:03:00Z',
        },
        {
          id: 'set-3',
          workout_id: 'w-1',
          exercise_id: 'barbell_bench_press',
          gear_id: null,
          set_number: 3,
          weight: 80,
          raw_input_weight: 80,
          added_weight: null,
          reps: 12,
          reps_right: null,
          rpe: 9,
          rir: 1,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: '2026-10-10T10:06:00Z',
        },
      ];

      const sessions: WorkoutSession[] = [
        {
          workoutId: 'w-1',
          date: '2026-10-10',
          sets: completedSets,
        },
      ];

      const evaluation = evaluateProgressionRules(lpRules, sessions, sampleTemplateExercise);
      expect(evaluation.hasMatches).toBe(true);
      expect(evaluation.primaryProposal).not.toBeNull();
      expect(evaluation.primaryProposal?.actionType).toBe('INCREASE_LOAD_FIXED');
      expect(evaluation.primaryProposal?.suggestedWeightKg).toBe(82.5);
      expect(evaluation.primaryProposal?.explanation).toContain('82.5');
    });

    test('persists custom progression rules via IProgramRepository', async () => {
      const customRule: ProgressionRule = {
        id: 'rule-custom-rpe',
        template_exercise_id: 'tex-bench-1',
        priority: 1,
        rule_json: {
          conditions: [{ type: 'AVERAGE_RPE_LESS_THAN', threshold: 7 }],
          actions: [{ type: 'INCREASE_LOAD_PERCENT', value: 0.05 }],
          notes: 'Auto-regulate: bump load by 5% when RPE is lower than 7',
        },
      };

      await programRepo.setProgressionRules('tex-bench-1', [customRule]);

      const stored = await programRepo.findRulesByTemplateExerciseId('tex-bench-1');
      expect(stored.length).toBe(1);
      expect(stored[0].id).toBe('rule-custom-rpe');

      await programRepo.deleteProgressionRule('rule-custom-rpe');
      const afterDelete = await programRepo.findRulesByTemplateExerciseId('tex-bench-1');
      expect(afterDelete.length).toBe(0);
    });
  });

  describe('Program Overview & Split Management', () => {
    test('loads multi-day programs and templates correctly', async () => {
      const p1: Program = {
        id: 'prog-ppl',
        name: 'PPL Hypertrophy Split',
        color_hex: '#3B82F6',
        notes: null,
        created_at: new Date().toISOString(),
      };

      const t1: WorkoutTemplate = {
        id: 'tmpl-push-a',
        program_id: 'prog-ppl',
        name: 'Push A',
        order_index: 0,
        notes: null,
        created_at: new Date().toISOString(),
      };

      await programRepo.create(p1);
      await programRepo.createTemplate(t1);
      await programRepo.createTemplateExercise(sampleTemplateExercise);

      const allPrograms = await programRepo.findAll();
      expect(allPrograms.length).toBe(1);
      expect(allPrograms[0].name).toBe('PPL Hypertrophy Split');

      const details = await programRepo.getProgramWithDetails('prog-ppl');
      expect(details).not.toBeNull();
      expect(details?.templates.length).toBe(1);
      expect(details?.templates[0].name).toBe('Push A');
    });

    test('1-tap swap active program creates new era and marks previous as completed', async () => {
      const p1: Program = {
        id: 'prog-1',
        name: 'Upper Lower Block',
        color_hex: '#10B981',
        notes: null,
        created_at: new Date().toISOString(),
      };

      const p2: Program = {
        id: 'prog-2',
        name: 'Full Body Deload',
        color_hex: '#F59E0B',
        notes: null,
        created_at: new Date().toISOString(),
      };

      await programRepo.create(p1);
      await programRepo.create(p2);

      // Start initial program era
      const block1 = await blockService.swapActiveProgram('prog-1', '2026-09-01');
      expect(block1.program_id).toBe('prog-1');
      expect(block1.end_date).toBeNull();

      // Swap to program 2
      const block2 = await blockService.swapActiveProgram('prog-2', '2026-10-01');
      expect(block2.program_id).toBe('prog-2');
      expect(block2.end_date).toBeNull();

      // Verify block 1 was terminated on 2026-10-01
      const block1Updated = await programRepo.findProgramBlockById(block1.id);
      expect(block1Updated?.end_date).toBe('2026-10-01');

      // Verify active program is now prog-2
      const active = await blockService.getActiveProgram();
      expect(active?.program.id).toBe('prog-2');
    });

    test('supports template CRUD and exercise prescription reordering/supersets', async () => {
      const prog: Program = {
        id: 'prog_custom_test_123',
        name: 'Custom Upper Lower',
        color_hex: '#3B82F6',
        notes: 'Test split',
        created_at: new Date().toISOString(),
      };
      await programRepo.create(prog);

      // 1. Add Days
      const tmpl1: WorkoutTemplate = {
        id: 'tpl_day_1',
        program_id: prog.id,
        name: 'Day 1 — Upper',
        order_index: 0,
        notes: null,
        created_at: new Date().toISOString(),
      };
      const tmpl2: WorkoutTemplate = {
        id: 'tpl_day_2',
        program_id: prog.id,
        name: 'Day 2 — Lower',
        order_index: 1,
        notes: null,
        created_at: new Date().toISOString(),
      };
      await programRepo.createTemplate(tmpl1);
      await programRepo.createTemplate(tmpl2);

      // Reorder days
      await programRepo.updateTemplate({ ...tmpl1, order_index: 1 });
      await programRepo.updateTemplate({ ...tmpl2, order_index: 0 });

      let details = await programRepo.getProgramWithDetails(prog.id);
      expect(details?.templates.length).toBe(2);
      const sortedTemplates = details!.templates.sort((a, b) => a.order_index - b.order_index);
      expect(sortedTemplates[0].name).toBe('Day 2 — Lower');
      expect(sortedTemplates[1].name).toBe('Day 1 — Upper');

      // 2. Add Exercises & Superset
      const ex1: TemplateExercise = {
        id: 'te_1',
        template_id: tmpl1.id,
        exercise_id: 'bench_press',
        gear_id: null,
        target_sets: 3,
        target_reps_min: 8,
        target_reps_max: 12,
        target_rpe: 8.0,
        target_rir: null,
        order_index: 0,
        exercise_group_id: null,
      };
      const ex2: TemplateExercise = {
        id: 'te_2',
        template_id: tmpl1.id,
        exercise_id: 'cable_row',
        gear_id: null,
        target_sets: 3,
        target_reps_min: 8,
        target_reps_max: 12,
        target_rpe: 8.0,
        target_rir: null,
        order_index: 1,
        exercise_group_id: null,
      };
      await programRepo.createTemplateExercise(ex1);
      await programRepo.createTemplateExercise(ex2);

      // Link in superset
      const ssId = 'ss_day1_1';
      await programRepo.updateTemplateExercise({ ...ex1, exercise_group_id: ssId });
      await programRepo.updateTemplateExercise({ ...ex2, exercise_group_id: ssId });

      let tmpl1Details = await programRepo.getTemplateWithDetails(tmpl1.id);
      expect(tmpl1Details?.exercises.length).toBe(2);
      expect(tmpl1Details?.exercises[0].exercise_group_id).toBe(ssId);
      expect(tmpl1Details?.exercises[1].exercise_group_id).toBe(ssId);

      // 3. Swap Exercise
      await programRepo.updateTemplateExercise({ ...ex1, exercise_id: 'incline_dumbbell_press' });
      tmpl1Details = await programRepo.getTemplateWithDetails(tmpl1.id);
      expect(tmpl1Details?.exercises[0].exercise_id).toBe('incline_dumbbell_press');
      expect(tmpl1Details?.exercises[0].target_sets).toBe(3); // Preserved prescription!

      // 4. Delete Exercise
      await programRepo.deleteTemplateExercise('te_2');
      tmpl1Details = await programRepo.getTemplateWithDetails(tmpl1.id);
      expect(tmpl1Details?.exercises.length).toBe(1);

      // 5. Delete Day
      await programRepo.deleteTemplate(tmpl2.id);
      details = await programRepo.getProgramWithDetails(prog.id);
      expect(details?.templates.length).toBe(1);
    });

    test('prescribes custom gear (e.g., Safety Squat Bar) to template exercises', async () => {
      const prog: Program = {
        id: 'prog_squat_spec',
        name: 'Powerlifting Squat Specialization',
        color_hex: '#EF4444',
        notes: null,
        created_at: new Date().toISOString(),
      };
      await programRepo.create(prog);

      const tmpl: WorkoutTemplate = {
        id: 'tmpl_squat_day',
        program_id: prog.id,
        name: 'Day 1: Heavy Squat Focus',
        order_index: 0,
        notes: null,
        created_at: new Date().toISOString(),
      };
      await programRepo.createTemplate(tmpl);

      // Prescribe Barbell Back Squat specifically with Safety Squat Bar (29 kg)
      await programRepo.createTemplateExercise({
        id: 'te_ssb_squat',
        template_id: tmpl.id,
        exercise_id: 'barbell_back_squat',
        gear_id: 'gear_bar_ssb_29kg',
        target_sets: 4,
        target_reps_min: 6,
        target_reps_max: 8,
        target_rpe: 8.5,
        target_rir: null,
        order_index: 0,
        exercise_group_id: null,
      });

      // Prescribe Barbell Bench Press with standard bar (gear_id: null)
      await programRepo.createTemplateExercise({
        id: 'te_std_bench',
        template_id: tmpl.id,
        exercise_id: 'barbell_bench_press',
        gear_id: null,
        target_sets: 3,
        target_reps_min: 8,
        target_reps_max: 10,
        target_rpe: 8.0,
        target_rir: null,
        order_index: 1,
        exercise_group_id: null,
      });

      const details = await programRepo.getTemplateWithDetails(tmpl.id);
      expect(details?.exercises).toHaveLength(2);
      expect(details?.exercises[0].exercise_id).toBe('barbell_back_squat');
      expect(details?.exercises[0].gear_id).toBe('gear_bar_ssb_29kg');
      expect(details?.exercises[1].exercise_id).toBe('barbell_bench_press');
      expect(details?.exercises[1].gear_id).toBeNull();
    });
  });

  describe('Lifter-Centric Program Overview Presentation & Progression Badges', () => {
    test('detectProgressionBadge correctly identifies LP, DP, DDP, and Custom presets', () => {
      expect(detectProgressionBadge([])).toBeNull();
      expect(detectProgressionBadge(undefined)).toBeNull();

      const lp = createLinearProgressionRule('te-1');
      expect(detectProgressionBadge(lp)).toBe('LP');

      const dp = createDoubleProgressionRule('te-2');
      expect(detectProgressionBadge(dp)).toBe('DP');

      const ddp = createDynamicDoubleProgressionRule('te-3');
      expect(detectProgressionBadge(ddp)).toBe('DDP');

      const customRule: ProgressionRule = {
        id: 'rule-custom-99',
        template_exercise_id: 'te-4',
        priority: 1,
        rule_json: {
          conditions: [{ type: 'CONSECUTIVE_SUCCESSFUL_SESSIONS', threshold: 2 }],
          actions: [{ type: 'INCREASE_LOAD_PERCENT', value: 0.05 }],
          notes: 'Custom wave load progression',
        },
      };
      expect(detectProgressionBadge([customRule])).toBe('Custom');
    });

    test('formatLifterProgramNotes removes raw HTML comments and formats mentalities & archetypes', () => {
      expect(formatLifterProgramNotes(null)).toBeNull();
      expect(formatLifterProgramNotes('')).toBeNull();

      const rawEvolvedNotes =
        'Mesocycle 2 (Evolved for fury mentality, archetype_ii_strength_primary).\n<!-- TRANSITION_WAVE: {"from":"precision","to":"fury","totalWeeks":3} -->\nSynthesized for male lifter (fury mentality, 60m/session, 4d/wk, archetype_ii_strength_primary).';

      const formatted = formatLifterProgramNotes(rawEvolvedNotes);
      expect(formatted).not.toBeNull();
      expect(formatted).not.toContain('<!--');
      expect(formatted).not.toContain('TRANSITION_WAVE');
      expect(formatted).not.toContain('archetype_ii_strength_primary');
      expect(formatted).toContain('Fury (High Intensity)');
      expect(formatted).toContain('Strength & Hypertrophy');
      expect(formatted).toContain('60m/session');
    });

    test('formatLifterProgramNotes preserves clean custom user notes', () => {
      const userNotes = '4-Day Torso/Limbs specialized cycle with heavy bench focus';
      expect(formatLifterProgramNotes(userNotes)).toBe(userNotes);
    });
  });
});
