/**
 * Workout Suite — Declarative Progression Rule Engine
 *
 * Implements ADR-004: Declarative Condition-Action Schema for Progression Builder
 * Implements ADR-019: Interactive Progression Confirmation UX
 *
 * Pure, side-effect-free evaluator that analyzes completed workout session history
 * against template exercise prescriptions and declarative progression rules.
 *
 * Supports:
 * - Linear Progression (LP): Add load when all sets hit target reps; deload on consecutive plateaus.
 * - Double Progression (DP): Progress within a rep bracket; increase load and reset reps when all sets hit ceiling.
 * - Dynamic Double Progression (DDP): Advance load independently on individual sets hitting top of rep bracket.
 * - Autoregulated / RPE caps and volume adjustments (working sets addition/reduction).
 */

import {
  ProgressionRule,
  ProgressionRuleDefinition,
  ProgressionCondition,
  ProgressionAction,
  ProgressionConditionType,
  ProgressionActionType,
  TemplateExercise,
  WorkoutSet,
  WorkoutSession,
  ProgressionProposal,
  SetProgressionProposal,
  ProgressionEvaluationResult,
  SetType,
} from '../types';
import { roundToStep } from '../math/unitConversion';
import { calculateHeuristic1RM, DEFAULT_LOMBARDI_K, isReliable1RMInput } from '../math/heuristic1rm';

/**
 * Project ordinary, effort-rated straight sets to the prescription's base reps
 * and effort. AMRAP is simply a 0-RIR observation. Unrated sets are not failure
 * observations. Require a complete session and use its median capacity so one
 * exceptional set cannot determine the next working load.
 * e10RM is the same capacity normalized to ten failure reps, not a second vote.
 */
export function estimateProgressionCapacity(sets: WorkoutSet[], prescription: TemplateExercise) {
  const working = sets.filter(s => s.exercise_id === prescription.exercise_id && s.set_type !== 'warmup');
  const targetReps = prescription.target_reps_min ?? prescription.target_reps_max;
  const targetRir = prescription.target_rir ??
    (prescription.target_rpe != null ? 10 - prescription.target_rpe : null);
  if (!targetReps || !Number.isFinite(targetReps) || targetReps < 1 || targetRir == null || !Number.isFinite(targetRir) || targetRir < 0 || targetRir > 3 ||
      working.length < (prescription.target_sets ?? 1) || working.length === 0) return null;
  const estimates: number[] = [];
  for (const set of working) {
    // Fatigue techniques do not represent comparable straight-set capacity.
    if (set.set_type !== 'working' && set.set_type !== 'amrap') return null;
    const rir = set.set_type === 'amrap' ? 0 : set.rir ?? (set.rpe != null ? 10 - set.rpe : null);
    if (rir == null || !Number.isFinite(rir) || rir < 0 || rir > 3 ||
        !Number.isFinite(set.reps) || !Number.isFinite(set.weight) || set.weight <= 0 ||
        set.reps < (prescription.target_reps_min ?? targetReps) ||
        !isReliable1RMInput(set.reps, { rir })) return null;
    // Honour the existing weight-mastery guard for submaximal work.
    if (rir < 0.5 && targetRir > 0.5) return null;
    estimates.push(calculateHeuristic1RM(set.weight, set.reps, { rir }));
  }
  estimates.sort((a, b) => a - b);
  const middle = Math.floor(estimates.length / 2);
  const e1rmKg = estimates.length % 2 ? estimates[middle] : (estimates[middle - 1] + estimates[middle]) / 2;
  return {
    e1rmKg,
    e10rmKg: e1rmKg / Math.pow(10, DEFAULT_LOMBARDI_K),
    projectedLoadKg: e1rmKg / Math.pow(targetReps + targetRir, DEFAULT_LOMBARDI_K),
    currentWeightKg: Math.max(...working.map(s => s.weight)),
  };
}

/** Capacity-based progression is available every session, without failure testing. */
export function createEstimatedCapacityProgressionRule(templateExerciseId: string, incrementKg = 2.5): ProgressionRule {
  return {
    id: `rule-capacity-${templateExerciseId}`,
    template_exercise_id: templateExerciseId,
    priority: 0,
    rule_json: {
      conditions: [{ type: 'ESTIMATED_CAPACITY_SUPPORTS_INCREASE', threshold: incrementKg }],
      actions: [{ type: 'INCREASE_LOAD_FROM_ESTIMATED_CAPACITY', value: incrementKg }],
      notes: 'Effort-adjusted e1RM/e10RM progression from completed working sets',
    },
  };
}

// ============================================================================
// Engine Configuration Options & Result Interfaces
// ============================================================================

export interface ProgressionEngineOptions {
  /**
   * Minimum load increment in kg to round suggested weights to (default: 0.5 kg).
   * In powerlifting or micro-loading, can be set to 0.25, 0.5, 1.25, or 2.5 kg.
   */
  roundingStepKg?: number;
  /**
   * Equipment implement increment step in kg for AMRAP floor rounding (defaults to 2.5 kg).
   */
  gearIncrementKg?: number;
  /**
   * Current 1-based week index within active mesocycle block (e.g. 1, 2, 3, 4).
   */
  currentMesocycleWeek?: number;
  /**
   * Total planned accumulation weeks in active mesocycle (e.g. 4 for Meso 0, 6-8 for longer mesocycles).
   */
  totalMesocycleWeeks?: number;
  /**
   * Explicit override indicating evaluation is occurring on the midway diagnostic week (floor(L / 2)).
   */
  isMidwayWeek?: boolean;
  /**
   * Explicit override indicating evaluation is occurring on the final accumulation week prior to deload.
   */
  isFinalAccumulationWeek?: boolean;
  /**
   * User-predicted repetitions prior to AMRAP set execution (R_pred) for RIR bias calibration.
   */
  predictedReps?: number;
  /**
   * Map of exercise_id -> predicted reps for multi-exercise sessions.
   */
  predictedRepsByExerciseId?: Record<string, number>;
}

export interface AmrapProgressionInput {
  currentLoadKg: number;
  actualReps: number;
  targetRepsMax: number;
  incrementKg?: number;
  pctPerRep?: number;
}

export interface AmrapProgressionResult {
  repsOver: number;
  pctGain: number; // e.g. 4 for 4%
  rawTargetLoadKg: number;
  nextPrescribedLoadKg: number;
  effectiveIncrementKg: number;
}

export interface RirBiasInput {
  actualReps: number;
  predictedReps: number;
  currentTargetReps?: number;
  currentTargetRpe?: number;
}

export interface RirBiasResult {
  rirBias: number;
  hasSandbaggingBias: boolean;
  repAdjustment: number;
  adjustedTargetReps?: number;
  calibratedRpeNote?: string;
  explanation: string;
}

export interface LinearProgressionOptions {
  id?: string;
  incrementKg?: number;
  plateauThresholdSessions?: number;
  deloadPercent?: number;
  notes?: string;
}

export interface DoubleProgressionOptions {
  id?: string;
  incrementKg?: number;
  plateauThresholdSessions?: number;
  deloadPercent?: number;
  notes?: string;
}

export interface DynamicDoubleProgressionOptions {
  id?: string;
  incrementKg?: number;
  plateauThresholdSessions?: number;
  deloadPercent?: number;
  notes?: string;
}

export interface AmrapProgressionOptions {
  id?: string;
  incrementKg?: number;
  notes?: string;
}

export interface AmrapMidwayOptions {
  id?: string;
  midwayWeek?: number;
  notes?: string;
}

export interface AmrapFinalWeekOptions {
  id?: string;
  notes?: string;
}

// ============================================================================
// Pure Mathematical & AMRAP Helpers
// ============================================================================

/**
 * Strictly rounds a weight DOWN to the closest available implement increment step.
 * Formula: floor(W / Delta) * Delta.
 *
 * Implements Pillar 4 of THEORY_INTEGRATION_AND_MESOCYCLE_ARCHITECTURE.md.
 * Prevents accidental failure spikes from rounding up load jumps after AMRAP sets.
 *
 * @param weightKg Raw target weight calculated before rounding.
 * @param incrementKg Smallest available increment from gear or default (e.g. 2.5 kg, 1.25 kg).
 */
export function floorToIncrement(weightKg: number, incrementKg: number): number {
  if (incrementKg <= 0) {
    return Math.max(0, weightKg);
  }
  const stepped = Math.floor((weightKg + 1e-9) / incrementKg) * incrementKg;
  return Math.max(0, Math.round(stepped * 10000) / 10000);
}

/**
 * Calculates deterministic load escalation based on reps completed over target ceiling in an AMRAP set.
 *
 * Formula:
 * Delta L% = max(0, R_actual - R_target_max) * 1%
 * Raw Target Load = Current Load * (1 + Delta L%)
 * Next Prescribed Load = floor_to_increment(Raw Target Load, Delta_gear)
 *
 * Implements Pillar 4 of THEORY_INTEGRATION_AND_MESOCYCLE_ARCHITECTURE.md.
 */
export function calculateAmrapProgression(
  input: AmrapProgressionInput
): AmrapProgressionResult {
  const {
    currentLoadKg,
    actualReps,
    targetRepsMax,
    incrementKg = 2.5,
    pctPerRep = 0.01,
  } = input;

  const repsOver = Math.max(0, actualReps - targetRepsMax);
  const fractionalGain = repsOver * pctPerRep;
  const pctGain = Number((fractionalGain * 100).toFixed(1));
  const rawTargetLoadKg = currentLoadKg * (1 + fractionalGain);
  const nextPrescribedLoadKg = floorToIncrement(rawTargetLoadKg, incrementKg);

  return {
    repsOver,
    pctGain,
    rawTargetLoadKg: Math.round(rawTargetLoadKg * 100) / 100,
    nextPrescribedLoadKg,
    effectiveIncrementKg: incrementKg,
  };
}

/**
 * Evaluates athlete RIR accuracy bias (beta_RIR = R_actual - R_pred) and computes
 * greedy target rep adjustments and display calibration warnings.
 *
 * Implements Pillar 5 of THEORY_INTEGRATION_AND_MESOCYCLE_ARCHITECTURE.md:
 * - If beta_RIR <= 1: Trainee has accurate self-perception.
 * - If beta_RIR >= 2: Trainee has significant sandbagging bias.
 *   1. Immediate target rep minimum increased by +floor(beta_RIR / 2).
 *   2. Displays calibrated push cue in session notes.
 */
export function calculateRirBias(input: RirBiasInput): RirBiasResult {
  const { actualReps, predictedReps, currentTargetReps, currentTargetRpe = 8.0 } = input;
  const rirBias = actualReps - predictedReps;
  const hasSandbaggingBias = rirBias >= 2;
  const repAdjustment = hasSandbaggingBias ? Math.floor(rirBias / 2) : 0;

  const adjustedTargetReps =
    currentTargetReps != null ? currentTargetReps + repAdjustment : undefined;

  let calibratedRpeNote: string | undefined;
  let explanation: string;

  if (hasSandbaggingBias) {
    const targetDisplay = adjustedTargetReps ?? currentTargetReps ?? actualReps;
    calibratedRpeNote = `Target: ${targetDisplay} reps @ RPE ${currentTargetRpe.toFixed(1)}. Note: Based on your recent AMRAP, push ${rirBias} reps past where you normally feel fatigue starting.`;
    explanation = `RIR bias detected (predicted ${predictedReps} reps, completed ${actualReps} reps; bias = +${rirBias}). Increased target reps by +${repAdjustment} and calibrated RPE perception cue.`;
  } else if (rirBias >= 0) {
    explanation = `Accurate RIR perception (bias = +${rirBias}). Prescribed targets maintained.`;
  } else {
    explanation = `Slight overestimation of capacity (bias = ${rirBias}). Prescribed targets maintained.`;
  }

  return {
    rirBias,
    hasSandbaggingBias,
    repAdjustment,
    adjustedTargetReps,
    calibratedRpeNote,
    explanation,
  };
}

/**
 * Extracts predicted repetitions from a WorkoutSet's `set_notes` field if present.
 * Looks for JSON payload (e.g. `{"predicted_reps": 10}`) or plain tag (e.g. `pred_reps: 10` or `predicted_reps: 10`).
 */
export function extractPredictedRepsFromSet(set: WorkoutSet): number | null {
  if (!set.set_notes) {
    return null;
  }
  const notes = set.set_notes.trim();

  // Try JSON parsing
  if (notes.startsWith('{') && notes.endsWith('}')) {
    try {
      const parsed = JSON.parse(notes);
      if (typeof parsed.predicted_reps === 'number') {
        return parsed.predicted_reps;
      }
      if (typeof parsed.pred_reps === 'number') {
        return parsed.pred_reps;
      }
    } catch {
      // ignore JSON parse error
    }
  }

  // Regex fallback: pred_reps: 10 or predicted_reps: 10
  const match = notes.match(/(?:predicted_reps|pred_reps)\s*[:=]\s*(\d+)/i);
  if (match && match[1]) {
    const parsed = parseInt(match[1], 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

// ============================================================================
// Internal Normalized Session Representation
// ============================================================================

interface NormalizedExerciseSession {
  session: WorkoutSession;
  date: string;
  workingSets: WorkoutSet[];
}

// ============================================================================
// Rule JSON Deserializer Helper
// ============================================================================

/**
 * Safely parses and normalizes a ProgressionRuleDefinition from either
 * an in-memory object or a stringified JSON column from SQLite.
 */
export function parseRuleDefinition(
  ruleJson: string | ProgressionRuleDefinition | null | undefined
): ProgressionRuleDefinition | null {
  if (!ruleJson) {
    return null;
  }

  if (typeof ruleJson === 'object') {
    if (Array.isArray(ruleJson.conditions) && Array.isArray(ruleJson.actions)) {
      return ruleJson;
    }
    return null;
  }

  if (typeof ruleJson === 'string') {
    try {
      const parsed = JSON.parse(ruleJson);
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray(parsed.conditions) &&
        Array.isArray(parsed.actions)
      ) {
        return parsed as ProgressionRuleDefinition;
      }
    } catch {
      return null;
    }
  }

  return null;
}

// ============================================================================
// Session History Helpers
// ============================================================================

/**
 * Checks whether a single session satisfied the target set and rep requirements
 * for a template exercise prescription.
 *
 * Criteria:
 * 1. Contains working sets (warmup sets are excluded).
 * 2. Set count meets or exceeds `prescription.target_sets` (if specified).
 * 3. Every working set meets or exceeds the target repetition threshold:
 *    - Uses `target_reps_max` if specified (rep bracket ceiling, e.g. 12 in 8-12)
 *    - Falls back to `target_reps_min` (e.g. 5 in 5x5)
 */
export function isSessionSuccessful(
  workingSets: WorkoutSet[],
  prescription: TemplateExercise
): boolean {
  if (!workingSets || workingSets.length === 0) {
    return false;
  }

  if (
    prescription.target_sets != null &&
    prescription.target_sets > 0 &&
    workingSets.length < prescription.target_sets
  ) {
    return false;
  }

  const targetReps =
    prescription.target_reps_max ?? prescription.target_reps_min ?? 0;

  if (targetReps <= 0) {
    return true;
  }

  return workingSets.every((set) => set.reps >= targetReps);
}

/**
 * Evaluates whether a session represents a plateau or failed session.
 * For rep brackets (e.g. 8-12 reps in double progression):
 * - Fails if any working set falls below target_reps_min.
 * - Fails if working sets count is less than target_sets.
 * - Fails if total completed reps fail to exceed or match the previous session's total reps (decreased reps).
 * - If total reps exceeded previous session, it represents forward progression (not stalled/failed).
 * For single target reps (e.g. 5x5 linear progression):
 * - Fails if any set fails to achieve the target reps (or total reps decrease).
 */
export function isSessionStalledOrFailed(
  sessionIndex: number,
  normalizedSessions: NormalizedExerciseSession[],
  prescription: TemplateExercise
): boolean {
  const current = normalizedSessions[sessionIndex];
  if (!current || !current.workingSets || current.workingSets.length === 0) {
    return true;
  }

  const minReps = prescription.target_reps_min ?? prescription.target_reps_max ?? 0;
  if (minReps > 0 && current.workingSets.some((s) => s.reps < minReps)) {
    return true;
  }

  if (
    prescription.target_sets != null &&
    prescription.target_sets > 0 &&
    current.workingSets.length < prescription.target_sets
  ) {
    return true;
  }

  // Compare with previous session if available
  if (sessionIndex > 0) {
    const prev = normalizedSessions[sessionIndex - 1];
    const currentTotalReps = current.workingSets.reduce((sum, s) => sum + s.reps, 0);
    const prevTotalReps = prev.workingSets.reduce((sum, s) => sum + s.reps, 0);

    const currentMaxWeight = Math.max(...current.workingSets.map((s) => s.weight));
    const prevMaxWeight = Math.max(...prev.workingSets.map((s) => s.weight));

    // If load decreased, or load is equal and total reps failed to exceed or match previous session
    if (currentMaxWeight < prevMaxWeight) {
      return true;
    }
    if (currentMaxWeight === prevMaxWeight && currentTotalReps < prevTotalReps) {
      return true;
    }
    // If total reps exceeded previous session, it's forward progression
    if (currentTotalReps > prevTotalReps) {
      return false;
    }
  }

  // For single-rep targets (e.g. 5x5 LP), any session not hitting target reps is a failed session
  const maxReps = prescription.target_reps_max;
  const isRepBracket = maxReps != null && prescription.target_reps_min != null && maxReps > prescription.target_reps_min;
  if (!isRepBracket) {
    return !isSessionSuccessful(current.workingSets, prescription);
  }

  return !isSessionSuccessful(current.workingSets, prescription);
}

/**
 * Extracts working sets for the specified exercise and orders sessions chronologically.
 */
function normalizeAndSortSessions(
  recentSessions: WorkoutSession[],
  exerciseId: string
): NormalizedExerciseSession[] {
  const result: NormalizedExerciseSession[] = [];

  for (const session of recentSessions) {
    // Extract sets matching this exercise, ignoring warmup sets
    const workingSets = (session.sets || []).filter(
      (s) => s.exercise_id === exerciseId && s.set_type !== 'warmup'
    );

    if (workingSets.length > 0) {
      // Determine date from session.date, session.workout.date, or set timestamp
      const date =
        session.date ||
        session.workout?.date ||
        workingSets[0].created_at.substring(0, 10) ||
        '1970-01-01';

      // Ensure sets within the session are ordered by set_number
      const sortedSets = workingSets.slice().sort((a, b) => a.set_number - b.set_number);

      result.push({
        session,
        date,
        workingSets: sortedSets,
      });
    }
  }

  // Sort chronologically ascending (oldest first, newest last)
  result.sort((a, b) => a.date.localeCompare(b.date));

  return result;
}

// ============================================================================
// Condition Evaluators
// ============================================================================

function evaluateCondition(
  condition: ProgressionCondition,
  normalizedSessions: NormalizedExerciseSession[],
  prescription: TemplateExercise,
  options: ProgressionEngineOptions = {}
): boolean {
  if (normalizedSessions.length === 0) {
    return false;
  }

  const latestSession = normalizedSessions[normalizedSessions.length - 1];
  const latestWorkingSets = latestSession.workingSets;

  switch (condition.type) {
    case 'ESTIMATED_CAPACITY_SUPPORTS_INCREASE': {
      const capacity = estimateProgressionCapacity(latestWorkingSets, prescription);
      const increment = options.gearIncrementKg ?? condition.threshold ?? 2.5;
      return capacity != null && Number.isFinite(increment) && increment > 0 &&
        floorToIncrement(capacity.projectedLoadKg, increment) > capacity.currentWeightKg;
    }
    case 'ALL_SETS_HIT_TARGET_REPS': {
      return isSessionSuccessful(latestWorkingSets, prescription);
    }

    case 'ANY_SET_HIT_TOP_REP_RANGE': {
      const topTarget =
        prescription.target_reps_max ??
        prescription.target_reps_min ??
        condition.threshold ??
        0;

      if (topTarget <= 0 || latestWorkingSets.length === 0) {
        return false;
      }

      return latestWorkingSets.some((s) => s.reps >= topTarget);
    }

    case 'AVERAGE_RPE_LESS_THAN': {
      if (latestWorkingSets.length === 0) {
        return false;
      }

      // Convert RPE or RIR (10 - RIR)
      const rpeValues: number[] = [];
      for (const set of latestWorkingSets) {
        if (set.rpe != null) {
          rpeValues.push(set.rpe);
        } else if (set.rir != null) {
          rpeValues.push(10 - set.rir);
        }
      }

      if (rpeValues.length === 0) {
        return false;
      }

      const avgRpe = rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length;
      const threshold =
        condition.threshold ?? prescription.target_rpe ?? 8.0;

      if (condition.comparison === 'lte') {
        return avgRpe <= threshold;
      }
      return avgRpe < threshold;
    }

    case 'CONSECUTIVE_SUCCESSFUL_SESSIONS': {
      const requiredCount = condition.threshold ?? 2;
      if (normalizedSessions.length < requiredCount) {
        return false;
      }

      const recentSlice = normalizedSessions.slice(-requiredCount);
      return recentSlice.every((s) =>
        isSessionSuccessful(s.workingSets, prescription)
      );
    }

    case 'CONSECUTIVE_FAILED_SESSIONS': {
      const requiredCount = condition.threshold ?? 2;
      if (normalizedSessions.length < requiredCount) {
        return false;
      }

      const startIndex = normalizedSessions.length - requiredCount;
      for (let i = startIndex; i < normalizedSessions.length; i++) {
        if (!isSessionStalledOrFailed(i, normalizedSessions, prescription)) {
          return false;
        }
      }
      return true;
    }

    case 'MISSED_REPS_COUNT': {
      const targetReps =
        prescription.target_reps_min ?? prescription.target_reps_max ?? 0;
      if (targetReps <= 0) {
        return false;
      }

      let totalMissed = 0;
      for (const set of latestWorkingSets) {
        if (set.reps < targetReps) {
          totalMissed += targetReps - set.reps;
        }
      }

      // If target_sets was specified and fewer sets were performed, count missed sets
      if (
        prescription.target_sets != null &&
        latestWorkingSets.length < prescription.target_sets
      ) {
        const missedSets = prescription.target_sets - latestWorkingSets.length;
        totalMissed += missedSets * targetReps;
      }

      const threshold = condition.threshold ?? 1;
      const comparison = condition.comparison ?? 'gte';

      switch (comparison) {
        case 'gt':
          return totalMissed > threshold;
        case 'gte':
          return totalMissed >= threshold;
        case 'eq':
          return totalMissed === threshold;
        case 'lte':
          return totalMissed <= threshold;
        case 'lt':
          return totalMissed < threshold;
      }
      break;
    }

    case 'TOP_SET_RIR_GREATER_THAN': {
      if (latestWorkingSets.length === 0) {
        return false;
      }

      const rirValues: number[] = [];
      for (const set of latestWorkingSets) {
        if (set.rir != null) {
          rirValues.push(set.rir);
        } else if (set.rpe != null) {
          rirValues.push(10 - set.rpe);
        }
      }

      if (rirValues.length === 0) {
        return false;
      }

      const maxRir = Math.max(...rirValues);
      const threshold = condition.threshold ?? 2;
      const comparison = condition.comparison ?? 'gt';

      switch (comparison) {
        case 'gt':
          return maxRir > threshold;
        case 'gte':
          return maxRir >= threshold;
        case 'eq':
          return maxRir === threshold;
        case 'lte':
          return maxRir <= threshold;
        case 'lt':
          return maxRir < threshold;
      }
      break;
    }

    case 'MESOCYCLE_FINAL_WEEK': {
      if (options.isFinalAccumulationWeek === true) {
        return true;
      }
      if (
        options.currentMesocycleWeek != null &&
        options.totalMesocycleWeeks != null &&
        options.currentMesocycleWeek >= options.totalMesocycleWeeks
      ) {
        return true;
      }
      if (
        condition.threshold != null &&
        options.currentMesocycleWeek != null &&
        options.currentMesocycleWeek >= condition.threshold
      ) {
        return true;
      }
      return false;
    }

    case 'MESOCYCLE_MIDWAY_WEEK': {
      if (options.isMidwayWeek === true) {
        return true;
      }
      const totalWeeks = options.totalMesocycleWeeks ?? 4;
      const expectedMidwayWeek = condition.threshold ?? Math.floor(totalWeeks / 2);
      if (
        options.currentMesocycleWeek != null &&
        options.currentMesocycleWeek === expectedMidwayWeek
      ) {
        return true;
      }
      return false;
    }

    case 'AMRAP_COMPLETED': {
      const amrapSets = latestWorkingSets.filter((s) => s.set_type === 'amrap');
      if (amrapSets.length === 0) {
        return false;
      }
      if (condition.threshold != null) {
        const comparison = condition.comparison ?? 'gte';
        const maxReps = Math.max(...amrapSets.map((s) => s.reps));
        switch (comparison) {
          case 'gt':
            return maxReps > condition.threshold;
          case 'gte':
            return maxReps >= condition.threshold;
          case 'eq':
            return maxReps === condition.threshold;
          case 'lte':
            return maxReps <= condition.threshold;
          case 'lt':
            return maxReps < condition.threshold;
        }
      }
      return true;
    }

    default:
      return false;
  }
}

// ============================================================================
// Action Evaluator & Proposal Synthesizer
// ============================================================================

function synthesizeProposal(
  rule: ProgressionRule,
  definition: ProgressionRuleDefinition,
  latestSession: NormalizedExerciseSession,
  prescription: TemplateExercise,
  options: ProgressionEngineOptions = {}
): ProgressionProposal {
  const roundingStepKg = options.roundingStepKg ?? 0.5;
  const latestWorkingSets = latestSession.workingSets;

  // Base weight is the maximum weight achieved among working sets in the latest session
  const currentWeightKg =
    latestWorkingSets.length > 0
      ? Math.max(...latestWorkingSets.map((s) => s.weight))
      : 0;

  const topRepTarget =
    prescription.target_reps_max ?? prescription.target_reps_min ?? 0;

  const isDdpRule = definition.conditions.some(
    (c) => c.type === 'ANY_SET_HIT_TOP_REP_RANGE'
  );

  let suggestedWeightKg = currentWeightKg;
  let suggestedTargetReps: number | undefined;
  let suggestedTargetSets: number | undefined;
  let isDeload = false;
  const explanations: string[] = [];
  let primaryAction: ProgressionAction = definition.actions[0] || {
    type: 'INCREASE_LOAD_FIXED',
    value: 2.5,
  };

  let setProposals: SetProgressionProposal[] | undefined;

  for (const action of definition.actions) {
    switch (action.type) {
      case 'INCREASE_LOAD_FROM_ESTIMATED_CAPACITY': {
        const capacity = estimateProgressionCapacity(latestWorkingSets, prescription);
        const increment = options.gearIncrementKg ?? (action.value > 0 ? action.value : 2.5);
        if (capacity) {
          // Limit any single-session increase to one implement step.
          suggestedWeightKg = Math.max(currentWeightKg, Math.min(
            currentWeightKg + increment, floorToIncrement(capacity.projectedLoadKg, increment)
          ));
          if (suggestedWeightKg > currentWeightKg) suggestedTargetReps = prescription.target_reps_min ?? topRepTarget;
          explanations.push(`Effort-adjusted capacity: e1RM ${capacity.e1rmKg.toFixed(1)} kg, e10RM ${capacity.e10rmKg.toFixed(1)} kg. At ${prescription.target_reps_min ?? topRepTarget} reps and ${prescription.target_rir ?? 10 - (prescription.target_rpe ?? 8)} RIR, ${suggestedWeightKg > currentWeightKg ? 'increase to' : 'maintain'} ${suggestedWeightKg} kg.`);
        }
        break;
      }
      case 'INCREASE_LOAD_FIXED': {
        const delta = action.value > 0 ? action.value : 2.5;
        suggestedWeightKg = roundToStep(currentWeightKg + delta, roundingStepKg);

        if (isDdpRule) {
          // Dynamic Double Progression: individual set evaluation
          setProposals = latestWorkingSets.map((set) => {
            const hit = topRepTarget > 0 && set.reps >= topRepTarget;
            const newWeight = hit
              ? roundToStep(set.weight + delta, roundingStepKg)
              : set.weight;
            return {
              setIndex: set.set_number,
              currentWeightKg: set.weight,
              suggestedWeightKg: newWeight,
              currentReps: set.reps,
              targetHit: hit,
              status: hit ? 'increase' : 'maintain',
              explanation: hit
                ? `Set ${set.set_number}: Hit ${set.reps} reps (target ${topRepTarget}). Increase to ${newWeight} kg (+${delta} kg).`
                : `Set ${set.set_number}: Completed ${set.reps} reps (target ${topRepTarget}). Maintain ${set.weight} kg.`,
            };
          });

          const promotedCount = setProposals.filter((p) => p.status === 'increase').length;
          explanations.push(
            `Dynamic Double Progression: ${promotedCount}/${latestWorkingSets.length} sets hit top rep target (${topRepTarget} reps). Advance qualified sets by +${delta} kg.`
          );
        } else {
          explanations.push(
            `Target reps achieved across all sets. Increase load by ${delta} kg (from ${currentWeightKg} kg to ${suggestedWeightKg} kg).`
          );
        }
        break;
      }

      case 'INCREASE_LOAD_PERCENT': {
        const fraction = action.value > 1 ? action.value / 100 : action.value;
        const delta = currentWeightKg * fraction;
        suggestedWeightKg = roundToStep(currentWeightKg + delta, roundingStepKg);
        const percentStr = (fraction * 100).toFixed(1).replace(/\.0$/, '');
        explanations.push(
          `Target achieved. Increase load by ${percentStr}% (+${roundToStep(delta, roundingStepKg)} kg) to ${suggestedWeightKg} kg.`
        );
        break;
      }

      case 'DECREASE_LOAD_FIXED': {
        isDeload = true;
        const delta = action.value > 0 ? action.value : 2.5;
        suggestedWeightKg = Math.max(
          0,
          roundToStep(currentWeightKg - delta, roundingStepKg)
        );
        explanations.push(
          `Target missed. Decrease load by ${delta} kg (from ${currentWeightKg} kg to ${suggestedWeightKg} kg) to rebuild momentum.`
        );
        break;
      }

      case 'RESET_WEIGHT_PERCENT': {
        isDeload = true;
        const fraction = action.value > 1 ? action.value / 100 : action.value;
        const reduction = currentWeightKg * fraction;
        suggestedWeightKg = Math.max(
          0,
          roundToStep(currentWeightKg - reduction, roundingStepKg)
        );
        const percentStr = (fraction * 100).toFixed(1).replace(/\.0$/, '');
        explanations.push(
          `Plateau detected over consecutive sessions. Deload load by ${percentStr}% (-${roundToStep(reduction, roundingStepKg)} kg) to ${suggestedWeightKg} kg.`
        );
        break;
      }

      case 'INCREASE_TARGET_REPS': {
        const baseReps =
          prescription.target_reps_max ??
          prescription.target_reps_min ??
          8;
        suggestedTargetReps = baseReps + action.value;
        explanations.push(
          `Increase target reps by ${action.value} (new target: ${suggestedTargetReps} reps).`
        );
        break;
      }

      case 'ADD_WORKING_SET': {
        const baseSets = prescription.target_sets ?? 3;
        suggestedTargetSets = baseSets + action.value;
        explanations.push(
          `Add ${action.value} working set(s) (new prescription: ${suggestedTargetSets} sets).`
        );
        break;
      }

      case 'RESET_TO_BASELINE': {
        suggestedTargetReps = prescription.target_reps_min ?? 8;
        if (action.value > 0) {
          suggestedWeightKg = roundToStep(action.value, roundingStepKg);
        }
        explanations.push(
          `Reset target reps to baseline bracket (${suggestedTargetReps} reps).`
        );
        break;
      }

      case 'TRIGGER_DELOAD': {
        isDeload = true;
        // If action value provided, use it as percent or fixed load reduction
        let fraction = 0.10; // Default 10% deload
        if (action.value > 0) {
          fraction = action.value > 1 ? action.value / 100 : action.value;
        }
        const reduction = currentWeightKg * fraction;
        suggestedWeightKg = Math.max(
          0,
          roundToStep(currentWeightKg - reduction, roundingStepKg)
        );
        explanations.push(
          `Trigger deload session: reduce working load to ${suggestedWeightKg} kg for recovery.`
        );
        break;
      }

      case 'INCREASE_LOAD_AMRAP_OVER_CAP': {
        const amrapSet =
          latestWorkingSets.slice().reverse().find((s) => s.set_type === 'amrap') ||
          latestWorkingSets[latestWorkingSets.length - 1];

        const amrapLoad = amrapSet ? amrapSet.weight : currentWeightKg;
        const actualReps = amrapSet ? amrapSet.reps : 0;
        const targetMax =
          prescription.target_reps_max ??
          prescription.target_reps_min ??
          8;
        const increment =
          action.value > 0
            ? action.value
            : options.gearIncrementKg ?? options.roundingStepKg ?? 2.5;

        const prog = calculateAmrapProgression({
          currentLoadKg: amrapLoad,
          actualReps,
          targetRepsMax: targetMax,
          incrementKg: increment,
          pctPerRep: 0.01,
        });

        suggestedWeightKg = prog.nextPrescribedLoadKg;

        // Check for RIR bias if predicted reps provided in set notes, options, or dictionary
        const predicted =
          (amrapSet ? extractPredictedRepsFromSet(amrapSet) : null) ??
          options.predictedReps ??
          (options.predictedRepsByExerciseId
            ? options.predictedRepsByExerciseId[prescription.exercise_id]
            : null);

        let biasResult: RirBiasResult | null = null;
        if (predicted != null) {
          biasResult = calculateRirBias({
            actualReps,
            predictedReps: predicted,
            currentTargetReps: prescription.target_reps_min ?? 8,
            currentTargetRpe: prescription.target_rpe ?? 8.0,
          });
          if (biasResult.hasSandbaggingBias && biasResult.adjustedTargetReps != null) {
            suggestedTargetReps = biasResult.adjustedTargetReps;
          }
        }

        if (prog.repsOver > 0) {
          explanations.push(
            `AMRAP diagnostic: Completed ${actualReps} reps vs ${targetMax} rep target ceiling (+${prog.repsOver} reps over). Applied +${prog.pctGain}% load escalation: working load adjusted from ${amrapLoad} kg to ${suggestedWeightKg} kg (floor-rounded to ${increment} kg increment).`
          );
        } else {
          explanations.push(
            `AMRAP diagnostic: Completed ${actualReps} reps (within or below ${targetMax} rep target bracket). Maintain ${amrapLoad} kg.`
          );
        }

        if (biasResult && biasResult.hasSandbaggingBias) {
          explanations.push(
            `RIR bias (+${biasResult.rirBias}): Target reps adjusted to ${suggestedTargetReps} reps. ${biasResult.calibratedRpeNote}`
          );
        }
        break;
      }

      case 'SCHEDULE_AMRAP_MIDWAY': {
        const totalWeeks = options.totalMesocycleWeeks ?? 4;
        const midwayWeek = options.currentMesocycleWeek ?? Math.floor(totalWeeks / 2);
        explanations.push(
          `Mid-mesocycle diagnostic checkpoint (Week ${midwayWeek} of ${totalWeeks}): Perform final set as AMRAP (0 RIR / max effort) to test load calibration and RIR accuracy.`
        );
        break;
      }

      case 'SCHEDULE_AMRAP_FINAL_WEEK': {
        const totalWeeks = options.totalMesocycleWeeks ?? 4;
        const finalWeek = options.currentMesocycleWeek ?? totalWeeks;
        explanations.push(
          `End-of-mesocycle graduation AMRAP (Week ${finalWeek} of ${totalWeeks}): Uncap final set to 0 RIR to benchmark true progress and establish baselines for next mesocycle.`
        );
        break;
      }
    }
  }

  // Check if any AMRAP set has RIR bias metadata for proposal fields
  const amrapSet = latestWorkingSets.slice().reverse().find((s) => s.set_type === 'amrap');
  const predicted =
    (amrapSet ? extractPredictedRepsFromSet(amrapSet) : null) ??
    options.predictedReps ??
    (options.predictedRepsByExerciseId
      ? options.predictedRepsByExerciseId[prescription.exercise_id]
      : null);

  let rirBias: number | undefined;
  let calibratedRpeNote: string | undefined;
  if (amrapSet && predicted != null) {
    const biasResult = calculateRirBias({
      actualReps: amrapSet.reps,
      predictedReps: predicted,
      currentTargetReps: prescription.target_reps_min ?? 8,
      currentTargetRpe: prescription.target_rpe ?? 8.0,
    });
    rirBias = biasResult.rirBias;
    calibratedRpeNote = biasResult.calibratedRpeNote;
  }

  const suggestedSetType: SetType | undefined =
    primaryAction.type === 'SCHEDULE_AMRAP_FINAL_WEEK' ||
    primaryAction.type === 'SCHEDULE_AMRAP_MIDWAY'
      ? 'amrap'
      : undefined;

  return {
    ruleId: rule.id,
    rulePriority: rule.priority,
    ruleNotes: definition.notes,
    actionType: primaryAction.type,
    actionValue: primaryAction.value,
    explanation: explanations.join(' '),
    currentWeightKg,
    suggestedWeightKg,
    suggestedTargetReps,
    suggestedTargetSets,
    isDeload:
      isDeload ||
      primaryAction.type === 'TRIGGER_DELOAD' ||
      primaryAction.type === 'RESET_WEIGHT_PERCENT' ||
      primaryAction.type === 'DECREASE_LOAD_FIXED',
    setProposals,
    suggestedSetType,
    rirBias,
    calibratedRpeNote,
  };
}

// ============================================================================
// Main Public Evaluator
// ============================================================================

/**
 * Pure, side-effect-free progression rule evaluator.
 *
 * Takes an exercise's declarative rules, historical completed sessions, and current
 * template prescription, and evaluates conditions against session history.
 *
 * Returns an EvaluationResult containing `primaryProposal` (highest priority match)
 * and `matchedProposals` (all triggered rules ordered by priority ASC).
 *
 * @param rules Array of ProgressionRule entities from database or presets.
 * @param recentSessions Array of WorkoutSession (or WorkoutWithSets) instances.
 * @param currentPrescription The target prescription for this exercise from `template_exercises`.
 * @param options Evaluation configuration (e.g. `roundingStepKg`).
 */
export function evaluateProgressionRules(
  rules: ProgressionRule[],
  recentSessions: WorkoutSession[],
  currentPrescription: TemplateExercise,
  options: ProgressionEngineOptions = {}
): ProgressionEvaluationResult {
  const { roundingStepKg = 0.5 } = options;

  if (!rules || rules.length === 0 || !recentSessions || recentSessions.length === 0) {
    return {
      hasMatches: false,
      primaryProposal: null,
      matchedProposals: [],
      evaluatedRulesCount: rules ? rules.length : 0,
      recentSessionsEvaluated: 0,
    };
  }

  // 1. Filter sessions to this exercise and sort chronologically
  const normalizedSessions = normalizeAndSortSessions(
    recentSessions,
    currentPrescription.exercise_id
  );

  if (normalizedSessions.length === 0) {
    return {
      hasMatches: false,
      primaryProposal: null,
      matchedProposals: [],
      evaluatedRulesCount: rules.length,
      recentSessionsEvaluated: 0,
    };
  }

  const latestSession = normalizedSessions[normalizedSessions.length - 1];

  // 2. Sort rules by priority ASC (lower number = higher priority)
  const sortedRules = rules.slice().sort((a, b) => a.priority - b.priority);

  const matchedProposals: ProgressionProposal[] = [];

  // 3. Evaluate each rule
  for (const rule of sortedRules) {
    const definition = parseRuleDefinition(rule.rule_json);
    if (!definition || !definition.conditions || definition.conditions.length === 0) {
      continue;
    }

    // All conditions in a rule must be satisfied (AND semantics)
    const allConditionsPassed = definition.conditions.every((cond) =>
      evaluateCondition(cond, normalizedSessions, currentPrescription, options)
    );

    if (allConditionsPassed) {
      const proposal = synthesizeProposal(
        rule,
        definition,
        latestSession,
        currentPrescription,
        options
      );
      if (definition.actions.some(a => a.type === 'INCREASE_LOAD_FROM_ESTIMATED_CAPACITY') &&
          proposal.suggestedWeightKg === proposal.currentWeightKg) continue;
      matchedProposals.push(proposal);
    }
  }

  return {
    hasMatches: matchedProposals.length > 0,
    primaryProposal: matchedProposals.length > 0 ? matchedProposals[0] : null,
    matchedProposals,
    evaluatedRulesCount: rules.length,
    recentSessionsEvaluated: normalizedSessions.length,
  };
}

// ============================================================================
// Built-in Progression Presets
// ============================================================================

/**
 * Generates rules for Linear Progression (LP).
 *
 * Common in beginner strength programs (Starting Strength, StrongLifts 5x5):
 * - If all sets hit target reps: +2.5 kg load increase next session.
 * - If 3 consecutive sessions fail target reps: 10% deload to break plateau.
 */
export function createLinearProgressionRule(
  templateExerciseId: string,
  options: LinearProgressionOptions = {}
): ProgressionRule[] {
  const {
    id = `rule-lp-${templateExerciseId}`,
    incrementKg = 2.5,
    plateauThresholdSessions = 3,
    deloadPercent = 0.10,
    notes = 'Standard Linear Progression (LP)',
  } = options;

  return [
    {
      id: `${id}-success`,
      template_exercise_id: templateExerciseId,
      priority: 1,
      rule_json: {
        conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
        actions: [{ type: 'INCREASE_LOAD_FIXED', value: incrementKg }],
        notes: `${notes} — Fixed increment upon success`,
      },
    },
    {
      id: `${id}-plateau`,
      template_exercise_id: templateExerciseId,
      priority: 2,
      rule_json: {
        conditions: [
          {
            type: 'CONSECUTIVE_FAILED_SESSIONS',
            threshold: plateauThresholdSessions,
          },
        ],
        actions: [{ type: 'RESET_WEIGHT_PERCENT', value: deloadPercent }],
        notes: `${notes} — Deload after ${plateauThresholdSessions} consecutive plateau sessions`,
      },
    },
  ];
}

/**
 * Generates rules for standard Double Progression (DP).
 *
 * Common in hypertrophy programs with rep brackets (e.g. 3 sets of 8-12 reps):
 * - Weight remains fixed while lifter builds reps across sets from 8 to 12.
 * - Once all sets achieve the top of the rep bracket (12 reps):
 *   Increase weight by fixed increment (+2.5 kg) and reset target reps to base (8 reps).
 * - If consecutive failed sessions occur, triggers deload.
 */
export function createDoubleProgressionRule(
  templateExerciseId: string,
  options: DoubleProgressionOptions = {}
): ProgressionRule[] {
  const {
    id = `rule-dp-${templateExerciseId}`,
    incrementKg = 2.5,
    plateauThresholdSessions = 3,
    deloadPercent = 0.10,
    notes = 'Standard Double Progression (DP)',
  } = options;

  return [
    {
      id: `${id}-success`,
      template_exercise_id: templateExerciseId,
      priority: 1,
      rule_json: {
        conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
        actions: [
          { type: 'INCREASE_LOAD_FIXED', value: incrementKg },
          { type: 'RESET_TO_BASELINE', value: 0 },
        ],
        notes: `${notes} — Increase load and reset to base reps when all sets hit top bracket`,
      },
    },
    {
      id: `${id}-plateau`,
      template_exercise_id: templateExerciseId,
      priority: 2,
      rule_json: {
        conditions: [
          {
            type: 'CONSECUTIVE_FAILED_SESSIONS',
            threshold: plateauThresholdSessions,
          },
        ],
        actions: [{ type: 'RESET_WEIGHT_PERCENT', value: deloadPercent }],
        notes: `${notes} — Deload after ${plateauThresholdSessions} consecutive plateau sessions`,
      },
    },
  ];
}

/**
 * Generates rules for Dynamic Double Progression (DDP).
 *
 * Popularized in High Intensity Training (HIT / Dorian Yates / Jordan Peters):
 * - Sets progress independently rather than waiting for all sets to hit top reps together.
 * - If Set 1 hits 12 reps, Set 1 increases weight next workout even if Set 2 only hit 10 reps.
 * - Evaluator produces individual set proposals alongside the composite proposal.
 */
export function createDynamicDoubleProgressionRule(
  templateExerciseId: string,
  options: DynamicDoubleProgressionOptions = {}
): ProgressionRule[] {
  const {
    id = `rule-ddp-${templateExerciseId}`,
    incrementKg = 2.5,
    plateauThresholdSessions = 3,
    deloadPercent = 0.10,
    notes = 'Dynamic Double Progression (DDP)',
  } = options;

  return [
    {
      id: `${id}-success`,
      template_exercise_id: templateExerciseId,
      priority: 1,
      rule_json: {
        conditions: [{ type: 'ANY_SET_HIT_TOP_REP_RANGE' }],
        actions: [{ type: 'INCREASE_LOAD_FIXED', value: incrementKg }],
        notes: `${notes} — Increment individual sets hitting top rep ceiling`,
      },
    },
    {
      id: `${id}-plateau`,
      template_exercise_id: templateExerciseId,
      priority: 2,
      rule_json: {
        conditions: [
          {
            type: 'CONSECUTIVE_FAILED_SESSIONS',
            threshold: plateauThresholdSessions,
          },
        ],
        actions: [{ type: 'RESET_WEIGHT_PERCENT', value: deloadPercent }],
        notes: `${notes} — Deload after ${plateauThresholdSessions} consecutive plateau sessions`,
      },
    },
  ];
}

/**
 * Generates rule scheduling a 0 RIR AMRAP diagnostic set on the final accumulation week of a mesocycle.
 * Implements Pillar 8 (Compounds stay submaximal during accumulation until end-of-meso diagnostic checkpoint).
 */
export function createAmrapFinalWeekRule(
  templateExerciseId: string,
  options: AmrapFinalWeekOptions = {}
): ProgressionRule {
  const {
    id = `rule-amrap-final-${templateExerciseId}`,
    notes = 'Schedule 0 RIR AMRAP on final accumulation week prior to deload',
  } = options;

  return {
    id,
    template_exercise_id: templateExerciseId,
    priority: 3,
    rule_json: {
      conditions: [{ type: 'MESOCYCLE_FINAL_WEEK' }],
      actions: [{ type: 'SCHEDULE_AMRAP_FINAL_WEEK', value: 0 }],
      notes,
    },
  };
}

/**
 * Generates rule scheduling a diagnostic AMRAP set on the midway checkpoint week of a mesocycle (floor(L / 2)).
 * Implements Pillar 3 (Mid-Mesocycle Checkpoints).
 */
export function createAmrapMidwayRule(
  templateExerciseId: string,
  options: AmrapMidwayOptions = {}
): ProgressionRule {
  const {
    id = `rule-amrap-midway-${templateExerciseId}`,
    midwayWeek,
    notes = 'Schedule midway diagnostic AMRAP to calibrate load and RIR accuracy',
  } = options;

  return {
    id,
    template_exercise_id: templateExerciseId,
    priority: 3,
    rule_json: {
      conditions: [
        {
          type: 'MESOCYCLE_MIDWAY_WEEK',
          threshold: midwayWeek,
        },
      ],
      actions: [{ type: 'SCHEDULE_AMRAP_MIDWAY', value: 0 }],
      notes,
    },
  };
}

/**
 * Generates rule evaluating completed AMRAP diagnostic sets using the 1%-over-cap formula with floor rounding.
 * Implements Pillar 4 (The 1%-Over-Cap Progression Formula with Floor Rounding).
 */
export function createAmrapProgressionRule(
  templateExerciseId: string,
  options: AmrapProgressionOptions = {}
): ProgressionRule {
  const {
    id = `rule-amrap-prog-${templateExerciseId}`,
    incrementKg = 2.5,
    notes = 'AMRAP +1%-per-rep-over-cap progression with floor rounding',
  } = options;

  return {
    id,
    template_exercise_id: templateExerciseId,
    priority: 1, // Higher priority than standard LP/DP so AMRAP performance takes precedence
    rule_json: {
      conditions: [{ type: 'AMRAP_COMPLETED' }],
      actions: [{ type: 'INCREASE_LOAD_AMRAP_OVER_CAP', value: incrementKg }],
      notes,
    },
  };
}
