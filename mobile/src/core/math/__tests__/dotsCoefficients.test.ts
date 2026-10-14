import {
  calculateDotsPolynomial,
  calculateDotsScore,
  calculateDots,
  calculateSBDTotal,
  DOTS_MALE_COEFFICIENTS,
  DOTS_FEMALE_COEFFICIENTS,
} from '../dotsCoefficients';

describe('Powerlifting DOTS Coefficient Math Engine', () => {
  describe('Polynomial & Coefficients Verification', () => {
    it('defines official male polynomial coefficients', () => {
      expect(DOTS_MALE_COEFFICIENTS.a).toBeCloseTo(-0.000001093, 10);
      expect(DOTS_MALE_COEFFICIENTS.b).toBeCloseTo(0.0007391293, 10);
      expect(DOTS_MALE_COEFFICIENTS.c).toBeCloseTo(-0.1918759221, 10);
      expect(DOTS_MALE_COEFFICIENTS.d).toBeCloseTo(24.0900756, 7);
      expect(DOTS_MALE_COEFFICIENTS.e).toBeCloseTo(-307.75076, 5);
    });

    it('defines official female polynomial coefficients', () => {
      expect(DOTS_FEMALE_COEFFICIENTS.a).toBeCloseTo(-0.0000010706, 10);
      expect(DOTS_FEMALE_COEFFICIENTS.b).toBeCloseTo(0.0005158568, 10);
      expect(DOTS_FEMALE_COEFFICIENTS.c).toBeCloseTo(-0.1126655495, 10);
      expect(DOTS_FEMALE_COEFFICIENTS.d).toBeCloseTo(13.6175032, 7);
      expect(DOTS_FEMALE_COEFFICIENTS.e).toBeCloseTo(-57.96288, 5);
    });

    it('evaluates denominator polynomial for known bodyweights', () => {
      // Male 80kg: P(80) ≈ 725.1143
      const male80 = calculateDotsPolynomial('male', 80);
      expect(male80).toBeCloseTo(725.1143, 2);

      // Male 100kg: P(100) ≈ 812.3269
      const male100 = calculateDotsPolynomial('male', 100);
      expect(male100).toBeCloseTo(812.3269, 2);

      // Female 60kg: P(60) ≈ 451.0414
      const female60 = calculateDotsPolynomial('female', 60);
      expect(female60).toBeCloseTo(451.0414, 2);
    });
  });

  describe('Official Powerlifting Benchmark Verification', () => {
    it('matches benchmark for Male 80kg lifter lifting 600kg total', () => {
      // 600 * 500 / 725.1143 ≈ 413.73
      const dots = calculateDotsScore('male', 80, 600);
      expect(dots).toBe(413.73);
    });

    it('matches benchmark for Male 100kg lifter lifting 700kg total', () => {
      // 700 * 500 / 812.3269 ≈ 430.86
      const dots = calculateDotsScore('male', 100, 700);
      expect(dots).toBe(430.86);
    });

    it('matches benchmark for Female 60kg lifter lifting 350kg total', () => {
      // 350 * 500 / 451.0414 ≈ 387.99
      const dots = calculateDotsScore('female', 60, 350);
      expect(dots).toBe(387.99);
    });

    it('matches benchmark for Female 75kg lifter lifting 400kg total', () => {
      // 400 * 500 / 513.3663 ≈ 389.59
      const dots = calculateDotsScore('female', 75, 400);
      expect(dots).toBe(389.59);
    });
  });

  describe('Edge Cases and Guardrails', () => {
    it('returns 0 when total is 0 or negative', () => {
      expect(calculateDotsScore('male', 80, 0)).toBe(0);
      expect(calculateDotsScore('male', 80, -500)).toBe(0);
      expect(calculateDotsScore('female', 60, 0)).toBe(0);
    });

    it('returns 0 when bodyweight is 0 or negative', () => {
      expect(calculateDotsScore('male', 0, 500)).toBe(0);
      expect(calculateDotsScore('male', -80, 500)).toBe(0);
      expect(calculateDotsPolynomial('male', 0)).toBe(0);
      expect(calculateDotsPolynomial('male', -10)).toBe(0);
    });

    it('populates structured DotsResult via calculateDots wrapper', () => {
      const res = calculateDots({
        gender: 'male',
        bodyweightKg: 85,
        totalKg: 550,
      });

      expect(res.gender).toBe('male');
      expect(res.bodyweightKg).toBe(85);
      expect(res.totalKg).toBe(550);
      expect(res.score).toBeGreaterThan(300);
      expect(res.score).toBeLessThan(450);
    });
  });

  describe('SBD Total Aggregation', () => {
    it('accurately sums squat, bench press, and deadlift in kg', () => {
      const total = calculateSBDTotal(180, 120, 220);
      expect(total).toBe(520);
    });

    it('handles decimal loads gracefully', () => {
      const total = calculateSBDTotal(182.5, 122.5, 235.0);
      expect(total).toBe(540);
    });

    it('clamps negative inputs to zero', () => {
      const total = calculateSBDTotal(-100, 100, 200);
      expect(total).toBe(300);
    });
  });
});
