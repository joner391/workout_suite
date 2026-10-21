import {
  synthesizeProgram,
  computeTargetSetsFromExertion,
  resolveArchetype,
} from '../programSynthesizer';
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
    it('configures high intensity / low volume with compounds @ RPE 8.0 and accessories @ RPE 9.5 with DDP rules', () => {
      const profile: UserProfile = {
        ...baseProfile,
        intensity_style: 'high_intensity_low_volume',
      };

      const result = synthesizeProgram(profile);

      // Verify set counts and RPE split (Pillar 8: compound preservation @ 8.0, accessories @ 9.5)
      for (const te of result.templateExercises) {
        expect(te.target_sets).toBeLessThanOrEqual(2);
        expect(te.target_sets).toBeGreaterThanOrEqual(1);
      }

      const compounds = result.templateExercises.filter((te) => te.target_sets === 2);
      const accessories = result.templateExercises.filter((te) => te.target_sets === 1);

      expect(compounds.length).toBeGreaterThan(0);
      expect(accessories.length).toBeGreaterThan(0);

      for (const comp of compounds) {
        expect(comp.target_rpe).toBe(8.0);
        expect(comp.target_rir).toBe(2.0);
      }
      for (const acc of accessories) {
        expect(acc.target_rpe).toBe(9.5);
        expect(acc.target_rir).toBe(0.5);
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
    it('synthesizes Fury mentality with compounds @ RPE 8.0 and accessories @ RPE 9.5 with DDP rules', () => {
      const profile: UserProfile = {
        ...baseProfile,
        training_mentality: 'fury',
      };

      const result = synthesizeProgram(profile);

      for (const te of result.templateExercises) {
        expect(te.target_sets).toBeLessThanOrEqual(2);
        expect(te.target_sets).toBeGreaterThanOrEqual(1);
      }

      const compounds = result.templateExercises.filter((te) => te.target_sets === 2);
      const accessories = result.templateExercises.filter((te) => te.target_sets === 1);

      expect(compounds.length).toBeGreaterThan(0);
      expect(accessories.length).toBeGreaterThan(0);

      for (const comp of compounds) {
        expect(comp.target_rpe).toBe(8.0);
        expect(comp.target_rir).toBe(2.0);
      }
      for (const acc of accessories) {
        expect(acc.target_rpe).toBe(9.5);
        expect(acc.target_rir).toBe(0.5);
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

  // ==========================================================================
  // Step 1: Effective Rep Exertion Modeling (Pillar 1)
  // ==========================================================================

  describe('computeTargetSetsFromExertion', () => {
    it('always assigns 4 sets for skill practice compounds', () => {
      expect(computeTargetSetsFromExertion(3.0, 2, true)).toBe(4);
      expect(computeTargetSetsFromExertion(0.0, 4, true)).toBe(4);
    });

    it('calculates set counts from weekly eRep targets and exertion/frequency', () => {
      // At RIR 1.0 (4 eReps/set), freq 2, target 32 eReps:
      // (32 / 2) / 4 = 16 / 4 = 4 sets
      expect(computeTargetSetsFromExertion(1.0, 2, false, 32)).toBe(4);

      // At RIR 0.0 (5 eReps/set), freq 2, target 32 eReps:
      // (32 / 2) / 5 = 16 / 5 = 3.2 -> 3 sets
      expect(computeTargetSetsFromExertion(0.0, 2, false, 32)).toBe(3);

      // At RIR 2.0 (3 eReps/set), freq 2, target 32 eReps:
      // (32 / 2) / 3 = 16 / 3 = 5.33 -> 5 sets
      expect(computeTargetSetsFromExertion(2.0, 2, false, 32)).toBe(5);
    });

    it('clamps sets between 1 and 5 sets per exercise', () => {
      // Extremely high frequency results in min clamp of 1
      expect(computeTargetSetsFromExertion(0.0, 10, false, 10)).toBe(1);

      // Low frequency with low eReps/set results in max clamp of 5
      expect(computeTargetSetsFromExertion(4.0, 1, false, 40)).toBe(5);
    });
  });

  // ==========================================================================
  // Step 1: Novice Bifurcated Architecture (Pillar 2)
  // ==========================================================================

  describe('Novice Two-Tier Bifurcated Architecture', () => {
    it('structures beginner programs into Tier 1 practice and Tier 2 drivers', () => {
      const beginnerProfile: UserProfile = {
        ...baseProfile,
        experience_level: 'beginner',
        preferred_days_per_week: 4,
      };

      const result = synthesizeProgram(beginnerProfile);

      expect(result.program.notes).toContain('Two-Tier Novice Bifurcated Program');

      // In Upper A: Bench Press & Bent-Over Row are primary compounds (Tier 1)
      const upperAExercises = result.templateExercises.filter(
        (te) => te.template_id === result.templates[0].id
      );
      const tier1Exercises = upperAExercises.slice(0, 2);
      const tier2Exercises = upperAExercises.slice(2);

      // Tier 1 Practice: 4 sets x 3-5 reps @ RPE 7.0 (3.0 RIR) with LP
      for (const t1 of tier1Exercises) {
        expect(t1.target_sets).toBe(4);
        expect(t1.target_reps_min).toBe(3);
        expect(t1.target_reps_max).toBe(5);
        expect(t1.target_rpe).toBe(7.0);
        expect(t1.target_rir).toBe(3.0);

        const rules = result.progressionRules.filter((r) => r.template_exercise_id === t1.id);
        const lpRule = rules.find((r) => {
          const j = typeof r.rule_json === 'string' ? JSON.parse(r.rule_json) : r.rule_json;
          return j.actions.some((a: any) => a.type === 'INCREASE_LOAD_FIXED');
        });
        expect(lpRule).toBeDefined();
      }

      // Tier 2 Drivers: 3 sets x 10-15 reps @ RPE 9.0 (1.0 RIR) with DP
      for (const t2 of tier2Exercises) {
        expect(t2.target_sets).toBe(3);
        expect(t2.target_reps_min).toBe(10);
        expect(t2.target_reps_max).toBe(15);
        expect(t2.target_rpe).toBe(9.0);
        expect(t2.target_rir).toBe(1.0);

        const rules = result.progressionRules.filter((r) => r.template_exercise_id === t2.id);
        const dpRule = rules.find((r) => {
          const j = typeof r.rule_json === 'string' ? JSON.parse(r.rule_json) : r.rule_json;
          return j.conditions.some((c: any) => c.type === 'ALL_SETS_HIT_TARGET_REPS');
        });
        expect(dpRule).toBeDefined();
      }

      // Beginners should NOT have AMRAP final week rules scheduled
      const amrapRules = result.progressionRules.filter((r) => {
        const j = typeof r.rule_json === 'string' ? JSON.parse(r.rule_json) : r.rule_json;
        return j.actions.some((a: any) => a.type === 'SCHEDULE_AMRAP_FINAL_WEEK');
      });
      expect(amrapRules).toHaveLength(0);
    });

    it('respects options.experienceLevel override over profile', () => {
      const intermediateProfile: UserProfile = {
        ...baseProfile,
        experience_level: 'intermediate',
      };

      const result = synthesizeProgram(intermediateProfile, {
        experienceLevel: 'beginner',
      });

      expect(result.program.notes).toContain('Two-Tier Novice Bifurcated Program');
      const firstExercise = result.templateExercises[0];
      expect(firstExercise.target_rpe).toBe(7.0);
      expect(firstExercise.target_sets).toBe(4);
    });
  });

  // ==========================================================================
  // Step 1: Time-Budget Evaluation & Dynamic Myo-Rep Conversion (Pillar 6)
  // ==========================================================================

  describe('Time-Budget Dynamic Myo-Rep Conversion', () => {
    it('converts accessory straight sets to myo-rep clusters when duration exceeds budget', () => {
      const shortProfile: UserProfile = {
        ...baseProfile,
        preferred_session_duration_mins: 20,
        training_mentality: 'precision',
        preferred_days_per_week: 4,
      };

      const result = synthesizeProgram(shortProfile);

      // Verify that accessory exercises were converted to myo-reps
      const myoRepExercises = result.templateExercises.filter(
        (te) => te.set_type === 'myorep'
      );
      expect(myoRepExercises.length).toBeGreaterThan(0);

      for (const myo of myoRepExercises) {
        expect(myo.target_sets).toBe(1);
        expect(myo.target_reps_min).toBe(10);
        expect(myo.target_reps_max).toBe(15);
        expect(myo.target_rpe).toBe(10.0);
        expect(myo.target_rir).toBe(0.0);

        // Verify Dynamic Double Progression rule was attached to the myo-rep cluster
        const rules = result.progressionRules.filter(
          (r) => r.template_exercise_id === myo.id
        );
        const ddpRule = rules.find((r) => {
          const j = typeof r.rule_json === 'string' ? JSON.parse(r.rule_json) : r.rule_json;
          return j.conditions.some((c: any) => c.type === 'ANY_SET_HIT_TOP_REP_RANGE');
        });
        expect(ddpRule).toBeDefined();
      }

      // Primary compounds remain straight sets
      const workingExercises = result.templateExercises.filter(
        (te) => te.set_type === 'working'
      );
      expect(workingExercises.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Step 1: SBD vs Variety Sliding Scale (Pillar 7)
  // ==========================================================================

  describe('SBD vs Variety Sliding Scale', () => {
    it('swaps SBD compounds to high-SFR machine/cable alternatives in Pure Hypertrophy', () => {
      const pureHypertrophyProfile: UserProfile = {
        ...baseProfile,
        primary_goal: 'hypertrophy',
        secondary_goals: [], // No strength secondary
        equipment_access: 'commercial_gym',
      };

      const result = synthesizeProgram(pureHypertrophyProfile);
      const allExerciseIds = result.templateExercises.map((te) => te.exercise_id);

      // Barbell bench press replaced with machine chest press
      expect(allExerciseIds).toContain('machine_chest_press');
      expect(allExerciseIds).not.toContain('barbell_bench_press');

      // Barbell back squat replaced with machine leg press
      expect(allExerciseIds).toContain('machine_leg_press');
      expect(allExerciseIds).not.toContain('barbell_back_squat');

      // Barbell deadlift replaced with barbell RDL
      expect(allExerciseIds).not.toContain('barbell_deadlift');
    });

    it('preserves SBD compounds when strength is a secondary goal (Powerbuilding)', () => {
      const powerbuildingProfile: UserProfile = {
        ...baseProfile,
        primary_goal: 'hypertrophy',
        secondary_goals: ['strength'], // Strength secondary keeps SBD anchors
        equipment_access: 'commercial_gym',
      };

      const result = synthesizeProgram(powerbuildingProfile);
      const allExerciseIds = result.templateExercises.map((te) => te.exercise_id);

      expect(allExerciseIds).toContain('barbell_bench_press');
      expect(allExerciseIds).toContain('barbell_back_squat');
      expect(allExerciseIds).toContain('barbell_deadlift');
    });
  });

  // ==========================================================================
  // Step 1: Compound Preservation & AMRAP Rule Scheduling (Pillar 8)
  // ==========================================================================

  describe('Effort-rated progression defaults', () => {
    it.each(['fury', 'precision', 'get_out'] as const)(
      'uses capacity evidence without scheduling AMRAPs for %s', mentality => {
        const result = synthesizeProgram({
          ...baseProfile, experience_level: 'intermediate', training_mentality: mentality,
        });
        const rules = result.progressionRules.map(r =>
          typeof r.rule_json === 'string' ? JSON.parse(r.rule_json) : r.rule_json);
        expect(rules.some(r => r.actions.some((a: any) => a.type.includes('AMRAP')))).toBe(false);
        for (const te of result.templateExercises) {
          expect(result.progressionRules.some(r => r.template_exercise_id === te.id &&
            JSON.stringify(r.rule_json).includes('INCREASE_LOAD_FROM_ESTIMATED_CAPACITY'))).toBe(true);
        }
      }
    );
  });
  // ==========================================================================
  // Step 8.1: Blueprint Quality & Seed ID Synchronization
  // ==========================================================================

  describe('Step 8.1: Blueprint Quality & Seed ID Synchronization', () => {
    it('synchronizes canonical seed exercise IDs in 15-Minute Express blueprints', () => {
      const expressProfile: UserProfile = {
        ...baseProfile,
        preferred_session_duration_mins: 15,
        preferred_days_per_week: 4,
        equipment_access: 'commercial_gym',
      };

      const result = synthesizeProgram(expressProfile);
      const day2Exercises = result.templateExercises.filter(
        (te) => te.template_id === result.templates[1].id
      );
      const day3Exercises = result.templateExercises.filter(
        (te) => te.template_id === result.templates[2].id
      );

      // Day 2 tricep slot should use canonical cable_tricep_pushdown (not tricep_cable_pushdown)
      const pushdown = day2Exercises.find((te) => te.exercise_id === 'cable_tricep_pushdown');
      expect(pushdown).toBeDefined();

      // Day 3 should use canonical bodyweight_dip (not bodyweight_dips)
      const dip = day3Exercises.find((te) => te.exercise_id === 'bodyweight_dip');
      expect(dip).toBeDefined();

      // Day 3 arm slot should use canonical barbell_skull_crusher (not unseeded dumbbell_overhead_tricep_extension)
      const skullCrusher = day3Exercises.find((te) => te.exercise_id === 'barbell_skull_crusher');
      expect(skullCrusher).toBeDefined();
    });

    it('rebalances Full Body Day 1 hamstrings to machine leg curl to eliminate spinal fatigue collision with Day 2 deadlift', () => {
      const fullBodyProfile: UserProfile = {
        ...baseProfile,
        preferred_days_per_week: 3,
        equipment_access: 'commercial_gym',
      };

      const result = synthesizeProgram(fullBodyProfile);
      const day1Exercises = result.templateExercises.filter(
        (te) => te.template_id === result.templates[0].id
      );
      const day2Exercises = result.templateExercises.filter(
        (te) => te.template_id === result.templates[1].id
      );

      // Day 1 has machine_leg_curl for zero spinal compressive loading
      const day1Hams = day1Exercises.find((te) => te.exercise_id === 'machine_leg_curl');
      expect(day1Hams).toBeDefined();

      // Day 2 has heavy barbell_deadlift
      const day2Deadlift = day2Exercises.find((te) => te.exercise_id === 'barbell_deadlift');
      expect(day2Deadlift).toBeDefined();
    });

    it('streamlines Upper session density and caps total working sets between 16-20 sets for 60-min budgets', () => {
      // Balanced style with 60-minute budget
      const balancedProfile: UserProfile = {
        ...baseProfile,
        preferred_days_per_week: 4,
        preferred_session_duration_mins: 60,
        intensity_style: 'balanced',
      };
      delete (balancedProfile as any).training_mentality;

      const balancedResult = synthesizeProgram(balancedProfile);
      const balancedUpperA = balancedResult.templateExercises.filter(
        (te) => te.template_id === balancedResult.templates[0].id
      );
      const balancedUpperB = balancedResult.templateExercises.filter(
        (te) => te.template_id === balancedResult.templates[2].id
      );

      const balancedUpperASets = balancedUpperA.reduce((sum, te) => sum + (te.target_sets ?? 0), 0);
      const balancedUpperBSets = balancedUpperB.reduce((sum, te) => sum + (te.target_sets ?? 0), 0);

      // Balanced Upper sessions have 7 exercises with arm superset -> 16 working sets (fits 16-20 cap)
      expect(balancedUpperASets).toBeGreaterThanOrEqual(16);
      expect(balancedUpperASets).toBeLessThanOrEqual(20);
      expect(balancedUpperBSets).toBeGreaterThanOrEqual(16);
      expect(balancedUpperBSets).toBeLessThanOrEqual(20);

      // Verify arm accessories are paired as an antagonist superset in Upper A
      const bicepCurl = balancedUpperA.find((te) => te.exercise_id === 'dumbbell_bicep_curl');
      const tricepPushdown = balancedUpperA.find((te) => te.exercise_id === 'cable_tricep_pushdown');
      expect(bicepCurl?.exercise_group_id).toBeTruthy();
      expect(tricepPushdown?.exercise_group_id).toBeTruthy();
      expect(bicepCurl?.exercise_group_id).toBe(tricepPushdown?.exercise_group_id);

      // Primary movements (Bench & Row) remain straight sets because training_enjoyment is not minimalist
      const bench = balancedUpperA.find((te) => te.exercise_id === 'barbell_bench_press');
      expect(bench?.exercise_group_id).toBeNull();

      // Precision style with 60-minute budget (high volume per exercise)
      const precisionProfile: UserProfile = {
        ...baseProfile,
        preferred_days_per_week: 4,
        preferred_session_duration_mins: 60,
        training_mentality: 'precision',
      };

      const precisionResult = synthesizeProgram(precisionProfile);
      const precisionUpperA = precisionResult.templateExercises.filter(
        (te) => te.template_id === precisionResult.templates[0].id
      );
      const precisionUpperASets = precisionUpperA.reduce((sum, te) => sum + (te.target_sets ?? 0), 0);

      // Precision Upper session is streamlined to 5 primary movements -> 17 working sets (fits 16-20 cap)
      expect(precisionUpperA).toHaveLength(5);
      expect(precisionUpperASets).toBeGreaterThanOrEqual(16);
      expect(precisionUpperASets).toBeLessThanOrEqual(20);
    });
  });

  // ==========================================================================
  // Step 8.2: Pure Dynamic Set Synthesis, Load-Gated eReps & Archetype Models
  // ==========================================================================

  describe('Step 8.2: Pure Dynamic Set Synthesis, Load-Gated eReps & Archetype Models', () => {
    describe('resolveArchetype mapping', () => {
      it('resolves Archetype I (Pure Strength) when primary goal is strength and no hypertrophy secondary', () => {
        expect(resolveArchetype('strength', [])).toBe('archetype_i_pure_strength');
        expect(resolveArchetype('strength', ['endurance'])).toBe('archetype_i_pure_strength');
      });

      it('resolves Archetype II (Powerbuilding) for powerbuilding goal or strength with hypertrophy secondary', () => {
        expect(resolveArchetype('powerbuilding', [])).toBe('archetype_ii_powerbuilding');
        expect(resolveArchetype('strength', ['hypertrophy'])).toBe('archetype_ii_powerbuilding');
      });

      it('resolves Archetype III (Hypertrophy + Minor Strength) for hypertrophy goal with strength secondary', () => {
        expect(resolveArchetype('hypertrophy', ['strength'])).toBe('archetype_iii_hypertrophy_strength');
        expect(resolveArchetype('endurance', ['strength'])).toBe('archetype_iii_hypertrophy_strength');
      });

      it('resolves Archetype IV (Pure Hypertrophy) for hypertrophy goal without strength secondary', () => {
        expect(resolveArchetype('hypertrophy', [])).toBe('archetype_iv_pure_hypertrophy');
        expect(resolveArchetype('hypertrophy', ['endurance'])).toBe('archetype_iv_pure_hypertrophy');
        expect(resolveArchetype('endurance', [])).toBe('archetype_iv_pure_hypertrophy');
      });

      it('respects continuous alphaSbd preference parameter overrides', () => {
        expect(resolveArchetype('hypertrophy', [], 0.85)).toBe('archetype_i_pure_strength');
        expect(resolveArchetype('hypertrophy', [], 0.55)).toBe('archetype_ii_powerbuilding');
        expect(resolveArchetype('strength', [], 0.30)).toBe('archetype_iii_hypertrophy_strength');
        expect(resolveArchetype('strength', [], 0.10)).toBe('archetype_iv_pure_hypertrophy');
      });
    });

    describe('SynthesizedProgramSummary archetype integration', () => {
      it('populates summary.archetype matching user profile configuration', () => {
        // Pure strength profile
        const strengthResult = synthesizeProgram({
          ...baseProfile,
          primary_goal: 'strength',
          secondary_goals: [],
        });
        expect(strengthResult.summary.archetype).toBe('archetype_i_pure_strength');

        // Powerbuilding profile
        const powerResult = synthesizeProgram({
          ...baseProfile,
          primary_goal: 'powerbuilding',
          secondary_goals: [],
        });
        expect(powerResult.summary.archetype).toBe('archetype_ii_powerbuilding');

        // Hypertrophy + Minor strength profile
        const hypStrengthResult = synthesizeProgram({
          ...baseProfile,
          primary_goal: 'hypertrophy',
          secondary_goals: ['strength'],
        });
        expect(hypStrengthResult.summary.archetype).toBe('archetype_iii_hypertrophy_strength');

        // Pure hypertrophy profile
        const pureHypResult = synthesizeProgram({
          ...baseProfile,
          primary_goal: 'hypertrophy',
          secondary_goals: [],
        });
        expect(pureHypResult.summary.archetype).toBe('archetype_iv_pure_hypertrophy');
      });
    });

    describe('Dynamic Double Progression (DDP) on Tier 2 & Tier 3 exercises', () => {
      it('assigns DDP to all Tier 2 and Tier 3 exercises for non-beginners across Archetypes II, III, and IV', () => {
        const intermediateProfile: UserProfile = {
          ...baseProfile,
          primary_goal: 'hypertrophy',
          secondary_goals: ['strength'],
          training_mentality: 'precision',
        };

        const result = synthesizeProgram(intermediateProfile);
        const templateExercises = result.templateExercises;

        // Group by exercise slot
        for (const te of templateExercises) {
          const rules = result.progressionRules.filter(
            (r) => r.template_exercise_id === te.id && r.priority !== 3 // exclude AMRAP rules
          );

          // In Precision, primary compounds have 4 sets (LP), accessories / Tier 2 & 3 have 3 sets (DDP)
          if (te.target_sets === 3) {
            const hasDdp = rules.some((r) => {
              const j = typeof r.rule_json === 'string' ? JSON.parse(r.rule_json) : r.rule_json;
              return j.conditions.some((c: any) => c.type === 'ANY_SET_HIT_TOP_REP_RANGE');
            });
            expect(hasDdp).toBe(true);
          }
        }
      });
    });

    describe('Dynamic set allocation via computeTargetSetsFromExertion', () => {
      it('synthesizes exact set counts matching exertion-derived eRep budgets', () => {
        // Fury: 2 sets compound (@ RPE 8.0, 2.0 RIR), 1 set accessory (@ RPE 9.5, 0.5 RIR)
        const furyResult = synthesizeProgram({
          ...baseProfile,
          training_mentality: 'fury',
        });
        const furyCompounds = furyResult.templateExercises.filter((te) => te.target_rir === 2.0);
        const furyAccessories = furyResult.templateExercises.filter((te) => te.target_rir === 0.5);
        expect(furyCompounds[0].target_sets).toBe(2);
        expect(furyAccessories[0].target_sets).toBe(1);

        // Precision: 4 sets compound (@ RPE 8.0, 2.0 RIR), 3 sets accessory (@ RPE 8.0, 2.0 RIR)
        const precisionResult = synthesizeProgram({
          ...baseProfile,
          training_mentality: 'precision',
        });
        for (const te of precisionResult.templateExercises) {
          expect(te.target_sets).toBeGreaterThanOrEqual(3);
          expect(te.target_rir).toBe(2.0);
        }

        // Get Out: 2 sets compound (@ RPE 8.5, 1.5 RIR), 2 sets accessory (@ RPE 8.5, 1.5 RIR)
        const getOutResult = synthesizeProgram({
          ...baseProfile,
          training_mentality: 'get_out',
          preferred_session_duration_mins: 60,
        });
        for (const te of getOutResult.templateExercises) {
          expect(te.target_sets).toBe(2);
          expect(te.target_rir).toBe(1.5);
        }
      });
    });
  });

  // ==========================================================================
  // Step 9.3: Adaptive Planner Selection & Joint-ROM Protection Router
  // ==========================================================================

  describe('Step 9.3: Adaptive Planner Selection & Joint-ROM Protection Router', () => {
    it('completely excludes blacklisted exercises and routes to highest-scoring eligible fallback', () => {
      // Blacklist barbell_bench_press
      const preferences = [
        {
          exercise_id: 'barbell_bench_press',
          sentiment: 'blacklisted' as const,
          swap_in_count: 0,
          swap_out_count: 0,
          affinity_score: -999,
          updated_at: new Date().toISOString(),
        },
      ];

      const result = synthesizeProgram(baseProfile, { preferences });
      const allIds = result.templateExercises.map((te) => te.exercise_id);

      // barbell_bench_press must NOT appear
      expect(allIds).not.toContain('barbell_bench_press');

      // Upper A should have picked machine_chest_press as the highest-scoring eligible fallback (SFR 90 vs DB bench 85)
      const upperA = result.templates.find((t) => t.name.includes('Upper A'));
      const upperAExercises = result.templateExercises.filter((te) => te.template_id === upperA?.id);
      expect(upperAExercises[0].exercise_id).toBe('machine_chest_press');
    });

    it('prioritizes liked exercises over default fallbacks', () => {
      // User likes machine_chest_press (+25 affinity bonus)
      const preferences = [
        {
          exercise_id: 'machine_chest_press',
          sentiment: 'liked' as const,
          swap_in_count: 3,
          swap_out_count: 0,
          affinity_score: 25,
          updated_at: new Date().toISOString(),
        },
      ];

      const result = synthesizeProgram(baseProfile, { preferences });
      const allIds = result.templateExercises.map((te) => te.exercise_id);

      // machine_chest_press (SFR 90 + 25 = 115) should beat barbell_bench_press (SFR 75 + 35 = 110)
      expect(allIds).toContain('machine_chest_press');
    });

    it('penalizes high axial loading by -30 points in caloric deficit or axial fatigue sensitivity', () => {
      const deficitProfile: UserProfile = {
        ...baseProfile,
        preferred_days_per_week: 3, // Full Body split
        secondary_goals: ['cutting', 'caloric_deficit'],
      };

      const result = synthesizeProgram(deficitProfile);
      const day2 = result.templates[1];
      const day2Exercises = result.templateExercises.filter((te) => te.template_id === day2.id);

      // In Full Body Day 2, deadlift slot has preferredId 'barbell_deadlift' (high axial, SFR 55)
      // With -30 axial penalty (55 + 35 - 30 = 60), high-SFR machine_leg_press (axial: none, SFR 85) wins!
      const deadliftSlot = day2Exercises[0];
      expect(deadliftSlot.exercise_id).not.toBe('barbell_deadlift');
      expect(deadliftSlot.exercise_id).toBe('machine_leg_press');
    });

    it('protects injured joints by routing away from deep_stretch and elevating terminal-sparing exercises', () => {
      // Athlete reports shoulder pain (severity 4)
      const result = synthesizeProgram(baseProfile, {
        painfulJoint: 'shoulder',
        painSeverity: 4,
      });

      const allIds = result.templateExercises.map((te) => te.exercise_id);
      // Ensure deep stretch chest movements are avoided
      expect(allIds).not.toContain('dumbbell_chest_fly');
      expect(allIds).not.toContain('cable_chest_fly');
    });

    it('covers complementary regional sub-targets across PPL weekly split (Push A vs Push B)', () => {
      const pplProfile: UserProfile = {
        ...baseProfile,
        preferred_days_per_week: 6,
      };

      const result = synthesizeProgram(pplProfile);
      const pushA = result.templates.find((t) => t.name.includes('Push A'));
      const pushB = result.templates.find((t) => t.name.includes('Push B'));

      const pushAExercises = result.templateExercises.filter((te) => te.template_id === pushA?.id);
      const pushBExercises = result.templateExercises.filter((te) => te.template_id === pushB?.id);

      // Push A targets upper_clavicular chest (incline) + long_head triceps (skull crusher)
      expect(pushAExercises[0].exercise_id).toBe('barbell_incline_bench_press');
      expect(pushAExercises[4].exercise_id).toBe('barbell_skull_crusher');

      // Push B targets mid_sternal chest (flat bench) + lateral_head triceps (pushdown)
      expect(pushBExercises[0].exercise_id).toBe('barbell_bench_press');
      expect(pushBExercises[4].exercise_id).toBe('cable_tricep_pushdown');
    });

    it('covers complementary regional sub-targets across Upper/Lower split (Upper A vs Upper B)', () => {
      const ulProfile: UserProfile = {
        ...baseProfile,
        preferred_days_per_week: 4,
        preferred_session_duration_mins: 75, // Include arm accessories
      };

      const result = synthesizeProgram(ulProfile);
      const upperA = result.templates.find((t) => t.name.includes('Upper A'));
      const upperB = result.templates.find((t) => t.name.includes('Upper B'));

      const upperAExercises = result.templateExercises.filter((te) => te.template_id === upperA?.id);
      const upperBExercises = result.templateExercises.filter((te) => te.template_id === upperB?.id);

      // Upper A: mid_sternal chest (barbell_bench_press) + lateral/medial triceps (cable_tricep_pushdown)
      expect(upperAExercises[0].exercise_id).toBe('barbell_bench_press');
      const upperATricep = upperAExercises.find((te) => te.exercise_id === 'cable_tricep_pushdown');
      expect(upperATricep).toBeDefined();

      // Upper B: upper_clavicular chest (barbell_incline_bench_press) + long_head triceps (barbell_skull_crusher)
      expect(upperBExercises[0].exercise_id).toBe('barbell_incline_bench_press');
      const upperBTricep = upperBExercises.find((te) => te.exercise_id === 'barbell_skull_crusher');
      expect(upperBTricep).toBeDefined();
    });
  });
});
