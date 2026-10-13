import {
  calculatePlateLoading,
  formatPlatesSummary,
  groupPlatesByCount,
  DEFAULT_BAR_TARE_KG,
  DEFAULT_PLATE_DENOMINATIONS_KG,
} from '../plateCalculator';

describe('Barbell Plate Loading Calculator', () => {
  describe('Standard Barbell Loading (20 kg Olympic Bar)', () => {
    it('should solve 100 kg target on 20 kg bar with standard plates', () => {
      // 100 kg target - 20 kg bar = 80 kg -> 40 kg per side -> [25, 15]
      const result = calculatePlateLoading(100);

      expect(result.targetWeightKg).toBe(100);
      expect(result.barTareKg).toBe(DEFAULT_BAR_TARE_KG);
      expect(result.weightPerSideKg).toBe(40);
      expect(result.platesPerSide).toEqual([25, 15]);
      expect(result.remainderKg).toBe(0);
    });

    it('should solve 60 kg target on 20 kg bar (one 20 kg plate per side)', () => {
      const result = calculatePlateLoading(60);

      expect(result.weightPerSideKg).toBe(20);
      expect(result.platesPerSide).toEqual([20]);
      expect(result.remainderKg).toBe(0);
    });

    it('should solve 142.5 kg target on 20 kg bar', () => {
      // 142.5 - 20 = 122.5 -> 61.25 per side -> [25, 25, 10, 1.25]
      const result = calculatePlateLoading(142.5);

      expect(result.weightPerSideKg).toBe(61.25);
      expect(result.platesPerSide).toEqual([25, 25, 10, 1.25]);
      expect(result.remainderKg).toBe(0);
    });
  });

  describe('Odd Plate Remainders & Unresolvable Targets (Edge Cases)', () => {
    it('should accurately calculate unresolvable odd remainder for 101.5 kg target', () => {
      // 101.5 - 20 = 81.5 -> 40.75 per side
      // Standard plates: 25 + 15 = 40 kg. Remaining 0.75 kg per side cannot be resolved
      // (smallest plate is 1.25 kg). Total remainder across bar = 1.5 kg.
      const result = calculatePlateLoading(101.5);

      expect(result.platesPerSide).toEqual([25, 15]);
      expect(result.weightPerSideKg).toBe(40);
      expect(result.remainderKg).toBe(1.5);
    });

    it('should report remainder when target is just above bar tare but below 2x smallest plate', () => {
      // 21 kg target on 20 kg bar -> 1 kg needed -> 0.5 kg per side.
      // Smallest plate is 1.25 kg. Cannot load. Remainder = 1.0 kg.
      const result = calculatePlateLoading(21);

      expect(result.platesPerSide).toEqual([]);
      expect(result.weightPerSideKg).toBe(0);
      expect(result.remainderKg).toBe(1.0);
    });
  });

  describe('Empty Bar & Target Below Bar Tare', () => {
    it('should return empty plates with 0 remainder when target exactly matches bar tare (20 kg)', () => {
      const result = calculatePlateLoading(20);

      expect(result.platesPerSide).toEqual([]);
      expect(result.weightPerSideKg).toBe(0);
      expect(result.remainderKg).toBe(0);
    });

    it('should return negative remainder when target is less than empty bar tare (15 kg on 20 kg bar)', () => {
      const result = calculatePlateLoading(15);

      expect(result.platesPerSide).toEqual([]);
      expect(result.weightPerSideKg).toBe(0);
      expect(result.remainderKg).toBe(-5.0); // Bar alone is 5 kg too heavy
    });

    it('should handle zero target weight gracefully', () => {
      const result = calculatePlateLoading(0);

      expect(result.platesPerSide).toEqual([]);
      expect(result.remainderKg).toBe(0);
    });
  });

  describe('Specialty Barbells & Custom Tare Weights (ADR-025)', () => {
    it('should calculate plate loading on a 29 kg Safety Squat Bar (SSB)', () => {
      // Target 109 kg on 29 kg bar -> 80 kg plates -> 40 per side -> [25, 15]
      const result = calculatePlateLoading(109, { barTareKg: 29.0 });

      expect(result.barTareKg).toBe(29.0);
      expect(result.weightPerSideKg).toBe(40);
      expect(result.platesPerSide).toEqual([25, 15]);
      expect(result.remainderKg).toBe(0);
    });

    it('should calculate plate loading on a 25 kg Trap Bar', () => {
      // Target 145 kg on 25 kg bar -> 120 kg plates -> 60 per side -> [25, 25, 10]
      const result = calculatePlateLoading(145, { barTareKg: 25.0 });

      expect(result.barTareKg).toBe(25.0);
      expect(result.weightPerSideKg).toBe(60);
      expect(result.platesPerSide).toEqual([25, 25, 10]);
      expect(result.remainderKg).toBe(0);
    });

    it('should calculate plate loading on a 15 kg Women’s / Technique Bar', () => {
      // Target 75 kg on 15 kg bar -> 60 kg plates -> 30 per side -> [25, 5]
      const result = calculatePlateLoading(75, { barTareKg: 15.0 });

      expect(result.barTareKg).toBe(15.0);
      expect(result.weightPerSideKg).toBe(30);
      expect(result.platesPerSide).toEqual([25, 5]);
      expect(result.remainderKg).toBe(0);
    });
  });

  describe('Custom Plate Denominations (Microplates)', () => {
    it('should resolve odd weights when 0.5 kg and 0.25 kg microplates are available', () => {
      const microplates = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5, 0.25];
      // Target 101.5 kg -> 40.75 per side -> [25, 15, 0.5, 0.25]
      const result = calculatePlateLoading(101.5, { availablePlatesKg: microplates });

      expect(result.platesPerSide).toEqual([25, 15, 0.5, 0.25]);
      expect(result.weightPerSideKg).toBe(40.75);
      expect(result.remainderKg).toBe(0);
    });
  });

  describe('Constrained Plate Inventory (Pair Limits)', () => {
    it('should fallback to smaller plates when only 1 pair of 25s is available', () => {
      // Target 140 kg on 20 kg bar = 120 kg needed -> 60 kg per side.
      // Normal greedy: [25, 25, 10] (needs 2 pairs of 25s).
      // With only 1 pair of 25s available: [25, 20, 15] (60 kg total).
      const result = calculatePlateLoading(140, {
        platePairsAvailable: {
          25: 1,
          20: 2,
          15: 2,
          10: 2,
        },
      });

      expect(result.platesPerSide).toEqual([25, 20, 15]);
      expect(result.weightPerSideKg).toBe(60);
      expect(result.remainderKg).toBe(0);
    });
  });

  describe('Display Formatting Helpers', () => {
    it('should format plate summary string correctly', () => {
      expect(formatPlatesSummary([25, 15])).toBe('25, 15');
      expect(formatPlatesSummary([])).toBe('Empty bar');
    });

    it('should group plates by count', () => {
      const grouped = groupPlatesByCount([25, 25, 10, 1.25]);
      expect(grouped).toEqual([
        { weightKg: 25, count: 2 },
        { weightKg: 10, count: 1 },
        { weightKg: 1.25, count: 1 },
      ]);
    });
  });
});
