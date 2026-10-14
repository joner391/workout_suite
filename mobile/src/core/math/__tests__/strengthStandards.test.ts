import {
  interpolateStandards,
  calculateContinuousScore,
  calculateDemographicPercentile,
  evaluateStrengthStandard,
  calculateSBDBalanceProfile,
} from '../strengthStandards';
import { DEFAULT_STRENGTH_STANDARDS } from '../../../database/seeds/strengthStandardsSeed';
import { StandardLiftType, Gender } from '../../types';

describe('Allometric Strength Standards & Performance Intelligence Engine', () => {
  describe('Seed Dataset Integrity', () => {
    it('contains complete seeded entries across all lifts and bodyweight brackets', () => {
      // 10 male brackets * 5 lifts = 50, 9 female brackets * 5 lifts = 45 -> 95 total
      expect(DEFAULT_STRENGTH_STANDARDS).toHaveLength(95);
    });

    it('enforces strict tier monotonicity (untrained < novice < intermediate < advanced < elite) for every row', () => {
      for (const row of DEFAULT_STRENGTH_STANDARDS) {
        expect(row.untrained_1rm).toBeGreaterThan(0);
        expect(row.novice_1rm).toBeGreaterThan(row.untrained_1rm);
        expect(row.intermediate_1rm).toBeGreaterThan(row.novice_1rm);
        expect(row.advanced_1rm).toBeGreaterThan(row.intermediate_1rm);
        expect(row.elite_1rm).toBeGreaterThan(row.advanced_1rm);
      }
    });

    it('enforces non-decreasing thresholds across increasing bodyweight brackets', () => {
      const lifts: StandardLiftType[] = ['squat', 'bench', 'deadlift', 'ohp', 'row'];
      const genders: Gender[] = ['male', 'female'];

      for (const gender of genders) {
        for (const lift of lifts) {
          const rows = DEFAULT_STRENGTH_STANDARDS
            .filter((r) => r.gender === gender && r.lift_type === lift)
            .sort((a, b) => a.bodyweight_kg - b.bodyweight_kg);

          for (let i = 0; i < rows.length - 1; i++) {
            const current = rows[i];
            const next = rows[i + 1];
            expect(next.bodyweight_kg).toBeGreaterThan(current.bodyweight_kg);
            expect(next.untrained_1rm).toBeGreaterThanOrEqual(current.untrained_1rm);
            expect(next.novice_1rm).toBeGreaterThanOrEqual(current.novice_1rm);
            expect(next.intermediate_1rm).toBeGreaterThanOrEqual(current.intermediate_1rm);
            expect(next.advanced_1rm).toBeGreaterThanOrEqual(current.advanced_1rm);
            expect(next.elite_1rm).toBeGreaterThanOrEqual(current.elite_1rm);
          }
        }
      }
    });
  });

  describe('Bilinear Interpolation across Bodyweights', () => {
    it('returns exact thresholds when bodyweight matches a discrete bracket', () => {
      // Male 80kg Bench: untrained: 55, novice: 75, intermediate: 105, advanced: 135, elite: 170
      const standards = interpolateStandards({
        liftType: 'bench',
        gender: 'male',
        bodyweightKg: 80,
      });

      expect(standards.untrained).toBe(55.0);
      expect(standards.novice).toBe(75.0);
      expect(standards.intermediate).toBe(105.0);
      expect(standards.advanced).toBe(135.0);
      expect(standards.elite).toBe(170.0);
    });

    it('linearly interpolates intermediate thresholds between brackets', () => {
      // Male 85kg Bench (midpoint between 80kg and 90kg):
      // 80kg: [55, 75, 105, 135, 170]
      // 90kg: [60, 85, 115, 150, 185]
      // 85kg midpoint: [57.5, 80, 110, 142.5, 177.5]
      const standards = interpolateStandards({
        liftType: 'bench',
        gender: 'male',
        bodyweightKg: 85,
      });

      expect(standards.untrained).toBe(57.5);
      expect(standards.novice).toBe(80.0);
      expect(standards.intermediate).toBe(110.0);
      expect(standards.advanced).toBe(142.5);
      expect(standards.elite).toBe(177.5);
    });

    it('clamps to lower bracket when bodyweight is below minimum bracket', () => {
      // Male 40kg (< 50kg) should clamp to 50kg row
      const standards = interpolateStandards({
        liftType: 'squat',
        gender: 'male',
        bodyweightKg: 40,
      });
      const bracket50 = DEFAULT_STRENGTH_STANDARDS.find(
        (r) => r.lift_type === 'squat' && r.gender === 'male' && r.bodyweight_kg === 50
      )!;

      expect(standards.untrained).toBe(bracket50.untrained_1rm);
      expect(standards.elite).toBe(bracket50.elite_1rm);
    });

    it('clamps to upper bracket when bodyweight exceeds maximum bracket', () => {
      // Male 160kg (> 140kg) should clamp to 140kg row
      const standards = interpolateStandards({
        liftType: 'deadlift',
        gender: 'male',
        bodyweightKg: 160,
      });
      const bracket140 = DEFAULT_STRENGTH_STANDARDS.find(
        (r) => r.lift_type === 'deadlift' && r.gender === 'male' && r.bodyweight_kg === 140
      )!;

      expect(standards.untrained).toBe(bracket140.untrained_1rm);
      expect(standards.elite).toBe(bracket140.elite_1rm);
    });
  });

  describe('Continuous Normalized Strength Score (0 - 100+)', () => {
    const mockStandards = {
      untrained: 50.0,
      novice: 70.0,
      intermediate: 100.0,
      advanced: 130.0,
      elite: 160.0,
    };

    it('evaluates zero and sub-untrained loads', () => {
      const zero = calculateContinuousScore(0, mockStandards);
      expect(zero.continuousScore).toBe(0.0);
      expect(zero.tier).toBe('untrained');
      expect(zero.nextTierName).toBe('novice');
      expect(zero.kgNeededForNextTier).toBe(70.0);
      expect(zero.deltaKgToNextTier).toBe(70.0);

      // Halfway to untrained (25kg): score 5.0
      const subUntrained = calculateContinuousScore(25.0, mockStandards);
      expect(subUntrained.continuousScore).toBe(5.0);
      expect(subUntrained.tier).toBe('untrained');
    });

    it('evaluates untrained tier boundaries and interpolation', () => {
      // Exactly untrained benchmark (50kg): score 10.0
      const atUntrained = calculateContinuousScore(50.0, mockStandards);
      expect(atUntrained.continuousScore).toBe(10.0);
      expect(atUntrained.tier).toBe('untrained');
      expect(atUntrained.kgNeededForNextTier).toBe(20.0);

      // Midpoint between untrained (50kg) and novice (70kg) is 60kg: score 15.0
      const midUntrained = calculateContinuousScore(60.0, mockStandards);
      expect(midUntrained.continuousScore).toBe(15.0);
      expect(midUntrained.tier).toBe('untrained');
      expect(midUntrained.kgNeededForNextTier).toBe(10.0);
    });

    it('evaluates novice tier boundaries and interpolation', () => {
      // Exactly novice (70kg): score 20.0
      const atNovice = calculateContinuousScore(70.0, mockStandards);
      expect(atNovice.continuousScore).toBe(20.0);
      expect(atNovice.tier).toBe('novice');
      expect(atNovice.nextTierName).toBe('intermediate');
      expect(atNovice.kgNeededForNextTier).toBe(30.0);

      // Midpoint between novice (70kg) and intermediate (100kg) is 85kg: score 30.0
      const midNovice = calculateContinuousScore(85.0, mockStandards);
      expect(midNovice.continuousScore).toBe(30.0);
      expect(midNovice.tier).toBe('novice');
      expect(midNovice.kgNeededForNextTier).toBe(15.0);
    });

    it('evaluates intermediate tier boundaries and interpolation', () => {
      // Exactly intermediate (100kg): score 40.0
      const atInter = calculateContinuousScore(100.0, mockStandards);
      expect(atInter.continuousScore).toBe(40.0);
      expect(atInter.tier).toBe('intermediate');
      expect(atInter.nextTierName).toBe('advanced');
      expect(atInter.kgNeededForNextTier).toBe(30.0);

      // Midpoint between intermediate (100kg) and advanced (130kg) is 115kg: score 50.0
      const midInter = calculateContinuousScore(115.0, mockStandards);
      expect(midInter.continuousScore).toBe(50.0);
      expect(midInter.tier).toBe('intermediate');
      expect(midInter.kgNeededForNextTier).toBe(15.0);
    });

    it('evaluates advanced tier boundaries and interpolation', () => {
      // Exactly advanced (130kg): score 60.0
      const atAdv = calculateContinuousScore(130.0, mockStandards);
      expect(atAdv.continuousScore).toBe(60.0);
      expect(atAdv.tier).toBe('advanced');
      expect(atAdv.nextTierName).toBe('elite');
      expect(atAdv.kgNeededForNextTier).toBe(30.0);

      // Midpoint between advanced (130kg) and elite (160kg) is 145kg: score 70.0
      const midAdv = calculateContinuousScore(145.0, mockStandards);
      expect(midAdv.continuousScore).toBe(70.0);
      expect(midAdv.tier).toBe('advanced');
      expect(midAdv.kgNeededForNextTier).toBe(15.0);
    });

    it('evaluates elite tier and above-elite uncapped progression', () => {
      // Exactly elite (160kg): score 80.0
      const atElite = calculateContinuousScore(160.0, mockStandards);
      expect(atElite.continuousScore).toBe(80.0);
      expect(atElite.tier).toBe('elite');
      expect(atElite.nextTierName).toBeNull();
      expect(atElite.kgNeededForNextTier).toBe(0);
      expect(atElite.deltaKgToNextTier).toBeNull();

      // One tier gap above elite (160 + 30 = 190kg): score 100.0
      const superElite = calculateContinuousScore(190.0, mockStandards);
      expect(superElite.continuousScore).toBe(100.0);
      expect(superElite.tier).toBe('elite');
      expect(superElite.nextTierName).toBeNull();
    });

    it('preserves strict continuous score monotonicity across all weights', () => {
      let previousScore = -1;
      for (let weight = 0; weight <= 200; weight += 2.5) {
        const result = calculateContinuousScore(weight, mockStandards);
        expect(result.continuousScore).toBeGreaterThanOrEqual(previousScore);
        previousScore = result.continuousScore;
      }
    });
  });

  describe('Demographic Population Percentile Curve', () => {
    it('maps key tier score anchors to accurate population percentiles', () => {
      expect(calculateDemographicPercentile(0.0)).toBe(1.0);
      expect(calculateDemographicPercentile(10.0)).toBe(5.0); // Untrained benchmark
      expect(calculateDemographicPercentile(20.0)).toBe(25.0); // Novice threshold
      expect(calculateDemographicPercentile(40.0)).toBe(50.0); // Intermediate median
      expect(calculateDemographicPercentile(60.0)).toBe(85.0); // Advanced threshold
      expect(calculateDemographicPercentile(80.0)).toBe(97.5); // Elite threshold
      expect(calculateDemographicPercentile(100.0)).toBe(99.9); // Top 0.1%
    });

    it('interpolates intermediate scores smoothly', () => {
      // Midpoint between Novice (20 -> 25%) and Intermediate (40 -> 50%) is 30 -> 37.5%
      expect(calculateDemographicPercentile(30.0)).toBe(37.5);
    });

    it('clamps values below 0 or above 100', () => {
      expect(calculateDemographicPercentile(-10)).toBe(1.0);
      expect(calculateDemographicPercentile(150)).toBe(99.9);
    });
  });

  describe('Comprehensive Exercise Standard Evaluation', () => {
    it('evaluates a real-world male intermediate bench presser', () => {
      // Male 80kg Bencher with e1RM = 105kg
      const evaluation = evaluateStrengthStandard({
        liftType: 'bench',
        gender: 'male',
        bodyweightKg: 80,
        e1rmKg: 105,
      });

      expect(evaluation.tier).toBe('intermediate');
      expect(evaluation.continuousScore).toBe(40.0);
      expect(evaluation.nextTierName).toBe('advanced');
      expect(evaluation.kgNeededForNextTier).toBe(30.0);
      expect(evaluation.demographicPercentile).toBe(50.0);
      expect(evaluation.interpolatedStandards.intermediate).toBe(105.0);
    });

    it('evaluates a female elite squatter', () => {
      // Female 60kg Squatter with e1RM = 125kg (elite is 122.5kg)
      const evaluation = evaluateStrengthStandard({
        liftType: 'squat',
        gender: 'female',
        bodyweightKg: 60,
        e1rmKg: 125,
      });

      expect(evaluation.tier).toBe('elite');
      expect(evaluation.continuousScore).toBeGreaterThan(80.0);
      expect(evaluation.nextTierName).toBeNull();
      expect(evaluation.kgNeededForNextTier).toBe(0);
      expect(evaluation.demographicPercentile).toBeGreaterThanOrEqual(97.5);
    });
  });

  describe('SBD Strength Balance & Symmetry Profiling', () => {
    it('identifies a balanced lifter when all 3 lifts are aligned in tier', () => {
      // Male 80kg lifter: Squat 145kg (score 40), Bench 105kg (score 40), Deadlift 175kg (score 40)
      const profile = calculateSBDBalanceProfile({
        gender: 'male',
        bodyweightKg: 80,
        squatE1rm: 145,
        benchE1rm: 105,
        deadliftE1rm: 175,
      });

      expect(profile.squatScore).toBe(40.0);
      expect(profile.benchScore).toBe(40.0);
      expect(profile.deadliftScore).toBe(40.0);
      expect(profile.averageScore).toBe(40.0);
      expect(profile.totalScore).toBe(120.0);
      expect(profile.dominantLift).toBe('balanced');
      expect(profile.laggingLift).toBe('none');
      expect(profile.totalKg).toBe(425);
      expect(profile.dotsScore).toBeGreaterThan(250);
      expect(profile.radarCoordinates).toEqual({
        squat: 40,
        bench: 40,
        deadlift: 40,
      });
    });

    it('detects squat-dominant and bench-lagging asymmetry', () => {
      // Male 80kg lifter:
      // Squat: 185kg (score 60 - Advanced)
      // Bench: 65kg (score ~15 - Untrained)
      // Deadlift: 175kg (score 40 - Intermediate)
      const profile = calculateSBDBalanceProfile({
        gender: 'male',
        bodyweightKg: 80,
        squatE1rm: 185,
        benchE1rm: 65,
        deadliftE1rm: 175,
      });

      expect(profile.dominantLift).toBe('squat');
      expect(profile.laggingLift).toBe('bench');
      expect(profile.squatScore).toBeGreaterThan(profile.benchScore);
      expect(profile.radarCoordinates.squat).toBe(60);
      expect(profile.radarCoordinates.bench).toBeLessThan(20);
    });
  });
});
