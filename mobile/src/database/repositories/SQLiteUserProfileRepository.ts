import { IUserProfileRepository } from '../../domain/repositories/IUserProfileRepository';
import {
  UserProfile,
  Gender,
  TrainingEnjoyment,
  IntensityStyle,
  PrimaryGoal,
  EquipmentAccess,
} from '../../core/types';
import { ISQLiteDatabase } from '../schema';

interface UserProfileRow {
  id: string;
  gender: Gender;
  birthdate: string | null;
  height_cm: number | null;
  training_enjoyment: TrainingEnjoyment;
  intensity_style: IntensityStyle;
  primary_goal: PrimaryGoal;
  secondary_goals: string | null;
  preferred_days_per_week: number;
  preferred_session_duration_mins: number;
  equipment_access: EquipmentAccess;
  created_at: string;
  updated_at: string;
}

function mapRowToUserProfile(row: UserProfileRow): UserProfile {
  let secondaryGoals: string[] | null = null;
  if (row.secondary_goals) {
    try {
      const parsed = JSON.parse(row.secondary_goals);
      if (Array.isArray(parsed)) {
        secondaryGoals = parsed.map(String);
      }
    } catch {
      secondaryGoals = [row.secondary_goals];
    }
  }

  return {
    id: row.id,
    gender: row.gender,
    birthdate: row.birthdate != null ? row.birthdate : null,
    height_cm: row.height_cm != null ? Number(row.height_cm) : null,
    training_enjoyment: row.training_enjoyment ?? 'neutral',
    intensity_style: row.intensity_style ?? 'balanced',
    primary_goal: row.primary_goal ?? 'hypertrophy',
    secondary_goals: secondaryGoals,
    preferred_days_per_week: Number(row.preferred_days_per_week ?? 4),
    preferred_session_duration_mins: Number(row.preferred_session_duration_mins ?? 60),
    equipment_access: row.equipment_access ?? 'commercial_gym',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Concrete SQLite implementation of IUserProfileRepository using expo-sqlite.
 */
export class SQLiteUserProfileRepository implements IUserProfileRepository {
  constructor(private readonly db: ISQLiteDatabase) {}

  async getProfile(): Promise<UserProfile | null> {
    const row = await this.db.getFirstAsync<UserProfileRow>(
      'SELECT * FROM user_profiles ORDER BY updated_at DESC LIMIT 1;'
    );
    return row ? mapRowToUserProfile(row) : null;
  }

  async findById(id: string): Promise<UserProfile | null> {
    const row = await this.db.getFirstAsync<UserProfileRow>(
      'SELECT * FROM user_profiles WHERE id = ?;',
      id
    );
    return row ? mapRowToUserProfile(row) : null;
  }

  async saveProfile(profile: UserProfile): Promise<UserProfile> {
    const serializedSecondaryGoals = profile.secondary_goals
      ? JSON.stringify(profile.secondary_goals)
      : null;

    await this.db.runAsync(
      `INSERT OR REPLACE INTO user_profiles (
         id, gender, birthdate, height_cm, training_enjoyment, intensity_style,
         primary_goal, secondary_goals, preferred_days_per_week,
         preferred_session_duration_mins, equipment_access, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      profile.id,
      profile.gender,
      profile.birthdate,
      profile.height_cm,
      profile.training_enjoyment,
      profile.intensity_style,
      profile.primary_goal,
      serializedSecondaryGoals,
      profile.preferred_days_per_week,
      profile.preferred_session_duration_mins,
      profile.equipment_access,
      profile.created_at,
      profile.updated_at
    );

    return { ...profile };
  }

  async deleteProfile(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM user_profiles WHERE id = ?;', id);
  }

  async hasProfile(): Promise<boolean> {
    const row = await this.db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM user_profiles;'
    );
    return (row?.count ?? 0) > 0;
  }
}
