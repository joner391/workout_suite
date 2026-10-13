import { IntensityMetric, UserSettings, WeightUnit } from '../../core/types';

/**
 * Well-known settings keys used throughout the mobile application.
 */
export const SETTINGS_KEYS = {
  UNIT_SYSTEM: 'unit_system',
  INTENSITY_METRIC: 'intensity_metric',
  PURE_UTILITY_MODE: 'pure_utility_mode',
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
}
