import {
  IUserSettingsRepository,
  SETTINGS_KEYS,
} from '../../domain/repositories/IUserSettingsRepository';
import { IntensityMetric, UserSettings, WeightUnit } from '../../core/types';
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
}
