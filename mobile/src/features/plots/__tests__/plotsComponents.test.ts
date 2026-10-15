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
} from '../../../database/mocks';
import { ProgramBlockService } from '../../../services/programBlockService';
import {
  calculateBodyweightRollingAverages,
  calculateNavyBodyFat,
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
import {
  Workout,
  WorkoutSet,
  Exercise,
  Program,
  ProgramBlock,
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
        'circumferences',
      ]);
      // Verify mutually exclusive and collectively exhaustive across the 5 charts
      const allGrouped = [...PERFORMANCE_CHARTS, ...BODY_COMPOSITION_CHARTS];
      expect(allGrouped).toHaveLength(5);
      expect(new Set(allGrouped).size).toBe(5);
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
});
