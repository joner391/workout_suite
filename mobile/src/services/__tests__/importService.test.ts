/**
 * Workout Suite — ImportService Unit Tests
 *
 * Verifies Step 2.4:
 * - Exercise matching against catalog & aliases
 * - Custom fallback creation
 * - Duplicate session detection
 * - Import execution & persistence in Mock repositories
 */

import { ImportService } from '../importService';
import { MockWorkoutRepository } from '../../database/mocks/MockWorkoutRepository';
import { MockExerciseRepository } from '../../database/mocks/MockExerciseRepository';
import { DEFAULT_EXERCISES } from '../../database/seeds/defaultExercises';
import { Workout, WorkoutSet } from '../../core/types';

describe('ImportService', () => {
  let workoutRepo: MockWorkoutRepository;
  let exerciseRepo: MockExerciseRepository;
  let service: ImportService;

  beforeEach(() => {
    workoutRepo = new MockWorkoutRepository();
    exerciseRepo = new MockExerciseRepository(DEFAULT_EXERCISES);
    service = new ImportService(workoutRepo, exerciseRepo);
  });

  describe('Exercise Matching', () => {
    it('matches exact exercise names in catalog', async () => {
      const match = await service.matchExercise('Barbell Back Squat');
      expect(match.matchType).toBe('exact');
      expect(match.confidence).toBe(1.0);
      expect(match.matchedExercise?.id).toBe('barbell_back_squat');
    });

    it('matches common Strong/Hevy alias names', async () => {
      const benchMatch = await service.matchExercise('Bench Press (Barbell)');
      expect(benchMatch.matchType).toBe('alias');
      expect(benchMatch.matchedExercise?.id).toBe('barbell_bench_press');

      const squatMatch = await service.matchExercise('Squat (Barbell)');
      expect(squatMatch.matchedExercise?.id).toBe('barbell_back_squat');

      const deadliftMatch = await service.matchExercise('Deadlift (Barbell)');
      expect(deadliftMatch.matchedExercise?.id).toBe('barbell_deadlift');

      const dipMatch = await service.matchExercise('Dips');
      expect(dipMatch.matchedExercise?.id).toBe('bodyweight_dip');

      const militaryMatch = await service.matchExercise('Military Press');
      expect(militaryMatch.matchedExercise?.id).toBe('barbell_overhead_press');
    });

    it('matches structural parenthetical inversions', async () => {
      const match = await service.matchExercise('Incline Bench Press (Barbell)');
      expect(match.matchType).toBe('alias');
      expect(match.matchedExercise?.id).toBe('barbell_incline_bench_press');
    });

    it('synthesizes custom fallback exercise when no match is found', async () => {
      const match = await service.matchExercise('Banded Nordic Hamstring Curl');
      expect(match.matchType).toBe('custom_fallback');
      expect(match.matchedExercise).toBeNull();
      expect(match.proposedExercise.name).toBe('Banded Nordic Hamstring Curl');
      expect(match.proposedExercise.is_custom).toBe(true);
      expect(match.proposedExercise.muscle_group).toBe('Hamstrings');
    });
  });

  describe('Duplicate Detection', () => {
    it('detects duplicate workouts based on date, exercise, and set count', async () => {
      // Pre-seed an existing completed workout in the repository
      const existingWorkout: Workout = {
        id: 'existing_w1',
        template_id: null,
        date: '2026-06-25',
        name: 'Push Day',
        notes: null,
        started_at: '2026-06-25T10:00:00.000Z',
        duration_seconds: 3600,
        status: 'completed',
        completed_at: '2026-06-25T11:00:00.000Z',
        imported_from: null,
      };
      await workoutRepo.create(existingWorkout);

      const existingSets: WorkoutSet[] = [
        {
          id: 's1',
          workout_id: 'existing_w1',
          exercise_id: 'barbell_bench_press',
          gear_id: null,
          set_number: 1,
          weight: 100,
          raw_input_weight: 100,
          added_weight: null,
          reps: 8,
          reps_right: null,
          rpe: 8,
          rir: 2,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: '2026-06-25T10:05:00.000Z',
        },
        {
          id: 's2',
          workout_id: 'existing_w1',
          exercise_id: 'barbell_bench_press',
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
          created_at: '2026-06-25T10:10:00.000Z',
        },
      ];
      await workoutRepo.saveSets(existingSets);

      // Now parse a CSV containing the same workout on the same date
      const strongCsv = `Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE
2026-06-25 10:00:00;Push Day;Barbell Bench Press;1;100;kg;8;8
2026-06-25 10:00:00;Push Day;Barbell Bench Press;2;100;kg;8;8.5`;

      const parsed = service.parseCsv(strongCsv);
      const preview = await service.generatePreview(parsed);

      expect(preview.duplicateWorkoutsCount).toBe(1);
      expect(preview.workouts[0].isDuplicate).toBe(true);
      expect(preview.workouts[0].duplicateReason).toContain('Matches existing workout');
    });

    it('does not flag workout as duplicate if date is different', async () => {
      const strongCsv = `Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE
2026-06-30 10:00:00;Push Day;Barbell Bench Press;1;100;kg;8;8`;

      const parsed = service.parseCsv(strongCsv);
      const preview = await service.generatePreview(parsed);

      expect(preview.duplicateWorkoutsCount).toBe(0);
      expect(preview.workouts[0].isDuplicate).toBe(false);
    });
  });

  describe('Import Execution & Persistence', () => {
    it('executes a complete Strong CSV import into repositories', async () => {
      const strongCsv = `Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE;Notes;Workout Notes;Workout Duration
2026-07-01 18:30:00;Full Body;Bench Press (Barbell);1;100;kg;8;8;RPE 8;Great session;1h 10m
2026-07-01 18:30:00;Full Body;Bench Press (Barbell);2;100;kg;8;8.5;;Great session;1h 10m
2026-07-01 18:30:00;Full Body;Squat (Barbell);1;140;kg;5;8;;Great session;1h 10m
2026-07-01 18:30:00;Full Body;Unknown Special Exercise;1;50;kg;10;7;;Great session;1h 10m`;

      const parsed = service.parseCsv(strongCsv);
      const preview = await service.generatePreview(parsed);

      expect(preview.totalWorkouts).toBe(1);
      expect(preview.totalSets).toBe(4);
      expect(preview.exerciseMatches.some((m) => m.matchType === 'custom_fallback')).toBe(true);

      const result = await service.executeImport(preview, { skipDuplicates: true });

      expect(result.success).toBe(true);
      expect(result.importedWorkoutsCount).toBe(1);
      expect(result.importedSetsCount).toBe(4);
      expect(result.createdExercisesCount).toBe(1);

      // Verify workout in repository
      const createdWorkouts = await workoutRepo.findAll();
      expect(createdWorkouts).toHaveLength(1);
      const importedWorkout = createdWorkouts[0];
      expect(importedWorkout.name).toBe('Full Body');
      expect(importedWorkout.status).toBe('completed');
      expect(importedWorkout.imported_from).toBe('strong');
      expect(importedWorkout.notes).toBe('Great session');

      // Verify sets in repository
      const createdSets = await workoutRepo.getSetsByWorkoutId(importedWorkout.id);
      expect(createdSets).toHaveLength(4);

      // Verify custom exercise was persisted
      const customEx = await exerciseRepo.search('Unknown Special Exercise');
      expect(customEx).toHaveLength(1);
      expect(customEx[0].is_custom).toBe(true);
    });

    it('skips duplicate workouts when skipDuplicates is enabled', async () => {
      // Create initial workout
      const strongCsv = `Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE
2026-07-05 10:00:00;Legs;Barbell Back Squat;1;150;kg;5;8`;

      const parsed1 = service.parseCsv(strongCsv);
      const preview1 = await service.generatePreview(parsed1);
      await service.executeImport(preview1);

      // Attempt to re-import same CSV
      const preview2 = await service.generatePreview(parsed1);
      expect(preview2.duplicateWorkoutsCount).toBe(1);

      const result2 = await service.executeImport(preview2, { skipDuplicates: true });
      expect(result2.importedWorkoutsCount).toBe(0);
      expect(result2.skippedDuplicatesCount).toBe(1);
    });

    it('respects manual exerciseOverrides during import', async () => {
      const genericCsv = `Date,Exercise,Weight,Reps
2026-07-10,DB Bench,30,10`;

      const parsed = service.parseCsv(genericCsv);
      const preview = await service.generatePreview(parsed);

      const overrides = {
        'DB Bench': 'dumbbell_bench_press',
      };

      const result = await service.executeImport(preview, { exerciseOverrides: overrides });
      expect(result.success).toBe(true);
      expect(result.createdExercisesCount).toBe(0); // Override avoided custom creation

      const createdWorkouts = await workoutRepo.findAll();
      const sets = await workoutRepo.getSetsByWorkoutId(createdWorkouts[0].id);
      expect(sets[0].exercise_id).toBe('dumbbell_bench_press');
    });
  });
});
