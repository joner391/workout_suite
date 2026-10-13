import {
  Exercise,
  WorkoutSet,
  WeightUnit,
  IntensityMetric,
  LoadMode,
  SetType,
  WorkoutStatus,
} from '../index';

describe('Core Types Smoke Test', () => {
  it('should instantiate an Exercise entity matching domain types', () => {
    const exercise: Exercise = {
      id: 'ex-bench-press',
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
      default_rest_seconds: 180,
    };

    expect(exercise.id).toBe('ex-bench-press');
    expect(exercise.is_compound).toBe(true);
    expect(exercise.default_bar_weight_kg).toBe(20.0);
  });

  it('should instantiate a WorkoutSet entity conforming to ADR-026 dual-weight persistence', () => {
    const set: WorkoutSet = {
      id: 'set-001',
      workout_id: 'wo-101',
      exercise_id: 'ex-bench-press',
      gear_id: null,
      set_number: 1,
      weight: 100.0,
      raw_input_weight: 100.0,
      added_weight: null,
      reps: 5,
      reps_right: null,
      rpe: 8.5,
      rir: 1.5,
      set_type: 'working',
      set_notes: 'Smooth bar speed',
      exercise_group_id: null,
      created_at: '2026-10-13T19:00:00Z',
    };

    expect(set.weight).toBe(100.0);
    expect(set.raw_input_weight).toBe(100.0);
    expect(set.set_type).toBe('working');
  });

  it('should validate unit and metric types', () => {
    const unitKg: WeightUnit = 'kg';
    const unitLbs: WeightUnit = 'lbs';
    const rpeMetric: IntensityMetric = 'RPE';
    const rirMetric: IntensityMetric = 'RIR';
    const loadMode: LoadMode = 'per_hand';
    const setType: SetType = 'warmup';
    const status: WorkoutStatus = 'in_progress';

    expect(unitKg).toBe('kg');
    expect(unitLbs).toBe('lbs');
    expect(rpeMetric).toBe('RPE');
    expect(rirMetric).toBe('RIR');
    expect(loadMode).toBe('per_hand');
    expect(setType).toBe('warmup');
    expect(status).toBe('in_progress');
  });
});
