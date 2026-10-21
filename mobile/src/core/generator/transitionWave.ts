/**
 * Workout Suite — Isometric eRep Cross-Fade Mentality Transition Wave
 *
 * Implements Phase 8 Step 8.4:
 * When an athlete changes training mentality (e.g., Precision <-> Fury or Get Out),
 * an abrupt jump in target exertion and volume poses serious physiological risks:
 * 1. Shifting immediately from Precision (12-16 weekly sets @ RIR 2) to Fury (6-8 weekly sets @ RIR 0.5)
 *    causes a ~65% stimulus crash if the trainee has not yet mastered true 0-RIR motor recruitment.
 * 2. Shifting immediately from Fury to Precision causes a massive volume spike (+50-100% sets)
 *    at high RPE, exceeding the safe Acute-to-Chronic Workload Ratio (ACWR > 1.5) and triggering
 *    debilitating DOMS and connective tissue breakdown.
 *
 * The Transition Wave solver ramps proximity to failure linearly over 2-3 weeks:
 *   RIR(t) = RIR_from + (t / T) * (RIR_to - RIR_from)
 *   RPE(t) = 10 - RIR(t)
 *
 * And dynamically recomputes working sets so weekly stimulating reps remain invariant:
 *   Sets(t) = round( E_target / ((5 - RIR(t)) * f_week) )
 *   where E_target ≈ 32 eReps/muscle/week (MAV baseline).
 */

import { TrainingMentality } from '../types';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface MentalityExertionProfile {
  mentality: TrainingMentality;
  displayName: string;
  baselineRir: number;
  baselineRpe: number;
  eRepsPerSet: number;
}

export interface TransitionWaveOptions {
  fromMentality: TrainingMentality;
  toMentality: TrainingMentality;
  currentWeek: number;
  totalWeeks?: number;
  targetWeeklyEReps?: number;
  weeklyFrequency?: number;
}

export interface TransitionWaveStep {
  fromMentality: TrainingMentality;
  toMentality: TrainingMentality;
  currentWeek: number;
  totalWeeks: number;
  isTransitionActive: boolean;
  progressFraction: number; // 0.0 to 1.0
  targetRir: number;
  targetRpe: number;
  baselineRir: number;
  baselineRpe: number;
  goalRir: number;
  goalRpe: number;
  eRepsPerSet: number;
  targetSetsPerSession: number;
  targetWeeklySets: number;
  rpeDelta: number; // cumulative change in RPE (+ ramping, - easing)
  setDelta: number; // change in sets (- trimmed, + added)
  bannerMessage: string;
}

// ============================================================================
// Mentality Baselines
// ============================================================================

export const MENTALITY_PROFILES: Record<TrainingMentality, MentalityExertionProfile> = {
  precision: {
    mentality: 'precision',
    displayName: 'Precision',
    baselineRir: 2.0,
    baselineRpe: 8.0,
    eRepsPerSet: 3.0, // 5 - 2.0
  },
  fury: {
    mentality: 'fury',
    displayName: 'Fury',
    baselineRir: 0.5,
    baselineRpe: 9.5,
    eRepsPerSet: 4.5, // 5 - 0.5
  },
  get_out: {
    mentality: 'get_out',
    displayName: 'Get Out',
    baselineRir: 1.5,
    baselineRpe: 8.5,
    eRepsPerSet: 3.5, // 5 - 1.5
  },
};

/**
 * Returns human-readable display name for a given TrainingMentality.
 */
export function getMentalityDisplayName(mentality: TrainingMentality): string {
  return MENTALITY_PROFILES[mentality]?.displayName ?? mentality;
}

// ============================================================================
// Banner Formatter
// ============================================================================

/**
 * Formats diagnostic and motivational banner string for the Active Logger.
 * Example:
 * "Mentality Transition: Week 1 of 3 (Precision → Fury) — RPE ramping (+0.5) while 1 set is trimmed to maintain 32 weekly eReps"
 */
export function formatTransitionBanner(step: TransitionWaveStep): string {
  if (!step.isTransitionActive) {
    return '';
  }

  const fromName = getMentalityDisplayName(step.fromMentality);
  const toName = getMentalityDisplayName(step.toMentality);

  // RPE descriptor
  let rpeDesc = 'RPE steady';
  if (step.rpeDelta > 0) {
    rpeDesc = `RPE ramping (+${step.rpeDelta.toFixed(1)})`;
  } else if (step.rpeDelta < 0) {
    rpeDesc = `RPE easing (${step.rpeDelta.toFixed(1)})`;
  }

  // Set descriptor
  let setDesc = 'set volume is maintained';
  if (step.setDelta < 0) {
    const trimmed = Math.abs(step.setDelta);
    setDesc = `${trimmed} set${trimmed === 1 ? '' : 's'} is trimmed`;
  } else if (step.setDelta > 0) {
    const added = Math.abs(step.setDelta);
    setDesc = `${added} set${added === 1 ? '' : 's'} is added`;
  }

  const targetEReps = Math.round(step.eRepsPerSet * step.targetWeeklySets);
  const displayEReps = targetEReps > 0 ? targetEReps : 32;

  return `Mentality Transition: Week ${step.currentWeek} of ${step.totalWeeks} (${fromName} → ${toName}) — ${rpeDesc} while ${setDesc} to maintain ${displayEReps} weekly eReps`;
}

// ============================================================================
// Pure Transition Solver
// ============================================================================

/**
 * Pure transition solver calculating weekly linear RIR / RPE ramps and
 * isometric eRep set counts for cross-fade waves.
 *
 * Can be called with positional arguments:
 *   calculateTransitionWave(fromMentality, toMentality, currentWeek, totalWeeks, targetWeeklyEReps, weeklyFrequency)
 * Or with an options object:
 *   calculateTransitionWave({ fromMentality, toMentality, currentWeek, ... })
 */
export function calculateTransitionWave(
  optionsOrFrom: TransitionWaveOptions | TrainingMentality,
  toMentalityArg?: TrainingMentality,
  currentWeekArg?: number,
  totalWeeksArg: number = 3,
  targetWeeklyERepsArg: number = 32,
  weeklyFrequencyArg: number = 2
): TransitionWaveStep {
  let fromMentality: TrainingMentality;
  let toMentality: TrainingMentality;
  let currentWeek: number;
  let totalWeeks = totalWeeksArg;
  let targetWeeklyEReps = targetWeeklyERepsArg;
  let weeklyFrequency = weeklyFrequencyArg;

  if (typeof optionsOrFrom === 'object') {
    fromMentality = optionsOrFrom.fromMentality;
    toMentality = optionsOrFrom.toMentality;
    currentWeek = optionsOrFrom.currentWeek;
    if (optionsOrFrom.totalWeeks !== undefined) totalWeeks = optionsOrFrom.totalWeeks;
    if (optionsOrFrom.targetWeeklyEReps !== undefined) targetWeeklyEReps = optionsOrFrom.targetWeeklyEReps;
    if (optionsOrFrom.weeklyFrequency !== undefined) weeklyFrequency = optionsOrFrom.weeklyFrequency;
  } else {
    fromMentality = optionsOrFrom;
    toMentality = toMentalityArg!;
    currentWeek = currentWeekArg!;
  }

  // Sanitization & bounds
  totalWeeks = Math.max(1, totalWeeks);
  weeklyFrequency = Math.max(1, weeklyFrequency);
  targetWeeklyEReps = Math.max(10, targetWeeklyEReps);

  const fromProfile = MENTALITY_PROFILES[fromMentality] ?? MENTALITY_PROFILES.precision;
  const toProfile = MENTALITY_PROFILES[toMentality] ?? MENTALITY_PROFILES.precision;

  // If same mentality, no transition wave is active
  if (fromMentality === toMentality) {
    const eRepsPerSet = fromProfile.eRepsPerSet;
    const targetWeeklySets = Math.round(targetWeeklyEReps / eRepsPerSet);
    const targetSetsPerSession = Math.round(targetWeeklySets / weeklyFrequency);

    return {
      fromMentality,
      toMentality,
      currentWeek,
      totalWeeks,
      isTransitionActive: false,
      progressFraction: 1.0,
      targetRir: fromProfile.baselineRir,
      targetRpe: fromProfile.baselineRpe,
      baselineRir: fromProfile.baselineRir,
      baselineRpe: fromProfile.baselineRpe,
      goalRir: toProfile.baselineRir,
      goalRpe: toProfile.baselineRpe,
      eRepsPerSet,
      targetSetsPerSession,
      targetWeeklySets,
      rpeDelta: 0,
      setDelta: 0,
      bannerMessage: '',
    };
  }

  // Check if transition is complete
  if (currentWeek > totalWeeks) {
    const eRepsPerSet = toProfile.eRepsPerSet;
    const targetWeeklySets = Math.round(targetWeeklyEReps / eRepsPerSet);
    const targetSetsPerSession = Math.round(targetWeeklySets / weeklyFrequency);

    return {
      fromMentality,
      toMentality,
      currentWeek,
      totalWeeks,
      isTransitionActive: false,
      progressFraction: 1.0,
      targetRir: toProfile.baselineRir,
      targetRpe: toProfile.baselineRpe,
      baselineRir: fromProfile.baselineRir,
      baselineRpe: fromProfile.baselineRpe,
      goalRir: toProfile.baselineRir,
      goalRpe: toProfile.baselineRpe,
      eRepsPerSet,
      targetSetsPerSession,
      targetWeeklySets,
      rpeDelta: Number((toProfile.baselineRpe - fromProfile.baselineRpe).toFixed(2)),
      setDelta: 0,
      bannerMessage: '',
    };
  }

  // Active transition wave: clamp progress fraction between 0 and 1
  const clampedWeek = Math.max(1, currentWeek);
  const progressFraction = Math.min(1.0, clampedWeek / totalWeeks);

  // 1. Linear RIR interpolation: RIR(t) = RIR_from + (t / T) * (RIR_to - RIR_from)
  const interpolatedRir =
    fromProfile.baselineRir + progressFraction * (toProfile.baselineRir - fromProfile.baselineRir);
  const targetRir = Number(interpolatedRir.toFixed(2));

  // 2. RPE derived via 10 - RIR
  const targetRpe = Number((10 - targetRir).toFixed(2));
  const rpeDelta = Number((targetRpe - fromProfile.baselineRpe).toFixed(2));

  // 3. Effective reps per set: clamped between 1 and 5
  const eRepsPerSet = Math.max(1, Math.min(5, Number((5 - targetRir).toFixed(2))));

  // 4. Sets(t) = round( E_target / ((5 - RIR(t)) * f_week) )
  const targetWeeklySets = Math.round(targetWeeklyEReps / eRepsPerSet);
  const targetSetsPerSession = Math.max(1, Math.round(targetWeeklySets / weeklyFrequency));

  // Baseline sets for comparison
  const baselineWeeklySets = Math.round(targetWeeklyEReps / fromProfile.eRepsPerSet);
  const baselineSetsPerSession = Math.max(1, Math.round(baselineWeeklySets / weeklyFrequency));

  // Determine set delta (how many sets added or trimmed)
  // For individual exercise or session level:
  // If moving toward higher exertion (RIR decreasing), sets are trimmed.
  // If moving toward lower exertion (RIR increasing), sets are added.
  let setDelta = targetSetsPerSession - baselineSetsPerSession;
  if (setDelta === 0 && Math.abs(toProfile.baselineRir - fromProfile.baselineRir) >= 0.5) {
    // If rounding made delta 0 during early week, determine directional step:
    if (toProfile.baselineRir < fromProfile.baselineRir) {
      setDelta = -1; // trimmed
    } else if (toProfile.baselineRir > fromProfile.baselineRir) {
      setDelta = 1; // added
    }
  }

  const step: TransitionWaveStep = {
    fromMentality,
    toMentality,
    currentWeek: clampedWeek,
    totalWeeks,
    isTransitionActive: true,
    progressFraction: Number(progressFraction.toFixed(2)),
    targetRir,
    targetRpe,
    baselineRir: fromProfile.baselineRir,
    baselineRpe: fromProfile.baselineRpe,
    goalRir: toProfile.baselineRir,
    goalRpe: toProfile.baselineRpe,
    eRepsPerSet,
    targetSetsPerSession,
    targetWeeklySets,
    rpeDelta,
    setDelta,
    bannerMessage: '',
  };

  step.bannerMessage = formatTransitionBanner(step);

  return step;
}

/**
 * Generates the complete multi-week schedule for a transition wave (weeks 1 to T).
 */
export function generateTransitionWaveSchedule(
  fromMentality: TrainingMentality,
  toMentality: TrainingMentality,
  totalWeeks: number = 3,
  targetWeeklyEReps: number = 32,
  weeklyFrequency: number = 2
): TransitionWaveStep[] {
  const schedule: TransitionWaveStep[] = [];
  for (let w = 1; w <= totalWeeks; w++) {
    schedule.push(
      calculateTransitionWave(
        fromMentality,
        toMentality,
        w,
        totalWeeks,
        targetWeeklyEReps,
        weeklyFrequency
      )
    );
  }
  return schedule;
}

/**
 * Adjusts an existing exercise's set count based on the active transition wave step.
 * Clamps to a minimum of 1 set and maximum of 5 sets.
 */
export function calculateAdjustedExerciseSets(
  baseSets: number,
  step: TransitionWaveStep | null | undefined
): number {
  if (!step || !step.isTransitionActive) {
    return baseSets;
  }
  return Math.max(1, Math.min(5, baseSets + step.setDelta));
}
