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

      // Muscle group volumes
      expect(result.muscleGroupVolumes).toHaveLength(2);
      const chest = result.muscleGroupVolumes.find((m) => m.muscleGroup === 'Chest');
      expect(chest).toBeDefined();
      expect(chest!.workingSets).toBe(2);
      expect(chest!.totalTonnageKg).toBe(1000);

      const quads = result.muscleGroupVolumes.find((m) => m.muscleGroup === 'Quads');
      expect(quads).toBeDefined();
      expect(quads!.workingSets).toBe(1);
      expect(quads!.totalTonnageKg).toBe(700);

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
  });
});
