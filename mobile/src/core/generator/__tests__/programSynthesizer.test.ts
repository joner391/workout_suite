import { synthesizeProgram } from '../programSynthesizer';
import { UserProfile, Exercise } from '../../types';
import { DEFAULT_EXERCISES } from '../../../database/seeds/defaultExercises';

describe('Profile-Driven Program Synthesizer', () => {
  const baseProfile: UserProfile = {
    id: 'user-prof-01',
    gender: 'male',
    birthdate: '1995-05-15',
    height_cm: 180,
    training_mentality: 'precision',
    primary_goal: 'hypertrophy',
    secondary_goals: ['strength'],
    preferred_days_per_week: 4,
    preferred_session_duration_mins: 60,
    equipment_access: 'commercial_gym',
    created_at: '2026-10-10T10:00:00Z',
    updated_at: '2026-10-10T10:00:00Z',
  };

  // ==========================================================================
  // Split Selection by Weekly Frequency
  // ==========================================================================

  describe('Split Architecture Selection', () => {
    it('synthesizes Full Body split for 1, 2, or 3 days per week', () => {
      // 1 day
      const res1 = synthesizeProgram({ ...baseProfile, preferred_days_per_week: 1 });
      expect(res1.summary.splitType).toBe('full_body');
      expect(res1.templates).toHaveLength(1);
      expect(res1.templates[0].name).toContain('Full Body A');

      // 2 days
      const res2 = synthesizeProgram({ ...baseProfile, preferred_days_per_week: 2 });
      expect(res2.summary.splitType).toBe('full_body');
      expect(res2.templates).toHaveLength(2);
      expect(res2.templates[0].name).toContain('Full Body A');
      expect(res2.templates[1].name).toContain('Full Body B');

      // 3 days
      const res3 = synthesizeProgram({ ...baseProfile, preferred_days_per_week: 3 });
      expect(res3.summary.splitType).toBe('full_body');
      expect(res3.templates).toHaveLength(3);
      expect(res3.templates[2].name).toContain('Full Body C');
    });

    it('synthesizes Upper / Lower split for 4 days per week', () => {
      const res = synthesizeProgram({ ...baseProfile, preferred_days_per_week: 4 });
      expect(res.summary.splitType).toBe('upper_lower');
      expect(res.templates).toHaveLength(4);
      expect(res.templates[0].name).toContain('Upper A');
      expect(res.templates[1].name).toContain('Lower A');
      expect(res.templates[2].name).toContain('Upper B');
      expect(res.templates[3].name).toContain('Lower B');
    });

    it('synthesizes PPLUL (Push / Pull / Legs / Upper / Lower) for 5 days per week', () => {
      const res = synthesizeProgram({ ...baseProfile, preferred_days_per_week: 5 });
      expect(res.summary.splitType).toBe('pplul');
      expect(res.templates).toHaveLength(5);
      expect(res.templates[0].name).toContain('Push');
      expect(res.templates[1].name).toContain('Pull');
      expect(res.templates[2].name).toContain('Legs');
      expect(res.templates[3].name).toContain('Upper');
      expect(res.templates[4].name).toContain('Lower');
    });

    it('synthesizes PPL x 2 split for 6 or 7 days per week', () => {
      const res6 = synthesizeProgram({ ...baseProfile, preferred_days_per_week: 6 });
      expect(res6.summary.splitType).toBe('ppl');
      expect(res6.templates).toHaveLength(6);
      expect(res6.templates[0].name).toContain('Push A');
      expect(res6.templates[1].name).toContain('Pull A');
      expect(res6.templates[2].name).toContain('Legs A');
      expect(res6.templates[3].name).toContain('Push B');
      expect(res6.templates[4].name).toContain('Pull B');
      expect(res6.templates[5].name).toContain('Legs B');

      const res7 = synthesizeProgram({ ...baseProfile, preferred_days_per_week: 7 });
      expect(res7.summary.splitType).toBe('ppl');
      expect(res7.templates).toHaveLength(6);
    });
  });

  // ==========================================================================
  // Exertion & Volume by Intensity Style
  // ==========================================================================

  describe('Volume & Exertion by Intensity Style', () => {
    it('configures high intensity / low volume with 1-2 sets @ RPE 9.5 and DDP rules', () => {
      const profile: UserProfile = {
        ...baseProfile,
        intensity_style: 'high_intensity_low_volume',
      };

      const result = synthesizeProgram(profile);

      // Verify set counts
      for (const te of result.templateExercises) {
        expect(te.target_sets).toBeLessThanOrEqual(2);
        expect(te.target_sets).toBeGreaterThanOrEqual(1);
        expect(te.target_rpe).toBe(9.5);
        expect(te.target_rir).toBe(0.5);
      }

      // Verify DDP progression rule was attached
      const firstRule = result.progressionRules[0];
      const ruleJson = typeof firstRule.rule_json === 'string'
        ? JSON.parse(firstRule.rule_json)
        : firstRule.rule_json;

      expect(ruleJson.conditions[0].type).toBe('ANY_SET_HIT_TOP_REP_RANGE');
      expect(result.summary.progressionSchemeSummary).toContain('Dynamic Double Progression');
    });

    it('configures volume accumulation with 3-4 sets @ RPE 7.5 and Standard DP rules', () => {
      const profile: UserProfile = {
        ...baseProfile,
        intensity_style: 'volume_accumulation',
      };

      const result = synthesizeProgram(profile);

      // Verify set counts
      for (const te of result.templateExercises) {
        expect(te.target_sets).toBeGreaterThanOrEqual(3);
        expect(te.target_rpe).toBe(7.5);
        expect(te.target_rir).toBe(2.5);
      }

      // Verify Standard DP rule
      const firstRule = result.progressionRules[0];
      const ruleJson = typeof firstRule.rule_json === 'string'
        ? JSON.parse(firstRule.rule_json)
        : firstRule.rule_json;

      expect(ruleJson.conditions[0].type).toBe('ALL_SETS_HIT_TARGET_REPS');
    });

    it('configures balanced style with 3 sets @ RPE 8.5', () => {
      const profile: UserProfile = {
        ...baseProfile,
        intensity_style: 'balanced',
      };

      const result = synthesizeProgram(profile);
      const firstCompound = result.templateExercises[0];

      expect(firstCompound.target_sets).toBe(3);
      expect(firstCompound.target_rpe).toBe(8.5);
      expect(firstCompound.target_rir).toBe(1.5);
    });
  });

  // ==========================================================================
  // Primary Goal Alignment
  // ==========================================================================

  describe('Primary Goal Shaping', () => {
    it('configures strength goal with 3-5 reps on primary compounds and Linear Progression', () => {
      const profile: UserProfile = {
        ...baseProfile,
        primary_goal: 'strength',
        intensity_style: 'balanced',
      };

      const result = synthesizeProgram(profile);
      const firstExercise = result.templateExercises[0]; // Barbell Bench Press in Upper A

      expect(firstExercise.target_reps_min).toBe(3);
      expect(firstExercise.target_reps_max).toBe(5);

      // Verify LP rule was assigned to the main compound
      const rulesForFirstExercise = result.progressionRules.filter(
        (r) => r.template_exercise_id === firstExercise.id
      );
      const successRule = rulesForFirstExercise.find((r) => r.priority === 1);
      const ruleJson = typeof successRule!.rule_json === 'string'
        ? JSON.parse(successRule!.rule_json)
        : successRule!.rule_json;

      expect(ruleJson.actions[0].type).toBe('INCREASE_LOAD_FIXED');
      expect(result.summary.progressionSchemeSummary).toContain('Linear Progression');
    });

    it('configures hypertrophy goal with 6-10 / 10-15 rep brackets', () => {
      const profile: UserProfile = {
        ...baseProfile,
        primary_goal: 'hypertrophy',
      };

      const result = synthesizeProgram(profile);
      const primaryCompound = result.templateExercises[0];
      const accessory = result.templateExercises[result.templateExercises.length - 1];

      expect(primaryCompound.target_reps_min).toBe(6);
      expect(primaryCompound.target_reps_max).toBe(10);
      expect(accessory.target_reps_min).toBe(10);
      expect(accessory.target_reps_max).toBe(15);
    });

    it('configures endurance goal with 12-18 reps', () => {
      const profile: UserProfile = {
        ...baseProfile,
        primary_goal: 'endurance',
      };

      const result = synthesizeProgram(profile);
      const exercise = result.templateExercises[0];

      expect(exercise.target_reps_min).toBe(12);
      expect(exercise.target_reps_max).toBe(18);
    });
  });

  // ==========================================================================
  // Antagonist Superset Pairing
  // ==========================================================================

  describe('Antagonist Superset Grouping', () => {
    it('automatically generates superset group IDs when training_enjoyment is minimalist', () => {
      const profile: UserProfile = {
        ...baseProfile,
        training_enjoyment: 'minimalist',
        preferred_session_duration_mins: 60,
      };

      const result = synthesizeProgram(profile);
      expect(result.summary.hasSupersets).toBe(true);

      // In Upper A: Bench Press (Chest) and Bent-Over Row (Back) should share an exercise_group_id
      const upperAExercises = result.templateExercises.filter(
        (te) => te.template_id === result.templates[0].id
      );
      const bench = upperAExercises.find((te) => te.exercise_id === 'barbell_bench_press');
      const row = upperAExercises.find((te) => te.exercise_id === 'barbell_bent_over_row');

      expect(bench?.exercise_group_id).toBeTruthy();
      expect(row?.exercise_group_id).toBeTruthy();
      expect(bench?.exercise_group_id).toBe(row?.exercise_group_id);
    });

    it('automatically generates superset group IDs when session duration <= 45 mins', () => {
      const profile: UserProfile = {
        ...baseProfile,
        training_enjoyment: 'neutral',
        preferred_session_duration_mins: 40,
      };

      const result = synthesizeProgram(profile);
      expect(result.summary.hasSupersets).toBe(true);

      const groupedExercises = result.templateExercises.filter(
        (te) => te.exercise_group_id !== null
      );
      expect(groupedExercises.length).toBeGreaterThan(0);
    });

    it('does NOT pair supersets when user is enthusiast with 60+ min duration', () => {
      const profile: UserProfile = {
        ...baseProfile,
        training_enjoyment: 'enthusiast',
        preferred_session_duration_mins: 75,
      };

      const result = synthesizeProgram(profile);
      expect(result.summary.hasSupersets).toBe(false);

      const groupedExercises = result.templateExercises.filter(
        (te) => te.exercise_group_id !== null
      );
      expect(groupedExercises).toHaveLength(0);
    });

    it('compresses exercise slot count when session duration is ultra-short (<= 35 mins)', () => {
      const profile: UserProfile = {
        ...baseProfile,
        preferred_session_duration_mins: 30,
      };

      const result = synthesizeProgram(profile);
      for (const tpl of result.templates) {
        const exercisesForTpl = result.templateExercises.filter(
          (te) => te.template_id === tpl.id
        );
        expect(exercisesForTpl.length).toBeLessThanOrEqual(4);
      }
    });
  });

  // ==========================================================================
  // Equipment Access Adaptation
  // ==========================================================================

  describe('Equipment Access Adaptation', () => {
    it('uses barbell and machine exercises for commercial gym', () => {
      const profile: UserProfile = {
        ...baseProfile,
        equipment_access: 'commercial_gym',
      };

      const result = synthesizeProgram(profile);
      const allExerciseIds = result.templateExercises.map((te) => te.exercise_id);

      expect(allExerciseIds).toContain('barbell_bench_press');
      expect(allExerciseIds).toContain('barbell_back_squat');
      expect(allExerciseIds.some((id) => id.startsWith('cable_') || id.startsWith('machine_'))).toBe(true);
    });

    it('avoids cable machines and pin machines for garage gym', () => {
      const profile: UserProfile = {
        ...baseProfile,
        equipment_access: 'garage_gym',
      };

      const result = synthesizeProgram(profile);
      const allExerciseIds = result.templateExercises.map((te) => te.exercise_id);

      // Garage gym should NOT use commercial cable or pin machines
      for (const id of allExerciseIds) {
        expect(id.startsWith('cable_')).toBe(false);
        expect(id.startsWith('machine_')).toBe(false);
      }

      // Should use barbell/dumbbell/bodyweight equivalents
      expect(allExerciseIds).toContain('barbell_bench_press');
      expect(allExerciseIds).toContain('barbell_back_squat');
    });

    it('uses only dumbbell and bodyweight exercises for dumbbells_only', () => {
      const profile: UserProfile = {
        ...baseProfile,
        equipment_access: 'dumbbells_only',
      };

      const result = synthesizeProgram(profile);
      const allExerciseIds = result.templateExercises.map((te) => te.exercise_id);

      for (const id of allExerciseIds) {
        expect(id.startsWith('barbell_')).toBe(false);
        expect(id.startsWith('cable_')).toBe(false);
        expect(id.startsWith('machine_')).toBe(false);
      }
    });

    it('uses only bodyweight movements for bodyweight_only', () => {
      const profile: UserProfile = {
        ...baseProfile,
        equipment_access: 'bodyweight_only',
      };

      const result = synthesizeProgram(profile);
      const allExerciseIds = result.templateExercises.map((te) => te.exercise_id);

      for (const id of allExerciseIds) {
        expect(id.startsWith('barbell_')).toBe(false);
        expect(id.startsWith('cable_')).toBe(false);
        expect(id.startsWith('machine_')).toBe(false);
      }
    });

    it('resolves against custom availableExercises catalog when provided', () => {
      const customCatalog: Exercise[] = [
        {
          id: 'custom_bench',
          name: 'Custom Swiss Bar Bench',
          muscle_group: 'Chest',
          category: 'Barbell',
          is_compound: true,
          is_bodyweight: false,
          is_unilateral: false,
          load_mode: 'total',
          default_cable_ratio: 1.0,
          default_bar_weight_kg: 20.0,
          is_custom: true,
          parent_exercise_id: null,
          standard_lift_type: 'bench',
          default_rest_seconds: 180,
        },
        ...DEFAULT_EXERCISES,
      ];

      const result = synthesizeProgram(baseProfile, {
        availableExercises: customCatalog,
      });

      expect(result.templates.length).toBeGreaterThan(0);
      expect(result.templateExercises.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Relational Integrity & Entity Linkages
  // ==========================================================================

  describe('Relational Entity Integrity', () => {
    it('maintains strict foreign key consistency across program, templates, exercises, and rules', () => {
      const result = synthesizeProgram(baseProfile, {
        programName: 'My Custom Hypertrophy Split',
        colorHex: '#00E676',
      });

      expect(result.program.name).toBe('My Custom Hypertrophy Split');
      expect(result.program.color_hex).toBe('#00E676');

      // 1. Every template references the program
      for (const tpl of result.templates) {
        expect(tpl.program_id).toBe(result.program.id);
      }

      // 2. Every template exercise references a valid template
      const templateIds = new Set(result.templates.map((t) => t.id));
      for (const te of result.templateExercises) {
        expect(templateIds.has(te.template_id)).toBe(true);
        expect(te.exercise_id).toBeTruthy();
        expect(te.target_sets).toBeGreaterThan(0);
        expect(te.target_reps_min).toBeGreaterThan(0);
        expect(te.target_reps_max).toBeGreaterThanOrEqual(te.target_reps_min!);
      }

      // 3. Every progression rule references a valid template exercise
      const teIds = new Set(result.templateExercises.map((te) => te.id));
      for (const rule of result.progressionRules) {
        expect(teIds.has(rule.template_exercise_id)).toBe(true);
      }

      // 4. Summary metrics consistency
      expect(result.summary.totalWeeklySets).toBeGreaterThan(0);
      expect(result.summary.daysPerWeek).toBe(4);
    });
  });

  // ==========================================================================
  // Training Mentality Matrix (Phase 4 Specification)
  // ==========================================================================

  describe('Training Mentality Matrix', () => {
    it('synthesizes Fury mentality with 1-2 sets @ RPE 9.5 and DDP rules', () => {
      const profile: UserProfile = {
        ...baseProfile,
        training_mentality: 'fury',
      };

      const result = synthesizeProgram(profile);

      for (const te of result.templateExercises) {
        expect(te.target_sets).toBeLessThanOrEqual(2);
        expect(te.target_sets).toBeGreaterThanOrEqual(1);
        expect(te.target_rpe).toBe(9.5);
        expect(te.target_rir).toBe(0.5);
      }

      expect(result.summary.progressionSchemeSummary).toContain('Dynamic Double Progression');
      expect(result.program.notes).toContain('fury mentality');
    });

    it('synthesizes Precision mentality with high volume @ RPE 8.0 and LP/DP rules', () => {
      const profile: UserProfile = {
        ...baseProfile,
        training_mentality: 'precision',
      };

      const result = synthesizeProgram(profile);

      for (const te of result.templateExercises) {
        expect(te.target_sets).toBeGreaterThanOrEqual(3);
        expect(te.target_rpe).toBe(8.0);
        expect(te.target_rir).toBe(2.0);
      }

      expect(result.summary.progressionSchemeSummary).toContain('Linear Progression');
      expect(result.program.notes).toContain('precision mentality');
    });

    it('synthesizes Get Out mentality with 2 sets, auto antagonist supersets and DP', () => {
      const profile: UserProfile = {
        ...baseProfile,
        training_mentality: 'get_out',
        preferred_session_duration_mins: 60,
      };

      const result = synthesizeProgram(profile);

      for (const te of result.templateExercises) {
        expect(te.target_sets).toBe(2);
        expect(te.target_rpe).toBe(8.5);
        expect(te.target_rir).toBe(1.5);
      }

      expect(result.summary.hasSupersets).toBe(true);
      expect(result.summary.progressionSchemeSummary).toContain('Double Progression');
      expect(result.program.notes).toContain('get_out mentality');
    });
  });

  // ==========================================================================
  // 15-Minute Target Workout Duration (Phase 4 Specification)
  // ==========================================================================

  describe('15-Minute Target Workout Duration', () => {
    it('synthesizes exactly 4 exercises in 2 antagonist pairs with 2 sets per exercise', () => {
      const profile: UserProfile = {
        ...baseProfile,
        preferred_session_duration_mins: 15,
        preferred_days_per_week: 4,
      };

      const result = synthesizeProgram(profile);

      expect(result.summary.estimatedSessionDurationMins).toBe(15);
      expect(result.summary.hasSupersets).toBe(true);

      for (const template of result.templates) {
        const exercisesInDay = result.templateExercises.filter(
          (te) => te.template_id === template.id
        );
        expect(exercisesInDay).toHaveLength(4);

        // Exactly 2 sets per exercise -> 8 sets per workout session
        for (const te of exercisesInDay) {
          expect(te.target_sets).toBe(2);
          expect(te.exercise_group_id).toBeTruthy();
        }

        // Two distinct superset pairs (slots 0+1 and slots 2+3)
        const pair1Id = exercisesInDay[0].exercise_group_id;
        const pair2Id = exercisesInDay[2].exercise_group_id;

        expect(exercisesInDay[1].exercise_group_id).toBe(pair1Id);
        expect(exercisesInDay[3].exercise_group_id).toBe(pair2Id);
        expect(pair1Id).not.toBe(pair2Id);
      }

      // Total weekly sets: 4 days * 8 sets = 32 sets
      expect(result.summary.totalWeeklySets).toBe(32);
    });
  });
});
