import {
  evaluateProgressionRules,
  createLinearProgressionRule,
  createDoubleProgressionRule,
  createDynamicDoubleProgressionRule,
  parseRuleDefinition,
  isSessionSuccessful,
} from '../progressionRuleEngine';
import {
  TemplateExercise,
  WorkoutSet,
  WorkoutSession,
  ProgressionRule,
} from '../../types';

describe('Progression Rule Engine', () => {
  const mockExerciseId = 'ex-bench-press';
  const mockTemplateId = 'template-upper-1';
  const mockTemplateExerciseId = 'te-bench-01';

  const defaultPrescription: TemplateExercise = {
    id: mockTemplateExerciseId,
    template_id: mockTemplateId,
    exercise_id: mockExerciseId,
    gear_id: null,
    target_sets: 3,
    target_reps_min: 8,
    target_reps_max: 12,
    target_rpe: 8.5,
    target_rir: 1.5,
    order_index: 0,
    exercise_group_id: null,
  };

  const createSet = (
    setNumber: number,
    weight: number,
    reps: number,
    options: Partial<WorkoutSet> = {}
  ): WorkoutSet => ({
    id: `set-${Math.random().toString(36).substring(2, 9)}`,
    workout_id: 'wo-test',
    exercise_id: mockExerciseId,
    gear_id: null,
    set_number: setNumber,
    weight,
    raw_input_weight: weight,
    added_weight: null,
    reps,
    reps_right: null,
    rpe: options.rpe ?? 8.0,
    rir: options.rir ?? 2.0,
    set_type: options.set_type ?? 'working',
    set_notes: null,
    exercise_group_id: null,
    created_at: options.created_at ?? '2026-10-10T10:00:00Z',
    ...options,
  });

  const createSession = (
    date: string,
    sets: WorkoutSet[],
    workoutId = 'wo-test'
  ): WorkoutSession => ({
    workoutId,
    date,
    sets,
  });

  // ==========================================================================
  // Edge Cases & Robustness
  // ==========================================================================

  describe('Edge Cases & Defensive Handling', () => {
    it('returns empty result when rules array is empty', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        createSet(3, 100, 12),
      ]);

      const result = evaluateProgressionRules([], [session], defaultPrescription);

      expect(result.hasMatches).toBe(false);
      expect(result.primaryProposal).toBeNull();
      expect(result.matchedProposals).toHaveLength(0);
      expect(result.evaluatedRulesCount).toBe(0);
    });

    it('returns empty result when sessions array is empty', () => {
      const rules = createLinearProgressionRule(mockTemplateExerciseId);
      const result = evaluateProgressionRules(rules, [], defaultPrescription);

      expect(result.hasMatches).toBe(false);
      expect(result.primaryProposal).toBeNull();
      expect(result.recentSessionsEvaluated).toBe(0);
    });

    it('ignores sessions that do not contain sets for the target exercise', () => {
      const otherExerciseSet = createSet(1, 100, 10, {
        exercise_id: 'ex-squat',
      });
      const session = createSession('2026-10-10', [otherExerciseSet]);

      const rules = createLinearProgressionRule(mockTemplateExerciseId);
      const result = evaluateProgressionRules(rules, [session], defaultPrescription);

      expect(result.hasMatches).toBe(false);
      expect(result.recentSessionsEvaluated).toBe(0);
    });

    it('ignores warmup sets when evaluating success and RPE', () => {
      const warmupSet = createSet(1, 60, 5, { set_type: 'warmup', reps: 5 });
      const workingSet1 = createSet(2, 100, 12);
      const workingSet2 = createSet(3, 100, 12);
      const workingSet3 = createSet(4, 100, 12);

      const session = createSession('2026-10-10', [
        warmupSet,
        workingSet1,
        workingSet2,
        workingSet3,
      ]);

      const rules = createLinearProgressionRule(mockTemplateExerciseId);
      const result = evaluateProgressionRules(rules, [session], defaultPrescription);

      expect(result.hasMatches).toBe(true);
      expect(result.primaryProposal?.suggestedWeightKg).toBe(102.5);
    });

    it('parses stringified JSON in rule_json without throwing', () => {
      const serializedRule: ProgressionRule = {
        id: 'rule-str-01',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: JSON.stringify({
          conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 5.0 }],
        }),
      };

      const session = createSession('2026-10-10', [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        createSet(3, 100, 12),
      ]);

      const result = evaluateProgressionRules(
        [serializedRule],
        [session],
        defaultPrescription
      );

      expect(result.hasMatches).toBe(true);
      expect(result.primaryProposal?.suggestedWeightKg).toBe(105.0);
    });

    it('safely skips malformed rule JSON', () => {
      const malformedRule: ProgressionRule = {
        id: 'rule-bad-01',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: '{ invalid json format [',
      };

      const session = createSession('2026-10-10', [createSet(1, 100, 12)]);
      const result = evaluateProgressionRules(
        [malformedRule],
        [session],
        defaultPrescription
      );

      expect(result.hasMatches).toBe(false);
      expect(result.evaluatedRulesCount).toBe(1);
    });

    it('sorts sessions chronologically even if provided out of order', () => {
      // Session A (earlier date): hit target (12, 12, 12)
      // Session B (later date): failed target (8, 8, 8)
      const sessionA = createSession('2026-10-01', [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        createSet(3, 100, 12),
      ]);
      const sessionB = createSession('2026-10-08', [
        createSet(1, 102.5, 8),
        createSet(2, 102.5, 8),
        createSet(3, 102.5, 7),
      ]);

      // Provide in reverse order [sessionB, sessionA]
      const rules = createLinearProgressionRule(mockTemplateExerciseId);
      const result = evaluateProgressionRules(
        rules,
        [sessionB, sessionA],
        defaultPrescription
      );

      // Latest session is sessionB (2026-10-08), which failed -> LP should NOT trigger increase
      expect(result.primaryProposal?.actionType).not.toBe('INCREASE_LOAD_FIXED');
    });
  });

  // ==========================================================================
  // Condition Evaluators
  // ==========================================================================

  describe('Condition: ALL_SETS_HIT_TARGET_REPS', () => {
    it('triggers when all working sets meet target_reps_max', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        createSet(3, 100, 13), // 13 >= 12
      ]);

      const rule: ProgressionRule = {
        id: 'r1',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
        },
      };

      const result = evaluateProgressionRules([rule], [session], defaultPrescription);
      expect(result.hasMatches).toBe(true);
      expect(result.primaryProposal?.suggestedWeightKg).toBe(102.5);
    });

    it('does not trigger if one set falls short of target_reps_max', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        createSet(3, 100, 11), // 11 < 12
      ]);

      const rule: ProgressionRule = {
        id: 'r1',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
        },
      };

      const result = evaluateProgressionRules([rule], [session], defaultPrescription);
      expect(result.hasMatches).toBe(false);
    });

    it('does not trigger if set count is less than target_sets', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        // missing set 3 (prescription requires 3 sets)
      ]);

      const rule: ProgressionRule = {
        id: 'r1',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
        },
      };

      const result = evaluateProgressionRules([rule], [session], defaultPrescription);
      expect(result.hasMatches).toBe(false);
    });

    it('falls back to target_reps_min for fixed-rep schemes (e.g. 5x5)', () => {
      const prescription5x5: TemplateExercise = {
        ...defaultPrescription,
        target_sets: 5,
        target_reps_min: 5,
        target_reps_max: null,
      };

      const session = createSession('2026-10-10', [
        createSet(1, 140, 5),
        createSet(2, 140, 5),
        createSet(3, 140, 5),
        createSet(4, 140, 5),
        createSet(5, 140, 5),
      ]);

      const rule: ProgressionRule = {
        id: 'r1',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
        },
      };

      const result = evaluateProgressionRules([rule], [session], prescription5x5);
      expect(result.hasMatches).toBe(true);
      expect(result.primaryProposal?.suggestedWeightKg).toBe(142.5);
    });
  });

  describe('Condition: ANY_SET_HIT_TOP_REP_RANGE', () => {
    it('triggers when at least one set reaches target_reps_max', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 12), // hit top
        createSet(2, 100, 10), // below
        createSet(3, 100, 8),  // below
      ]);

      const rule: ProgressionRule = {
        id: 'r-any',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [{ type: 'ANY_SET_HIT_TOP_REP_RANGE' }],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
        },
      };

      const result = evaluateProgressionRules([rule], [session], defaultPrescription);
      expect(result.hasMatches).toBe(true);
    });

    it('does not trigger if all sets fall below top of rep range', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 11),
        createSet(2, 100, 10),
        createSet(3, 100, 9),
      ]);

      const rule: ProgressionRule = {
        id: 'r-any',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [{ type: 'ANY_SET_HIT_TOP_REP_RANGE' }],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
        },
      };

      const result = evaluateProgressionRules([rule], [session], defaultPrescription);
      expect(result.hasMatches).toBe(false);
    });
  });

  describe('Condition: AVERAGE_RPE_LESS_THAN', () => {
    it('evaluates average RPE correctly and triggers when below threshold', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 10, { rpe: 7.0 }),
        createSet(2, 100, 10, { rpe: 7.5 }),
        createSet(3, 100, 10, { rpe: 7.5 }),
      ]); // avg = 7.33

      const rule: ProgressionRule = {
        id: 'r-rpe',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [
            { type: 'ALL_SETS_HIT_TARGET_REPS' },
            { type: 'AVERAGE_RPE_LESS_THAN', threshold: 8.0 },
          ],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
        },
      };

      const prescription10reps: TemplateExercise = {
        ...defaultPrescription,
        target_reps_min: 10,
        target_reps_max: 10,
      };

      const result = evaluateProgressionRules([rule], [session], prescription10reps);
      expect(result.hasMatches).toBe(true);
      expect(result.primaryProposal?.suggestedWeightKg).toBe(102.5);
    });

    it('fails when average RPE equals or exceeds threshold', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 10, { rpe: 8.5 }),
        createSet(2, 100, 10, { rpe: 9.0 }),
        createSet(3, 100, 10, { rpe: 9.5 }),
      ]); // avg = 9.0

      const rule: ProgressionRule = {
        id: 'r-rpe',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [{ type: 'AVERAGE_RPE_LESS_THAN', threshold: 8.0 }],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
        },
      };

      const result = evaluateProgressionRules([rule], [session], defaultPrescription);
      expect(result.hasMatches).toBe(false);
    });

    it('infers RPE from RIR when RPE is null (10 - RIR)', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 10, { rpe: null, rir: 3.0 }), // RPE 7.0
        createSet(2, 100, 10, { rpe: null, rir: 2.5 }), // RPE 7.5
        createSet(3, 100, 10, { rpe: null, rir: 2.5 }), // RPE 7.5
      ]);

      const rule: ProgressionRule = {
        id: 'r-rir-to-rpe',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [{ type: 'AVERAGE_RPE_LESS_THAN', threshold: 8.0 }],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
        },
      };

      const result = evaluateProgressionRules([rule], [session], defaultPrescription);
      expect(result.hasMatches).toBe(true);
    });
  });

  describe('Condition: CONSECUTIVE_SUCCESSFUL_SESSIONS', () => {
    it('triggers when last N sessions were all successful', () => {
      const s1 = createSession('2026-10-01', [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        createSet(3, 100, 12),
      ]);
      const s2 = createSession('2026-10-05', [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        createSet(3, 100, 12),
      ]);

      const rule: ProgressionRule = {
        id: 'r-consec',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [
            { type: 'CONSECUTIVE_SUCCESSFUL_SESSIONS', threshold: 2 },
          ],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 5.0 }],
        },
      };

      const result = evaluateProgressionRules([rule], [s1, s2], defaultPrescription);
      expect(result.hasMatches).toBe(true);
      expect(result.primaryProposal?.suggestedWeightKg).toBe(105.0);
    });

    it('fails if one of the last N sessions failed target reps', () => {
      const s1 = createSession('2026-10-01', [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        createSet(3, 100, 12),
      ]);
      const s2 = createSession('2026-10-05', [
        createSet(1, 100, 12),
        createSet(2, 100, 11), // failed
        createSet(3, 100, 10),
      ]);

      const rule: ProgressionRule = {
        id: 'r-consec',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [
            { type: 'CONSECUTIVE_SUCCESSFUL_SESSIONS', threshold: 2 },
          ],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 5.0 }],
        },
      };

      const result = evaluateProgressionRules([rule], [s1, s2], defaultPrescription);
      expect(result.hasMatches).toBe(false);
    });
  });

  describe('Condition: CONSECUTIVE_FAILED_SESSIONS', () => {
    it('triggers deload after 3 consecutive plateau sessions', () => {
      const s1 = createSession('2026-10-01', [
        createSet(1, 100, 9),
        createSet(2, 100, 8),
        createSet(3, 100, 8),
      ]);
      const s2 = createSession('2026-10-05', [
        createSet(1, 100, 9),
        createSet(2, 100, 8),
        createSet(3, 100, 7),
      ]);
      const s3 = createSession('2026-10-09', [
        createSet(1, 100, 8),
        createSet(2, 100, 8),
        createSet(3, 100, 7),
      ]);

      const rule: ProgressionRule = {
        id: 'r-plateau',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [
            { type: 'CONSECUTIVE_FAILED_SESSIONS', threshold: 3 },
          ],
          actions: [{ type: 'RESET_WEIGHT_PERCENT', value: 0.10 }],
        },
      };

      const result = evaluateProgressionRules(
        [rule],
        [s1, s2, s3],
        defaultPrescription
      );
      expect(result.hasMatches).toBe(true);
      // 100 kg - 10% = 90 kg
      expect(result.primaryProposal?.suggestedWeightKg).toBe(90.0);
      expect(result.primaryProposal?.explanation).toContain('Deload load by 10%');
    });
  });

  describe('Condition: MISSED_REPS_COUNT and TOP_SET_RIR', () => {
    it('evaluates MISSED_REPS_COUNT against target_reps_min', () => {
      // Prescription: target_reps_min = 8.
      // Set 1: 8 (0 missed)
      // Set 2: 6 (2 missed)
      // Set 3: 5 (3 missed) -> total missed = 5 reps
      const session = createSession('2026-10-10', [
        createSet(1, 100, 8),
        createSet(2, 100, 6),
        createSet(3, 100, 5),
      ]);

      const rule: ProgressionRule = {
        id: 'r-missed',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [
            { type: 'MISSED_REPS_COUNT', threshold: 4, comparison: 'gte' },
          ],
          actions: [{ type: 'DECREASE_LOAD_FIXED', value: 5.0 }],
        },
      };

      const result = evaluateProgressionRules([rule], [session], defaultPrescription);
      expect(result.hasMatches).toBe(true);
      expect(result.primaryProposal?.suggestedWeightKg).toBe(95.0);
    });

    it('evaluates TOP_SET_RIR_GREATER_THAN', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 10, { rir: 1.0 }),
        createSet(2, 100, 10, { rir: 2.0 }),
        createSet(3, 100, 10, { rir: 3.5 }), // max RIR = 3.5
      ]);

      const rule: ProgressionRule = {
        id: 'r-easy',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [
            { type: 'TOP_SET_RIR_GREATER_THAN', threshold: 3.0, comparison: 'gt' },
          ],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 5.0 }],
        },
      };

      const result = evaluateProgressionRules([rule], [session], defaultPrescription);
      expect(result.hasMatches).toBe(true);
      expect(result.primaryProposal?.suggestedWeightKg).toBe(105.0);
    });
  });

  // ==========================================================================
  // Action Synthesizers
  // ==========================================================================

  describe('Action Synthesizers', () => {
    it('handles INCREASE_LOAD_PERCENT with fractions and percentages', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        createSet(3, 100, 12),
      ]);

      // 5% as 0.05
      const rule1: ProgressionRule = {
        id: 'r-pct-1',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
          actions: [{ type: 'INCREASE_LOAD_PERCENT', value: 0.05 }],
        },
      };

      const res1 = evaluateProgressionRules([rule1], [session], defaultPrescription);
      expect(res1.primaryProposal?.suggestedWeightKg).toBe(105.0);

      // 5% as 5
      const rule2: ProgressionRule = {
        id: 'r-pct-2',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
          actions: [{ type: 'INCREASE_LOAD_PERCENT', value: 5 }],
        },
      };

      const res2 = evaluateProgressionRules([rule2], [session], defaultPrescription);
      expect(res2.primaryProposal?.suggestedWeightKg).toBe(105.0);
    });

    it('handles INCREASE_TARGET_REPS and ADD_WORKING_SET actions', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 10),
        createSet(2, 100, 10),
        createSet(3, 100, 10),
      ]);

      const rule: ProgressionRule = {
        id: 'r-reps-sets',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
          actions: [
            { type: 'INCREASE_TARGET_REPS', value: 1 },
            { type: 'ADD_WORKING_SET', value: 1 },
          ],
        },
      };

      const prescription10: TemplateExercise = {
        ...defaultPrescription,
        target_sets: 3,
        target_reps_min: 10,
        target_reps_max: 10,
      };

      const result = evaluateProgressionRules([rule], [session], prescription10);
      expect(result.hasMatches).toBe(true);
      expect(result.primaryProposal?.suggestedTargetReps).toBe(11);
      expect(result.primaryProposal?.suggestedTargetSets).toBe(4);
    });

    it('handles TRIGGER_DELOAD action', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 8),
        createSet(2, 100, 8),
        createSet(3, 100, 8),
      ]);

      const rule: ProgressionRule = {
        id: 'r-del',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
          actions: [{ type: 'TRIGGER_DELOAD', value: 0.15 }],
        },
      };

      const prescription8: TemplateExercise = {
        ...defaultPrescription,
        target_reps_min: 8,
        target_reps_max: 8,
      };

      const result = evaluateProgressionRules([rule], [session], prescription8);
      expect(result.hasMatches).toBe(true);
      expect(result.primaryProposal?.isDeload).toBe(true);
      expect(result.primaryProposal?.suggestedWeightKg).toBe(85.0);
    });
  });

  // ==========================================================================
  // Presets: LP, DP, and DDP
  // ==========================================================================

  describe('Preset: Linear Progression (LP)', () => {
    const lpRules = createLinearProgressionRule(mockTemplateExerciseId, {
      incrementKg: 2.5,
      plateauThresholdSessions: 3,
      deloadPercent: 0.10,
    });

    it('proposes +2.5 kg when target reps are met', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        createSet(3, 100, 12),
      ]);

      const result = evaluateProgressionRules(lpRules, [session], defaultPrescription);
      expect(result.hasMatches).toBe(true);
      expect(result.primaryProposal?.actionType).toBe('INCREASE_LOAD_FIXED');
      expect(result.primaryProposal?.suggestedWeightKg).toBe(102.5);
    });

    it('proposes 10% deload after 3 consecutive failed sessions', () => {
      const s1 = createSession('2026-10-01', [createSet(1, 100, 9), createSet(2, 100, 8), createSet(3, 100, 7)]);
      const s2 = createSession('2026-10-03', [createSet(1, 100, 8), createSet(2, 100, 8), createSet(3, 100, 7)]);
      const s3 = createSession('2026-10-05', [createSet(1, 100, 8), createSet(2, 100, 7), createSet(3, 100, 7)]);

      const result = evaluateProgressionRules(lpRules, [s1, s2, s3], defaultPrescription);
      expect(result.hasMatches).toBe(true);
      expect(result.primaryProposal?.actionType).toBe('RESET_WEIGHT_PERCENT');
      expect(result.primaryProposal?.suggestedWeightKg).toBe(90.0);
    });
  });

  describe('Preset: Double Progression (DP)', () => {
    const dpRules = createDoubleProgressionRule(mockTemplateExerciseId, {
      incrementKg: 2.5,
    });

    it('increases load and resets target reps to baseline when all sets hit top bracket', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        createSet(3, 100, 12),
      ]);

      const result = evaluateProgressionRules(dpRules, [session], defaultPrescription);
      expect(result.hasMatches).toBe(true);
      expect(result.primaryProposal?.suggestedWeightKg).toBe(102.5);
      expect(result.primaryProposal?.suggestedTargetReps).toBe(8); // Reset to base of 8-12 bracket
    });
  });

  describe('Preset: Dynamic Double Progression (DDP)', () => {
    const ddpRules = createDynamicDoubleProgressionRule(mockTemplateExerciseId, {
      incrementKg: 2.5,
    });

    it('evaluates individual sets and produces per-set recommendations', () => {
      // Set 1: 12 reps (hit ceiling 12) -> +2.5 kg
      // Set 2: 10 reps (below 12) -> maintain 100 kg
      // Set 3: 9 reps (below 12) -> maintain 100 kg
      const session = createSession('2026-10-10', [
        createSet(1, 100, 12),
        createSet(2, 100, 10),
        createSet(3, 100, 9),
      ]);

      const result = evaluateProgressionRules(ddpRules, [session], defaultPrescription);
      expect(result.hasMatches).toBe(true);

      const proposal = result.primaryProposal;
      expect(proposal).not.toBeNull();
      expect(proposal?.setProposals).toBeDefined();
      expect(proposal?.setProposals).toHaveLength(3);

      const set1 = proposal!.setProposals![0];
      expect(set1.setIndex).toBe(1);
      expect(set1.status).toBe('increase');
      expect(set1.suggestedWeightKg).toBe(102.5);

      const set2 = proposal!.setProposals![1];
      expect(set2.setIndex).toBe(2);
      expect(set2.status).toBe('maintain');
      expect(set2.suggestedWeightKg).toBe(100.0);

      const set3 = proposal!.setProposals![2];
      expect(set3.setIndex).toBe(3);
      expect(set3.status).toBe('maintain');
      expect(set3.suggestedWeightKg).toBe(100.0);
    });

    it('does not trigger if no set reached the top rep bracket', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 11),
        createSet(2, 100, 10),
        createSet(3, 100, 8),
      ]);

      const result = evaluateProgressionRules(ddpRules, [session], defaultPrescription);
      expect(result.hasMatches).toBe(false);
      expect(result.primaryProposal).toBeNull();
    });
  });

  // ==========================================================================
  // Priority and Multiple Rule Matches
  // ==========================================================================

  describe('Priority and Multiple Rule Matches', () => {
    it('evaluates rules in priority order and returns all matching proposals', () => {
      const session = createSession('2026-10-10', [
        createSet(1, 100, 12, { rpe: 7.0 }),
        createSet(2, 100, 12, { rpe: 7.5 }),
        createSet(3, 100, 12, { rpe: 7.5 }),
      ]);

      const rulePriority2: ProgressionRule = {
        id: 'r-lp',
        template_exercise_id: mockTemplateExerciseId,
        priority: 2,
        rule_json: {
          conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
        },
      };

      const rulePriority1: ProgressionRule = {
        id: 'r-easy-bonus',
        template_exercise_id: mockTemplateExerciseId,
        priority: 1,
        rule_json: {
          conditions: [
            { type: 'ALL_SETS_HIT_TARGET_REPS' },
            { type: 'AVERAGE_RPE_LESS_THAN', threshold: 8.0 },
          ],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 5.0 }],
        },
      };

      // Pass them in reverse priority order [priority 2, priority 1]
      const result = evaluateProgressionRules(
        [rulePriority2, rulePriority1],
        [session],
        defaultPrescription
      );

      expect(result.hasMatches).toBe(true);
      expect(result.matchedProposals).toHaveLength(2);
      // Primary proposal should be the highest priority rule (priority 1)
      expect(result.primaryProposal?.ruleId).toBe('r-easy-bonus');
      expect(result.primaryProposal?.suggestedWeightKg).toBe(105.0);
      // Secondary proposal is priority 2
      expect(result.matchedProposals[1].ruleId).toBe('r-lp');
      expect(result.matchedProposals[1].suggestedWeightKg).toBe(102.5);
    });
  });

  // ==========================================================================
  // Helper functions: parseRuleDefinition and isSessionSuccessful
  // ==========================================================================

  describe('Helper Functions', () => {
    it('parseRuleDefinition parses object and string correctly', () => {
      expect(parseRuleDefinition(null)).toBeNull();
      expect(parseRuleDefinition(undefined)).toBeNull();
      expect(parseRuleDefinition('')).toBeNull();

      const def = {
        conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' as const }],
        actions: [{ type: 'INCREASE_LOAD_FIXED' as const, value: 2.5 }],
      };
      expect(parseRuleDefinition(def)).toEqual(def);
      expect(parseRuleDefinition(JSON.stringify(def))).toEqual(def);
      expect(parseRuleDefinition('{ invalid json')).toBeNull();
    });

    it('isSessionSuccessful handles target_sets and rep thresholds correctly', () => {
      expect(isSessionSuccessful([], defaultPrescription)).toBe(false);

      const sets3 = [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        createSet(3, 100, 12),
      ];
      expect(isSessionSuccessful(sets3, defaultPrescription)).toBe(true);

      const setsShort = [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
        createSet(3, 100, 11),
      ];
      expect(isSessionSuccessful(setsShort, defaultPrescription)).toBe(false);

      const setsTooFew = [
        createSet(1, 100, 12),
        createSet(2, 100, 12),
      ];
      expect(isSessionSuccessful(setsTooFew, defaultPrescription)).toBe(false);
    });
  });
});
