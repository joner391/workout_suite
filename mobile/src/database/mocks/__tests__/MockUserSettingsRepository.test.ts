import { MockUserSettingsRepository } from '../MockUserSettingsRepository';
import { SETTINGS_KEYS } from '../../../domain/repositories/IUserSettingsRepository';

describe('MockUserSettingsRepository', () => {
  let repo: MockUserSettingsRepository;

  beforeEach(() => {
    repo = new MockUserSettingsRepository();
  });

  describe('Default Baseline Settings', () => {
    it('initializes with default settings (kg, RPE, utility mode disabled)', async () => {
      const unit = await repo.getUnitSystem();
      expect(unit).toBe('kg');

      const metric = await repo.getIntensityMetric();
      expect(metric).toBe('RPE');

      const utilityMode = await repo.getPureUtilityMode();
      expect(utilityMode).toBe(false);
    });

    it('returns default dictionary on getAll()', async () => {
      const all = await repo.getAll();
      expect(all).toEqual({
        [SETTINGS_KEYS.UNIT_SYSTEM]: 'kg',
        [SETTINGS_KEYS.INTENSITY_METRIC]: 'RPE',
        [SETTINGS_KEYS.PURE_UTILITY_MODE]: '0',
      });
    });
  });

  describe('Raw Key-Value Operations', () => {
    it('sets and gets custom settings', async () => {
      await repo.set('custom_theme', 'oled_black');
      const val = await repo.get('custom_theme');
      expect(val).toBe('oled_black');
    });

    it('returns null for non-existent setting key', async () => {
      const val = await repo.get('unknown_key');
      expect(val).toBeNull();
    });

    it('deletes a setting by key', async () => {
      await repo.set('temp_key', 'temp_value');
      expect(await repo.get('temp_key')).toBe('temp_value');

      await repo.delete('temp_key');
      expect(await repo.get('temp_key')).toBeNull();
    });
  });

  describe('Strongly Typed Accessors', () => {
    it('updates and retrieves unit system', async () => {
      await repo.setUnitSystem('lbs');
      expect(await repo.getUnitSystem()).toBe('lbs');
      expect(await repo.get(SETTINGS_KEYS.UNIT_SYSTEM)).toBe('lbs');

      await repo.setUnitSystem('kg');
      expect(await repo.getUnitSystem()).toBe('kg');
    });

    it('updates and retrieves intensity metric', async () => {
      await repo.setIntensityMetric('RIR');
      expect(await repo.getIntensityMetric()).toBe('RIR');
      expect(await repo.get(SETTINGS_KEYS.INTENSITY_METRIC)).toBe('RIR');

      await repo.setIntensityMetric('RPE');
      expect(await repo.getIntensityMetric()).toBe('RPE');
    });

    it('updates and retrieves pure utility mode', async () => {
      await repo.setPureUtilityMode(true);
      expect(await repo.getPureUtilityMode()).toBe(true);
      expect(await repo.get(SETTINGS_KEYS.PURE_UTILITY_MODE)).toBe('1');

      await repo.setPureUtilityMode(false);
      expect(await repo.getPureUtilityMode()).toBe(false);
      expect(await repo.get(SETTINGS_KEYS.PURE_UTILITY_MODE)).toBe('0');
    });
  });

  describe('Seed and Clear Helpers', () => {
    it('seeds custom settings overriding defaults', async () => {
      repo.seed({
        [SETTINGS_KEYS.UNIT_SYSTEM]: 'lbs',
        [SETTINGS_KEYS.INTENSITY_METRIC]: 'RIR',
        [SETTINGS_KEYS.PURE_UTILITY_MODE]: '1',
        user_id: 'user_123',
      });

      expect(await repo.getUnitSystem()).toBe('lbs');
      expect(await repo.getIntensityMetric()).toBe('RIR');
      expect(await repo.getPureUtilityMode()).toBe(true);
      expect(await repo.get('user_id')).toBe('user_123');
    });

    it('clears all settings via clear()', async () => {
      repo.clear();
      const all = await repo.getAll();
      expect(all).toEqual({});
      expect(await repo.get(SETTINGS_KEYS.UNIT_SYSTEM)).toBeNull();
    });
  });
});
