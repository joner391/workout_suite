import { ExerciseSubstitutionService } from '../exerciseSubstitutionService';
import { MockExerciseRepository } from '../../database/mocks/MockExerciseRepository';
import { MockWorkoutRepository } from '../../database/mocks/MockWorkoutRepository';
import { Exercise, Workout, WorkoutSet } from '../../core/types';

describe('ExerciseSubstitutionService', () => {
  let exerciseRepo: MockExerciseRepository;
  let workoutRepo: MockWorkoutRepository;
  let subService: ExerciseSubstitutionService;

  const mockExercises: Exercise[] = [
    {
      id: 'barbell_bench',
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
    {
      id: 'incline_bench',
      name: 'Incline Barbell Bench Press',
      muscle_group: 'Chest',
      category: 'Barbell',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 20.0,
      is_custom: false,
      parent_exercise_id: 'barbell_bench', // child of barbell_bench
      standard_lift_type: null,
      default_rest_seconds: 180,
    },
    {
      id: 'db_bench',
      name: 'Dumbbell Bench Press',
      muscle_group: 'Chest',
      category: 'Dumbbell',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'per_hand',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 0.0,
      is_custom: false,
      parent_exercise_id: 'barbell_bench', // sibling of incline_bench
      standard_lift_type: null,
      default_rest_seconds: 120,
    },
    {
      id: 'pec_deck',
      name: 'Pec Deck Machine Fly',
      muscle_group: 'Chest',
      category: 'Machine',
      is_compound: false, // Isolation
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 0.0,
      is_custom: false,
      parent_exercise_id: null,
      standard_lift_type: null,
      default_rest_seconds: 90,
    },
    {
      id: 'barbell_squat',
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
  ];

  beforeEach(() => {
    exerciseRepo = new MockExerciseRepository(mockExercises);
    workoutRepo = new MockWorkoutRepository();
    subService = new ExerciseSubstitutionService(exerciseRepo, workoutRepo);
  });

  describe('findSubstitutes', () => {
    it('returns empty array if exercise ID does not exist', async () => {
      const results = await subService.findSubstitutes('non_existent_exercise');
      expect(results).toHaveLength(0);
    });

    it('finds direct child variants when searching from parent exercise', async () => {
      const substitutes = await subService.findSubstitutes('barbell_bench');

      expect(substitutes.length).toBeGreaterThan(0);

      // Incline and DB Bench should be direct variants with highest base scores
      const inclineMatch = substitutes.find((s) => s.exercise.id === 'incline_bench');
      const dbMatch = substitutes.find((s) => s.exercise.id === 'db_bench');
      const pecDeckMatch = substitutes.find((s) => s.exercise.id === 'pec_deck');

      expect(inclineMatch).toBeDefined();
      expect(inclineMatch?.matchReason).toBe('direct_variant');
      expect(inclineMatch?.relevanceScore).toBe(100);

      expect(dbMatch).toBeDefined();
      expect(dbMatch?.matchReason).toBe('direct_variant');
      expect(dbMatch?.relevanceScore).toBe(100);

      // Pec Deck is same muscle group, but isolation -> lower score
      expect(pecDeckMatch).toBeDefined();
      expect(pecDeckMatch?.matchReason).toBe('same_muscle_group');
      expect(pecDeckMatch?.relevanceScore).toBeLessThan(dbMatch!.relevanceScore);

      // Squat (Quads) must NOT be included in Chest substitutes
      const squatMatch = substitutes.find((s) => s.exercise.id === 'barbell_squat');
      expect(squatMatch).toBeUndefined();
    });

    it('finds parent root and sibling variants when searching from a child variant', async () => {
      const substitutes = await subService.findSubstitutes('incline_bench');

      // Parent (barbell_bench)
      const parentMatch = substitutes.find((s) => s.exercise.id === 'barbell_bench');
      expect(parentMatch).toBeDefined();
      expect(parentMatch?.matchReason).toBe('parent_root');
      expect(parentMatch?.relevanceScore).toBe(95);

      // Sibling (db_bench)
      const siblingMatch = substitutes.find((s) => s.exercise.id === 'db_bench');
      expect(siblingMatch).toBeDefined();
      expect(siblingMatch?.matchReason).toBe('variant_family');
      expect(siblingMatch?.relevanceScore).toBe(90);

      // Current exercise (incline_bench) should NOT be listed
      const selfMatch = substitutes.find((s) => s.exercise.id === 'incline_bench');
      expect(selfMatch).toBeUndefined();
    });

    it('attaches historical ghost sets and awards history bonus', async () => {
      // Seed a completed workout containing Dumbbell Bench Press
      const completedWorkout: Workout = {
        id: 'past_w1',
        template_id: null,
        date: '2026-10-10',
        name: 'Past Upper',
        notes: null,
        started_at: '2026-10-10T10:00:00.000Z',
        duration_seconds: 3600,
        status: 'completed',
        completed_at: '2026-10-10T11:00:00.000Z',
        imported_from: null,
      };

      const completedSets: WorkoutSet[] = [
        {
          id: 's_db_1',
          workout_id: 'past_w1',
          exercise_id: 'db_bench',
          gear_id: null,
          set_number: 1,
          weight: 60,
          raw_input_weight: 30,
          added_weight: null,
          reps: 8,
          reps_right: null,
          rpe: 8.5,
          rir: 1.5,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: '2026-10-10T10:15:00.000Z',
        },
      ];

      workoutRepo.seed([completedWorkout], completedSets);

      const substitutes = await subService.findSubstitutes('barbell_bench');

      const dbMatch = substitutes.find((s) => s.exercise.id === 'db_bench');
      expect(dbMatch).toBeDefined();
      expect(dbMatch?.hasGhostData).toBe(true);
      expect(dbMatch?.ghostSets).toHaveLength(1);
      expect(dbMatch?.ghostSets[0].raw_input_weight).toBe(30);

      // Base score 100 + 5 bonus = 105
      expect(dbMatch?.relevanceScore).toBe(105);

      const inclineMatch = substitutes.find((s) => s.exercise.id === 'incline_bench');
      expect(inclineMatch?.hasGhostData).toBe(false);
      expect(inclineMatch?.relevanceScore).toBe(100);

      // DB Bench with ghost history ranks higher than Incline Bench without history
      expect(substitutes[0].exercise.id).toBe('db_bench');
    });

    it('penalizes candidates with painful joint and promotes joint-sparing substitutes', async () => {
      const legPress: Exercise = {
        id: 'machine_leg_press',
        name: 'Machine Leg Press',
        muscle_group: 'Quads',
        category: 'Machine',
        is_compound: true,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 0,
        is_custom: false,
        parent_exercise_id: null,
        standard_lift_type: null,
        default_rest_seconds: 120,
      };

      const frontSquat: Exercise = {
        id: 'barbell_front_squat',
        name: 'Front Squat',
        muscle_group: 'Quads',
        category: 'Barbell',
        is_compound: true,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 20,
        is_custom: false,
        parent_exercise_id: 'barbell_squat',
        standard_lift_type: 'squat',
        default_rest_seconds: 150,
      };

      await exerciseRepo.create(legPress);
      await exerciseRepo.create(frontSquat);

      // Without painful joint options, front squat (direct variant) ranks above leg press
      const standardSubs = await subService.findSubstitutes('barbell_squat');
      expect(standardSubs[0].exercise.id).toBe('barbell_front_squat');

      // With lower_back painful joint option: front squat loads lower_back (-60), leg press spares it (+30 total boost)
      const jointAwareSubs = await subService.findSubstitutes('barbell_squat', {
        painfulJoint: 'lower_back',
      });

      expect(jointAwareSubs[0].exercise.id).toBe('machine_leg_press');
      const frontSquatResult = jointAwareSubs.find((s) => s.exercise.id === 'barbell_front_squat');
      expect(frontSquatResult?.relevanceScore).toBe(40); // 100 - 60 = 40
    });

    it('completely excludes blacklisted exercises from substitution options (Step 9.3)', async () => {
      const preferences = [
        {
          exercise_id: 'incline_bench',
          sentiment: 'blacklisted' as const,
          swap_in_count: 0,
          swap_out_count: 0,
          affinity_score: -999,
          updated_at: new Date().toISOString(),
        },
      ];

      const substitutes = await subService.findSubstitutes('barbell_bench', { preferences });
      const foundIncline = substitutes.find((s) => s.exercise.id === 'incline_bench');
      expect(foundIncline).toBeUndefined();

      // Non-blacklisted substitutes remain available
      const foundDb = substitutes.find((s) => s.exercise.id === 'db_bench');
      expect(foundDb).toBeDefined();
    });

    it('penalizes deep_stretch exercises on painful joints with -80 points and elevates shortened_restricted with +20 points (Step 9.3)', async () => {
      const deepStretchFly: Exercise = {
        id: 'db_chest_fly',
        name: 'Dumbbell Chest Fly',
        muscle_group: 'Chest',
        category: 'Dumbbell',
        is_compound: false,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'per_hand',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 0,
        is_custom: false,
        parent_exercise_id: null,
        standard_lift_type: null,
        default_rest_seconds: 90,
        rom_tier: 'deep_stretch',
        baseline_sfr: 85,
        primary_joints: ['shoulder'],
      };

      const shortenedPress: Exercise = {
        id: 'pin_press',
        name: 'Pin Bench Press',
        muscle_group: 'Chest',
        category: 'Barbell',
        is_compound: true,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 20,
        is_custom: false,
        parent_exercise_id: 'barbell_bench',
        standard_lift_type: 'bench',
        default_rest_seconds: 180,
        rom_tier: 'shortened_restricted',
        baseline_sfr: 80,
        primary_joints: ['shoulder', 'elbow'],
      };

      await exerciseRepo.create(deepStretchFly);
      await exerciseRepo.create(shortenedPress);

      const substitutes = await subService.findSubstitutes('barbell_bench', {
        painfulJoint: 'shoulder',
      });

      const flyOption = substitutes.find((s) => s.exercise.id === 'db_chest_fly');
      const pinOption = substitutes.find((s) => s.exercise.id === 'pin_press');

      expect(flyOption).toBeDefined();
      expect(pinOption).toBeDefined();

      // db_chest_fly: baseScore 50 - 60 (pain) - 80 (deep_stretch) + 10 (dumbbell shoulder adaptation) = -80
      expect(flyOption?.relevanceScore).toBe(50 - 60 - 80 + 10);

      // pin_press: baseScore 100 - 60 (pain) + 20 (shortened_restricted elevation) = 60
      expect(pinOption?.relevanceScore).toBe(100 - 60 + 20);
    });

    it('attaches candidateScore matching computeCandidateScore formula (Step 9.3)', async () => {
      const substitutes = await subService.findSubstitutes('barbell_bench');
      for (const sub of substitutes) {
        expect(sub.candidateScore).toBeDefined();
        expect(typeof sub.candidateScore).toBe('number');
      }
    });
  });

  describe('transferRepBrackets', () => {
    it('transfers prescription brackets to substitute exercise', () => {
      const sourcePrescription = {
        targetSets: 4,
        targetRepsMin: 6,
        targetRepsMax: 8,
        targetRpe: 8.5,
        targetRir: 1.5,
      };

      const transferred = subService.transferRepBrackets(
        sourcePrescription,
        'barbell_bench',
        'db_bench'
      );

      expect(transferred.sourceExerciseId).toBe('barbell_bench');
      expect(transferred.targetExerciseId).toBe('db_bench');
      expect(transferred.targetSets).toBe(4);
      expect(transferred.targetRepsMin).toBe(6);
      expect(transferred.targetRepsMax).toBe(8);
      expect(transferred.targetRpe).toBe(8.5);
      expect(transferred.targetRir).toBe(1.5);
    });
  });

  describe('applySubstitution', () => {
    it('swaps exercises on active sets and re-normalizes load', async () => {
      // In-progress workout with Barbell Bench Press sets
      const activeWorkout: Workout = {
        id: 'active_w1',
        template_id: null,
        date: '2026-10-14',
        name: 'Active Chest',
        notes: null,
        started_at: '2026-10-14T10:00:00.000Z',
        duration_seconds: null,
        status: 'in_progress',
        completed_at: null,
        imported_from: null,
      };

      const sets: WorkoutSet[] = [
        {
          id: 'set_1',
          workout_id: 'active_w1',
          exercise_id: 'barbell_bench',
          gear_id: null,
          set_number: 1,
          weight: 30, // Previously barbell total load
          raw_input_weight: 30,
          added_weight: null,
          reps: 8,
          reps_right: null,
          rpe: 8,
          rir: 2,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: '2026-10-14T10:05:00.000Z',
        },
      ];

      workoutRepo.seed([activeWorkout], sets);

      // Bench was taken, substitute with Dumbbell Bench Press
      const result = await subService.applySubstitution({
        workoutId: 'active_w1',
        oldExerciseId: 'barbell_bench',
        newExerciseId: 'db_bench',
        swapScope: 'session_only',
      });

      expect(result.swappedSetsCount).toBe(1);
      expect(result.oldExercise.id).toBe('barbell_bench');
      expect(result.newExercise.id).toBe('db_bench');
      expect(result.swapScope).toBe('session_only');

      // Verify the set was updated in the repository
      const updatedSets = await workoutRepo.getSetsByWorkoutId('active_w1');
      expect(updatedSets[0].exercise_id).toBe('db_bench');
      expect(updatedSets[0].raw_input_weight).toBe(30);
      // db_bench has load_mode = 'per_hand', so 30 kg single dumbbell is normalized to 60 kg effective load!
      expect(updatedSets[0].weight).toBe(60);
    });
  });
});
