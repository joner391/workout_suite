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
import { ProgramBlockService } from '../../../services/programBlockService';
import {
  createLinearProgressionRule,
  createDoubleProgressionRule,
  createDynamicDoubleProgressionRule,
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
  });
});
