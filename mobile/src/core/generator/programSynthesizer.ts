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
} from '../types';
import {
  createLinearProgressionRule,
  createDoubleProgressionRule,
  createDynamicDoubleProgressionRule,
} from '../rules/progressionRuleEngine';
import { DEFAULT_EXERCISES } from '../../database/seeds/defaultExercises';

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
}

interface TemplateBlueprint {
  name: string;
  notes: string;
  slots: ExerciseSlotConfig[];
}

// ============================================================================
// Equipment Resolution Mappings
// ============================================================================

/**
 * Resolves the optimal exercise ID based on user equipment access.
 */
function resolveExerciseId(
  slot: ExerciseSlotConfig,
  equipment: UserProfile['equipment_access'],
  catalogMap: Map<string, Exercise>
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

  // 1. Try slot candidates in order that match the equipment constraint
  const candidates = [slot.preferredId, ...slot.fallbackIds];
  for (const cand of candidates) {
    const ex = catalogMap.get(cand);
    if (ex && isEligible(ex)) {
      return ex.id;
    }
  }

  // 2. Search catalog for an eligible exercise matching the same muscle group
  for (const ex of catalogMap.values()) {
    if (
      isEligible(ex) &&
      ex.muscle_group.toLowerCase() === slot.muscleGroup.toLowerCase()
    ) {
      return ex.id;
    }
  }

  // 3. Search catalog for any eligible exercise
  for (const ex of catalogMap.values()) {
    if (isEligible(ex)) {
      return ex.id;
    }
  }

  // 4. Absolute fallback
  return slot.preferredId;
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
        preferredId: 'barbell_rdl',
        fallbackIds: ['machine_leg_curl', 'dumbbell_walking_lunge'],
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
        },
        {
          preferredId: 'cable_tricep_pushdown',
          fallbackIds: ['barbell_skull_crusher', 'bodyweight_dip'],
          muscleGroup: 'Triceps',
          antagonistTag: 'tricep',
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
        },
        {
          preferredId: 'barbell_skull_crusher',
          fallbackIds: ['cable_tricep_pushdown', 'bodyweight_dip'],
          muscleGroup: 'Triceps',
          antagonistTag: 'tricep',
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
      name: 'Push A — Heavy Bench & Delts',
      notes: 'Heavy barbell press and accessory volume.',
      slots: [
        { preferredId: 'barbell_bench_press', fallbackIds: ['dumbbell_bench_press'], muscleGroup: 'Chest', isPrimaryCompound: true },
        { preferredId: 'barbell_overhead_press', fallbackIds: ['dumbbell_shoulder_press'], muscleGroup: 'Shoulders' },
        { preferredId: 'dumbbell_incline_bench_press', fallbackIds: ['barbell_incline_bench_press'], muscleGroup: 'Chest' },
        { preferredId: 'cable_lateral_raise', fallbackIds: ['dumbbell_lateral_raise'], muscleGroup: 'Shoulders' },
        { preferredId: 'cable_tricep_pushdown', fallbackIds: ['barbell_skull_crusher'], muscleGroup: 'Triceps' },
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
      name: 'Push B — Incline & Shoulder Focus',
      notes: 'Incline pressing and shoulder hypertrophy.',
      slots: [
        { preferredId: 'barbell_incline_bench_press', fallbackIds: ['dumbbell_incline_bench_press'], muscleGroup: 'Chest', isPrimaryCompound: true },
        { preferredId: 'dumbbell_bench_press', fallbackIds: ['machine_chest_press'], muscleGroup: 'Chest' },
        { preferredId: 'dumbbell_shoulder_press', fallbackIds: ['barbell_overhead_press'], muscleGroup: 'Shoulders' },
        { preferredId: 'dumbbell_lateral_raise', fallbackIds: ['cable_lateral_raise'], muscleGroup: 'Shoulders' },
        { preferredId: 'barbell_skull_crusher', fallbackIds: ['cable_tricep_pushdown'], muscleGroup: 'Triceps' },
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
        preferredId: 'tricep_cable_pushdown',
        fallbackIds: ['dumbbell_overhead_tricep_extension', 'barbell_skull_crusher'],
        muscleGroup: 'Triceps',
        antagonistTag: 'tricep',
      },
    ],
  };

  const day3: TemplateBlueprint = {
    name: 'Day 3 — Upper Body Dips & Chins 15-Min Express',
    notes: '2 Antagonist superset pairs: Dips + Pull-ups (Pair 1), then Hammer Curl + Overhead Tricep Extension (Pair 2). 0s rest in pair, 90s between rounds.',
    slots: [
      {
        preferredId: 'bodyweight_dips',
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
        preferredId: 'dumbbell_overhead_tricep_extension',
        fallbackIds: ['tricep_cable_pushdown'],
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
    case 'powerbuilding':
      defaultName = 'Powerbuilding Hyper-Strength Split';
      defaultColor = '#8B5CF6'; // Purple
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

  const program: Program = {
    id: programId,
    name: options.programName || defaultName,
    color_hex: options.colorHex || defaultColor,
    notes:
      options.notes ||
      `Synthesized for ${profile.gender} lifter (${mentality} mentality, ${profile.preferred_session_duration_mins || 60}m/session, ${daysPerWeek}d/wk).`,
    created_at: new Date().toISOString(),
  };

  // 3. Antagonist Superset Pairing Trigger
  const shouldPairSupersets =
    is15MinRoutine ||
    isGetOut ||
    (profile.preferred_session_duration_mins != null &&
      profile.preferred_session_duration_mins <= 45);

  // 4. Session Duration Volume Constraint (limit exercise count if short session)
  const maxExercisesPerSession = is15MinRoutine
    ? 4
    : profile.preferred_session_duration_mins && profile.preferred_session_duration_mins <= 35
    ? 4
    : profile.preferred_session_duration_mins && profile.preferred_session_duration_mins <= 45
    ? 5
    : 8;

  // 5. Volume & Exertion Parameters
  let compoundSetCount: number;
  let accessorySetCount: number;
  let targetRpe: number;
  let targetRir: number;

  if (is15MinRoutine) {
    compoundSetCount = 2;
    accessorySetCount = 2;
    targetRpe = isFury ? 9.5 : 8.5;
    targetRir = isFury ? 0.5 : 1.5;
  } else if (isFury) {
    compoundSetCount = 2;
    accessorySetCount = 1;
    targetRpe = 9.5;
    targetRir = 0.5;
  } else if (isVolumeAccumulator) {
    compoundSetCount = 4;
    accessorySetCount = 3;
    targetRpe = 7.5;
    targetRir = 2.5;
  } else if (isPrecision) {
    compoundSetCount = 4;
    accessorySetCount = 3;
    targetRpe = 8.0;
    targetRir = 2.0;
  } else if (isGetOut) {
    compoundSetCount = 2;
    accessorySetCount = 2;
    targetRpe = 8.5;
    targetRir = 1.5;
  } else {
    // balanced fallback
    compoundSetCount = 3;
    accessorySetCount = 2;
    targetRpe = 8.5;
    targetRir = 1.5;
  }

  // 6. Build WorkoutTemplates, TemplateExercises & ProgressionRules
  const templates: WorkoutTemplate[] = [];
  const templateExercises: TemplateExercise[] = [];
  const progressionRules: ProgressionRule[] = [];
  let totalWeeklySets = 0;

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

    // Filter slots by session duration limit
    const activeSlots = bp.slots.slice(0, maxExercisesPerSession);

    // Grouping index tracker for antagonist supersets
    let supersetCounter = 1;
    const antagonistPairs = new Map<string, string>(); // e.g. 'chest' -> groupId

    activeSlots.forEach((slot, slotIdx) => {
      const exerciseId = resolveExerciseId(slot, profile.equipment_access, catalogMap);
      const isPrimaryCompound = slot.isPrimaryCompound === true;
      const teId = `te-${templateId}-${slotIdx + 1}`;

      // Set count
      const sets = isPrimaryCompound ? compoundSetCount : accessorySetCount;
      totalWeeklySets += sets;

      // Rep bracket tuning based on primary_goal and compound status
      let repsMin = 8;
      let repsMax = 12;

      switch (profile.primary_goal) {
        case 'strength':
          if (isPrimaryCompound) {
            repsMin = 3;
            repsMax = 5;
          } else {
            repsMin = 6;
            repsMax = 8;
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

        case 'powerbuilding':
          if (isPrimaryCompound) {
            repsMin = 4;
            repsMax = 6;
          } else {
            repsMin = 8;
            repsMax = 12;
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

      // Handle Antagonist Superset Group ID
      let exerciseGroupId: string | null = null;
      if (shouldPairSupersets && slot.antagonistTag) {
        const tag = slot.antagonistTag;
        // Check complementary partner
        let partnerTag: string | null = null;
        if (tag === 'chest') partnerTag = 'back';
        else if (tag === 'back') partnerTag = 'chest';
        else if (tag === 'quad') partnerTag = 'hamstring';
        else if (tag === 'hamstring') partnerTag = 'quad';
        else if (tag === 'bicep') partnerTag = 'tricep';
        else if (tag === 'tricep') partnerTag = 'bicep';
        else if (tag === 'calves') partnerTag = 'abs';
        else if (tag === 'abs') partnerTag = 'calves';
        else if (tag === 'delts') partnerTag = 'rear_delts';
        else if (tag === 'rear_delts') partnerTag = 'delts';

        if (partnerTag && antagonistPairs.has(partnerTag)) {
          // Link with already existing group
          exerciseGroupId = antagonistPairs.get(partnerTag)!;
          antagonistPairs.delete(partnerTag); // Closed pair
        } else {
          // Open new group
          exerciseGroupId = `ss-${templateId}-${supersetCounter++}`;
          antagonistPairs.set(tag, exerciseGroupId);
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
        exercise_group_id: exerciseGroupId,
      };
      templateExercises.push(templateExercise);

      // 7. Progression Rules Configuration
      let rulesForExercise: ProgressionRule[];

      if (isFury) {
        // High Intensity / Fury -> Dynamic Double Progression (DDP)
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
          rulesForExercise = createDoubleProgressionRule(teId, {
            incrementKg: 1.25,
            plateauThresholdSessions: 3,
            deloadPercent: 0.10,
          });
        }
      } else {
        // Hypertrophy & balanced & get_out -> Standard Double Progression (DP)
        rulesForExercise = createDoubleProgressionRule(teId, {
          incrementKg: isPrimaryCompound ? 2.5 : 1.25,
          plateauThresholdSessions: 3,
          deloadPercent: 0.10,
        });
      }

      progressionRules.push(...rulesForExercise);
    });
  });

  // 8. Summary Information
  let progressionSummary = 'Standard Double Progression (DP)';
  if (isFury) {
    progressionSummary = 'Dynamic Double Progression (DDP per-set advancement)';
  } else if (isPrecision || profile.primary_goal === 'strength') {
    progressionSummary = 'Linear Progression (LP) on main compounds, DP on accessories';
  } else if (isGetOut) {
    progressionSummary = 'Double Progression (DP) with time-compressed execution';
  }

  const summary: SynthesizedProgramSummary = {
    splitType,
    daysPerWeek,
    estimatedSessionDurationMins: is15MinRoutine
      ? 15
      : Math.min(
          profile.preferred_session_duration_mins || 60,
          shouldPairSupersets ? 45 : 75
        ),
    totalWeeklySets,
    hasSupersets: shouldPairSupersets,
    progressionSchemeSummary: progressionSummary,
  };

  return {
    program,
    templates,
    templateExercises,
    progressionRules,
    summary,
  };
}
