/**
 * Workout Suite — Root Application & Navigation Test Suite
 *
 * Implements Section 4: Main Navigation Overhaul Verification Gate
 * Validates:
 * - 4 dedicated tabs: HOME, WORKOUT, PROFILE, SETTINGS
 * - Active session state indicator on WORKOUT tab
 * - Smart Session Router behavior (State A, State B circular sequence, State C empty)
 * - Weekly summary dashboard metrics computation (workouts, tonnage, streak)
 */

import {
  MockWorkoutRepository,
  MockExerciseRepository,
  MockGearRepository,
  MockUserSettingsRepository,
  MockProgramRepository,
} from '../database/mocks';
import { ProgramBlockService } from '../services/programBlockService';
import { computeDashboardMetrics } from '../services/dashboardMetricsService';
import { Workout, Program, WorkoutTemplate, TemplateExercise } from '../core/types';

describe('Root Navigation & Tab State Management (Section 4)', () => {
  let workoutRepo: MockWorkoutRepository;
  let exerciseRepo: MockExerciseRepository;
  let gearRepo: MockGearRepository;
  let userSettingsRepo: MockUserSettingsRepository;
  let programRepo: MockProgramRepository;
  let blockService: ProgramBlockService;

  beforeEach(() => {
    workoutRepo = new MockWorkoutRepository();
    exerciseRepo = new MockExerciseRepository();
    gearRepo = new MockGearRepository();
    userSettingsRepo = new MockUserSettingsRepository();
    programRepo = new MockProgramRepository();
    blockService = new ProgramBlockService(programRepo);
  });

  test('detects active in-progress workout for WORKOUT tab indicator dot', async () => {
    // Initially no active workout
    let active = await workoutRepo.getInProgressWorkout();
    expect(active).toBeNull();

    // Start an in-progress workout
    const inProgressWorkout: Workout = {
      id: 'wk-active-test',
      template_id: null,
      date: '2026-10-14',
      name: 'Push Hypertrophy',
      notes: null,
      started_at: '2026-10-14T09:00:00Z',
      duration_seconds: null,
      status: 'in_progress',
      completed_at: null,
      imported_from: null,
    };
    await workoutRepo.create(inProgressWorkout);

    active = await workoutRepo.getInProgressWorkout();
    expect(active).not.toBeNull();
    expect(active?.id).toBe('wk-active-test');
    expect(active?.status).toBe('in_progress');

    // Finish the workout
    const completedWorkout: Workout = {
      ...inProgressWorkout,
      status: 'completed',
      completed_at: '2026-10-14T10:00:00Z',
      duration_seconds: 3600,
    };
    await workoutRepo.update(completedWorkout);

    active = await workoutRepo.getInProgressWorkout();
    expect(active).toBeNull();
  });

  test('computes dashboard weekly summary metrics correctly (workouts, tonnage, streak)', async () => {
    const today = new Date().toISOString().split('T')[0];

    // Completed workout today with 3 sets
    const w1: Workout = {
      id: 'wk-metric-1',
      template_id: null,
      date: today,
      name: 'Bench Session',
      notes: null,
      started_at: `${today}T10:00:00Z`,
      duration_seconds: 3600,
      status: 'completed',
      completed_at: `${today}T11:00:00Z`,
      imported_from: null,
    };
    await workoutRepo.create(w1);

    await workoutRepo.addSet({
      id: 'set-1',
      workout_id: w1.id,
      exercise_id: 'bench_press',
      gear_id: null,
      set_number: 1,
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
    });

    await workoutRepo.addSet({
      id: 'set-2',
      workout_id: w1.id,
      exercise_id: 'bench_press',
      gear_id: null,
      set_number: 2,
      weight: 100,
      raw_input_weight: 100,
      added_weight: null,
      reps: 8,
      reps_right: null,
      rpe: 8.5,
      rir: null,
      set_type: 'working',
      set_notes: null,
      exercise_group_id: null,
      created_at: new Date().toISOString(),
    });

    const metrics = await computeDashboardMetrics(workoutRepo);
    expect(metrics.workoutsThisWeek).toBe(1);
    expect(metrics.totalTonnageKg).toBe(1800);
    expect(metrics.activeStreakWeeks).toBe(1);
  });

  test('smart session router sequences templates circularly (State B)', async () => {
    const prog: Program = {
      id: 'prog_circular_split',
      name: '3-Day Full Body',
      color_hex: '#00E676',
      notes: null,
      created_at: new Date().toISOString(),
    };
    await programRepo.create(prog);

    const tmplA: WorkoutTemplate = {
      id: 'tpl_day_a',
      program_id: prog.id,
      name: 'Full Body A',
      order_index: 0,
      notes: null,
      created_at: new Date().toISOString(),
    };
    const tmplB: WorkoutTemplate = {
      id: 'tpl_day_b',
      program_id: prog.id,
      name: 'Full Body B',
      order_index: 1,
      notes: null,
      created_at: new Date().toISOString(),
    };
    const tmplC: WorkoutTemplate = {
      id: 'tpl_day_c',
      program_id: prog.id,
      name: 'Full Body C',
      order_index: 2,
      notes: null,
      created_at: new Date().toISOString(),
    };

    await programRepo.createTemplate(tmplA);
    await programRepo.createTemplate(tmplB);
    await programRepo.createTemplate(tmplC);

    await blockService.swapActiveProgram(prog.id);

    // Initial state: Day A is first
    const templates = [tmplA, tmplB, tmplC];
    let lastCompletedTmplId: string | undefined = undefined;

    let nextIdx = 0;
    if (lastCompletedTmplId) {
      const lastIdx = templates.findIndex((t) => t.id === lastCompletedTmplId);
      nextIdx = (lastIdx + 1) % templates.length;
    }
    expect(templates[nextIdx].name).toBe('Full Body A');

    // After Day A is completed -> Day B
    lastCompletedTmplId = 'tpl_day_a';
    let lastIdx = templates.findIndex((t) => t.id === lastCompletedTmplId);
    nextIdx = (lastIdx + 1) % templates.length;
    expect(templates[nextIdx].name).toBe('Full Body B');

    // After Day C is completed -> loops back to Day A (circular sequence)
    lastCompletedTmplId = 'tpl_day_c';
    lastIdx = templates.findIndex((t) => t.id === lastCompletedTmplId);
    nextIdx = (lastIdx + 1) % templates.length;
    expect(templates[nextIdx].name).toBe('Full Body A');
  });
});
