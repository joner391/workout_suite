/**
 * Workout Suite — Hypertrophic Effective Reps Math Engine
 *
 * Implements the Hypertrophic Effective (Stimulating) Reps model.
 *
 * Physiological Core:
 * Under submaximal loads (< 85% 1RM), only the final ~5 repetitions prior to failure
 * (RIR <= 4 / RPE >= 6.0) recruit high-threshold motor units and experience high mechanical
 * tension under slow contraction velocities.
 *
 * Rules:
 * 1. Warmup sets ('warmup') yield 0 effective reps.
 * 2. Unrated sets:
 *    - For standard 'working' sets without RPE and without RIR: yield 0 effective reps.
 *    - Marked as isRated = false for coverage disclosure (e.g. 18/22 sets rated).
 * 3. Auto-Failure / High-Fatigue Set Types:
 *    - 'amrap', 'dc', 'myorep', 'drop' sets are performed to failure or under elevated fatigue.
 *    - They default to RPE 10.0 (0 RIR) and are marked as isRated = true.
 *    - Effective reps = min(reps, 5).
 * 4. Heavy Loads (>= 85% 1RM or reps <= 5 at high intensity):
 *    - High-threshold motor units are recruited from repetition 1.
 *    - All completed reps count as effective reps (up to 5 per set).
 * 5. General Submaximal Sets:
 *    - effectiveReps = max(0, min(reps, 5 - RIR))
 */

import { SetType } from '../types';

export type VolumeLandmarkTier = 'low' | 'optimal' | 'high' | 'peak';

export interface EffectiveRepsOptions {
  rpe?: number | null;
  rir?: number | null;
  set_type?: SetType | string;
  weightKg?: number | null;
  e1rmKg?: number | null;
}

export interface EffectiveRepsResult {
  effectiveReps: number;
  isRated: boolean;
  isStimulating: boolean;
  effRpe: number | null;
  effRir: number | null;
}

/**
 * Checks if a set type intrinsically implies failure or high fatigue.
 */
export function isAutoFailureSetType(setType?: string | null): boolean {
  if (!setType) return false;
  const norm = setType.trim().toLowerCase();
  return norm === 'amrap' || norm === 'dc' || norm === 'myorep' || norm === 'drop' || norm === 'failure';
}

/**
 * Computes hypertrophic effective reps for a single set.
 */
export function calculateHypertrophicEffectiveReps(
  reps: number,
  options?: EffectiveRepsOptions
): EffectiveRepsResult {
  if (typeof reps !== 'number' || isNaN(reps) || reps <= 0) {
    return {
      effectiveReps: 0,
      isRated: false,
      isStimulating: false,
      effRpe: null,
      effRir: null,
    };
  }

  const setType = options?.set_type ?? 'working';

  // 1. Warmup sets yield 0 effective reps
  if (setType === 'warmup') {
    return {
      effectiveReps: 0,
      isRated: true,
      isStimulating: false,
      effRpe: null,
      effRir: null,
    };
  }

  // 2. Auto-Failure / High-Fatigue set types (AMRAP, DC, Myo-reps, Drop)
  if (isAutoFailureSetType(setType)) {
    let resolvedRpe = 10.0;
    let resolvedRir = 0.0;

    if (options?.rpe != null && !isNaN(options.rpe)) {
      resolvedRpe = Math.min(10.0, Math.max(0.0, options.rpe));
      resolvedRir = Math.max(0.0, 10.0 - resolvedRpe);
    } else if (options?.rir != null && !isNaN(options.rir)) {
      resolvedRir = Math.max(0.0, options.rir);
      resolvedRpe = Math.min(10.0, Math.max(0.0, 10.0 - resolvedRir));
    }

    const effectiveReps = Math.min(reps, 5);
    return {
      effectiveReps,
      isRated: true,
      isStimulating: true,
      effRpe: resolvedRpe,
      effRir: resolvedRir,
    };
  }

  // 3. Regular working sets: Check if RPE or RIR is provided
  const hasRpe = options?.rpe != null && !isNaN(options.rpe);
  const hasRir = options?.rir != null && !isNaN(options.rir);

  if (!hasRpe && !hasRir) {
    // Missing exertion signal: Omitted from effective reps per user specification
    return {
      effectiveReps: 0,
      isRated: false,
      isStimulating: false,
      effRpe: null,
      effRir: null,
    };
  }

  let resolvedRir = 0.0;
  let resolvedRpe = 10.0;

  if (hasRir) {
    resolvedRir = Math.max(0.0, options!.rir!);
    resolvedRpe = Math.min(10.0, Math.max(0.0, 10.0 - resolvedRir));
  } else if (hasRpe) {
    resolvedRpe = Math.min(10.0, Math.max(0.0, options!.rpe!));
    resolvedRir = Math.max(0.0, 10.0 - resolvedRpe);
  }

  // Check heavy load threshold (>= 85% 1RM or (reps <= 5 and RPE >= 8.0) under Henneman's Size Principle)
  const weightKg = options?.weightKg;
  const e1rmKg = options?.e1rmKg;
  const isHeavyLoadRatio =
    weightKg != null &&
    e1rmKg != null &&
    e1rmKg > 0 &&
    weightKg > 0 &&
    weightKg / e1rmKg >= 0.85;

  const isHeavyLoadRepRpe = reps <= 5 && resolvedRpe >= 8.0;
  const isHeavyLoad = isHeavyLoadRatio || isHeavyLoadRepRpe;

  let effectiveReps: number;
  if (isHeavyLoad) {
    // All reps up to 5 recruit high-threshold motor units from rep 1
    effectiveReps = Math.min(reps, 5);
  } else {
    // Proximity to failure formula: max(0, min(reps, 5 - RIR))
    effectiveReps = Math.max(0, Math.min(reps, Math.round(5 - resolvedRir)));
  }

  return {
    effectiveReps,
    isRated: true,
    isStimulating: effectiveReps > 0,
    effRpe: resolvedRpe,
    effRir: resolvedRir,
  };
}

/**
 * Classifies weekly muscle group effective reps volume against hypertrophy landmarks:
 * - Low / Maintenance (MED): < 20 eReps
 * - Optimal Growth (MAV): 20 - 48 eReps
 * - High Volume: 49 - 65 eReps
 * - Peak / Fatigue Risk: > 65 eReps
 */
export function classifyEffectiveRepsTier(eReps: number): {
  tier: VolumeLandmarkTier;
  targetMinReps: number;
  targetMaxReps: number;
} {
  const targetMinReps = 20;
  const targetMaxReps = 48;

  if (eReps < 20) return { tier: 'low', targetMinReps, targetMaxReps };
  if (eReps <= 48) return { tier: 'optimal', targetMinReps, targetMaxReps };
  if (eReps <= 65) return { tier: 'high', targetMinReps, targetMaxReps };
  return { tier: 'peak', targetMinReps, targetMaxReps };
}
