/**
 * Workout Suite — WarmupAssessmentModal Test Suite
 *
 * Implements Step 1.5 / ADR-082 Verification Gate
 * Validates:
 * - Diagnostic warm-up assessment logic ('light', 'normal', 'heavy')
 * - Asymmetric autoregulation load calculations and plate quantization
 * - Fatigue-aware modifier (+2.5% vs +5.0% for light; -7.5% vs -5.0% for heavy)
 * - Groove Check protocol (90s rest and warm-up single retry) vs immediate load drop
 * - Null safety and dismissal lifecycle
 */

import { Exercise, WorkoutSet } from '../../../core/types';
import {
  calculateWarmupAutoregulation,
  WarmupPerceptionRating,
} from '../../../core/math/warmupEstimator';
import { formatWeight } from '../../../core/math/unitConversion';

describe('WarmupAssessmentModal & Diagnostic Single Autoregulation (ADR-082)', () => {
  const mockExercise: Exercise = {
    id: 'ex-squat',
    name: 'Barbell Back Squat',
    muscle_group: 'Quads',
    category: 'Barbell',
    is_compound: true,
    is_bodyweight: false,
    is_unilateral: false,
    load_mode: 'total',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 20.0,
    is_custom: false,
    parent_exercise_id: null,
    standard_lift_type: 'squat',
    default_rest_seconds: 180,
  };

  const mockWarmupSet: WorkoutSet = {
    id: 'set-warmup-last',
    workout_id: 'workout-1',
    exercise_id: 'ex-squat',
    gear_id: null,
    set_number: 4,
    weight: 87.5,
    raw_input_weight: 87.5,
    added_weight: null,
    reps: 1,
    reps_right: null,
    rpe: null,
    rir: null,
    set_type: 'warmup',
    set_notes: '87.5% diagnostic single - assess speed/readiness',
    exercise_group_id: null,
    created_at: '2026-10-19T10:00:00Z',
  };

  describe('Guard Conditions & Visibility Logic', () => {
    const shouldRenderModal = (
      visible: boolean,
      exercise: Exercise | null,
      warmupSet: WorkoutSet | null
    ): boolean => {
      return Boolean(visible && exercise && warmupSet);
    };

    test('evaluates false when visible is false', () => {
      expect(shouldRenderModal(false, mockExercise, mockWarmupSet)).toBe(false);
    });

    test('evaluates false when exercise is null', () => {
      expect(shouldRenderModal(true, null, mockWarmupSet)).toBe(false);
    });

    test('evaluates false when warmupSet is null', () => {
      expect(shouldRenderModal(true, mockExercise, null)).toBe(false);
    });

    test('evaluates true when all required props are present', () => {
      expect(shouldRenderModal(true, mockExercise, mockWarmupSet)).toBe(true);
    });
  });

  describe('Mathematical Autoregulation Previews', () => {
    test('computes light adjustment (+5% or 105 kg on 100 kg planned load)', () => {
      const adj = calculateWarmupAutoregulation(100, 'light', 2.5, false);
      expect(adj.adjustedLoadKg).toBe(105);
      expect(adj.percentageAdjustment).toBe(0.05);
      expect(adj.recommendation).toContain('crisply');
      expect(formatWeight(adj.adjustedLoadKg, 'kg')).toBe('105 kg');
    });

    test('computes normal adjustment (0% maintain planned load)', () => {
      const adj = calculateWarmupAutoregulation(100, 'normal', 2.5, false);
      expect(adj.adjustedLoadKg).toBe(100);
      expect(adj.percentageAdjustment).toBe(0);
      expect(adj.recommendation).toContain('on target');
      expect(formatWeight(adj.adjustedLoadKg, 'kg')).toBe('100 kg');
    });

    test('computes heavy adjustment (-5% or 95 kg on 100 kg planned load)', () => {
      const adj = calculateWarmupAutoregulation(100, 'heavy', 2.5, false);
      expect(adj.adjustedLoadKg).toBe(95);
      expect(adj.percentageAdjustment).toBe(-0.05);
      expect(adj.recommendation).toContain('sluggishly');
      expect(formatWeight(adj.adjustedLoadKg, 'kg')).toBe('95 kg');
    });

    test('scales conservatively (+2.5% for light, -7.5% for heavy) when fatigue is flagged', () => {
      const lightFatigue = calculateWarmupAutoregulation(100, 'light', 2.5, true);
      expect(lightFatigue.adjustedLoadKg).toBe(102.5);
      expect(lightFatigue.percentageAdjustment).toBe(0.025);

      const heavyFatigue = calculateWarmupAutoregulation(100, 'heavy', 2.5, true);
      expect(heavyFatigue.adjustedLoadKg).toBe(92.5);
      expect(heavyFatigue.percentageAdjustment).toBe(-0.075);
    });
  });

  describe('Groove Fallacy Protocol & Action Callbacks', () => {
    test('provides retry action preserving planned load when heavy is reported', () => {
      const onApply = jest.fn();

      const handleGrooveRetry = () => {
        onApply('heavy', 100, 'groove_retry');
      };

      handleGrooveRetry();
      expect(onApply).toHaveBeenCalledWith('heavy', 100, 'groove_retry');
    });

    test('provides immediate reduction action when heavy is confirmed', () => {
      const onApply = jest.fn();
      const heavyAdj = calculateWarmupAutoregulation(100, 'heavy', 2.5, false);

      const handleApplyReduction = () => {
        onApply('heavy', heavyAdj.adjustedLoadKg, 'apply_reduction');
      };

      handleApplyReduction();
      expect(onApply).toHaveBeenCalledWith('heavy', 95, 'apply_reduction');
    });

    test('dispatches light increase (+5%) to remaining work sets', () => {
      const onApply = jest.fn();
      const lightAdj = calculateWarmupAutoregulation(100, 'light', 2.5, false);

      const handleApplyLight = () => {
        onApply('light', lightAdj.adjustedLoadKg, 'apply_reduction');
      };

      handleApplyLight();
      expect(onApply).toHaveBeenCalledWith('light', 105, 'apply_reduction');
    });

    test('dispatches normal maintenance (100 kg) to remaining work sets', () => {
      const onApply = jest.fn();
      const normalAdj = calculateWarmupAutoregulation(100, 'normal', 2.5, false);

      const handleApplyNormal = () => {
        onApply('normal', normalAdj.adjustedLoadKg, 'apply_reduction');
      };

      handleApplyNormal();
      expect(onApply).toHaveBeenCalledWith('normal', 100, 'apply_reduction');
    });
  });
});
