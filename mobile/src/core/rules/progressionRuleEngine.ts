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
} from '../types';
import { roundToStep } from '../math/unitConversion';

// ============================================================================
// Engine Configuration Options
// ============================================================================

export interface ProgressionEngineOptions {
  /**
   * Minimum load increment in kg to round suggested weights to (default: 0.5 kg).
   * In powerlifting or micro-loading, can be set to 0.25, 0.5, 1.25, or 2.5 kg.
   */
  roundingStepKg?: number;
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
  prescription: TemplateExercise
): boolean {
  if (normalizedSessions.length === 0) {
    return false;
  }

  const latestSession = normalizedSessions[normalizedSessions.length - 1];
  const latestWorkingSets = latestSession.workingSets;

  switch (condition.type) {
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

      const recentSlice = normalizedSessions.slice(-requiredCount);
      return recentSlice.every(
        (s) => !isSessionSuccessful(s.workingSets, prescription)
      );
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
  roundingStepKg: number
): ProgressionProposal {
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
    }
  }

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
    isDeload,
    setProposals,
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
      evaluateCondition(cond, normalizedSessions, currentPrescription)
    );

    if (allConditionsPassed) {
      const proposal = synthesizeProposal(
        rule,
        definition,
        latestSession,
        currentPrescription,
        roundingStepKg
      );
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
