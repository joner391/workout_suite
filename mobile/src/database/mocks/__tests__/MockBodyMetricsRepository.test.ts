import { MockBodyMetricsRepository } from '../MockBodyMetricsRepository';
import { MockUserProfileRepository } from '../MockUserProfileRepository';
import { BodyMetric, UserProfile } from '../../../core/types';

describe('MockBodyMetricsRepository', () => {
  let repo: MockBodyMetricsRepository;
  let userProfileRepo: MockUserProfileRepository;

  const sampleMetric1: BodyMetric = {
    id: 'bm_1',
    date: '2026-10-01',
    bodyweight: 80.0,
    body_fat_manual: 15.0,
    waist_cm: 82.0,
    neck_cm: 38.0,
    hip_cm: null,
    bicep_cm: 37.0,
    chest_cm: 104.0,
    thigh_cm: 60.0,
    calf_cm: 38.0,
    navy_body_fat: null,
  };

  const sampleMetric2: BodyMetric = {
    id: 'bm_2',
    date: '2026-10-05',
    bodyweight: 80.5,
    body_fat_manual: null,
    waist_cm: 82.5,
    neck_cm: 38.0,
    hip_cm: null,
    bicep_cm: null,
    chest_cm: null,
    thigh_cm: null,
    calf_cm: null,
    navy_body_fat: null,
  };

  beforeEach(() => {
    userProfileRepo = new MockUserProfileRepository();
    repo = new MockBodyMetricsRepository([], userProfileRepo);
  });

  it('performs basic CRUD operations', async () => {
    expect(await repo.count()).toBe(0);

    const saved = await repo.save(sampleMetric1);
    expect(saved.id).toBe('bm_1');
    expect(await repo.count()).toBe(1);

    const retrieved = await repo.getById('bm_1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.bodyweight).toBe(80.0);

    const byDate = await repo.getByDate('2026-10-01');
    expect(byDate?.id).toBe('bm_1');

    await repo.delete('bm_1');
    expect(await repo.count()).toBe(0);
    expect(await repo.getById('bm_1')).toBeNull();
  });

  it('retrieves entries chronologically and by date range', async () => {
    await repo.save(sampleMetric2);
    await repo.save(sampleMetric1);

    const all = await repo.getAll();
    expect(all.length).toBe(2);
    expect(all[0].date).toBe('2026-10-01');
    expect(all[1].date).toBe('2026-10-05');

    const latest = await repo.getLatest();
    expect(latest?.id).toBe('bm_2');

    const range = await repo.getByDateRange('2026-10-01', '2026-10-03');
    expect(range.length).toBe(1);
    expect(range[0].id).toBe('bm_1');
  });

  it('automatically calculates navy_body_fat from profileOverride', async () => {
    const saved = await repo.save(sampleMetric1, {
      gender: 'male',
      height_cm: 178,
    });

    expect(saved.navy_body_fat).toBe(14.0);
  });

  it('automatically calculates navy_body_fat from injected userProfileRepo', async () => {
    const femaleProfile: UserProfile = {
      id: 'usr_f',
      gender: 'female',
      birthdate: '1995-05-10',
      height_cm: 165,
      training_mentality: 'precision',
      primary_goal: 'hypertrophy',
      secondary_goals: null,
      preferred_days_per_week: 4,
      preferred_session_duration_mins: 60,
      equipment_access: 'commercial_gym',
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-01T10:00:00Z',
    };
    await userProfileRepo.saveProfile(femaleProfile);

    const femaleMetric: BodyMetric = {
      id: 'bm_female',
      date: '2026-10-10',
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

    const saved = await repo.save(femaleMetric);
    expect(saved.navy_body_fat).toBe(21.1);
  });

  it('preserves existing navy_body_fat if already specified', async () => {
    const explicitMetric: BodyMetric = {
      ...sampleMetric1,
      id: 'bm_explicit',
      navy_body_fat: 12.5,
    };

    const saved = await repo.save(explicitMetric, {
      gender: 'male',
      height_cm: 178,
    });

    expect(saved.navy_body_fat).toBe(12.5);
  });
});
