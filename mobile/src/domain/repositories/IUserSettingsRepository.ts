import { AutoWarmupMode, Gender, IntensityMetric, UserSettings, WeightUnit } from '../../core/types';

/**
 * Well-known settings keys used throughout the mobile application.
 */
export const SETTINGS_KEYS = {
  UNIT_SYSTEM: 'unit_system',
  INTENSITY_METRIC: 'intensity_metric',
  PURE_UTILITY_MODE: 'pure_utility_mode',
  USER_GENDER: 'user_gender',
  USER_BODYWEIGHT_KG: 'user_bodyweight_kg',
  AUTO_WARMUP_MODE: 'auto_warmup_mode',
  SMART_WARMUP: 'smart_warmup',
} as const;

/**
 * Repository interface for managing user preferences and application settings.
 */
export interface IUserSettingsRepository {
  /**
   * Retrieves a setting value by key, or null if unset.
   */
  get(key: string): Promise<string | null>;

  /**
   * Sets or updates a setting key-value pair.
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Retrieves all persisted user settings as a key-value dictionary.
   */
  getAll(): Promise<UserSettings>;

  /**
   * Deletes a setting entry by key.
   */
  delete(key: string): Promise<void>;

  // ==========================================================================
  // Strongly Typed Convenience Accessors
  // ==========================================================================

  /**
   * Retrieves the preferred weight unit system ('kg' or 'lbs'). Defaults to 'kg'.
   */
  getUnitSystem(): Promise<WeightUnit>;

  /**
   * Sets the preferred weight unit system ('kg' or 'lbs').
   */
  setUnitSystem(unit: WeightUnit): Promise<void>;

  /**
   * Retrieves the preferred intensity metric ('RPE' or 'RIR'). Defaults to 'RPE'.
   */
  getIntensityMetric(): Promise<IntensityMetric>;

  /**
   * Sets the preferred intensity metric ('RPE' or 'RIR').
   */
  setIntensityMetric(metric: IntensityMetric): Promise<void>;

  /**
   * Checks whether pure utility mode is enabled (strips gamification/social). Defaults to false.
   */
  getPureUtilityMode(): Promise<boolean>;

  /**
   * Enables or disables pure utility mode.
   */
  setPureUtilityMode(enabled: boolean): Promise<void>;

  /**
   * Retrieves the user's biological gender for strength standard scaling. Defaults to 'male'.
   */
  getUserGender(): Promise<Gender>;

  /**
   * Sets the user's biological gender.
   */
  setUserGender(gender: Gender): Promise<void>;

  /**
   * Retrieves the user's latest logged bodyweight in kg, or null if unset.
   */
  getUserBodyweight(): Promise<number | null>;

  /**
   * Sets the user's bodyweight in kg, or removes it if null.
   */
  setUserBodyweight(weightKg: number | null): Promise<void>;

  /**
   * Retrieves the automated warm-up generation mode ('smart_compounds' | 'all_exercises' | 'off').
   * Defaults to 'smart_compounds'.
   */
  getAutoWarmupMode(): Promise<AutoWarmupMode>;

  /**
   * Sets the automated warm-up generation mode.
   */
  setAutoWarmupMode(mode: AutoWarmupMode): Promise<void>;
}

