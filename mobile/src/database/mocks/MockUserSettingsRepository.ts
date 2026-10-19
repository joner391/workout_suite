import {
  IUserSettingsRepository,
  SETTINGS_KEYS,
} from '../../domain/repositories/IUserSettingsRepository';
import { AutoWarmupMode, Gender, IntensityMetric, UserSettings, WeightUnit } from '../../core/types';

/**
 * In-memory mock implementation of IUserSettingsRepository.
 */
export class MockUserSettingsRepository implements IUserSettingsRepository {
  private settings: Map<string, string> = new Map();

  constructor(initialSettings?: UserSettings) {
    // Seed default baseline settings
    this.settings.set(SETTINGS_KEYS.UNIT_SYSTEM, 'kg');
    this.settings.set(SETTINGS_KEYS.INTENSITY_METRIC, 'RPE');
    this.settings.set(SETTINGS_KEYS.PURE_UTILITY_MODE, '0');
    this.settings.set(SETTINGS_KEYS.AUTO_WARMUP_MODE, 'smart_compounds');

    if (initialSettings) {
      this.seed(initialSettings);
    }
  }

  /**
   * Clears all settings from memory.
   */
  public clear(): void {
    this.settings.clear();
  }

  /**
   * Seeds custom settings into memory.
   */
  public seed(settings: UserSettings): void {
    for (const [key, value] of Object.entries(settings)) {
      this.settings.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.settings.has(key) ? this.settings.get(key)! : null;
  }

  async set(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
  }

  async getAll(): Promise<UserSettings> {
    const result: UserSettings = {};
    for (const [k, v] of this.settings.entries()) {
      result[k] = v;
    }
    return result;
  }

  async delete(key: string): Promise<void> {
    this.settings.delete(key);
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

