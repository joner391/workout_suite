import {
  quantizeLoad,
  generateWarmupSets,
  calculateWarmupAutoregulation,
  calculateBackoffLoad,
  calculateHelmsRpeOvershootAdjustment,
} from '../warmupEstimator';

describe('warmupEstimator', () => {
  describe('quantizeLoad', () => {
    it('quantizes to default 2.5kg step properly', () => {
      expect(quantizeLoad(81.2)).toBe(80);
      expect(quantizeLoad(81.3)).toBe(82.5);
      expect(quantizeLoad(100)).toBe(100);
      expect(quantizeLoad(99)).toBe(100);
      expect(quantizeLoad(98.74)).toBe(97.5);
    });

    it('quantizes to 0.5kg microplate increment', () => {
      expect(quantizeLoad(81.2, 0.5)).toBe(81.0);
      expect(quantizeLoad(81.3, 0.5)).toBe(81.5);
    });

    it('handles zero or negative loads gracefully', () => {
      expect(quantizeLoad(0)).toBe(0);
      expect(quantizeLoad(-10)).toBe(0);
    });
  });

  describe('generateWarmupSets', () => {
    it('generates a 4-step warm-up ladder for 100kg working weight', () => {
      const sets = generateWarmupSets({
        workingWeightKg: 100,
        barTareWeightKg: 20,
        minimumPlateIncrementKg: 2.5,
      });

      expect(sets.length).toBe(4);
      // Step 1: Empty bar 20kg x 5
      expect(sets[0].weight).toBe(20);
      expect(sets[0].reps).toBe(5);
      expect(sets[0].isDiagnosticSingle).toBe(false);

      // Step 2: 50% = 50kg x 5
      expect(sets[1].weight).toBe(50);
      expect(sets[1].reps).toBe(5);

      // Step 3: 70% = 70kg x 3
      expect(sets[2].weight).toBe(70);
      expect(sets[2].reps).toBe(3);

      // Step 4: 87.5% = 87.5kg x 1 (diagnostic single)
      expect(sets[3].weight).toBe(87.5);
      expect(sets[3].reps).toBe(1);
      expect(sets[3].isDiagnosticSingle).toBe(true);
    });

    it('handles light weight <= barTareWeightKg', () => {
      const sets = generateWarmupSets({
        workingWeightKg: 20,
        barTareWeightKg: 20,
      });
      expect(sets.length).toBe(1);
      expect(sets[0].weight).toBe(20);
      expect(sets[0].isDiagnosticSingle).toBe(true);
    });

    it('handles bodyweight exercise', () => {
      const sets = generateWarmupSets({
        workingWeightKg: 0,
        isBodyweight: true,
      });
      expect(sets).toEqual([]);
    });
  });

  describe('calculateWarmupAutoregulation', () => {
    it('applies +5% increase for light warm-up rating when no fatigue flagged', () => {
      const result = calculateWarmupAutoregulation(100, 'light', 2.5, false);
      expect(result.adjustedLoadKg).toBe(105);
      expect(result.percentageAdjustment).toBe(0.05);
      expect(result.clamped).toBe(false);
    });

    it('applies conservative +2.5% increase for light warm-up when fatigue is flagged', () => {
      const result = calculateWarmupAutoregulation(100, 'light', 2.5, true);
      expect(result.adjustedLoadKg).toBe(102.5);
      expect(result.percentageAdjustment).toBe(0.025);
    });

    it('maintains load for normal warm-up rating', () => {
      const result = calculateWarmupAutoregulation(100, 'normal', 2.5);
      expect(result.adjustedLoadKg).toBe(100);
      expect(result.percentageAdjustment).toBe(0);
    });

    it('applies -5% load drop for hard warm-up rating', () => {
      const result = calculateWarmupAutoregulation(100, 'hard', 2.5, false);
      expect(result.adjustedLoadKg).toBe(95);
      expect(result.percentageAdjustment).toBe(-0.05);
    });

    it('applies -7.5% load drop for hard warm-up when fatigue is flagged', () => {
      const result = calculateWarmupAutoregulation(100, 'hard', 2.5, true);
      expect(result.adjustedLoadKg).toBe(92.5);
      expect(result.percentageAdjustment).toBe(-0.075);
    });
  });

  describe('calculateBackoffLoad', () => {
    it('reduces load by standard ~7.5% for back-off volume sets', () => {
      expect(calculateBackoffLoad(100, 0.075, 2.5)).toBe(92.5);
      expect(calculateBackoffLoad(140, 0.1, 2.5)).toBe(125);
    });
  });

  describe('calculateHelmsRpeOvershootAdjustment', () => {
    it('does not reduce load if RPE is on or below target', () => {
      expect(calculateHelmsRpeOvershootAdjustment(100, 8.0, 8.0, 2.5)).toBe(100);
      expect(calculateHelmsRpeOvershootAdjustment(100, 7.5, 8.0, 2.5)).toBe(100);
    });

    it('reduces load by 2% per 0.5 RPE overshoot', () => {
      // Overshoot by 1.0 RPE (e.g. 9.0 vs 8.0 target) -> 2 units of 0.5 -> 4% drop
      expect(calculateHelmsRpeOvershootAdjustment(100, 9.0, 8.0, 2.5)).toBe(95); // 100 * 0.96 = 96 -> 95kg quantized
      // Overshoot by 1.5 RPE (9.5 vs 8.0) -> 3 units -> 6% drop
      expect(calculateHelmsRpeOvershootAdjustment(100, 9.5, 8.0, 2.5)).toBe(95); // 100 * 0.94 = 94 -> 95kg quantized
    });
  });
});
