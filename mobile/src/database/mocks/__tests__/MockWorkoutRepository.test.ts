import { MockWorkoutRepository } from '../MockWorkoutRepository';
import { Workout, WorkoutSet } from '../../../core/types';

describe('MockWorkoutRepository', () => {
  let repo: MockWorkoutRepository;

  const mockWorkoutCompleted1: Workout = {
    id: 'workout_1',
    template_id: 'template_push_a',
    date: '2026-10-01',
    name: 'Push Day A',
    notes: 'Good session',
    started_at: '2026-10-01T10:00:00Z',
    duration_seconds: 3600,
    status: 'completed',
    completed_at: '2026-10-01T11:00:00Z',
    imported_from: null,
  };

  const mockWorkoutCompleted2: Workout = {
    id: 'workout_2',
    template_id: 'template_push_a',
    date: '2026-10-08',
    name: 'Push Day A',
    notes: 'Heavier session',
    started_at: '2026-10-08T10:00:00Z',
    duration_seconds: 3700,
    status: 'completed',
    completed_at: '2026-10-08T11:01:40Z',
    imported_from: null,
  };

  const mockWorkoutInProgress: Workout = {
    id: 'workout_in_progress',
    template_id: 'template_pull_b',
    date: '2026-10-12',
    name: 'Pull Day B',
    notes: 'Active session',
    started_at: '2026-10-12T14:30:00Z',
    duration_seconds: null,
    status: 'in_progress',
    completed_at: null,
    imported_from: null,
  };

  const mockWorkoutDiscarded: Workout = {
    id: 'workout_discarded',
    template_id: null,
    date: '2026-10-05',
    name: 'Discarded Session',
    notes: 'Interrupted by gym closure',
    started_at: '2026-10-05T08:00:00Z',
    duration_seconds: 600,
    status: 'discarded',
    completed_at: null,
    imported_from: null,
  };

  // Sets for workout 1 (earlier completed)
  const set1_1: WorkoutSet = {
    id: 's1_1',
    workout_id: 'workout_1',
    exercise_id: 'bench_press',
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
    created_at: '2026-10-01T10:15:00Z',
  };

  const set1_2: WorkoutSet = {
    id: 's1_2',
    workout_id: 'workout_1',
    exercise_id: 'bench_press',
    gear_id: null,
    set_number: 2,
    weight: 100.0,
    raw_input_weight: 100.0,
    added_weight: null,
    reps: 7,
    reps_right: null,
    rpe: 9.0,
    rir: 1.0,
    set_type: 'working',
    set_notes: null,
    exercise_group_id: null,
    created_at: '2026-10-01T10:20:00Z',
  };

  // Sets for workout 2 (most recent completed)
  const set2_1: WorkoutSet = {
    id: 's2_1',
    workout_id: 'workout_2',
    exercise_id: 'bench_press',
    gear_id: null,
    set_number: 1,
    weight: 102.5,
    raw_input_weight: 102.5,
    added_weight: null,
    reps: 8,
    reps_right: null,
    rpe: 8.5,
    rir: 1.5,
    set_type: 'working',
    set_notes: 'Smooth lockout',
    exercise_group_id: null,
    created_at: '2026-10-08T10:15:00Z',
  };

  const set2_2: WorkoutSet = {
    id: 's2_2',
    workout_id: 'workout_2',
    exercise_id: 'bench_press',
    gear_id: null,
    set_number: 2,
    weight: 102.5,
    raw_input_weight: 102.5,
    added_weight: null,
    reps: 8,
    reps_right: null,
    rpe: 9.5,
    rir: 0.5,
    set_type: 'working',
    set_notes: null,
    exercise_group_id: null,
    created_at: '2026-10-08T10:20:00Z',
  };

  const set2_overhead: WorkoutSet = {
    id: 's2_ohp',
    workout_id: 'workout_2',
    exercise_id: 'overhead_press',
    gear_id: null,
    set_number: 1,
    weight: 60.0,
    raw_input_weight: 60.0,
    added_weight: null,
    reps: 6,
    reps_right: null,
    rpe: 8.0,
    rir: 2.0,
    set_type: 'working',
    set_notes: null,
    exercise_group_id: null,
    created_at: '2026-10-08T10:35:00Z',
  };

  // Set in active workout
  const set_in_progress: WorkoutSet = {
    id: 's_active',
    workout_id: 'workout_in_progress',
    exercise_id: 'bench_press',
    gear_id: null,
    set_number: 1,
    weight: 105.0,
    raw_input_weight: 105.0,
    added_weight: null,
    reps: 5,
    reps_right: null,
    rpe: 8.0,
    rir: 2.0,
    set_type: 'working',
    set_notes: 'Unfinished session',
    exercise_group_id: null,
    created_at: '2026-10-12T14:40:00Z',
  };

  beforeEach(() => {
    repo = new MockWorkoutRepository(
      [
        mockWorkoutCompleted1,
        mockWorkoutCompleted2,
        mockWorkoutInProgress,
        mockWorkoutDiscarded,
      ],
      [set1_1, set1_2, set2_1, set2_2, set2_overhead, set_in_progress]
    );
  });

  describe('Workout CRUD & Querying', () => {
    it('retrieves workout by id', async () => {
      const workout = await repo.findById('workout_1');
      expect(workout).not.toBeNull();
      expect(workout?.name).toBe('Push Day A');
    });

    it('returns null if workout does not exist', async () => {
      const workout = await repo.findById('does_not_exist');
      expect(workout).toBeNull();
    });

    it('retrieves all workouts ordered by date DESC', async () => {
      const all = await repo.findAll();
      expect(all).toHaveLength(4);
      expect(all[0].date).toBe('2026-10-12'); // newest
      expect(all[all.length - 1].date).toBe('2026-10-01'); // oldest
    });

    it('filters workouts by status', async () => {
      const completed = await repo.findAll({ status: 'completed' });
      expect(completed).toHaveLength(2);
      expect(completed.every((w) => w.status === 'completed')).toBe(true);
    });

    it('filters workouts by date range', async () => {
      const range = await repo.findAll({
        startDate: '2026-10-05',
        endDate: '2026-10-10',
      });
      expect(range).toHaveLength(2);
      expect(range.map((w) => w.id)).toEqual(['workout_2', 'workout_discarded']);
    });

    it('filters workouts by templateId and applies limit/offset', async () => {
      const paged = await repo.findAll({
        templateId: 'template_push_a',
        limit: 1,
        offset: 1,
      });
      expect(paged).toHaveLength(1);
      expect(paged[0].id).toBe('workout_1');
    });

    it('creates a new workout', async () => {
      const newWorkout: Workout = {
        id: 'workout_new',
        template_id: null,
        date: '2026-10-13',
        name: 'Ad-hoc Leg Session',
        notes: null,
        started_at: '2026-10-13T18:00:00Z',
        duration_seconds: null,
        status: 'in_progress',
        completed_at: null,
        imported_from: null,
      };

      const created = await repo.create(newWorkout);
      expect(created.id).toBe('workout_new');

      const fetched = await repo.findById('workout_new');
      expect(fetched?.name).toBe('Ad-hoc Leg Session');
    });

    it('updates an existing workout', async () => {
      const updated = await repo.update({
        ...mockWorkoutInProgress,
        status: 'completed',
        completed_at: '2026-10-12T15:30:00Z',
        duration_seconds: 3600,
      });

      expect(updated.status).toBe('completed');
      expect(updated.duration_seconds).toBe(3600);

      const fetched = await repo.findById('workout_in_progress');
      expect(fetched?.status).toBe('completed');
    });

    it('throws error when updating non-existent workout', async () => {
      await expect(
        repo.update({
          ...mockWorkoutCompleted1,
          id: 'invalid_id',
        })
      ).rejects.toThrow("Workout with id 'invalid_id' not found");
    });

    it('cascades delete: deleting a workout deletes all its associated sets', async () => {
      const setsBefore = await repo.getSetsByWorkoutId('workout_1');
      expect(setsBefore).toHaveLength(2);

      await repo.delete('workout_1');

      const workoutAfter = await repo.findById('workout_1');
      expect(workoutAfter).toBeNull();

      const setsAfter = await repo.getSetsByWorkoutId('workout_1');
      expect(setsAfter).toHaveLength(0);
    });
  });

  describe('Crash Recovery (getInProgressWorkout)', () => {
    it('returns the active in-progress workout session', async () => {
      const active = await repo.getInProgressWorkout();
      expect(active).not.toBeNull();
      expect(active?.id).toBe('workout_in_progress');
      expect(active?.status).toBe('in_progress');
    });

    it('returns null if no workout is in progress', async () => {
      await repo.update({
        ...mockWorkoutInProgress,
        status: 'completed',
        completed_at: '2026-10-12T15:30:00Z',
      });

      const active = await repo.getInProgressWorkout();
      expect(active).toBeNull();
    });

    it('returns the most recently started session when multiple are in progress', async () => {
      const secondActive: Workout = {
        id: 'workout_in_progress_2',
        template_id: null,
        date: '2026-10-12',
        name: 'Second In Progress',
        notes: null,
        started_at: '2026-10-12T16:00:00Z', // later than 14:30:00Z
        duration_seconds: null,
        status: 'in_progress',
        completed_at: null,
        imported_from: null,
      };

      await repo.create(secondActive);

      const active = await repo.getInProgressWorkout();
      expect(active?.id).toBe('workout_in_progress_2');
    });
  });

  describe('Workout Sets Management', () => {
    it('retrieves sets for a workout sorted by set_number ASC', async () => {
      const sets = await repo.getSetsByWorkoutId('workout_1');
      expect(sets).toHaveLength(2);
      expect(sets[0].set_number).toBe(1);
      expect(sets[1].set_number).toBe(2);
    });

    it('adds a new workout set', async () => {
      const newSet: WorkoutSet = {
        id: 's1_3',
        workout_id: 'workout_1',
        exercise_id: 'bench_press',
        gear_id: null,
        set_number: 3,
        weight: 100.0,
        raw_input_weight: 100.0,
        added_weight: null,
        reps: 6,
        reps_right: null,
        rpe: 10.0,
        rir: 0.0,
        set_type: 'working',
        set_notes: 'Grinder',
        exercise_group_id: null,
        created_at: '2026-10-01T10:25:00Z',
      };

      const added = await repo.addSet(newSet);
      expect(added.id).toBe('s1_3');

      const sets = await repo.getSetsByWorkoutId('workout_1');
      expect(sets).toHaveLength(3);
      expect(sets[2].set_number).toBe(3);
    });

    it('updates an existing workout set', async () => {
      const updated = await repo.updateSet({
        ...set1_1,
        reps: 9,
        rpe: 8.5,
      });

      expect(updated.reps).toBe(9);
      expect(updated.rpe).toBe(8.5);

      const sets = await repo.getSetsByWorkoutId('workout_1');
      expect(sets[0].reps).toBe(9);
    });

    it('throws error when updating non-existent set', async () => {
      await expect(
        repo.updateSet({
          ...set1_1,
          id: 'ghost_set_id',
        })
      ).rejects.toThrow("WorkoutSet with id 'ghost_set_id' not found");
    });

    it('deletes a set by id', async () => {
      await repo.deleteSet('s1_1');
      const sets = await repo.getSetsByWorkoutId('workout_1');
      expect(sets).toHaveLength(1);
      expect(sets[0].id).toBe('s1_2');
    });

    it('bulk saves sets via saveSets', async () => {
      const newSets: WorkoutSet[] = [
        {
          ...set1_1,
          id: 'bulk_1',
          set_number: 4,
        },
        {
          ...set1_2,
          id: 'bulk_2',
          set_number: 5,
        },
      ];

      const saved = await repo.saveSets(newSets);
      expect(saved).toHaveLength(2);

      const allSets = await repo.getSetsByWorkoutId('workout_1');
      expect(allSets).toHaveLength(4);
    });

    it('retrieves combined workout with sets via getWorkoutWithSets', async () => {
      const result = await repo.getWorkoutWithSets('workout_1');
      expect(result).not.toBeNull();
      expect(result?.workout.id).toBe('workout_1');
      expect(result?.sets).toHaveLength(2);
      expect(result?.sets[0].id).toBe('s1_1');

      const nonExistent = await repo.getWorkoutWithSets('unknown');
      expect(nonExistent).toBeNull();
    });
  });

  describe('Global Ghost-Set Lookup (getMostRecentCompletedSetsForExercise)', () => {
    it('returns sets from the most recently completed workout session for that exercise', async () => {
      // Both workout_1 (2026-10-01) and workout_2 (2026-10-08) contain bench_press.
      // workout_2 is more recent.
      const ghostSets = await repo.getMostRecentCompletedSetsForExercise(
        'bench_press'
      );

      expect(ghostSets).toHaveLength(2);
      expect(ghostSets[0].workout_id).toBe('workout_2');
      expect(ghostSets[0].weight).toBe(102.5);
      expect(ghostSets[0].reps).toBe(8);
      expect(ghostSets[1].workout_id).toBe('workout_2');
      expect(ghostSets[1].weight).toBe(102.5);
      expect(ghostSets[1].reps).toBe(8);
    });

    it('strictly ignores sets from in_progress and discarded workouts', async () => {
      // In-progress workout (2026-10-12) has bench_press at 105 kg, but it is not completed!
      // Therefore, the ghost sets MUST come from workout_2 (102.5 kg), NOT workout_in_progress.
      const ghostSets = await repo.getMostRecentCompletedSetsForExercise(
        'bench_press'
      );

      expect(ghostSets.every((s) => s.workout_id === 'workout_2')).toBe(true);
      expect(ghostSets.some((s) => s.workout_id === 'workout_in_progress')).toBe(
        false
      );
    });

    it('returns empty array when exercise has never been logged in a completed workout', async () => {
      const ghostSets = await repo.getMostRecentCompletedSetsForExercise(
        'deadlift'
      );
      expect(ghostSets).toEqual([]);
    });

    it('returns sets from an older completed workout if the newer one did not include that exercise', async () => {
      // Overhead press was only performed in workout_2
      const ghostSets = await repo.getMostRecentCompletedSetsForExercise(
        'overhead_press'
      );
      expect(ghostSets).toHaveLength(1);
      expect(ghostSets[0].workout_id).toBe('workout_2');
      expect(ghostSets[0].weight).toBe(60.0);
    });
  });

  describe('Historical Sets Lookup', () => {
    it('retrieves all sets for an exercise', async () => {
      const allSets = await repo.getHistoricalSetsForExercise('bench_press');
      // 2 from workout 1, 2 from workout 2, 1 from in_progress = 5
      expect(allSets).toHaveLength(5);
    });

    it('filters sets for completed workouts only when requested', async () => {
      const completedOnly = await repo.getHistoricalSetsForExercise(
        'bench_press',
        { onlyCompletedWorkouts: true }
      );
      // 2 from workout 1, 2 from workout 2 = 4 (excludes in_progress)
      expect(completedOnly).toHaveLength(4);
      expect(
        completedOnly.every((s) => s.workout_id !== 'workout_in_progress')
      ).toBe(true);
    });
  });

  describe('Immutability & Reset Helpers', () => {
    it('preserves immutability when returned objects are modified', async () => {
      const w = await repo.findById('workout_1');
      if (w) {
        w.name = 'Mutated';
      }
      const fresh = await repo.findById('workout_1');
      expect(fresh?.name).toBe('Push Day A');
    });

    it('clears all state on clear()', async () => {
      repo.clear();
      const all = await repo.findAll();
      expect(all).toHaveLength(0);
      const ghost = await repo.getMostRecentCompletedSetsForExercise(
        'bench_press'
      );
      expect(ghost).toHaveLength(0);
    });
  });

  describe('Rep-Max Records (PR Board) Queries', () => {
    it('returns the heaviest set for each unique repetition count', async () => {
      // workout 1 (2026-10-01): 100kg x 8 (RPE 8), 100kg x 7 (RPE 9)
      // workout 2 (2026-10-08): 102.5kg x 8 (RPE 8.5), 102.5kg x 8 (RPE 9.5)
      const prs = await repo.getRepMaxSets({
        exerciseIds: ['bench_press'],
      });

      // Unique rep counts: 7, 8
      expect(prs).toHaveLength(2);
      expect(prs.map((p) => p.reps)).toEqual([7, 8]);

      // 7 reps: 100kg
      expect(prs[0].reps).toBe(7);
      expect(prs[0].weight).toBe(100);
      expect(prs[0].workoutDate).toBe('2026-10-01');

      // 8 reps: 102.5kg (from workout 2, tie-breaker picking s2_2 with RPE 9.5 over s2_1 with RPE 8.5)
      expect(prs[1].reps).toBe(8);
      expect(prs[1].weight).toBe(102.5);
      expect(prs[1].rpe).toBe(9.5);
      expect(prs[1].workoutDate).toBe('2026-10-08');
    });

    it('filters rep-max records by date range', async () => {
      // Querying only up to 2026-10-05 (only workout 1 is included)
      const prs = await repo.getRepMaxSets({
        exerciseIds: ['bench_press'],
        endDate: '2026-10-05',
      });

      // Only sets from workout 1 (reps: 7, 8)
      expect(prs).toHaveLength(2);
      expect(prs.map((p) => p.reps)).toEqual([7, 8]);
      expect(prs[0].weight).toBe(100);
      expect(prs[1].weight).toBe(100);
    });

    it('supports multiple exercise IDs for cross-variant aggregation', async () => {
      // bench_press (7, 8 reps) + overhead_press (6 reps)
      const prs = await repo.getRepMaxSets({
        exerciseIds: ['bench_press', 'overhead_press'],
      });

      expect(prs).toHaveLength(3);
      expect(prs.map((p) => p.reps)).toEqual([6, 7, 8]);
      expect(prs[0].exerciseId).toBe('overhead_press');
      expect(prs[0].weight).toBe(60.0);
    });

    it('excludes sets from incomplete or discarded workouts', async () => {
      const prs = await repo.getRepMaxSets({
        exerciseIds: ['bench_press'],
      });

      expect(prs.every((p) => p.workoutId !== 'workout_in_progress')).toBe(true);
      expect(prs.every((p) => p.workoutId !== 'workout_discarded')).toBe(true);
    });
  });

  describe('Batch Set and e1RM Aggregations', () => {
    it('retrieves all sets matching a list of workout IDs via getSetsByWorkoutIds', async () => {
      const sets = await repo.getSetsByWorkoutIds(['workout_1', 'workout_2']);
      expect(sets.length).toBeGreaterThan(0);
      expect(sets.every((s) => s.workout_id === 'workout_1' || s.workout_id === 'workout_2')).toBe(true);
      // Workout 1 has s1_1 and s1_2; Workout 2 has s2_1, s2_ohp, s2_2
      expect(sets.map((s) => s.id)).toEqual(['s1_1', 's1_2', 's2_1', 's2_ohp', 's2_2']);
    });

    it('returns empty array when getSetsByWorkoutIds is called with empty array', async () => {
      const sets = await repo.getSetsByWorkoutIds([]);
      expect(sets).toEqual([]);
    });

    it('computes maximum e1RM per exercise across all sets via getBestE1rmByExercise', async () => {
      const bestE1rms = await repo.getBestE1rmByExercise();
      expect(bestE1rms.has('bench_press')).toBe(true);
      expect(bestE1rms.has('overhead_press')).toBe(true);
      // Bench press best set is 102.5kg x 8 reps @ 1.5 RIR -> Lombardi 102.5 * (8 + 1.5)^0.10 = 128.38 kg
      const benchE1rm = bestE1rms.get('bench_press');
      expect(benchE1rm).toBeCloseTo(128.38, 1);
    });
  });
});

