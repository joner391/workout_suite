/**
 * Workout Suite — Mechanical Load Normalization Engine
 *
 * Implements ADR-026: Mechanical Load Normalization and Persistence Contract
 * Implements ADR-018: Total System Load Modeling for Bodyweight and Assisted Exercises
 * Implements ADR-021: Dumbbell Per-Hand Input & Unilateral Limb Data Modeling
 * Implements ADR-025: Equipment Mechanical Advantage Profiles
 *
 * Persists dual-field weights in workout_sets:
 * 1. `weight`: Normalized effective mechanical load in kilograms (used for e1RM, volume tonnage, Banister model, Kalman filter).
 * 2. `raw_input_weight`: Exact value entered by the lifter (used for UI display and ghost value pre-filling).
 */

import {
  LoadMode,
  NormalizedLoadResult,
  Exercise,
  GearInventory,
} from '../types';

export interface LoadNormalizerInput {
  /**
   * The exact numerical value typed by the lifter in the interface.
   * For dumbbells: weight of a single implement (e.g. 30 kg).
   * For cables: weight on the pin stack (e.g. 50 kg).
   * For bodyweight: external added or assisted weight delta (e.g. +10 kg, -15 kg, or 0).
   * For barbell/machines: total external load.
   */
  rawInputWeightKg: number;

  /**
   * Exercise loading mode: 'total' (barbell/machine) or 'per_hand' (dumbbell).
   */
  loadMode?: LoadMode;

  /**
   * Whether the movement is a bodyweight/assisted exercise (e.g. pull-up, dip).
   */
  isBodyweight?: boolean;

  /**
   * Athlete's active bodyweight in kilograms (required when isBodyweight is true).
   */
  bodyweightKg?: number | null;

  /**
   * Explicit external added/assisted weight delta in kg.
   * If omitted and isBodyweight is true, rawInputWeightKg is treated as the added weight.
   */
  addedWeightKg?: number | null;

  /**
   * Mechanical advantage ratio of the cable pulley / machine.
   * Default 1.0 (1:1 ratio). Functional trainers typically use 0.5 (2:1 ratio).
   */
  cableRatio?: number | null;
}

export type ExerciseLoadConfig = Pick<
  Exercise,
  'load_mode' | 'is_bodyweight' | 'default_cable_ratio'
>;

export type GearLoadConfig = Pick<GearInventory, 'cable_ratio' | 'tare_weight_kg'>;

/**
 * Normalizes user-entered weight into canonical mechanical effective load and raw input.
 *
 * @param input Parameters defining user input and mechanical configuration.
 * @returns NormalizedLoadResult containing effectiveWeightKg, rawInputWeightKg, and addedWeightKg.
 */
export function normalizeLoad(input: LoadNormalizerInput): NormalizedLoadResult {
  const rawInput = typeof input.rawInputWeightKg === 'number' && !isNaN(input.rawInputWeightKg)
    ? input.rawInputWeightKg
    : 0;

  const isBodyweight = Boolean(input.isBodyweight);
  const loadMode: LoadMode = input.loadMode ?? 'total';
  const cableRatio = typeof input.cableRatio === 'number' && !isNaN(input.cableRatio) && input.cableRatio > 0
    ? input.cableRatio
    : 1.0;

  // Case 1: Bodyweight and Assisted Exercises (ADR-018)
  if (isBodyweight) {
    const bw = typeof input.bodyweightKg === 'number' && !isNaN(input.bodyweightKg)
      ? Math.max(0, input.bodyweightKg)
      : 0;

    // Added weight delta: either explicitly passed or equal to rawInputWeightKg
    const addedDelta = typeof input.addedWeightKg === 'number' && !isNaN(input.addedWeightKg)
      ? input.addedWeightKg
      : rawInput;

    // Total effective system load = Athlete's bodyweight + external added weight (or - assistance)
    const effectiveSystemLoad = Math.max(0, bw + addedDelta);

    return {
      effectiveWeightKg: effectiveSystemLoad,
      rawInputWeightKg: rawInput,
      addedWeightKg: addedDelta,
    };
  }

  // Case 2: Free weights and Cable machines (with composable per-hand & pulley ratio support)
  let multiplier = 1.0;
  if (loadMode === 'per_hand') {
    multiplier *= 2.0;
  }
  if (cableRatio !== 1.0) {
    multiplier *= cableRatio;
  }

  return {
    effectiveWeightKg: Math.max(0, rawInput * multiplier),
    rawInputWeightKg: rawInput,
    addedWeightKg: null,
  };
}

/**
 * Convenience helper to normalize loads directly from Exercise and optional Gear entities.
 */
export function normalizeExerciseLoad(
  rawInputWeightKg: number,
  exercise: ExerciseLoadConfig,
  gear?: GearLoadConfig | null,
  bodyweightKg?: number | null,
  addedWeightKg?: number | null
): NormalizedLoadResult {
  const effectiveRatio = gear?.cable_ratio ?? exercise.default_cable_ratio ?? 1.0;

  return normalizeLoad({
    rawInputWeightKg,
    loadMode: exercise.load_mode,
    isBodyweight: exercise.is_bodyweight,
    cableRatio: effectiveRatio,
    bodyweightKg,
    addedWeightKg,
  });
}

/**
 * Reverse-calculates expected raw input from an effective load (used for display when raw is not stored).
 */
export function denormalizeDisplayWeight(
  effectiveWeightKg: number,
  exercise: ExerciseLoadConfig,
  gear?: GearLoadConfig | null,
  bodyweightKg?: number | null
): number {
  if (typeof effectiveWeightKg !== 'number' || isNaN(effectiveWeightKg)) {
    return 0;
  }

  if (exercise.is_bodyweight) {
    const bw = bodyweightKg ?? 0;
    return effectiveWeightKg - bw;
  }

  if (exercise.load_mode === 'per_hand') {
    return effectiveWeightKg / 2.0;
  }

  const ratio = gear?.cable_ratio ?? exercise.default_cable_ratio ?? 1.0;
  if (ratio > 0 && ratio !== 1.0) {
    return effectiveWeightKg / ratio;
  }

  return effectiveWeightKg;
}
