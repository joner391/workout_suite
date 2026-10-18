/**
 * Workout Suite / datSet — Warm-up Estimator & Intra-Session Autoregulation Engine
 *
 * Implements specifications from Warm_up_estimator.md:
 * - Quantized multi-step warm-up progression ladder (empty bar, 50%, 70%, 85-90% single)
 * - Barbell plate / hardware quantization pipeline: L_final = m * floor(L_work / m + 0.5)
 * - Ternary categorical diagnostic warm-up assessment: 'light', 'normal', 'hard'
 * - Strict mathematical guardrails and asymmetric clamping (-10% to +5%)
 * - Intra-session neuromuscular fatigue drift back-off drops (5-10%) and Helms step-downs
 */

export type WarmupPerceptionRating = 'light' | 'normal' | 'hard';

export interface WarmupStep {
  setNumber: number;
  weight: number;
  reps: number;
  percentageOfWorkingWeight: number;
  isDiagnosticSingle: boolean;
  notes: string;
}

export interface WarmupGeneratorOptions {
  workingWeightKg: number;
  barTareWeightKg?: number; // Default: 20kg
  minimumPlateIncrementKg?: number; // Default: 2.5kg (or 0.5kg for microplates)
  isBodyweight?: boolean;
}

export interface AutoregulatedLoadAdjustment {
  originalLoadKg: number;
  adjustedLoadKg: number;
  percentageAdjustment: number; // e.g. +0.025, -0.05
  clamped: boolean;
  recommendation: string;
}

/**
 * Quantizes a raw theoretical load to the gym hardware minimum increment.
 * Formula: L_final = m * floor(L / m + 0.5)
 */
export function quantizeLoad(loadKg: number, minimumIncrementKg: number = 2.5): number {
  if (loadKg <= 0 || minimumIncrementKg <= 0) return 0;
  const quantized = minimumIncrementKg * Math.floor(loadKg / minimumIncrementKg + 0.5);
  // Round to 2 decimal places to avoid floating point precision artifacts
  return Math.round(quantized * 100) / 100;
}

/**
 * Generates an individualized warm-up progression ladder for an exercise
 * based on the first working set's prescribed load.
 */
export function generateWarmupSets(options: WarmupGeneratorOptions): WarmupStep[] {
  const {
    workingWeightKg,
    barTareWeightKg = 20,
    minimumPlateIncrementKg = 2.5,
    isBodyweight = false,
  } = options;

  if (workingWeightKg <= 0) {
    return [];
  }

  // Bodyweight or light exercises with load <= bar tare weight
  if (isBodyweight || workingWeightKg <= barTareWeightKg) {
    return [
      {
        setNumber: 1,
        weight: isBodyweight ? 0 : quantizeLoad(workingWeightKg, minimumPlateIncrementKg),
        reps: 5,
        percentageOfWorkingWeight: 1.0,
        isDiagnosticSingle: true,
        notes: isBodyweight ? 'Bodyweight activation set' : 'Movement rehearsal',
      },
    ];
  }

  const steps: WarmupStep[] = [];
  let setCounter = 1;

  // Step 1: Empty Bar / Tare weight (mobility and motor pattern rehearsal)
  const barWeight = quantizeLoad(barTareWeightKg, minimumPlateIncrementKg);
  steps.push({
    setNumber: setCounter++,
    weight: barWeight,
    reps: 5,
    percentageOfWorkingWeight: Math.round((barWeight / workingWeightKg) * 100) / 100,
    isDiagnosticSingle: false,
    notes: 'Empty bar - motor pattern rehearsal',
  });

  // Step 2: ~50% Working Load (if significantly greater than bar weight)
  const load50 = quantizeLoad(workingWeightKg * 0.5, minimumPlateIncrementKg);
  if (load50 > barWeight && load50 < workingWeightKg * 0.65) {
    steps.push({
      setNumber: setCounter++,
      weight: load50,
      reps: 5,
      percentageOfWorkingWeight: 0.5,
      isDiagnosticSingle: false,
      notes: '50% work load - nervous system priming',
    });
  }

  // Step 3: ~70% Working Load (if room between 50% and 85%)
  const load70 = quantizeLoad(workingWeightKg * 0.7, minimumPlateIncrementKg);
  if (load70 > (steps[steps.length - 1]?.weight ?? barWeight) && load70 < workingWeightKg * 0.8) {
    steps.push({
      setNumber: setCounter++,
      weight: load70,
      reps: 3,
      percentageOfWorkingWeight: 0.7,
      isDiagnosticSingle: false,
      notes: '70% work load - transitional ramp',
    });
  }

  // Step 4: 85%-90% Diagnostic Warm-up Single
  const diagnosticRaw = workingWeightKg * 0.875;
  const loadDiagnostic = quantizeLoad(diagnosticRaw, minimumPlateIncrementKg);
  if (
    loadDiagnostic > (steps[steps.length - 1]?.weight ?? barWeight) &&
    loadDiagnostic < workingWeightKg
  ) {
    steps.push({
      setNumber: setCounter++,
      weight: loadDiagnostic,
      reps: 1,
      percentageOfWorkingWeight: Math.round((loadDiagnostic / workingWeightKg) * 100) / 100,
      isDiagnosticSingle: true,
      notes: '87.5% diagnostic single - assess speed/readiness',
    });
  } else if (steps.length > 0) {
    // If working weight is close to bar weight, mark the last set as diagnostic
    steps[steps.length - 1].isDiagnosticSingle = true;
  }

  return steps;
}

/**
 * Calculates autoregulated working load adjustment from the diagnostic warm-up single rating.
 *
 * Mathematical guardrails (Warm_up_estimator.md):
 * - Light: +2.5% to +5.0%
 * - Normal: 0.0%
 * - Hard: -5.0% to -7.5%
 * - Boundary clamping: strictly [-10.0%, +5.0%]
 */
export function calculateWarmupAutoregulation(
  workingWeightKg: number,
  rating: WarmupPerceptionRating,
  minimumIncrementKg: number = 2.5,
  hasRecentFatigueFlag: boolean = false
): AutoregulatedLoadAdjustment {
  let rawDeltaPercent = 0.0;
  let recommendation = '';

  switch (rating) {
    case 'light':
      // Conservative +2.5% if fatigue is flagged, else +5.0%
      rawDeltaPercent = hasRecentFatigueFlag ? 0.025 : 0.05;
      recommendation = 'Warm-up moved crisply. Modest upward load adjustment applied.';
      break;
    case 'normal':
      rawDeltaPercent = 0.0;
      recommendation = 'Warm-up on target. Maintain planned working load.';
      break;
    case 'hard':
      // More aggressive downward adjustment (-7.5%) if fatigue flagged, else -5.0%
      rawDeltaPercent = hasRecentFatigueFlag ? -0.075 : -0.05;
      recommendation =
        'Warm-up moved sluggishly. Preventive load reduction applied to protect connective tissue.';
      break;
  }

  // Boundary clamping: Upper bound +5.0%, Lower bound -10.0%
  const MAX_UPWARD_PERCENT = 0.05;
  const MAX_DOWNWARD_PERCENT = -0.1;

  let clamped = false;
  let clampedPercent = rawDeltaPercent;

  if (clampedPercent > MAX_UPWARD_PERCENT) {
    clampedPercent = MAX_UPWARD_PERCENT;
    clamped = true;
  } else if (clampedPercent < MAX_DOWNWARD_PERCENT) {
    clampedPercent = MAX_DOWNWARD_PERCENT;
    clamped = true;
  }

  const rawAdjustedLoad = workingWeightKg * (1 + clampedPercent);
  const adjustedLoadKg = quantizeLoad(rawAdjustedLoad, minimumIncrementKg);

  return {
    originalLoadKg: workingWeightKg,
    adjustedLoadKg,
    percentageAdjustment: clampedPercent,
    clamped,
    recommendation,
  };
}

/**
 * Calculates intra-session back-off volume load reduction (Warm_up_estimator.md).
 * Typically 5% to 10% reduction for post-top-set working volume.
 */
export function calculateBackoffLoad(
  topSetLoadKg: number,
  percentageReduction: number = 0.075,
  minimumIncrementKg: number = 2.5
): number {
  const boundedReduction = Math.min(0.15, Math.max(0.03, percentageReduction));
  const rawLoad = topSetLoadKg * (1 - boundedReduction);
  return quantizeLoad(rawLoad, minimumIncrementKg);
}

/**
 * Helms Linear Step-Down Rule (Warm_up_estimator.md):
 * Trims 2% from working load for every 0.5 RPE that a completed set exceeds the upper target limit.
 */
export function calculateHelmsRpeOvershootAdjustment(
  currentLoadKg: number,
  actualRpe: number,
  targetRpe: number,
  minimumIncrementKg: number = 2.5
): number {
  const overshoot = actualRpe - targetRpe;
  if (overshoot <= 0) return currentLoadKg;

  // 2% per 0.5 RPE overshoot
  const halfRpeUnits = Math.floor(overshoot / 0.5);
  const reductionPercent = Math.min(0.12, halfRpeUnits * 0.02);

  const raw = currentLoadKg * (1 - reductionPercent);
  return quantizeLoad(raw, minimumIncrementKg);
}
