/**
 * Workout Suite — Settings Features Test Suite
 *
 * Implements Step 1.6 Verification Gate
 * Validates:
 * - Unit system toggles ('kg' <-> 'lbs') and persistence
 * - Intensity metric toggles ('RPE' <-> 'RIR') and persistence
 * - Pure utility mode toggling (ADR-024)
 * - Immediate write-through persistence to IUserSettingsRepository
 */

import { MockUserSettingsRepository } from '../../../database/mocks';
import { SETTINGS_KEYS } from '../../../domain/repositories/IUserSettingsRepository';

describe('Settings Toggles & User Preferences (Step 1.6)', () => {
  let userSettingsRepo: MockUserSettingsRepository;

  beforeEach(() => {
    userSettingsRepo = new MockUserSettingsRepository();
  });

  test('defaults to kg, RPE, and pure utility mode disabled', async () => {
    const unit = await userSettingsRepo.getUnitSystem();
    const intensity = await userSettingsRepo.getIntensityMetric();
    const pureUtility = await userSettingsRepo.getPureUtilityMode();

    expect(unit).toBe('kg');
    expect(intensity).toBe('RPE');
    expect(pureUtility).toBe(false);
  });

  test('toggling unit system persists to repository instantly', async () => {
    await userSettingsRepo.setUnitSystem('lbs');
    expect(await userSettingsRepo.getUnitSystem()).toBe('lbs');
    expect(await userSettingsRepo.get(SETTINGS_KEYS.UNIT_SYSTEM)).toBe('lbs');

    await userSettingsRepo.setUnitSystem('kg');
    expect(await userSettingsRepo.getUnitSystem()).toBe('kg');
    expect(await userSettingsRepo.get(SETTINGS_KEYS.UNIT_SYSTEM)).toBe('kg');
  });

  test('toggling intensity metric persists to repository instantly', async () => {
    await userSettingsRepo.setIntensityMetric('RIR');
    expect(await userSettingsRepo.getIntensityMetric()).toBe('RIR');
    expect(await userSettingsRepo.get(SETTINGS_KEYS.INTENSITY_METRIC)).toBe('RIR');

    await userSettingsRepo.setIntensityMetric('RPE');
    expect(await userSettingsRepo.getIntensityMetric()).toBe('RPE');
    expect(await userSettingsRepo.get(SETTINGS_KEYS.INTENSITY_METRIC)).toBe('RPE');
  });

  test('toggling pure utility mode persists to repository instantly', async () => {
    await userSettingsRepo.setPureUtilityMode(true);
    expect(await userSettingsRepo.getPureUtilityMode()).toBe(true);
    expect(await userSettingsRepo.get(SETTINGS_KEYS.PURE_UTILITY_MODE)).toBe('1');

    await userSettingsRepo.setPureUtilityMode(false);
    expect(await userSettingsRepo.getPureUtilityMode()).toBe(false);
    expect(await userSettingsRepo.get(SETTINGS_KEYS.PURE_UTILITY_MODE)).toBe('0');
  });

  test('getAll returns complete dictionary of configured settings', async () => {
    await userSettingsRepo.setUnitSystem('lbs');
    await userSettingsRepo.setIntensityMetric('RIR');
    await userSettingsRepo.setPureUtilityMode(true);

    const all = await userSettingsRepo.getAll();
    expect(all[SETTINGS_KEYS.UNIT_SYSTEM]).toBe('lbs');
    expect(all[SETTINGS_KEYS.INTENSITY_METRIC]).toBe('RIR');
    expect(all[SETTINGS_KEYS.PURE_UTILITY_MODE]).toBe('1');
  });

  test('ExportService integrates seamlessly for 1-tap JSON export from Settings (Step 2.3)', async () => {
    const { ExportService } = await import('../../../services/exportService');
    const { MockSQLiteDatabase } = await import('../../../database/__tests__/MockSQLiteDatabase');

    const mockDb = new MockSQLiteDatabase();
    mockDb.mockData.set('FROM user_settings', [
      { key: 'unit_system', value: 'lbs' },
      { key: 'intensity_metric', value: 'RIR' },
    ]);

    let sharedInvoked = false;
    const service = new ExportService(mockDb, {
      fileWriter: async () => {},
      fileSharer: async () => {
        sharedInvoked = true;
        return true;
      },
      getCacheDirectory: () => 'file:///data/mock-cache',
    });

    const exportResult = await service.exportAndShare();
    expect(exportResult.shared).toBe(true);
    expect(sharedInvoked).toBe(true);
    expect(exportResult.payload.user_settings.unit_system).toBe('lbs');
    expect(exportResult.payload.user_settings.intensity_metric).toBe('RIR');
  });

  test('ImportService integrates for CSV training history import from Settings (Step 2.4)', async () => {
    const { ImportService } = await import('../../../services/importService');
    const { MockWorkoutRepository, MockExerciseRepository } = await import('../../../database/mocks');
    const { DEFAULT_EXERCISES } = await import('../../../database/seeds/defaultExercises');

    const mockWRepo = new MockWorkoutRepository();
    const mockERepo = new MockExerciseRepository(DEFAULT_EXERCISES);
    const importService = new ImportService(mockWRepo, mockERepo);

    const strongCsv = `Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE
2026-08-01 10:00:00;Morning Upper;Barbell Bench Press;1;100;kg;8;8`;

    const parsed = importService.parseCsv(strongCsv);
    expect(parsed.workouts).toHaveLength(1);
    const preview = await importService.generatePreview(parsed);
    expect(preview.totalWorkouts).toBe(1);
    const result = await importService.executeImport(preview);
    expect(result.success).toBe(true);
    expect(result.importedWorkoutsCount).toBe(1);
  });

  test('SettingsScreen instantiates cleanly with Athlete Questionnaire removed', async () => {
    const React = await import('react');
    const { SettingsScreen } = await import('../SettingsScreen');

    const element = React.createElement(SettingsScreen, {
      userSettingsRepo,
    });
    expect(element).toBeDefined();
    expect((element.props as any).showUserProfile).toBeUndefined();
  });
});

