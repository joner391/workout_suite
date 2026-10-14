/**
 * Workout Suite — Allometric Strength Standards & Performance Intelligence
 *
 * Implements non-linear bodyweight scaling and empirical benchmark interpolation
 * derived from ExRx, Symmetric Strength, and OpenPowerlifting normative cohorts.
 *
 * Mathematical Foundations:
 * 1. Bilinear Quantile Interpolation across Bodyweight Brackets:
 *    T(BW) = T(BW_low) + ((BW - BW_low) / (BW_high - BW_low)) * (T(BW_high) - T(BW_low))
 *
 * 2. Continuous Normalized Strength Score (0 - 100+):
 *    Score = TierBase + 20 * ((e1RM - Lower(BW)) / (Upper(BW) - Lower(BW)))
 *    - 0-19: Untrained | 20-39: Novice | 40-59: Intermediate | 60-79: Advanced | 80+: Elite
 *
 * 3. Demographic Percentile Mapping (0.1% - 99.9%):
 *    Smooth piecewise monotonic curve mapping continuous score to active lifter population percentile.
 */

import {
  Gender,
  StandardLiftType,
  StrengthStandard,
  StrengthStandardTier,
  StrengthStandardResult,
  InterpolatedStandards,
  SBDBalanceProfile,
} from '../types';
import { DEFAULT_STRENGTH_STANDARDS } from '../../database/seeds/strengthStandardsSeed';
import { calculateDotsScore, calculateSBDTotal } from './dotsCoefficients';

export interface EvaluateStrengthStandardParams {
  liftType: StandardLiftType;
  gender: Gender;
  bodyweightKg: number;
  e1rmKg: number;
  standards?: StrengthStandard[];
}

export interface SBDBalanceParams {
  gender: Gender;
  bodyweightKg: number;
  squatE1rm: number;
  benchE1rm: number;
  deadliftE1rm: number;
  standards?: StrengthStandard[];
}

/**
 * Interpolates empirical strength standard thresholds for a specific lift, gender,
 * and continuous bodyweight via linear bracket interpolation.
 */
export function interpolateStandards(params: {
  liftType: StandardLiftType;
  gender: Gender;
  bodyweightKg: number;
  standards?: StrengthStandard[];
}): InterpolatedStandards {
  const { liftType, gender, bodyweightKg, standards = DEFAULT_STRENGTH_STANDARDS } = params;

  const filtered = standards
    .filter((s) => s.lift_type === liftType && s.gender === gender)
    .sort((a, b) => a.bodyweight_kg - b.bodyweight_kg);

  if (filtered.length === 0) {
    throw new Error(
      `No strength standards found for liftType='${liftType}' and gender='${gender}'`
    );
  }

  const bw = Math.max(0, bodyweightKg);

  // If below minimum seeded bracket, clamp to lowest bracket
  if (bw <= filtered[0].bodyweight_kg) {
    const row = filtered[0];
    return {
      untrained: row.untrained_1rm,
      novice: row.novice_1rm,
      intermediate: row.intermediate_1rm,
      advanced: row.advanced_1rm,
      elite: row.elite_1rm,
    };
  }

  // If above maximum seeded bracket, clamp to highest bracket
  const lastIndex = filtered.length - 1;
  if (bw >= filtered[lastIndex].bodyweight_kg) {
    const row = filtered[lastIndex];
    return {
      untrained: row.untrained_1rm,
      novice: row.novice_1rm,
      intermediate: row.intermediate_1rm,
      advanced: row.advanced_1rm,
      elite: row.elite_1rm,
    };
  }

  // Locate bounding brackets
  let lowRow = filtered[0];
  let highRow = filtered[1];

  for (let i = 0; i < filtered.length - 1; i++) {
    if (bw >= filtered[i].bodyweight_kg && bw <= filtered[i + 1].bodyweight_kg) {
      lowRow = filtered[i];
      highRow = filtered[i + 1];
      break;
    }
  }

  const range = highRow.bodyweight_kg - lowRow.bodyweight_kg;
  const factor = range > 0 ? (bw - lowRow.bodyweight_kg) / range : 0;

  const lerp = (low: number, high: number): number => {
    return Math.round((low + factor * (high - low)) * 10) / 10;
  };

  return {
    untrained: lerp(lowRow.untrained_1rm, highRow.untrained_1rm),
    novice: lerp(lowRow.novice_1rm, highRow.novice_1rm),
    intermediate: lerp(lowRow.intermediate_1rm, highRow.intermediate_1rm),
    advanced: lerp(lowRow.advanced_1rm, highRow.advanced_1rm),
    elite: lerp(lowRow.elite_1rm, highRow.elite_1rm),
  };
}

/**
 * Calculates continuous normalized score (0.0 - 100.0+), tier classification,
 * next tier milestone, and required kilograms needed to advance.
 */
export function calculateContinuousScore(
  e1rmKg: number,
  standards: InterpolatedStandards
): {
  tier: StrengthStandardTier;
  continuousScore: number;
  nextTierName: StrengthStandardTier | null;
  kgNeededForNextTier: number;
  deltaKgToNextTier: number | null;
} {
  const load = Math.max(0, e1rmKg);
  const { untrained, novice, intermediate, advanced, elite } = standards;

  let tier: StrengthStandardTier = 'untrained';
  let continuousScore = 0;
  let nextTierName: StrengthStandardTier | null = 'novice';
  let kgNeeded = 0;

  if (load < novice) {
    tier = 'untrained';
    nextTierName = 'novice';
    kgNeeded = novice - load;

    if (untrained <= 0 || load <= 0) {
      continuousScore = 0;
    } else if (load < untrained) {
      // Sub-untrained range: 0.0 to 10.0
      continuousScore = (load / untrained) * 10.0;
    } else {
      // Untrained to Novice range: 10.0 to 20.0
      const span = novice - untrained;
      continuousScore = span > 0 ? 10.0 + ((load - untrained) / span) * 10.0 : 10.0;
    }
  } else if (load < intermediate) {
    tier = 'novice';
    nextTierName = 'intermediate';
    kgNeeded = intermediate - load;
    const span = intermediate - novice;
    continuousScore = span > 0 ? 20.0 + ((load - novice) / span) * 20.0 : 20.0;
  } else if (load < advanced) {
    tier = 'intermediate';
    nextTierName = 'advanced';
    kgNeeded = advanced - load;
    const span = advanced - intermediate;
    continuousScore = span > 0 ? 40.0 + ((load - intermediate) / span) * 20.0 : 40.0;
  } else if (load < elite) {
    tier = 'advanced';
    nextTierName = 'elite';
    kgNeeded = elite - load;
    const span = elite - advanced;
    continuousScore = span > 0 ? 60.0 + ((load - advanced) / span) * 20.0 : 60.0;
  } else {
    tier = 'elite';
    nextTierName = null;
    kgNeeded = 0;
    // Elite tier: 80.0+, scaled by the upper tier gap (elite - advanced)
    const upperGap = elite - advanced > 0 ? elite - advanced : 20.0;
    continuousScore = 80.0 + ((load - elite) / upperGap) * 20.0;
  }

  const roundedScore = Math.round(continuousScore * 10) / 10;
  const roundedKgNeeded = Math.round(kgNeeded * 10) / 10;

  return {
    tier,
    continuousScore: roundedScore,
    nextTierName,
    kgNeededForNextTier: roundedKgNeeded,
    deltaKgToNextTier: nextTierName !== null ? roundedKgNeeded : null,
  };
}

/**
 * Maps a continuous strength score (0.0 - 100.0+) to a continuous demographic percentile (0.1% - 99.9%)
 * based on empirical strength distributions of active gym athletes.
 */
export function calculateDemographicPercentile(continuousScore: number): number {
  if (continuousScore <= 0) {
    return 1.0;
  }
  if (continuousScore >= 100) {
    return 99.9;
  }

  // Anchor pairs: [score, percentile]
  const anchors: [number, number][] = [
    [0.0, 1.0],
    [10.0, 5.0], // Untrained benchmark
    [20.0, 25.0], // Novice threshold
    [40.0, 50.0], // Intermediate median
    [60.0, 85.0], // Advanced threshold (~top 15%)
    [80.0, 97.5], // Elite threshold (~top 2.5%)
    [100.0, 99.9], // World-class / super-elite
  ];

  for (let i = 0; i < anchors.length - 1; i++) {
    const [sLow, pLow] = anchors[i];
    const [sHigh, pHigh] = anchors[i + 1];

    if (continuousScore >= sLow && continuousScore <= sHigh) {
      const t = (continuousScore - sLow) / (sHigh - sLow);
      const percentile = pLow + t * (pHigh - pLow);
      return Math.round(percentile * 10) / 10;
    }
  }

  return 99.9;
}

/**
 * Evaluates an exercise estimated 1RM against allometric strength standards.
 * Returns the classification tier, continuous score, kilograms needed for next tier,
 * demographic percentile, and the interpolated standard thresholds.
 */
export function evaluateStrengthStandard(
  params: EvaluateStrengthStandardParams
): StrengthStandardResult & { interpolatedStandards: InterpolatedStandards } {
  const { liftType, gender, bodyweightKg, e1rmKg, standards } = params;

  const interpolated = interpolateStandards({
    liftType,
    gender,
    bodyweightKg,
    standards,
  });

  const scoring = calculateContinuousScore(e1rmKg, interpolated);
  const demographicPercentile = calculateDemographicPercentile(scoring.continuousScore);

  return {
    liftType,
    e1rmKg: Math.max(0, e1rmKg),
    bodyweightKg: Math.max(0, bodyweightKg),
    tier: scoring.tier,
    continuousScore: scoring.continuousScore,
    deltaKgToNextTier: scoring.deltaKgToNextTier,
    nextTierName: scoring.nextTierName,
    kgNeededForNextTier: scoring.kgNeededForNextTier,
    demographicPercentile,
    interpolatedStandards: interpolated,
  };
}

/**
 * Computes the composite SBD Strength Balance & Symmetry Profile across Squat, Bench, and Deadlift.
 * Identifies dominant and lagging lifts and produces normalized radar coordinates.
 */
export function calculateSBDBalanceProfile(params: SBDBalanceParams): SBDBalanceProfile {
  const { gender, bodyweightKg, squatE1rm, benchE1rm, deadliftE1rm, standards } = params;

  const squatEval = evaluateStrengthStandard({
    liftType: 'squat',
    gender,
    bodyweightKg,
    e1rmKg: squatE1rm,
    standards,
  });

  const benchEval = evaluateStrengthStandard({
    liftType: 'bench',
    gender,
    bodyweightKg,
    e1rmKg: benchE1rm,
    standards,
  });

  const deadliftEval = evaluateStrengthStandard({
    liftType: 'deadlift',
    gender,
    bodyweightKg,
    e1rmKg: deadliftE1rm,
    standards,
  });

  const totalKg = calculateSBDTotal(squatE1rm, benchE1rm, deadliftE1rm);
  const dotsScore = calculateDotsScore(gender, bodyweightKg, totalKg);

  const squatScore = squatEval.continuousScore;
  const benchScore = benchEval.continuousScore;
  const deadliftScore = deadliftEval.continuousScore;

  const totalScore = Math.round((squatScore + benchScore + deadliftScore) * 10) / 10;
  const averageScore = Math.round((totalScore / 3) * 10) / 10;

  // Radar coordinates clamped between 0 and 100 for consistent charting
  const clampRadar = (s: number) => Math.min(100, Math.max(0, Math.round(s * 10) / 10));
  const radarCoordinates = {
    squat: clampRadar(squatScore),
    bench: clampRadar(benchScore),
    deadlift: clampRadar(deadliftScore),
  };

  // Determine lift symmetry
  const scores: { lift: 'squat' | 'bench' | 'deadlift'; score: number }[] = [
    { lift: 'squat', score: squatScore },
    { lift: 'bench', score: benchScore },
    { lift: 'deadlift', score: deadliftScore },
  ];

  const maxLift = scores.reduce((prev, curr) => (curr.score > prev.score ? curr : prev));
  const minLift = scores.reduce((prev, curr) => (curr.score < prev.score ? curr : prev));
  const spread = maxLift.score - minLift.score;

  let dominantLift: 'squat' | 'bench' | 'deadlift' | 'balanced' = 'balanced';
  let laggingLift: 'squat' | 'bench' | 'deadlift' | 'none' = 'none';

  if (spread >= 8.0) {
    if (maxLift.score - averageScore >= 4.0) {
      dominantLift = maxLift.lift;
    }
    if (averageScore - minLift.score >= 4.0) {
      laggingLift = minLift.lift;
    }
  }

  return {
    squatScore,
    benchScore,
    deadliftScore,
    totalScore,
    averageScore,
    totalKg,
    dotsScore,
    dominantLift,
    laggingLift,
    radarCoordinates,
  };
}
