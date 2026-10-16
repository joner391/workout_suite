import { MockPainReportRepository } from '../MockPainReportRepository';

describe('MockPainReportRepository', () => {
  let repo: MockPainReportRepository;

  beforeEach(() => {
    repo = new MockPainReportRepository();
  });

  it('creates, queries, and counts pain reports in memory', async () => {
    const r1 = await repo.create({
      workout_id: 'w_1',
      exercise_id: 'ex_squat',
      pain_type: 'joint',
      severity: 7,
      notes: 'Right knee',
    });

    const r2 = await repo.create({
      workout_id: 'w_1',
      exercise_id: 'ex_bench',
      pain_type: 'muscle',
      severity: 3,
    });

    expect(await repo.count()).toBe(2);

    const byWorkout = await repo.getByWorkoutId('w_1');
    expect(byWorkout.length).toBe(2);

    const byEx = await repo.getByExerciseId('ex_squat');
    expect(byEx.length).toBe(1);
    expect(byEx[0].id).toBe(r1.id);
    expect(byEx[0].severity).toBe(7);

    const byId = await repo.getById(r2.id);
    expect(byId).not.toBeNull();
    expect(byId?.pain_type).toBe('muscle');

    await repo.delete(r1.id);
    expect(await repo.count()).toBe(1);
  });
});
