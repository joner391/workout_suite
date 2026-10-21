import {
  evaluateProgressionRules,
  createLinearProgressionRule,
  createDoubleProgressionRule,
  createDynamicDoubleProgressionRule,
  createAmrapFinalWeekRule,
  createAmrapMidwayRule,
  createAmrapProgressionRule,
  createEstimatedCapacityProgressionRule,
  estimateProgressionCapacity,
  floorToIncrement,
  calculateAmrapProgression,
  calculateRirBias,
  extractPredictedRepsFromSet,
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

  describe('Effort-adjusted capacity progression', () => {
    const prescription = { ...defaultPrescription, target_rpe: 8, target_rir: 2 };
    const sets = (options: Partial<WorkoutSet> = {}) => [1, 2, 3].map(n =>
      createSet(n, 100, 12, options));
    const evaluate = (working: WorkoutSet[], p = prescription) => evaluateProgressionRules(
      [createEstimatedCapacityProgressionRule(p.id)],
      [createSession('2026-10-20', working)], p
    );

    it('uses RPE 8 working sets to increase load without an AMRAP', () => {
      const result = evaluate(sets({ rir: null, rpe: 8 }));
      expect(result.primaryProposal?.suggestedWeightKg).toBe(102.5);
      expect(result.primaryProposal?.suggestedTargetReps).toBe(8);
      expect(result.primaryProposal?.explanation).toContain('e1RM');
      expect(result.primaryProposal?.explanation).toContain('e10RM');
      expect(result.primaryProposal?.suggestedSetType).toBeUndefined();
    });

    it('treats RIR 2 and RPE 8 as the same capacity', () => {
      expect(estimateProgressionCapacity(sets({ rir: 2, rpe: null }), prescription))
        .toEqual(estimateProgressionCapacity(sets({ rir: null, rpe: 8 }), prescription));
    });

    it('treats AMRAP as an ordinary 0-RIR capacity observation', () => {
      const p = { ...prescription, target_rir: 0, target_rpe: 10 };
      expect(estimateProgressionCapacity(sets({ set_type: 'amrap', rir: null, rpe: null }), p))
        .toEqual(estimateProgressionCapacity(sets({ rir: 0, rpe: 10 }), p));
    });

    it('recognizes easier effort at unchanged load and reps', () => {
      const p = { ...prescription, target_reps_min: 8, target_reps_max: 8, target_rir: 0, target_rpe: 10 };
      expect(evaluate(sets({ reps: 8, rir: 0, rpe: 10 }), p).hasMatches).toBe(false);
      expect(evaluate(sets({ reps: 8, rir: 3, rpe: 7 }), p).primaryProposal?.suggestedWeightKg).toBe(102.5);
    });

    it.each([
      { rir: null, rpe: null }, { rir: 4, rpe: 6 }, { rir: Infinity },
      { rir: -1 }, { weight: NaN }, { reps: 0 }, { reps: 13 },
      { set_type: 'drop' as const }, { rir: 0, rpe: 10 },
    ])('does not progress from unreliable or unsuitable evidence: %j', options => {
      expect(evaluate(sets(options)).hasMatches).toBe(false);
    });

    it('does not progress from incomplete work or a single exceptional set', () => {
      expect(evaluate(sets().slice(0, 1)).hasMatches).toBe(false);
      expect(evaluate([createSet(1, 100, 12), createSet(2, 100, 8), createSet(3, 100, 8)]).hasMatches).toBe(false);
    });

    it('does not borrow ratings or estimates from older sessions', () => {
      const result = evaluateProgressionRules([createEstimatedCapacityProgressionRule(prescription.id)], [
        createSession('2026-10-19', sets()),
        createSession('2026-10-20', sets({ rir: null, rpe: null })),
      ], prescription);
      expect(result.hasMatches).toBe(false);
    });
  });


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

  // ==========================================================================
  // Step 2: AMRAP Diagnostic Checkpoints, 1%-Over-Cap Progression & RIR Bias
  // ==========================================================================

  describe('Step 2: AMRAP Diagnostic Checkpoints & 1%-Over-Cap Progression', () => {
    describe('floorToIncrement Math Helper (Pillar 4)', () => {
      it('strictly rounds loads DOWN to nearest implement increment step', () => {
        // Standard barbell 2.5 kg steps
        expect(floorToIncrement(83.2, 2.5)).toBe(82.5);
        expect(floorToIncrement(84.9, 2.5)).toBe(82.5);
        expect(floorToIncrement(85.0, 2.5)).toBe(85.0);
        expect(floorToIncrement(80.0, 2.5)).toBe(80.0);

        // Dumbbell / microplate 1.25 kg steps
        expect(floorToIncrement(21.2, 1.25)).toBe(20.0);
        expect(floorToIncrement(21.25, 1.25)).toBe(21.25);
        expect(floorToIncrement(22.4, 1.25)).toBe(21.25);

        // Cable machine 5.0 kg steps
        expect(floorToIncrement(48.5, 5.0)).toBe(45.0);
        expect(floorToIncrement(50.0, 5.0)).toBe(50.0);

        // Defensive checks
        expect(floorToIncrement(83.2, 0)).toBe(83.2);
        expect(floorToIncrement(83.2, -1)).toBe(83.2);
      });
    });

    describe('calculateAmrapProgression Helper (Pillar 4)', () => {
      it('escalates load by +1% per rep over target ceiling and floor rounds', () => {
        // 14 reps on 80 kg with ceiling 10 reps (4 reps over -> +4% -> 83.2 kg -> 82.5 kg)
        const result = calculateAmrapProgression({
          currentLoadKg: 80,
          actualReps: 14,
          targetRepsMax: 10,
          incrementKg: 2.5,
        });

        expect(result.repsOver).toBe(4);
        expect(result.pctGain).toBe(4.0);
        expect(result.rawTargetLoadKg).toBe(83.2);
        expect(result.nextPrescribedLoadKg).toBe(82.5);
      });

      it('preserves current load when actual reps do not exceed rep ceiling', () => {
        // 10 reps on 80 kg with ceiling 10 reps (0 reps over -> 0% -> 80 kg)
        const result = calculateAmrapProgression({
          currentLoadKg: 80,
          actualReps: 10,
          targetRepsMax: 10,
          incrementKg: 2.5,
        });

        expect(result.repsOver).toBe(0);
        expect(result.pctGain).toBe(0);
        expect(result.nextPrescribedLoadKg).toBe(80);
      });

      it('handles sub-bracket performance without reducing load prematurely', () => {
        const result = calculateAmrapProgression({
          currentLoadKg: 80,
          actualReps: 8,
          targetRepsMax: 10,
          incrementKg: 2.5,
        });

        expect(result.repsOver).toBe(0);
        expect(result.pctGain).toBe(0);
        expect(result.nextPrescribedLoadKg).toBe(80);
      });
    });

    describe('calculateRirBias & extractPredictedRepsFromSet (Pillar 5)', () => {
      it('extracts predicted reps from set notes correctly (JSON and plaintext formats)', () => {
        const setJson = createSet(1, 80, 14, { set_notes: '{"predicted_reps": 10}' });
        expect(extractPredictedRepsFromSet(setJson)).toBe(10);

        const setShortJson = createSet(1, 80, 14, { set_notes: '{"pred_reps": 12}' });
        expect(extractPredictedRepsFromSet(setShortJson)).toBe(12);

        const setTextTag = createSet(1, 80, 14, { set_notes: 'pred_reps: 11' });
        expect(extractPredictedRepsFromSet(setTextTag)).toBe(11);

        const setPlain = createSet(1, 80, 14, { set_notes: 'Felt strong today' });
        expect(extractPredictedRepsFromSet(setPlain)).toBeNull();

        const setEmpty = createSet(1, 80, 14);
        expect(extractPredictedRepsFromSet(setEmpty)).toBeNull();
      });

      it('identifies accurate RIR perception when bias is <= 1', () => {
        const result = calculateRirBias({
          actualReps: 10,
          predictedReps: 10,
          currentTargetReps: 10,
        });

        expect(result.rirBias).toBe(0);
        expect(result.hasSandbaggingBias).toBe(false);
        expect(result.repAdjustment).toBe(0);
        expect(result.adjustedTargetReps).toBe(10);
      });

      it('triggers greedy rep correction and display calibration when bias >= 2', () => {
        const result = calculateRirBias({
          actualReps: 14,
          predictedReps: 10,
          currentTargetReps: 10,
          currentTargetRpe: 8.0,
        });

        expect(result.rirBias).toBe(4);
        expect(result.hasSandbaggingBias).toBe(true);
        expect(result.repAdjustment).toBe(2); // floor(4 / 2) = +2 reps
        expect(result.adjustedTargetReps).toBe(12);
        expect(result.calibratedRpeNote).toContain('push 4 reps past');
        expect(result.calibratedRpeNote).toContain('Target: 12 reps @ RPE 8.0');
      });
    });

    describe('Mesocycle Checkpoint Conditions (Pillar 3)', () => {
      it('evaluates MESOCYCLE_FINAL_WEEK condition based on week indices and flags', () => {
        const rule: ProgressionRule = {
          id: 'rule-final-week',
          template_exercise_id: mockTemplateExerciseId,
          priority: 3,
          rule_json: {
            conditions: [{ type: 'MESOCYCLE_FINAL_WEEK' }],
            actions: [{ type: 'SCHEDULE_AMRAP_FINAL_WEEK', value: 0 }],
          },
        };

        const session = createSession('2026-10-19', [createSet(1, 100, 10)]);

        // 1. Explicit flag
        const resFlag = evaluateProgressionRules([rule], [session], defaultPrescription, {
          isFinalAccumulationWeek: true,
        });
        expect(resFlag.hasMatches).toBe(true);
        expect(resFlag.primaryProposal?.actionType).toBe('SCHEDULE_AMRAP_FINAL_WEEK');
        expect(resFlag.primaryProposal?.suggestedSetType).toBe('amrap');

        // 2. Week index match (Week 4 of 4)
        const resWeek4 = evaluateProgressionRules([rule], [session], defaultPrescription, {
          currentMesocycleWeek: 4,
          totalMesocycleWeeks: 4,
        });
        expect(resWeek4.hasMatches).toBe(true);

        // 3. Early week (Week 2 of 4) -> should NOT match
        const resWeek2 = evaluateProgressionRules([rule], [session], defaultPrescription, {
          currentMesocycleWeek: 2,
          totalMesocycleWeeks: 4,
        });
        expect(resWeek2.hasMatches).toBe(false);
      });

      it('evaluates MESOCYCLE_MIDWAY_WEEK condition based on floor(L / 2)', () => {
        const rule: ProgressionRule = {
          id: 'rule-midway-week',
          template_exercise_id: mockTemplateExerciseId,
          priority: 3,
          rule_json: {
            conditions: [{ type: 'MESOCYCLE_MIDWAY_WEEK' }],
            actions: [{ type: 'SCHEDULE_AMRAP_MIDWAY', value: 0 }],
          },
        };

        const session = createSession('2026-10-19', [createSet(1, 100, 10)]);

        // 1. 4-week meso: Midway is Week 2
        const resMeso4Wk2 = evaluateProgressionRules([rule], [session], defaultPrescription, {
          currentMesocycleWeek: 2,
          totalMesocycleWeeks: 4,
        });
        expect(resMeso4Wk2.hasMatches).toBe(true);
        expect(resMeso4Wk2.primaryProposal?.actionType).toBe('SCHEDULE_AMRAP_MIDWAY');
        expect(resMeso4Wk2.primaryProposal?.suggestedSetType).toBe('amrap');
        expect(resMeso4Wk2.primaryProposal?.explanation).toContain('Week 2 of 4');

        // 2. 4-week meso on Week 1 -> should NOT match
        const resMeso4Wk1 = evaluateProgressionRules([rule], [session], defaultPrescription, {
          currentMesocycleWeek: 1,
          totalMesocycleWeeks: 4,
        });
        expect(resMeso4Wk1.hasMatches).toBe(false);

        // 3. 7-week meso: floor(7 / 2) = Week 3
        const resMeso7Wk3 = evaluateProgressionRules([rule], [session], defaultPrescription, {
          currentMesocycleWeek: 3,
          totalMesocycleWeeks: 7,
        });
        expect(resMeso7Wk3.hasMatches).toBe(true);
      });
    });

    describe('AMRAP Progression Rule Execution & Proposals (Pillar 4 & 5)', () => {
      it('evaluates completed AMRAP sets, applies floor rounding, and incorporates RIR bias', () => {
        const amrapRule = createAmrapProgressionRule(mockTemplateExerciseId, {
          incrementKg: 2.5,
        });

        // Athlete completed an AMRAP set of 14 reps @ 80 kg against a 10-rep ceiling
        // User previously predicted 10 reps (bias = +4 -> +2 target reps)
        const amrapSet: WorkoutSet = {
          id: 'set-amrap-1',
          workout_id: 'w-1',
          exercise_id: mockExerciseId,
          gear_id: null,
          set_number: 1,
          weight: 80,
          raw_input_weight: 80,
          added_weight: null,
          reps: 14,
          reps_right: null,
          rpe: 10,
          rir: 0,
          set_type: 'amrap',
          set_notes: '{"predicted_reps": 10}',
          exercise_group_id: null,
          created_at: '2026-10-19T10:00:00Z',
        };

        const session = createSession('2026-10-19', [amrapSet]);

        const result = evaluateProgressionRules([amrapRule], [session], {
          ...defaultPrescription,
          target_reps_min: 8,
          target_reps_max: 10,
        });

        expect(result.hasMatches).toBe(true);
        const proposal = result.primaryProposal!;
        expect(proposal.actionType).toBe('INCREASE_LOAD_AMRAP_OVER_CAP');
        // 80 kg * (1 + (14 - 10) * 0.01) = 83.2 kg -> floor to 2.5 kg = 82.5 kg
        expect(proposal.suggestedWeightKg).toBe(82.5);
        expect(proposal.suggestedTargetReps).toBe(10); // 8 base min + 2 repAdjustment = 10
        expect(proposal.rirBias).toBe(4);
        expect(proposal.calibratedRpeNote).toContain('push 4 reps past');
        expect(proposal.explanation).toContain('Completed 14 reps vs 10 rep target ceiling');
        expect(proposal.explanation).toContain('floor-rounded to 2.5 kg increment');
      });

      it('maintains load when AMRAP set does not exceed rep ceiling', () => {
        const amrapRule = createAmrapProgressionRule(mockTemplateExerciseId, {
          incrementKg: 2.5,
        });

        const amrapSet: WorkoutSet = {
          id: 'set-amrap-2',
          workout_id: 'w-1',
          exercise_id: mockExerciseId,
          gear_id: null,
          set_number: 1,
          weight: 80,
          raw_input_weight: 80,
          added_weight: null,
          reps: 10,
          reps_right: null,
          rpe: 10,
          rir: 0,
          set_type: 'amrap',
          set_notes: null,
          exercise_group_id: null,
          created_at: '2026-10-19T10:00:00Z',
        };

        const session = createSession('2026-10-19', [amrapSet]);

        const result = evaluateProgressionRules([amrapRule], [session], {
          ...defaultPrescription,
          target_reps_min: 8,
          target_reps_max: 10,
        });

        expect(result.hasMatches).toBe(true);
        expect(result.primaryProposal?.suggestedWeightKg).toBe(80);
        expect(result.primaryProposal?.explanation).toContain('Maintain 80 kg');
      });
    });

    describe('Preset Constructors', () => {
      it('creates valid rule entities for createAmrapMidwayRule and createAmrapProgressionRule', () => {
        const midwayRule = createAmrapMidwayRule('te-lat-raise-01', { midwayWeek: 2 });
        expect(midwayRule.priority).toBe(3);
        const midJson = typeof midwayRule.rule_json === 'string'
          ? JSON.parse(midwayRule.rule_json)
          : midwayRule.rule_json;
        expect(midJson.conditions[0].type).toBe('MESOCYCLE_MIDWAY_WEEK');
        expect(midJson.conditions[0].threshold).toBe(2);
        expect(midJson.actions[0].type).toBe('SCHEDULE_AMRAP_MIDWAY');

        const progRule = createAmrapProgressionRule('te-lat-raise-01', { incrementKg: 1.25 });
        expect(progRule.priority).toBe(1);
        const progJson = typeof progRule.rule_json === 'string'
          ? JSON.parse(progRule.rule_json)
          : progRule.rule_json;
        expect(progJson.conditions[0].type).toBe('AMRAP_COMPLETED');
        expect(progJson.actions[0].type).toBe('INCREASE_LOAD_AMRAP_OVER_CAP');
        expect(progJson.actions[0].value).toBe(1.25);
      });
    });
  });
});
