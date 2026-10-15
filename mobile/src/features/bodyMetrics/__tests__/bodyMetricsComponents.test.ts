/**
 * Workout Suite — Body Metrics & Anthropometry Screen Test Suite
 *
 * Implements Step 5.2 Verification Gate
 * Validates:
 * - Metric logging with canonical cm/kg storage (ADR-008)
 * - Automatic bidirectional conversion between inches/lbs and cm/kg
 * - Real-time Navy DoD body fat estimation (male vs female equations)
 * - 7-day calendar-aware rolling average calculation on bodyweight
 * - Historical log management and entry deletion contract
 */

import {
  MockBodyMetricsRepository,
  MockUserProfileRepository,
  MockUserSettingsRepository,
} from '../../../database/mocks';
import {
  calculateNavyBodyFat,
  calculateBodyweightRollingAverages,
} from '../../../core/math/navyBodyFat';
import {
  inchesToCm,
  cmToInches,
  lbsToKg,
  kgToLbs,
  formatWeight,
  formatLength,
} from '../../../core/math/unitConversion';
import { BodyMetric, UserProfile } from '../../../core/types';

describe('Body Metrics Screen & Anthropometry Management (Step 5.2)', () => {
  let bodyMetricsRepo: MockBodyMetricsRepository;
  let userProfileRepo: MockUserProfileRepository;
  let userSettingsRepo: MockUserSettingsRepository;

  beforeEach(() => {
    userProfileRepo = new MockUserProfileRepository();
    bodyMetricsRepo = new MockBodyMetricsRepository([], userProfileRepo);
    userSettingsRepo = new MockUserSettingsRepository();
  });

  describe('1. Canonical Storage & Unit Conversion (ADR-008)', () => {
    test('converts imperial inputs (lbs, inches) to canonical metric (kg, cm) for storage', async () => {
      // User inputs: 185 lbs bodyweight, 33.5 in waist, 15.5 in neck
      const inputWeightLbs = 185.0;
      const inputWaistIn = 33.5;
      const inputNeckIn = 15.5;

      const canonicalWeightKg = lbsToKg(inputWeightLbs);
      const canonicalWaistCm = inchesToCm(inputWaistIn);
      const canonicalNeckCm = inchesToCm(inputNeckIn);

      const metric: BodyMetric = {
        id: 'metric_1',
        date: '2026-10-15',
        bodyweight: canonicalWeightKg,
        waist_cm: canonicalWaistCm,
        neck_cm: canonicalNeckCm,
        hip_cm: null,
        bicep_cm: null,
        chest_cm: null,
        thigh_cm: null,
        calf_cm: null,
        navy_body_fat: null,
        body_fat_manual: null,
      };

      const saved = await bodyMetricsRepo.save(metric);

      expect(saved.bodyweight).toBeCloseTo(83.91, 1);
      expect(saved.waist_cm).toBeCloseTo(85.09, 1);
      expect(saved.neck_cm).toBeCloseTo(39.37, 1);

      // Verify retrieval and conversion back to imperial display
      const fetched = await bodyMetricsRepo.getById('metric_1');
      expect(fetched).not.toBeNull();
      expect(kgToLbs(fetched!.bodyweight)).toBeCloseTo(185.0, 1);
      expect(cmToInches(fetched!.waist_cm!)).toBeCloseTo(33.5, 1);
      expect(cmToInches(fetched!.neck_cm!)).toBeCloseTo(15.5, 1);
    });

    test('stores metric inputs directly without unnecessary rounding degradation', async () => {
      const metric: BodyMetric = {
        id: 'metric_2',
        date: '2026-10-15',
        bodyweight: 82.5,
        waist_cm: 84.0,
        neck_cm: 38.5,
        hip_cm: null,
        bicep_cm: 37.0,
        chest_cm: 104.0,
        thigh_cm: 61.0,
        calf_cm: 38.0,
        navy_body_fat: null,
        body_fat_manual: null,
      };

      const saved = await bodyMetricsRepo.save(metric);
      expect(saved.bodyweight).toBe(82.5);
      expect(saved.bicep_cm).toBe(37.0);
      expect(saved.chest_cm).toBe(104.0);
    });
  });

  describe('2. Real-Time Navy Body Fat % Computation', () => {
    test('computes male body fat using athlete profile height and input tape measurements', async () => {
      const maleProfile: UserProfile = {
        id: 'profile_m',
        gender: 'male',
        height_cm: 182,
        birthdate: '1992-06-10',
        training_mentality: 'precision',
        training_enjoyment: 'enthusiast',
        intensity_style: 'high_intensity_low_volume',
        primary_goal: 'hypertrophy',
        secondary_goals: [],
        preferred_days_per_week: 4,
        preferred_session_duration_mins: 75,
        equipment_access: 'commercial_gym',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await userProfileRepo.saveProfile(maleProfile);

      // Measurements: waist 86 cm, neck 39 cm
      const bf = calculateNavyBodyFat({
        gender: maleProfile.gender,
        heightCm: maleProfile.height_cm!,
        waistCm: 86,
        neckCm: 39,
      });

      expect(bf).not.toBeNull();
      expect(bf!).toBeGreaterThan(13.0);
      expect(bf!).toBeLessThan(17.0);
    });

    test('computes female body fat using waist, hip, neck, and height', async () => {
      const femaleProfile: UserProfile = {
        id: 'profile_f',
        gender: 'female',
        height_cm: 168,
        birthdate: '1996-03-22',
        training_mentality: 'fury',
        training_enjoyment: 'enthusiast',
        intensity_style: 'volume_accumulation',
        primary_goal: 'hypertrophy',
        secondary_goals: [],
        preferred_days_per_week: 5,
        preferred_session_duration_mins: 60,
        equipment_access: 'commercial_gym',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await userProfileRepo.saveProfile(femaleProfile);

      // Measurements: waist 70 cm, neck 34 cm, hip 98 cm
      const bf = calculateNavyBodyFat({
        gender: femaleProfile.gender,
        heightCm: femaleProfile.height_cm!,
        waistCm: 70,
        neckCm: 34,
        hipCm: 98,
      });

      expect(bf).not.toBeNull();
      expect(bf!).toBeGreaterThan(21.0);
      expect(bf!).toBeLessThan(27.0);
    });

    test('auto-populates navy_body_fat when saving a metric if profile exists', async () => {
      const maleProfile: UserProfile = {
        id: 'profile_m2',
        gender: 'male',
        height_cm: 178,
        birthdate: '1990-01-01',
        training_mentality: 'precision',
        training_enjoyment: 'neutral',
        intensity_style: 'high_intensity_low_volume',
        primary_goal: 'strength',
        secondary_goals: [],
        preferred_days_per_week: 3,
        preferred_session_duration_mins: 60,
        equipment_access: 'garage_gym',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await userProfileRepo.saveProfile(maleProfile);

      const metric: BodyMetric = {
        id: 'metric_auto_bf',
        date: '2026-10-15',
        bodyweight: 80.0,
        waist_cm: 84.0,
        neck_cm: 38.0,
        hip_cm: null,
        bicep_cm: null,
        chest_cm: null,
        thigh_cm: null,
        calf_cm: null,
        navy_body_fat: null, // should be auto-computed by repo
        body_fat_manual: null,
      };

      const created = await bodyMetricsRepo.save(metric);
      expect(created.navy_body_fat).not.toBeNull();
      expect(created.navy_body_fat!).toBeGreaterThan(12.0);
      expect(created.navy_body_fat!).toBeLessThan(18.0);
    });
  });

  describe('3. 7-Day Rolling Average Summary Banner', () => {
    test('computes rolling average and delta for recent metrics', async () => {
      const initialMetrics: BodyMetric[] = [
        {
          id: 'm1',
          date: '2026-10-10',
          bodyweight: 83.0,
          waist_cm: null,
          neck_cm: null,
          hip_cm: null,
          bicep_cm: null,
          chest_cm: null,
          thigh_cm: null,
          calf_cm: null,
          navy_body_fat: null,
          body_fat_manual: null,
        },
        {
          id: 'm2',
          date: '2026-10-11',
          bodyweight: 82.8,
          waist_cm: null,
          neck_cm: null,
          hip_cm: null,
          bicep_cm: null,
          chest_cm: null,
          thigh_cm: null,
          calf_cm: null,
          navy_body_fat: null,
          body_fat_manual: null,
        },
        {
          id: 'm3',
          date: '2026-10-12',
          bodyweight: 82.5,
          waist_cm: null,
          neck_cm: null,
          hip_cm: null,
          bicep_cm: null,
          chest_cm: null,
          thigh_cm: null,
          calf_cm: null,
          navy_body_fat: null,
          body_fat_manual: null,
        },
        {
          id: 'm4',
          date: '2026-10-13',
          bodyweight: 82.2,
          waist_cm: null,
          neck_cm: null,
          hip_cm: null,
          bicep_cm: null,
          chest_cm: null,
          thigh_cm: null,
          calf_cm: null,
          navy_body_fat: null,
          body_fat_manual: null,
        },
      ];

      for (const m of initialMetrics) {
        await bodyMetricsRepo.save(m);
      }

      const all = await bodyMetricsRepo.getAll();
      const weightSeries = all.map((m) => ({
        date: m.date,
        bodyweight: m.bodyweight,
      }));

      const rolling = calculateBodyweightRollingAverages(weightSeries);
      expect(rolling).toHaveLength(4);

      const latest = rolling[rolling.length - 1];
      // Average of [83.0, 82.8, 82.5, 82.2] = 330.5 / 4 = 82.625
      expect(latest.sma7).toBeCloseTo(82.625, 2);
    });
  });

  describe('4. Historical Log Management & Deletion', () => {
    test('deletes an entry by ID and removes it from repository', async () => {
      const metric: BodyMetric = {
        id: 'metric_to_del',
        date: '2026-10-15',
        bodyweight: 81.0,
        waist_cm: null,
        neck_cm: null,
        hip_cm: null,
        bicep_cm: null,
        chest_cm: null,
        thigh_cm: null,
        calf_cm: null,
        navy_body_fat: null,
        body_fat_manual: null,
      };

      await bodyMetricsRepo.save(metric);
      expect(await bodyMetricsRepo.getById('metric_to_del')).not.toBeNull();

      await bodyMetricsRepo.delete('metric_to_del');
      expect(await bodyMetricsRepo.getById('metric_to_del')).toBeNull();
    });
  });
});
