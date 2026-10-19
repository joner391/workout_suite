import { SQLiteUserSettingsRepository } from '../SQLiteUserSettingsRepository';
import { MockSQLiteDatabase } from '../../__tests__/MockSQLiteDatabase';
import { SETTINGS_KEYS } from '../../../domain/repositories/IUserSettingsRepository';

describe('SQLiteUserSettingsRepository', () => {
  let mockDb: MockSQLiteDatabase;
  let repo: SQLiteUserSettingsRepository;

  beforeEach(() => {
    mockDb = new MockSQLiteDatabase();
    repo = new SQLiteUserSettingsRepository(mockDb);
  });

  describe('Key-Value Operations', () => {
    it('retrieves setting value by key', async () => {
      mockDb.mockData.set('WHERE key = ?;', [{ key: 'theme', value: 'dark' }]);

      const val = await repo.get('theme');
      expect(val).toBe('dark');
      expect(mockDb.executedQueries[0].params).toEqual(['theme']);
    });

    it('returns null if setting key is not found', async () => {
      const val = await repo.get('unknown');
      expect(val).toBeNull();
    });

    it('sets a setting using INSERT OR REPLACE', async () => {
      await repo.set('unit_system', 'lbs');

      expect(mockDb.executedQueries[0].sql).toContain(
        'INSERT OR REPLACE INTO user_settings'
      );
      expect(mockDb.executedQueries[0].params).toEqual(['unit_system', 'lbs']);
    });

    it('retrieves all settings as key-value dictionary', async () => {
      mockDb.mockData.set('SELECT key, value FROM user_settings;', [
        { key: 'unit_system', value: 'kg' },
        { key: 'intensity_metric', value: 'RPE' },
      ]);

      const all = await repo.getAll();
      expect(all).toEqual({
        unit_system: 'kg',
        intensity_metric: 'RPE',
      });
    });

    it('deletes setting by key', async () => {
      await repo.delete('theme');
      expect(mockDb.executedQueries[0].sql).toBe(
        'DELETE FROM user_settings WHERE key = ?;'
      );
      expect(mockDb.executedQueries[0].params).toEqual(['theme']);
    });
  });

  describe('Strongly Typed Accessors', () => {
    it('retrieves unit system with kg default fallback', async () => {
      // Unset returns kg
      expect(await repo.getUnitSystem()).toBe('kg');

      // Set to lbs returns lbs
      mockDb.mockData.set('WHERE key = ?;', [
        { key: SETTINGS_KEYS.UNIT_SYSTEM, value: 'lbs' },
      ]);
      expect(await repo.getUnitSystem()).toBe('lbs');
    });

    it('sets unit system', async () => {
      await repo.setUnitSystem('lbs');
      expect(mockDb.executedQueries[0].params).toEqual([
        SETTINGS_KEYS.UNIT_SYSTEM,
        'lbs',
      ]);
    });

    it('retrieves intensity metric with RPE default fallback', async () => {
      expect(await repo.getIntensityMetric()).toBe('RPE');

      mockDb.mockData.set('WHERE key = ?;', [
        { key: SETTINGS_KEYS.INTENSITY_METRIC, value: 'RIR' },
      ]);
      expect(await repo.getIntensityMetric()).toBe('RIR');
    });

    it('sets intensity metric', async () => {
      await repo.setIntensityMetric('RIR');
      expect(mockDb.executedQueries[0].params).toEqual([
        SETTINGS_KEYS.INTENSITY_METRIC,
        'RIR',
      ]);
    });

    it('retrieves pure utility mode with false default fallback', async () => {
      expect(await repo.getPureUtilityMode()).toBe(false);

      mockDb.mockData.set('WHERE key = ?;', [
        { key: SETTINGS_KEYS.PURE_UTILITY_MODE, value: '1' },
      ]);
      expect(await repo.getPureUtilityMode()).toBe(true);
    });

    it('sets pure utility mode as 1 or 0 string flag', async () => {
      await repo.setPureUtilityMode(true);
      expect(mockDb.executedQueries[0].params).toEqual([
        SETTINGS_KEYS.PURE_UTILITY_MODE,
        '1',
      ]);

      await repo.setPureUtilityMode(false);
      expect(mockDb.executedQueries[1].params).toEqual([
        SETTINGS_KEYS.PURE_UTILITY_MODE,
        '0',
      ]);
    });

    it('retrieves auto warmup mode with smart_compounds default fallback', async () => {
      expect(await repo.getAutoWarmupMode()).toBe('smart_compounds');

      mockDb.mockData.set('WHERE key = ?;', [
        { key: SETTINGS_KEYS.AUTO_WARMUP_MODE, value: 'all_exercises' },
      ]);
      expect(await repo.getAutoWarmupMode()).toBe('all_exercises');
    });

    it('sets auto warmup mode', async () => {
      await repo.setAutoWarmupMode('off');
      expect(mockDb.executedQueries[0].params).toEqual([
        SETTINGS_KEYS.AUTO_WARMUP_MODE,
        'off',
      ]);
    });
  });
});

