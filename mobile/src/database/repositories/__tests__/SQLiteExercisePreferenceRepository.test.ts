import { SQLiteExercisePreferenceRepository } from '../SQLiteExercisePreferenceRepository';
import { MockSQLiteDatabase } from '../../__tests__/MockSQLiteDatabase';
import { ExercisePreference } from '../../../core/types';

describe('SQLiteExercisePreferenceRepository', () => {
  let mockDb: MockSQLiteDatabase;
  let repo: SQLiteExercisePreferenceRepository;

  beforeEach(() => {
    mockDb = new MockSQLiteDatabase();
    repo = new SQLiteExercisePreferenceRepository(mockDb);
  });

  it('saves an exercise preference record using upsert', async () => {
    const pref: ExercisePreference = {
      exercise_id: 'barbell_bench_press',
      sentiment: 'liked',
      swap_in_count: 3,
      swap_out_count: 1,
      affinity_score: 25.0,
      last_pain_reported_at: '2026-10-20T12:00:00.000Z',
      max_pain_severity: 2,
      pain_joint: 'shoulder',
      updated_at: '2026-10-20T12:00:00.000Z',
    };

    await repo.save(pref);

    expect(mockDb.executedQueries.length).toBe(1);
    expect(mockDb.executedQueries[0].sql).toContain('INSERT INTO exercise_preferences');
    expect(mockDb.executedQueries[0].sql).toContain('ON CONFLICT(exercise_id) DO UPDATE SET');
    expect(mockDb.executedQueries[0].params[0]).toBe('barbell_bench_press');
    expect(mockDb.executedQueries[0].params[1]).toBe('liked');
    expect(mockDb.executedQueries[0].params[2]).toBe(3);
    expect(mockDb.executedQueries[0].params[3]).toBe(1);
    expect(mockDb.executedQueries[0].params[4]).toBe(25.0);
    expect(mockDb.executedQueries[0].params[7]).toBe('shoulder');
  });

  it('retrieves an exercise preference by ID', async () => {
    mockDb.mockData.set('WHERE exercise_id = ?;', [
      {
        exercise_id: 'barbell_squat',
        sentiment: 'disliked',
        swap_in_count: 0,
        swap_out_count: 4,
        affinity_score: -60.0,
        last_pain_reported_at: '2026-10-18T10:00:00Z',
        max_pain_severity: 4,
        pain_joint: 'lower_back',
        updated_at: '2026-10-18T10:00:00Z',
      },
    ]);

    const result = await repo.get('barbell_squat');
    expect(result).not.toBeNull();
    expect(result?.exercise_id).toBe('barbell_squat');
    expect(result?.sentiment).toBe('disliked');
    expect(result?.affinity_score).toBe(-60.0);
    expect(result?.max_pain_severity).toBe(4);
    expect(result?.pain_joint).toBe('lower_back');
  });

  it('retrieves all exercise preferences ordered by exercise_id', async () => {
    mockDb.mockData.set('FROM exercise_preferences ORDER BY exercise_id ASC;', [
      {
        exercise_id: 'barbell_bench_press',
        sentiment: 'liked',
        swap_in_count: 2,
        swap_out_count: 0,
        affinity_score: 25.0,
        last_pain_reported_at: null,
        max_pain_severity: null,
        pain_joint: null,
        updated_at: '2026-10-20T12:00:00Z',
      },
      {
        exercise_id: 'barbell_squat',
        sentiment: 'neutral',
        swap_in_count: 1,
        swap_out_count: 2,
        affinity_score: -5.0,
        last_pain_reported_at: null,
        max_pain_severity: null,
        pain_joint: null,
        updated_at: '2026-10-20T12:00:00Z',
      },
    ]);

    const all = await repo.getAll();
    expect(all.length).toBe(2);
    expect(all[0].exercise_id).toBe('barbell_bench_press');
    expect(all[1].exercise_id).toBe('barbell_squat');
  });

  it('deletes an exercise preference by ID', async () => {
    await repo.delete('barbell_squat');
    expect(mockDb.executedQueries.length).toBe(1);
    expect(mockDb.executedQueries[0].sql).toContain('DELETE FROM exercise_preferences WHERE exercise_id = ?;');
    expect(mockDb.executedQueries[0].params[0]).toBe('barbell_squat');
  });

  it('counts total customized preferences', async () => {
    mockDb.mockData.set('SELECT COUNT(*) as count FROM exercise_preferences;', [
      { count: 7 },
    ]);

    const count = await repo.count();
    expect(count).toBe(7);
  });
});
