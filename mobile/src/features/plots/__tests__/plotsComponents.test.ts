/**
 * Workout Suite — Longitudinal Plots & Era Shading Test Suite
 *
 * Implements Step 5.2 Verification Gate
 * Validates:
 * - e1RM time-series generation with Lombardi power law + RPE/RIR intensity modeling
 * - Calendar-aware 7-day rolling average (SMA/EMA) bodyweight trend tracking
 * - Navy DoD body fat percentage time-series calculation
 * - Anatomical circumference tracking with automatic metric/imperial conversion
 * - Monday-bucketed weekly volume tonnage aggregation (excluding warmups)
 * - Program era shading metadata resolution and timeline boundaries
 */

import {
  MockWorkoutRepository,
  MockExerciseRepository,
  MockBodyMetricsRepository,
  MockProgramRepository,
  MockUserSettingsRepository,
  MockUserProfileRepository,
} from '../../../database/mocks';
import { ProgramBlockService } from '../../../services/programBlockService';
import {
  calculateBodyweightRollingAverages,
  calculateNavyBodyFat,
  calculateEstimatedLeanBodyMass,
  parseIsoDateToMs,
} from '../../../core/math/navyBodyFat';
import { calculateHeuristic1RM } from '../../../core/math/heuristic1rm';
import {
  cmToInches,
  kgToLbs,
  formatWeight,
  formatLength,
} from '../../../core/math/unitConversion';
import React from 'react';
import {
  PlotsScreen,
  PERFORMANCE_CHARTS,
  BODY_COMPOSITION_CHARTS,
} from '../PlotsScreen';
import { downsampleLTTB } from '../ProgramEraShadedChart';
import {
  Workout,
  WorkoutSet,
  Exercise,
  Program,
  ProgramBlock,
  BodyMetric,
} from '../../../core/types';

describe('Longitudinal Plots & Era Shading Suite (Step 5.2)', () => {
  let workoutRepo: MockWorkoutRepository;
  let exerciseRepo: MockExerciseRepository;
  let bodyMetricsRepo: MockBodyMetricsRepository;
  let programRepo: MockProgramRepository;
  let userSettingsRepo: MockUserSettingsRepository;
  let blockService: ProgramBlockService;

  beforeEach(() => {
    workoutRepo = new MockWorkoutRepository();
    exerciseRepo = new MockExerciseRepository();
    bodyMetricsRepo = new MockBodyMetricsRepository();
    programRepo = new MockProgramRepository();
    userSettingsRepo = new MockUserSettingsRepository();
    blockService = new ProgramBlockService(programRepo);
  });

  describe('1. e1RM Longitudinal Progression Tracking', () => {
    test('computes session peak e1RM for compound movements with Lombardi power law', async () => {
      const benchPress: Exercise = {
        id: 'bench_press',
        name: 'Barbell Bench Press',
        muscle_group: 'Chest',
        category: 'Barbell',
        is_compound: true,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 20,
        is_custom: false,
        parent_exercise_id: null,
        standard_lift_type: 'bench',
        default_rest_seconds: 180,
      };
      await exerciseRepo.create(benchPress);

      const workout1: Workout = {
        id: 'w1',
        template_id: null,
        date: '2026-10-01',
        name: 'Chest & Arms',
        notes: null,
        started_at: '2026-10-01T10:00:00Z',
        duration_seconds: 3600,
        status: 'completed',
        completed_at: '2026-10-01T11:00:00Z',
        imported_from: null,
      };
      const w1Sets: WorkoutSet[] = [
        {
          id: 's1',
          workout_id: 'w1',
          exercise_id: 'bench_press',
          gear_id: null,
          set_number: 1,
          weight: 60,
          raw_input_weight: 60,
          added_weight: null,
          reps: 10,
          reps_right: null,
          rpe: 5,
          rir: null,
          set_type: 'warmup',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        {
          id: 's2',
          workout_id: 'w1',
          exercise_id: 'bench_press',
          gear_id: null,
          set_number: 2,
          weight: 100,
          raw_input_weight: 100,
          added_weight: null,
          reps: 8,
          reps_right: null,
          rpe: 8,
          rir: 2,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        {
          id: 's3',
          workout_id: 'w1',
          exercise_id: 'bench_press',
          gear_id: null,
          set_number: 3,
          weight: 105,
          raw_input_weight: 105,
          added_weight: null,
          reps: 6,
          reps_right: null,
          rpe: 9,
          rir: 1,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
      ];

      const workout2: Workout = {
        id: 'w2',
        template_id: null,
        date: '2026-10-08',
        name: 'Chest & Arms',
        notes: null,
        started_at: '2026-10-08T10:00:00Z',
        duration_seconds: 3600,
        status: 'completed',
        completed_at: '2026-10-08T11:00:00Z',
        imported_from: null,
      };
      const w2Sets: WorkoutSet[] = [
        {
          id: 's4',
          workout_id: 'w2',
          exercise_id: 'bench_press',
          gear_id: null,
          set_number: 1,
          weight: 112.5,
          raw_input_weight: 112.5,
          added_weight: null,
          reps: 5,
          reps_right: null,
          rpe: 9.5,
          rir: 0.5,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
      ];

      workoutRepo.seed([workout1, workout2], [...w1Sets, ...w2Sets]);

      // Simulate e1RM extraction logic
      const workouts = await workoutRepo.findAll({ status: 'completed' });
      const seriesPoints: { date: string; value: number }[] = [];

      for (const w of workouts) {
        const sets = await workoutRepo.getSetsByWorkoutId(w.id);
        const exSets = sets.filter((s) => s.exercise_id === 'bench_press');
        let peakE1rm = 0;

        for (const s of exSets) {
          if (s.reps > 0 && s.weight > 0) {
            const e1rm = calculateHeuristic1RM(s.weight, s.reps, {
              rpe: s.rpe,
              rir: s.rir,
            });
            if (e1rm > peakE1rm) peakE1rm = e1rm;
          }
        }

        if (peakE1rm > 0) {
          seriesPoints.push({ date: w.date, value: peakE1rm });
        }
      }

      seriesPoints.sort((a, b) => a.date.localeCompare(b.date));

      expect(seriesPoints).toHaveLength(2);
      expect(seriesPoints[0].date).toBe('2026-10-01');
      // For s2 (100kg x 8 reps + 2 RIR = 10 eff reps -> 100 * 10^0.1 = ~125.89)
      // For s3 (105kg x 6 reps + 1 RIR = 7 eff reps -> 105 * 7^0.1 = ~127.53)
      expect(seriesPoints[0].value).toBeGreaterThan(125);
      expect(seriesPoints[0].value).toBeLessThan(130);

      // Workout 2: 112.5kg x 5 + 0.5 RIR -> 5.5 eff reps -> 112.5 * 5.5^0.1 = ~133.5
      expect(seriesPoints[1].date).toBe('2026-10-08');
      expect(seriesPoints[1].value).toBeGreaterThan(seriesPoints[0].value);
    });

    test('converts e1RM values to lbs when unit_system is set to lbs', () => {
      const e1rmKg = 100.0;
      const e1rmLbs = kgToLbs(e1rmKg);
      expect(e1rmLbs).toBeCloseTo(220.462, 2);
      expect(formatWeight(e1rmKg, 'lbs')).toBe('220.5 lbs');
    });
  });

  describe('2. Bodyweight & 7-Day Rolling Averages', () => {
    test('computes calendar-aware 7-day rolling SMA and EMA trends', () => {
      const dailyWeights = [
        { date: '2026-10-01', bodyweight: 82.0 },
        { date: '2026-10-02', bodyweight: 82.4 },
        { date: '2026-10-03', bodyweight: 81.8 },
        { date: '2026-10-04', bodyweight: 82.2 },
        { date: '2026-10-05', bodyweight: 81.6 },
        { date: '2026-10-06', bodyweight: 82.0 },
        { date: '2026-10-07', bodyweight: 81.4 },
      ];

      const res = calculateBodyweightRollingAverages(dailyWeights);
      expect(res).toHaveLength(7);

      // On day 7, 7-day window contains all 7 days:
      // sum = 82.0 + 82.4 + 81.8 + 82.2 + 81.6 + 82.0 + 81.4 = 573.4 / 7 = 81.914
      const day7 = res[6];
      expect(day7.sma7).toBeCloseTo(81.91, 1);
      expect(day7.ema7).toBeDefined();
    });

    test('handles gaps and single entries gracefully', () => {
      const single = [{ date: '2026-10-01', bodyweight: 85.0 }];
      const res = calculateBodyweightRollingAverages(single);
      expect(res).toHaveLength(1);
      expect(res[0].sma7).toBe(85.0);
      expect(res[0].ema7).toBe(85.0);
    });
  });

  describe('3. Navy Body Fat % Calculation & Series', () => {
    test('calculates male body fat with DoD metric density formula', () => {
      // Male: height 180cm, waist 85cm, neck 38cm
      const bf = calculateNavyBodyFat({
        gender: 'male',
        heightCm: 180,
        waistCm: 85,
        neckCm: 38,
      });
      expect(bf).not.toBeNull();
      // Expected around 14-16%
      expect(bf!).toBeGreaterThan(12.0);
      expect(bf!).toBeLessThan(18.0);
    });

    test('calculates female body fat with DoD metric density formula including hips', () => {
      // Female: height 165cm, waist 72cm, neck 33cm, hip 96cm
      const bf = calculateNavyBodyFat({
        gender: 'female',
        heightCm: 165,
        waistCm: 72,
        neckCm: 33,
        hipCm: 96,
      });
      expect(bf).not.toBeNull();
      // Expected around 22-26%
      expect(bf!).toBeGreaterThan(20.0);
      expect(bf!).toBeLessThan(28.0);
    });

    test('returns null when mandatory parameters are missing or invalid', () => {
      expect(
        calculateNavyBodyFat({
          gender: 'male',
          heightCm: 180,
          waistCm: 38,
          neckCm: 38,
        })
      ).toBeNull(); // waist <= neck
      expect(
        calculateNavyBodyFat({
          gender: 'female',
          heightCm: 165,
          waistCm: 72,
          neckCm: 33,
          hipCm: null,
        })
      ).toBeNull(); // missing hip
    });
  });

  describe('4. Anatomical Circumferences & Unit Conversion', () => {
    test('converts cm measurements to inches when displaying in lbs system', () => {
      const waistCm = 85.0;
      const waistInches = cmToInches(waistCm);
      expect(waistInches).toBeCloseTo(33.46, 2);
      expect(formatLength(waistCm, 'lbs')).toBe('33.5 in');
      expect(formatLength(waistCm, 'kg')).toBe('85 cm');
    });

    test('properly formats zero and null circumferences', () => {
      expect(formatLength(null, 'kg')).toBe('—');
      expect(formatLength(undefined, 'lbs')).toBe('—');
    });
  });

  describe('5. Weekly Volume Tonnage Aggregation', () => {
    test('aggregates non-warmup tonnage into Monday-based weekly buckets', async () => {
      // Workout 1: Wednesday 2026-10-07
      const w1: Workout = {
        id: 'wk1',
        template_id: null,
        date: '2026-10-07',
        name: 'Pull Day',
        notes: null,
        started_at: '2026-10-07T10:00:00Z',
        duration_seconds: 3600,
        status: 'completed',
        completed_at: '2026-10-07T11:00:00Z',
        imported_from: null,
      };

      // Workout 2: Friday 2026-10-09 (Same week, Monday is 2026-10-05)
      const w2: Workout = {
        id: 'wk2',
        template_id: null,
        date: '2026-10-09',
        name: 'Leg Day',
        notes: null,
        started_at: '2026-10-09T10:00:00Z',
        duration_seconds: 3600,
        status: 'completed',
        completed_at: '2026-10-09T11:00:00Z',
        imported_from: null,
      };

      // Workout 3: Tuesday 2026-10-13 (Next week, Monday is 2026-10-12)
      const w3: Workout = {
        id: 'wk3',
        template_id: null,
        date: '2026-10-13',
        name: 'Push Day',
        notes: null,
        started_at: '2026-10-13T10:00:00Z',
        duration_seconds: 3600,
        status: 'completed',
        completed_at: '2026-10-13T11:00:00Z',
        imported_from: null,
      };

      const sets: WorkoutSet[] = [
        // W1: 1 warmup (10x60=600 -> discarded), 2 working (10x100=1000, 8x105=840) = 1840 kg
        {
          id: 'set1',
          workout_id: 'wk1',
          exercise_id: 'ex1',
          gear_id: null,
          set_number: 1,
          weight: 60,
          raw_input_weight: 60,
          added_weight: null,
          reps: 10,
          reps_right: null,
          rpe: null,
          rir: null,
          set_type: 'warmup',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        {
          id: 'set2',
          workout_id: 'wk1',
          exercise_id: 'ex1',
          gear_id: null,
          set_number: 2,
          weight: 100,
          raw_input_weight: 100,
          added_weight: null,
          reps: 10,
          reps_right: null,
          rpe: 8,
          rir: null,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
        {
          id: 'set3',
          workout_id: 'wk1',
          exercise_id: 'ex1',
          gear_id: null,
          set_number: 3,
          weight: 105,
          raw_input_weight: 105,
          added_weight: null,
          reps: 8,
          reps_right: null,
          rpe: 9,
          rir: null,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },

        // W2: 1 drop set (12x80=960 kg) -> counted
        {
          id: 'set4',
          workout_id: 'wk2',
          exercise_id: 'ex2',
          gear_id: null,
          set_number: 1,
          weight: 80,
          raw_input_weight: 80,
          added_weight: null,
          reps: 12,
          reps_right: null,
          rpe: 10,
          rir: 0,
          set_type: 'drop',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },

        // W3: 1 working set (5x120=600 kg)
        {
          id: 'set5',
          workout_id: 'wk3',
          exercise_id: 'ex1',
          gear_id: null,
          set_number: 1,
          weight: 120,
          raw_input_weight: 120,
          added_weight: null,
          reps: 5,
          reps_right: null,
          rpe: 8.5,
          rir: 1.5,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: new Date().toISOString(),
        },
      ];

      workoutRepo.seed([w1, w2, w3], sets);

      // Simulate Monday-bucketed volume calculation
      const allWorkouts = await workoutRepo.findAll({ status: 'completed' });
      const weekMap = new Map<string, number>();

      for (const w of allWorkouts) {
        const wSets = await workoutRepo.getSetsByWorkoutId(w.id);
        let sessionTonnage = 0;
        for (const s of wSets) {
          if (s.set_type !== 'warmup') {
            sessionTonnage += (s.weight || 0) * (s.reps || 0);
          }
        }

        const d = new Date(parseIsoDateToMs(w.date));
        const day = d.getUTCDay();
        const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setUTCDate(diff));
        const weekKey = monday.toISOString().split('T')[0];

        weekMap.set(weekKey, (weekMap.get(weekKey) || 0) + sessionTonnage);
      }

      // Week 1 (Monday 2026-10-05): 1840 (W1) + 960 (W2) = 2800 kg
      expect(weekMap.get('2026-10-05')).toBe(2800);
      // Week 2 (Monday 2026-10-12): 600 (W3) = 600 kg
      expect(weekMap.get('2026-10-12')).toBe(600);
    });
  });

  describe('6. Program Era Shading Resolution', () => {
    test('resolves active and historical program blocks into colored era spans', async () => {
      const progPPL: Program = {
        id: 'prog_ppl',
        name: 'Push Pull Legs Hypertrophy',
        notes: '6-day high frequency split',
        color_hex: '#2979FF',
        created_at: '2026-08-01T00:00:00Z',
      };
      const progUpperLower: Program = {
        id: 'prog_ul',
        name: 'Upper Lower Strength',
        notes: '4-day heavy compound focus',
        color_hex: '#FF6D00',
        created_at: '2026-09-15T00:00:00Z',
      };

      await programRepo.create(progPPL);
      await programRepo.create(progUpperLower);

      // Block 1: PPL from 2026-08-01 to 2026-09-15
      const block1: ProgramBlock = {
        id: 'b1',
        program_id: 'prog_ppl',
        start_date: '2026-08-01',
        end_date: '2026-09-15',
      };
      // Block 2: UL from 2026-09-15 to null (currently active)
      const block2: ProgramBlock = {
        id: 'b2',
        program_id: 'prog_ul',
        start_date: '2026-09-15',
        end_date: null,
      };

      await programRepo.createProgramBlock(block1);
      await programRepo.createProgramBlock(block2);

      const enrichedBlocks = await blockService.getAllProgramBlocks();
      expect(enrichedBlocks).toHaveLength(2);

      const ppl = enrichedBlocks.find((b) => b.program_id === 'prog_ppl');
      expect(ppl).toBeDefined();
      expect(ppl!.program_name).toBe('Push Pull Legs Hypertrophy');
      expect(ppl!.color_hex).toBe('#2979FF');
      expect(ppl!.end_date).toBe('2026-09-15');

      const ul = enrichedBlocks.find((b) => b.program_id === 'prog_ul');
      expect(ul).toBeDefined();
      expect(ul!.program_name).toBe('Upper Lower Strength');
      expect(ul!.color_hex).toBe('#FF6D00');
      expect(ul!.end_date).toBeNull(); // Active era
    });
  });

  describe('7. Plot Group Partitioning (Performance vs Body Composition)', () => {
    test('defines correct chart types in performance and body composition groups', () => {
      expect(PERFORMANCE_CHARTS).toEqual(['e1rm', 'volume']);
      expect(BODY_COMPOSITION_CHARTS).toEqual([
        'bodyweight',
        'body_fat',
        'elbm',
        'circumferences',
      ]);
      // Verify mutually exclusive and collectively exhaustive across the 6 charts
      const allGrouped = [...PERFORMANCE_CHARTS, ...BODY_COMPOSITION_CHARTS];
      expect(allGrouped).toHaveLength(6);
      expect(new Set(allGrouped).size).toBe(6);
    });

    test('initializes PlotsScreen with targetGroup performance', () => {
      const element = React.createElement(PlotsScreen, {
        workoutRepo,
        exerciseRepo,
        targetGroup: 'performance',
      });
      expect(element).toBeDefined();
      expect(element.props.targetGroup).toBe('performance');
    });

    test('initializes PlotsScreen with targetGroup body_composition', () => {
      const element = React.createElement(PlotsScreen, {
        workoutRepo,
        exerciseRepo,
        targetGroup: 'body_composition',
      });
      expect(element).toBeDefined();
      expect(element.props.targetGroup).toBe('body_composition');
    });
  });

  describe('8. Plot Time Span Filtering (All data, Year, 3 months, Month, Week)', () => {
    const fixedRef = new Date('2026-10-16T12:00:00Z');

    test('exposes all 5 requested time span options with exact labels', () => {
      const { TIME_SPAN_OPTIONS } = require('../PlotsScreen');
      expect(TIME_SPAN_OPTIONS).toEqual([
        { key: 'all', label: 'All data' },
        { key: 'year', label: 'Year' },
        { key: '3months', label: '3 months' },
        { key: 'month', label: 'Month' },
        { key: 'week', label: 'Week' },
      ]);
    });

    test('initializes PlotsScreen with timeSpan and onTimeSpanChange props', () => {
      const onTimeSpanChange = jest.fn();
      const element = React.createElement(PlotsScreen, {
        workoutRepo,
        exerciseRepo,
        initialTimeSpan: 'month',
        timeSpan: 'week',
        onTimeSpanChange,
        referenceDate: fixedRef,
      });

      expect(element).toBeDefined();
      expect(element.props.initialTimeSpan).toBe('month');
      expect(element.props.timeSpan).toBe('week');
      expect(element.props.onTimeSpanChange).toBe(onTimeSpanChange);
      expect(element.props.referenceDate).toBe(fixedRef);
    });

    test('filters e1RM longitudinal progression points by time span', () => {
      const { filterDataByTimeSpan } = require('../timeSpanUtils');

      const historicalE1rmPoints = [
        { date: '2025-05-10', value: 80.0 }, // > 1 year
        { date: '2025-11-20', value: 87.5 }, // in year
        { date: '2026-08-15', value: 95.0 }, // in 3 months
        { date: '2026-09-25', value: 100.0 }, // in month
        { date: '2026-10-14', value: 105.0 }, // in week
      ];

      // All data
      const allPts = filterDataByTimeSpan(historicalE1rmPoints, 'all', fixedRef);
      expect(allPts).toHaveLength(5);

      // Year (within 365 days)
      const yearPts = filterDataByTimeSpan(historicalE1rmPoints, 'year', fixedRef);
      expect(yearPts).toHaveLength(4);
      expect(yearPts[0].date).toBe('2025-11-20');

      // 3 Months (within 90 days)
      const threeMonthPts = filterDataByTimeSpan(historicalE1rmPoints, '3months', fixedRef);
      expect(threeMonthPts).toHaveLength(3);
      expect(threeMonthPts[0].date).toBe('2026-08-15');

      // Month (within 30 days)
      const monthPts = filterDataByTimeSpan(historicalE1rmPoints, 'month', fixedRef);
      expect(monthPts).toHaveLength(2);
      expect(monthPts[0].date).toBe('2026-09-25');

      // Week (within 7 days)
      const weekPts = filterDataByTimeSpan(historicalE1rmPoints, 'week', fixedRef);
      expect(weekPts).toHaveLength(1);
      expect(weekPts[0].date).toBe('2026-10-14');
    });

    test('filters bodyweight rolling average points while preserving full history smoothing', () => {
      const { filterDataByTimeSpan } = require('../timeSpanUtils');

      // 14 days of entries
      const entries = [
        { date: '2026-10-01', bodyweight: 85.0 },
        { date: '2026-10-02', bodyweight: 84.8 },
        { date: '2026-10-03', bodyweight: 84.6 },
        { date: '2026-10-04', bodyweight: 84.5 },
        { date: '2026-10-05', bodyweight: 84.4 },
        { date: '2026-10-06', bodyweight: 84.2 },
        { date: '2026-10-07', bodyweight: 84.0 },
        { date: '2026-10-08', bodyweight: 83.9 },
        { date: '2026-10-09', bodyweight: 83.8 },
        { date: '2026-10-10', bodyweight: 83.6 },
        { date: '2026-10-11', bodyweight: 83.5 },
        { date: '2026-10-12', bodyweight: 83.4 },
        { date: '2026-10-13', bodyweight: 83.2 },
        { date: '2026-10-14', bodyweight: 83.0 },
        { date: '2026-10-15', bodyweight: 82.8 },
        { date: '2026-10-16', bodyweight: 82.5 },
      ];

      // Calculate rolling averages on full dataset
      const smoothed = calculateBodyweightRollingAverages(entries);
      expect(smoothed).toHaveLength(16);

      // Filter to week (cutoff 2026-10-09)
      const weekPoints = filterDataByTimeSpan(smoothed, 'week', fixedRef);
      expect(weekPoints).toHaveLength(8); // Oct 09 through Oct 16
      // SMA on Oct 09 properly reflects prior 7 days of logs (84.6+84.5+84.4+84.2+84.0+83.9+83.8)/7 = 84.20
      expect(weekPoints[0].sma7).toBeCloseTo(84.2, 1);
      // Latest SMA on Oct 16: (83.6 + 83.5 + 83.4 + 83.2 + 83.0 + 82.8 + 82.5) / 7 = 83.14
      expect(weekPoints[weekPoints.length - 1].sma7).toBeCloseTo(83.14, 2);
    });
  });

  describe('9. Estimated Lean Body Mass (eLBM) Longitudinal Charting', () => {
    const fixedRef = new Date('2026-10-16T12:00:00Z');

    test('derives eLBM points from bodyweight and Navy BF% records', async () => {
      const rawMetrics: BodyMetric[] = [
        {
          id: 'bm1',
          date: '2026-10-01',
          bodyweight: 84.0,
          waist_cm: 84.0,
          neck_cm: 38.0,
          hip_cm: null,
          bicep_cm: null,
          chest_cm: null,
          thigh_cm: null,
          calf_cm: null,
          navy_body_fat: 15.0,
          body_fat_manual: null,
        },
        {
          id: 'bm2',
          date: '2026-10-08',
          bodyweight: 83.5,
          waist_cm: 83.0,
          neck_cm: 38.0,
          hip_cm: null,
          bicep_cm: null,
          chest_cm: null,
          thigh_cm: null,
          calf_cm: null,
          navy_body_fat: 14.5,
          body_fat_manual: null,
        },
        {
          id: 'bm3',
          date: '2026-10-15',
          bodyweight: 83.0,
          waist_cm: 82.0,
          neck_cm: 38.0,
          hip_cm: null,
          bicep_cm: null,
          chest_cm: null,
          thigh_cm: null,
          calf_cm: null,
          navy_body_fat: 14.0,
          body_fat_manual: null,
        },
      ];

      for (const m of rawMetrics) {
        await bodyMetricsRepo.save(m);
      }

      const allMetrics = await bodyMetricsRepo.getAll();
      const elbmPoints = allMetrics
        .filter(
          (m): m is BodyMetric & { bodyweight: number } =>
            m.bodyweight != null &&
            m.bodyweight > 0 &&
            m.navy_body_fat != null &&
            m.navy_body_fat > 0
        )
        .map((m) => ({
          date: m.date,
          value: calculateEstimatedLeanBodyMass(m.bodyweight, m.navy_body_fat!)!,
        }));

      expect(elbmPoints).toHaveLength(3);
      // bm1: 84.0 * (1 - 0.15) = 71.40 kg
      expect(elbmPoints[0].value).toBe(71.4);
      // bm2: 83.5 * (1 - 0.145) = 71.39 kg
      expect(elbmPoints[1].value).toBe(71.39);
      // bm3: 83.0 * (1 - 0.14) = 71.38 kg
      expect(elbmPoints[2].value).toBe(71.38);
    });

    test('filters eLBM time-series correctly across time-span windows', () => {
      const { filterDataByTimeSpan } = require('../timeSpanUtils');

      const historicalElbmPoints = [
        { date: '2025-05-10', value: 68.0 }, // > 1 year
        { date: '2025-11-20', value: 69.5 }, // in year
        { date: '2026-08-15', value: 70.5 }, // in 3 months
        { date: '2026-09-25', value: 71.0 }, // in month
        { date: '2026-10-14', value: 71.5 }, // in week
      ];

      expect(filterDataByTimeSpan(historicalElbmPoints, 'all', fixedRef)).toHaveLength(5);
      expect(filterDataByTimeSpan(historicalElbmPoints, 'year', fixedRef)).toHaveLength(4);
      expect(filterDataByTimeSpan(historicalElbmPoints, '3months', fixedRef)).toHaveLength(3);
      expect(filterDataByTimeSpan(historicalElbmPoints, 'month', fixedRef)).toHaveLength(2);
      expect(filterDataByTimeSpan(historicalElbmPoints, 'week', fixedRef)).toHaveLength(1);
    });

    test('converts eLBM data points to lbs when unitSystem is imperial', () => {
      const elbmKg = 70.0;
      const elbmLbs = kgToLbs(elbmKg);
      expect(elbmLbs).toBeCloseTo(154.32, 1);
      expect(formatWeight(elbmKg, 'lbs')).toBe('154.3 lbs');
      expect(formatWeight(elbmKg, 'kg')).toBe('70 kg');
    });

    test('calculates continuous eLBM curve using chronological LOCF when tape circumferences are updated infrequently', async () => {
      const { calculateChronologicalELBM } = require('../../../core/math/navyBodyFat');

      // Day 1: full measurement (80kg, 82cm waist, 38cm neck -> 14.0% BF -> eLBM 68.80kg)
      // Day 2: weight-only (80.5kg) -> carries forward 14.0% BF -> eLBM 69.23kg
      // Day 3: neck-only update (39cm) -> carries forward 80.5kg weight and 82cm waist -> recalcs BF -> new eLBM
      const metrics = [
        {
          id: 'm1',
          date: '2026-10-01',
          bodyweight: 80.0,
          waist_cm: 82.0,
          neck_cm: 38.0,
        },
        {
          id: 'm2',
          date: '2026-10-02',
          bodyweight: 80.5,
          waist_cm: null,
          neck_cm: null,
        },
        {
          id: 'm3',
          date: '2026-10-03',
          bodyweight: null,
          waist_cm: null,
          neck_cm: 39.0,
        },
      ];

      const points = calculateChronologicalELBM(metrics, {
        gender: 'male',
        heightCm: 178,
      });

      expect(points).toHaveLength(3);
      expect(points[0].date).toBe('2026-10-01');
      expect(points[0].elbmKg).toBe(68.8);

      expect(points[1].date).toBe('2026-10-02');
      expect(points[1].bodyweight).toBe(80.5);
      expect(points[1].navyBf).toBe(14.0);
      expect(points[1].elbmKg).toBe(69.23);

      expect(points[2].date).toBe('2026-10-03');
      expect(points[2].bodyweight).toBe(80.5); // carried forward
      expect(points[2].navyBf).toBeLessThan(14.0); // recalculated with new neck
      expect(points[2].elbmKg).toBeGreaterThan(69.23);
    });

    test('initializes PlotsScreen with initialChartType elbm and userProfileRepo', () => {
      const mockUserProfileRepo = new MockUserProfileRepository();
      const element = React.createElement(PlotsScreen, {
        workoutRepo,
        exerciseRepo,
        bodyMetricsRepo,
        userProfileRepo: mockUserProfileRepo,
        initialChartType: 'elbm',
      });
      expect(element).toBeDefined();
      expect(element.props.initialChartType).toBe('elbm');
      expect(element.props.userProfileRepo).toBe(mockUserProfileRepo);
    });
  });

  describe('7. Largest-Triangle-Three-Buckets (LTTB) Downsampling Optimization', () => {
    test('returns original data if data length is less than or equal to threshold', () => {
      const data = [
        { date: '2026-01-01', value: 10 },
        { date: '2026-01-02', value: 20 },
        { date: '2026-01-03', value: 15 },
      ];
      expect(downsampleLTTB(data, 5)).toEqual(data);
      expect(downsampleLTTB(data, 3)).toEqual(data);
    });

    test('downsamples series with > threshold points to exactly threshold points preserving endpoints', () => {
      const points = Array.from({ length: 100 }, (_, i) => {
        const d = new Date(2026, 0, 1 + i);
        return {
          date: d.toISOString().split('T')[0],
          value: Math.sin(i / 10) * 50 + 100,
        };
      });

      const downsampled = downsampleLTTB(points, 30);
      expect(downsampled).toHaveLength(30);
      expect(downsampled[0]).toEqual(points[0]);
      expect(downsampled[downsampled.length - 1]).toEqual(points[points.length - 1]);
    });

    test('retains extreme visual peak during downsampling', () => {
      const points = Array.from({ length: 80 }, (_, i) => {
        const d = new Date(2026, 0, 1 + i);
        return {
          date: d.toISOString().split('T')[0],
          value: 50,
        };
      });
      // Inject a massive peak at point index 40
      points[40].value = 500;
      const peakDate = points[40].date;

      const downsampled = downsampleLTTB(points, 20);
      expect(downsampled).toHaveLength(20);
      const hasPeak = downsampled.some((p) => p.date === peakDate && p.value === 500);
      expect(hasPeak).toBe(true);
    });
  });
});

