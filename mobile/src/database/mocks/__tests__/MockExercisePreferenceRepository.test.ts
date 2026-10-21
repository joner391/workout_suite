import { MockExercisePreferenceRepository } from '../MockExercisePreferenceRepository';
import { ExercisePreference } from '../../../core/types';

describe('MockExercisePreferenceRepository', () => {
  let repo: MockExercisePreferenceRepository;

  beforeEach(() => {
    repo = new MockExercisePreferenceRepository();
  });

  it('saves, queries, counts, and deletes preferences in memory', async () => {
    const pref1: ExercisePreference = {
      exercise_id: 'barbell_bench_press',
      sentiment: 'liked',
      swap_in_count: 2,
      swap_out_count: 0,
      affinity_score: 25.0,
      last_pain_reported_at: null,
      max_pain_severity: null,
      pain_joint: null,
      updated_at: '2026-10-20T12:00:00Z',
    };

    const pref2: ExercisePreference = {
      exercise_id: 'barbell_squat',
      sentiment: 'blacklisted',
      swap_in_count: 0,
      swap_out_count: 5,
      affinity_score: -999.0,
      last_pain_reported_at: '2026-10-15T12:00:00Z',
      max_pain_severity: 8,
      pain_joint: 'lower_back',
      updated_at: '2026-10-15T12:00:00Z',
    };

    await repo.save(pref1);
    await repo.save(pref2);

    expect(await repo.count()).toBe(2);

    const get1 = await repo.get('barbell_bench_press');
    expect(get1).not.toBeNull();
    expect(get1?.sentiment).toBe('liked');
    expect(get1?.affinity_score).toBe(25.0);

    const all = await repo.getAll();
    expect(all.length).toBe(2);
    expect(all[0].exercise_id).toBe('barbell_bench_press');
    expect(all[1].exercise_id).toBe('barbell_squat');

    await repo.delete('barbell_bench_press');
    expect(await repo.count()).toBe(1);
    expect(await repo.get('barbell_bench_press')).toBeNull();

    repo.clear();
    expect(await repo.count()).toBe(0);
  });
});
