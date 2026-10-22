import {
  quantizeLoad,
  generateWarmupSets,
  calculateWarmupAutoregulation,
  calculateBackoffLoad,
  calculateHelmsRpeOvershootAdjustment,
  isLastWarmupSet,
  shouldGenerateWarmups,
} from '../warmupEstimator';

describe('warmupEstimator', () => {
  test('automatic warmup eligibility follows the same setting for every entry point', () => {
    expect(shouldGenerateWarmups('smart_compounds', { is_compound: true })).toBe(true);
    expect(shouldGenerateWarmups('smart_compounds', { is_compound: false })).toBe(false);
    for (const is_compound of [true, false]) {
      expect(shouldGenerateWarmups('all_exercises', { is_compound })).toBe(true);
      expect(shouldGenerateWarmups('off', { is_compound })).toBe(false);
    }
  });
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
    it('preserves a 14 kg plan when maintaining or when rounding exceeds limits', () => {
      for (const rating of ['normal', 'light', 'heavy'] as const) {
        const result = calculateWarmupAutoregulation(14, rating);
        expect(result.adjustedLoadKg).toBe(14);
        expect(result.percentageAdjustment).toBe(0);
      }
      expect(calculateWarmupAutoregulation(14, 'light').recommendation).toContain('no load step');
    });

    it('reports the actual rounded change, with valid direction and bounds', () => {
      const result = calculateWarmupAutoregulation(14, 'light', 0.5);
      expect(result.adjustedLoadKg).toBe(14.5);
      expect(result.percentageAdjustment).toBeCloseTo(0.5 / 14);
      expect(calculateWarmupAutoregulation(101, 'light').adjustedLoadKg).toBe(105);
      for (const load of [5, 14, 15, 24, 42, 63, 101]) {
        for (const rating of ['normal', 'light', 'heavy'] as const) {
          const adjustment = calculateWarmupAutoregulation(load, rating);
          expect(adjustment.percentageAdjustment).toBeGreaterThanOrEqual(-0.1);
          expect(adjustment.percentageAdjustment).toBeLessThanOrEqual(0.05);
          expect(adjustment.adjustedLoadKg).toBeCloseTo(load * (1 + adjustment.percentageAdjustment));
        }
      }
    });

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

    it('applies -5% load drop for hard/heavy warm-up rating', () => {
      const resultHard = calculateWarmupAutoregulation(100, 'hard', 2.5, false);
      expect(resultHard.adjustedLoadKg).toBe(95);
      expect(resultHard.percentageAdjustment).toBe(-0.05);

      const resultHeavy = calculateWarmupAutoregulation(100, 'heavy', 2.5, false);
      expect(resultHeavy.adjustedLoadKg).toBe(95);
      expect(resultHeavy.percentageAdjustment).toBe(-0.05);
    });

    it('applies -7.5% load drop for hard/heavy warm-up when fatigue is flagged', () => {
      const resultHard = calculateWarmupAutoregulation(100, 'hard', 2.5, true);
      expect(resultHard.adjustedLoadKg).toBe(92.5);
      expect(resultHard.percentageAdjustment).toBe(-0.075);

      const resultHeavy = calculateWarmupAutoregulation(100, 'heavy', 2.5, true);
      expect(resultHeavy.adjustedLoadKg).toBe(92.5);
      expect(resultHeavy.percentageAdjustment).toBe(-0.075);
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

  describe('isLastWarmupSet', () => {
    const mockSets = [
      { id: 's1', exercise_id: 'ex1', set_type: 'warmup', set_number: 1 },
      { id: 's2', exercise_id: 'ex1', set_type: 'warmup', set_number: 2 },
      { id: 's3', exercise_id: 'ex1', set_type: 'warmup', set_number: 3 },
      { id: 's4', exercise_id: 'ex1', set_type: 'working', set_number: 4 },
      { id: 's5', exercise_id: 'ex1', set_type: 'working', set_number: 5 },
      { id: 's6', exercise_id: 'ex2', set_type: 'warmup', set_number: 1 },
    ];

    it('returns true for the warmup set with the highest set number for the exercise', () => {
      expect(isLastWarmupSet(mockSets[2], mockSets)).toBe(true);
    });

    it('returns false for preceding warmup sets for the exercise', () => {
      expect(isLastWarmupSet(mockSets[0], mockSets)).toBe(false);
      expect(isLastWarmupSet(mockSets[1], mockSets)).toBe(false);
    });

    it('returns false for working sets', () => {
      expect(isLastWarmupSet(mockSets[3], mockSets)).toBe(false);
      expect(isLastWarmupSet(mockSets[4], mockSets)).toBe(false);
    });

    it('handles solitary single warmup set for an exercise', () => {
      expect(isLastWarmupSet(mockSets[5], mockSets)).toBe(true);
    });

    it('returns false when no warmup sets exist for the exercise', () => {
      const workingOnlySets = [
        { id: 'w1', exercise_id: 'ex3', set_type: 'working', set_number: 1 },
      ];
      expect(isLastWarmupSet(workingOnlySets[0], workingOnlySets)).toBe(false);
    });
  });
});
