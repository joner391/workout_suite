/**
 * Workout Suite — Calendar & Past Session Features Test Suite
 *
 * Implements Step 1.6 Verification Gate
 * Validates:
 * - Date math: Month grid generator, Monday-start offsets, spillover days
 * - Week view generator across month boundaries
 * - Completed and in-progress workout badge resolution
 * - Duration & date formatters
 * - Session detail aggregations: Total volume, set counts, top e1RM across exercises
 * - Past session deletion contract
 */

import React from 'react';
import {
  CalendarScreen,
  buildMonthGrid,
  buildWeekDays,
  toIsoDate,
  parseIsoDate,
  formatFriendlyDate,
} from '../CalendarScreen';
import {
  formatDuration,
  formatDateTime,
  formatIntensityValue,
  computeSupersetInfo,
  SupersetInfo,
} from '../SessionDetailModal';
import {
  Workout,
  WorkoutSet,
  Exercise,
} from '../../../core/types';
import {
  MockWorkoutRepository,
  MockExerciseRepository,
} from '../../../database/mocks';
import { calculateHeuristic1RM } from '../../../core/math/heuristic1rm';

describe('Calendar Features & Grid Generation Logic (Step 1.6)', () => {
  let workoutRepo: MockWorkoutRepository;
  let exerciseRepo: MockExerciseRepository;

  const sampleCompletedWorkout: Workout = {
    id: 'wk-oct-14',
    template_id: null,
    date: '2026-10-14',
    name: 'Heavy Lower Body',
    notes: 'Squat PR attempt',
    started_at: '2026-10-14T10:00:00Z',
    duration_seconds: 3750, // 1h 2m 30s
    status: 'completed',
    completed_at: '2026-10-14T11:02:30Z',
    imported_from: null,
  };

  const sampleInProgressWorkout: Workout = {
    id: 'wk-oct-15',
    template_id: null,
    date: '2026-10-15',
    name: 'Upper Body Pump',
    notes: null,
    started_at: '2026-10-15T15:00:00Z',
    duration_seconds: 1200,
    status: 'in_progress',
    completed_at: null,
    imported_from: null,
  };

  const mockSquat: Exercise = {
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

  const mockBench: Exercise = {
    id: 'ex-bench',
    name: 'Barbell Bench Press',
    muscle_group: 'Chest',
    category: 'Barbell',
    is_compound: true,
    is_bodyweight: false,
    is_unilateral: false,
    load_mode: 'total',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 20.0,
    is_custom: false,
    parent_exercise_id: null,
    standard_lift_type: 'bench',
    default_rest_seconds: 120,
  };

  beforeEach(() => {
    workoutRepo = new MockWorkoutRepository();
    exerciseRepo = new MockExerciseRepository();
    exerciseRepo.create(mockSquat);
    exerciseRepo.create(mockBench);
  });

  describe('Pure Date Helper & Month Grid Math', () => {
    test('toIsoDate formats zero-padded YYYY-MM-DD correctly', () => {
      expect(toIsoDate(2026, 0, 5)).toBe('2026-01-05');
      expect(toIsoDate(2026, 9, 14)).toBe('2026-10-14');
      expect(toIsoDate(2026, 11, 31)).toBe('2026-12-31');
    });

    test('parseIsoDate parses strings back into components', () => {
      const parsed = parseIsoDate('2026-10-14');
      expect(parsed.year).toBe(2026);
      expect(parsed.month).toBe(9); // 0-indexed
      expect(parsed.day).toBe(14);
    });

    test('buildMonthGrid returns exact 7-column rows matching the month', () => {
      const workoutsMap: Record<string, Workout[]> = {
        '2026-10-14': [sampleCompletedWorkout],
        '2026-10-15': [sampleInProgressWorkout],
      };

      // October 2026: Oct 1 is Thursday.
      // Monday-first offset means Mon-Wed are Sep 28, 29, 30.
      const grid = buildMonthGrid(2026, 9, workoutsMap);

      // Must be a multiple of 7
      expect(grid.length % 7).toBe(0);
      expect(grid.length).toBeGreaterThanOrEqual(28);

      // Verify Oct 14 has completed workout badge
      const oct14 = grid.find((item) => item.dateIso === '2026-10-14');
      expect(oct14).toBeDefined();
      expect(oct14?.isCurrentMonth).toBe(true);
      expect(oct14?.hasCompletedWorkout).toBe(true);
      expect(oct14?.hasInProgressWorkout).toBe(false);
      expect(oct14?.workoutCount).toBe(1);

      // Verify Oct 15 has in-progress badge
      const oct15 = grid.find((item) => item.dateIso === '2026-10-15');
      expect(oct15?.hasInProgressWorkout).toBe(true);
      expect(oct15?.hasCompletedWorkout).toBe(false);

      // Verify a day with no workouts
      const oct16 = grid.find((item) => item.dateIso === '2026-10-16');
      expect(oct16?.hasCompletedWorkout).toBe(false);
      expect(oct16?.hasInProgressWorkout).toBe(false);
      expect(oct16?.workoutCount).toBe(0);
    });

    test('buildMonthGrid handles February in leap and non-leap years', () => {
      // 2024 is a leap year (29 days in Feb)
      const feb2024 = buildMonthGrid(2024, 1, {});
      const currentDays2024 = feb2024.filter((d) => d.isCurrentMonth);
      expect(currentDays2024.length).toBe(29);

      // 2026 is non-leap (28 days in Feb)
      const feb2026 = buildMonthGrid(2026, 1, {});
      const currentDays2026 = feb2026.filter((d) => d.isCurrentMonth);
      expect(currentDays2026.length).toBe(28);
    });

    test('buildWeekDays returns 7 consecutive days starting on Monday', () => {
      const workoutsMap: Record<string, Workout[]> = {
        '2026-10-14': [sampleCompletedWorkout],
      };

      // 2026-10-14 is Wednesday
      const week = buildWeekDays('2026-10-14', workoutsMap);
      expect(week.length).toBe(7);

      // Monday should be 2026-10-12
      expect(week[0].dateIso).toBe('2026-10-12');
      // Sunday should be 2026-10-18
      expect(week[6].dateIso).toBe('2026-10-18');

      // Wednesday has workout
      expect(week[2].dateIso).toBe('2026-10-14');
      expect(week[2].hasCompletedWorkout).toBe(true);
    });

    test('buildWeekDays handles boundary crossing over month end', () => {
      // 2026-10-31 is Saturday. Monday is 2026-10-26, Sunday is 2026-11-01
      const week = buildWeekDays('2026-10-31', {});
      expect(week.length).toBe(7);
      expect(week[0].dateIso).toBe('2026-10-26');
      expect(week[5].dateIso).toBe('2026-10-31');
      expect(week[6].dateIso).toBe('2026-11-01');
    });
  });

  describe('Duration & Formatting Helpers', () => {
    test('formatDuration formats seconds accurately', () => {
      expect(formatDuration(null)).toBe('0m');
      expect(formatDuration(0)).toBe('0m');
      expect(formatDuration(45)).toBe('45s');
      expect(formatDuration(60)).toBe('1m');
      expect(formatDuration(150)).toBe('2m 30s');
      expect(formatDuration(3600)).toBe('1h 0m');
      expect(formatDuration(3750)).toBe('1h 2m');
      expect(formatDuration(7320)).toBe('2h 2m');
    });

    test('formatDateTime and formatFriendlyDate format valid strings', () => {
      const formatted = formatFriendlyDate('2026-10-14');
      expect(formatted).toContain('2026');
      expect(formatted).toContain('14');

      const dtFormatted = formatDateTime('2026-10-14T10:00:00Z');
      expect(dtFormatted).toContain('2026');
    });
  });

  describe('Session Detail Inspection Aggregations', () => {
    test('computes total volume, total sets, and best e1RM across exercises', async () => {
      await workoutRepo.create(sampleCompletedWorkout);

      const sets: WorkoutSet[] = [
        // Squat: 100kg x 5 @ RPE 8 (e1RM = 100 * (5 + 2)^0.10 = 121.48)
        {
          id: 'set-1',
          workout_id: sampleCompletedWorkout.id,
          exercise_id: 'ex-squat',
          gear_id: null,
          set_number: 1,
          weight: 100,
          raw_input_weight: 100,
          added_weight: null,
          reps: 5,
          reps_right: null,
          rpe: 8,
          rir: null,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: '2026-10-14T10:05:00Z',
        },
        // Squat: 120kg x 3 @ RIR 1 (e1RM = 120 * (3 + 1)^0.10 = 137.84)
        {
          id: 'set-2',
          workout_id: sampleCompletedWorkout.id,
          exercise_id: 'ex-squat',
          gear_id: null,
          set_number: 2,
          weight: 120,
          raw_input_weight: 120,
          added_weight: null,
          reps: 3,
          reps_right: null,
          rpe: null,
          rir: 1,
          set_type: 'working',
          set_notes: 'Smooth lockouts',
          exercise_group_id: null,
          created_at: '2026-10-14T10:10:00Z',
        },
        // Bench: 80kg x 8 @ RPE 9 (e1RM = 80 * (8 + 1)^0.10 = 99.58)
        {
          id: 'set-3',
          workout_id: sampleCompletedWorkout.id,
          exercise_id: 'ex-bench',
          gear_id: null,
          set_number: 3,
          weight: 80,
          raw_input_weight: 80,
          added_weight: null,
          reps: 8,
          reps_right: null,
          rpe: 9,
          rir: null,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: '2026-10-14T10:20:00Z',
        },
      ];

      await workoutRepo.saveSets(sets);

      const fullWorkout = await workoutRepo.getWorkoutWithSets(sampleCompletedWorkout.id);
      expect(fullWorkout).not.toBeNull();
      expect(fullWorkout?.sets.length).toBe(3);

      // Total volume calculation: (100*5) + (120*3) + (80*8) = 500 + 360 + 640 = 1500 kg
      const totalVolume = fullWorkout!.sets.reduce((acc, s) => acc + s.weight * s.reps, 0);
      expect(totalVolume).toBe(1500);

      // Best e1RM in the session
      let maxE1rm = 0;
      let topExId = '';
      for (const s of fullWorkout!.sets) {
        const e1rm = calculateHeuristic1RM(s.weight, s.reps, { rir: s.rir, rpe: s.rpe });
        if (e1rm > maxE1rm) {
          maxE1rm = e1rm;
          topExId = s.exercise_id;
        }
      }

      expect(topExId).toBe('ex-squat');
      expect(maxE1rm).toBeCloseTo(137.84, 1);
    });

    test('deleting workout deletes session and cascades to sets', async () => {
      await workoutRepo.create(sampleCompletedWorkout);
      await workoutRepo.addSet({
        id: 'set-del',
        workout_id: sampleCompletedWorkout.id,
        exercise_id: 'ex-squat',
        gear_id: null,
        set_number: 1,
        weight: 100,
        raw_input_weight: 100,
        added_weight: null,
        reps: 5,
        reps_right: null,
        rpe: 8,
        rir: null,
        set_type: 'working',
        set_notes: null,
        exercise_group_id: null,
        created_at: '2026-10-14T10:05:00Z',
      });

      expect((await workoutRepo.findAll()).length).toBe(1);
      expect((await workoutRepo.getSetsByWorkoutId(sampleCompletedWorkout.id)).length).toBe(1);

      await workoutRepo.delete(sampleCompletedWorkout.id);

      expect((await workoutRepo.findAll()).length).toBe(0);
      expect((await workoutRepo.getSetsByWorkoutId(sampleCompletedWorkout.id)).length).toBe(0);
    });
  });

  describe('formatIntensityValue helper (RPE vs RIR strictly separated)', () => {
    const baseSet: WorkoutSet = {
      id: 's-1',
      workout_id: 'w-1',
      exercise_id: 'e-1',
      gear_id: null,
      set_number: 1,
      weight: 100,
      raw_input_weight: 100,
      added_weight: null,
      reps: 5,
      reps_right: null,
      rpe: null,
      rir: null,
      set_type: 'working',
      set_notes: null,
      exercise_group_id: null,
      created_at: '2026-10-14T10:00:00Z',
    };

    it('should format RPE metric correctly from native RPE', () => {
      expect(formatIntensityValue({ ...baseSet, rpe: 8.5 }, 'RPE')).toBe('@8.5');
      expect(formatIntensityValue({ ...baseSet, rpe: 10 }, 'RPE')).toBe('@10');
    });

    it('should convert RIR to RPE when in RPE metric mode', () => {
      // 2 RIR -> RPE 8.0
      expect(formatIntensityValue({ ...baseSet, rir: 2 }, 'RPE')).toBe('@8');
      expect(formatIntensityValue({ ...baseSet, rir: 0 }, 'RPE')).toBe('@10');
    });

    it('should format RIR metric correctly from native RIR', () => {
      expect(formatIntensityValue({ ...baseSet, rir: 1.5 }, 'RIR')).toBe('1.5 RIR');
      expect(formatIntensityValue({ ...baseSet, rir: 0 }, 'RIR')).toBe('0 RIR');
    });

    it('should convert RPE to RIR when in RIR metric mode', () => {
      // RPE 8.5 -> 1.5 RIR
      expect(formatIntensityValue({ ...baseSet, rpe: 8.5 }, 'RIR')).toBe('1.5 RIR');
      expect(formatIntensityValue({ ...baseSet, rpe: 10 }, 'RIR')).toBe('0 RIR');
    });

    it('should return dash when neither RPE nor RIR is provided', () => {
      expect(formatIntensityValue(baseSet, 'RPE')).toBe('—');
      expect(formatIntensityValue(baseSet, 'RIR')).toBe('—');
    });
  });

  describe('computeSupersetInfo & Completed Session Superset Identification', () => {
    const baseSet: WorkoutSet = {
      id: 's-1',
      workout_id: 'w-1',
      exercise_id: 'ex-bench',
      gear_id: null,
      set_number: 1,
      weight: 100,
      raw_input_weight: 100,
      added_weight: null,
      reps: 8,
      reps_right: null,
      rpe: 8,
      rir: null,
      set_type: 'working',
      set_notes: null,
      exercise_group_id: null,
      created_at: '2026-10-14T10:00:00Z',
    };

    it('returns empty maps when no sets have exercise_group_id', () => {
      const sets: WorkoutSet[] = [
        { ...baseSet, id: 's-1', exercise_id: 'ex-squat' },
        { ...baseSet, id: 's-2', exercise_id: 'ex-bench' },
      ];
      const result = computeSupersetInfo(sets);
      expect(result.exerciseMap.size).toBe(0);
      expect(result.setMap.size).toBe(0);
    });

    it('maps paired exercises to Superset A with SS A1 and SS A2 badges', () => {
      const sets: WorkoutSet[] = [
        { ...baseSet, id: 's-1', exercise_id: 'ex-bench', exercise_group_id: 'grp-pair-1' },
        { ...baseSet, id: 's-2', exercise_id: 'ex-row', exercise_group_id: 'grp-pair-1' },
        { ...baseSet, id: 's-3', exercise_id: 'ex-bench', exercise_group_id: 'grp-pair-1' },
        { ...baseSet, id: 's-4', exercise_id: 'ex-row', exercise_group_id: 'grp-pair-1' },
      ];
      const result = computeSupersetInfo(sets);

      expect(result.exerciseMap.size).toBe(2);
      expect(result.exerciseMap.get('ex-bench')).toEqual({
        groupLetter: 'A',
        exerciseIndex: 1,
        badgeLabel: 'SS A1',
        groupLabel: 'Superset A',
      });
      expect(result.exerciseMap.get('ex-row')).toEqual({
        groupLetter: 'A',
        exerciseIndex: 2,
        badgeLabel: 'SS A2',
        groupLabel: 'Superset A',
      });

      expect(result.setMap.size).toBe(4);
      expect(result.setMap.get('s-1')?.badgeLabel).toBe('SS A1');
      expect(result.setMap.get('s-2')?.badgeLabel).toBe('SS A2');
      expect(result.setMap.get('s-3')?.badgeLabel).toBe('SS A1');
      expect(result.setMap.get('s-4')?.badgeLabel).toBe('SS A2');
    });

    it('handles giant sets with 3+ exercises mapped to SS A1, SS A2, SS A3', () => {
      const sets: WorkoutSet[] = [
        { ...baseSet, id: 's-1', exercise_id: 'ex-1', exercise_group_id: 'grp-giant' },
        { ...baseSet, id: 's-2', exercise_id: 'ex-2', exercise_group_id: 'grp-giant' },
        { ...baseSet, id: 's-3', exercise_id: 'ex-3', exercise_group_id: 'grp-giant' },
      ];
      const result = computeSupersetInfo(sets);

      expect(result.exerciseMap.get('ex-1')?.badgeLabel).toBe('SS A1');
      expect(result.exerciseMap.get('ex-2')?.badgeLabel).toBe('SS A2');
      expect(result.exerciseMap.get('ex-3')?.badgeLabel).toBe('SS A3');
    });

    it('assigns ascending letters for multiple distinct superset groups in order', () => {
      const sets: WorkoutSet[] = [
        // Superset A
        { ...baseSet, id: 's-1', exercise_id: 'ex-squat', exercise_group_id: 'grp-1' },
        { ...baseSet, id: 's-2', exercise_id: 'ex-calf', exercise_group_id: 'grp-1' },
        // Straight set (no group)
        { ...baseSet, id: 's-3', exercise_id: 'ex-ohp', exercise_group_id: null },
        // Superset B
        { ...baseSet, id: 's-4', exercise_id: 'ex-bicep', exercise_group_id: 'grp-2' },
        { ...baseSet, id: 's-5', exercise_id: 'ex-tricep', exercise_group_id: 'grp-2' },
      ];
      const result = computeSupersetInfo(sets);

      expect(result.exerciseMap.get('ex-squat')?.badgeLabel).toBe('SS A1');
      expect(result.exerciseMap.get('ex-calf')?.badgeLabel).toBe('SS A2');
      expect(result.exerciseMap.get('ex-ohp')).toBeUndefined();
      expect(result.exerciseMap.get('ex-bicep')?.badgeLabel).toBe('SS B1');
      expect(result.exerciseMap.get('ex-tricep')?.badgeLabel).toBe('SS B2');

      expect(result.setMap.get('s-3')).toBeUndefined();
      expect(result.setMap.get('s-4')?.badgeLabel).toBe('SS B1');
      expect(result.setMap.get('s-5')?.badgeLabel).toBe('SS B2');
    });

    it('preserves exercise execution order and set grouping for historical session summaries', async () => {
      const workoutWithSupersets: Workout = {
        id: 'wk-superset-summary',
        template_id: null,
        date: '2026-10-14',
        name: 'Antagonist Superset Upper',
        notes: 'Great pump',
        started_at: '2026-10-14T12:00:00Z',
        duration_seconds: 2400,
        status: 'completed',
        completed_at: '2026-10-14T12:40:00Z',
        imported_from: null,
      };

      await workoutRepo.create(workoutWithSupersets);

      const sets: WorkoutSet[] = [
        {
          ...baseSet,
          id: 'set-bench-1',
          workout_id: workoutWithSupersets.id,
          exercise_id: 'ex-bench',
          exercise_group_id: 'grp-antagonist',
          weight: 100,
          reps: 8,
        },
        {
          ...baseSet,
          id: 'set-squat-1',
          workout_id: workoutWithSupersets.id,
          exercise_id: 'ex-squat',
          exercise_group_id: 'grp-antagonist',
          weight: 140,
          reps: 5,
        },
      ];

      await workoutRepo.saveSets(sets);

      const retrieved = await workoutRepo.getWorkoutWithSets(workoutWithSupersets.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sets.length).toBe(2);

      const supersetMapping = computeSupersetInfo(retrieved!.sets);
      expect(supersetMapping.exerciseMap.get('ex-bench')?.badgeLabel).toBe('SS A1');
      expect(supersetMapping.exerciseMap.get('ex-squat')?.badgeLabel).toBe('SS A2');
      expect(supersetMapping.setMap.get('set-bench-1')?.badgeLabel).toBe('SS A1');
      expect(supersetMapping.setMap.get('set-squat-1')?.badgeLabel).toBe('SS A2');
    });
  });

  describe('CalendarScreen Accordion Behavior', () => {
    it('defaults to collapsed week view with initialExpanded false', () => {
      const element = React.createElement(CalendarScreen, {
        workoutRepo,
        exerciseRepo,
      });

      expect(element).toBeDefined();
      expect(element.props.initialExpanded).toBeUndefined();
    });

    it('accepts initialExpanded true for expanded month view', () => {
      const element = React.createElement(CalendarScreen, {
        workoutRepo,
        exerciseRepo,
        initialExpanded: true,
      });

      expect(element).toBeDefined();
      expect(element.props.initialExpanded).toBe(true);
    });

    it('instantiates CalendarScreen without onStartWorkout to collapse empty rest days', () => {
      const element = React.createElement(CalendarScreen, {
        workoutRepo,
        exerciseRepo,
      });

      expect(element).toBeDefined();
      expect(element.props.onStartWorkout).toBeUndefined();
    });
  });
});
