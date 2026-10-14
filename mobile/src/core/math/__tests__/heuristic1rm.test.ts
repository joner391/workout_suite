import {
  calculateEffectiveReps,
  isReliable1RMInput,
  calculateLombardi1RM,
  calculateEpley1RM,
  calculateBrzycki1RM,
  calculateHeuristic1RM,
  DEFAULT_LOMBARDI_K,
  DEADLIFT_LINEAR_SCALAR,
} from '../heuristic1rm';

describe('Heuristic 1RM & Repetition Endurance Math', () => {
  describe('calculateEffectiveReps', () => {
    it('should compute effective reps with RIR (5 reps + 2 RIR = 7)', () => {
      expect(calculateEffectiveReps(5, { rir: 2 })).toBe(7);
    });

    it('should compute effective reps with RPE (5 reps + RPE 8 = 7)', () => {
      // 10 - 8 = 2 RIR equivalent -> 5 + 2 = 7
      expect(calculateEffectiveReps(5, { rpe: 8 })).toBe(7);
    });

    it('should handle RPE 10 (0 RIR -> identical to completed reps)', () => {
      expect(calculateEffectiveReps(5, { rpe: 10 })).toBe(5);
    });

    it('should prioritize RIR when both RIR and RPE are supplied', () => {
      expect(calculateEffectiveReps(5, { rir: 1, rpe: 8 })).toBe(6);
    });

    it('should enforce lower bound r_eff >= 1.0 when reps > 0', () => {
      expect(calculateEffectiveReps(1, { rir: 0 })).toBe(1.0);
    });

    it('should return 0 when completed reps <= 0 (failed set edge case)', () => {
      expect(calculateEffectiveReps(0, { rir: 0 })).toBe(0);
      expect(calculateEffectiveReps(0, { rir: 2 })).toBe(0);
      expect(calculateEffectiveReps(-1, { rir: 0 })).toBe(0);
    });
  });

  describe('isReliable1RMInput', () => {
    it('should mark normal working sets (<= 3 RIR, >= 7 RPE, <= 12 reps) as reliable', () => {
      expect(isReliable1RMInput(5, { rir: 1 })).toBe(true);
      expect(isReliable1RMInput(3, { rir: 0 })).toBe(true);
      expect(isReliable1RMInput(6, { rpe: 8.5 })).toBe(true);
      expect(isReliable1RMInput(1, { rpe: 10 })).toBe(true);
      expect(isReliable1RMInput(5, { rir: 3 })).toBe(true);
      expect(isReliable1RMInput(5, { rpe: 7.0 })).toBe(true);
    });

    it('should reject 0 completed reps as unreliable (failed attempt)', () => {
      expect(isReliable1RMInput(0, { rir: 0 })).toBe(false);
      expect(isReliable1RMInput(-1, { rir: 1 })).toBe(false);
    });

    it('should reject sets with RIR > 3 as unreliable subjective signal (edge case)', () => {
      expect(isReliable1RMInput(5, { rir: 3.5 })).toBe(false);
      expect(isReliable1RMInput(5, { rir: 4.0 })).toBe(false);
      expect(isReliable1RMInput(5, { rir: 5.0 })).toBe(false);
    });

    it('should reject sets with RPE < 7.0 as unreliable (equivalent to RIR > 3)', () => {
      expect(isReliable1RMInput(5, { rpe: 6.5 })).toBe(false);
      expect(isReliable1RMInput(5, { rpe: 5.0 })).toBe(false);
    });

    it('should reject sets above maxRepsThreshold (> 12 reps default) due to endurance bias', () => {
      expect(isReliable1RMInput(13, { rir: 1 })).toBe(false);
      expect(isReliable1RMInput(15, { rpe: 9.0 })).toBe(false);
    });
  });

  describe('calculateLombardi1RM', () => {
    it('should return exactly the input load for a true 1RM single (r_eff = 1.0)', () => {
      expect(calculateLombardi1RM(100, 1.0)).toBe(100);
      expect(calculateLombardi1RM(142.5, 1.0)).toBe(142.5);
    });

    it('should accurately calculate Lombardi e1RM with default k = 0.10', () => {
      // 100 * 10^0.10 = 100 * 1.25892541... = 125.8925...
      const e1rm = calculateLombardi1RM(100, 10, DEFAULT_LOMBARDI_K);
      expect(e1rm).toBeCloseTo(125.89, 2);
    });

    it('should support custom calibrated k from Tier 2 Kalman filter (e.g. Deadlift k = 0.075)', () => {
      // Deadlift with lower repetition endurance slope k = 0.075:
      // 100 * 10^0.075 = 100 * 1.18850... = 118.85
      const e1rm = calculateLombardi1RM(100, 10, 0.075);
      expect(e1rm).toBeCloseTo(118.85, 2);
    });

    it('should bound extreme k values within physiological corridor [0.03, 0.16]', () => {
      const e1rmTooLow = calculateLombardi1RM(100, 10, 0.001); // bounded to 0.03
      expect(e1rmTooLow).toBeCloseTo(100 * Math.pow(10, 0.03), 2);

      const e1rmTooHigh = calculateLombardi1RM(100, 10, 0.50); // bounded to 0.16
      expect(e1rmTooHigh).toBeCloseTo(100 * Math.pow(10, 0.16), 2);
    });

    it('should return 0 when weight <= 0 or effective reps <= 0', () => {
      expect(calculateLombardi1RM(0, 5)).toBe(0);
      expect(calculateLombardi1RM(-100, 5)).toBe(0);
      expect(calculateLombardi1RM(100, 0)).toBe(0);
    });
  });

  describe('calculateEpley1RM and calculateBrzycki1RM', () => {
    it('should calculate classic Epley formula: w * (1 + r / 30)', () => {
      // 100 * (1 + 10 / 30) = 133.33 kg
      expect(calculateEpley1RM(100, 10)).toBeCloseTo(133.33, 2);
    });

    it('should calculate classic Brzycki formula: w * (36 / (37 - r))', () => {
      // 100 * (36 / (37 - 10)) = 100 * (36 / 27) = 133.33 kg
      expect(calculateBrzycki1RM(100, 10)).toBeCloseTo(133.33, 2);
    });

    it('should apply +10% deadlift compensatory scalar exclusively to linear models (ADR-026)', () => {
      const baseEpley = calculateEpley1RM(100, 5, false); // 100 * (1 + 5/30) = 116.67
      const deadliftEpley = calculateEpley1RM(100, 5, true);
      expect(deadliftEpley).toBeCloseTo(baseEpley * DEADLIFT_LINEAR_SCALAR, 2);

      const baseBrzycki = calculateBrzycki1RM(100, 5, false);
      const deadliftBrzycki = calculateBrzycki1RM(100, 5, true);
      expect(deadliftBrzycki).toBeCloseTo(baseBrzycki * DEADLIFT_LINEAR_SCALAR, 2);
    });

    it('should clamp Brzycki denominator to prevent division by zero at r >= 36', () => {
      expect(() => calculateBrzycki1RM(100, 36.5)).not.toThrow();
      const clampedResult = calculateBrzycki1RM(100, 40);
      expect(clampedResult).toBeGreaterThan(0);
    });
  });

  describe('calculateHeuristic1RM (Primary Dispatcher & Edge Cases)', () => {
    it('should calculate e1RM with options object', () => {
      // 100 kg, 5 reps @ 2 RIR -> r_eff = 7. 100 * 7^0.10 = 121.48 kg
      const result = calculateHeuristic1RM(100, 5, { rir: 2 });
      expect(result).toBeCloseTo(121.48, 2);
    });

    it('should calculate e1RM with positional parameters', () => {
      const result = calculateHeuristic1RM(100, 5, 2, null, 0.10);
      expect(result).toBeCloseTo(121.48, 2);
    });

    it('should return 0 when completed reps is 0 (failed set edge case)', () => {
      expect(calculateHeuristic1RM(100, 0, { rir: 0 })).toBe(0);
      expect(calculateHeuristic1RM(100, 0, 0, null, 0.10)).toBe(0);
    });

    it('should return 0 when weight is 0 or negative', () => {
      expect(calculateHeuristic1RM(0, 5, { rir: 0 })).toBe(0);
      expect(calculateHeuristic1RM(-50, 5, { rir: 0 })).toBe(0);
    });

    it('should respect strictReliability flag and discard sets with RIR > 3', () => {
      // Non-strict computes estimate anyway for RIR 3.5:
      const nonStrict = calculateHeuristic1RM(100, 5, { rir: 3.5, strictReliability: false });
      expect(nonStrict).toBeGreaterThan(0);

      // Strict returns 0 for RIR > 3:
      const strict = calculateHeuristic1RM(100, 5, { rir: 3.5, strictReliability: true });
      expect(strict).toBe(0);
    });

    it('should discard sets with RPE < 6.0 or RIR > 4.0 from e1RM calculations even in non-strict mode', () => {
      expect(calculateHeuristic1RM(100, 5, { rpe: 5.5 })).toBe(0);
      expect(calculateHeuristic1RM(100, 5, { rpe: 4.0 })).toBe(0);
      expect(calculateHeuristic1RM(100, 5, { rir: 4.5 })).toBe(0);
      expect(calculateHeuristic1RM(100, 5, { rir: 5.0 })).toBe(0);

      // Valid RPE >= 6.0 or RIR <= 4.0 should compute e1RM:
      expect(calculateHeuristic1RM(100, 5, { rpe: 6.0 })).toBeGreaterThan(0);
      expect(calculateHeuristic1RM(100, 5, { rir: 4.0 })).toBeGreaterThan(0);
    });
  });
});
