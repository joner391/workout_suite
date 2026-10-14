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
});
