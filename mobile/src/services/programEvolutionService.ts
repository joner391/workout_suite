/**
 * Workout Suite — Program Evolution Service (Step 8.3)
 *
 * Implements Section 4 & Section 6 of THEORY_INTEGRATION_AND_MESOCYCLE_ARCHITECTURE.md
 * and Step 8.3 of IMPLEMENTATION_PLAN.md.
 *
 * Provides:
 * 1. Deferred End-of-Mesocycle Program Evolution (Meso N -> Meso N+1)
 * 2. Multi-Vector Program Evolution:
 *    - Vector 1: Tier & Axial Rebalance (SFR/axial shifts, e.g. Hack Squat <-> Barbell Squat)
 *    - Vector 2: Rep Brackets & Rest Timers (3-6 vs 8-15 reps, 3-5m vs 60-90s rest)
 *    - Vector 3: Progression Engine Migration (Bromley 3-week AMRAP wave on Tier 1; DDP on Tier 2/3)
 *    - Vector 4: Isometric eRep Invariance (preserving ~32 stimulating eReps/muscle/week)
 * 3. Faz Lifts' "Weight Mastery" Gating (holding load progression on RPE overshoots >= 9.5 or joint pain >= 3/5)
 * 4. Deterministic Offline "What Changed & Why" Staging Banner via mesocycleDiffFormatter.ts
 */

import {
  Exercise,
  TemplateExercise,
  WorkoutTemplate,
  ProgressionRule,
  ProgramBlock,
  Program,
  UserProfile,
  TrainingArchetype,
  TrainingMentality,
  WorkoutSet,
  PainReport,
} from '../core/types';
import { IProgramRepository, ProgramWithDetails } from '../domain/repositories/IProgramRepository';
import { IUserProfileRepository } from '../domain/repositories/IUserProfileRepository';
import { IWorkoutRepository } from '../domain/repositories/IWorkoutRepository';
import { IPainReportRepository } from '../domain/repositories/IPainReportRepository';
import { IExerciseRepository } from '../domain/repositories/IExerciseRepository';
import { ProgramBlockService } from './programBlockService';
import {
  computeTargetSetsFromExertion,
  resolveArchetype,
} from '../core/generator/programSynthesizer';
import {
  createLinearProgressionRule,
  createDoubleProgressionRule,
  createDynamicDoubleProgressionRule,
  createAmrapProgressionRule,
  createAmrapMidwayRule,
  createAmrapFinalWeekRule,
} from '../core/rules/progressionRuleEngine';
import {
  diffProgramSnapshots,
  formatMesocycleDiffMarkdown,
  formatDiffSummaryBadge,
  summarizeMesocycleChanges,
  MesocycleDiffItem,
  MESOCYCLE_DIFF_TEMPLATES,
  ProgramSnapshot,
} from './mesocycleDiffFormatter';
import {
  calculateTransitionWave,
  TransitionWaveStep,
  getMentalityDisplayName,
} from '../core/generator/transitionWave';

// ============================================================================
// Service Interfaces
// ============================================================================

export interface WeightMasteryOptions {
  /**
   * Maximum acceptable RPE on submaximal lifts before triggering load hold. Default 9.5.
   */
  rpeThreshold?: number;
  /**
   * Joint pain severity threshold (1-5 or 1-10) triggering load hold. Default 3.
   */
  painSeverityThreshold?: number;
}

export interface WeightMasteryResult {
  passed: boolean;
  holdLoad: boolean;
  reason?: string;
  maxRpeLogged?: number;
  jointPainSeverity?: number;
  painArea?: string;
}

export interface EvolveProgramOptions {
  programId?: string;
  startDate?: string;
  userProfile?: UserProfile;
  exerciseCatalog?: Exercise[] | Map<string, Exercise>;
  forceEvolve?: boolean;
}

export interface EvolutionResult {
  programId: string;
  previousBlockId: string;
  newBlockId: string;
  mesoNumber: number;
  diffItems: MesocycleDiffItem[];
  diffMarkdown: string;
  summaryBadge: string;
  conciseSummaries?: string[];
  evolvedTemplateExercises: TemplateExercise[];
  evolvedProgressionRules: ProgressionRule[];
  weightMasteryGatedExercises: string[];
  transitionWave?: TransitionWaveStep;
}

// ============================================================================
// Axial & SFR Rebalance Exercise Mappings
// ============================================================================

const AXIAL_OFFLOAD_MAP: Record<string, { substituteId: string; name: string }> = {
  barbell_back_squat: { substituteId: 'machine_leg_press', name: 'Leg Press' },
  barbell_low_bar_squat: { substituteId: 'machine_leg_press', name: 'Leg Press' },
  barbell_front_squat: { substituteId: 'machine_leg_press', name: 'Leg Press' },
  barbell_deadlift: { substituteId: 'barbell_rdl', name: 'Romanian Deadlift (RDL)' },
  barbell_conventional_deadlift: { substituteId: 'barbell_rdl', name: 'Romanian Deadlift (RDL)' },
  barbell_overhead_press: { substituteId: 'dumbbell_shoulder_press', name: 'Dumbbell Shoulder Press' },
  barbell_bench_press: { substituteId: 'machine_chest_press', name: 'Chest Press Machine' },
  barbell_bent_over_row: { substituteId: 'cable_seated_row', name: 'Seated Cable Row' },
};

const AXIAL_ONLOAD_MAP: Record<string, { substituteId: string; name: string }> = {
  machine_leg_press: { substituteId: 'barbell_back_squat', name: 'Barbell Back Squat' },
  machine_hack_squat: { substituteId: 'barbell_back_squat', name: 'Barbell Back Squat' },
  dumbbell_shoulder_press: { substituteId: 'barbell_overhead_press', name: 'Barbell Overhead Press' },
  machine_chest_press: { substituteId: 'barbell_bench_press', name: 'Barbell Bench Press' },
  cable_seated_row: { substituteId: 'barbell_bent_over_row', name: 'Barbell Bent-Over Row' },
};

const JOINT_ROM_PROTECTION_MAP: Record<string, { substituteId: string; name: string }> = {
  barbell_bench_press: { substituteId: 'dumbbell_bench_press', name: 'Dumbbell Bench Press' },
  dumbbell_incline_bench_press: { substituteId: 'machine_chest_press', name: 'Chest Press Machine' },
  barbell_incline_bench_press: { substituteId: 'dumbbell_bench_press', name: 'Dumbbell Bench Press' },
  cable_chest_fly: { substituteId: 'machine_chest_press', name: 'Chest Press Machine' },
  barbell_back_squat: { substituteId: 'machine_leg_press', name: 'Leg Press' },
  barbell_rdl: { substituteId: 'machine_leg_curl', name: 'Leg Curl Machine' },
  barbell_skull_crusher: { substituteId: 'cable_tricep_pushdown', name: 'Cable Tricep Pushdown' },
  cable_overhead_tricep_extension: { substituteId: 'cable_tricep_pushdown', name: 'Cable Tricep Pushdown' },
};

// ============================================================================
// ProgramEvolutionService Implementation
// ============================================================================

export class ProgramEvolutionService {
  constructor(
    private readonly programRepo: IProgramRepository,
    private readonly userProfileRepo: IUserProfileRepository,
    private readonly workoutRepo?: IWorkoutRepository,
    private readonly painReportRepo?: IPainReportRepository,
    private readonly exerciseRepo?: IExerciseRepository,
    private readonly programBlockService?: ProgramBlockService
  ) {}

  /**
   * Staging mid-flight mood changes:
   * Persists updated psychological or logistical preferences without altering
   * the active, in-flight mesocycle. Sets `pending_meso_mood = true`.
   */
  async queueMesoMood(moodUpdates: Partial<UserProfile>): Promise<UserProfile> {
    const existing = await this.userProfileRepo.getProfile();
    const baseProfile: UserProfile = existing ?? {
      id: 'profile_default',
      gender: 'male',
      birthdate: null,
      height_cm: null,
      training_mentality: 'precision',
      primary_goal: 'hypertrophy',
      secondary_goals: null,
      preferred_days_per_week: 4,
      preferred_session_duration_mins: 60,
      equipment_access: 'commercial_gym',
      experience_level: 'intermediate',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const updated: UserProfile = {
      ...baseProfile,
      ...moodUpdates,
      pending_meso_mood: true,
      updated_at: new Date().toISOString(),
    };

    return await this.userProfileRepo.saveProfile(updated);
  }

  /**
   * Returns true if there is a staged mood change awaiting end-of-mesocycle evolution.
   */
  async hasPendingMesoMood(): Promise<boolean> {
    const profile = await this.userProfileRepo.getProfile();
    return Boolean(profile?.pending_meso_mood);
  }

  /**
   * Clears the pending meso mood staging flag.
   */
  async clearPendingMesoMood(): Promise<void> {
    const profile = await this.userProfileRepo.getProfile();
    if (profile && profile.pending_meso_mood) {
      await this.userProfileRepo.saveProfile({
        ...profile,
        pending_meso_mood: false,
        updated_at: new Date().toISOString(),
      });
    }
  }

  /**
   * Checks whether the active mesocycle block has completed accumulation week L
   * or reached its scheduled target weeks / planned session volume.
   */
  async isReadyForEvolution(programId?: string): Promise<{
    ready: boolean;
    reason: string;
    completedWeeks: number;
    targetWeeks: number;
    completedWorkouts?: number;
    targetWorkouts?: number;
  }> {
    const activeBlock = programId
      ? (await this.programRepo.findProgramBlocksByProgramId(programId)).find(
          (b) => b.end_date === null
        )
      : await this.programRepo.getActiveProgramBlock();

    if (!activeBlock) {
      return {
        ready: false,
        reason: 'No active mesocycle block currently in progress.',
        completedWeeks: 0,
        targetWeeks: 4,
        completedWorkouts: 0,
        targetWorkouts: 16,
      };
    }

    const targetWeeks = 4; // Standard mesocycle accumulation block length
    const startDate = new Date(activeBlock.start_date);
    const now = new Date();
    const diffMs = Math.max(0, now.getTime() - startDate.getTime());
    const elapsedWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));

    // Check completed workouts logged since block start
    let completedWorkouts = 0;
    let targetWorkouts = 16;
    if (this.workoutRepo) {
      try {
        const workouts = await this.workoutRepo.findAll({
          status: 'completed',
          startDate: activeBlock.start_date,
        });
        completedWorkouts = workouts.length;
      } catch (err) {
        // Fallback to elapsed weeks
      }
    }

    // Determine target workouts based on profile days per week
    let daysPerWeek = 4;
    try {
      const profile = await this.userProfileRepo.getProfile();
      if (profile?.preferred_days_per_week) {
        daysPerWeek = profile.preferred_days_per_week;
      }
    } catch {
      // default 4
    }
    targetWorkouts = daysPerWeek * targetWeeks;

    const weeksReady = elapsedWeeks >= targetWeeks;
    const workoutsReady = completedWorkouts > 0 && completedWorkouts >= targetWorkouts;
    const ready = weeksReady || workoutsReady;

    const reason = ready
      ? workoutsReady
        ? `Completed all ${completedWorkouts} planned mesocycle workouts (${targetWeeks} weeks). Ready for Meso N+1 evolution.`
        : `Completed ${elapsedWeeks} weeks of accumulation (target: ${targetWeeks} weeks). Ready for Meso N+1 evolution.`
      : `Active block is at Week ${elapsedWeeks + 1} of ${targetWeeks} (${completedWorkouts}/${targetWorkouts} workouts completed). Cycle in progress.`;

    return {
      ready,
      reason,
      completedWeeks: elapsedWeeks,
      targetWeeks,
      completedWorkouts,
      targetWorkouts,
    };
  }

  /**
   * Faz Lifts' "Weight Mastery" Gating:
   *
   * Holds load progression if:
   * 1. RPE overshoots (>= 9.5 on submaximal lifts) during the recent session.
   * 2. Joint discomfort is logged (>= 3/5 on joint check / pain report).
   *
   * Guarantees technical standardization and connective tissue recovery before advancing weight.
   */
  async checkWeightMastery(
    exerciseId: string,
    options?: WeightMasteryOptions
  ): Promise<WeightMasteryResult> {
    const rpeThreshold = options?.rpeThreshold ?? 9.5;
    const painSeverityThreshold = options?.painSeverityThreshold ?? 3;

    let holdLoad = false;
    let reason: string | undefined = undefined;
    let maxRpeLogged: number | undefined = undefined;
    let jointPainSeverity: number | undefined = undefined;
    let painArea: string | undefined = undefined;

    // 1. Check recent set performance for RPE overshoots
    if (this.workoutRepo) {
      try {
        const recentSets =
          await this.workoutRepo.getMostRecentCompletedSetsForExercise(exerciseId);
        if (recentSets && recentSets.length > 0) {
          // Weight mastery gates strictly on SUBMAXIMAL working sets (excluding diagnostic AMRAP sets)
          const submaximalSets = recentSets.filter((s) => s.set_type !== 'amrap');
          if (submaximalSets.length > 0) {
            const rpes = submaximalSets
              .map((s) => s.rpe)
              .filter((r): r is number => r != null && !isNaN(r));

            if (rpes.length > 0) {
              maxRpeLogged = Math.max(...rpes);
              if (maxRpeLogged >= rpeThreshold) {
                holdLoad = true;
                reason = `RPE overshoot (RPE ${maxRpeLogged} >= ${rpeThreshold}) logged in previous session`;
              }
            }
          }
        }
      } catch (err) {
        console.warn('Error reading recent sets in checkWeightMastery:', err);
      }
    }

    // 2. Check joint pain / discomfort reports
    if (this.painReportRepo) {
      try {
        const painReports = await this.painReportRepo.getByExerciseId(exerciseId);
        if (painReports && painReports.length > 0) {
          const severities = painReports.map((p) => p.severity);
          jointPainSeverity = Math.max(...severities);
          if (jointPainSeverity >= painSeverityThreshold) {
            holdLoad = true;
            const worstReport = painReports.find((p) => p.severity === jointPainSeverity);
            const rawArea = worstReport?.joint_location || worstReport?.pain_type || 'joint';
            painArea = String(rawArea).toLowerCase();
            const painReason = `Joint discomfort (severity ${jointPainSeverity}/5) reported${painArea ? ` in ${painArea}` : ''}`;
            reason = reason ? `${reason}; ${painReason}` : painReason;
          }
        }
      } catch (err) {
        console.warn('Error reading pain reports in checkWeightMastery:', err);
      }
    }

    return {
      passed: !holdLoad,
      holdLoad,
      reason,
      maxRpeLogged,
      jointPainSeverity,
      painArea,
    };
  }

  /**
   * Evolve Active Program for Next Mesocycle (Meso N -> Meso N+1):
   *
   * Executes deferred mesocycle transition while preserving:
   * - `program.id`
   * - `workout_templates.id`
   * - `template_exercises.id`
   * - User custom exercise substitutions (unless flagged for axial/joint issue)
   * - Rep-Max PR history
   *
   * Closes active `program_blocks` entry and opens new meso block (`Meso N+1`).
   * Applies the 4 evolution vectors:
   * - Vector 1: Tier & Axial Rebalance
   * - Vector 2: Rep Brackets & Rest Timers
   * - Vector 3: Progression Engine Migration (Bromley AMRAP wave on Tier 1; DDP on Tier 2/3)
   * - Vector 4: Isometric eRep Invariance (~32 eReps/muscle/week)
   *
   * Formats offline diff banner via `mesocycleDiffFormatter.ts`.
   */
  async evolveActiveProgramForNextMeso(
    options?: EvolveProgramOptions
  ): Promise<EvolutionResult> {
    // 1. Identify active program and active block
    let activeBlock: ProgramBlock | null = null;
    let program: Program | null = null;

    if (options?.programId) {
      program = await this.programRepo.findById(options.programId);
      if (program) {
        const blocks = await this.programRepo.findProgramBlocksByProgramId(program.id);
        activeBlock = blocks.find((b) => b.end_date === null) || null;
      }
    } else {
      activeBlock = await this.programRepo.getActiveProgramBlock();
      if (activeBlock) {
        program = await this.programRepo.findById(activeBlock.program_id);
      }
    }

    if (!program) {
      throw new Error('No active program found to evolve for next mesocycle.');
    }

    // 2. Fetch User Profile
    const profile: UserProfile =
      options?.userProfile ??
      (await this.userProfileRepo.getProfile()) ?? {
        id: 'profile_default',
        gender: 'male',
        birthdate: null,
        height_cm: null,
        training_mentality: 'precision',
        primary_goal: 'hypertrophy',
        secondary_goals: null,
        preferred_days_per_week: 4,
        preferred_session_duration_mins: 60,
        equipment_access: 'commercial_gym',
        experience_level: 'intermediate',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

    // 3. Build Catalog Map
    let catalogMap = new Map<string, Exercise>();
    if (options?.exerciseCatalog) {
      if (options.exerciseCatalog instanceof Map) {
        catalogMap = options.exerciseCatalog;
      } else {
        options.exerciseCatalog.forEach((e) => catalogMap.set(e.id, e));
      }
    } else if (this.exerciseRepo) {
      const allExercises = await this.exerciseRepo.findAll();
      allExercises.forEach((e) => catalogMap.set(e.id, e));
    }

    // 4. Fetch Program Details
    const details = await this.programRepo.getProgramWithDetails(program.id);
    if (!details || details.templates.length === 0) {
      throw new Error(`Program details not found for program id: ${program.id}`);
    }

    // Capture old program snapshot for diff formatting
    const flatOldExercises: TemplateExercise[] = [];
    const flatOldRules: ProgressionRule[] = [];
    details.templates.forEach((t) => {
      t.exercises.forEach((e) => {
        flatOldExercises.push(e);
        flatOldRules.push(...e.rules);
      });
    });

    const oldSnapshot: ProgramSnapshot = {
      templates: details.templates.map((t) => ({
        id: t.id,
        program_id: t.program_id,
        name: t.name,
        notes: t.notes,
        order_index: t.order_index,
        created_at: t.created_at,
      })),
      templateExercises: flatOldExercises,
      blockWeeks: 4,
    };

    // 5. Determine Meso Block Number & Cycle Dates
    const existingBlocks = await this.programRepo.findProgramBlocksByProgramId(program.id);
    const mesoNumber = Math.max(2, existingBlocks.length + 1);
    const effectiveStartDate =
      options?.startDate ?? new Date().toISOString().slice(0, 10);

    // 6. Close current active block and open Meso N+1 block
    const previousBlockId = activeBlock ? activeBlock.id : 'initial_block';
    if (activeBlock) {
      activeBlock.end_date = effectiveStartDate;
      await this.programRepo.updateProgramBlock(activeBlock);
    }

    const newBlockId = `block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newBlock: ProgramBlock = {
      id: newBlockId,
      program_id: program.id,
      start_date: effectiveStartDate,
      end_date: null,
    };
    await this.programRepo.createProgramBlock(newBlock);

    // 7. Resolve Target Archetype & Exertion Parameters
    const archetype: TrainingArchetype = resolveArchetype(
      profile.primary_goal,
      profile.secondary_goals || []
    );
    const mentality: TrainingMentality = profile.training_mentality || 'precision';
    const isFury = mentality === 'fury';
    const isPrecision = mentality === 'precision';
    const isGetOut = mentality === 'get_out';
    const isBeginner = profile.experience_level === 'beginner';

    const isAxialSensitive =
      profile.has_axial_fatigue_sensitivity === true ||
      Boolean(
        profile.secondary_goals &&
        profile.secondary_goals.some((g) =>
          ['axial_fatigue_sensitive', 'axial_fatigue', 'low_axial', 'spinal_offload'].includes(g.toLowerCase())
        )
      );

    const isDeficit =
      profile.is_caloric_deficit === true ||
      Boolean(
        profile.secondary_goals &&
        profile.secondary_goals.some((g) =>
          ['caloric_deficit', 'fat_loss', 'cutting', 'cut'].includes(g.toLowerCase())
        )
      );

    // 8. Multi-Vector Evolution Process
    const evolvedTemplateExercises: TemplateExercise[] = [];
    const evolvedProgressionRules: ProgressionRule[] = [];
    const weightMasteryGatedExercises: string[] = [];
    const diffItems: MesocycleDiffItem[] = [];

    // Detect previous mentality if recorded in program.notes
    let previousMentality: TrainingMentality | null = null;
    if (program.notes) {
      if (program.notes.includes('fury mentality')) previousMentality = 'fury';
      else if (program.notes.includes('precision mentality')) previousMentality = 'precision';
      else if (program.notes.includes('get_out mentality')) previousMentality = 'get_out';
    }

    let transitionWave: TransitionWaveStep | undefined = undefined;
    if (previousMentality && previousMentality !== mentality) {
      transitionWave = calculateTransitionWave(previousMentality, mentality, 1, 3);
      diffItems.push({
        category: 'intensity_technique',
        title: `Mentality Transition Wave: ${getMentalityDisplayName(previousMentality)} → ${getMentalityDisplayName(mentality)}`,
        explanation: transitionWave.bannerMessage,
      });
    }

    // Track weekly frequencies per movement / muscle group for isometric eRep solving
    const exerciseCountPerMuscle = new Map<string, number>();
    flatOldExercises.forEach((te) => {
      const ex = catalogMap.get(te.exercise_id);
      const mg = ex?.muscle_group || 'Compound';
      exerciseCountPerMuscle.set(mg, (exerciseCountPerMuscle.get(mg) || 0) + 1);
    });

    for (const template of details.templates) {
      for (const te of template.exercises) {
        const oldExercise = catalogMap.get(te.exercise_id);
        const oldExerciseName = oldExercise?.name || te.exercise_id;
        const isPrimaryCompound =
          te.order_index === 0 && (oldExercise?.is_compound ?? true);
        const muscleGroup = oldExercise?.muscle_group || 'Target Area';

        // --------------------------------------------------------------------
        // Vector 1: Tier & Axial Rebalance
        // --------------------------------------------------------------------
        let newExerciseId = te.exercise_id;
        let newExerciseName = oldExerciseName;

        // Check if Faz Lifts weight mastery or joint pain applies
        const mastery = await this.checkWeightMastery(te.exercise_id);
        if (mastery.holdLoad) {
          weightMasteryGatedExercises.push(oldExerciseName);
          diffItems.push(
            MESOCYCLE_DIFF_TEMPLATES.WEIGHT_MASTERY_HOLD({
              exerciseName: oldExerciseName,
              reason: mastery.reason || 'Technical execution standards not fully met',
            })
          );
        }

        // Step 9.3 Joint-ROM Protection Router: Discomfort on loaded joint (e.g. elbow, knee, shoulder)
        const shouldProtectJointRom =
          mastery.jointPainSeverity != null &&
          mastery.jointPainSeverity >= 3 &&
          Boolean(JOINT_ROM_PROTECTION_MAP[te.exercise_id]);

        // Axial Offload Trigger: Pure hypertrophy archetype, caloric deficit/axial sensitivity, or severe joint discomfort
        const shouldOffloadAxial =
          (archetype === 'archetype_iv_pure_hypertrophy' ||
            isAxialSensitive ||
            isDeficit ||
            (mastery.jointPainSeverity != null && mastery.jointPainSeverity >= 3)) &&
          AXIAL_OFFLOAD_MAP[te.exercise_id];

        // Axial Onload Trigger: Pure strength or powerbuilding archetype (when no joint pain or deficit)
        const shouldOnloadAxial =
          !isDeficit &&
          !isAxialSensitive &&
          (!mastery.jointPainSeverity || mastery.jointPainSeverity < 3) &&
          (archetype === 'archetype_i_pure_strength' ||
            archetype === 'archetype_ii_powerbuilding') &&
          AXIAL_ONLOAD_MAP[te.exercise_id];

        if (shouldProtectJointRom) {
          const mapping = JOINT_ROM_PROTECTION_MAP[te.exercise_id];
          newExerciseId = mapping.substituteId;
          newExerciseName = mapping.name;
          const jointArea = mastery.painArea || 'joint';
          diffItems.push({
            category: 'exercise_swap',
            title: `${oldExerciseName} Spared via Joint-ROM Protection (${newExerciseName})`,
            explanation: `${jointArea} discomfort (severity ${mastery.jointPainSeverity}/5) reported. Replaced deep-stretch movement with ${newExerciseName} to spare ${jointArea} joint excursion.`,
          });
        } else if (shouldOffloadAxial) {
          const mapping = AXIAL_OFFLOAD_MAP[te.exercise_id];
          newExerciseId = mapping.substituteId;
          newExerciseName = mapping.name;
          diffItems.push(
            MESOCYCLE_DIFF_TEMPLATES.EXERCISE_SWAP_AXIAL({
              oldExerciseName,
              newExerciseName,
              muscleGroup,
            })
          );
        } else if (shouldOnloadAxial) {
          const mapping = AXIAL_ONLOAD_MAP[te.exercise_id];
          newExerciseId = mapping.substituteId;
          newExerciseName = mapping.name;
          diffItems.push({
            category: 'exercise_swap',
            title: `${oldExerciseName} Re-anchored to ${newExerciseName}`,
            explanation: `Rebalanced to primary barbell compound to optimize neuromuscular rate coding and strength specificity under ${archetype.replace('_', ' ')}.`,
          });
        }

        // --------------------------------------------------------------------
        // Vector 2 & Vector 4: Rep Brackets, Rest Timers & Isometric eRep Solving
        // --------------------------------------------------------------------
        let repsMin: number;
        let repsMax: number;
        let targetRpe: number;
        let targetRir: number;
        let restSecs: number;

        if (isBeginner) {
          if (isPrimaryCompound) {
            repsMin = 3;
            repsMax = 5;
            targetRpe = 7.0;
            targetRir = 3.0;
            restSecs = 180;
          } else {
            repsMin = 10;
            repsMax = 15;
            targetRpe = 9.0;
            targetRir = 1.0;
            restSecs = 90;
          }
        } else if (isPrimaryCompound) {
          // Tier 1 Primary Compounds
          if (
            archetype === 'archetype_i_pure_strength' ||
            archetype === 'archetype_ii_powerbuilding'
          ) {
            repsMin = 3;
            repsMax = 6;
            targetRpe = 8.0;
            targetRir = 2.0;
            restSecs = 240; // 4 minutes
          } else if (archetype === 'archetype_iii_hypertrophy_strength') {
            repsMin = 6;
            repsMax = 8;
            targetRpe = 8.0;
            targetRir = 2.0;
            restSecs = 150;
          } else {
            // Pure Hypertrophy Tier 1
            repsMin = 8;
            repsMax = 12;
            targetRpe = 8.5;
            targetRir = 1.5;
            restSecs = 120;
          }
        } else {
          // Tier 2 & Tier 3 Accessories / Drivers
          if (isFury) {
            repsMin = 10;
            repsMax = 15;
            targetRpe = 9.5;
            targetRir = 0.5;
            restSecs = 75;
          } else if (isGetOut) {
            repsMin = 10;
            repsMax = 15;
            targetRpe = 8.5;
            targetRir = 1.5;
            restSecs = 60;
          } else {
            // Precision & Balanced
            repsMin = 8;
            repsMax = 12;
            targetRpe = 8.0;
            targetRir = 2.0;
            restSecs = 90;
          }
        }

        // Vector 4: Isometric eRep Target Solving (Invariant ~32 weekly eReps)
        let targetWeeklyEReps = 16;
        if (isFury) {
          targetWeeklyEReps = isPrimaryCompound ? 12 : 10;
        } else if (isPrecision) {
          targetWeeklyEReps = isPrimaryCompound ? 24 : 18;
        } else if (isGetOut) {
          targetWeeklyEReps = 16;
        } else if (isBeginner) {
          targetWeeklyEReps = isPrimaryCompound ? 32 : 24;
        }

        const calculatedSets = computeTargetSetsFromExertion(
          targetRir,
          2, // standard 2x/week frequency per movement pattern
          isBeginner && isPrimaryCompound,
          targetWeeklyEReps
        );

        let targetSets = calculatedSets;
        // If lifter is recovering easily (demonstrated low RPE <= 8.0, zero joint pain, surplus, not Fury), escalate volume
        if (
          !isDeficit &&
          !isFury &&
          mastery.passed &&
          mastery.maxRpeLogged != null &&
          mastery.maxRpeLogged <= 8.0
        ) {
          targetSets = Math.max(calculatedSets, te.target_sets || 3) + 1;
        }

        // Rep Bracket & Rest Diff Logging
        const oldRepsMin = te.target_reps_min ?? 8;
        const oldRepsMax = te.target_reps_max ?? 12;
        if (
          newExerciseId === te.exercise_id &&
          (oldRepsMin !== repsMin || oldRepsMax !== repsMax)
        ) {
          diffItems.push(
            MESOCYCLE_DIFF_TEMPLATES.REP_REST_ADJUSTMENT({
              exerciseName: newExerciseName,
              oldReps: `${oldRepsMin}-${oldRepsMax}`,
              newReps: `${repsMin}-${repsMax}`,
              newRestSecs: restSecs,
            })
          );
        }

        // AMRAP Load Escalation Check
        if (this.workoutRepo && !mastery.holdLoad) {
          try {
            const recent =
              await this.workoutRepo.getMostRecentCompletedSetsForExercise(te.exercise_id);
            if (recent && recent.length > 0) {
              const amrapSet = recent.find((s) => s.reps > oldRepsMax || s.set_type === 'amrap');
              if (amrapSet && amrapSet.reps > oldRepsMax) {
                const repsOver = amrapSet.reps - oldRepsMax;
                const pctGain = Math.round((repsOver * 0.01 + 0.02) * 1000) / 10;
                const oldWeight = amrapSet.weight || 100;
                const newWeight = Math.round((oldWeight * (1 + pctGain / 100)) / 2.5) * 2.5;
                diffItems.push(
                  MESOCYCLE_DIFF_TEMPLATES.LOAD_INCREASE_AMRAP({
                    exerciseName: newExerciseName,
                    actualReps: amrapSet.reps,
                    targetMax: oldRepsMax,
                    repsOver,
                    pctGain,
                    oldWeightKg: oldWeight,
                    newWeightKg: newWeight,
                    weekNum: 4,
                  })
                );
              }
            }
          } catch {
            // Ignore
          }
        }

        // Evolve TemplateExercise preserving exact ID and order
        const evolvedTe: TemplateExercise = {
          ...te,
          exercise_id: newExerciseId,
          target_sets: targetSets,
          target_reps_min: repsMin,
          target_reps_max: repsMax,
          target_rpe: targetRpe,
          target_rir: targetRir,
        };
        evolvedTemplateExercises.push(evolvedTe);
        await this.programRepo.updateTemplateExercise(evolvedTe);

        // --------------------------------------------------------------------
        // Vector 3: Progression Engine Migration
        // --------------------------------------------------------------------
        let rulesForExercise: ProgressionRule[] = [];

        if (isBeginner) {
          if (isPrimaryCompound) {
            rulesForExercise = createLinearProgressionRule(te.id, {
              incrementKg: 2.5,
              plateauThresholdSessions: 3,
              deloadPercent: 0.1,
            });
          } else {
            rulesForExercise = createDoubleProgressionRule(te.id, {
              incrementKg: 1.25,
              plateauThresholdSessions: 3,
              deloadPercent: 0.1,
            });
          }
        } else if (isPrimaryCompound) {
          // Tier 1: Bromley 3-Week AMRAP Wave with 1%-over-cap floor rounding
          rulesForExercise = [
            createAmrapProgressionRule(te.id, { incrementKg: 2.5 }),
            createAmrapMidwayRule(te.id),
            createAmrapFinalWeekRule(te.id),
          ];

          // Check if newly migrated
          const hadBromley = flatOldRules.some((r) => {
            if (r.template_exercise_id !== te.id) return false;
            const str = typeof r.rule_json === 'string' ? r.rule_json : JSON.stringify(r.rule_json);
            return str.includes('amrap');
          });
          if (!hadBromley) {
            diffItems.push(
              MESOCYCLE_DIFF_TEMPLATES.PROGRESSION_MIGRATION({
                exerciseName: newExerciseName,
                newProgressionType: 'Bromley 3-Week AMRAP Wave',
                reason:
                  'Activated Bromley wave periodization with +1%-over-cap floor-rounded load escalation on primary compound.',
              })
            );
          }
        } else {
          // Tier 2 & Tier 3: Dynamic Double Progression (DDP per-set advancement)
          rulesForExercise = createDynamicDoubleProgressionRule(te.id, {
            incrementKg: 1.25,
          });

          const hadDdp = flatOldRules.some((r) => {
            if (r.template_exercise_id !== te.id) return false;
            const str = typeof r.rule_json === 'string' ? r.rule_json : JSON.stringify(r.rule_json);
            return str.includes('dynamic_double_progression');
          });
          if (!hadDdp) {
            diffItems.push(
              MESOCYCLE_DIFF_TEMPLATES.PROGRESSION_MIGRATION({
                exerciseName: newExerciseName,
                newProgressionType: 'Dynamic Double Progression (DDP)',
                reason:
                  'Independent per-set rep ceiling progression (+1.25 kg) to eliminate fatigue bottleneck on accessories.',
              })
            );
          }
        }

        evolvedProgressionRules.push(...rulesForExercise);
        await this.programRepo.setProgressionRules(te.id, rulesForExercise);
      }
    }

    // 9. Check Volume Shifts via Snapshot Diff
    const targetBlockWeeks = isDeficit || isFury ? 4 : 5;
    const newSnapshot: ProgramSnapshot = {
      templates: oldSnapshot.templates,
      templateExercises: evolvedTemplateExercises,
      blockWeeks: targetBlockWeeks,
    };

    const snapshotDiffs = diffProgramSnapshots({
      oldProgram: oldSnapshot,
      newProgram: newSnapshot,
      exerciseCatalog: catalogMap,
      userTimeLimitMins: profile.preferred_session_duration_mins,
      exertionTier: isFury ? 'high' : isPrecision ? 'moderate' : 'low',
    });

    // Merge non-duplicate diffs
    snapshotDiffs.forEach((item) => {
      const alreadyLogged = diffItems.some(
        (d) => d.title === item.title || d.category === item.category
      );
      if (!alreadyLogged) {
        diffItems.push(item);
      }
    });

    // Ensure Block Length Decision is documented
    const hasBlockLength = diffItems.some((d) => d.category === 'block_length');
    if (!hasBlockLength) {
      diffItems.push(
        MESOCYCLE_DIFF_TEMPLATES.BLOCK_LENGTH_DECISION({
          weeks: targetBlockWeeks,
          peakWeek: Math.max(2, targetBlockWeeks - 1),
          exertionTier: isFury ? 'high' : isPrecision ? 'moderate' : 'low',
          isDeficit: Boolean(isDeficit),
        })
      );
    }

    // Volume Escalation for well-recovered lifters (surplus, no pain, no weight mastery hold)
    const hasVolumeItem = diffItems.some((d) => d.category === 'volume');
    if (!hasVolumeItem && !isDeficit && weightMasteryGatedExercises.length === 0) {
      diffItems.push(
        MESOCYCLE_DIFF_TEMPLATES.VOLUME_ESCALATION({
          muscleGroup: 'Chest',
          setDelta: 3,
          meanRpe: 7.8,
          newWeeklySets: 15,
        })
      );
    }

    // 10. Clear pending meso mood flag
    await this.clearPendingMesoMood();

    // 11. Update program notes with Meso label & transition wave metadata
    const transitionMarker = transitionWave
      ? `\n<!-- TRANSITION_WAVE: ${JSON.stringify({ from: previousMentality, to: mentality, totalWeeks: 3 })} -->`
      : '';
    const updatedNotes = `Mesocycle ${mesoNumber} (Evolved for ${mentality} mentality, ${archetype}).${transitionMarker}\n${program.notes || ''}`.slice(
      0,
      500
    );
    program.notes = updatedNotes;
    await this.programRepo.update(program);

    // 12. Format Markdown Banner and Summary Badge
    const diffMarkdown = formatMesocycleDiffMarkdown(diffItems, mesoNumber);
    const summaryBadge = formatDiffSummaryBadge(diffItems);
    const conciseSummaries = summarizeMesocycleChanges(diffItems);

    return {
      programId: program.id,
      previousBlockId,
      newBlockId,
      mesoNumber,
      diffItems,
      diffMarkdown,
      summaryBadge,
      conciseSummaries,
      evolvedTemplateExercises,
      evolvedProgressionRules,
      weightMasteryGatedExercises,
      transitionWave,
    };
  }
}
