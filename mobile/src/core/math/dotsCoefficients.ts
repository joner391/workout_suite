/**
 * Workout Suite — Powerlifting DOTS Coefficient Formula & Calculations
 *
 * Implements the official powerlifting relative strength metric (DOTS) established by
 * the International Powerlifting Federation (IPF) and widely adopted across OpenPowerlifting.
 *
 * DOTS Formula:
 *   DOTS = (Total × 500) / P(BW)
 * Where P(BW) is a 4th-degree polynomial:
 *   P(BW) = a·BW⁴ + b·BW³ + c·BW² + d·BW + e
 */

import { Gender, DotsResult } from '../types';

export interface DotsCoefficients {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
}

export const DOTS_MALE_COEFFICIENTS: DotsCoefficients = {
  a: -0.000001093,
  b: 0.0007391293,
  c: -0.1918759221,
  d: 24.0900756,
  e: -307.75076,
};

export const DOTS_FEMALE_COEFFICIENTS: DotsCoefficients = {
  a: -0.0000010706,
  b: 0.0005158568,
  c: -0.1126655495,
  d: 13.6175032,
  e: -57.96288,
};

/**
 * Calculates the denominator polynomial P(BW) for a given gender and bodyweight in kg.
 */
export function calculateDotsPolynomial(gender: Gender, bodyweightKg: number): number {
  if (bodyweightKg <= 0) {
    return 0;
  }
  const coeff = gender === 'female' ? DOTS_FEMALE_COEFFICIENTS : DOTS_MALE_COEFFICIENTS;
  const bw = bodyweightKg;
  const bw2 = bw * bw;
  const bw3 = bw2 * bw;
  const bw4 = bw3 * bw;

  return coeff.a * bw4 + coeff.b * bw3 + coeff.c * bw2 + coeff.d * bw + coeff.e;
}

/**
 * Computes the normalized DOTS score.
 * Clamps non-positive loads/bodyweights to 0 and rounds to two decimal places.
 */
export function calculateDotsScore(gender: Gender, bodyweightKg: number, totalKg: number): number {
  if (bodyweightKg <= 0 || totalKg <= 0) {
    return 0;
  }
  const denominator = calculateDotsPolynomial(gender, bodyweightKg);
  if (denominator <= 0) {
    return 0;
  }
  const rawScore = (totalKg * 500) / denominator;
  return Math.round(rawScore * 100) / 100;
}

/**
 * Convenience wrapper returning a structured DotsResult domain entity.
 */
export function calculateDots(params: {
  gender: Gender;
  bodyweightKg: number;
  totalKg: number;
}): DotsResult {
  const { gender, bodyweightKg, totalKg } = params;
  return {
    score: calculateDotsScore(gender, bodyweightKg, totalKg),
    totalKg: Math.max(0, totalKg),
    bodyweightKg: Math.max(0, bodyweightKg),
    gender,
  };
}

/**
 * Computes SBD Total (Squat + Bench Press + Deadlift) in kilograms.
 */
export function calculateSBDTotal(squatKg: number, benchKg: number, deadliftKg: number): number {
  const s = Math.max(0, squatKg || 0);
  const b = Math.max(0, benchKg || 0);
  const d = Math.max(0, deadliftKg || 0);
  return Math.round((s + b + d) * 100) / 100;
}
