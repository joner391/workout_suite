import { IUserProfileRepository } from '../../domain/repositories/IUserProfileRepository';
import {
  UserProfile,
  Gender,
  TrainingMentality,
  TrainingEnjoyment,
  IntensityStyle,
  PrimaryGoal,
  EquipmentAccess,
  ExperienceLevel,
} from '../../core/types';
import { ISQLiteDatabase } from '../schema';
import { normalizeTrainingGoals } from '../../core/rules/trainingGoals';

interface UserProfileRow {
  id: string;
  gender: Gender;
  birthdate: string | null;
  height_cm: number | null;
  training_mentality?: TrainingMentality;
  training_enjoyment?: TrainingEnjoyment;
  intensity_style?: IntensityStyle;
  primary_goal: PrimaryGoal | 'powerbuilding';
  secondary_goals: string | null;
  preferred_days_per_week: number;
  preferred_session_duration_mins: number;
  equipment_access: EquipmentAccess;
  experience_level?: any;
  pending_meso_mood?: number | boolean;
  has_axial_fatigue_sensitivity?: number | boolean;
  is_caloric_deficit?: number | boolean;
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

  const mentality: TrainingMentality = row.training_mentality ??
    (row.intensity_style === 'high_intensity_low_volume' ? 'fury' :
     row.training_enjoyment === 'minimalist' ? 'get_out' : 'precision');

  return {
    id: row.id,
    gender: row.gender,
    birthdate: row.birthdate != null ? row.birthdate : null,
    height_cm: row.height_cm != null ? Number(row.height_cm) : null,
    training_mentality: mentality,
    training_enjoyment: row.training_enjoyment ?? (mentality === 'get_out' ? 'minimalist' : mentality === 'fury' ? 'enthusiast' : 'neutral'),
    intensity_style: row.intensity_style ?? (mentality === 'fury' ? 'high_intensity_low_volume' : mentality === 'precision' ? 'volume_accumulation' : 'balanced'),
    ...normalizeTrainingGoals(row.primary_goal ?? 'hypertrophy', secondaryGoals),
    preferred_days_per_week: Number(row.preferred_days_per_week ?? 4),
    preferred_session_duration_mins: Number(row.preferred_session_duration_mins ?? 60),
    equipment_access: row.equipment_access ?? 'commercial_gym',
    experience_level: row.experience_level ?? 'intermediate',
    pending_meso_mood: Boolean(row.pending_meso_mood),
    has_axial_fatigue_sensitivity: Boolean(row.has_axial_fatigue_sensitivity),
    is_caloric_deficit: Boolean(row.is_caloric_deficit),
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
    profile = { ...profile, ...normalizeTrainingGoals(profile.primary_goal, profile.secondary_goals) };
    const serializedSecondaryGoals = profile.secondary_goals
      ? JSON.stringify(profile.secondary_goals)
      : null;

    await this.db.runAsync(
      `INSERT OR REPLACE INTO user_profiles (
         id, gender, birthdate, height_cm, training_mentality,
         primary_goal, secondary_goals, preferred_days_per_week,
         preferred_session_duration_mins, equipment_access, experience_level, pending_meso_mood,
         has_axial_fatigue_sensitivity, is_caloric_deficit, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      profile.id,
      profile.gender,
      profile.birthdate,
      profile.height_cm,
      profile.training_mentality,
      profile.primary_goal,
      serializedSecondaryGoals,
      profile.preferred_days_per_week,
      profile.preferred_session_duration_mins,
      profile.equipment_access,
      profile.experience_level ?? 'intermediate',
      profile.pending_meso_mood ? 1 : 0,
      profile.has_axial_fatigue_sensitivity ? 1 : 0,
      profile.is_caloric_deficit ? 1 : 0,
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
