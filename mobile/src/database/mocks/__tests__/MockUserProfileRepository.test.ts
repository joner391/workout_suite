import { MockUserProfileRepository } from '../MockUserProfileRepository';
import { UserProfile } from '../../../core/types';

describe('MockUserProfileRepository', () => {
  let repo: MockUserProfileRepository;

  const sampleProfile: UserProfile = {
    id: 'user_default',
    gender: 'male',
    birthdate: '1995-05-15',
    height_cm: 180,
    training_mentality: 'fury',
    training_enjoyment: 'enthusiast',
    intensity_style: 'high_intensity_low_volume',
    primary_goal: 'hypertrophy',
    secondary_goals: ['strength', 'powerbuilding'],
    preferred_days_per_week: 4,
    preferred_session_duration_mins: 60,
    equipment_access: 'commercial_gym',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  };

  beforeEach(() => {
    repo = new MockUserProfileRepository();
  });

  it('starts empty with hasProfile returning false and getProfile returning null', async () => {
    expect(await repo.hasProfile()).toBe(false);
    expect(await repo.getProfile()).toBeNull();
    expect(await repo.findById('user_default')).toBeNull();
  });

  it('saves and retrieves user profile by ID and getProfile', async () => {
    await repo.saveProfile(sampleProfile);
    expect(await repo.hasProfile()).toBe(true);

    const foundById = await repo.findById(sampleProfile.id);
    expect(foundById).toEqual(sampleProfile);

    const currentProfile = await repo.getProfile();
    expect(currentProfile).toEqual(sampleProfile);
  });

  it('returns the most recently updated profile when multiple exist', async () => {
    await repo.saveProfile(sampleProfile);

    const updatedProfile: UserProfile = {
      ...sampleProfile,
      id: 'user_v2',
      primary_goal: 'strength',
      updated_at: '2026-10-10T12:00:00Z',
    };
    await repo.saveProfile(updatedProfile);

    const currentProfile = await repo.getProfile();
    expect(currentProfile?.id).toBe('user_v2');
    expect(currentProfile?.primary_goal).toBe('strength');
  });

  it('deletes user profile by ID', async () => {
    await repo.saveProfile(sampleProfile);
    expect(await repo.hasProfile()).toBe(true);

    await repo.deleteProfile(sampleProfile.id);
    expect(await repo.hasProfile()).toBe(false);
    expect(await repo.getProfile()).toBeNull();
  });
});
