/**
 * Workout Suite — Exercise Inspection Application Service
 *
 * Implements Exercise Deep-Dive analytics and Rep-Max Record (PR Board) logic as specified in:
 * - Rough_sketch.md Section 2.3 & 2.8
 * - IMPLEMENTATION_PLAN.md Step 3.2
 *
 * Capabilities:
 * 1. PR Board extraction: Heaviest loads achieved per unique repetition count (1RM, 2RM, 3RM, etc.)
 *    with Set e1RM benchmarks (Lombardi power law w * r_eff^k).
 * 2. Scope filtering: All-Time records vs Program Block date range.
 * 3. Cross-variant aggregation: Aggregate records across root movement and all child variants.
 * 4. SBD standard classification: Evaluates current best e1RM against allometric strength tiers.
 * 5. Comprehensive overview: Combines metadata, PR board, standards, and historical volume metrics.
 */

import { IWorkoutRepository } from '../domain/repositories/IWorkoutRepository';
import { IExerciseRepository } from '../domain/repositories/IExerciseRepository';
import {
  Exercise,
  Gender,
  PRBoardOptions,
  PRBoardResult,
  RepMaxRecord,
  StrengthStandardSummaryResult,
  ExerciseInspectionOverview,
  SBDBalanceProfile,
} from '../core/types';
import {
  calculateEffectiveReps,
  calculateHeuristic1RM,
  DEFAULT_LOMBARDI_K,
} from '../core/math/heuristic1rm';
import {
  calculateSBDBalanceProfile,
  evaluateStrengthStandard,
} from '../core/math/strengthStandards';

export class ExerciseInspectionService {
  constructor(
    private workoutRepository: IWorkoutRepository,
    private exerciseRepository: IExerciseRepository
  ) {}

  /**
   * Resolves the PR Board (Rep-Max records) for an exercise.
   * Supports all-time vs program-block date scoping, and optional cross-variant aggregation.
   */
  async getPRBoard(options: PRBoardOptions): Promise<PRBoardResult> {
    const {
      exerciseId,
      scope = 'all_time',
      startDate,
      endDate,
      includeVariants = false,
    } = options;

    // 1. Resolve exercise IDs (single or cross-variant family)
    let targetExerciseIds = [exerciseId];

    if (includeVariants) {
      const exercise = await this.exerciseRepository.findById(exerciseId);
      if (exercise) {
        const rootId = exercise.parent_exercise_id || exercise.id;
        const variants = await this.exerciseRepository.findVariants(rootId);
        targetExerciseIds = Array.from(new Set([rootId, ...variants.map((v) => v.id)]));
      }
    }

    // 2. Fetch raw heaviest sets per unique rep count
    const rawRows = await this.workoutRepository.getRepMaxSets({
      exerciseIds: targetExerciseIds,
      startDate: scope === 'program_block' ? startDate : undefined,
      endDate: scope === 'program_block' ? endDate : undefined,
    });

    // 3. Compute effective reps and set e1RM benchmark (w * r_eff^k)
    const records: RepMaxRecord[] = rawRows.map((row) => {
      const effectiveReps = calculateEffectiveReps(row.reps, {
        rpe: row.rpe,
        rir: row.rir,
      });
      const e1rmKg = calculateHeuristic1RM(row.weight, row.reps, {
        rpe: row.rpe,
        rir: row.rir,
        k: DEFAULTLombardiK(),
      });

      return {
        reps: row.reps,
        weightKg: row.weight,
        effectiveReps,
        e1rmKg,
        setDate: row.workoutDate,
        workoutId: row.workoutId,
        setId: row.setId,
        rpe: row.rpe,
        rir: row.rir,
        rawInputWeight: row.rawInputWeight,
        exerciseId: row.exerciseId,
      };
    });

    // 4. Identify peak record (highest e1RM across all unique rep counts)
    let peakRecord: RepMaxRecord | null = null;
    let maxE1rm = -1;
    for (const rec of records) {
      if (rec.e1rmKg > maxE1rm) {
        maxE1rm = rec.e1rmKg;
        peakRecord = rec;
      }
    }

    // 5. Identify 1RM record if logged
    const allTimeBest1RM = records.find((r) => r.reps === 1) || null;

    return {
      exerciseId,
      records,
      peakRecord,
      allTimeBest1RM,
      totalPRCount: records.length,
    };
  }

  /**
   * Resolves strength standard classification tier, score, and next tier delta
   * if the exercise is a standard lift (squat, bench, deadlift, ohp, row).
   */
  async getStrengthStandardSummary(params: {
    exerciseId: string;
    gender: Gender;
    bodyweightKg?: number | null;
  }): Promise<StrengthStandardSummaryResult> {
    const { exerciseId, gender, bodyweightKg } = params;

    const exercise = await this.exerciseRepository.findById(exerciseId);
    if (!exercise || !exercise.standard_lift_type) {
      return { isStandardLift: false };
    }

    if (!bodyweightKg || bodyweightKg <= 0) {
      return {
        isStandardLift: true,
        liftType: exercise.standard_lift_type,
        standardResult: undefined,
      };
    }

    // Get best e1RM for this exercise
    const prBoard = await this.getPRBoard({
      exerciseId,
      scope: 'all_time',
      includeVariants: false,
    });

    const bestE1rmKg = prBoard.peakRecord ? prBoard.peakRecord.e1rmKg : 0;

    const standardResult = evaluateStrengthStandard({
      liftType: exercise.standard_lift_type,
      gender,
      bodyweightKg,
      e1rmKg: bestE1rmKg,
    });

    return {
      isStandardLift: true,
      liftType: exercise.standard_lift_type,
      standardResult,
    };
  }

  /**
   * Computes the composite SBD Balance profile (Squat, Bench, Deadlift) across the user's best e1RM.
   */
  async getSBDBalanceProfile(params: {
    gender: Gender;
    bodyweightKg: number;
  }): Promise<SBDBalanceProfile> {
    const { gender, bodyweightKg } = params;

    const allExercises = await this.exerciseRepository.findAll();
    const squatEx =
      allExercises.find((e) => e.standard_lift_type === 'squat' && !e.parent_exercise_id) ||
      allExercises.find((e) => e.standard_lift_type === 'squat');
    const benchEx =
      allExercises.find((e) => e.standard_lift_type === 'bench' && !e.parent_exercise_id) ||
      allExercises.find((e) => e.standard_lift_type === 'bench');
    const deadliftEx =
      allExercises.find((e) => e.standard_lift_type === 'deadlift' && !e.parent_exercise_id) ||
      allExercises.find((e) => e.standard_lift_type === 'deadlift');

    const [squatPR, benchPR, deadliftPR] = await Promise.all([
      squatEx ? this.getPRBoard({ exerciseId: squatEx.id, scope: 'all_time' }) : Promise.resolve(null),
      benchEx ? this.getPRBoard({ exerciseId: benchEx.id, scope: 'all_time' }) : Promise.resolve(null),
      deadliftEx ? this.getPRBoard({ exerciseId: deadliftEx.id, scope: 'all_time' }) : Promise.resolve(null),
    ]);

    const squatE1rm = squatPR?.peakRecord?.e1rmKg ?? 0;
    const benchE1rm = benchPR?.peakRecord?.e1rmKg ?? 0;
    const deadliftE1rm = deadliftPR?.peakRecord?.e1rmKg ?? 0;

    return calculateSBDBalanceProfile({
      gender,
      bodyweightKg,
      squatE1rm,
      benchE1rm,
      deadliftE1rm,
    });
  }

  /**
   * Generates a comprehensive inspection overview for an exercise:
   * metadata, PR board, SBD standard classification, and historical tonnage/sessions summary.
   */
  async getExerciseInspectionOverview(params: {
    exerciseId: string;
    gender: Gender;
    bodyweightKg?: number | null;
    prBoardOptions?: Partial<PRBoardOptions>;
  }): Promise<ExerciseInspectionOverview> {
    const { exerciseId, gender, bodyweightKg, prBoardOptions } = params;

    const exercise = await this.exerciseRepository.findById(exerciseId);
    if (!exercise) {
      throw new Error(`Exercise with id '${exerciseId}' not found`);
    }

    const prBoard = await this.getPRBoard({
      exerciseId,
      scope: prBoardOptions?.scope || 'all_time',
      startDate: prBoardOptions?.startDate,
      endDate: prBoardOptions?.endDate,
      includeVariants: prBoardOptions?.includeVariants ?? false,
    });

    const standardSummary = await this.getStrengthStandardSummary({
      exerciseId,
      gender,
      bodyweightKg,
    });

    // Historical sets for session and volume aggregations
    const historicalSets = await this.workoutRepository.getHistoricalSetsForExercise(
      exerciseId,
      { onlyCompletedWorkouts: true }
    );

    const uniqueSessionIds = new Set<string>();
    let totalVolumeKg = 0;
    let firstDate: string | null = null;
    let lastDate: string | null = null;

    for (const s of historicalSets) {
      uniqueSessionIds.add(s.workout_id);
      totalVolumeKg += s.weight * s.reps;
      const setDate = s.created_at.split('T')[0];
      if (!firstDate || setDate < firstDate) {
        firstDate = setDate;
      }
      if (!lastDate || setDate > lastDate) {
        lastDate = setDate;
      }
    }

    return {
      exercise,
      prBoard,
      standardSummary,
      historySummary: {
        totalSessions: uniqueSessionIds.size,
        totalSets: historicalSets.length,
        totalVolumeKg: Math.round(totalVolumeKg * 10) / 10,
        firstLoggedDate: firstDate,
        lastLoggedDate: lastDate,
      },
    };
  }
}

function DEFAULTLombardiK(): number {
  return DEFAULT_LOMBARDI_K;
}
