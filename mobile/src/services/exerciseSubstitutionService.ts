/**
 * Workout Suite — Exercise Substitution Service
 *
 * Implements ADR-012: Exercise Variant Hierarchy with parent_exercise_id
 * Implements ADR-023: 1-Tap In-Session Exercise Substitution
 *
 * Recommends compatible substitute exercises when equipment is unavailable or busy:
 * 1. Variant Hierarchy (direct children, parent root, sibling variants)
 * 2. Same Muscle Group & Compound/Isolation profile
 * 3. Pulls ghost values from the substitute exercise's global history
 * 4. Transfers target rep/RPE prescriptions and swaps sets in active session
 */

import { Exercise, WorkoutSet, WorkoutWithSets, JointLocation } from '../core/types';
import { normalizeExerciseLoad } from '../core/math/loadNormalizer';
import { IExerciseRepository } from '../domain/repositories/IExerciseRepository';
import { IWorkoutRepository } from '../domain/repositories/IWorkoutRepository';
import { IGearRepository } from '../domain/repositories/IGearRepository';

// ============================================================================
// Biomechanical Joint Resolution Helper
// ============================================================================

/**
 * Maps an exercise to its primary mechanically loaded joints and articulations.
 */
export function resolveExerciseJoints(exercise: Exercise): JointLocation[] {
  if (exercise.primary_joints && exercise.primary_joints.length > 0) {
    return exercise.primary_joints;
  }

  const name = (exercise.name || '').toLowerCase();
  const id = (exercise.id || '').toLowerCase();
  const mg = (exercise.muscle_group || '').toLowerCase();

  // Leg Extension / Leg Curl (single joint isolation)
  if (name.includes('leg extension') || name.includes('leg curl') || id.includes('leg_extension') || id.includes('leg_curl')) {
    return ['knee'];
  }

  // Calf Raise
  if (name.includes('calf') || mg === 'calves') {
    return ['ankle', 'knee'];
  }

  // Leg Press & Bulgarian Split Squat (machine/supported spinal offloading)
  if (name.includes('leg press') || id.includes('leg_press') || name.includes('split squat') || id.includes('split_squat')) {
    return ['knee', 'hip', 'ankle'];
  }

  // Squat variants (high axial shear on lower back)
  if (name.includes('squat') || id.includes('squat') || name.includes('lunge') || id.includes('lunge')) {
    return ['knee', 'hip', 'lower_back', 'ankle'];
  }

  // Deadlift / RDL / Good Morning / Hip Thrust
  if (
    name.includes('deadlift') ||
    name.includes('rdl') ||
    name.includes('good morning') ||
    name.includes('hip thrust') ||
    id.includes('deadlift') ||
    id.includes('rdl') ||
    id.includes('hip_thrust')
  ) {
    return ['lower_back', 'hip', 'knee', 'wrist'];
  }

  // Bench Press / Incline / Dip / Push-Up
  if (
    name.includes('bench press') ||
    name.includes('chest press') ||
    name.includes('dip') ||
    name.includes('push-up') ||
    name.includes('push up') ||
    name.includes('incline bench') ||
    id.includes('bench_press') ||
    id.includes('dip')
  ) {
    return ['shoulder', 'elbow', 'wrist', 'chest_pec'];
  }

  // Overhead Press / Shoulder Press / Lateral Raise
  if (
    name.includes('overhead press') ||
    name.includes('shoulder press') ||
    name.includes('ohp') ||
    name.includes('military press') ||
    name.includes('lateral raise') ||
    id.includes('ohp') ||
    id.includes('shoulder_press') ||
    id.includes('lateral_raise')
  ) {
    return ['shoulder', 'elbow', 'wrist', 'lower_back'];
  }

  // Row / Pulldown / Pull-Up
  if (
    name.includes('row') ||
    name.includes('pulldown') ||
    name.includes('pull-up') ||
    name.includes('pull up') ||
    name.includes('chin-up') ||
    id.includes('row') ||
    id.includes('pulldown') ||
    id.includes('pull_up')
  ) {
    return ['shoulder', 'elbow', 'wrist', 'lower_back'];
  }

  // Bicep Curl / Tricep Pushdown / Skull Crusher
  if (
    name.includes('curl') ||
    name.includes('pushdown') ||
    name.includes('skull crusher') ||
    name.includes('tricep') ||
    (name.includes('extension') && (mg === 'arms' || mg === 'triceps' || mg === 'biceps'))
  ) {
    return ['elbow', 'wrist', 'shoulder'];
  }

  // Muscle group fallbacks
  if (mg === 'chest') return ['shoulder', 'elbow', 'wrist', 'chest_pec'];
  if (mg === 'back' || mg === 'lats' || mg === 'traps') return ['shoulder', 'elbow', 'wrist', 'lower_back'];
  if (mg === 'shoulders') return ['shoulder', 'elbow', 'wrist', 'lower_back'];
  if (mg === 'quads' || mg === 'hamstrings') return ['knee', 'hip', 'lower_back', 'ankle'];
  if (mg === 'glutes') return ['hip', 'lower_back', 'knee'];
  if (mg === 'biceps' || mg === 'triceps' || mg === 'forearms') return ['elbow', 'wrist', 'shoulder'];

  return ['other'];
}

// ============================================================================
// Service DTOs & Output Types
// ============================================================================

export interface FindSubstitutesOptions {
  painfulJoint?: JointLocation | null;
}

export type SubstitutionMatchReason =
  | 'direct_variant'
  | 'variant_family'
  | 'parent_root'
  | 'same_muscle_compound'
  | 'same_muscle_group';

export interface ExerciseSubstitutionOption {
  exercise: Exercise;
  matchReason: SubstitutionMatchReason;
  relevanceScore: number;
  ghostSets: WorkoutSet[];
  hasGhostData: boolean;
}

export interface PrescriptionTarget {
  targetSets?: number | null;
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  targetRpe?: number | null;
  targetRir?: number | null;
}

export interface TransferredPrescription extends PrescriptionTarget {
  sourceExerciseId: string;
  targetExerciseId: string;
}

export interface ApplySubstitutionInput {
  workoutId: string;
  oldExerciseId: string;
  newExerciseId: string;
  swapScope: 'session_only' | 'permanent_template';
  templateId?: string | null;
  targetPrescription?: PrescriptionTarget;
}

export interface ApplySubstitutionResult {
  workoutId: string;
  oldExercise: Exercise;
  newExercise: Exercise;
  swapScope: 'session_only' | 'permanent_template';
  swappedSetsCount: number;
  updatedSets: WorkoutSet[];
  ghostSets: WorkoutSet[];
}

export class ExerciseSubstitutionService {
  constructor(
    private readonly exerciseRepo: IExerciseRepository,
    private readonly workoutRepo: IWorkoutRepository,
    private readonly gearRepo?: IGearRepository
  ) {}

  /**
   * Finds compatible substitute exercises for a given exercise, prioritized by:
   * 1. Variant hierarchy (parent, siblings, children)
   * 2. Same muscle group + compound matching
   * 3. Same muscle group general
   *
   * Includes historical ghost sets from the substitute's most recent completed session.
   */
  public async findSubstitutes(
    currentExerciseId: string,
    options?: FindSubstitutesOptions
  ): Promise<ExerciseSubstitutionOption[]> {
    const current = await this.exerciseRepo.findById(currentExerciseId);
    if (!current) {
      return [];
    }

    const seenIds = new Set<string>([current.id]);
    const candidates: Array<{
      exercise: Exercise;
      matchReason: SubstitutionMatchReason;
      baseScore: number;
    }> = [];

    // 1. Direct children / variants (where parent_exercise_id === current.id)
    const directVariants = await this.exerciseRepo.findVariants(current.id);
    for (const variant of directVariants) {
      if (!seenIds.has(variant.id)) {
        seenIds.add(variant.id);
        candidates.push({
          exercise: variant,
          matchReason: 'direct_variant',
          baseScore: 100,
        });
      }
    }

    // 2. Parent root and sibling variants (if current has parent_exercise_id)
    if (current.parent_exercise_id) {
      const parent = await this.exerciseRepo.findById(current.parent_exercise_id);
      if (parent && !seenIds.has(parent.id)) {
        seenIds.add(parent.id);
        candidates.push({
          exercise: parent,
          matchReason: 'parent_root',
          baseScore: 95,
        });
      }

      const siblings = await this.exerciseRepo.findVariants(current.parent_exercise_id);
      for (const sibling of siblings) {
        if (!seenIds.has(sibling.id)) {
          seenIds.add(sibling.id);
          candidates.push({
            exercise: sibling,
            matchReason: 'variant_family',
            baseScore: 90,
          });
        }
      }
    }

    // 3. Same muscle group exercises
    const sameMuscleGroup = await this.exerciseRepo.findByMuscleGroup(current.muscle_group);
    for (const ex of sameMuscleGroup) {
      if (!seenIds.has(ex.id)) {
        seenIds.add(ex.id);
        const isCompoundMatch = ex.is_compound === current.is_compound;
        const isCategoryMatch = ex.category === current.category;

        let baseScore = 50;
        let matchReason: SubstitutionMatchReason = 'same_muscle_group';

        if (isCompoundMatch && isCategoryMatch) {
          baseScore = 75;
          matchReason = 'same_muscle_compound';
        } else if (isCompoundMatch) {
          baseScore = 70;
          matchReason = 'same_muscle_compound';
        }

        candidates.push({
          exercise: ex,
          matchReason,
          baseScore,
        });
      }
    }

    // 4. Attach ghost sets and calculate final relevance score (with biomechanical joint awareness)
    const results: ExerciseSubstitutionOption[] = await Promise.all(
      candidates.map(async (candidate) => {
        const ghostSets = await this.workoutRepo.getMostRecentCompletedSetsForExercise(
          candidate.exercise.id
        );
        const hasGhostData = ghostSets.length > 0;
        // Prioritize movements the user has actually logged before (+5 bonus)
        let relevanceScore = candidate.baseScore + (hasGhostData ? 5 : 0);

        if (options?.painfulJoint) {
          const candJoints = resolveExerciseJoints(candidate.exercise);
          if (candJoints.includes(options.painfulJoint)) {
            // Penalize candidate exercises that heavily load the painful articulation (-60)
            relevanceScore -= 60;
          } else {
            // Boost substitutes that spare the injured joint (+15)
            relevanceScore += 15;
          }

          // Specific biomechanical enhancements
          const candName = candidate.exercise.name.toLowerCase();
          if (options.painfulJoint === 'shoulder' && (candName.includes('close grip') || candName.includes('dumbbell') || candName.includes('neutral'))) {
            relevanceScore += 10;
          }
          if (options.painfulJoint === 'lower_back' && (candName.includes('leg press') || candName.includes('split squat') || candName.includes('belt squat'))) {
            relevanceScore += 15;
          }
        }

        return {
          exercise: candidate.exercise,
          matchReason: candidate.matchReason,
          relevanceScore,
          ghostSets,
          hasGhostData,
        };
      })
    );

    // Sort by relevance score DESC, then name ASC
    return results.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return a.exercise.name.localeCompare(b.exercise.name);
    });
  }

  /**
   * Transfers target rep brackets and RPE/RIR prescriptions from a source exercise
   * to a substitute exercise.
   */
  public transferRepBrackets(
    sourcePrescription: PrescriptionTarget,
    sourceExerciseId: string,
    targetExerciseId: string
  ): TransferredPrescription {
    return {
      sourceExerciseId,
      targetExerciseId,
      targetSets: sourcePrescription.targetSets ?? null,
      targetRepsMin: sourcePrescription.targetRepsMin ?? null,
      targetRepsMax: sourcePrescription.targetRepsMax ?? null,
      targetRpe: sourcePrescription.targetRpe ?? null,
      targetRir: sourcePrescription.targetRir ?? null,
    };
  }

  /**
   * Applies an exercise substitution to an active workout session.
   * Swaps existing sets for oldExerciseId to newExerciseId and re-normalizes loads.
   */
  public async applySubstitution(
    input: ApplySubstitutionInput
  ): Promise<ApplySubstitutionResult> {
    const oldExercise = await this.exerciseRepo.findById(input.oldExerciseId);
    if (!oldExercise) {
      throw new Error(`Old exercise '${input.oldExerciseId}' not found.`);
    }

    const newExercise = await this.exerciseRepo.findById(input.newExerciseId);
    if (!newExercise) {
      throw new Error(`New substitute exercise '${input.newExerciseId}' not found.`);
    }

    const sets = await this.workoutRepo.getSetsByWorkoutId(input.workoutId);
    const setsToUpdate = sets.filter((s) => s.exercise_id === input.oldExerciseId);

    // Fetch ghost sets for the substitute exercise to provide ghost placeholders
    const ghostSets = await this.workoutRepo.getMostRecentCompletedSetsForExercise(
      newExercise.id
    );

    // Update sets to point to the new exercise and re-normalize mechanical load
    const updatedSets: WorkoutSet[] = [];
    for (const set of setsToUpdate) {
      // Re-normalize load with the new exercise mechanics
      const normalized = normalizeExerciseLoad(
        set.raw_input_weight,
        newExercise,
        null,
        null,
        set.added_weight
      );

      updatedSets.push({
        ...set,
        exercise_id: newExercise.id,
        gear_id: null, // Clear gear from prior exercise unless specified
        weight: normalized.effectiveWeightKg,
        raw_input_weight: normalized.rawInputWeightKg,
        added_weight: normalized.addedWeightKg,
      });
    }

    if (updatedSets.length > 0) {
      await this.workoutRepo.saveSets(updatedSets);
    }

    return {
      workoutId: input.workoutId,
      oldExercise,
      newExercise,
      swapScope: input.swapScope,
      swappedSetsCount: updatedSets.length,
      updatedSets,
      ghostSets,
    };
  }
}
