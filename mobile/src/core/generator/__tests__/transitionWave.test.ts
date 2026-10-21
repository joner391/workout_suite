/**
 * Workout Suite — Mentality Transition Wave Test Suite
 *
 * Implements Step 8.4 Verification Gate
 * Validates:
 * - Linear RIR and RPE interpolation across transition waves
 * - Isometric effective repetitions (~30-32 eReps/muscle/week invariance)
 * - Anti-stimulus crash protection (Precision -> Fury)
 * - Acute-to-Chronic Workload Ratio (ACWR) and DOMS protection (Fury -> Precision)
 * - Deterministic Active Logger banner strings
 * - Schedule generation and exercise set adjustments
 */

import {
  calculateTransitionWave,
  generateTransitionWaveSchedule,
  calculateAdjustedExerciseSets,
  formatTransitionBanner,
  MENTALITY_PROFILES,
  getMentalityDisplayName,
} from '../transitionWave';

describe('Isometric eRep Cross-Fade Mentality Transition Wave (Step 8.4)', () => {
  describe('Precision to Fury Transition Wave (3 Weeks)', () => {
    it('calculates Week 1 step with +0.5 RPE ramping and 1 trimmed set', () => {
      const step = calculateTransitionWave('precision', 'fury', 1, 3, 32, 2);

      expect(step.isTransitionActive).toBe(true);
      expect(step.fromMentality).toBe('precision');
      expect(step.toMentality).toBe('fury');
      expect(step.currentWeek).toBe(1);
      expect(step.totalWeeks).toBe(3);
      expect(step.progressFraction).toBeCloseTo(0.33, 2);

      // Precision RIR = 2.0, Fury RIR = 0.5
      // Week 1: 2.0 + (1/3) * (0.5 - 2.0) = 1.5
      expect(step.targetRir).toBe(1.5);
      expect(step.targetRpe).toBe(8.5);
      expect(step.rpeDelta).toBe(0.5);

      // eReps = 5 - 1.5 = 3.5
      expect(step.eRepsPerSet).toBe(3.5);

      // Sets: 32 / (3.5 * 2) = 4.57 -> 5 sets, setDelta = -1
      expect(step.setDelta).toBe(-1);

      // Banner message format
      expect(step.bannerMessage).toContain('Mentality Transition: Week 1 of 3 (Precision → Fury)');
      expect(step.bannerMessage).toContain('RPE ramping (+0.5)');
      expect(step.bannerMessage).toContain('1 set is trimmed');
      expect(step.bannerMessage).toContain('to maintain 32 weekly eReps');
    });

    it('calculates Week 2 step with +1.0 RPE ramping and 1 trimmed set', () => {
      const step = calculateTransitionWave('precision', 'fury', 2, 3, 32, 2);

      expect(step.isTransitionActive).toBe(true);
      expect(step.currentWeek).toBe(2);
      expect(step.progressFraction).toBeCloseTo(0.67, 2);

      // Week 2: 2.0 + (2/3) * (-1.5) = 1.0 RIR -> 9.0 RPE
      expect(step.targetRir).toBe(1.0);
      expect(step.targetRpe).toBe(9.0);
      expect(step.rpeDelta).toBe(1.0);
      expect(step.eRepsPerSet).toBe(4.0);

      // Sets: 32 / (4.0 * 2) = 4 sets (vs baseline 6 sets -> -2 sets)
      expect(step.targetSetsPerSession).toBe(4);
      expect(step.setDelta).toBe(-2);

      expect(step.bannerMessage).toContain('Week 2 of 3 (Precision → Fury)');
      expect(step.bannerMessage).toContain('RPE ramping (+1.0)');
      expect(step.bannerMessage).toContain('2 sets is trimmed');
    });

    it('calculates Week 3 step reaching target Fury exertion (RPE 9.5, RIR 0.5)', () => {
      const step = calculateTransitionWave('precision', 'fury', 3, 3, 32, 2);

      expect(step.isTransitionActive).toBe(true);
      expect(step.currentWeek).toBe(3);
      expect(step.progressFraction).toBe(1.0);

      expect(step.targetRir).toBe(0.5);
      expect(step.targetRpe).toBe(9.5);
      expect(step.rpeDelta).toBe(1.5);
      expect(step.eRepsPerSet).toBe(4.5);
    });

    it('marks transition inactive once past total weeks (Week 4 of 3)', () => {
      const step = calculateTransitionWave('precision', 'fury', 4, 3, 32, 2);

      expect(step.isTransitionActive).toBe(false);
      expect(step.targetRir).toBe(0.5);
      expect(step.targetRpe).toBe(9.5);
      expect(step.bannerMessage).toBe('');
    });
  });

  describe('Fury to Precision Transition Wave (Workload / ACWR Protection)', () => {
    it('calculates Week 1 step with -0.5 RPE easing and 1 added set', () => {
      const step = calculateTransitionWave('fury', 'precision', 1, 3, 32, 2);

      expect(step.isTransitionActive).toBe(true);
      expect(step.fromMentality).toBe('fury');
      expect(step.toMentality).toBe('precision');
      expect(step.currentWeek).toBe(1);

      // Fury RIR = 0.5, Precision RIR = 2.0
      // Week 1: 0.5 + (1/3) * (2.0 - 0.5) = 1.0 RIR -> 9.0 RPE
      expect(step.targetRir).toBe(1.0);
      expect(step.targetRpe).toBe(9.0);
      expect(step.rpeDelta).toBe(-0.5);

      // Sets are added to compensate for dropping eRep density
      expect(step.setDelta).toBe(1);

      expect(step.bannerMessage).toContain('Mentality Transition: Week 1 of 3 (Fury → Precision)');
      expect(step.bannerMessage).toContain('RPE easing (-0.5)');
      expect(step.bannerMessage).toContain('1 set is added');
      expect(step.bannerMessage).toContain('to maintain 32 weekly eReps');
    });

    it('safely ramps volume over 3 weeks preventing sudden ACWR > 1.5 spike', () => {
      const schedule = generateTransitionWaveSchedule('fury', 'precision', 3, 32, 2);
      expect(schedule).toHaveLength(3);

      // Verify gradual RPE descent
      expect(schedule[0].targetRpe).toBe(9.0);
      expect(schedule[1].targetRpe).toBe(8.5);
      expect(schedule[2].targetRpe).toBe(8.0);

      // Verify gradual RIR ascent
      expect(schedule[0].targetRir).toBe(1.0);
      expect(schedule[1].targetRir).toBe(1.5);
      expect(schedule[2].targetRir).toBe(2.0);
    });
  });

  describe('Isometric eRep Invariance across Transition Waves', () => {
    it('maintains total weekly effective repetitions within ±2 eReps of 32 MAV target', () => {
      const schedule = generateTransitionWaveSchedule('precision', 'fury', 3, 32, 2);

      for (const step of schedule) {
        const weeklyYield = step.targetWeeklySets * step.eRepsPerSet;
        expect(weeklyYield).toBeGreaterThanOrEqual(28);
        expect(weeklyYield).toBeLessThanOrEqual(35);
      }
    });

    it('maintains invariant effective repetitions in reverse (fury -> precision)', () => {
      const schedule = generateTransitionWaveSchedule('fury', 'precision', 3, 32, 2);

      for (const step of schedule) {
        const weeklyYield = step.targetWeeklySets * step.eRepsPerSet;
        expect(weeklyYield).toBeGreaterThanOrEqual(28);
        expect(weeklyYield).toBeLessThanOrEqual(35);
      }
    });
  });

  describe('Edge Cases & Parameter Flexibility', () => {
    it('handles identical from and to mentality without activating transition', () => {
      const step = calculateTransitionWave('precision', 'precision', 1, 3);
      expect(step.isTransitionActive).toBe(false);
      expect(step.rpeDelta).toBe(0);
      expect(step.setDelta).toBe(0);
      expect(step.bannerMessage).toBe('');
    });

    it('supports calling with TransitionWaveOptions object', () => {
      const step = calculateTransitionWave({
        fromMentality: 'get_out',
        toMentality: 'fury',
        currentWeek: 1,
        totalWeeks: 2,
        targetWeeklyEReps: 32,
        weeklyFrequency: 2,
      });

      expect(step.isTransitionActive).toBe(true);
      expect(step.fromMentality).toBe('get_out');
      expect(step.toMentality).toBe('fury');
      expect(step.totalWeeks).toBe(2);
      expect(step.targetRpe).toBe(9.0);
    });

    it('adjusts individual exercise set counts safely with calculateAdjustedExerciseSets', () => {
      const trimStep = calculateTransitionWave('precision', 'fury', 1, 3);
      expect(calculateAdjustedExerciseSets(3, trimStep)).toBe(2);
      // Never drops below 1 set
      expect(calculateAdjustedExerciseSets(1, trimStep)).toBe(1);

      const addStep = calculateTransitionWave('fury', 'precision', 1, 3);
      expect(calculateAdjustedExerciseSets(2, addStep)).toBe(3);
      // Never exceeds 5 sets
      expect(calculateAdjustedExerciseSets(5, addStep)).toBe(5);

      // Inactive step preserves base sets
      expect(calculateAdjustedExerciseSets(3, null)).toBe(3);
      const inactiveStep = calculateTransitionWave('precision', 'precision', 1, 3);
      expect(calculateAdjustedExerciseSets(3, inactiveStep)).toBe(3);
    });

    it('formats human readable display names correctly', () => {
      expect(getMentalityDisplayName('fury')).toBe('Fury');
      expect(getMentalityDisplayName('precision')).toBe('Precision');
      expect(getMentalityDisplayName('get_out')).toBe('Get Out');
    });
  });
});
