import { ExerciseInspectionService } from '../exerciseInspectionService';
import { MockWorkoutRepository } from '../../database/mocks/MockWorkoutRepository';
import { MockExerciseRepository } from '../../database/mocks/MockExerciseRepository';
import { Exercise, Workout, WorkoutSet } from '../../core/types';

describe('ExerciseInspectionService', () => {
  let workoutRepo: MockWorkoutRepository;
  let exerciseRepo: MockExerciseRepository;
  let service: ExerciseInspectionService;

  // Root exercise: Barbell Bench Press
  const benchPress: Exercise = {
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
  };

  // Variant exercise: Incline Barbell Bench Press
  const inclineBench: Exercise = {
    id: 'incline_barbell_bench',
    name: 'Incline Barbell Bench',
    muscle_group: 'Chest',
    category: 'Barbell',
    is_compound: true,
    is_bodyweight: false,
    is_unilateral: false,
    load_mode: 'total',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 20.0,
    is_custom: false,
    parent_exercise_id: 'barbell_bench_press',
    standard_lift_type: 'bench',
    default_rest_seconds: 180,
  };

  // Non-standard exercise: Bicep Curl
  const bicepCurl: Exercise = {
    id: 'dumbbell_bicep_curl',
    name: 'Dumbbell Bicep Curl',
    muscle_group: 'Biceps',
    category: 'Dumbbell',
    is_compound: false,
    is_bodyweight: false,
    is_unilateral: true,
    load_mode: 'per_hand',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 0.0,
    is_custom: false,
    parent_exercise_id: null,
    standard_lift_type: null,
    default_rest_seconds: 90,
  };

  // Workout sessions across distinct dates/program blocks
  const workoutBlock1: Workout = {
    id: 'workout_block1',
    template_id: 'push_a',
    date: '2026-08-15',
    name: 'Hypertrophy Meso Push',
    notes: 'Volume phase',
    started_at: '2026-08-15T10:00:00Z',
    duration_seconds: 3600,
    status: 'completed',
    completed_at: '2026-08-15T11:00:00Z',
    imported_from: null,
  };

  const workoutBlock2: Workout = {
    id: 'workout_block2',
    template_id: 'strength_peaking',
    date: '2026-10-01',
    name: 'Peaking Block Push',
    notes: 'Heavy intensity phase',
    started_at: '2026-10-01T10:00:00Z',
    duration_seconds: 3800,
    status: 'completed',
    completed_at: '2026-10-01T11:03:20Z',
    imported_from: null,
  };

  // Logged sets
  const sets: WorkoutSet[] = [
    // Workout 1 (2026-08-15): Bench Press 100kg x 8 @ RPE 8 (RIR 2), 105kg x 5 @ RPE 9 (RIR 1)
    {
      id: 'set_1_1',
      workout_id: 'workout_block1',
      exercise_id: 'barbell_bench_press',
      gear_id: null,
      set_number: 1,
      weight: 100.0,
      raw_input_weight: 100.0,
      added_weight: null,
      reps: 8,
      reps_right: null,
      rpe: 8.0,
      rir: 2.0,
      set_type: 'working',
      set_notes: null,
      exercise_group_id: null,
      created_at: '2026-08-15T10:15:00Z',
    },
    {
      id: 'set_1_2',
      workout_id: 'workout_block1',
      exercise_id: 'barbell_bench_press',
      gear_id: null,
      set_number: 2,
      weight: 105.0,
      raw_input_weight: 105.0,
      added_weight: null,
      reps: 5,
      reps_right: null,
      rpe: 9.0,
      rir: 1.0,
      set_type: 'working',
      set_notes: null,
      exercise_group_id: null,
      created_at: '2026-08-15T10:20:00Z',
    },
    // Workout 2 (2026-10-01): Bench Press 115kg x 3 @ RPE 9.5 (RIR 0.5), 125kg x 1 @ RPE 10 (RIR 0), 107.5kg x 5 @ RPE 8.5
    {
      id: 'set_2_1',
      workout_id: 'workout_block2',
      exercise_id: 'barbell_bench_press',
      gear_id: null,
      set_number: 1,
      weight: 115.0,
      raw_input_weight: 115.0,
      added_weight: null,
      reps: 3,
      reps_right: null,
      rpe: 9.5,
      rir: 0.5,
      set_type: 'working',
      set_notes: 'Heavy triple PR',
      exercise_group_id: null,
      created_at: '2026-10-01T10:10:00Z',
    },
    {
      id: 'set_2_2',
      workout_id: 'workout_block2',
      exercise_id: 'barbell_bench_press',
      gear_id: null,
      set_number: 2,
      weight: 125.0,
      raw_input_weight: 125.0,
      added_weight: null,
      reps: 1,
      reps_right: null,
      rpe: 10.0,
      rir: 0.0,
      set_type: 'working',
      set_notes: 'True 1RM test',
      exercise_group_id: null,
      created_at: '2026-10-01T10:16:00Z',
    },
    {
      id: 'set_2_3',
      workout_id: 'workout_block2',
      exercise_id: 'barbell_bench_press',
      gear_id: null,
      set_number: 3,
      weight: 107.5,
      raw_input_weight: 107.5,
      added_weight: null,
      reps: 5,
      reps_right: null,
      rpe: 8.5,
      rir: 1.5,
      set_type: 'working',
      set_notes: null,
      exercise_group_id: null,
      created_at: '2026-10-01T10:22:00Z',
    },
    // Variant: Incline Bench in Workout 2: 95kg x 6 @ RPE 9
    {
      id: 'set_2_incline',
      workout_id: 'workout_block2',
      exercise_id: 'incline_barbell_bench',
      gear_id: null,
      set_number: 1,
      weight: 95.0,
      raw_input_weight: 95.0,
      added_weight: null,
      reps: 6,
      reps_right: null,
      rpe: 9.0,
      rir: 1.0,
      set_type: 'working',
      set_notes: null,
      exercise_group_id: null,
      created_at: '2026-10-01T10:35:00Z',
    },
  ];

  beforeEach(() => {
    workoutRepo = new MockWorkoutRepository([workoutBlock1, workoutBlock2], sets);
    exerciseRepo = new MockExerciseRepository([benchPress, inclineBench, bicepCurl]);
    service = new ExerciseInspectionService(workoutRepo, exerciseRepo);
  });

  describe('PR Board (Rep-Max Records Extraction)', () => {
    it('extracts all-time heaviest load per unique repetition count', async () => {
      const prBoard = await service.getPRBoard({
        exerciseId: 'barbell_bench_press',
        scope: 'all_time',
      });

      expect(prBoard.exerciseId).toBe('barbell_bench_press');
      expect(prBoard.totalPRCount).toBe(4); // 1RM, 3RM, 5RM, 8RM

      // Records must be sorted ascending by rep count
      const reps = prBoard.records.map((r) => r.reps);
      expect(reps).toEqual([1, 3, 5, 8]);

      // 1RM: 125kg @ 2026-10-01
      const pr1 = prBoard.records[0];
      expect(pr1.reps).toBe(1);
      expect(pr1.weightKg).toBe(125.0);
      expect(pr1.setDate).toBe('2026-10-01');
      expect(pr1.workoutId).toBe('workout_block2');
      expect(pr1.setId).toBe('set_2_2');

      // 3RM: 115kg @ 2026-10-01
      const pr3 = prBoard.records[1];
      expect(pr3.reps).toBe(3);
      expect(pr3.weightKg).toBe(115.0);

      // 5RM: 107.5kg (from workout 2, beating 105kg from workout 1)
      const pr5 = prBoard.records[2];
      expect(pr5.reps).toBe(5);
      expect(pr5.weightKg).toBe(107.5);
      expect(pr5.setDate).toBe('2026-10-01');

      // 8RM: 100kg (from workout 1)
      const pr8 = prBoard.records[3];
      expect(pr8.reps).toBe(8);
      expect(pr8.weightKg).toBe(100.0);
      expect(pr8.setDate).toBe('2026-08-15');
    });

    it('accurately computes set e1RM benchmark and identifies peak record', async () => {
      const prBoard = await service.getPRBoard({
        exerciseId: 'barbell_bench_press',
      });

      // Every record has e1RM >= weightKg
      for (const rec of prBoard.records) {
        expect(rec.e1rmKg).toBeGreaterThanOrEqual(rec.weightKg);
        expect(rec.effectiveReps).toBeGreaterThanOrEqual(rec.reps);
      }

      // Check peak record identification
      expect(prBoard.peakRecord).toBeDefined();
      expect(prBoard.peakRecord?.e1rmKg).toBeGreaterThan(0);

      // Verify allTimeBest1RM
      expect(prBoard.allTimeBest1RM).toBeDefined();
      expect(prBoard.allTimeBest1RM?.reps).toBe(1);
      expect(prBoard.allTimeBest1RM?.weightKg).toBe(125.0);
    });

    it('scopes records to a specific program block date range', async () => {
      // Querying only block 1 (August 2026)
      const prBoard = await service.getPRBoard({
        exerciseId: 'barbell_bench_press',
        scope: 'program_block',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      });

      // Workout 1 only had 5 reps (105kg) and 8 reps (100kg)
      expect(prBoard.records.map((r) => r.reps)).toEqual([5, 8]);
      expect(prBoard.records[0].weightKg).toBe(105.0);
      expect(prBoard.records[1].weightKg).toBe(100.0);
      expect(prBoard.allTimeBest1RM).toBeNull();
    });

    it('aggregates cross-variant records across parent and child movements', async () => {
      // With includeVariants = false: only barbell_bench_press (reps 1, 3, 5, 8)
      const flatOnly = await service.getPRBoard({
        exerciseId: 'barbell_bench_press',
        includeVariants: false,
      });
      expect(flatOnly.records.some((r) => r.reps === 6)).toBe(false);

      // With includeVariants = true: combines bench_press + incline_barbell_bench (reps 1, 3, 5, 6, 8)
      const withVariants = await service.getPRBoard({
        exerciseId: 'barbell_bench_press',
        includeVariants: true,
      });
      expect(withVariants.records.some((r) => r.reps === 6)).toBe(true);
      const pr6 = withVariants.records.find((r) => r.reps === 6);
      expect(pr6?.weightKg).toBe(95.0);
      expect(pr6?.exerciseId).toBe('incline_barbell_bench');
    });
  });

  describe('SBD Standard Classification Resolution', () => {
    it('resolves SBD standard classification for standard barbell movements', async () => {
      const summary = await service.getStrengthStandardSummary({
        exerciseId: 'barbell_bench_press',
        gender: 'male',
        bodyweightKg: 80,
      });

      expect(summary.isStandardLift).toBe(true);
      expect(summary.liftType).toBe('bench');
      expect(summary.standardResult).toBeDefined();

      // Lifter e1RM is ~125kg at 80kg BW -> Intermediate/Advanced boundary
      expect(summary.standardResult?.tier).toBeDefined();
      expect(summary.standardResult?.continuousScore).toBeGreaterThan(40);
      expect(summary.standardResult?.demographicPercentile).toBeGreaterThan(50);
    });

    it('returns isStandardLift = false for non-standard movements', async () => {
      const summary = await service.getStrengthStandardSummary({
        exerciseId: 'dumbbell_bicep_curl',
        gender: 'male',
        bodyweightKg: 80,
      });

      expect(summary.isStandardLift).toBe(false);
      expect(summary.standardResult).toBeUndefined();
    });
  });

  describe('Comprehensive Exercise Inspection Overview', () => {
    it('aggregates metadata, PR board, standards, and historical volume metrics', async () => {
      const overview = await service.getExerciseInspectionOverview({
        exerciseId: 'barbell_bench_press',
        gender: 'male',
        bodyweightKg: 80,
      });

      expect(overview.exercise.id).toBe('barbell_bench_press');
      expect(overview.prBoard.records.length).toBeGreaterThanOrEqual(4);
      expect(overview.standardSummary.isStandardLift).toBe(true);

      // History summary: 5 sets across 2 unique sessions
      // Total volume: 100*8 (800) + 105*5 (525) + 115*3 (345) + 125*1 (125) + 107.5*5 (537.5) = 2332.5 kg
      expect(overview.historySummary.totalSessions).toBe(2);
      expect(overview.historySummary.totalSets).toBe(5);
      expect(overview.historySummary.totalVolumeKg).toBe(2332.5);
      expect(overview.historySummary.firstLoggedDate).toBe('2026-08-15');
      expect(overview.historySummary.lastLoggedDate).toBe('2026-10-01');
    });

    it('throws error when exercise is not found', async () => {
      await expect(
        service.getExerciseInspectionOverview({
          exerciseId: 'non_existent_id',
          gender: 'male',
          bodyweightKg: 80,
        })
      ).rejects.toThrow("Exercise with id 'non_existent_id' not found");
    });
  });
});
