import { SQLiteExerciseRepository } from '../SQLiteExerciseRepository';
import { MockSQLiteDatabase } from '../../__tests__/MockSQLiteDatabase';
import { Exercise } from '../../../core/types';

describe('SQLiteExerciseRepository', () => {
  let mockDb: MockSQLiteDatabase;
  let repo: SQLiteExerciseRepository;

  const sampleRow = {
    id: 'barbell_bench_press',
    name: 'Barbell Bench Press',
    muscle_group: 'Chest',
    category: 'Barbell',
    is_compound: 1,
    is_bodyweight: 0,
    is_unilateral: 0,
    load_mode: 'total',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 20.0,
    is_custom: 0,
    parent_exercise_id: null,
    standard_lift_type: 'bench',
    default_rest_seconds: 180,
  };

  const sampleExercise: Exercise = {
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

  beforeEach(() => {
    mockDb = new MockSQLiteDatabase();
    repo = new SQLiteExerciseRepository(mockDb);
  });

  it('retrieves an exercise by id with boolean mapping', async () => {
    mockDb.mockData.set('WHERE id = ?;', [sampleRow]);

    const result = await repo.findById('barbell_bench_press');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('barbell_bench_press');
    expect(result?.is_compound).toBe(true);
    expect(result?.is_bodyweight).toBe(false);
    expect(result?.is_unilateral).toBe(false);
    expect(result?.is_custom).toBe(false);

    expect(mockDb.executedQueries[0].sql).toBe(
      'SELECT * FROM exercises WHERE id = ?;'
    );
    expect(mockDb.executedQueries[0].params).toEqual(['barbell_bench_press']);
  });

  it('returns null if exercise id is not found', async () => {
    const result = await repo.findById('non_existent');
    expect(result).toBeNull();
  });

  it('retrieves all exercises', async () => {
    mockDb.mockData.set('SELECT * FROM exercises', [sampleRow]);

    const results = await repo.findAll();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Barbell Bench Press');
  });

  it('filters exercises by category', async () => {
    mockDb.mockData.set('WHERE category = ?', [sampleRow]);

    const results = await repo.findByCategory('Barbell');
    expect(results).toHaveLength(1);
    expect(mockDb.executedQueries[0].params).toEqual(['Barbell']);
  });

  it('filters exercises by muscle group', async () => {
    mockDb.mockData.set('WHERE LOWER(muscle_group) = LOWER(?)', [sampleRow]);

    const results = await repo.findByMuscleGroup('Chest');
    expect(results).toHaveLength(1);
    expect(mockDb.executedQueries[0].params).toEqual(['Chest']);
  });

  it('finds variants linked to a parent exercise', async () => {
    mockDb.mockData.set('WHERE parent_exercise_id = ?', [sampleRow]);

    const results = await repo.findVariants('parent_id');
    expect(results).toHaveLength(1);
    expect(mockDb.executedQueries[0].params).toEqual(['parent_id']);
  });

  it('searches exercises using SQL LIKE wildcards', async () => {
    mockDb.mockData.set('LIKE ? OR LOWER(muscle_group) LIKE ?', [sampleRow]);

    const results = await repo.search('bench');
    expect(results).toHaveLength(1);
    expect(mockDb.executedQueries[0].params).toEqual(['%bench%', '%bench%']);
  });

  it('creates and persists a new exercise', async () => {
    await repo.create(sampleExercise);

    expect(mockDb.executedQueries[0].sql).toContain('INSERT INTO exercises');
    expect(mockDb.executedQueries[0].params).toContain('barbell_bench_press');
    expect(mockDb.executedQueries[0].params).toContain(1); // is_compound as 1
    expect(mockDb.executedQueries[0].params).toContain(0); // is_bodyweight as 0
  });

  it('updates an existing exercise', async () => {
    mockDb.defaultChanges = 1;
    const updated = await repo.update(sampleExercise);
    expect(updated.id).toBe('barbell_bench_press');

    expect(mockDb.executedQueries[0].sql).toContain('UPDATE exercises SET');
    expect(mockDb.executedQueries[0].params).toContain('barbell_bench_press');
  });

  it('throws an error when updating non-existent exercise', async () => {
    mockDb.defaultChanges = 0; // 0 rows affected
    await expect(repo.update(sampleExercise)).rejects.toThrow(
      "Exercise with id 'barbell_bench_press' not found"
    );
  });

  it('deletes an exercise by id', async () => {
    await repo.delete('barbell_bench_press');
    expect(mockDb.executedQueries[0].sql).toBe(
      'DELETE FROM exercises WHERE id = ?;'
    );
    expect(mockDb.executedQueries[0].params).toEqual(['barbell_bench_press']);
  });
});
