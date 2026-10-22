import { CrashRecoveryService } from '../crashRecoveryService';
import { MockWorkoutRepository } from '../../database/mocks/MockWorkoutRepository';
import { MockUserSettingsRepository } from '../../database/mocks/MockUserSettingsRepository';
import { Workout, WorkoutSet } from '../../core/types';

describe('CrashRecoveryService', () => {
  let workoutRepo: MockWorkoutRepository;
  let recoveryService: CrashRecoveryService;

  beforeEach(() => {
    workoutRepo = new MockWorkoutRepository();
    recoveryService = new CrashRecoveryService(workoutRepo);
  });

  describe('checkForInterruptedWorkout', () => {
    it('returns null when no workout is in progress', async () => {
      // Completed workout in database
      const completedWorkout: Workout = {
        id: 'w_completed',
        template_id: null,
        date: '2026-10-13',
        name: 'Yesterday Leg Day',
        notes: null,
        started_at: '2026-10-13T10:00:00.000Z',
        duration_seconds: 3600,
        status: 'completed',
        completed_at: '2026-10-13T11:00:00.000Z',
        imported_from: null,
      };
      workoutRepo.seed([completedWorkout]);

      const result = await recoveryService.checkForInterruptedWorkout();
      expect(result).toBeNull();
    });

    it('detects interrupted in-progress workout and computes summary metrics', async () => {
      // Session started 45 minutes ago
      const fortyFiveMinsAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      const inProgressWorkout: Workout = {
        id: 'w_active_1',
        template_id: null,
        date: '2026-10-14',
        name: 'Morning Push',
        notes: null,
        started_at: fortyFiveMinsAgo,
        duration_seconds: null,
        status: 'in_progress',
        completed_at: null,
        imported_from: null,
      };

      const sets: WorkoutSet[] = [
        {
          id: 'set_1',
          workout_id: 'w_active_1',
          exercise_id: 'bench_press',
          gear_id: null,
          set_number: 1,
          weight: 100,
          raw_input_weight: 100,
          added_weight: null,
          reps: 5,
          reps_right: null,
          rpe: 8,
          rir: 2,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: fortyFiveMinsAgo,
        },
        {
          id: 'set_2',
          workout_id: 'w_active_1',
          exercise_id: 'bench_press',
          gear_id: null,
          set_number: 2,
          weight: 100,
          raw_input_weight: 100,
          added_weight: null,
          reps: 5,
          reps_right: null,
          rpe: 8.5,
          rir: 1.5,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: thirtyMinsAgo,
        },
        {
          id: 'set_3',
          workout_id: 'w_active_1',
          exercise_id: 'incline_db_press',
          gear_id: null,
          set_number: 1,
          weight: 60,
          raw_input_weight: 30,
          added_weight: null,
          reps: 0, // Uncompleted / placeholder set
          reps_right: null,
          rpe: null,
          rir: null,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: thirtyMinsAgo,
        },
      ];

      workoutRepo.seed([inProgressWorkout], sets);

      const promptData = await recoveryService.checkForInterruptedWorkout();

      expect(promptData).not.toBeNull();
      expect(promptData?.workout.id).toBe('w_active_1');
      expect(promptData?.sets).toHaveLength(3);

      expect(promptData?.summary.totalSets).toBe(3);
      expect(promptData?.summary.completedSets).toBe(2);
      expect(promptData?.summary.uniqueExercises).toBe(2); // bench_press, incline_db_press
      expect(promptData?.summary.elapsedSeconds).toBeGreaterThanOrEqual(44 * 60);
      expect(promptData?.summary.formattedElapsedTime).toBe('45m');
      expect(promptData?.summary.lastActiveTimestamp).toBe(thirtyMinsAgo);
    });

    it('uses active_completed_set_ids from userSettingsRepo when available', async () => {
      const settingsRepo = new MockUserSettingsRepository();
      const serviceWithSettings = new CrashRecoveryService(workoutRepo, settingsRepo);

      const inProgressWorkout: Workout = {
        id: 'w_active_tracked',
        template_id: 'tmpl_1',
        date: '2026-10-14',
        name: 'Template Workout',
        notes: null,
        started_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        duration_seconds: null,
        status: 'in_progress',
        completed_at: null,
        imported_from: null,
      };

      // Even if all sets have reps > 0 (prescribed template reps), only 1 is checked off
      const sets: WorkoutSet[] = [
        {
          id: 'set_1',
          workout_id: 'w_active_tracked',
          exercise_id: 'bench_press',
          gear_id: null,
          set_number: 1,
          weight: 100,
          raw_input_weight: 100,
          added_weight: null,
          reps: 10,
          reps_right: null,
          rpe: 8,
          rir: 2,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        {
          id: 'set_2',
          workout_id: 'w_active_tracked',
          exercise_id: 'bench_press',
          gear_id: null,
          set_number: 2,
          weight: 100,
          raw_input_weight: 100,
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
      ];

      workoutRepo.seed([inProgressWorkout], sets);
      await settingsRepo.set('active_completed_set_ids_w_active_tracked', JSON.stringify(['set_1']));

      const promptData = await serviceWithSettings.checkForInterruptedWorkout();
      expect(promptData?.summary.totalSets).toBe(2);
      expect(promptData?.summary.completedSets).toBe(1);
    });

    it('formats duration with hours when elapsed time exceeds 60 minutes', async () => {
      const oneHourTwentyMinsAgo = new Date(
        Date.now() - (80 * 60 + 5) * 1000
      ).toISOString();

      const inProgressWorkout: Workout = {
        id: 'w_long_session',
        template_id: null,
        date: '2026-10-14',
        name: 'Long Session',
        notes: null,
        started_at: oneHourTwentyMinsAgo,
        duration_seconds: null,
        status: 'in_progress',
        completed_at: null,
        imported_from: null,
      };

      workoutRepo.seed([inProgressWorkout], []);

      const promptData = await recoveryService.checkForInterruptedWorkout();
      expect(promptData?.summary.formattedElapsedTime).toBe('1h 20m');
    });

    it('formats duration as < 1m when started under a minute ago', async () => {
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();

      const inProgressWorkout: Workout = {
        id: 'w_fresh',
        template_id: null,
        date: '2026-10-14',
        name: 'Just Started',
        notes: null,
        started_at: thirtySecondsAgo,
        duration_seconds: null,
        status: 'in_progress',
        completed_at: null,
        imported_from: null,
      };

      workoutRepo.seed([inProgressWorkout], []);

      const promptData = await recoveryService.checkForInterruptedWorkout();
      expect(promptData?.summary.formattedElapsedTime).toBe('< 1m');
    });
  });

  describe('resumeSession', () => {
    it('successfully resumes an in-progress workout', async () => {
      const inProgressWorkout: Workout = {
        id: 'w_resume_target',
        template_id: null,
        date: '2026-10-14',
        name: 'Should Resume',
        notes: null,
        started_at: new Date().toISOString(),
        duration_seconds: null,
        status: 'in_progress',
        completed_at: null,
        imported_from: null,
      };

      workoutRepo.seed([inProgressWorkout], []);

      const result = await recoveryService.resumeSession('w_resume_target');
      expect(result.workout.id).toBe('w_resume_target');
      expect(result.workout.status).toBe('in_progress');
      expect(result.sets).toHaveLength(0);
    });

    it('throws error when attempting to resume a completed workout', async () => {
      const completedWorkout: Workout = {
        id: 'w_already_done',
        template_id: null,
        date: '2026-10-14',
        name: 'Done',
        notes: null,
        started_at: new Date().toISOString(),
        duration_seconds: 3600,
        status: 'completed',
        completed_at: new Date().toISOString(),
        imported_from: null,
      };

      workoutRepo.seed([completedWorkout], []);

      await expect(
        recoveryService.resumeSession('w_already_done')
      ).rejects.toThrow(/cannot be resumed/);
    });

    it('throws error when workout ID does not exist', async () => {
      await expect(
        recoveryService.resumeSession('ghost_id')
      ).rejects.toThrow(/not found for recovery/);
    });
  });

  describe('discardSession & deleteSession', () => {
    it('permanently deletes an interrupted session when discarded', async () => {
      const inProgressWorkout: Workout = {
        id: 'w_to_discard',
        template_id: null,
        date: '2026-10-14',
        name: 'Abandoned',
        notes: null,
        started_at: new Date().toISOString(),
        duration_seconds: null,
        status: 'in_progress',
        completed_at: null,
        imported_from: null,
      };

      workoutRepo.seed([inProgressWorkout], []);

      const discarded = await recoveryService.discardSession('w_to_discard');
      expect(discarded.status).toBe('discarded');
      expect(discarded.completed_at).toBeDefined();
      expect(await workoutRepo.findById('w_to_discard')).toBeNull();
      expect(await workoutRepo.getSetsByWorkoutId('w_to_discard')).toEqual([]);

      // Should no longer be reported as in_progress
      const active = await workoutRepo.getInProgressWorkout();
      expect(active).toBeNull();
    });

    it('deletes an in-progress workout completely from storage', async () => {
      const inProgressWorkout: Workout = {
        id: 'w_to_delete',
        template_id: null,
        date: '2026-10-14',
        name: 'To Delete',
        notes: null,
        started_at: new Date().toISOString(),
        duration_seconds: null,
        status: 'in_progress',
        completed_at: null,
        imported_from: null,
      };

      workoutRepo.seed([inProgressWorkout], []);

      await recoveryService.deleteSession('w_to_delete');

      const lookup = await workoutRepo.findById('w_to_delete');
      expect(lookup).toBeNull();
    });
  });
});
