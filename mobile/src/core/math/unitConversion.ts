/**
 * Workout Suite — Unit Conversion and Formatting Utilities
 *
 * Implements ADR-008: Canonical Kilogram Storage with Display-Layer Unit Conversion.
 * All internal domain values and database tables store weights in kilograms.
 * This module handles conversions to/from Imperial pounds (lbs) and user-facing formatting.
 */

import { WeightUnit } from '../types';

/**
 * Standard international avoirdupois conversion factor.
 * 1 kilogram = 2.20462262185 pounds
 */
export const LBS_PER_KG = 2.20462262185;
export const KG_PER_LB = 1 / LBS_PER_KG;

/**
 * Converts a weight in kilograms to pounds.
 * Supports negative numbers (e.g. assisted bodyweight deltas).
 * Returns 0 if input is NaN or invalid.
 */
export function kgToLbs(kg: number): number {
  if (typeof kg !== 'number' || isNaN(kg)) {
    return 0;
  }
  return kg * LBS_PER_KG;
}

/**
 * Converts a weight in pounds to kilograms.
 * Supports negative numbers (e.g. assisted bodyweight deltas).
 * Returns 0 if input is NaN or invalid.
 */
export function lbsToKg(lbs: number): number {
  if (typeof lbs !== 'number' || isNaN(lbs)) {
    return 0;
  }
  return lbs * KG_PER_LB;
}

/**
 * Converts a weight value between specified units.
 */
export function convertWeight(
  value: number,
  fromUnit: WeightUnit,
  toUnit: WeightUnit
): number {
  if (typeof value !== 'number' || isNaN(value)) {
    return 0;
  }
  if (fromUnit === toUnit) {
    return value;
  }
  if (fromUnit === 'kg' && toUnit === 'lbs') {
    return kgToLbs(value);
  }
  if (fromUnit === 'lbs' && toUnit === 'kg') {
    return lbsToKg(value);
  }
  return value;
}

/**
 * Rounds a number to the nearest specified step increment (e.g. 0.5, 2.5, 1.25).
 * Uses integer scaling to avoid standard IEEE-754 floating-point precision artifacts.
 */
export function roundToStep(value: number, step: number = 0.5): number {
  if (typeof value !== 'number' || isNaN(value)) {
    return 0;
  }
  if (step <= 0) {
    return value;
  }
  const inverse = 1 / step;
  return Math.round(value * inverse) / inverse;
}

export interface FormatWeightOptions {
  /**
   * Maximum decimal places to display (default: 1).
   */
  precision?: number;
  /**
   * Whether to append the unit suffix string (e.g. " kg", " lbs"). Default: true.
   */
  showUnit?: boolean;
  /**
   * If true, whole numbers will not show trailing decimals (e.g. "100" instead of "100.0"). Default: true.
   */
  trimTrailingZeros?: boolean;
}

/**
 * Formats a canonical kilogram weight for display in the active user unit system.
 *
 * @param weightKg Weight in canonical kilograms.
 * @param unit Target display unit ('kg' | 'lbs'). Default: 'kg'.
 * @param options Formatting options.
 */
export function formatWeight(
  weightKg: number,
  unit: WeightUnit = 'kg',
  options: FormatWeightOptions = {}
): string {
  if (typeof weightKg !== 'number' || isNaN(weightKg)) {
    return options.showUnit !== false ? `0 ${unit}` : '0';
  }

  const {
    precision = 1,
    showUnit = true,
    trimTrailingZeros = true,
  } = options;

  const displayValue = unit === 'lbs' ? kgToLbs(weightKg) : weightKg;

  let formattedNumber = displayValue.toFixed(precision);

  if (trimTrailingZeros && precision > 0) {
    // Strip trailing zeros and optional dot (e.g. "100.0" -> "100", "100.50" -> "100.5")
    formattedNumber = formattedNumber.replace(/\.?0+$/, '');
  }

  return showUnit ? `${formattedNumber} ${unit}` : formattedNumber;
}

/**
 * Standard international length conversion factor (1 inch = 2.54 cm).
 */
export const CM_PER_INCH = 2.54;
export const INCHES_PER_CM = 1 / CM_PER_INCH;

/**
 * Converts a length in centimeters to inches.
 */
export function cmToInches(cm: number): number {
  if (typeof cm !== 'number' || isNaN(cm)) {
    return 0;
  }
  return cm * INCHES_PER_CM;
}

/**
 * Converts a length in inches to centimeters.
 */
export function inchesToCm(inches: number): number {
  if (typeof inches !== 'number' || isNaN(inches)) {
    return 0;
  }
  return inches * CM_PER_INCH;
}

export interface FormatLengthOptions {
  precision?: number;
  showUnit?: boolean;
  trimTrailingZeros?: boolean;
}

/**
 * Formats a canonical centimeter measurement for user-facing display.
 * If unitSystem is 'lbs', formats in inches ('in').
 * If unitSystem is 'kg', formats in centimeters ('cm').
 */
export function formatLength(
  lengthCm: number | null | undefined,
  unitSystem: WeightUnit = 'kg',
  options: FormatLengthOptions = {}
): string {
  if (lengthCm == null) {
    return '—';
  }

  if (typeof lengthCm !== 'number' || isNaN(lengthCm)) {
    const unit = unitSystem === 'lbs' ? 'in' : 'cm';
    return options.showUnit !== false ? `0 ${unit}` : '0';
  }

  const {
    precision = 1,
    showUnit = true,
    trimTrailingZeros = true,
  } = options;

  const isImperial = unitSystem === 'lbs';
  const displayValue = isImperial ? cmToInches(lengthCm) : lengthCm;
  const unit = isImperial ? 'in' : 'cm';

  let formattedNumber = displayValue.toFixed(precision);
  if (trimTrailingZeros && precision > 0) {
    formattedNumber = formattedNumber.replace(/\.?0+$/, '');
  }

  return showUnit ? `${formattedNumber} ${unit}` : formattedNumber;
}
