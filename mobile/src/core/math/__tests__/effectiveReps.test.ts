/**
 * Workout Suite — Effective Reps Math Unit Tests
 */

import {
  calculateHypertrophicEffectiveReps,
  classifyEffectiveRepsTier,
  isAutoFailureSetType,
} from '../effectiveReps';

describe('effectiveReps math module', () => {
  describe('isAutoFailureSetType', () => {
    test('identifies amrap, dc, myorep, and drop as auto-failure', () => {
      expect(isAutoFailureSetType('amrap')).toBe(true);
      expect(isAutoFailureSetType('AMRAP')).toBe(true);
      expect(isAutoFailureSetType('dc')).toBe(true);
      expect(isAutoFailureSetType('myorep')).toBe(true);
      expect(isAutoFailureSetType('drop')).toBe(true);
      expect(isAutoFailureSetType('failure')).toBe(true);
    });

    test('returns false for standard and warmup types', () => {
      expect(isAutoFailureSetType('working')).toBe(false);
      expect(isAutoFailureSetType('warmup')).toBe(false);
      expect(isAutoFailureSetType(null)).toBe(false);
      expect(isAutoFailureSetType(undefined)).toBe(false);
    });
  });

  describe('calculateHypertrophicEffectiveReps', () => {
    test('returns 0 for invalid or 0 reps', () => {
      const res1 = calculateHypertrophicEffectiveReps(0, { rpe: 10 });
      expect(res1.effectiveReps).toBe(0);
      expect(res1.isRated).toBe(false);

      const res2 = calculateHypertrophicEffectiveReps(-5, { rpe: 10 });
      expect(res2.effectiveReps).toBe(0);
    });

    test('warmup sets always yield 0 effective reps', () => {
      const res = calculateHypertrophicEffectiveReps(10, {
        set_type: 'warmup',
        rpe: 10,
        rir: 0,
      });
      expect(res.effectiveReps).toBe(0);
      expect(res.isRated).toBe(true);
      expect(res.isStimulating).toBe(false);
    });

    test('unrated working sets yield 0 effective reps and isRated = false', () => {
      const res = calculateHypertrophicEffectiveReps(10, {
        set_type: 'working',
      });
      expect(res.effectiveReps).toBe(0);
      expect(res.isRated).toBe(false);
      expect(res.isStimulating).toBe(false);
      expect(res.effRpe).toBeNull();
      expect(res.effRir).toBeNull();
    });

    test('AMRAP set type defaults to RPE 10.0 (0 RIR) and yields min(reps, 5)', () => {
      const res1 = calculateHypertrophicEffectiveReps(12, { set_type: 'amrap' });
      expect(res1.effectiveReps).toBe(5);
      expect(res1.isRated).toBe(true);
      expect(res1.isStimulating).toBe(true);
      expect(res1.effRpe).toBe(10.0);
      expect(res1.effRir).toBe(0.0);

      const res2 = calculateHypertrophicEffectiveReps(3, { set_type: 'amrap' });
      expect(res2.effectiveReps).toBe(3);
    });

    test('DC, Myorep, and Drop sets default to failure RPE 10.0', () => {
      const dcRes = calculateHypertrophicEffectiveReps(8, { set_type: 'dc' });
      expect(dcRes.effectiveReps).toBe(5);
      expect(dcRes.isRated).toBe(true);

      const myoRes = calculateHypertrophicEffectiveReps(4, { set_type: 'myorep' });
      expect(myoRes.effectiveReps).toBe(4);
      expect(myoRes.isRated).toBe(true);

      const dropRes = calculateHypertrophicEffectiveReps(6, { set_type: 'drop' });
      expect(dropRes.effectiveReps).toBe(5);
      expect(dropRes.isRated).toBe(true);
    });

    test('calculates effective reps based on RIR', () => {
      // 10 reps @ 2 RIR -> 5 - 2 = 3 eReps
      const res1 = calculateHypertrophicEffectiveReps(10, { rir: 2 });
      expect(res1.effectiveReps).toBe(3);
      expect(res1.effRir).toBe(2);
      expect(res1.effRpe).toBe(8);

      // 10 reps @ 0 RIR -> 5 eReps
      const res2 = calculateHypertrophicEffectiveReps(10, { rir: 0 });
      expect(res2.effectiveReps).toBe(5);

      // 10 reps @ 4 RIR -> 1 eRep
      const res3 = calculateHypertrophicEffectiveReps(10, { rir: 4 });
      expect(res3.effectiveReps).toBe(1);

      // 10 reps @ 5 RIR -> 0 eReps
      const res4 = calculateHypertrophicEffectiveReps(10, { rir: 5 });
      expect(res4.effectiveReps).toBe(0);
      expect(res4.isRated).toBe(true);
      expect(res4.isStimulating).toBe(false);

      // 3 reps @ 1 RIR -> min(3, 5 - 1) = 3 eReps
      const res5 = calculateHypertrophicEffectiveReps(3, { rir: 1 });
      expect(res5.effectiveReps).toBe(3);
    });

    test('calculates effective reps based on RPE', () => {
      // 10 reps @ RPE 8.0 -> 2 RIR -> 3 eReps
      const res1 = calculateHypertrophicEffectiveReps(10, { rpe: 8.0 });
      expect(res1.effectiveReps).toBe(3);

      // 10 reps @ RPE 9.5 -> 0.5 RIR -> rounds 5 - 0.5 = 4 or 5
      const res2 = calculateHypertrophicEffectiveReps(10, { rpe: 9.5 });
      expect(res2.effectiveReps).toBe(5);

      // 10 reps @ RPE 6.0 -> 4 RIR -> 1 eRep
      const res3 = calculateHypertrophicEffectiveReps(10, { rpe: 6.0 });
      expect(res3.effectiveReps).toBe(1);

      // 10 reps @ RPE 5.0 -> 5 RIR -> 0 eReps
      const res4 = calculateHypertrophicEffectiveReps(10, { rpe: 5.0 });
      expect(res4.effectiveReps).toBe(0);
    });

    test('heavy loads (>= 85% 1RM) recruit all motor units from rep 1', () => {
      // 100 kg on 110 kg 1RM = 90.9% 1RM (>= 85%)
      // 3 reps @ 2 RIR
      const res = calculateHypertrophicEffectiveReps(3, {
        rir: 2,
        weightKg: 100,
        e1rmKg: 110,
      });
      // All 3 reps are effective under >= 85% load
      expect(res.effectiveReps).toBe(3);

      // 6 reps @ 85% 1RM capped at 5
      const resCapped = calculateHypertrophicEffectiveReps(6, {
        rir: 1,
        weightKg: 85,
        e1rmKg: 100,
      });
      expect(resCapped.effectiveReps).toBe(5);
    });
  });

  describe('classifyEffectiveRepsTier', () => {
    test('classifies weekly volume into scientific landmark corridors', () => {
      expect(classifyEffectiveRepsTier(15).tier).toBe('low');
      expect(classifyEffectiveRepsTier(20).tier).toBe('optimal');
      expect(classifyEffectiveRepsTier(35).tier).toBe('optimal');
      expect(classifyEffectiveRepsTier(48).tier).toBe('optimal');
      expect(classifyEffectiveRepsTier(49).tier).toBe('high');
      expect(classifyEffectiveRepsTier(65).tier).toBe('high');
      expect(classifyEffectiveRepsTier(70).tier).toBe('peak');
    });
  });
});
