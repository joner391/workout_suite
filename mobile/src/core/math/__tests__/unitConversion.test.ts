import {
  kgToLbs,
  lbsToKg,
  convertWeight,
  roundToStep,
  formatWeight,
  cmToInches,
  inchesToCm,
  formatLength,
  LBS_PER_KG,
  KG_PER_LB,
} from '../unitConversion';

describe('Unit Conversion & Formatting Utilities', () => {
  describe('kgToLbs and lbsToKg', () => {
    it('should accurately convert 100 kg to lbs', () => {
      const lbs = kgToLbs(100);
      expect(lbs).toBeCloseTo(220.462, 2);
    });

    it('should accurately convert 220.462 lbs back to kg', () => {
      const kg = lbsToKg(220.462262185);
      expect(kg).toBeCloseTo(100.0, 3);
    });

    it('should handle zero correctly', () => {
      expect(kgToLbs(0)).toBe(0);
      expect(lbsToKg(0)).toBe(0);
    });

    it('should handle negative numbers (e.g. assisted weight deltas)', () => {
      const lbs = kgToLbs(-15);
      expect(lbs).toBeCloseTo(-33.069, 2);
      expect(lbsToKg(lbs)).toBeCloseTo(-15.0, 2);
    });

    it('should return 0 for NaN or invalid numbers', () => {
      expect(kgToLbs(NaN)).toBe(0);
      expect(lbsToKg(NaN)).toBe(0);
    });

    it('should satisfy reciprocity invariant (kg -> lbs -> kg)', () => {
      const originalKg = 87.5;
      const convertedLbs = kgToLbs(originalKg);
      const roundTripKg = lbsToKg(convertedLbs);
      expect(roundTripKg).toBeCloseTo(originalKg, 6);
    });
  });

  describe('convertWeight', () => {
    it('should return identical value when fromUnit equals toUnit', () => {
      expect(convertWeight(100, 'kg', 'kg')).toBe(100);
      expect(convertWeight(225, 'lbs', 'lbs')).toBe(225);
    });

    it('should convert kg to lbs and lbs to kg', () => {
      expect(convertWeight(100, 'kg', 'lbs')).toBeCloseTo(220.462, 2);
      expect(convertWeight(220.462262185, 'lbs', 'kg')).toBeCloseTo(100, 3);
    });

    it('should return 0 for NaN input', () => {
      expect(convertWeight(NaN, 'kg', 'lbs')).toBe(0);
    });
  });

  describe('roundToStep', () => {
    it('should round to nearest 0.5 kg step', () => {
      expect(roundToStep(100.2, 0.5)).toBe(100.0);
      expect(roundToStep(100.3, 0.5)).toBe(100.5);
      expect(roundToStep(100.74, 0.5)).toBe(100.5);
      expect(roundToStep(100.76, 0.5)).toBe(101.0);
    });

    it('should round to nearest 2.5 kg step', () => {
      expect(roundToStep(101.2, 2.5)).toBe(100.0);
      expect(roundToStep(101.3, 2.5)).toBe(102.5);
      expect(roundToStep(103.7, 2.5)).toBe(102.5);
      expect(roundToStep(103.8, 2.5)).toBe(105.0);
    });

    it('should round to nearest 1.25 kg step', () => {
      expect(roundToStep(81.2, 1.25)).toBe(81.25);
      expect(roundToStep(80.5, 1.25)).toBe(80.0);
      expect(roundToStep(80.7, 1.25)).toBe(81.25);
    });

    it('should handle zero, negative, and invalid steps', () => {
      expect(roundToStep(50, 0)).toBe(50);
      expect(roundToStep(NaN, 0.5)).toBe(0);
    });
  });

  describe('formatWeight', () => {
    it('should format kg weight with default unit suffix', () => {
      expect(formatWeight(100, 'kg')).toBe('100 kg');
      expect(formatWeight(102.5, 'kg')).toBe('102.5 kg');
    });

    it('should format lbs weight with conversion', () => {
      // 100 kg = 220.462 lbs -> rounds to 220.5 lbs with precision 1
      expect(formatWeight(100, 'lbs')).toBe('220.5 lbs');
    });

    it('should respect showUnit = false', () => {
      expect(formatWeight(100, 'kg', { showUnit: false })).toBe('100');
      expect(formatWeight(102.5, 'kg', { showUnit: false })).toBe('102.5');
    });

    it('should trim trailing zeros when configured', () => {
      expect(formatWeight(80.0, 'kg', { precision: 2, trimTrailingZeros: true })).toBe('80 kg');
      expect(formatWeight(80.5, 'kg', { precision: 2, trimTrailingZeros: true })).toBe('80.5 kg');
      expect(formatWeight(80.25, 'kg', { precision: 2, trimTrailingZeros: true })).toBe('80.25 kg');
    });

    it('should handle negative numbers (e.g. -15 kg assist)', () => {
      expect(formatWeight(-15, 'kg')).toBe('-15 kg');
    });

    it('should safely fallback for NaN', () => {
      expect(formatWeight(NaN, 'kg')).toBe('0 kg');
      expect(formatWeight(NaN, 'lbs', { showUnit: false })).toBe('0');
    });
  });

  describe('cmToInches and inchesToCm', () => {
    it('accurately converts centimeters to inches (e.g. 2.54 cm -> 1 inch)', () => {
      expect(cmToInches(2.54)).toBeCloseTo(1.0, 4);
      expect(cmToInches(80)).toBeCloseTo(31.496, 2);
    });

    it('accurately converts inches to centimeters (e.g. 32 inches -> 81.28 cm)', () => {
      expect(inchesToCm(1.0)).toBeCloseTo(2.54, 4);
      expect(inchesToCm(32)).toBeCloseTo(81.28, 2);
    });

    it('handles zero and NaN safely', () => {
      expect(cmToInches(0)).toBe(0);
      expect(inchesToCm(0)).toBe(0);
      expect(cmToInches(NaN)).toBe(0);
      expect(inchesToCm(NaN)).toBe(0);
    });

    it('satisfies round-trip invariant', () => {
      const orig = 75.5;
      expect(inchesToCm(cmToInches(orig))).toBeCloseTo(orig, 5);
    });
  });

  describe('formatLength', () => {
    it('formats metric length in cm', () => {
      expect(formatLength(82.5, 'kg')).toBe('82.5 cm');
      expect(formatLength(80.0, 'kg')).toBe('80 cm');
    });

    it('formats imperial length in inches when unitSystem is lbs', () => {
      // 81.28 cm = 32 inches
      expect(formatLength(81.28, 'lbs')).toBe('32 in');
    });

    it('respects showUnit = false', () => {
      expect(formatLength(80.0, 'kg', { showUnit: false })).toBe('80');
      expect(formatLength(81.28, 'lbs', { showUnit: false })).toBe('32');
    });

    it('handles fallback for NaN', () => {
      expect(formatLength(NaN, 'kg')).toBe('0 cm');
      expect(formatLength(NaN, 'lbs')).toBe('0 in');
    });
  });
});
