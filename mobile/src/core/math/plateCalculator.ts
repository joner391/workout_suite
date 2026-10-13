/**
 * Workout Suite — Barbell Plate Loading Calculator
 *
 * Implements ADR-022: In-Logger Plate Loading Calculator & Cognitive Offloading
 * Implements ADR-025: Equipment Mechanical Advantage Profiles (Bar Tare Weights)
 *
 * Computes optimal plate combinations per side of a barbell using a greedy solver.
 * Handles custom bar tare weights (e.g. 20 kg Olympic, 29 kg SSB, 25 kg Trap Bar),
 * custom plate inventories, and unresolvable odd remainders.
 */

import { PlateCalculationResult } from '../types';

/**
 * Standard metric Olympic plate denominations in kilograms.
 */
export const DEFAULT_PLATE_DENOMINATIONS_KG: readonly number[] = [
  25, 20, 15, 10, 5, 2.5, 1.25,
];

/**
 * Standard imperial plate denominations in pounds.
 */
export const DEFAULT_PLATE_DENOMINATIONS_LBS: readonly number[] = [
  45, 35, 25, 10, 5, 2.5,
];

/**
 * Standard Olympic barbell tare weight in kilograms.
 */
export const DEFAULT_BAR_TARE_KG = 20.0;

export interface PlateCalculatorOptions {
  /**
   * Tare weight of the barbell / bar implement in kg (default: 20.0 kg).
   */
  barTareKg?: number;

  /**
   * Available plate denominations in kg (default: [25, 20, 15, 10, 5, 2.5, 1.25]).
   */
  availablePlatesKg?: readonly number[];

  /**
   * Optional map constraining available pairs per denomination.
   * E.g. { 25: 1, 20: 2 } means only 1 pair of 25s and 2 pairs of 20s exist.
   */
  platePairsAvailable?: Record<number, number>;
}

/**
 * Solves the optimal plate distribution per side of a barbell.
 *
 * @param targetWeightKg Total desired barbell load in kilograms.
 * @param options Configuration for bar tare, denominations, and inventory limits.
 * @returns PlateCalculationResult with platesPerSide, weightPerSideKg, and remainderKg.
 */
export function calculatePlateLoading(
  targetWeightKg: number,
  options: PlateCalculatorOptions = {}
): PlateCalculationResult {
  const target = typeof targetWeightKg === 'number' && !isNaN(targetWeightKg)
    ? targetWeightKg
    : 0;

  const barTare = typeof options.barTareKg === 'number' && !isNaN(options.barTareKg) && options.barTareKg >= 0
    ? options.barTareKg
    : DEFAULT_BAR_TARE_KG;

  // Edge Case 1: Target weight is zero or negative
  if (target <= 0) {
    return {
      targetWeightKg: 0,
      barTareKg: barTare,
      weightPerSideKg: 0,
      platesPerSide: [],
      remainderKg: 0,
    };
  }

  // Edge Case 2: Target weight is less than or equal to empty bar tare
  if (target <= barTare) {
    const rawDelta = target - barTare;
    const remainderKg = Math.round(rawDelta * 1000) / 1000;
    return {
      targetWeightKg: target,
      barTareKg: barTare,
      weightPerSideKg: 0,
      platesPerSide: [],
      remainderKg,
    };
  }

  // Calculate weight required across both sleeves
  const totalPlateWeightNeeded = target - barTare;
  const targetPerSide = totalPlateWeightNeeded / 2.0;

  // Sort available denominations descending
  const rawDenominations = options.availablePlatesKg ?? DEFAULT_PLATE_DENOMINATIONS_KG;
  const denominations = Array.from(new Set(rawDenominations))
    .filter((d) => typeof d === 'number' && !isNaN(d) && d > 0)
    .sort((a, b) => b - a);

  const platesPerSide: number[] = [];
  let remainingPerSide = targetPerSide;

  // Track inventory pairs if provided
  const inventoryCounts: Record<number, number> = options.platePairsAvailable
    ? { ...options.platePairsAvailable }
    : {};

  const hasInventoryConstraint = Boolean(options.platePairsAvailable);

  // Floating point threshold for plate division
  const EPSILON = 1e-6;

  for (const plate of denominations) {
    while (remainingPerSide >= plate - EPSILON) {
      if (hasInventoryConstraint) {
        const availableCount = inventoryCounts[plate] ?? 0;
        if (availableCount <= 0) {
          break; // Exhausted available pairs for this plate
        }
        inventoryCounts[plate] = availableCount - 1;
      }

      platesPerSide.push(plate);
      remainingPerSide -= plate;

      // Clean up small floating point residues
      if (Math.abs(remainingPerSide) < EPSILON) {
        remainingPerSide = 0;
        break;
      }
    }

    if (remainingPerSide === 0) {
      break;
    }
  }

  // Calculate actual loaded weight per side and total loaded weight on the bar
  const weightPerSideKg = Math.round(platesPerSide.reduce((sum, p) => sum + p, 0) * 1000) / 1000;
  const totalLoadedKg = Math.round((barTare + weightPerSideKg * 2.0) * 1000) / 1000;
  const remainderKg = Math.round((target - totalLoadedKg) * 1000) / 1000;

  return {
    targetWeightKg: target,
    barTareKg: barTare,
    weightPerSideKg,
    platesPerSide,
    remainderKg,
  };
}

/**
 * Summarizes the plates per side into a compact user-friendly string (e.g. "25, 20, 1.25").
 */
export function formatPlatesSummary(platesPerSide: readonly number[]): string {
  if (!platesPerSide || platesPerSide.length === 0) {
    return 'Empty bar';
  }
  return platesPerSide.join(', ');
}

/**
 * Groups identical plates into counts (e.g. [25, 25, 10] -> [{ weightKg: 25, count: 2 }, { weightKg: 10, count: 1 }]).
 */
export function groupPlatesByCount(
  platesPerSide: readonly number[]
): Array<{ weightKg: number; count: number }> {
  const countsMap = new Map<number, number>();

  for (const plate of platesPerSide) {
    countsMap.set(plate, (countsMap.get(plate) ?? 0) + 1);
  }

  const result: Array<{ weightKg: number; count: number }> = [];
  for (const [weightKg, count] of countsMap.entries()) {
    result.push({ weightKg, count });
  }

  return result;
}
