import { SQLiteUserProfileRepository } from '../SQLiteUserProfileRepository';
import { MockSQLiteDatabase } from '../../__tests__/MockSQLiteDatabase';
import { UserProfile } from '../../../core/types';

describe('SQLiteUserProfileRepository', () => {
  let mockDb: MockSQLiteDatabase;
  let repo: SQLiteUserProfileRepository;

  const sampleProfileRow = {
    id: 'user_1',
    gender: 'female',
    birthdate: '1998-03-20',
    height_cm: 168,
    training_mentality: 'get_out',
    training_enjoyment: 'minimalist',
    intensity_style: 'volume_accumulation',
    primary_goal: 'strength',
    secondary_goals: JSON.stringify(['powerbuilding']),
    preferred_days_per_week: 3,
    preferred_session_duration_mins: 45,
    equipment_access: 'garage_gym',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  };

  const sampleProfile: UserProfile = {
    id: 'user_1',
    gender: 'female',
    birthdate: '1998-03-20',
    height_cm: 168,
    training_mentality: 'get_out',
    training_enjoyment: 'minimalist',
    intensity_style: 'volume_accumulation',
    primary_goal: 'strength',
    secondary_goals: ['powerbuilding'],
    preferred_days_per_week: 3,
    preferred_session_duration_mins: 45,
    equipment_access: 'garage_gym',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  };

  beforeEach(() => {
    mockDb = new MockSQLiteDatabase();
    repo = new SQLiteUserProfileRepository(mockDb);
  });

  it('retrieves current profile with getProfile', async () => {
    mockDb.mockData.set('FROM user_profiles ORDER BY updated_at DESC LIMIT 1;', [
      sampleProfileRow,
    ]);

    const result = await repo.getProfile();
    expect(result).not.toBeNull();
    expect(result?.id).toBe('user_1');
    expect(result?.gender).toBe('female');
    expect(result?.secondary_goals).toEqual(['powerbuilding']);
    expect(result?.height_cm).toBe(168);
  });

  it('retrieves profile by id', async () => {
    mockDb.mockData.set('FROM user_profiles WHERE id = ?;', [sampleProfileRow]);

    const result = await repo.findById('user_1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('user_1');
    expect(result?.training_mentality).toBe('get_out');
    expect(result?.training_enjoyment).toBe('minimalist');
  });

  it('returns null if profile not found', async () => {
    const result = await repo.findById('missing');
    expect(result).toBeNull();
  });

  it('saves profile with JSON serialized secondary_goals', async () => {
    await repo.saveProfile(sampleProfile);

    const insertQuery = mockDb.executedQueries.find((q) =>
      q.sql.includes('INSERT OR REPLACE INTO user_profiles')
    );
    expect(insertQuery).toBeDefined();
    expect(insertQuery?.params[0]).toBe('user_1');
    expect(insertQuery?.params[1]).toBe('female');
    expect(insertQuery?.params[6]).toBe(JSON.stringify(['powerbuilding']));
    expect(insertQuery?.params[11]).toBe(0); // pending_meso_mood
    expect(insertQuery?.params[12]).toBe(0); // has_axial_fatigue_sensitivity
    expect(insertQuery?.params[13]).toBe(0); // is_caloric_deficit
  });

  it('deletes profile by id', async () => {
    await repo.deleteProfile('user_1');

    const deleteQuery = mockDb.executedQueries.find((q) =>
      q.sql.includes('DELETE FROM user_profiles WHERE id = ?;')
    );
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery?.params).toEqual(['user_1']);
  });

  it('checks hasProfile correctly', async () => {
    mockDb.mockData.set('SELECT COUNT(*) as count FROM user_profiles;', [
      { count: 1 },
    ]);

    const has = await repo.hasProfile();
    expect(has).toBe(true);
  });
});
