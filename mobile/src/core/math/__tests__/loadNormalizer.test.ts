import {
  normalizeLoad,
  normalizeExerciseLoad,
  denormalizeDisplayWeight,
} from '../loadNormalizer';
import { Exercise, GearInventory } from '../../types';

describe('Mechanical Load Normalization Engine', () => {
  describe('Dumbbell Movements with Per-Hand Input (ADR-021)', () => {
    it('should double the user-typed weight for effective load while preserving raw input', () => {
      const result = normalizeLoad({
        rawInputWeightKg: 30,
        loadMode: 'per_hand',
        isBodyweight: false,
      });

      expect(result.rawInputWeightKg).toBe(30);
      expect(result.effectiveWeightKg).toBe(60);
      expect(result.addedWeightKg).toBeNull();
    });

    it('should handle zero weight for dumbbells', () => {
      const result = normalizeLoad({
        rawInputWeightKg: 0,
        loadMode: 'per_hand',
      });

      expect(result.rawInputWeightKg).toBe(0);
      expect(result.effectiveWeightKg).toBe(0);
      expect(result.addedWeightKg).toBeNull();
    });
  });

  describe('Cable Machine Pulley Mechanical Advantages (ADR-025)', () => {
    it('should apply 2:1 pulley ratio (factor 0.5) to pin stack weight', () => {
      // 50 kg stack on a 2:1 functional trainer generates 25 kg effective force
      const result = normalizeLoad({
        rawInputWeightKg: 50,
        cableRatio: 0.5,
      });

      expect(result.rawInputWeightKg).toBe(50);
      expect(result.effectiveWeightKg).toBe(25);
      expect(result.addedWeightKg).toBeNull();
    });

    it('should maintain 1:1 ratio for standard lat pulldowns / seated rows', () => {
      const result = normalizeLoad({
        rawInputWeightKg: 70,
        cableRatio: 1.0,
      });

      expect(result.rawInputWeightKg).toBe(70);
      expect(result.effectiveWeightKg).toBe(70);
      expect(result.addedWeightKg).toBeNull();
    });

    it('should compose per-hand multiplier and cable pulley ratio multiplicatively', () => {
      // 20 kg per hand on a dual 2:1 cable setup: 20 * 2 (both hands) * 0.5 (pulley) = 20 kg
      const result = normalizeLoad({
        rawInputWeightKg: 20,
        loadMode: 'per_hand',
        cableRatio: 0.5,
      });

      expect(result.rawInputWeightKg).toBe(20);
      expect(result.effectiveWeightKg).toBe(20);
      expect(result.addedWeightKg).toBeNull();
    });
  });

  describe('Bodyweight, Weighted, and Assisted Exercises (ADR-018 & Edge Cases)', () => {
    it('should model pure bodyweight exercise (0 added load) as total system load', () => {
      const result = normalizeLoad({
        rawInputWeightKg: 0,
        isBodyweight: true,
        bodyweightKg: 80.0,
      });

      expect(result.rawInputWeightKg).toBe(0);
      expect(result.addedWeightKg).toBe(0);
      expect(result.effectiveWeightKg).toBe(80.0);
    });

    it('should model weighted bodyweight exercise with positive external load (+10 kg)', () => {
      const result = normalizeLoad({
        rawInputWeightKg: 10.0,
        isBodyweight: true,
        bodyweightKg: 80.0,
      });

      expect(result.rawInputWeightKg).toBe(10.0);
      expect(result.addedWeightKg).toBe(10.0);
      expect(result.effectiveWeightKg).toBe(90.0); // 80 kg athlete + 10 kg belt
    });

    it('should model assisted bodyweight exercise with negative added weight (-15 kg assist)', () => {
      const result = normalizeLoad({
        rawInputWeightKg: -15.0,
        isBodyweight: true,
        bodyweightKg: 80.0,
      });

      expect(result.rawInputWeightKg).toBe(-15.0);
      expect(result.addedWeightKg).toBe(-15.0);
      expect(result.effectiveWeightKg).toBe(65.0); // 80 kg athlete - 15 kg counterweight
    });

    it('should clamp effective load to 0 if assistance exceeds athlete bodyweight (-90 kg on 80 kg BW)', () => {
      const result = normalizeLoad({
        rawInputWeightKg: -90.0,
        isBodyweight: true,
        bodyweightKg: 80.0,
      });

      expect(result.rawInputWeightKg).toBe(-90.0);
      expect(result.addedWeightKg).toBe(-90.0);
      expect(result.effectiveWeightKg).toBe(0);
    });

    it('should respect explicitly provided addedWeightKg delta', () => {
      const result = normalizeLoad({
        rawInputWeightKg: 15.0,
        addedWeightKg: -15.0, // e.g. UI passed explicit negative delta for assistance
        isBodyweight: true,
        bodyweightKg: 75.0,
      });

      expect(result.rawInputWeightKg).toBe(15.0);
      expect(result.addedWeightKg).toBe(-15.0);
      expect(result.effectiveWeightKg).toBe(60.0);
    });
  });

  describe('Standard Barbell / Machine Movements', () => {
    it('should pass through barbell loads 1:1 with null addedWeight', () => {
      const result = normalizeLoad({
        rawInputWeightKg: 100.0,
        loadMode: 'total',
        isBodyweight: false,
      });

      expect(result.rawInputWeightKg).toBe(100.0);
      expect(result.effectiveWeightKg).toBe(100.0);
      expect(result.addedWeightKg).toBeNull();
    });
  });

  describe('normalizeExerciseLoad convenience function', () => {
    const mockDumbbellExercise: Pick<Exercise, 'load_mode' | 'is_bodyweight' | 'default_cable_ratio'> = {
      load_mode: 'per_hand',
      is_bodyweight: false,
      default_cable_ratio: 1.0,
    };

    const mockCableExercise: Pick<Exercise, 'load_mode' | 'is_bodyweight' | 'default_cable_ratio'> = {
      load_mode: 'total',
      is_bodyweight: false,
      default_cable_ratio: 0.5,
    };

    const mockCustomGear: Pick<GearInventory, 'cable_ratio' | 'tare_weight_kg'> = {
      cable_ratio: 0.33,
      tare_weight_kg: 20.0,
    };

    it('should normalize dumbbell exercise directly from entity config', () => {
      const result = normalizeExerciseLoad(24, mockDumbbellExercise);
      expect(result.effectiveWeightKg).toBe(48);
      expect(result.rawInputWeightKg).toBe(24);
    });

    it('should normalize cable exercise using exercise default ratio', () => {
      const result = normalizeExerciseLoad(60, mockCableExercise);
      expect(result.effectiveWeightKg).toBe(30);
    });

    it('should prioritize gear cable_ratio over exercise default ratio when gear is provided', () => {
      const result = normalizeExerciseLoad(60, mockCableExercise, mockCustomGear);
      expect(result.effectiveWeightKg).toBeCloseTo(19.8, 1);
    });
  });

  describe('denormalizeDisplayWeight helper', () => {
    it('should reverse dumbbell effective load to per-hand display load', () => {
      const perHand = denormalizeDisplayWeight(60, {
        load_mode: 'per_hand',
        is_bodyweight: false,
        default_cable_ratio: 1.0,
      });
      expect(perHand).toBe(30);
    });

    it('should reverse bodyweight effective load to added weight display', () => {
      const added = denormalizeDisplayWeight(90, {
        load_mode: 'total',
        is_bodyweight: true,
        default_cable_ratio: 1.0,
      }, null, 80);
      expect(added).toBe(10);
    });

    it('should reverse cable effective load to stack display weight', () => {
      const stack = denormalizeDisplayWeight(25, {
        load_mode: 'total',
        is_bodyweight: false,
        default_cable_ratio: 0.5,
      });
      expect(stack).toBe(50);
    });
  });
});
