import { SQLiteBodyMetricsRepository } from '../SQLiteBodyMetricsRepository';
import { MockSQLiteDatabase } from '../../__tests__/MockSQLiteDatabase';
import { BodyMetric } from '../../../core/types';

describe('SQLiteBodyMetricsRepository', () => {
  let mockDb: MockSQLiteDatabase;
  let repo: SQLiteBodyMetricsRepository;

  const sampleRow = {
    id: 'bm_1',
    date: '2026-10-01',
    bodyweight: 80.0,
    body_fat_manual: 14.5,
    waist_cm: 82.0,
    neck_cm: 38.0,
    hip_cm: null,
    bicep_cm: 37.0,
    chest_cm: 104.0,
    thigh_cm: 60.0,
    calf_cm: 38.0,
    navy_body_fat: 14.0,
  };

  const sampleMetric: BodyMetric = {
    id: 'bm_1',
    date: '2026-10-01',
    bodyweight: 80.0,
    body_fat_manual: 14.5,
    waist_cm: 82.0,
    neck_cm: 38.0,
    hip_cm: null,
    bicep_cm: 37.0,
    chest_cm: 104.0,
    thigh_cm: 60.0,
    calf_cm: 38.0,
    navy_body_fat: null,
  };

  beforeEach(() => {
    mockDb = new MockSQLiteDatabase();
    repo = new SQLiteBodyMetricsRepository(mockDb);
  });

  it('retrieves all body metrics chronologically with getAll', async () => {
    mockDb.mockData.set('FROM body_metrics ORDER BY date ASC;', [sampleRow]);

    const result = await repo.getAll();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('bm_1');
    expect(result[0].bodyweight).toBe(80.0);
    expect(result[0].navy_body_fat).toBe(14.0);
  });

  it('retrieves single metric by ID with getById', async () => {
    mockDb.mockData.set('FROM body_metrics WHERE id = ?;', [sampleRow]);

    const result = await repo.getById('bm_1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('bm_1');
    expect(result?.waist_cm).toBe(82.0);
  });

  it('retrieves metric by date with getByDate', async () => {
    mockDb.mockData.set('FROM body_metrics WHERE date = ?', [sampleRow]);

    const result = await repo.getByDate('2026-10-01');
    expect(result).not.toBeNull();
    expect(result?.date).toBe('2026-10-01');
  });

  it('retrieves latest metric with getLatest', async () => {
    mockDb.mockData.set('FROM body_metrics ORDER BY date DESC', [sampleRow]);

    const result = await repo.getLatest();
    expect(result).not.toBeNull();
    expect(result?.id).toBe('bm_1');
  });

  it('retrieves metrics in range with getByDateRange', async () => {
    mockDb.mockData.set('FROM body_metrics WHERE date >= ?', [sampleRow]);

    const result = await repo.getByDateRange('2026-10-01', '2026-10-07');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('bm_1');
  });

  it('deletes a metric record with delete', async () => {
    await repo.delete('bm_1');
    const deleteQuery = mockDb.executedQueries.find((q) =>
      q.sql.includes('DELETE FROM body_metrics')
    );
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery?.params).toEqual(['bm_1']);
  });

  it('returns count with count', async () => {
    mockDb.mockData.set('SELECT COUNT(*) as count FROM body_metrics;', [{ count: 5 }]);
    const count = await repo.count();
    expect(count).toBe(5);
  });

  it('saves metric and automatically computes navy_body_fat from user_profiles table', async () => {
    // Mock user_profiles query
    mockDb.mockData.set('FROM user_profiles ORDER BY updated_at DESC LIMIT 1;', [
      { gender: 'male', height_cm: 178 },
    ]);

    const saved = await repo.save(sampleMetric);

    expect(saved.navy_body_fat).toBe(14.0);

    const insertQuery = mockDb.executedQueries.find((q) =>
      q.sql.includes('INSERT OR REPLACE INTO body_metrics')
    );
    expect(insertQuery).toBeDefined();
    // navy_body_fat is the 12th parameter
    expect(insertQuery?.params[11]).toBe(14.0);
  });

  it('saves metric using explicit profileOverride for female Navy body fat computation', async () => {
    const femaleMetric: BodyMetric = {
      id: 'bm_female',
      date: '2026-10-02',
      bodyweight: 60.0,
      body_fat_manual: null,
      waist_cm: 68.0,
      neck_cm: 34.0,
      hip_cm: 92.0,
      bicep_cm: null,
      chest_cm: null,
      thigh_cm: null,
      calf_cm: null,
      navy_body_fat: null,
    };

    const saved = await repo.save(femaleMetric, {
      gender: 'female',
      height_cm: 165,
    });

    expect(saved.navy_body_fat).toBe(21.1);

    const insertQuery = mockDb.executedQueries.find((q) =>
      q.sql.includes('INSERT OR REPLACE INTO body_metrics')
    );
    expect(insertQuery?.params[11]).toBe(21.1);
  });
});
