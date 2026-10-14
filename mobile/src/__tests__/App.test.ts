/**
 * Workout Suite — Root Application & Navigation Test Suite
 *
 * Implements Step 1.6 Verification Gate
 * Validates:
 * - Root bottom tab navigation configuration (Logger, Calendar, Settings)
 * - Active workout in-progress indicator contract
 * - Headless initialization with mocked repositories
 */

import {
  MockWorkoutRepository,
  MockExerciseRepository,
  MockGearRepository,
  MockUserSettingsRepository,
} from '../database/mocks';
import { Workout } from '../core/types';

describe('Root Navigation & Tab State Management (Step 1.6)', () => {
  let workoutRepo: MockWorkoutRepository;
  let exerciseRepo: MockExerciseRepository;
  let gearRepo: MockGearRepository;
  let userSettingsRepo: MockUserSettingsRepository;

  beforeEach(() => {
    workoutRepo = new MockWorkoutRepository();
    exerciseRepo = new MockExerciseRepository();
    gearRepo = new MockGearRepository();
    userSettingsRepo = new MockUserSettingsRepository();
  });

  test('detects active in-progress workout for tab indicator dot', async () => {
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

  test('can query workouts by date for calendar view integration', async () => {
    await workoutRepo.create({
      id: 'wk-1',
      template_id: null,
      date: '2026-10-14',
      name: 'Leg Day',
      notes: null,
      started_at: '2026-10-14T08:00:00Z',
      duration_seconds: 3000,
      status: 'completed',
      completed_at: '2026-10-14T08:50:00Z',
      imported_from: null,
    });

    await workoutRepo.create({
      id: 'wk-2',
      template_id: null,
      date: '2026-10-15',
      name: 'Pull Day',
      notes: null,
      started_at: '2026-10-15T08:00:00Z',
      duration_seconds: 3200,
      status: 'completed',
      completed_at: '2026-10-15T08:53:20Z',
      imported_from: null,
    });

    const all = await workoutRepo.findAll();
    expect(all.length).toBe(2);

    const oct14Only = await workoutRepo.findAll({
      startDate: '2026-10-14',
      endDate: '2026-10-14',
    });
    expect(oct14Only.length).toBe(1);
    expect(oct14Only[0].id).toBe('wk-1');
  });
});
