/**
 * Workout Suite — Workload Analysis Service Tests
 */

import { MockWorkoutRepository, MockExerciseRepository } from '../../database/mocks';
import {
  computeWeeklyWorkloadDeepDive,
  getWeekBoundaries,
  classifyVolumeTier,
} from '../workloadAnalysisService';
import { Exercise, Workout, WorkoutSet } from '../../core/types';

describe('Workload Analysis Service Suite', () => {
  let workoutRepo: MockWorkoutRepository;
  let exerciseRepo: MockExerciseRepository;

  beforeEach(() => {
    workoutRepo = new MockWorkoutRepository();
    exerciseRepo = new MockExerciseRepository();
  });

  describe('1. Week Boundaries & Calendar Partitioning', () => {
    test('computes correct Monday to Sunday ISO dates for current and offset weeks', () => {
      // Wednesday 2026-10-14
      const refDate = new Date('2026-10-14T12:00:00Z');
      const currentWeek = getWeekBoundaries(refDate, 0);

      expect(currentWeek.mondayIso).toBe('2026-10-12');
      expect(currentWeek.sundayIso).toBe('2026-10-18');

      const prevWeek = getWeekBoundaries(refDate, -1);
      expect(prevWeek.mondayIso).toBe('2026-10-05');
      expect(prevWeek.sundayIso).toBe('2026-10-11');
    });

    test('classifies hypertrophy volume landmarks into discrete tiers', () => {
      expect(classifyVolumeTier(5).tier).toBe('low');
      expect(classifyVolumeTier(8).tier).toBe('optimal');
      expect(classifyVolumeTier(14).tier).toBe('optimal');
      expect(classifyVolumeTier(20).tier).toBe('high');
      expect(classifyVolumeTier(26).tier).toBe('peak');
    });
  });

  describe('2. Comprehensive Weekly Workload Computation', () => {
    test('aggregates daily tonnage, muscle group set volume, and dual intensity correctly', async () => {
      // Seed Exercises
      const benchPress: Exercise = {
        id: 'ex_bench',
        name: 'Barbell Bench Press',
        muscle_group: 'Chest',
        category: 'Barbell',
        is_compound: true,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 20,
        is_custom: false,
        parent_exercise_id: null,
        standard_lift_type: 'bench',
        default_rest_seconds: 180,
      };

      const squat: Exercise = {
        id: 'ex_squat',
        name: 'Barbell Back Squat',
        muscle_group: 'Quads',
        category: 'Barbell',
        is_compound: true,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 20,
        is_custom: false,
        parent_exercise_id: null,
        standard_lift_type: 'squat',
        default_rest_seconds: 180,
      };

      await exerciseRepo.create(benchPress);
      await exerciseRepo.create(squat);

      // Seed Workouts in the week of 2026-10-12 to 2026-10-18
      const mondayWorkout: Workout = {
        id: 'w_mon',
        template_id: null,
        date: '2026-10-12',
        name: 'Heavy Push',
        notes: null,
        started_at: '2026-10-12T10:00:00Z',
        duration_seconds: 3600,
        status: 'completed',
        completed_at: '2026-10-12T11:00:00Z',
        imported_from: null,
      };

      const wednesdayWorkout: Workout = {
        id: 'w_wed',
        template_id: null,
        date: '2026-10-14',
        name: 'Heavy Legs',
        notes: null,
        started_at: '2026-10-14T10:00:00Z',
        duration_seconds: 3600,
        status: 'completed',
        completed_at: '2026-10-14T11:00:00Z',
        imported_from: null,
      };

      const monSets: WorkoutSet[] = [
        // Warmup (should be ignored in set count and tonnage)
        {
          id: 's_warmup',
          workout_id: 'w_mon',
          exercise_id: 'ex_bench',
          gear_id: null,
          set_number: 1,
          weight: 40,
          raw_input_weight: 40,
          added_weight: null,
          reps: 10,
          reps_right: null,
          rpe: 5.0,
          rir: 5.0,
          set_type: 'warmup',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        // Working set 1: 100kg x 5 @ RPE 8 (Tonnage = 500)
        {
          id: 's1',
          workout_id: 'w_mon',
          exercise_id: 'ex_bench',
          gear_id: null,
          set_number: 2,
          weight: 100,
          raw_input_weight: 100,
          added_weight: null,
          reps: 5,
          reps_right: null,
          rpe: 8.0,
          rir: 2.0,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        // Working set 2: 100kg x 5 @ RPE 9 (Tonnage = 500)
        {
          id: 's2',
          workout_id: 'w_mon',
          exercise_id: 'ex_bench',
          gear_id: null,
          set_number: 3,
          weight: 100,
          raw_input_weight: 100,
          added_weight: null,
          reps: 5,
          reps_right: null,
          rpe: 9.0,
          rir: 1.0,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
      ];

      const wedSets: WorkoutSet[] = [
        // Working set 3: 140kg x 5 @ RPE 8.5 (Tonnage = 700)
        {
          id: 's3',
          workout_id: 'w_wed',
          exercise_id: 'ex_squat',
          gear_id: null,
          set_number: 1,
          weight: 140,
          raw_input_weight: 140,
          added_weight: null,
          reps: 5,
          reps_right: null,
          rpe: 8.5,
          rir: 1.5,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
      ];

      workoutRepo.seed([mondayWorkout, wednesdayWorkout], [...monSets, ...wedSets]);

      const result = await computeWeeklyWorkloadDeepDive(workoutRepo, exerciseRepo, {
        refDate: new Date('2026-10-14T12:00:00Z'),
        weekOffset: 0,
      });

      // Overall week totals
      expect(result.weekStartDate).toBe('2026-10-12');
      expect(result.weekEndDate).toBe('2026-10-18');
      expect(result.completedWorkoutsCount).toBe(2);
      expect(result.totalWorkingSets).toBe(3); // 2 bench + 1 squat (warmup excluded)
      expect(result.totalTonnageKg).toBe(1700); // 500 + 500 + 700

      // Daily workloads verification (7 days)
      expect(result.dailyWorkloads).toHaveLength(7);
      const monday = result.dailyWorkloads.find((d) => d.date === '2026-10-12');
      expect(monday).toBeDefined();
      expect(monday!.hasWorkout).toBe(true);
      expect(monday!.workoutName).toBe('Heavy Push');
      expect(monday!.tonnageKg).toBe(1000);
      expect(monday!.workingSets).toBe(2);
      expect(monday!.avgRpe).toBe(8.5); // (8 + 9) / 2

      const tuesday = result.dailyWorkloads.find((d) => d.date === '2026-10-13');
      expect(tuesday).toBeDefined();
      expect(tuesday!.hasWorkout).toBe(false);
      expect(tuesday!.tonnageKg).toBe(0);

      // Muscle group volumes (includes primary and assisting synergists at 0.5 set credit)
      expect(result.muscleGroupVolumes).toHaveLength(5);
      const chest = result.muscleGroupVolumes.find((m) => m.muscleGroup === 'Chest');
      expect(chest).toBeDefined();
      expect(chest!.workingSets).toBe(2);
      expect(chest!.totalTonnageKg).toBe(1000);

      const quads = result.muscleGroupVolumes.find((m) => m.muscleGroup === 'Quads');
      expect(quads).toBeDefined();
      expect(quads!.workingSets).toBe(1);
      expect(quads!.totalTonnageKg).toBe(700);

      // Assisting muscles from 2 sets of bench (0.5 set each -> 1.0 set total)
      const triceps = result.muscleGroupVolumes.find((m) => m.muscleGroup === 'Triceps');
      expect(triceps).toBeDefined();
      expect(triceps!.workingSets).toBe(1);
      expect(triceps!.totalTonnageKg).toBe(500);

      const shoulders = result.muscleGroupVolumes.find((m) => m.muscleGroup === 'Shoulders');
      expect(shoulders).toBeDefined();
      expect(shoulders!.workingSets).toBe(1);
      expect(shoulders!.totalTonnageKg).toBe(500);

      // Assisting muscle from 1 set of squat (0.5 set)
      const glutes = result.muscleGroupVolumes.find((m) => m.muscleGroup === 'Glutes');
      expect(glutes).toBeDefined();
      expect(glutes!.workingSets).toBe(0.5);
      expect(glutes!.totalTonnageKg).toBe(350);

      // Dual intensity metrics
      // Effort: 3 sets (RPE 8, 9, 8.5) -> Avg RPE = (8 + 9 + 8.5) / 3 = 8.5
      expect(result.intensity.avgRpe).toBe(8.5);
      expect(result.intensity.highIntensitySetCount).toBe(3); // All 3 sets >= 8.0
      expect(result.intensity.highIntensityRatioPercent).toBe(100);

      // Relative Intensity (% of 1RM):
      // Sets were at or near session top loads, so avg % 1RM should be evaluated
      expect(result.intensity.avgRelativeIntensityPercent).toBeGreaterThan(70);
      expect(result.intensity.loadZoneBuckets).toBeDefined();
    });

    test('credits 0.5 sets for assisting muscles: 2 sets bench + 2 sets direct triceps = 3 sets triceps', async () => {
      const benchPress: Exercise = {
        id: 'bench_press_custom',
        name: 'Bench Press',
        muscle_group: 'Chest',
        category: 'Barbell',
        is_compound: true,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 20,
        is_custom: false,
        parent_exercise_id: null,
        standard_lift_type: 'bench',
        default_rest_seconds: 180,
        secondary_muscles: ['Triceps', 'Shoulders'],
      };

      const tricepPushdown: Exercise = {
        id: 'tricep_pushdown_custom',
        name: 'Triceps Pushdown',
        muscle_group: 'Triceps',
        category: 'Cable',
        is_compound: false,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 0,
        is_custom: false,
        parent_exercise_id: null,
        standard_lift_type: null,
        default_rest_seconds: 90,
      };

      await exerciseRepo.create(benchPress);
      await exerciseRepo.create(tricepPushdown);

      const workout: Workout = {
        id: 'w_push_volume',
        template_id: null,
        date: '2026-10-14',
        name: 'Push Hypertrophy',
        notes: null,
        started_at: '2026-10-14T10:00:00Z',
        duration_seconds: 3600,
        status: 'completed',
        completed_at: '2026-10-14T11:00:00Z',
        imported_from: null,
      };

      const sets: WorkoutSet[] = [
        // 2 sets of bench press (Chest + assisting Triceps, Shoulders)
        {
          id: 's_b1',
          workout_id: 'w_push_volume',
          exercise_id: 'bench_press_custom',
          gear_id: null,
          set_number: 1,
          weight: 100,
          raw_input_weight: 100,
          added_weight: null,
          reps: 8,
          reps_right: null,
          rpe: 8.0,
          rir: 2.0,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        {
          id: 's_b2',
          workout_id: 'w_push_volume',
          exercise_id: 'bench_press_custom',
          gear_id: null,
          set_number: 2,
          weight: 100,
          raw_input_weight: 100,
          added_weight: null,
          reps: 8,
          reps_right: null,
          rpe: 8.5,
          rir: 1.5,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        // 2 sets of direct triceps work
        {
          id: 's_t1',
          workout_id: 'w_push_volume',
          exercise_id: 'tricep_pushdown_custom',
          gear_id: null,
          set_number: 3,
          weight: 35,
          raw_input_weight: 35,
          added_weight: null,
          reps: 12,
          reps_right: null,
          rpe: 8.5,
          rir: 1.5,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        {
          id: 's_t2',
          workout_id: 'w_push_volume',
          exercise_id: 'tricep_pushdown_custom',
          gear_id: null,
          set_number: 4,
          weight: 35,
          raw_input_weight: 35,
          added_weight: null,
          reps: 10,
          reps_right: null,
          rpe: 9.0,
          rir: 1.0,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
      ];

      workoutRepo.seed([workout], sets);

      const result = await computeWeeklyWorkloadDeepDive(workoutRepo, exerciseRepo, {
        refDate: new Date('2026-10-14T12:00:00Z'),
        weekOffset: 0,
      });

      const tricepsReport = result.muscleGroupVolumes.find((m) => m.muscleGroup === 'Triceps');
      expect(tricepsReport).toBeDefined();
      // 2 direct sets + 2 * 0.5 assisting sets = 3.0 sets!
      expect(tricepsReport!.workingSets).toBe(3);

      const chestReport = result.muscleGroupVolumes.find((m) => m.muscleGroup === 'Chest');
      expect(chestReport).toBeDefined();
      expect(chestReport!.workingSets).toBe(2);

      const shouldersReport = result.muscleGroupVolumes.find((m) => m.muscleGroup === 'Shoulders');
      expect(shouldersReport).toBeDefined();
      expect(shouldersReport!.workingSets).toBe(1); // 2 * 0.5 from bench
    });

    test('accurately tracks unrated sets in the Unrated (No RPE) histogram bucket and coverage stats', async () => {
      const exercise: Exercise = {
        id: 'ex_curl',
        name: 'Bicep Curl',
        muscle_group: 'Biceps',
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
      };

      await exerciseRepo.create(exercise);

      const workout: Workout = {
        id: 'w_arm_day',
        template_id: null,
        date: '2026-10-15',
        name: 'Arm Day',
        notes: null,
        started_at: '2026-10-15T14:00:00Z',
        duration_seconds: 1800,
        status: 'completed',
        completed_at: '2026-10-15T14:30:00Z',
        imported_from: null,
      };

      const sets: WorkoutSet[] = [
        // Set 1: Rated RPE 8.5
        {
          id: 's_rated_1',
          workout_id: 'w_arm_day',
          exercise_id: 'ex_curl',
          gear_id: null,
          set_number: 1,
          weight: 15,
          raw_input_weight: 15,
          added_weight: null,
          reps: 10,
          reps_right: null,
          rpe: 8.5,
          rir: null,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        // Set 2: Unrated (no RPE/RIR)
        {
          id: 's_unrated_1',
          workout_id: 'w_arm_day',
          exercise_id: 'ex_curl',
          gear_id: null,
          set_number: 2,
          weight: 15,
          raw_input_weight: 15,
          added_weight: null,
          reps: 10,
          reps_right: null,
          rpe: null,
          rir: null,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        // Set 3: Unrated (no RPE/RIR)
        {
          id: 's_unrated_2',
          workout_id: 'w_arm_day',
          exercise_id: 'ex_curl',
          gear_id: null,
          set_number: 3,
          weight: 15,
          raw_input_weight: 15,
          added_weight: null,
          reps: 8,
          reps_right: null,
          rpe: null,
          rir: null,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
      ];

      workoutRepo.seed([workout], sets);

      const result = await computeWeeklyWorkloadDeepDive(workoutRepo, exerciseRepo, {
        refDate: new Date('2026-10-15T12:00:00Z'),
        weekOffset: 0,
      });

      expect(result.totalWorkingSets).toBe(3);
      expect(result.intensity.totalRatedSets).toBe(1);
      expect(result.intensity.totalUnratedSets).toBe(2);
      expect(result.intensity.avgRpe).toBe(8.5); // Derived exclusively from the 1 rated set

      const unratedBucket = result.intensity.rpeBuckets.find((b) => b.label.includes('Unrated'));
      expect(unratedBucket).toBeDefined();
      expect(unratedBucket!.count).toBe(2);
      // 2 unrated out of 3 total working sets = ~67%
      expect(unratedBucket!.percentage).toBe(67);

      const stimulatingBucket = result.intensity.rpeBuckets.find((b) => b.label.includes('8.0–8.5'));
      expect(stimulatingBucket).toBeDefined();
      expect(stimulatingBucket!.count).toBe(1);
      expect(stimulatingBucket!.percentage).toBe(33);
    });

    test('3. Effective Reps & AMRAP Set Type Accounting', async () => {
      const exercise: Exercise = {
        id: 'ex_test',
        name: 'Incline Dumbbell Press',
        muscle_group: 'Chest',
        category: 'Dumbbell',
        is_compound: true,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'per_hand',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 0,
        is_custom: false,
        parent_exercise_id: null,
        standard_lift_type: null,
        default_rest_seconds: 90,
      };
      await exerciseRepo.create(exercise);

      const workout: Workout = {
        id: 'w_test_ereps',
        template_id: null,
        date: '2026-10-14',
        name: 'Hypertrophy Session',
        notes: null,
        started_at: '2026-10-14T10:00:00Z',
        duration_seconds: 2400,
        status: 'completed',
        completed_at: '2026-10-14T10:40:00Z',
        imported_from: null,
      };

      const sets: WorkoutSet[] = [
        // Set 1: Regular working set, 10 reps @ 2 RIR -> 3 eReps (rated)
        {
          id: 's_rated_1',
          workout_id: 'w_test_ereps',
          exercise_id: 'ex_test',
          gear_id: null,
          set_number: 1,
          weight: 60,
          raw_input_weight: 30,
          added_weight: null,
          reps: 10,
          reps_right: null,
          rpe: 8.0,
          rir: 2.0,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        // Set 2: Unrated working set (missing RPE & RIR) -> 0 eReps (unrated)
        {
          id: 's_unrated_2',
          workout_id: 'w_test_ereps',
          exercise_id: 'ex_test',
          gear_id: null,
          set_number: 2,
          weight: 60,
          raw_input_weight: 30,
          added_weight: null,
          reps: 10,
          reps_right: null,
          rpe: null,
          rir: null,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        // Set 3: AMRAP set (no explicit RPE/RIR typed) -> 12 reps -> defaults to RPE 10 -> 5 eReps (rated)
        {
          id: 's_amrap_3',
          workout_id: 'w_test_ereps',
          exercise_id: 'ex_test',
          gear_id: null,
          set_number: 3,
          weight: 50,
          raw_input_weight: 25,
          added_weight: null,
          reps: 12,
          reps_right: null,
          rpe: null,
          rir: null,
          set_type: 'amrap',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
      ];

      workoutRepo.seed([workout], sets);

      const result = await computeWeeklyWorkloadDeepDive(workoutRepo, exerciseRepo, {
        refDate: new Date('2026-10-15T12:00:00Z'),
        weekOffset: 0,
      });

      expect(result.totalWorkingSets).toBe(3);
      // 2 rated (Set 1 + Set 3 AMRAP), 1 unrated (Set 2)
      expect(result.totalRatedSets).toBe(2);
      expect(result.totalUnratedSets).toBe(1);
      // Coverage = 2/3 = 67%
      expect(result.ratingCoveragePercent).toBe(67);
      // Total eReps = 3 (Set 1) + 0 (Set 2 unrated) + 5 (Set 3 AMRAP) = 8
      expect(result.totalEffectiveReps).toBe(8);

      const chest = result.muscleGroupVolumes.find((m) => m.muscleGroup === 'Chest');
      expect(chest).toBeDefined();
      expect(chest!.effectiveReps).toBe(8);
      expect(chest!.ratedSets).toBe(2);
      expect(chest!.totalSets).toBe(3);
    });
  });
});
