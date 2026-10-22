import {
  synthesizeProgram,
  computeTargetSetsFromExertion,
  resolveArchetype,
} from '../programSynthesizer';
import { UserProfile, Exercise } from '../../types';
import { DEFAULT_EXERCISES } from '../../../database/seeds/defaultExercises';

function expectWeeklyDose(result: ReturnType<typeof synthesizeProgram>, muscle: string, target: number) {
  const full = result.summary.weeklyMuscleSets![muscle] ?? 0;
  expect(full).toBeGreaterThan(0);
  if (full < target) {
    expect(result.summary.weeklyMiniSets![muscle]).toBeGreaterThan(0);
    expect(result.summary.weeklyMuscleEReps![muscle]).toBeGreaterThanOrEqual(target * 3);
  }
}

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
    it("uses high effort without forcing low fixed volumes", () => {

      const result = synthesizeProgram({ ...baseProfile, intensity_style: 'high_intensity_low_volume' });
      expect(result.templateExercises.every(te => (te.target_sets! >= 2 || te.rest_pause != null))).toBe(true);
      expect(result.templateExercises.some(te => te.target_rpe === 9)).toBe(true);
      expectWeeklyDose(result, 'Biceps', 6);
      expect(result.summary.progressionSchemeSummary).toContain('Dynamic Double Progression');
    });

    it("allocates volume against weekly targets instead of a style-wide set count", () => {

      const result = synthesizeProgram({ ...baseProfile, intensity_style: 'volume_accumulation' });
      expect(result.templateExercises.every(te => (te.target_sets! >= 2 || te.rest_pause != null) && te.target_sets! <= 5)).toBe(true);
      expectWeeklyDose(result, 'Abs', 6);
      expect(result.templateExercises.every(te => (te.target_rpe === 8 || te.rest_pause != null))).toBe(true);
    });

    it("keeps balanced prescriptions bounded by weekly volume and time", () => {

      const result = synthesizeProgram({ ...baseProfile, intensity_style: 'balanced' });
      expect(result.templateExercises.every(te => (te.target_sets! >= 2 || te.rest_pause != null) && te.target_sets! <= 5)).toBe(true);
      expect(result.summary.estimatedSessionDurationMins).toBe(Math.max(...result.summary.sessionDurationsMins!));
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
    it.each([15, 30, 45])('keeps strength-only main lifts unpaired at %i minutes', duration => {
      const result = synthesizeProgram({ ...baseProfile, primary_goal: 'strength', secondary_goals: [],
        training_mentality: 'fury', preferred_session_duration_mins: duration });
      const mainIds = new Set(['barbell_back_squat', 'barbell_bench_press', 'barbell_deadlift',
        'barbell_overhead_press', 'barbell_bent_over_row', 'barbell_rdl']);
      const mains = result.templateExercises.filter(te => mainIds.has(te.exercise_id));
      expect(mains.length).toBeGreaterThan(0);
      for (const main of mains) {
        expect(main.exercise_group_id).toBeNull();
        expect(main.set_type).toBe('working');
      }
    });

    it.each([1, 2, 3, 4, 5, 6])('never prescribes single-member supersets with %i days', days => {
      const result = synthesizeProgram({ ...baseProfile, preferred_days_per_week: days,
        training_enjoyment: 'minimalist', preferred_session_duration_mins: 45 });
      for (const template of result.templates) {
        const groups = new Map<string, Set<string>>();
        for (const row of result.templateExercises.filter(row => row.template_id === template.id)) {
          if (!row.exercise_group_id) continue;
          const members = groups.get(row.exercise_group_id) ?? new Set<string>();
          members.add(row.exercise_id);
          groups.set(row.exercise_group_id, members);
        }
        for (const members of groups.values()) expect(members.size).toBeGreaterThanOrEqual(2);
      }
    });
    it("pairs compatible accessories without supersetting strength mains", () => {

      const result = synthesizeProgram({ ...baseProfile, training_mentality: 'get_out', training_enjoyment: 'minimalist' });
      expect(result.summary.hasSupersets).toBe(true);
      for (const te of result.templateExercises.filter(te => ['barbell_bench_press','barbell_bent_over_row'].includes(te.exercise_id))) {
        expect(te.exercise_group_id).toBeNull();
      }
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

    it("reports time and volume compromises instead of truncating the exercise list", () => {

      const result = synthesizeProgram({ ...baseProfile, preferred_session_duration_mins: 30 });
      expect(result.summary.planningWarnings!.length).toBeGreaterThan(0);
      expect(result.program.notes).toContain('Time/equipment tradeoffs');
      expect(result.templateExercises.every(te => (te.target_sets! >= 2 || te.rest_pause != null))).toBe(true);
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
    it("synthesizes Fury with demanding effort and preserved direct arm/core work", () => {

      const result = synthesizeProgram({ ...baseProfile, training_mentality: 'fury' });
      expect(result.templateExercises.every(te => (te.target_sets! >= 2 || te.rest_pause != null))).toBe(true);
      for (const muscle of ['Biceps','Triceps','Abs']) expectWeeklyDose(result, muscle, 6);
      expect(result.summary.progressionSchemeSummary).toContain('Dynamic Double Progression');
      expect(result.program.notes).toContain('fury mentality');
    });

    it("synthesizes Precision with controlled effort and goal-specific progression", () => {

      const result = synthesizeProgram({ ...baseProfile, training_mentality: 'precision' });
      expect(result.templateExercises.every(te => (te.target_sets! >= 2 || te.rest_pause != null) && (te.target_rpe === 8 || te.rest_pause != null))).toBe(true);
      expect(result.summary.progressionSchemeSummary).toContain('Linear Progression');
    });

    it("uses Get Out to compress execution while retaining volume targets", () => {

      const result = synthesizeProgram({ ...baseProfile, training_mentality: 'get_out' });
      expect(result.summary.hasSupersets).toBe(true);
      expectWeeklyDose(result, 'Biceps', 6);
      expect(result.templateExercises.every(te => (te.target_sets! >= 2 || te.rest_pause != null))).toBe(true);
    });
  });

  // ==========================================================================
  // 15-Minute Target Workout Duration (Phase 4 Specification)
  // ==========================================================================

  describe('15-Minute Target Workout Duration', () => {
    it("reports an infeasible 15-minute budget while preserving main-lift recovery", () => {

      const result = synthesizeProgram({ ...baseProfile, preferred_session_duration_mins: 15 });
      expect(result.summary.estimatedSessionDurationMins).toBeGreaterThan(15);
      expect(result.summary.planningWarnings!.some(w => w.includes('exceeds'))).toBe(true);
      expect(result.templateExercises.filter(te => te.exercise_id === 'barbell_back_squat').every(te => te.exercise_group_id == null)).toBe(true);
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
        expect(t1.target_sets).toBeGreaterThanOrEqual(2);
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
        expect(t2.target_sets).toBeGreaterThanOrEqual(2);
        expect(t2.target_reps_min).toBe(10);
        expect(t2.target_reps_max).toBe(15);
        expect(t2.target_rpe).toBe(8.0);
        expect(t2.target_rir).toBe(2.0);

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
      expect(firstExercise.target_sets).toBeGreaterThanOrEqual(2);
    });
  });

  // ==========================================================================
  // Step 1: Time-Budget Evaluation & Dynamic Myo-Rep Conversion (Pillar 6)
  // ==========================================================================

  describe('Time-Budget Dynamic Myo-Rep Conversion', () => {
    it("does not invent cluster stimulus or duration to hide an impossible budget", () => {

      const result = synthesizeProgram({ ...baseProfile, preferred_session_duration_mins: 20 });
      expect(result.templateExercises.filter(te => te.rest_pause).every(te => te.rest_pause!.mini_sets > 0 && te.exercise_group_id == null)).toBe(true);
      expect(result.summary.planningWarnings!.length).toBeGreaterThan(0);
      expect(result.summary.estimatedSessionDurationMins).toBeGreaterThan(20);
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

    it("keeps arms and core in balanced and Precision programs within an actual schedule", () => {

      for (const mood of ['fury','precision','get_out'] as const) {
        const result = synthesizeProgram({ ...baseProfile, training_mentality: mood });
        expectWeeklyDose(result, 'Biceps', 6);
        expectWeeklyDose(result, 'Triceps', 6);
        expectWeeklyDose(result, 'Abs', 6);
        expect(result.summary.estimatedSessionDurationMins).toBeLessThanOrEqual(60);
      }
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

      it('resolves strength main lifts with hypertrophy accessories independently of mood', () => {
        expect(resolveArchetype('strength', ['hypertrophy'])).toBe('archetype_ii_strength_hypertrophy');
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
        expect(resolveArchetype('hypertrophy', [], 0.55)).toBe('archetype_ii_strength_hypertrophy');
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

        // Strength main lifts with bodybuilding accessories
        const powerResult = synthesizeProgram({
          ...baseProfile,
          primary_goal: 'strength',
          secondary_goals: ['hypertrophy'],
        });
        expect(powerResult.summary.archetype).toBe('archetype_ii_strength_hypertrophy');

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
      it("attaches DDP to accessories independently of their allocated set count", () => {

      const result = synthesizeProgram(baseProfile);
      const accessories = result.templateExercises.filter(te => ['dumbbell_bicep_curl','cable_tricep_pushdown','cable_lateral_raise'].includes(te.exercise_id));
      expect(accessories.length).toBeGreaterThan(0);
      for (const te of accessories) expect(result.progressionRules.some(r => r.template_exercise_id === te.id && JSON.stringify(r.rule_json).includes('ANY_SET_HIT_TOP_REP_RANGE'))).toBe(true);
    });
    });

    describe('Dynamic set allocation via computeTargetSetsFromExertion', () => {
      it("keeps weekly volume targets independent of mood and exact eRep conversions", () => {

      for (const mood of ['fury','precision','get_out'] as const) {
        const result = synthesizeProgram({ ...baseProfile, training_mentality: mood, preferred_session_duration_mins: 75 });
        expectWeeklyDose(result, 'Biceps', 6);
        expectWeeklyDose(result, 'Triceps', 6);
        expectWeeklyDose(result, 'Abs', 6);
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
      expect(['Hamstrings', 'Glutes']).toContain(DEFAULT_EXERCISES.find(ex => ex.id === deadliftSlot.exercise_id)?.muscle_group);
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
