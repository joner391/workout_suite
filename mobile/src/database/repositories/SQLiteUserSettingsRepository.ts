import {
  IUserSettingsRepository,
  SETTINGS_KEYS,
} from '../../domain/repositories/IUserSettingsRepository';
import { AutoWarmupMode, Gender, IntensityMetric, UserSettings, WeightUnit } from '../../core/types';
import { ISQLiteDatabase } from '../schema';

interface SettingRow {
  key: string;
  value: string;
}

/**
 * Concrete SQLite implementation of IUserSettingsRepository.
 */
export class SQLiteUserSettingsRepository implements IUserSettingsRepository {
  constructor(private readonly db: ISQLiteDatabase) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<SettingRow>(
      'SELECT value FROM user_settings WHERE key = ?;',
      key
    );
    return row ? row.value : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?);',
      key,
      value
    );
  }

  async getAll(): Promise<UserSettings> {
    const rows = await this.db.getAllAsync<SettingRow>(
      'SELECT key, value FROM user_settings;'
    );
    const settings: UserSettings = {};
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    return settings;
  }

  async delete(key: string): Promise<void> {
    await this.db.runAsync('DELETE FROM user_settings WHERE key = ?;', key);
  }

  // ==========================================================================
  // Strongly Typed Convenience Accessors
  // ==========================================================================

  async getUnitSystem(): Promise<WeightUnit> {
    const val = await this.get(SETTINGS_KEYS.UNIT_SYSTEM);
    return val === 'lbs' ? 'lbs' : 'kg';
  }

  async setUnitSystem(unit: WeightUnit): Promise<void> {
    await this.set(SETTINGS_KEYS.UNIT_SYSTEM, unit);
  }

  async getIntensityMetric(): Promise<IntensityMetric> {
    const val = await this.get(SETTINGS_KEYS.INTENSITY_METRIC);
    return val === 'RIR' ? 'RIR' : 'RPE';
  }

  async setIntensityMetric(metric: IntensityMetric): Promise<void> {
    await this.set(SETTINGS_KEYS.INTENSITY_METRIC, metric);
  }

  async getPureUtilityMode(): Promise<boolean> {
    const val = await this.get(SETTINGS_KEYS.PURE_UTILITY_MODE);
    return val === '1' || val === 'true';
  }

  async setPureUtilityMode(enabled: boolean): Promise<void> {
    await this.set(SETTINGS_KEYS.PURE_UTILITY_MODE, enabled ? '1' : '0');
  }

  async getUserGender(): Promise<Gender> {
    const val = await this.get(SETTINGS_KEYS.USER_GENDER);
    return val === 'female' ? 'female' : 'male';
  }

  async setUserGender(gender: Gender): Promise<void> {
    await this.set(SETTINGS_KEYS.USER_GENDER, gender);
  }

  async getUserBodyweight(): Promise<number | null> {
    const val = await this.get(SETTINGS_KEYS.USER_BODYWEIGHT_KG);
    if (!val) return null;
    const num = parseFloat(val);
    return isNaN(num) || num <= 0 ? null : num;
  }

  async setUserBodyweight(weightKg: number | null): Promise<void> {
    if (weightKg === null || weightKg <= 0) {
      await this.delete(SETTINGS_KEYS.USER_BODYWEIGHT_KG);
    } else {
      await this.set(SETTINGS_KEYS.USER_BODYWEIGHT_KG, weightKg.toString());
    }
  }

  async getAutoWarmupMode(): Promise<AutoWarmupMode> {
    const val = await this.get(SETTINGS_KEYS.AUTO_WARMUP_MODE);
    if (val === 'all_exercises' || val === 'off' || val === 'smart_compounds') {
      return val;
    }
    return 'smart_compounds';
  }

  async setAutoWarmupMode(mode: AutoWarmupMode): Promise<void> {
    await this.set(SETTINGS_KEYS.AUTO_WARMUP_MODE, mode);
  }
}

