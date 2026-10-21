/**
 * Workout Suite — Program Evolution Service Test Suite
 *
 * Validates Step 8.3 of IMPLEMENTATION_PLAN.md:
 * 1. Mid-flight mood staging with `pending_meso_mood = true`
 * 2. Faz Lifts' "Weight Mastery" gating (holding load progression on RPE >= 9.5 or joint pain >= 3)
 * 3. End-of-Meso Evolution preserving program.id, workout_templates.id, template_exercises.id
 * 4. Multi-Vector Program Evolution:
 *    - Vector 1: Axial & SFR Rebalance (e.g. Barbell Back Squat -> Leg Press)
 *    - Vector 2: Rep brackets & rest interval updates
 *    - Vector 3: effort-adjusted capacity on Tier 1; DDP on Tier 2/3
 *    - Vector 4: Isometric eRep invariance (~32 weekly stimulating reps)
 * 5. Program block closure & Meso N+1 activation
 * 6. Deterministic offline Markdown diff generation
 */

import { ProgramEvolutionService } from '../programEvolutionService';
import { MockProgramRepository } from '../../database/mocks/MockProgramRepository';
import { MockUserProfileRepository } from '../../database/mocks/MockUserProfileRepository';
import { MockWorkoutRepository } from '../../database/mocks/MockWorkoutRepository';
import { MockPainReportRepository } from '../../database/mocks/MockPainReportRepository';
import { MockExerciseRepository } from '../../database/mocks/MockExerciseRepository';
import {
  UserProfile,
  Exercise,
  WorkoutTemplate,
  TemplateExercise,
  ProgressionRule,
  Program,
  ProgramBlock,
} from '../../core/types';

describe('ProgramEvolutionService (Step 8.3)', () => {
  let programRepo: MockProgramRepository;
  let userProfileRepo: MockUserProfileRepository;
  let workoutRepo: MockWorkoutRepository;
  let painReportRepo: MockPainReportRepository;
  let exerciseRepo: MockExerciseRepository;
  let service: ProgramEvolutionService;

  const sampleExercises: Exercise[] = [
    {
      id: 'barbell_back_squat',
      name: 'Barbell Back Squat',
      muscle_group: 'Quads',
      category: 'Barbell',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 20.0,
      is_custom: false,
      parent_exercise_id: null,
      standard_lift_type: 'squat',
      default_rest_seconds: 180,
    },
    {
      id: 'machine_leg_press',
      name: 'Leg Press',
      muscle_group: 'Quads',
      category: 'Machine',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 0.0,
      is_custom: false,
      parent_exercise_id: null,
      standard_lift_type: null,
      default_rest_seconds: 120,
    },
    {
      id: 'cable_lateral_raise',
      name: 'Cable Lateral Raise',
      muscle_group: 'Shoulders',
      category: 'Cable',
      is_compound: false,
      is_bodyweight: false,
      is_unilateral: true,
      load_mode: 'per_hand',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 0.0,
      is_custom: false,
      parent_exercise_id: null,
      standard_lift_type: null,
      default_rest_seconds: 60,
    },
    {
      id: 'barbell_bench_press',
      name: 'Barbell Bench Press',
      muscle_group: 'Chest',
      category: 'Barbell',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 20.0,
      is_custom: false,
      parent_exercise_id: null,
      standard_lift_type: 'bench',
      default_rest_seconds: 180,
    },
  ];

  const defaultProfile: UserProfile = {
    id: 'user-profile-1',
    gender: 'male',
    birthdate: '1995-03-20',
    height_cm: 180,
    training_mentality: 'precision',
    primary_goal: 'hypertrophy',
    secondary_goals: ['strength'],
    preferred_days_per_week: 4,
    preferred_session_duration_mins: 60,
    equipment_access: 'commercial_gym',
    experience_level: 'intermediate',
    pending_meso_mood: false,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };

  beforeEach(async () => {
    programRepo = new MockProgramRepository();
    userProfileRepo = new MockUserProfileRepository();
    workoutRepo = new MockWorkoutRepository();
    painReportRepo = new MockPainReportRepository();
    exerciseRepo = new MockExerciseRepository(sampleExercises);

    await userProfileRepo.saveProfile(defaultProfile);

    service = new ProgramEvolutionService(
      programRepo,
      userProfileRepo,
      workoutRepo,
      painReportRepo,
      exerciseRepo
    );
  });

  // ==========================================================================
  // 1. Mid-flight Mood Staging
  // ==========================================================================
  describe('Mid-flight Mood Staging', () => {
    test('queues mood changes with pending_meso_mood = true without altering active program', async () => {
      expect(await service.hasPendingMesoMood()).toBe(false);

      const updated = await service.queueMesoMood({
        training_mentality: 'fury',
        primary_goal: 'strength',
        preferred_session_duration_mins: 45,
      });

      expect(updated.training_mentality).toBe('fury');
      expect(updated.primary_goal).toBe('strength');
      expect(updated.preferred_session_duration_mins).toBe(45);
      expect(updated.pending_meso_mood).toBe(true);
      expect(await service.hasPendingMesoMood()).toBe(true);

      await service.clearPendingMesoMood();
      expect(await service.hasPendingMesoMood()).toBe(false);
    });

    test('isReadyForEvolution detects block completion from start date', async () => {
      const program: Program = {
        id: 'prog-1',
        name: 'Meso 1 Upper/Lower',
        color_hex: '#00E676',
        notes: null,
        created_at: '2026-09-01T00:00:00Z',
      };
      await programRepo.create(program);

      // Block started 35 days ago (5 weeks ago -> >= 4 weeks)
      const pastDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const block: ProgramBlock = {
        id: 'block-1',
        program_id: 'prog-1',
        start_date: pastDate,
        end_date: null,
      };
      await programRepo.createProgramBlock(block);

      const check = await service.isReadyForEvolution('prog-1');
      expect(check.ready).toBe(true);
      expect(check.completedWeeks).toBeGreaterThanOrEqual(4);
      expect(check.reason).toContain('Ready for Meso N+1 evolution');
    });
  });

  // ==========================================================================
  // 2. Faz Lifts' "Weight Mastery" Gating
  // ==========================================================================
  describe("Faz Lifts' Weight Mastery Gating", () => {
    test('passes weight mastery when sets are submaximal and joint is healthy', async () => {
      // Log clean set at RPE 8.0
      const workout = await workoutRepo.create({
        id: 'w-1',
        template_id: 'tpl-1',
        name: 'Lower Day',
        status: 'completed',
        date: '2026-10-18',
        started_at: '2026-10-18T10:00:00Z',
        completed_at: '2026-10-18T11:00:00Z',
        duration_seconds: 3600,
        notes: null,
        imported_from: null,
      });

      await workoutRepo.addSet({
        id: 'set-1',
        workout_id: workout.id,
        exercise_id: 'barbell_back_squat',
        gear_id: null,
        set_number: 1,
        weight: 100,
        raw_input_weight: 100,
        added_weight: null,
        reps: 8,
        reps_right: null,
        rpe: 8.0,
        rir: 2.0,
        set_notes: null,
        exercise_group_id: null,
        created_at: '2026-10-18T10:15:00Z',
        set_type: 'working',
      });

      const result = await service.checkWeightMastery('barbell_back_squat');
      expect(result.passed).toBe(true);
      expect(result.holdLoad).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    test('holds load progression when RPE overshoots >= 9.5 on submaximal lift', async () => {
      const workout = await workoutRepo.create({
        id: 'w-2',
        template_id: 'tpl-1',
        name: 'Lower Day',
        status: 'completed',
        date: '2026-10-18',
        started_at: '2026-10-18T10:00:00Z',
        completed_at: '2026-10-18T11:00:00Z',
        duration_seconds: 3600,
        notes: null,
        imported_from: null,
      });

      await workoutRepo.addSet({
        id: 'set-2',
        workout_id: workout.id,
        exercise_id: 'barbell_back_squat',
        gear_id: null,
        set_number: 1,
        weight: 100,
        raw_input_weight: 100,
        added_weight: null,
        reps: 8,
        reps_right: null,
        rpe: 9.5, // Overshoot
        rir: 0.5,
        set_notes: null,
        exercise_group_id: null,
        created_at: '2026-10-18T10:15:00Z',
        set_type: 'working',
      });

      const result = await service.checkWeightMastery('barbell_back_squat');
      expect(result.passed).toBe(false);
      expect(result.holdLoad).toBe(true);
      expect(result.reason).toContain('RPE overshoot');
      expect(result.maxRpeLogged).toBe(9.5);
    });

    test('holds load progression when joint discomfort is logged (severity >= 3)', async () => {
      await painReportRepo.create({
        workout_id: 'w-3',
        exercise_id: 'barbell_back_squat',
        pain_type: 'joint',
        severity: 4, // >= 3
        joint_location: 'knee',
        notes: 'Patellar tendon pinching at bottom of squat',
      });

      const result = await service.checkWeightMastery('barbell_back_squat');
      expect(result.passed).toBe(false);
      expect(result.holdLoad).toBe(true);
      expect(result.reason).toContain('Joint discomfort (severity 4/5)');
      expect(result.jointPainSeverity).toBe(4);
    });
  });

  // ==========================================================================
  // 3. Mesocycle Evolution & Multi-Vector Mutations
  // ==========================================================================
  describe('Mesocycle Evolution Engine', () => {
    let programId: string;
    let templateId: string;
    let squatTeId: string;
    let lateralTeId: string;

    beforeEach(async () => {
      programId = 'prog-meso-test';
      templateId = 'tpl-leg-day';
      squatTeId = 'te-squat-1';
      lateralTeId = 'te-lateral-1';

      // 1. Setup existing program hierarchy
      const program: Program = {
        id: programId,
        name: 'Meso 1 Upper/Lower',
        color_hex: '#00E676',
        notes: null,
        created_at: '2026-09-15T00:00:00Z',
      };
      await programRepo.create(program);

      const template: WorkoutTemplate = {
        id: templateId,
        program_id: programId,
        name: 'Lower Day',
        notes: null,
        order_index: 0,
        created_at: '2026-09-15T00:00:00Z',
      };
      await programRepo.createTemplate(template);

      // Squat: Tier 1 compound (order_index 0)
      const squatTe: TemplateExercise = {
        id: squatTeId,
        template_id: templateId,
        exercise_id: 'barbell_back_squat',
        gear_id: null,
        target_sets: 4,
        target_reps_min: 8,
        target_reps_max: 12,
        target_rpe: 8.0,
        target_rir: 2.0,
        order_index: 0,
        exercise_group_id: null,
        set_type: 'working',
      };

      // Lateral: Tier 2 accessory (order_index 1)
      const lateralTe: TemplateExercise = {
        id: lateralTeId,
        template_id: templateId,
        exercise_id: 'cable_lateral_raise',
        gear_id: null,
        target_sets: 4,
        target_reps_min: 10,
        target_reps_max: 15,
        target_rpe: 8.0,
        target_rir: 2.0,
        order_index: 1,
        exercise_group_id: null,
        set_type: 'working',
      };

      await programRepo.createTemplateExercise(squatTe);
      await programRepo.createTemplateExercise(lateralTe);

      // Initial linear rules
      const squatRule: ProgressionRule = {
        id: 'rule-sq-1',
        template_exercise_id: squatTeId,
        priority: 1,
        rule_json: JSON.stringify({ type: 'linear', incrementKg: 2.5 }),
      };
      await programRepo.createProgressionRule(squatRule);

      // Active Block
      const block: ProgramBlock = {
        id: 'block-meso-1',
        program_id: programId,
        start_date: '2026-09-15',
        end_date: null,
      };
      await programRepo.createProgramBlock(block);
    });

    test('preserves program.id, template.id, and template_exercises.id through evolution', async () => {
      const result = await service.evolveActiveProgramForNextMeso({
        programId,
        startDate: '2026-10-20',
      });

      // Program ID preserved
      expect(result.programId).toBe(programId);

      // Template exercises IDs preserved
      const squatEvolved = result.evolvedTemplateExercises.find(
        (te) => te.id === squatTeId
      );
      const lateralEvolved = result.evolvedTemplateExercises.find(
        (te) => te.id === lateralTeId
      );
      expect(squatEvolved).toBeDefined();
      expect(lateralEvolved).toBeDefined();
      expect(squatEvolved?.id).toBe(squatTeId);
      expect(lateralEvolved?.id).toBe(lateralTeId);

      // Blocks: old block closed, new block opened
      const blocks = await programRepo.findProgramBlocksByProgramId(programId);
      expect(blocks.length).toBe(2);

      const oldBlock = blocks.find((b) => b.id === 'block-meso-1');
      expect(oldBlock?.end_date).toBe('2026-10-20');

      const newBlock = blocks.find((b) => b.end_date === null);
      expect(newBlock).toBeDefined();
      expect(newBlock?.start_date).toBe('2026-10-20');
      expect(result.newBlockId).toBe(newBlock?.id);
      expect(result.mesoNumber).toBe(2);
    });

    test('Vector 1: rebalances high-axial compound to high-SFR machine under pure hypertrophy or pain', async () => {
      // Update profile to Pure Hypertrophy (Archetype IV)
      await userProfileRepo.saveProfile({
        ...defaultProfile,
        primary_goal: 'hypertrophy',
        secondary_goals: [], // Pure hypertrophy without strength
      });

      const result = await service.evolveActiveProgramForNextMeso({
        programId,
        startDate: '2026-10-20',
      });

      const squatTe = result.evolvedTemplateExercises.find((te) => te.id === squatTeId);
      expect(squatTe?.exercise_id).toBe('machine_leg_press'); // Rebalanced along axial spectrum

      // Verify diff item created
      const swapDiff = result.diffItems.find((d) => d.category === 'exercise_swap');
      expect(swapDiff).toBeDefined();
      expect(swapDiff?.title).toContain('Barbell Back Squat Replaced with Leg Press');
    });

    test('Vector 2 & 3: migrates Tier 1 compound to effort-adjusted capacity and Tier 2 to DDP', async () => {
      // Profile: Powerbuilding (Archetype II)
      await userProfileRepo.saveProfile({
        ...defaultProfile,
        primary_goal: 'powerbuilding',
      });

      const result = await service.evolveActiveProgramForNextMeso({
        programId,
        startDate: '2026-10-20',
      });

      // Vector 2: Rep bracket on Tier 1 compound shifts to 3-6 reps, rest to 240s
      const squatTe = result.evolvedTemplateExercises.find((te) => te.id === squatTeId);
      expect(squatTe?.target_reps_min).toBe(3);
      expect(squatTe?.target_reps_max).toBe(6);

      // Vector 3: Tier 1 rules contain effort-adjusted capacity
      const squatRules = await programRepo.findRulesByTemplateExerciseId(squatTeId);
      expect(squatRules.length).toBe(3);
      expect(
        squatRules.some((r) =>
          (typeof r.rule_json === 'string' ? r.rule_json : JSON.stringify(r.rule_json)).includes('INCREASE_LOAD_FROM_ESTIMATED_CAPACITY')
        )
      ).toBe(true);
      expect(
        squatRules.some((r) =>
          (typeof r.rule_json === 'string' ? r.rule_json : JSON.stringify(r.rule_json)).includes('SCHEDULE_AMRAP_MIDWAY')
        )
      ).toBe(false);
      expect(
        squatRules.some((r) =>
          (typeof r.rule_json === 'string' ? r.rule_json : JSON.stringify(r.rule_json)).includes('SCHEDULE_AMRAP_FINAL_WEEK')
        )
      ).toBe(false);

      // Vector 3: Tier 2 rules contain DDP (success rule + plateau rule)
      const lateralRules = await programRepo.findRulesByTemplateExerciseId(lateralTeId);
      expect(lateralRules.length).toBe(3);
      expect(
        lateralRules.some((r) =>
          (typeof r.rule_json === 'string' ? r.rule_json : JSON.stringify(r.rule_json)).includes('ANY_SET_HIT_TOP_REP_RANGE')
        )
      ).toBe(true);

      // Diff items include progression migration
      const progDiff = result.diffItems.find((d) => d.category === 'progression');
      expect(progDiff).toBeDefined();
      expect(progDiff?.title).toContain('Progression Migrated');
    });

    test('Vector 4: preserves ~32 weekly eReps invariant when mentality switches to Fury', async () => {
      // User switches to Fury (high effort density, 0.5 RIR -> ~4.5 eReps/set)
      await userProfileRepo.saveProfile({
        ...defaultProfile,
        training_mentality: 'fury',
      });

      const result = await service.evolveActiveProgramForNextMeso({
        programId,
        startDate: '2026-10-20',
      });

      const lateralTe = result.evolvedTemplateExercises.find(
        (te) => te.id === lateralTeId
      );
      expect(lateralTe?.target_rir).toBe(0.5);
      expect(lateralTe?.target_rpe).toBe(9.5);
      // Working sets scale down (e.g. 2 sets) because each set yields ~4.5-5 eReps
      expect(lateralTe?.target_sets).toBeLessThanOrEqual(3);
    });

    test('activates Mentality Transition Wave and embeds metadata when mentality shifts', async () => {
      // Set previous notes indicating precision mentality
      const existingProg = await programRepo.findById(programId);
      if (existingProg) {
        existingProg.notes = 'Mesocycle 1 (Evolved for precision mentality, archetype_iii_hypertrophy_strength)';
        await programRepo.update(existingProg);
      }

      // Trainee shifts to Fury
      await userProfileRepo.saveProfile({
        ...defaultProfile,
        training_mentality: 'fury',
      });

      const result = await service.evolveActiveProgramForNextMeso({
        programId,
        startDate: '2026-10-20',
      });

      expect(result.transitionWave).toBeDefined();
      expect(result.transitionWave?.isTransitionActive).toBe(true);
      expect(result.transitionWave?.fromMentality).toBe('precision');
      expect(result.transitionWave?.toMentality).toBe('fury');
      expect(result.transitionWave?.currentWeek).toBe(1);
      expect(result.transitionWave?.totalWeeks).toBe(3);
      expect(result.transitionWave?.bannerMessage).toContain('Mentality Transition: Week 1 of 3 (Precision → Fury)');

      // Check updated program notes contain transition wave marker
      const updatedProg = await programRepo.findById(programId);
      expect(updatedProg?.notes).toContain('TRANSITION_WAVE:');

      // Check diff items contain transition wave explanation
      const waveDiff = result.diffItems.find((d) => d.title.includes('Transition Wave'));
      expect(waveDiff).toBeDefined();
      expect(waveDiff?.explanation).toContain('Mentality Transition: Week 1 of 3');
    });

    test('generates formatted markdown diff and summary badge in result', async () => {
      const result = await service.evolveActiveProgramForNextMeso({
        programId,
        startDate: '2026-10-20',
      });

      expect(result.diffMarkdown).toContain('### 🚀 Mesocycle 2 Ready');
      expect(result.summaryBadge).toMatch(/Adjustment.*Staged|Baseline Maintained/);
      expect(result.diffItems.length).toBeGreaterThan(0);
    });
  });
});
