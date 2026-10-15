/**
 * Workout Suite — Rep-Max Monotonic Upper Envelope Modeling
 *
 * Implements Option A: Dynamic Upper Monotonic Envelope for Rep-Max PR Records.
 *
 * Mathematical Principle:
 * For any repetition counts r_a <= r_b, a lifter who demonstrates the capacity
 * to lift load W for r_b repetitions is physically and mathematically proven to
 * possess the strength to lift at least load W for r_a repetitions:
 *   M(r_a) >= M(r_b)  for all r_a <= r_b.
 *
 * When an empirical set at r_a has weight W_a < W_b, that record is strictly dominated.
 * Rather than deleting or corrupting historical training logs (which would destroy
 * Banister fatigue modeling and Kalman covariance stability in the Companion), the
 * query/display layer dynamically computes the reverse running maximum:
 *   M(r) = max_{k >= r} W_k
 *
 * Enveloped Record Properties:
 * - weightKg is upgraded to M(r)
 * - isEnveloped is set to true
 * - derivedFromReps identifies the source repetition count k
 * - originalWeightKg preserves the empirical load directly logged at r reps
 * - metadata (setDate, workoutId, setId, rpe, rir) links to the demonstrating set
 * - e1rmKg is updated based on M(r) at r repetitions with source set intensity
 */

import { RepMaxRecord } from '../types';
import {
  calculateEffectiveReps,
  calculateHeuristic1RM,
  DEFAULT_LOMBARDI_K,
} from './heuristic1rm';

/**
 * Applies the dynamic monotonic upper envelope across a list of RepMaxRecords.
 *
 * Ensures that for any records i and j with reps(i) <= reps(j), weightKg(i) >= weightKg(j).
 *
 * @param records Raw rep-max records for an exercise.
 * @param k Repetition endurance exponent for Lombardi e1RM recalculation.
 * @returns Monotonically enveloped rep-max records.
 */
export function applyMonotonicUpperEnvelope(
  records: RepMaxRecord[],
  k: number = DEFAULT_LOMBARDI_K
): RepMaxRecord[] {
  if (!records || records.length <= 1) {
    return records ? records.map((r) => ({ ...r })) : [];
  }

  // Ensure records are ordered by repetition count ascending: r_0 < r_1 < ... < r_{N-1}
  const sorted = [...records].sort((a, b) => a.reps - b.reps);
  const result: RepMaxRecord[] = new Array(sorted.length);

  // Initialize running maximum from the highest repetition performance
  let runningMax = sorted[sorted.length - 1];
  result[sorted.length - 1] = { ...runningMax };

  // Sweep right-to-left (from highest reps down to lowest reps)
  for (let i = sorted.length - 2; i >= 0; i--) {
    const current = sorted[i];

    if (current.weightKg < runningMax.weightKg) {
      // Current record is dominated by a higher-repetition performance!
      const derivedFromReps = runningMax.derivedFromReps ?? runningMax.reps;
      const effectiveReps = calculateEffectiveReps(current.reps, {
        rpe: runningMax.rpe,
        rir: runningMax.rir,
      });
      const e1rmKg = calculateHeuristic1RM(runningMax.weightKg, current.reps, {
        rpe: runningMax.rpe,
        rir: runningMax.rir,
        k,
      });

      result[i] = {
        ...current,
        weightKg: runningMax.weightKg,
        e1rmKg,
        effectiveReps,
        isEnveloped: true,
        derivedFromReps,
        originalWeightKg: current.weightKg,
        originalSetDate: current.setDate,
        originalWorkoutId: current.workoutId,
        originalSetId: current.setId,
        // The workout/date proving this capacity is the source set:
        setDate: runningMax.setDate,
        workoutId: runningMax.workoutId,
        setId: runningMax.setId,
        rpe: runningMax.rpe,
        rir: runningMax.rir,
        rawInputWeight: runningMax.rawInputWeight,
      };
    } else {
      // Current record is not dominated; it establishes or raises the running maximum
      result[i] = { ...current };
      runningMax = result[i];
    }
  }

  return result;
}
