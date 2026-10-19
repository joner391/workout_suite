import { SQLiteWorkoutRepository } from '../SQLiteWorkoutRepository';
import { MockSQLiteDatabase } from '../../__tests__/MockSQLiteDatabase';
import { Workout, WorkoutSet } from '../../../core/types';

describe('SQLiteWorkoutRepository', () => {
  let mockDb: MockSQLiteDatabase;
  let repo: SQLiteWorkoutRepository;

  const sampleWorkoutRow = {
    id: 'workout_123',
    template_id: 'template_push',
    date: '2026-10-13',
    name: 'Push Day A',
    notes: 'Heavy bench focus',
    started_at: '2026-10-13T10:00:00Z',
    duration_seconds: 3600,
    status: 'completed' as const,
    completed_at: '2026-10-13T11:00:00Z',
    imported_from: null,
  };

  const sampleWorkout: Workout = {
    id: 'workout_123',
    template_id: 'template_push',
    date: '2026-10-13',
    name: 'Push Day A',
    notes: 'Heavy bench focus',
    started_at: '2026-10-13T10:00:00Z',
    duration_seconds: 3600,
    status: 'completed',
    completed_at: '2026-10-13T11:00:00Z',
    imported_from: null,
  };

  const sampleSetRow = {
    id: 'set_456',
    workout_id: 'workout_123',
    exercise_id: 'barbell_bench_press',
    gear_id: null,
    set_number: 1,
    weight: 100.0,
    raw_input_weight: 100.0,
    added_weight: null,
    reps: 8,
    reps_right: null,
    rpe: 8.5,
    rir: 1.5,
    set_type: 'working' as const,
    set_notes: null,
    exercise_group_id: null,
    created_at: '2026-10-13T10:15:00Z',
  };

  const sampleSet: WorkoutSet = {
    id: 'set_456',
    workout_id: 'workout_123',
    exercise_id: 'barbell_bench_press',
    gear_id: null,
    set_number: 1,
    weight: 100.0,
    raw_input_weight: 100.0,
    added_weight: null,
    reps: 8,
    reps_right: null,
    rpe: 8.5,
    rir: 1.5,
    set_type: 'working',
    set_notes: null,
    exercise_group_id: null,
    created_at: '2026-10-13T10:15:00Z',
  };

  beforeEach(() => {
    mockDb = new MockSQLiteDatabase();
    repo = new SQLiteWorkoutRepository(mockDb);
  });

  describe('Workout Session Queries', () => {
    it('retrieves workout by id', async () => {
      mockDb.mockData.set('WHERE id = ?;', [sampleWorkoutRow]);

      const result = await repo.findById('workout_123');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('workout_123');
      expect(result?.name).toBe('Push Day A');
      expect(mockDb.executedQueries[0].params).toEqual(['workout_123']);
    });

    it('returns null if workout is not found', async () => {
      const result = await repo.findById('unknown');
      expect(result).toBeNull();
    });

    it('constructs dynamic filter SQL queries', async () => {
      mockDb.mockData.set('SELECT * FROM workouts', [sampleWorkoutRow]);

      await repo.findAll({
        status: 'completed',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        templateId: 'template_push',
        limit: 10,
        offset: 20,
      });

      const query = mockDb.executedQueries[0];
      expect(query.sql).toContain('WHERE 1=1');
      expect(query.sql).toContain('AND status = ?');
      expect(query.sql).toContain('AND date >= ?');
      expect(query.sql).toContain('AND date <= ?');
      expect(query.sql).toContain('AND template_id = ?');
      expect(query.sql).toContain('LIMIT ?');
      expect(query.sql).toContain('OFFSET ?');
      expect(query.params).toEqual([
        'completed',
        '2026-10-01',
        '2026-10-31',
        'template_push',
        10,
        20,
      ]);
    });

    it('creates a new workout session', async () => {
      await repo.create(sampleWorkout);

      expect(mockDb.executedQueries[0].sql).toContain('INSERT INTO workouts');
      expect(mockDb.executedQueries[0].params[0]).toBe('workout_123');
      expect(mockDb.executedQueries[0].params[7]).toBe('completed');
    });

    it('updates an existing workout session', async () => {
      mockDb.defaultChanges = 1;
      const updated = await repo.update(sampleWorkout);
      expect(updated.id).toBe('workout_123');

      expect(mockDb.executedQueries[0].sql).toContain('UPDATE workouts SET');
      expect(mockDb.executedQueries[0].params).toContain('workout_123');
    });

    it('throws error when updating non-existent workout', async () => {
      mockDb.defaultChanges = 0;
      await expect(repo.update(sampleWorkout)).rejects.toThrow(
        "Workout with id 'workout_123' not found"
      );
    });

    it('deletes workout and cascading sets', async () => {
      await repo.delete('workout_123');

      expect(mockDb.executedQueries[0].sql).toContain(
        'DELETE FROM workout_sets WHERE workout_id = ?;'
      );
      expect(mockDb.executedQueries[1].sql).toContain(
        'DELETE FROM workouts WHERE id = ?;'
      );
    });

    it('queries active in-progress workout for crash recovery', async () => {
      mockDb.mockData.set("status = 'in_progress'", [
        {
          ...sampleWorkoutRow,
          id: 'active_workout',
          status: 'in_progress',
        },
      ]);

      const result = await repo.getInProgressWorkout();
      expect(result).not.toBeNull();
      expect(result?.id).toBe('active_workout');
      expect(mockDb.executedQueries[0].sql).toContain("status = 'in_progress'");
      expect(mockDb.executedQueries[0].sql).toContain('ORDER BY started_at DESC LIMIT 1');
    });

    it('retrieves workout with associated sets via getWorkoutWithSets', async () => {
      mockDb.mockData.set('WHERE id = ?;', [sampleWorkoutRow]);
      mockDb.mockData.set('WHERE workout_id = ?', [sampleSetRow]);

      const result = await repo.getWorkoutWithSets('workout_123');
      expect(result).not.toBeNull();
      expect(result?.workout.id).toBe('workout_123');
      expect(result?.sets).toHaveLength(1);
      expect(result?.sets[0].id).toBe('set_456');
    });
  });

  describe('Workout Set Operations', () => {
    it('retrieves sets for a workout sorted by set_number', async () => {
      mockDb.mockData.set('WHERE workout_id = ?', [sampleSetRow]);

      const sets = await repo.getSetsByWorkoutId('workout_123');
      expect(sets).toHaveLength(1);
      expect(mockDb.executedQueries[0].sql).toContain('ORDER BY set_number ASC');
    });

    it('adds a new workout set', async () => {
      await repo.addSet(sampleSet);

      expect(mockDb.executedQueries[0].sql).toContain('INSERT INTO workout_sets');
      expect(mockDb.executedQueries[0].params).toContain('set_456');
      expect(mockDb.executedQueries[0].params).toContain(100.0);
    });

    it('updates an existing workout set', async () => {
      mockDb.defaultChanges = 1;
      const updated = await repo.updateSet(sampleSet);
      expect(updated.id).toBe('set_456');

      expect(mockDb.executedQueries[0].sql).toContain('UPDATE workout_sets SET');
      expect(mockDb.executedQueries[0].params).toContain('set_456');
    });

    it('throws error when updating non-existent set', async () => {
      mockDb.defaultChanges = 0;
      await expect(repo.updateSet(sampleSet)).rejects.toThrow(
        "WorkoutSet with id 'set_456' not found"
      );
    });

    it('deletes a set by id', async () => {
      await repo.deleteSet('set_456');
      expect(mockDb.executedQueries[0].sql).toBe(
        'DELETE FROM workout_sets WHERE id = ?;'
      );
      expect(mockDb.executedQueries[0].params).toEqual(['set_456']);
    });

    it('bulk saves sets via saveSets', async () => {
      await repo.saveSets([sampleSet]);
      expect(mockDb.executedQueries[0].sql).toContain(
        'INSERT OR REPLACE INTO workout_sets'
      );
    });

    it('deletes sets by workoutId', async () => {
      await repo.deleteSetsByWorkoutId('workout_123');
      expect(mockDb.executedQueries[0].sql).toBe(
        'DELETE FROM workout_sets WHERE workout_id = ?;'
      );
      expect(mockDb.executedQueries[0].params).toEqual(['workout_123']);
    });
  });

  describe('Historical & Ghosting Queries', () => {
    it('executes global ghost-set query targeting the most recently completed session', async () => {
      mockDb.mockData.set('w.status = \'completed\'', [sampleSetRow]);

      const ghostSets = await repo.getMostRecentCompletedSetsForExercise(
        'barbell_bench_press'
      );

      expect(ghostSets).toHaveLength(1);
      expect(ghostSets[0].exercise_id).toBe('barbell_bench_press');

      const executedSql = mockDb.executedQueries[0].sql;
      expect(executedSql).toContain("w.status = 'completed'");
      expect(executedSql).toContain('ORDER BY s.set_number ASC');
      expect(executedSql).toContain('LIMIT 1');
      expect(mockDb.executedQueries[0].params).toEqual([
        'barbell_bench_press',
        'barbell_bench_press',
      ]);
    });

    it('queries historical sets for exercise with completed option filter', async () => {
      mockDb.mockData.set('s.exercise_id = ?', [sampleSetRow]);

      await repo.getHistoricalSetsForExercise('barbell_bench_press', {
        onlyCompletedWorkouts: true,
      });

      const executedSql = mockDb.executedQueries[0].sql;
      expect(executedSql).toContain("AND w.status = 'completed'");
      expect(executedSql).toContain('ORDER BY s.created_at ASC');
    });

    it('queries heaviest rep-max sets with window function and optional date filters', async () => {
      const mockRepMaxRow = {
        setId: 'set_pr_1',
        workoutId: 'workout_123',
        exerciseId: 'barbell_bench_press',
        reps: 5,
        weight: 120.0,
        rawInputWeight: 120.0,
        rpe: 9.0,
        rir: 1.0,
        workoutDate: '2026-10-13',
      };

      mockDb.mockData.set('PARTITION BY s.reps', [mockRepMaxRow]);

      const results = await repo.getRepMaxSets({
        exerciseIds: ['barbell_bench_press', 'incline_dumbbell_press'],
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });

      expect(results).toHaveLength(1);
      expect(results[0].reps).toBe(5);
      expect(results[0].weight).toBe(120.0);
      expect(results[0].workoutDate).toBe('2026-10-13');

      const executedSql = mockDb.executedQueries[0].sql;
      expect(executedSql).toContain('ROW_NUMBER() OVER');
      expect(executedSql).toContain('PARTITION BY s.reps');
      expect(executedSql).toContain('w.date >= ?');
      expect(executedSql).toContain('w.date <= ?');
      expect(mockDb.executedQueries[0].params).toEqual([
        'barbell_bench_press',
        'incline_dumbbell_press',
        '2026-01-01',
        '2026-12-31',
      ]);
    });

    it('returns empty array when exerciseIds is empty', async () => {
      const results = await repo.getRepMaxSets({ exerciseIds: [] });
      expect(results).toEqual([]);
      expect(mockDb.executedQueries).toHaveLength(0);
    });
  });

  describe('Batch Queries and e1RM Aggregations', () => {
    it('returns empty array when getSetsByWorkoutIds is called with empty array', async () => {
      const results = await repo.getSetsByWorkoutIds([]);
      expect(results).toEqual([]);
      expect(mockDb.executedQueries).toHaveLength(0);
    });

    it('queries sets using WHERE workout_id IN (...) for batch workout IDs', async () => {
      mockDb.mockData.set('WHERE workout_id IN', [sampleSetRow]);

      const results = await repo.getSetsByWorkoutIds(['w1', 'w2']);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('set_456');

      expect(mockDb.executedQueries).toHaveLength(1);
      const query = mockDb.executedQueries[0];
      expect(query.sql).toContain('WHERE workout_id IN (?, ?)');
      expect(query.params).toEqual(['w1', 'w2']);
    });

    it('chunks getSetsByWorkoutIds when exceeding 400 IDs', async () => {
      mockDb.mockData.set('WHERE workout_id IN', [sampleSetRow]);

      const ids = Array.from({ length: 450 }, (_, i) => `w_${i}`);
      const results = await repo.getSetsByWorkoutIds(ids);

      // 450 IDs / 400 chunk size = 2 chunks (400 + 50)
      expect(mockDb.executedQueries).toHaveLength(2);
      expect(mockDb.executedQueries[0].params).toHaveLength(400);
      expect(mockDb.executedQueries[1].params).toHaveLength(50);
      expect(results).toHaveLength(2); // 1 mock row per chunk
    });

    it('queries best e1RM by exercise using SQL aggregate and maps results', async () => {
      mockDb.mockData.set('MAX(weight * (1.0 + reps / 30.0))', [
        { exercise_id: 'bench_press', max_e1rm: 125.5 },
        { exercise_id: 'squat', max_e1rm: 180.0 },
      ]);

      const results = await repo.getBestE1rmByExercise();
      expect(results.size).toBe(2);
      expect(results.get('bench_press')).toBe(125.5);
      expect(results.get('squat')).toBe(180.0);

      expect(mockDb.executedQueries[0].sql).toContain('GROUP BY exercise_id');
    });
  });
});

