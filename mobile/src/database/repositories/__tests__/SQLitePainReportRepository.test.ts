import { SQLitePainReportRepository } from '../SQLitePainReportRepository';
import { MockSQLiteDatabase } from '../../__tests__/MockSQLiteDatabase';

describe('SQLitePainReportRepository', () => {
  let mockDb: MockSQLiteDatabase;
  let repo: SQLitePainReportRepository;

  beforeEach(() => {
    mockDb = new MockSQLiteDatabase();
    repo = new SQLitePainReportRepository(mockDb);
  });

  it('creates and inserts a pain report', async () => {
    const report = await repo.create({
      workout_id: 'w_1',
      exercise_id: 'ex_bench',
      set_id: 'set_1',
      pain_type: 'joint',
      severity: 7,
      notes: 'Anterior shoulder impingement',
    });

    expect(report.id).toMatch(/^pain_/);
    expect(report.workout_id).toBe('w_1');
    expect(report.exercise_id).toBe('ex_bench');
    expect(report.set_id).toBe('set_1');
    expect(report.pain_type).toBe('joint');
    expect(report.severity).toBe(7);
    expect(report.notes).toBe('Anterior shoulder impingement');
    expect(report.created_at).toBeDefined();

    expect(mockDb.executedQueries[0].sql).toContain('INSERT INTO pain_reports');
    expect(mockDb.executedQueries[0].params[1]).toBe('w_1');
    expect(mockDb.executedQueries[0].params[2]).toBe('ex_bench');
    expect(mockDb.executedQueries[0].params[4]).toBe('joint');
    expect(mockDb.executedQueries[0].params[5]).toBe(7);
  });

  it('finds report by ID', async () => {
    mockDb.mockData.set('WHERE id = ?;', [
      {
        id: 'pain_123',
        workout_id: 'w_1',
        exercise_id: 'ex_squat',
        set_id: null,
        pain_type: 'muscle',
        severity: 5,
        notes: 'Adductor strain',
        created_at: '2026-10-16T12:00:00Z',
      },
    ]);

    const report = await repo.getById('pain_123');
    expect(report).not.toBeNull();
    expect(report?.id).toBe('pain_123');
    expect(report?.pain_type).toBe('muscle');
    expect(report?.severity).toBe(5);
  });

  it('queries reports by workout ID', async () => {
    mockDb.mockData.set('WHERE workout_id = ? ORDER BY created_at ASC;', [
      {
        id: 'pain_1',
        workout_id: 'w_1',
        exercise_id: 'ex_squat',
        set_id: null,
        pain_type: 'joint',
        severity: 8,
        notes: 'Patellar tendon',
        created_at: '2026-10-16T12:00:00Z',
      },
    ]);

    const reports = await repo.getByWorkoutId('w_1');
    expect(reports.length).toBe(1);
    expect(reports[0].id).toBe('pain_1');
    expect(reports[0].severity).toBe(8);
  });

  it('queries reports by exercise ID', async () => {
    mockDb.mockData.set('WHERE exercise_id = ? ORDER BY created_at DESC;', [
      {
        id: 'pain_2',
        workout_id: 'w_2',
        exercise_id: 'ex_bench',
        set_id: null,
        pain_type: 'muscle',
        severity: 4,
        notes: 'Pec minor tightness',
        created_at: '2026-10-16T13:00:00Z',
      },
    ]);

    const reports = await repo.getByExerciseId('ex_bench');
    expect(reports.length).toBe(1);
    expect(reports[0].id).toBe('pain_2');
  });

  it('deletes report by ID', async () => {
    await repo.delete('pain_123');
    expect(mockDb.executedQueries[0].sql).toBe(
      'DELETE FROM pain_reports WHERE id = ?;'
    );
    expect(mockDb.executedQueries[0].params).toEqual(['pain_123']);
  });

  it('counts reports in database', async () => {
    mockDb.mockData.set('SELECT COUNT(*) as count FROM pain_reports;', [
      { count: 3 },
    ]);
    const count = await repo.count();
    expect(count).toBe(3);
  });
});
