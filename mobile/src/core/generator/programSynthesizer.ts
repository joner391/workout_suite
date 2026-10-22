/**
 * Workout Suite — Profile-Driven Program Synthesizer
 *
 * Implements ADR-011: Automated Program Generation from Psychological Profile Matrix
 *
 * Pure, side-effect-free generator mapping athlete profile demographics, training enjoyment,
 * exertion intensity style, primary goal, weekly schedule, and equipment constraints into
 * a complete, ready-to-lift multi-day meso-cycle split.
 *
 * Generates:
 * - Program header entity with tailored color accents
 * - Workout templates (Full Body, Upper/Lower, PPLUL, or PPL)
 * - Template exercise prescriptions (sets, rep brackets, RPE/RIR, superset pairings)
 * - Progression rules (LP, DP, or DDP)
 * - Program summary metadata
 */

import { normalizeTrainingGoals } from '../rules/trainingGoals';
import { isStrengthMain } from '../rules/trainingAdaptation';
import { planProgramVolume, weeklyMuscleEReps, weeklyMiniSetCounts } from './programVolumePlanner';
import {
  UserProfile,
  TrainingMentality,
  Program,
  WorkoutTemplate,
  TemplateExercise,
  ProgressionRule,
  SynthesizedProgram,
  SynthesizedProgramSummary,
  Exercise,
  ExperienceLevel,
  SetType,
  TrainingArchetype,
  PrimaryGoal,
  JointLocation,
  ExercisePreference,
} from '../types';
import {
  createLinearProgressionRule,
  createDoubleProgressionRule,
  createDynamicDoubleProgressionRule,
  createEstimatedCapacityProgressionRule,
} from '../rules/progressionRuleEngine';
import { DEFAULT_EXERCISES } from '../../database/seeds/defaultExercises';
import {
  computeCandidateScore,
  CandidateScoringContext,
  CandidateScoreResult,
  resolveExerciseJoints,
  ActiveJointDiscomfort,
} from './candidateScorer';

export {
  computeCandidateScore,
  CandidateScoringContext,
  CandidateScoreResult,
  resolveExerciseJoints,
  ActiveJointDiscomfort,
};

// ============================================================================
// Generator Options
// ============================================================================

export interface ProgramSynthesizerOptions {
  /**
   * Optional custom exercise catalog. Defaults to `DEFAULT_EXERCISES`.
   */
  availableExercises?: Exercise[];
  /**
   * Optional program ID override.
   */
  programId?: string;
  /**
   * Optional program name override.
   */
  programName?: string;
  /**
   * Optional accent color override (hex format).
   */
  colorHex?: string;
  /**
   * Optional custom program overview notes
   */
  notes?: string;
  /**
   * Optional explicit experience level override ('beginner' | 'intermediate' | 'advanced').
   */
  experienceLevel?: ExperienceLevel;
  /**
   * Optional weekly effective reps target (defaults to 32 eReps MAV).
   */
  targetWeeklyEReps?: number;
  /**
   * Optional user exercise sentiment & affinity preferences.
   */
  preferences?: ExercisePreference[] | Map<string, ExercisePreference>;
  /**
   * Optional active joint discomfort reports (severity >= 3 within 28 days).
   */
  painfulJoints?: ActiveJointDiscomfort[];
  /**
   * Optional direct painful joint shortcut.
   */
  painfulJoint?: JointLocation | string | null;
  painSeverity?: number;
  /**
   * Explicit flag indicating user is in a caloric deficit.
   */
  isCaloricDeficit?: boolean;
  /**
   * Explicit flag indicating user has sensitivity to compressive spinal / axial fatigue.
   */
  hasAxialFatigueSensitivity?: boolean;
}

// ============================================================================
// Internal Split Configuration Interface
// ============================================================================

interface ExerciseSlotConfig {
  preferredId: string;
  fallbackIds: string[];
  muscleGroup: string;
  isPrimaryCompound?: boolean;
  antagonistTag?: 'chest' | 'back' | 'quad' | 'hamstring' | 'bicep' | 'tricep' | 'calves' | 'abs' | 'delts' | 'rear_delts';
  isOptional?: boolean;
}

interface TemplateBlueprint {
  name: string;
  notes: string;
  slots: ExerciseSlotConfig[];
}

// ============================================================================
// Exertion-Based Volume Allocator (eReps Unification Model)
// ============================================================================

/**
 * Computes target working sets per exercise based on target RIR, motor practice status,
 * and weekly muscle frequency to achieve desired weekly effective reps (default: 32 eReps MAV).
 *
 * Implements Pillar 1 & 2 of THEORY_INTEGRATION_AND_MESOCYCLE_ARCHITECTURE.md
 * and Section 7.1 of docs/THEORY_VOLUME_VS_EREPS.md.
 */
export function computeTargetSetsFromExertion(
  targetRir: number,
  weeklyFrequency: number = 2,
  isSkillPractice: boolean = false,
  targetWeeklyEReps: number = 32
): number {
  if (isSkillPractice) {
    // Motor learning practice sets: High technical volume, low fatigue (4 sets of 3-5 reps @ RPE 7.0)
    return 4;
  }

  // 1. Calculate effective reps per set (clamped between 1 and 5)
  const eRepsPerSet = Math.max(1, Math.min(5, Math.round(5 - targetRir)));

  // 2. Compute total weekly sets required
  const totalWeeklySets = Math.round(targetWeeklyEReps / eRepsPerSet);

  // 3. Divide across weekly training frequency
  const setsPerSession = Math.round(totalWeeklySets / Math.max(1, weeklyFrequency));

  // 4. Clamp within safe execution bounds (minimum 1 set, maximum 5 sets per movement)
  return Math.max(1, Math.min(5, setsPerSession));
}

// ============================================================================
// Resistance Training Archetype Continuum (Archetypes I–IV)
// ============================================================================

/**
 * Resolves the continuous training archetype (Archetypes I-IV) based on
 * primary goal, secondary goals, and optional SBD preference ratio (alpha_SBD).
 *
 * Implements Pillar 7 & Resistance Training Archetype Continuum:
 * - Archetype I (Pure Strength): Heavy SBD specialization, linear / emerging strategies
 * - Archetype II (Strength + Hypertrophy): Strength main lifts + bodybuilding accessories
 * - Archetype III (Hypertrophy + Minor Strength): Balanced compounds + DDP accessories
 * - Archetype IV (Pure Hypertrophy): High SFR cables/machines, zero compulsory SBD, DDP
 */
export function resolveArchetype(
  primaryGoal: PrimaryGoal,
  secondaryGoals: string[] = [],
  alphaSbd?: number
): TrainingArchetype {
  // If alphaSbd is explicitly specified:
  if (alphaSbd !== undefined) {
    if (alphaSbd >= 0.70) return 'archetype_i_pure_strength';
    if (alphaSbd >= 0.40) return 'archetype_ii_strength_hypertrophy';
    if (alphaSbd >= 0.20) return 'archetype_iii_hypertrophy_strength';
    return 'archetype_iv_pure_hypertrophy';
  }

  // Otherwise infer from primaryGoal and secondaryGoals:
  if (primaryGoal === 'strength') {
    if (secondaryGoals.includes('hypertrophy')) {
      return 'archetype_ii_strength_hypertrophy';
    }
    return 'archetype_i_pure_strength';
  }

  if (primaryGoal === 'hypertrophy') {
    if (secondaryGoals.includes('strength')) {
      return 'archetype_iii_hypertrophy_strength';
    }
    return 'archetype_iv_pure_hypertrophy';
  }

  // Fallbacks for endurance / longevity:
  if (secondaryGoals.includes('strength')) {
    return 'archetype_iii_hypertrophy_strength';
  }
  return 'archetype_iv_pure_hypertrophy';
}

// ============================================================================
// Equipment Resolution Mappings
// ============================================================================

const SBD_EXERCISE_IDS = new Set([
  'barbell_back_squat',
  'barbell_bench_press',
  'barbell_deadlift',
  'barbell_sumo_deadlift',
]);

/**
 * Resolves the optimal exercise ID based on user equipment access, candidate score,
 * sentiment affinity, joint-ROM protection, axial load, and regional muscle bias balancing.
 */
function resolveExerciseId(
  slot: ExerciseSlotConfig,
  equipment: UserProfile['equipment_access'],
  catalogMap: Map<string, Exercise>,
  preferHighSFRNonSBD: boolean = false,
  scoringContext?: CandidateScoringContext,
  preferenceMap?: Map<string, ExercisePreference>,
  coveredSubTargetsByMuscle?: Map<string, Set<string>>
): string {
  const isEligible = (ex: Exercise): boolean => {
    switch (equipment) {
      case 'garage_gym':
        return ex.category === 'Barbell' || ex.category === 'Dumbbell' || ex.is_bodyweight;
      case 'dumbbells_only':
        return ex.category === 'Dumbbell' || ex.is_bodyweight;
      case 'bodyweight_only':
        return ex.is_bodyweight;
      case 'commercial_gym':
      default:
        return true;
    }
  };
  const matchesTarget = (ex: Exercise): boolean =>
    ['barbell_deadlift', 'barbell_sumo_deadlift'].includes(slot.preferredId)
      ? ex.standard_lift_type === 'deadlift' || ['Hamstrings', 'Glutes'].includes(ex.muscle_group)
      : ex.muscle_group.toLowerCase() === slot.muscleGroup.toLowerCase() ||
        (slot.muscleGroup === 'Biceps' && /hammer curl/i.test(ex.name));

  // First, evaluate candidates explicitly specified in the slot (preferredId and fallbackIds)
  const slotCandidateIds = [slot.preferredId, ...slot.fallbackIds];
  const slotCandidates: Exercise[] = [];
  const seenIds = new Set<string>();

  for (const candId of slotCandidateIds) {
    const ex = catalogMap.get(candId);
    if (ex && isEligible(ex) && matchesTarget(ex) && !seenIds.has(ex.id)) {
      seenIds.add(ex.id);
      slotCandidates.push(ex);
    }
  }

  // If no slot candidates were eligible, expand to all catalog exercises for this muscle group
  let candidatePool = slotCandidates;
  if (candidatePool.length === 0 || scoringContext?.hasAxialFatigueSensitivity || scoringContext?.isCaloricDeficit) {
    for (const ex of catalogMap.values()) {
      if (
        isEligible(ex) &&
        !seenIds.has(ex.id) &&
        matchesTarget(ex)
      ) {
        seenIds.add(ex.id);
        candidatePool.push(ex);
      }
    }
  }

  // Score each candidate exercise using Step 9.3 Candidate Scoring Function
  const scoredCandidates: Array<{ ex: Exercise; rankScore: number }> = [];

  for (const ex of candidatePool) {
    const pref = preferenceMap?.get(ex.id) || null;
    if (pref?.sentiment === 'disliked' || pref?.sentiment === 'blacklisted') continue;
    const candidateCtx: CandidateScoringContext = {
      ...(scoringContext || {}),
      preference: pref,
    };

    const result = computeCandidateScore(ex, candidateCtx);

    // Hard blacklist exclusion (Step 9.3 Deliverable 1)
    if (result.isExcluded) {
      continue;
    }

    let rankScore = result.score;

    // Blueprint structural priority: preferredId receives +35 baseline bonus
    // This anchors Tier 1 compounds (e.g. Deadlift SFR 55, Squat SFR 75) against
    // high-SFR isolation/machine fallbacks (SFR 85-95) unless penalized or user prefers otherwise.
    if (ex.id === slot.preferredId) {
      rankScore += 35;
    } else if (slot.fallbackIds.includes(ex.id)) {
      rankScore += 0;
    }

    // Pure Hypertrophy (Pillar 7 / alpha_SBD <= 0.2): Prioritize high-SFR non-SBD
    if (preferHighSFRNonSBD && slot.isPrimaryCompound && SBD_EXERCISE_IDS.has(slot.preferredId)) {
      if (!SBD_EXERCISE_IDS.has(ex.id) && (ex.category === 'Machine' || ex.category === 'Cable')) {
        rankScore += 50;
      } else if (!SBD_EXERCISE_IDS.has(ex.id)) {
        rankScore += 25;
      } else {
        rankScore -= 50;
      }
    }

    // Regional Muscle Bias Balancer (Step 9.3 Deliverable 3)
    // In multi-session splits, elevate complementary regional sub-targets
    if (coveredSubTargetsByMuscle && ex.muscle_biases && ex.muscle_biases.length > 0) {
      const mgKey = slot.muscleGroup.toLowerCase();
      const covered = coveredSubTargetsByMuscle.get(mgKey);
      if (covered && covered.size > 0) {
        const introducesUncoveredSubTarget = ex.muscle_biases.some((bias) => !covered.has(bias));
        if (introducesUncoveredSubTarget) {
          rankScore += 15;
        }
      }
    }

    scoredCandidates.push({ ex, rankScore });
  }

  // Sort candidates by rankScore DESC, then name ASC
  scoredCandidates.sort((a, b) => {
    if (b.rankScore !== a.rankScore) {
      return b.rankScore - a.rankScore;
    }
    return a.ex.name.localeCompare(b.ex.name);
  });

  if (scoredCandidates.length > 0) {
    const chosen = scoredCandidates[0].ex;
    // Track covered sub-targets for regional muscle bias balancing
    if (coveredSubTargetsByMuscle && chosen.muscle_biases) {
      const mgKey = slot.muscleGroup.toLowerCase();
      if (!coveredSubTargetsByMuscle.has(mgKey)) {
        coveredSubTargetsByMuscle.set(mgKey, new Set<string>());
      }
      const set = coveredSubTargetsByMuscle.get(mgKey)!;
      chosen.muscle_biases.forEach((b) => set.add(b));
    }
    return chosen.id;
  }

  // Fallback: If all candidates were excluded, try any eligible non-blacklisted exercise in the catalog
  for (const ex of catalogMap.values()) {
    if (isEligible(ex) && matchesTarget(ex)) {
      const pref = preferenceMap?.get(ex.id);
      if (pref?.sentiment !== 'blacklisted' && pref?.sentiment !== 'disliked' && (pref?.affinity_score ?? 0) > -900 &&
        !computeCandidateScore(ex, { ...scoringContext, preference: pref }).isExcluded) {
        return ex.id;
      }
    }
  }

  return ''; // Missing coverage is reported explicitly by the weekly planner.
}

// ============================================================================
// Blueprint Definitions by Split
// ============================================================================

function getFullBodyBlueprints(days: number): TemplateBlueprint[] {
  const day1: TemplateBlueprint = {
    name: 'Full Body A — Squat & Horizontal Focus',
    notes: 'Heavy quad & horizontal pressing focus with antagonist accessory work.',
    slots: [
      {
        preferredId: 'barbell_back_squat',
        fallbackIds: ['machine_leg_press', 'barbell_front_squat', 'dumbbell_bulgarian_split_squat'],
        muscleGroup: 'Quads',
        isPrimaryCompound: true,
      },
      {
        preferredId: 'barbell_bench_press',
        fallbackIds: ['dumbbell_bench_press', 'machine_chest_press', 'bodyweight_push_up'],
        muscleGroup: 'Chest',
        isPrimaryCompound: true,
        antagonistTag: 'chest',
      },
      {
        preferredId: 'barbell_bent_over_row',
        fallbackIds: ['cable_seated_row', 'dumbbell_single_arm_row', 'bodyweight_pull_up'],
        muscleGroup: 'Back',
        isPrimaryCompound: true,
        antagonistTag: 'back',
      },
      {
        preferredId: 'machine_leg_curl',
        fallbackIds: ['barbell_rdl', 'dumbbell_walking_lunge'],
        muscleGroup: 'Hamstrings',
        antagonistTag: 'hamstring',
      },
      {
        preferredId: 'cable_lateral_raise',
        fallbackIds: ['dumbbell_lateral_raise'],
        muscleGroup: 'Shoulders',
      },
      {
        preferredId: 'bodyweight_hanging_knee_raise',
        fallbackIds: ['bodyweight_push_up'],
        muscleGroup: 'Abs',
        antagonistTag: 'abs',
      },
    ],
  };

  const day2: TemplateBlueprint = {
    name: 'Full Body B — Hinge & Vertical Focus',
    notes: 'Posterior chain deadlift and overhead pressing foundation.',
    slots: [
      {
        preferredId: 'barbell_deadlift',
        fallbackIds: ['barbell_rdl', 'machine_leg_press', 'dumbbell_walking_lunge'],
        muscleGroup: 'Back',
        isPrimaryCompound: true,
      },
      {
        preferredId: 'barbell_overhead_press',
        fallbackIds: ['dumbbell_shoulder_press', 'dumbbell_incline_bench_press', 'bodyweight_dip'],
        muscleGroup: 'Shoulders',
        isPrimaryCompound: true,
        antagonistTag: 'chest',
      },
      {
        preferredId: 'cable_lat_pulldown',
        fallbackIds: ['bodyweight_pull_up', 'bodyweight_chin_up', 'dumbbell_single_arm_row'],
        muscleGroup: 'Back',
        isPrimaryCompound: true,
        antagonistTag: 'back',
      },
      {
        preferredId: 'machine_leg_extension',
        fallbackIds: ['dumbbell_bulgarian_split_squat', 'barbell_front_squat'],
        muscleGroup: 'Quads',
        antagonistTag: 'quad',
      },
      {
        preferredId: 'dumbbell_bicep_curl',
        fallbackIds: ['cable_bicep_curl', 'barbell_bicep_curl'],
        muscleGroup: 'Biceps',
        antagonistTag: 'bicep',
      },
      {
        preferredId: 'cable_tricep_pushdown',
        fallbackIds: ['barbell_skull_crusher', 'bodyweight_dip'],
        muscleGroup: 'Triceps',
        antagonistTag: 'tricep',
      },
    ],
  };

  const day3: TemplateBlueprint = {
    name: 'Full Body C — Hypertrophy & Symmetry',
    notes: 'Accessory volume accumulation across major muscle groups.',
    slots: [
      {
        preferredId: 'machine_leg_press',
        fallbackIds: ['barbell_front_squat', 'barbell_box_squat', 'dumbbell_bulgarian_split_squat'],
        muscleGroup: 'Quads',
        isPrimaryCompound: true,
      },
      {
        preferredId: 'dumbbell_incline_bench_press',
        fallbackIds: ['barbell_incline_bench_press', 'dumbbell_bench_press', 'bodyweight_push_up'],
        muscleGroup: 'Chest',
        antagonistTag: 'chest',
      },
      {
        preferredId: 'cable_seated_row',
        fallbackIds: ['dumbbell_single_arm_row', 'barbell_bent_over_row', 'bodyweight_pull_up'],
        muscleGroup: 'Back',
        antagonistTag: 'back',
      },
      {
        preferredId: 'machine_leg_curl',
        fallbackIds: ['barbell_rdl', 'dumbbell_walking_lunge'],
        muscleGroup: 'Hamstrings',
        antagonistTag: 'hamstring',
      },
      {
        preferredId: 'cable_face_pull',
        fallbackIds: ['dumbbell_rear_delt_fly', 'dumbbell_lateral_raise'],
        muscleGroup: 'Shoulders',
      },
      {
        preferredId: 'machine_standing_calf_raise',
        fallbackIds: ['dumbbell_walking_lunge', 'bodyweight_hanging_knee_raise'],
        muscleGroup: 'Calves',
        antagonistTag: 'calves',
      },
    ],
  };

  if (days <= 1) return [day1];
  if (days === 2) return [day1, day2];
  return [day1, day2, day3];
}

function getUpperLowerBlueprints(): TemplateBlueprint[] {
  return [
    {
      name: 'Upper A — Strength Bench & Row',
      notes: 'Heavy horizontal pressing and rowing foundation with arm supersets.',
      slots: [
        {
          preferredId: 'barbell_bench_press',
          fallbackIds: ['dumbbell_bench_press', 'machine_chest_press'],
          muscleGroup: 'Chest',
          isPrimaryCompound: true,
          antagonistTag: 'chest',
        },
        {
          preferredId: 'barbell_bent_over_row',
          fallbackIds: ['cable_seated_row', 'dumbbell_single_arm_row'],
          muscleGroup: 'Back',
          isPrimaryCompound: true,
          antagonistTag: 'back',
        },
        {
          preferredId: 'barbell_overhead_press',
          fallbackIds: ['dumbbell_shoulder_press', 'dumbbell_incline_bench_press'],
          muscleGroup: 'Shoulders',
          antagonistTag: 'chest',
        },
        {
          preferredId: 'cable_lat_pulldown',
          fallbackIds: ['bodyweight_pull_up', 'bodyweight_chin_up'],
          muscleGroup: 'Back',
          antagonistTag: 'back',
        },
        {
          preferredId: 'cable_lateral_raise',
          fallbackIds: ['dumbbell_lateral_raise'],
          muscleGroup: 'Shoulders',
        },
        {
          preferredId: 'dumbbell_bicep_curl',
          fallbackIds: ['cable_bicep_curl', 'barbell_bicep_curl'],
          muscleGroup: 'Biceps',
          antagonistTag: 'bicep',
          isOptional: true,
        },
        {
          preferredId: 'cable_tricep_pushdown',
          fallbackIds: ['barbell_skull_crusher', 'bodyweight_dip'],
          muscleGroup: 'Triceps',
          antagonistTag: 'tricep',
          isOptional: true,
        },
      ],
    },
    {
      name: 'Lower A — Squat & Quad Focus',
      notes: 'Heavy back squat with posterior chain assistance and core.',
      slots: [
        {
          preferredId: 'barbell_back_squat',
          fallbackIds: ['machine_leg_press', 'barbell_front_squat', 'dumbbell_bulgarian_split_squat'],
          muscleGroup: 'Quads',
          isPrimaryCompound: true,
        },
        {
          preferredId: 'barbell_rdl',
          fallbackIds: ['machine_leg_curl', 'dumbbell_walking_lunge'],
          muscleGroup: 'Hamstrings',
          isPrimaryCompound: true,
        },
        {
          preferredId: 'machine_leg_extension',
          fallbackIds: ['dumbbell_bulgarian_split_squat', 'dumbbell_walking_lunge'],
          muscleGroup: 'Quads',
          antagonistTag: 'quad',
        },
        {
          preferredId: 'machine_leg_curl',
          fallbackIds: ['barbell_rdl'],
          muscleGroup: 'Hamstrings',
          antagonistTag: 'hamstring',
        },
        {
          preferredId: 'machine_standing_calf_raise',
          fallbackIds: ['dumbbell_walking_lunge'],
          muscleGroup: 'Calves',
          antagonistTag: 'calves',
        },
        {
          preferredId: 'bodyweight_hanging_knee_raise',
          fallbackIds: ['bodyweight_push_up'],
          muscleGroup: 'Abs',
          antagonistTag: 'abs',
        },
      ],
    },
    {
      name: 'Upper B — Hypertrophy Incline & Chins',
      notes: 'Incline pressing, vertical pulling, and isolation volume accumulation.',
      slots: [
        {
          preferredId: 'barbell_incline_bench_press',
          fallbackIds: ['dumbbell_incline_bench_press', 'barbell_bench_press'],
          muscleGroup: 'Chest',
          isPrimaryCompound: true,
          antagonistTag: 'chest',
        },
        {
          preferredId: 'bodyweight_pull_up',
          fallbackIds: ['cable_lat_pulldown', 'bodyweight_chin_up'],
          muscleGroup: 'Back',
          isPrimaryCompound: true,
          antagonistTag: 'back',
        },
        {
          preferredId: 'dumbbell_bench_press',
          fallbackIds: ['machine_chest_press', 'cable_chest_fly'],
          muscleGroup: 'Chest',
          antagonistTag: 'chest',
        },
        {
          preferredId: 'cable_seated_row',
          fallbackIds: ['dumbbell_single_arm_row', 'barbell_pendlay_row'],
          muscleGroup: 'Back',
          antagonistTag: 'back',
        },
        {
          preferredId: 'dumbbell_rear_delt_fly',
          fallbackIds: ['cable_face_pull'],
          muscleGroup: 'Shoulders',
        },
        {
          preferredId: 'dumbbell_hammer_curl',
          fallbackIds: ['cable_bicep_curl', 'dumbbell_bicep_curl'],
          muscleGroup: 'Biceps',
          antagonistTag: 'bicep',
          isOptional: true,
        },
        {
          preferredId: 'barbell_skull_crusher',
          fallbackIds: ['cable_tricep_pushdown', 'bodyweight_dip'],
          muscleGroup: 'Triceps',
          antagonistTag: 'tricep',
          isOptional: true,
        },
      ],
    },
    {
      name: 'Lower B — Deadlift & Posterior Chain',
      notes: 'Deadlift strength progression, front squat / machine volume, and calves.',
      slots: [
        {
          preferredId: 'barbell_deadlift',
          fallbackIds: ['barbell_sumo_deadlift', 'barbell_rdl'],
          muscleGroup: 'Back',
          isPrimaryCompound: true,
        },
        {
          preferredId: 'machine_leg_press',
          fallbackIds: ['barbell_front_squat', 'barbell_back_squat'],
          muscleGroup: 'Quads',
          isPrimaryCompound: true,
        },
        {
          preferredId: 'dumbbell_bulgarian_split_squat',
          fallbackIds: ['dumbbell_walking_lunge', 'machine_leg_extension'],
          muscleGroup: 'Quads',
          antagonistTag: 'quad',
        },
        {
          preferredId: 'machine_leg_curl',
          fallbackIds: ['barbell_rdl'],
          muscleGroup: 'Hamstrings',
          antagonistTag: 'hamstring',
        },
        {
          preferredId: 'machine_standing_calf_raise',
          fallbackIds: ['dumbbell_walking_lunge'],
          muscleGroup: 'Calves',
          antagonistTag: 'calves',
        },
        {
          preferredId: 'bodyweight_hanging_knee_raise',
          fallbackIds: ['bodyweight_push_up'],
          muscleGroup: 'Abs',
          antagonistTag: 'abs',
        },
      ],
    },
  ];
}

function getPPLULBlueprints(): TemplateBlueprint[] {
  return [
    {
      name: 'Day 1 — Push (Chest, Delts, Triceps)',
      notes: 'Primary push session focusing on horizontal and vertical pressing.',
      slots: [
        { preferredId: 'barbell_bench_press', fallbackIds: ['dumbbell_bench_press'], muscleGroup: 'Chest', isPrimaryCompound: true },
        { preferredId: 'barbell_incline_bench_press', fallbackIds: ['dumbbell_incline_bench_press'], muscleGroup: 'Chest' },
        { preferredId: 'barbell_overhead_press', fallbackIds: ['dumbbell_shoulder_press'], muscleGroup: 'Shoulders' },
        { preferredId: 'cable_lateral_raise', fallbackIds: ['dumbbell_lateral_raise'], muscleGroup: 'Shoulders' },
        { preferredId: 'cable_tricep_pushdown', fallbackIds: ['barbell_skull_crusher'], muscleGroup: 'Triceps' },
      ],
    },
    {
      name: 'Day 2 — Pull (Back, Rear Delts, Biceps)',
      notes: 'Heavy deadlift and vertical/horizontal pulling volume.',
      slots: [
        { preferredId: 'barbell_deadlift', fallbackIds: ['barbell_bent_over_row'], muscleGroup: 'Back', isPrimaryCompound: true },
        { preferredId: 'cable_lat_pulldown', fallbackIds: ['bodyweight_pull_up'], muscleGroup: 'Back', isPrimaryCompound: true },
        { preferredId: 'cable_seated_row', fallbackIds: ['dumbbell_single_arm_row'], muscleGroup: 'Back' },
        { preferredId: 'cable_face_pull', fallbackIds: ['dumbbell_rear_delt_fly'], muscleGroup: 'Shoulders' },
        { preferredId: 'dumbbell_bicep_curl', fallbackIds: ['cable_bicep_curl'], muscleGroup: 'Biceps' },
      ],
    },
    {
      name: 'Day 3 — Legs (Quads, Hamstrings, Calves)',
      notes: 'Heavy back squat foundation and leg hypertrophy.',
      slots: [
        { preferredId: 'barbell_back_squat', fallbackIds: ['machine_leg_press'], muscleGroup: 'Quads', isPrimaryCompound: true },
        { preferredId: 'barbell_rdl', fallbackIds: ['machine_leg_curl'], muscleGroup: 'Hamstrings', isPrimaryCompound: true },
        { preferredId: 'machine_leg_extension', fallbackIds: ['dumbbell_bulgarian_split_squat'], muscleGroup: 'Quads', antagonistTag: 'quad' },
        { preferredId: 'machine_leg_curl', fallbackIds: ['barbell_rdl'], muscleGroup: 'Hamstrings', antagonistTag: 'hamstring' },
        { preferredId: 'machine_standing_calf_raise', fallbackIds: ['dumbbell_walking_lunge'], muscleGroup: 'Calves' },
      ],
    },
    {
      name: 'Day 4 — Upper (Hypertrophy & Pump)',
      notes: 'Antagonist upper body density and accessory focus.',
      slots: [
        { preferredId: 'dumbbell_incline_bench_press', fallbackIds: ['barbell_incline_bench_press'], muscleGroup: 'Chest', isPrimaryCompound: true, antagonistTag: 'chest' },
        { preferredId: 'barbell_bent_over_row', fallbackIds: ['cable_seated_row'], muscleGroup: 'Back', isPrimaryCompound: true, antagonistTag: 'back' },
        { preferredId: 'dumbbell_shoulder_press', fallbackIds: ['barbell_overhead_press'], muscleGroup: 'Shoulders', antagonistTag: 'chest' },
        { preferredId: 'bodyweight_pull_up', fallbackIds: ['cable_lat_pulldown'], muscleGroup: 'Back', antagonistTag: 'back' },
        { preferredId: 'cable_bicep_curl', fallbackIds: ['dumbbell_bicep_curl'], muscleGroup: 'Biceps', antagonistTag: 'bicep' },
        { preferredId: 'cable_tricep_pushdown', fallbackIds: ['barbell_skull_crusher'], muscleGroup: 'Triceps', antagonistTag: 'tricep' },
      ],
    },
    {
      name: 'Day 5 — Lower (Machine & Unilateral Focus)',
      notes: 'Leg press, split squats, posterior chain, and core.',
      slots: [
        { preferredId: 'machine_leg_press', fallbackIds: ['barbell_front_squat'], muscleGroup: 'Quads', isPrimaryCompound: true },
        { preferredId: 'dumbbell_bulgarian_split_squat', fallbackIds: ['dumbbell_walking_lunge'], muscleGroup: 'Quads', antagonistTag: 'quad' },
        { preferredId: 'machine_leg_curl', fallbackIds: ['barbell_rdl'], muscleGroup: 'Hamstrings', antagonistTag: 'hamstring' },
        { preferredId: 'machine_standing_calf_raise', fallbackIds: ['dumbbell_walking_lunge'], muscleGroup: 'Calves', antagonistTag: 'calves' },
        { preferredId: 'bodyweight_hanging_knee_raise', fallbackIds: ['bodyweight_push_up'], muscleGroup: 'Abs', antagonistTag: 'abs' },
      ],
    },
  ];
}

function getPPLBlueprints(): TemplateBlueprint[] {
  return [
    {
      name: 'Push A — Upper Chest & Long Head Focus',
      notes: 'Incline pressing foundation and long-head tricep focus.',
      slots: [
        { preferredId: 'barbell_incline_bench_press', fallbackIds: ['dumbbell_incline_bench_press', 'barbell_bench_press'], muscleGroup: 'Chest', isPrimaryCompound: true },
        { preferredId: 'barbell_overhead_press', fallbackIds: ['dumbbell_shoulder_press'], muscleGroup: 'Shoulders' },
        { preferredId: 'dumbbell_bench_press', fallbackIds: ['machine_chest_press'], muscleGroup: 'Chest' },
        { preferredId: 'cable_lateral_raise', fallbackIds: ['dumbbell_lateral_raise'], muscleGroup: 'Shoulders' },
        { preferredId: 'barbell_skull_crusher', fallbackIds: ['cable_tricep_pushdown'], muscleGroup: 'Triceps' },
      ],
    },
    {
      name: 'Pull A — Deadlift & Rows',
      notes: 'Heavy deadlift and back density.',
      slots: [
        { preferredId: 'barbell_deadlift', fallbackIds: ['barbell_bent_over_row'], muscleGroup: 'Back', isPrimaryCompound: true },
        { preferredId: 'cable_lat_pulldown', fallbackIds: ['bodyweight_pull_up'], muscleGroup: 'Back', isPrimaryCompound: true },
        { preferredId: 'cable_seated_row', fallbackIds: ['dumbbell_single_arm_row'], muscleGroup: 'Back' },
        { preferredId: 'cable_face_pull', fallbackIds: ['dumbbell_rear_delt_fly'], muscleGroup: 'Shoulders' },
        { preferredId: 'dumbbell_bicep_curl', fallbackIds: ['cable_bicep_curl'], muscleGroup: 'Biceps' },
      ],
    },
    {
      name: 'Legs A — Squat Focus',
      notes: 'Back squat foundation and quad hypertrophy.',
      slots: [
        { preferredId: 'barbell_back_squat', fallbackIds: ['machine_leg_press'], muscleGroup: 'Quads', isPrimaryCompound: true },
        { preferredId: 'barbell_rdl', fallbackIds: ['machine_leg_curl'], muscleGroup: 'Hamstrings', isPrimaryCompound: true },
        { preferredId: 'machine_leg_extension', fallbackIds: ['dumbbell_bulgarian_split_squat'], muscleGroup: 'Quads' },
        { preferredId: 'machine_standing_calf_raise', fallbackIds: ['dumbbell_walking_lunge'], muscleGroup: 'Calves' },
        { preferredId: 'bodyweight_hanging_knee_raise', fallbackIds: ['bodyweight_push_up'], muscleGroup: 'Abs' },
      ],
    },
    {
      name: 'Push B — Mid Chest & Lateral Head Focus',
      notes: 'Heavy flat bench foundation and lateral-head tricep lockout.',
      slots: [
        { preferredId: 'barbell_bench_press', fallbackIds: ['dumbbell_bench_press'], muscleGroup: 'Chest', isPrimaryCompound: true },
        { preferredId: 'dumbbell_shoulder_press', fallbackIds: ['barbell_overhead_press'], muscleGroup: 'Shoulders' },
        { preferredId: 'dumbbell_incline_bench_press', fallbackIds: ['machine_chest_press'], muscleGroup: 'Chest' },
        { preferredId: 'dumbbell_lateral_raise', fallbackIds: ['cable_lateral_raise'], muscleGroup: 'Shoulders' },
        { preferredId: 'cable_tricep_pushdown', fallbackIds: ['barbell_skull_crusher'], muscleGroup: 'Triceps' },
      ],
    },
    {
      name: 'Pull B — Chins & Upper Back',
      notes: 'Pull-up vertical pulling and rowing volume.',
      slots: [
        { preferredId: 'bodyweight_pull_up', fallbackIds: ['cable_lat_pulldown'], muscleGroup: 'Back', isPrimaryCompound: true },
        { preferredId: 'barbell_bent_over_row', fallbackIds: ['cable_seated_row'], muscleGroup: 'Back', isPrimaryCompound: true },
        { preferredId: 'dumbbell_single_arm_row', fallbackIds: ['cable_seated_row'], muscleGroup: 'Back' },
        { preferredId: 'dumbbell_rear_delt_fly', fallbackIds: ['cable_face_pull'], muscleGroup: 'Shoulders' },
        { preferredId: 'dumbbell_hammer_curl', fallbackIds: ['cable_bicep_curl'], muscleGroup: 'Biceps' },
      ],
    },
    {
      name: 'Legs B — Machine & Hinge Focus',
      notes: 'Leg press, hamstring curls, split squats, and core.',
      slots: [
        { preferredId: 'machine_leg_press', fallbackIds: ['barbell_front_squat'], muscleGroup: 'Quads', isPrimaryCompound: true },
        { preferredId: 'machine_leg_curl', fallbackIds: ['barbell_rdl'], muscleGroup: 'Hamstrings', isPrimaryCompound: true },
        { preferredId: 'dumbbell_bulgarian_split_squat', fallbackIds: ['dumbbell_walking_lunge'], muscleGroup: 'Quads' },
        { preferredId: 'machine_standing_calf_raise', fallbackIds: ['dumbbell_walking_lunge'], muscleGroup: 'Calves' },
        { preferredId: 'bodyweight_hanging_knee_raise', fallbackIds: ['bodyweight_push_up'], muscleGroup: 'Abs' },
      ],
    },
  ];
}

function get15MinBlueprints(days: number): TemplateBlueprint[] {
  const day1: TemplateBlueprint = {
    name: 'Day 1 — Upper Antagonist 15-Min Express',
    notes: '2 Antagonist superset pairs: Incline DB Press + Seated Row (Pair 1), then Lateral Raise + Face Pull (Pair 2). 0s rest in pair, 90s between rounds.',
    slots: [
      {
        preferredId: 'dumbbell_incline_bench_press',
        fallbackIds: ['barbell_bench_press', 'machine_chest_press', 'dumbbell_bench_press'],
        muscleGroup: 'Chest',
        isPrimaryCompound: true,
        antagonistTag: 'chest',
      },
      {
        preferredId: 'cable_seated_row',
        fallbackIds: ['barbell_bent_over_row', 'dumbbell_single_arm_row', 'bodyweight_pull_up'],
        muscleGroup: 'Back',
        isPrimaryCompound: true,
        antagonistTag: 'back',
      },
      {
        preferredId: 'cable_lateral_raise',
        fallbackIds: ['dumbbell_lateral_raise'],
        muscleGroup: 'Shoulders',
        antagonistTag: 'delts',
      },
      {
        preferredId: 'cable_face_pull',
        fallbackIds: ['dumbbell_rear_delt_fly'],
        muscleGroup: 'Shoulders',
        antagonistTag: 'rear_delts',
      },
    ],
  };

  const day2: TemplateBlueprint = {
    name: 'Day 2 — Lower & Arms 15-Min Express',
    notes: '2 Antagonist superset pairs: Back Squat + RDL (Pair 1), then Bicep Curl + Tricep Pushdown (Pair 2). 0s rest in pair, 90s between rounds.',
    slots: [
      {
        preferredId: 'barbell_back_squat',
        fallbackIds: ['machine_leg_press', 'barbell_front_squat', 'dumbbell_walking_lunge'],
        muscleGroup: 'Quads',
        isPrimaryCompound: true,
        antagonistTag: 'quad',
      },
      {
        preferredId: 'barbell_rdl',
        fallbackIds: ['machine_leg_curl'],
        muscleGroup: 'Hamstrings',
        isPrimaryCompound: true,
        antagonistTag: 'hamstring',
      },
      {
        preferredId: 'dumbbell_bicep_curl',
        fallbackIds: ['cable_bicep_curl'],
        muscleGroup: 'Biceps',
        antagonistTag: 'bicep',
      },
      {
        preferredId: 'cable_tricep_pushdown',
        fallbackIds: ['barbell_skull_crusher', 'bodyweight_dip'],
        muscleGroup: 'Triceps',
        antagonistTag: 'tricep',
      },
    ],
  };

  const day3: TemplateBlueprint = {
    name: 'Day 3 — Upper Body Dips & Chins 15-Min Express',
    notes: '2 Antagonist superset pairs: Dips + Pull-ups (Pair 1), then Hammer Curl + Skull Crusher (Pair 2). 0s rest in pair, 90s between rounds.',
    slots: [
      {
        preferredId: 'bodyweight_dip',
        fallbackIds: ['barbell_bench_press', 'dumbbell_bench_press'],
        muscleGroup: 'Chest',
        isPrimaryCompound: true,
        antagonistTag: 'chest',
      },
      {
        preferredId: 'bodyweight_pull_up',
        fallbackIds: ['cable_lat_pulldown', 'cable_seated_row'],
        muscleGroup: 'Back',
        isPrimaryCompound: true,
        antagonistTag: 'back',
      },
      {
        preferredId: 'dumbbell_hammer_curl',
        fallbackIds: ['dumbbell_bicep_curl'],
        muscleGroup: 'Biceps',
        antagonistTag: 'bicep',
      },
      {
        preferredId: 'barbell_skull_crusher',
        fallbackIds: ['cable_tricep_pushdown', 'bodyweight_dip'],
        muscleGroup: 'Triceps',
        antagonistTag: 'tricep',
      },
    ],
  };

  const day4: TemplateBlueprint = {
    name: 'Day 4 — Lower & Shoulders 15-Min Express',
    notes: '2 Antagonist superset pairs: Leg Press + Leg Curl (Pair 1), then Lateral Raise + Face Pull (Pair 2). 0s rest in pair, 90s between rounds.',
    slots: [
      {
        preferredId: 'machine_leg_press',
        fallbackIds: ['barbell_back_squat', 'barbell_front_squat'],
        muscleGroup: 'Quads',
        isPrimaryCompound: true,
        antagonistTag: 'quad',
      },
      {
        preferredId: 'machine_leg_curl',
        fallbackIds: ['barbell_rdl'],
        muscleGroup: 'Hamstrings',
        isPrimaryCompound: true,
        antagonistTag: 'hamstring',
      },
      {
        preferredId: 'cable_lateral_raise',
        fallbackIds: ['dumbbell_lateral_raise'],
        muscleGroup: 'Shoulders',
        antagonistTag: 'delts',
      },
      {
        preferredId: 'cable_face_pull',
        fallbackIds: ['dumbbell_rear_delt_fly'],
        muscleGroup: 'Shoulders',
        antagonistTag: 'rear_delts',
      },
    ],
  };

  const pool = [day1, day2, day3, day4];
  const count = Math.min(days, 6);
  const result: TemplateBlueprint[] = [];
  for (let i = 0; i < count; i++) {
    result.push(pool[i % pool.length]);
  }
  return result;
}

// ============================================================================
// Main Program Synthesizer Function
// ============================================================================

/**
 * Pure generator translating a UserProfile into a complete training program split
 * with templates, prescribed set/rep/RPE parameters, antagonist supersets, and progression rules.
 */
export function synthesizeProgram(
  profile: UserProfile,
  options: ProgramSynthesizerOptions = {}
): SynthesizedProgram {
  profile = { ...profile, ...normalizeTrainingGoals(profile.primary_goal, profile.secondary_goals) };
  const {
    availableExercises = DEFAULT_EXERCISES,
    programId = `prog-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
  } = options;

  // Catalog fast lookup map
  const catalogMap = new Map<string, Exercise>();
  for (const ex of availableExercises) {
    catalogMap.set(ex.id, ex);
  }

  // 1. Determine split type based on weekly frequency and duration
  const daysPerWeek = Math.max(1, Math.min(7, Math.round(profile.preferred_days_per_week || 4)));
  const is15MinRoutine = profile.preferred_session_duration_mins === 15;
  let splitType: 'full_body' | 'upper_lower' | 'pplul' | 'ppl';
  let blueprints: TemplateBlueprint[];

  if (is15MinRoutine) {
    splitType = 'upper_lower';
    blueprints = get15MinBlueprints(daysPerWeek);
  } else if (daysPerWeek <= 3) {
    splitType = 'full_body';
    blueprints = getFullBodyBlueprints(daysPerWeek);
  } else if (daysPerWeek === 4) {
    splitType = 'upper_lower';
    blueprints = getUpperLowerBlueprints();
  } else if (daysPerWeek === 5) {
    splitType = 'pplul';
    blueprints = getPPLULBlueprints();
  } else {
    splitType = 'ppl';
    blueprints = getPPLBlueprints();
  }

  // 2. Program Name & Color Accent
  let defaultName = 'datSet Custom Training Plan';
  let defaultColor = '#3B82F6';

  switch (profile.primary_goal) {
    case 'strength':
      defaultName = 'Power & Strength Periodization';
      defaultColor = '#EF4444'; // Red
      break;
    case 'hypertrophy':
      defaultName = 'Hypertrophy Volume Blueprint';
      defaultColor = '#3B82F6'; // Blue
      break;
    case 'endurance':
      defaultName = 'Muscular Endurance & Density';
      defaultColor = '#10B981'; // Green
      break;
    case 'longevity':
      defaultName = 'Longevity & Joint Health Protocol';
      defaultColor = '#F59E0B'; // Amber
      break;
  }

  const isMinimalist = profile.training_mentality === 'get_out' || profile.training_enjoyment === 'minimalist';
  const isHighIntensity = profile.training_mentality === 'fury' || profile.intensity_style === 'high_intensity_low_volume';
  const isVolumeAccumulator = profile.intensity_style === 'volume_accumulation';
  const isBalanced = profile.intensity_style === 'balanced';
  const isPrecision = (profile.training_mentality === 'precision' && !isHighIntensity && !isVolumeAccumulator && !isBalanced) || isVolumeAccumulator;
  const isFury = isHighIntensity;
  const isGetOut = isMinimalist;

  const mentality: TrainingMentality =
    profile.training_mentality ??
    (isHighIntensity
      ? 'fury'
      : isMinimalist
      ? 'get_out'
      : 'precision');

  const experienceLevel: ExperienceLevel =
    options.experienceLevel ?? profile.experience_level ?? 'intermediate';
  const isBeginner = experienceLevel === 'beginner';
  const targetWeeklyEReps = options.targetWeeklyEReps ?? 32;

  // Pillar 7: SBD vs. Variety Sliding Scale & Goal-Derived Archetype
  const archetype = resolveArchetype(
    profile.primary_goal,
    profile.secondary_goals || []
  );
  const preferHighSFRNonSBD =
    !isBeginner && archetype === 'archetype_iv_pure_hypertrophy';

  const defaultProgramNotes = isBeginner
    ? `Synthesized Two-Tier Novice Bifurcated Program for ${profile.gender} lifter (${profile.preferred_session_duration_mins || 60}m/session, ${daysPerWeek}d/wk). Tier 1 Barbell Practice (submaximal) + Tier 2 Stimulating Drivers.`
    : `Synthesized for ${profile.gender} lifter (${mentality} mentality, ${profile.preferred_session_duration_mins || 60}m/session, ${daysPerWeek}d/wk, ${archetype}).`;

  const program: Program = {
    id: programId,
    name: options.programName || defaultName,
    color_hex: options.colorHex || defaultColor,
    notes: options.notes || defaultProgramNotes,
    created_at: new Date().toISOString(),
  };

  const hasStrengthGoal = profile.primary_goal === 'strength' || profile.secondary_goals?.includes('strength');
  const hasHypertrophyGoal = profile.primary_goal === 'hypertrophy' || profile.secondary_goals?.includes('hypertrophy');

  // Starting sets are allocated against weekly targets, independently of mood.
  const compoundSetCount = hasStrengthGoal ? 3 : 2;
  const accessorySetCount = 2;
  const compoundTargetRpe = isBeginner ? 7 : 8;
  const compoundTargetRir = 10 - compoundTargetRpe;
  const accessoryTargetRpe = isBeginner ? 8 : isFury ? 9 : 8;
  const accessoryTargetRir = 10 - accessoryTargetRpe;

  // 6. Build WorkoutTemplates, TemplateExercises & ProgressionRules
  const templates: WorkoutTemplate[] = [];
  const templateExercises: TemplateExercise[] = [];
  const progressionRules: ProgressionRule[] = [];
  let totalWeeklySets = 0;

  // Step 9.3: Build preferences lookup map
  const preferenceMap = new Map<string, ExercisePreference>();
  if (options?.preferences) {
    if (options.preferences instanceof Map) {
      options.preferences.forEach((val, key) => preferenceMap.set(key, val));
    } else if (Array.isArray(options.preferences)) {
      options.preferences.forEach((p) => preferenceMap.set(p.exercise_id, p));
    }
  }

  // Step 9.3: Build CandidateScoringContext
  const scoringContext: CandidateScoringContext = {
    hasAxialFatigueSensitivity:
      options?.hasAxialFatigueSensitivity ?? (profile.has_axial_fatigue_sensitivity ?? false),
    isCaloricDeficit:
      options?.isCaloricDeficit ?? (profile.is_caloric_deficit ?? false),
    secondaryGoals: profile.secondary_goals,
    painfulJoint: options?.painfulJoint,
    painSeverity: options?.painSeverity,
    painfulJoints: options?.painfulJoints,
  };

  // Step 9.3: Regional Muscle Bias Balancer across weekly split
  const coveredSubTargetsByMuscle = new Map<string, Set<string>>();
  const protectedIds = new Set<string>();

  // Reserve direct arms/core across the week before applying any time constraints.
  if (hasHypertrophyGoal) {
    const supplements: ExerciseSlotConfig[] = [
      { preferredId: 'dumbbell_bicep_curl', fallbackIds: ['cable_bicep_curl', 'barbell_bicep_curl'], muscleGroup: 'Biceps', antagonistTag: 'bicep' },
      { preferredId: 'cable_tricep_pushdown', fallbackIds: ['barbell_skull_crusher'], muscleGroup: 'Triceps', antagonistTag: 'tricep' },
      { preferredId: 'bodyweight_hanging_knee_raise', fallbackIds: [], muscleGroup: 'Abs', antagonistTag: 'abs' },
      { preferredId: 'machine_standing_calf_raise', fallbackIds: [], muscleGroup: 'Calves', antagonistTag: 'calves' },
      { preferredId: 'barbell_hip_thrust', fallbackIds: [], muscleGroup: 'Glutes' },
    ];
    for (const slot of supplements) {
      const desiredExposures = Math.min(2, blueprints.length);
      while (blueprints.filter(bp => bp.slots.some(s => s.muscleGroup === slot.muscleGroup)).length < desiredExposures) {
        const candidates = blueprints.filter(bp => !bp.slots.some(s => s.muscleGroup === slot.muscleGroup));
        candidates.sort((a, b) => {
          const lower = ['Abs', 'Calves', 'Glutes'].includes(slot.muscleGroup);
          const score = (bp: TemplateBlueprint) => bp.slots.filter(s => lower
            ? ['Quads', 'Hamstrings'].includes(s.muscleGroup) : ['Chest', 'Back'].includes(s.muscleGroup)).length;
          return score(b) - score(a) || a.slots.length - b.slots.length;
        });
        candidates[0].slots.push({ ...slot });
      }
    }
  }

  blueprints.forEach((bp, templateIdx) => {
    const templateId = `tpl-${programId}-${templateIdx + 1}`;

    const workoutTemplate: WorkoutTemplate = {
      id: templateId,
      program_id: programId,
      name: bp.name,
      notes: bp.notes,
      order_index: templateIdx,
      created_at: new Date().toISOString(),
    };
    templates.push(workoutTemplate);

    const activeSlots = bp.slots;

    const templateExercisesForBp: TemplateExercise[] = [];

    activeSlots.forEach((slot, slotIdx) => {
      const exerciseId = resolveExerciseId(
        slot,
        profile.equipment_access,
        catalogMap,
        preferHighSFRNonSBD,
        scoringContext,
        preferenceMap,
        coveredSubTargetsByMuscle
      );
      if (!exerciseId) return;
      const isPrimaryCompound = slot.isPrimaryCompound === true;
      const teId = `te-${templateId}-${slotIdx + 1}`;
      if (hasStrengthGoal && (isPrimaryCompound || (!hasHypertrophyGoal && isStrengthMain('strength', catalogMap.get(exerciseId))))) protectedIds.add(teId);

      // Set count
      const sets = isPrimaryCompound ? compoundSetCount : accessorySetCount;
      const targetRpe = isPrimaryCompound ? compoundTargetRpe : accessoryTargetRpe;
      const targetRir = isPrimaryCompound ? compoundTargetRir : accessoryTargetRir;

      // Rep bracket tuning based on primary_goal and compound status
      let repsMin = 8;
      let repsMax = 12;

      if (isBeginner) {
        if (isPrimaryCompound) {
          repsMin = 3;
          repsMax = 5;
        } else {
          repsMin = 10;
          repsMax = 15;
        }
      } else {
        switch (profile.primary_goal) {
          case 'strength':
            if (isPrimaryCompound) {
              repsMin = 3;
              repsMax = 5;
            } else {
              repsMin = hasHypertrophyGoal ? 10 : 6;
              repsMax = hasHypertrophyGoal ? 15 : 10;
            }
            break;

          case 'hypertrophy':
            if (isPrimaryCompound) {
              repsMin = 6;
              repsMax = 10;
            } else {
              repsMin = 10;
              repsMax = 15;
            }
            break;

          case 'endurance':
            repsMin = 12;
            repsMax = 18;
            break;

          case 'longevity':
            repsMin = 8;
            repsMax = 12;
            break;
        }

        // Pillar 8: Set accessory rep brackets to 10-15 when target RIR <= 1.0
        if (!isPrimaryCompound && targetRir <= 1.0) {
          repsMin = Math.max(repsMin, 10);
          repsMax = Math.max(repsMax, 15);
        }
      }

      const templateExercise: TemplateExercise = {
        id: teId,
        template_id: templateId,
        exercise_id: exerciseId,
        gear_id: null,
        target_sets: sets,
        target_reps_min: repsMin,
        target_reps_max: repsMax,
        target_rpe: targetRpe,
        target_rir: targetRir,
        order_index: slotIdx,
        exercise_group_id: null,
        set_type: 'working',
      };
      templateExercisesForBp.push(templateExercise);

      // 7. Progression Rules Configuration
      let rulesForExercise: ProgressionRule[];

      if (isBeginner) {
        if (isPrimaryCompound) {
          rulesForExercise = createLinearProgressionRule(teId, {
            incrementKg: 2.5,
            plateauThresholdSessions: 3,
            deloadPercent: 0.10,
          });
        } else {
          rulesForExercise = createDoubleProgressionRule(teId, {
            incrementKg: 1.25,
            plateauThresholdSessions: 3,
            deloadPercent: 0.10,
          });
        }
      } else if (isFury) {
        rulesForExercise = createDynamicDoubleProgressionRule(teId, {
          incrementKg: isPrimaryCompound ? 2.5 : 1.25,
        });
      } else if (isPrecision || (profile.primary_goal === 'strength' && isPrimaryCompound)) {
        if (isPrimaryCompound) {
          rulesForExercise = createLinearProgressionRule(teId, {
            incrementKg: 2.5,
            plateauThresholdSessions: 3,
            deloadPercent: 0.10,
          });
        } else {
          rulesForExercise = createDynamicDoubleProgressionRule(teId, {
            incrementKg: 1.25,
          });
        }
      } else {
        if (isPrimaryCompound) {
          rulesForExercise = createDoubleProgressionRule(teId, {
            incrementKg: 2.5,
            plateauThresholdSessions: 3,
            deloadPercent: 0.10,
          });
        } else {
          // Archetypes II, III, IV: Enforce Dynamic Double Progression on Tier 2 & 3
          rulesForExercise = createDynamicDoubleProgressionRule(teId, {
            incrementKg: 1.25,
          });
        }
      }

      progressionRules.push(...rulesForExercise);

      // Ordinary effort-rated sets provide progression evidence throughout the cycle.
      if (!isBeginner) {
        progressionRules.push(createEstimatedCapacityProgressionRule(teId, isPrimaryCompound ? 2.5 : 1.25));
      }
    });

    templateExercises.push(...templateExercisesForBp);
    templateExercisesForBp.forEach((te) => {
      totalWeeklySets += te.target_sets ?? 0;
    });
  });

  const planned = planProgramVolume({ ...profile, experience_level: experienceLevel }, templates, templateExercises, catalogMap, protectedIds,
    { preferences: preferenceMap, scoringContext });
  templateExercises.splice(0, templateExercises.length, ...planned.rows);
  const retained = new Set(templateExercises.map(te => te.id));
  for (let i = progressionRules.length - 1; i >= 0; i--) {
    if (!retained.has(progressionRules[i].template_exercise_id)) progressionRules.splice(i, 1);
  }
  const ruled = new Set(progressionRules.map(rule => rule.template_exercise_id));
  for (const te of templateExercises.filter(row => !ruled.has(row.id))) {
    progressionRules.push(...createDynamicDoubleProgressionRule(te.id, { incrementKg: 1.25 }));
    if (!isBeginner) progressionRules.push(createEstimatedCapacityProgressionRule(te.id, 1.25));
  }
  totalWeeklySets = templateExercises.reduce((sum, te) => sum + (te.target_sets ?? 0), 0);
  templates.forEach((template, index) => {
    if (profile.training_mentality === 'get_out') template.name = `Day ${index + 1} — Time-efficient training`;
    template.notes = `Estimated ${planned.minutes[index]} minutes including warm-up, setup and prescribed rest.`;
  });
  program.notes += `\nSession estimates: ${planned.minutes.join(", ")} minutes.`;
  if (planned.warnings.length) program.notes += `\nTime/equipment tradeoffs:\n${planned.warnings.join("\n")}`;
  // 8. Summary Information
  let progressionSummary = 'Standard Double Progression (DP)';
  if (isBeginner) {
    progressionSummary = 'Two-Tier Novice Structure: Linear Progression (LP) practice, Double Progression (DP) drivers';
  } else if (isFury) {
    progressionSummary = 'Dynamic Double Progression (DDP per-set advancement)';
  } else if (isPrecision || profile.primary_goal === 'strength') {
    progressionSummary = 'Linear Progression (LP) on main compounds, Dynamic Double Progression (DDP) on accessories';
  } else if (isGetOut) {
    progressionSummary = 'Dynamic Double Progression (DDP) with time-compressed execution';
  } else {
    progressionSummary = 'Double Progression (DP) on compounds, Dynamic Double Progression (DDP) on accessories';
  }

  const summary: SynthesizedProgramSummary = {
    splitType,
    daysPerWeek,
    estimatedSessionDurationMins: Math.max(...planned.minutes),
    sessionDurationsMins: planned.minutes,
    planningWarnings: planned.warnings,
    weeklyMuscleSets: planned.coverage,
    weeklyMuscleEReps: weeklyMuscleEReps(templateExercises, catalogMap),
    weeklyMiniSets: weeklyMiniSetCounts(templateExercises, catalogMap),
    totalWeeklyMiniSets: templateExercises.reduce((sum, te) => sum + (te.target_sets ?? 0) * (te.rest_pause?.mini_sets ?? 0), 0),
    totalWeeklySets,
    hasSupersets: templateExercises.some(te => te.exercise_group_id != null),
    progressionSchemeSummary: progressionSummary,
    archetype,
  };

  return {
    program,
    templates,
    templateExercises,
    progressionRules,
    summary,
  };
}
