/**
 * Workout Suite — Heuristic 1RM & Repetition Endurance Modeling
 *
 * Implements Tier 1 Mobile Fast Heuristic 1RM calculations as defined in:
 * - 1RM_calculation.txt
 * - Deep_research_1RM.md
 * - ADR-002: Dual-Tier 1RM Estimation Architecture
 * - ADR-026: Mechanical Load Normalization and Persistence Contract
 *
 * Core Model:
 * Non-linear Lombardi power law:
 *   e1RM = weight * (r_eff)^k
 * where:
 *   r_eff = reps + RIR   OR   r_eff = reps + max(0, 10 - RPE)  (clamped >= 1.0)
 *   default k = 0.10 (or custom calibrated k from Tier 2 Kalman engine)
 */

import { StandardLiftType } from '../types';

/**
 * Baseline Lombardi power-law exponent.
 */
export const DEFAULT_LOMBARDI_K = 0.10;

/**
 * Operational biological boundary corridor for human repetition endurance exponent k.
 * Derived in 1RM_calculation.txt: k in [0.03, 0.16].
 */
export const MIN_PLAUSIBLE_K = 0.03;
export const MAX_PLAUSIBLE_K = 0.16;

/**
 * Empirical deadlift compensatory multiplier applied EXCLUSIVELY to static linear
 * heuristic formulas (e.g. Epley / Brzycki) during Tier 1 in-app estimation.
 * NOTE: As documented in ADR-026 and 1RM_calculation.txt, this multiplier must NEVER
 * be applied to Tier 2 Kalman filter state outputs or Lombardi dynamic models.
 */
export const DEADLIFT_LINEAR_SCALAR = 1.10;

export interface IntensityInput {
  rir?: number | null;
  rpe?: number | null;
}

export interface Heuristic1RMOptions extends IntensityInput {
  /**
   * Movement-specific repetition endurance exponent (default: 0.10).
   * Can be pre-calibrated from the Companion Kalman filter.
   */
  k?: number;
  /**
   * If true, sets with RIR > 3, RPE < 7, or 0 reps are considered unreliable
   * and return 0 e1RM. Default: false.
   */
  strictReliability?: boolean;
}

/**
 * Computes effective repetitions (r_eff) accounting for proximity to failure:
 *   r_eff = reps + RIR
 *   OR
 *   r_eff = reps + max(0, 10 - RPE)
 *
 * Invariants:
 * - If completed reps <= 0, returns 0 (a failed set cannot extrapolate work).
 * - For completed sets (reps > 0), enforces lower bound r_eff >= 1.0.
 */
export function calculateEffectiveReps(
  reps: number,
  intensity?: IntensityInput | null
): number {
  if (typeof reps !== 'number' || isNaN(reps) || reps <= 0) {
    return 0;
  }

  let reserve = 0;

  if (intensity?.rir != null && !isNaN(intensity.rir)) {
    reserve = Math.max(0, intensity.rir);
  } else if (intensity?.rpe != null && !isNaN(intensity.rpe)) {
    reserve = Math.max(0, 10 - intensity.rpe);
  }

  const effective = reps + reserve;
  return Math.max(1.0, effective);
}

/**
 * Evaluates whether a set provides a statistically reliable signal for 1RM estimation.
 *
 * As established in 1RM_calculation.txt and Deep_research_1RM.md:
 * - Sets with completed reps <= 0 are discarded (failed attempts).
 * - Sets with RIR > 3 (or RPE < 7.0) represent warmup or submaximal efforts with
 *   unreliable perceptual accuracy, which distort prediction models.
 * - Sets with reps > 12 introduce high muscular endurance variance.
 */
export function isReliable1RMInput(
  reps: number,
  intensity?: IntensityInput | null,
  options?: { maxRepsThreshold?: number }
): boolean {
  if (typeof reps !== 'number' || isNaN(reps) || reps <= 0) {
    return false;
  }

  const maxReps = options?.maxRepsThreshold ?? 12;
  if (reps > maxReps) {
    return false;
  }

  if (intensity?.rir != null && !isNaN(intensity.rir)) {
    if (intensity.rir > 3.0) {
      return false;
    }
  } else if (intensity?.rpe != null && !isNaN(intensity.rpe)) {
    if (intensity.rpe < 7.0) {
      return false;
    }
  }

  return true;
}

/**
 * Computes estimated 1RM using the non-linear Lombardi power law:
 *   e1RM = weightKg * (r_eff)^k
 *
 * @param weightKg Canonical effective mechanical load in kg.
 * @param effectiveReps Effective repetition count (r_eff >= 1.0).
 * @param k Repetition endurance exponent (default 0.10, bounded in [0.03, 0.16]).
 */
export function calculateLombardi1RM(
  weightKg: number,
  effectiveReps: number,
  k: number = DEFAULT_LOMBARDI_K
): number {
  if (typeof weightKg !== 'number' || isNaN(weightKg) || weightKg <= 0) {
    return 0;
  }
  if (typeof effectiveReps !== 'number' || isNaN(effectiveReps) || effectiveReps <= 0) {
    return 0;
  }

  // Bound k within physiological corridor for numerical stability
  const safeK = Math.min(Math.max(k, MIN_PLAUSIBLE_K), MAX_PLAUSIBLE_K);
  const safeReps = Math.max(1.0, effectiveReps);

  if (safeReps === 1.0) {
    return weightKg;
  }

  return weightKg * Math.pow(safeReps, safeK);
}

/**
 * Computes estimated 1RM using the classic linear Epley model:
 *   e1RM = weightKg * (1 + r_eff / 30)
 *
 * Optionally applies the +10% deadlift compensatory multiplier.
 */
export function calculateEpley1RM(
  weightKg: number,
  effectiveReps: number,
  isDeadlift: boolean = false
): number {
  if (typeof weightKg !== 'number' || isNaN(weightKg) || weightKg <= 0) {
    return 0;
  }
  if (typeof effectiveReps !== 'number' || isNaN(effectiveReps) || effectiveReps <= 0) {
    return 0;
  }

  const safeReps = Math.max(1.0, effectiveReps);
  if (safeReps === 1.0) {
    return isDeadlift ? weightKg * DEADLIFT_LINEAR_SCALAR : weightKg;
  }

  const baseE1rm = weightKg * (1.0 + safeReps / 30.0);
  return isDeadlift ? baseE1rm * DEADLIFT_LINEAR_SCALAR : baseE1rm;
}

/**
 * Computes estimated 1RM using the linear fractional Brzycki model:
 *   e1RM = weightKg * (36 / (37 - r_eff))
 *
 * Clamps r_eff at 36 to prevent division by zero or negative asymptote explosion.
 */
export function calculateBrzycki1RM(
  weightKg: number,
  effectiveReps: number,
  isDeadlift: boolean = false
): number {
  if (typeof weightKg !== 'number' || isNaN(weightKg) || weightKg <= 0) {
    return 0;
  }
  if (typeof effectiveReps !== 'number' || isNaN(effectiveReps) || effectiveReps <= 0) {
    return 0;
  }

  const safeReps = Math.min(Math.max(1.0, effectiveReps), 36.0);
  if (safeReps === 1.0) {
    return isDeadlift ? weightKg * DEADLIFT_LINEAR_SCALAR : weightKg;
  }

  const denominator = 37.0 - safeReps;
  const baseE1rm = weightKg * (36.0 / denominator);
  return isDeadlift ? baseE1rm * DEADLIFT_LINEAR_SCALAR : baseE1rm;
}

/**
 * Primary Tier 1 Heuristic 1RM Function.
 *
 * Supports two ergonomic invocation signatures:
 * 1. Options object:
 *    calculateHeuristic1RM(100, 5, { rir: 2, k: 0.10 })
 * 2. Positional parameters:
 *    calculateHeuristic1RM(100, 5, 2, null, 0.10)
 */
export function calculateHeuristic1RM(
  weightKg: number,
  reps: number,
  optionsOrRir?: Heuristic1RMOptions | number | null,
  rpe?: number | null,
  k?: number
): number {
  if (typeof weightKg !== 'number' || isNaN(weightKg) || weightKg <= 0) {
    return 0;
  }
  if (typeof reps !== 'number' || isNaN(reps) || reps <= 0) {
    return 0;
  }

  let rirVal: number | null | undefined = null;
  let rpeVal: number | null | undefined = null;
  let kVal: number = DEFAULT_LOMBARDI_K;
  let strictReliability = false;

  if (typeof optionsOrRir === 'object' && optionsOrRir !== null) {
    rirVal = optionsOrRir.rir;
    rpeVal = optionsOrRir.rpe;
    if (typeof optionsOrRir.k === 'number') {
      kVal = optionsOrRir.k;
    }
    strictReliability = optionsOrRir.strictReliability ?? false;
  } else {
    rirVal = typeof optionsOrRir === 'number' ? optionsOrRir : null;
    rpeVal = typeof rpe === 'number' ? rpe : null;
    if (typeof k === 'number') {
      kVal = k;
    }
  }

  // Exclude low-intensity warmup/recovery sets (< 6.0 RPE or > 4.0 RIR) from e1RM estimation
  if (rpeVal != null && !isNaN(rpeVal) && rpeVal < 6.0) {
    return 0;
  }
  if (rirVal != null && !isNaN(rirVal) && rirVal > 4.0) {
    return 0;
  }

  if (strictReliability && !isReliable1RMInput(reps, { rir: rirVal, rpe: rpeVal })) {
    return 0;
  }

  const effectiveReps = calculateEffectiveReps(reps, { rir: rirVal, rpe: rpeVal });
  return calculateLombardi1RM(weightKg, effectiveReps, kVal);
}
