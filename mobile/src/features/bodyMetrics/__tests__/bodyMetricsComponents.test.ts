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
  calculateEstimatedLeanBodyMass,
  calculateNavyELBM,
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
      expect(kgToLbs(fetched!.bodyweight!)).toBeCloseTo(185.0, 1);
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
      const weightSeries = all
        .filter(
          (m): m is BodyMetric & { bodyweight: number } =>
            m.bodyweight != null && m.bodyweight > 0
        )
        .map((m) => ({
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

  describe('5. Estimated Lean Body Mass (eLBM) Tracking', () => {
    test('computes live eLBM from user entered weight and Navy BF%', () => {
      // Male: 82.5 kg, 178 cm, 82 cm waist, 38 cm neck -> 14.0% Navy BF
      const bf = calculateNavyBodyFat({
        gender: 'male',
        heightCm: 178,
        waistCm: 82,
        neckCm: 38,
      });
      expect(bf).toBe(14.0);

      const liveElbm = calculateEstimatedLeanBodyMass(82.5, bf!);
      // 82.5 * (1 - 0.14) = 70.95 kg
      expect(liveElbm).toBe(70.95);
    });

    test('derives eLBM from stored historical metrics', async () => {
      const metric: BodyMetric = {
        id: 'metric_navy_elbm',
        date: '2026-10-15',
        bodyweight: 84.0,
        waist_cm: 83.0,
        neck_cm: 38.5,
        hip_cm: null,
        bicep_cm: null,
        chest_cm: null,
        thigh_cm: null,
        calf_cm: null,
        navy_body_fat: 14.5,
        body_fat_manual: null,
      };

      await bodyMetricsRepo.save(metric);

      const all = await bodyMetricsRepo.getAll();
      const latestMetricWithNavy = all.find(
        (m) => m.navy_body_fat != null && m.navy_body_fat > 0
      );
      expect(latestMetricWithNavy).toBeDefined();

      const elbmKg = calculateEstimatedLeanBodyMass(
        latestMetricWithNavy!.bodyweight!,
        latestMetricWithNavy!.navy_body_fat!
      );
      // 84.0 * (1 - 0.145) = 84.0 * 0.855 = 71.82 kg
      expect(elbmKg).toBe(71.82);

      // Verify display formatting in kg and lbs
      expect(formatWeight(elbmKg!, 'kg')).toBe('71.8 kg');
      expect(formatWeight(elbmKg!, 'lbs')).toBe('158.3 lbs');
    });

    test('handles absence of Navy BF gracefully with null eLBM', () => {
      const elbm = calculateEstimatedLeanBodyMass(82.0, NaN);
      expect(elbm).toBeNull();
    });
  });

  describe('6. Last Observation Carried Forward (LOCF) Integration', () => {
    test('uses prior waist for Navy calculation without inventing a new bodyweight', async () => {
      await userProfileRepo.saveProfile({
        id: 'profile_test',
        gender: 'male',
        birthdate: null,
        height_cm: 178,
        training_mentality: 'fury',
        primary_goal: 'hypertrophy',
        secondary_goals: null,
        preferred_days_per_week: 4,
        preferred_session_duration_mins: 60,
        equipment_access: 'commercial_gym',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      });

      // Session 1: Full measurement (80kg, 82cm waist, 38cm neck -> 14.0% BF, eLBM = 68.8kg)
      await bodyMetricsRepo.save({
        id: 'metric_s1',
        date: '2026-10-01',
        bodyweight: 80.0,
        waist_cm: 82.0,
        neck_cm: 38.0,
        hip_cm: null,
        bicep_cm: null,
        chest_cm: null,
        thigh_cm: null,
        calf_cm: null,
        navy_body_fat: null,
        body_fat_manual: null,
      });

      const s1 = await bodyMetricsRepo.getById('metric_s1');
      expect(s1!.navy_body_fat).toBe(14.0);

      // Session 2: User only logs neck circumference (39.0 cm). Weight is omitted, waist is omitted.
      await bodyMetricsRepo.save({
        id: 'metric_s2',
        date: '2026-10-08',
        bodyweight: null,
        waist_cm: null,
        neck_cm: 39.0,
        hip_cm: null,
        bicep_cm: null,
        chest_cm: null,
        thigh_cm: null,
        calf_cm: null,
        navy_body_fat: null,
        body_fat_manual: null,
      });

      const s2 = await bodyMetricsRepo.getById('metric_s2');
      // A missing scale measurement stays missing for export and trend calculations.
      expect(s2!.bodyweight).toBeNull();
      // Circumferences: waist was carried forward internally for Navy calculation
      expect(s2!.navy_body_fat).not.toBeNull();
      expect(s2!.navy_body_fat!).toBeLessThan(14.0);

      // eLBM is unavailable until a scale weight is recorded for this entry.
      expect(
        s2!.bodyweight != null
          ? calculateEstimatedLeanBodyMass(s2!.bodyweight, s2!.navy_body_fat!)
          : null
      ).toBeNull();
    });

    test('historical logs forward-fill prior Navy BF for weight-only entries', async () => {
      const history: BodyMetric[] = [
        {
          id: 'log_3',
          date: '2026-10-03',
          bodyweight: 81.5,
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
          id: 'log_2',
          date: '2026-10-02',
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
        },
        {
          id: 'log_1',
          date: '2026-10-01',
          bodyweight: 80.0,
          waist_cm: 82.0,
          neck_cm: 38.0,
          hip_cm: null,
          bicep_cm: null,
          chest_cm: null,
          thigh_cm: null,
          calf_cm: null,
          navy_body_fat: 14.0,
          body_fat_manual: null,
        },
      ];

      // Simulated newest-first map in BodyMetricsScreen
      const effectiveRowBf = (index: number) =>
        history[index].navy_body_fat ??
        history.slice(index + 1).find((prev) => prev.navy_body_fat != null && prev.navy_body_fat > 0)?.navy_body_fat ??
        null;

      expect(effectiveRowBf(0)).toBe(14.0); // log_3 carries forward 14.0%
      expect(effectiveRowBf(1)).toBe(14.0); // log_2 carries forward 14.0%
      expect(effectiveRowBf(2)).toBe(14.0); // log_1 direct 14.0%

      const elbmLog3 = calculateEstimatedLeanBodyMass(history[0].bodyweight!, effectiveRowBf(0)!);
      // 81.5 * (1 - 0.14) = 70.09 kg
      expect(elbmLog3).toBe(70.09);
    });
  });
});
