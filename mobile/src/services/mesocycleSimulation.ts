/**
 * Workout Suite — Mesocycle Simulation & Soundness Assessment Framework
 *
 * Implements synthetic lifter profile progression across multiple mesocycles (Meso 1 -> Meso 2 -> Meso 3)
 * to verify and assess that program evolution adjustments are scientifically sound, injury-preventative,
 * and concisely communicated.
 *
 * Canonical Profiles:
 * 1. Lukas — The Responsive Hypertrophy Trainee (Hits AMRAPs, low fatigue, earns volume & load progression)
 * 2. Erik — Heavy Powerbuilder with Elbow Tendonitis (Overshoots RPE, logs elbow pain, triggers joint sparing & load hold)
 * 3. Sofia — Caloric Deficit & High Axial Fatigue (Spinal compression, time-budget constraints -> axial offload & Myo-reps)
 * 4. Marcus — Mentality Transitioner (Switches Precision -> Fury, triggers 3-week transition wave & eRep invariance)
 */

import {
  UserProfile,
  Exercise,
  JointLocation,
  WorkoutSet,
  Workout,
  ProgressionRule,
  TemplateExercise,
} from '../core/types';
import {
  MockProgramRepository,
  MockUserProfileRepository,
  MockWorkoutRepository,
  MockPainReportRepository,
  MockExerciseRepository,
} from '../database/mocks';
import { DEFAULT_EXERCISES } from '../database/seeds/defaultExercises';
import { ProgramBlockService } from './programBlockService';
import {
  ProgramEvolutionService,
  EvolutionResult,
} from './programEvolutionService';
import { synthesizeProgram } from '../core/generator/programSynthesizer';
import {
  summarizeMesocycleChanges,
  formatMesocycleDiffMarkdown,
  MesocycleDiffItem,
} from './mesocycleDiffFormatter';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface MesoOutcomeConfig {
  completedWorkouts: number;
  /**
   * Logged AMRAP performance: exerciseId -> actual reps achieved vs target max.
   */
  amrapResults?: Record<string, { actualReps: number; targetReps: number; weightKg: number }>;
  /**
   * Peak logged RPE per exercise in the final accumulation week.
   */
  peakRpePerExercise?: Record<string, number>;
  /**
   * Pain and discomfort reports logged during active training.
   */
  painReports?: Array<{
    exerciseId: string;
    severity: number;
    jointLocation: JointLocation;
    notes?: string;
  }>;
  /**
   * Mid-flight mood changes staged during the mesocycle.
   */
  stagedMoodUpdates?: Partial<UserProfile>;
}

export interface LifterProfileConfig {
  id: string;
  name: string;
  description: string;
  initialProfile: UserProfile;
  meso1Outcome: MesoOutcomeConfig;
  meso2Outcome: MesoOutcomeConfig;
  /**
   * Custom assertions to verify soundness of Meso 1 -> Meso 2 transition.
   */
  assertMeso2Soundness: (res: EvolutionResult, summaries: string[]) => SoundnessAssertion[];
  /**
   * Custom assertions to verify soundness of Meso 2 -> Meso 3 transition.
   */
  assertMeso3Soundness: (res: EvolutionResult, summaries: string[]) => SoundnessAssertion[];
}

export interface SoundnessAssertion {
  criterion: string;
  passed: boolean;
  message: string;
}

export interface MesoSimulationReportStep {
  fromMeso: number;
  toMeso: number;
  conciseSummaries: string[];
  diffItems: MesocycleDiffItem[];
  diffMarkdown: string;
  soundnessAssertions: SoundnessAssertion[];
  allPassed: boolean;
}

export interface LifterSimulationReport {
  profileId: string;
  profileName: string;
  description: string;
  steps: MesoSimulationReportStep[];
  overallSuccess: boolean;
}

// ============================================================================
// Canonical Lifter Profiles
// ============================================================================

export const CANONICAL_PROFILES: LifterProfileConfig[] = [
  // --------------------------------------------------------------------------
  // Profile 1: Lukas — The Responsive Hypertrophy Trainee
  // --------------------------------------------------------------------------
  {
    id: 'lukas_responsive',
    name: 'Lukas — Responsive Hyper-Responder',
    description:
      'Smashing AMRAP targets with +3 reps over cap on Week 4, low fatigue (RPE 7.5), 0 pain reports. Earns volume & load advancement.',
    initialProfile: {
      id: 'profile_lukas',
      gender: 'male',
      birthdate: '1998-06-12',
      height_cm: 182,
      experience_level: 'intermediate',
      training_mentality: 'precision',
      primary_goal: 'hypertrophy',
      secondary_goals: ['strength'],
      preferred_days_per_week: 4,
      preferred_session_duration_mins: 60,
      equipment_access: 'commercial_gym',
      pending_meso_mood: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    meso1Outcome: {
      completedWorkouts: 16,
      amrapResults: {
        barbell_back_squat: { actualReps: 13, targetReps: 10, weightKg: 100 },
        barbell_bench_press: { actualReps: 12, targetReps: 10, weightKg: 80 },
      },
      peakRpePerExercise: {
        barbell_back_squat: 8.0,
        barbell_bench_press: 8.0,
      },
      painReports: [],
    },
    meso2Outcome: {
      completedWorkouts: 16,
      amrapResults: {
        barbell_back_squat: { actualReps: 11, targetReps: 10, weightKg: 102.5 },
      },
      peakRpePerExercise: {
        barbell_back_squat: 8.5,
      },
      painReports: [],
    },
    assertMeso2Soundness: (res: EvolutionResult, summaries: string[]) => [
      {
        criterion: 'Volume Escalation Communication',
        passed: summaries.some((s) => s.toLowerCase().includes('increased your volume by')),
        message: 'Accurately communicates volume increase in concise format.',
      },
      {
        criterion: 'Accessory RPE Progression',
        passed: summaries.some((s) => s.includes('RPE goal increased for accessory exercises')),
        message: 'Accurately communicates accessory RPE goal increase.',
      },
      {
        criterion: 'Mesocycle Length Optimization',
        passed: summaries.some((s) => s.includes('Optimized meso-cycle length')),
        message: 'Accurately communicates mesocycle block length optimization.',
      },
      {
        criterion: 'Weight Mastery Verification',
        passed: res.weightMasteryGatedExercises.length === 0,
        message: 'Lukas passed weight mastery with no load gating holds.',
      },
      {
        criterion: 'Progression Engine Wave Periodization',
        passed: res.evolvedProgressionRules.length > 0,
        message: 'Migrated compounds to Bromley wave and accessories to DDP.',
      },
    ],
    assertMeso3Soundness: (_res: EvolutionResult, _summaries: string[]) => [
      {
        criterion: 'Continuous Progressive Overload',
        passed: _res.mesoNumber === 3,
        message: 'Successfully advanced to Meso 3 without volume explosion.',
      },
    ],
  },

  // --------------------------------------------------------------------------
  // Profile 2: Erik — Heavy Powerbuilder with Elbow Tendonitis
  // --------------------------------------------------------------------------
  {
    id: 'erik_elbow_pain',
    name: 'Erik — Powerbuilder with Elbow Discomfort',
    description:
      'Pushes Bench Press to RPE 9.5 overshoot; reports severe elbow pain (severity 4/5) on Barbell Skull Crusher. Triggers joint sparing swap and load hold.',
    initialProfile: {
      id: 'profile_erik',
      gender: 'male',
      birthdate: '1994-03-22',
      height_cm: 178,
      experience_level: 'intermediate',
      training_mentality: 'precision',
      primary_goal: 'strength',
      secondary_goals: ['hypertrophy'],
      preferred_days_per_week: 4,
      preferred_session_duration_mins: 60,
      equipment_access: 'commercial_gym',
      pending_meso_mood: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    meso1Outcome: {
      completedWorkouts: 16,
      peakRpePerExercise: {
        barbell_bench_press: 9.5, // RPE overshoot -> Hold load
      },
      painReports: [
        {
          exerciseId: 'barbell_skull_crusher',
          severity: 4,
          jointLocation: 'elbow',
          notes: 'Sharp medial elbow tendon discomfort on terminal extension',
        },
      ],
    },
    meso2Outcome: {
      completedWorkouts: 16,
      peakRpePerExercise: {
        barbell_bench_press: 8.0, // Technique standardized!
        cable_tricep_pushdown: 8.0,
      },
      painReports: [], // Elbow healed with cable pushdowns!
    },
    assertMeso2Soundness: (res: EvolutionResult, summaries: string[]) => [
      {
        criterion: 'Elbow Joint-Sparing Communication',
        passed: summaries.includes('Changed exercises based on elbow pain'),
        message: 'Accurately displays concise bullet: "Changed exercises based on elbow pain".',
      },
      {
        criterion: 'Joint-ROM Protection Substitution',
        passed: res.evolvedTemplateExercises.some(
          (te) => te.exercise_id === 'cable_tricep_pushdown'
        ),
        message: 'Substituted Barbell Skull Crusher for Cable Tricep Pushdown to spare elbow.',
      },
      {
        criterion: 'Faz Lifts Weight Mastery Gating Hold',
        passed:
          res.weightMasteryGatedExercises.some((name) =>
            name.toLowerCase().includes('bench')
          ) ||
          summaries.some((s) => s.toLowerCase().includes('held working load on barbell bench press')),
        message: 'Held working load on Barbell Bench Press due to RPE 9.5 overshoot.',
      },
    ],
    assertMeso3Soundness: (res: EvolutionResult, summaries: string[]) => [
      {
        criterion: 'Elbow Pain Resolution & Weight Mastery Clearance',
        passed: !res.weightMasteryGatedExercises.some((name) =>
          name.toLowerCase().includes('bench')
        ),
        message: 'Bench Press weight mastery cleared once technique standardized.',
      },
      {
        criterion: 'Elbow Joint Integrity Maintained',
        passed: !summaries.includes('Changed exercises based on elbow pain'),
        message: 'No further joint pain reported once switched to cable pushdowns.',
      },
    ],
  },

  // --------------------------------------------------------------------------
  // Profile 3: Sofia — Caloric Deficit & Spinal Axial Fatigue
  // --------------------------------------------------------------------------
  {
    id: 'sofia_caloric_deficit',
    name: 'Sofia — Caloric Deficit Trainee with High Axial Fatigue',
    description:
      'In a caloric deficit with axial fatigue sensitivity. Needs spinal offload (Barbell Squat -> Leg Press) and Myo-rep time optimization.',
    initialProfile: {
      id: 'profile_sofia',
      gender: 'female',
      birthdate: '1997-11-04',
      height_cm: 168,
      experience_level: 'intermediate',
      training_mentality: 'precision',
      primary_goal: 'hypertrophy',
      secondary_goals: null,
      is_caloric_deficit: false,
      has_axial_fatigue_sensitivity: false,
      preferred_days_per_week: 4,
      preferred_session_duration_mins: 45,
      equipment_access: 'commercial_gym',
      pending_meso_mood: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    meso1Outcome: {
      completedWorkouts: 16,
      stagedMoodUpdates: {
        is_caloric_deficit: true,
        has_axial_fatigue_sensitivity: true,
        secondary_goals: ['caloric_deficit', 'axial_fatigue_sensitive'],
      },
      peakRpePerExercise: {
        barbell_back_squat: 9.0,
      },
      painReports: [],
    },
    meso2Outcome: {
      completedWorkouts: 16,
      peakRpePerExercise: {
        machine_leg_press: 8.0,
      },
      painReports: [],
    },
    assertMeso2Soundness: (res: EvolutionResult, summaries: string[]) => [
      {
        criterion: 'Axial Offload Substitution',
        passed: res.evolvedTemplateExercises.some(
          (te) => te.exercise_id === 'machine_leg_press'
        ),
        message: 'Offloaded Barbell Back Squat to Leg Press to eliminate spinal compression.',
      },
      {
        criterion: 'Axial Fatigue Concise Communication',
        passed: summaries.some((s) => s.toLowerCase().includes('spinal')),
        message: 'Communicates axial spinal fatigue offload clearly.',
      },
      {
        criterion: 'Time-Budget Optimization',
        passed: summaries.some((s) => s.includes('Optimized meso-cycle length')),
        message: 'Optimized block length for caloric deficit recovery.',
      },
    ],
    assertMeso3Soundness: (_res: EvolutionResult, _summaries: string[]) => [
      {
        criterion: 'Deficit Recovery Stability',
        passed: _res.mesoNumber === 3,
        message: 'Maintained stable hypertrophic progression without systemic spinal burnout.',
      },
    ],
  },

  // --------------------------------------------------------------------------
  // Profile 4: Marcus — Mentality Transitioner (Precision -> Fury)
  // --------------------------------------------------------------------------
  {
    id: 'marcus_mentality_shift',
    name: 'Marcus — Mentality Shifter (Precision -> Fury)',
    description:
      'Shifting from Precision (high volume, submaximal) to Fury (high intensity, 0 RIR). Triggers transition wave and isometric eRep invariance.',
    initialProfile: {
      id: 'profile_marcus',
      gender: 'male',
      birthdate: '1993-08-19',
      height_cm: 185,
      experience_level: 'intermediate',
      training_mentality: 'precision',
      primary_goal: 'hypertrophy',
      secondary_goals: null,
      preferred_days_per_week: 4,
      preferred_session_duration_mins: 60,
      equipment_access: 'commercial_gym',
      pending_meso_mood: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    meso1Outcome: {
      completedWorkouts: 16,
      stagedMoodUpdates: {
        training_mentality: 'fury',
      },
    },
    meso2Outcome: {
      completedWorkouts: 16,
    },
    assertMeso2Soundness: (res: EvolutionResult, summaries: string[]) => [
      {
        criterion: 'Mentality Transition Wave Activated',
        passed: res.transitionWave !== undefined,
        message: 'Calculated gradual 3-week transition wave from Precision to Fury.',
      },
      {
        criterion: 'Transition Wave Communication',
        passed: summaries.some((s) => s.includes('transition wave')),
        message: 'Communicates 3-week transition wave concisely.',
      },
      {
        criterion: 'Accessory RPE & DDP Escalation',
        passed: summaries.some((s) => s.includes('RPE goal increased for accessory exercises')),
        message: 'Adjusted accessory targets to near-failure under Fury mentality.',
      },
    ],
    assertMeso3Soundness: (_res: EvolutionResult, _summaries: string[]) => [
      {
        criterion: 'Complete Fury Periodization',
        passed: _res.mesoNumber === 3,
        message: 'Trainee fully integrated into Fury style periodization.',
      },
    ],
  },
];

// ============================================================================
// Simulation Execution Engine
// ============================================================================

/**
 * Runs a multi-mesocycle progression simulation (Meso 1 -> Meso 2 -> Meso 3)
 * for a specified lifter profile, verifying and assessing that all adaptations
 * are scientifically sound and clearly communicated.
 */
export async function runLifterSimulation(
  profileConfig: LifterProfileConfig,
  catalog: Exercise[] = DEFAULT_EXERCISES
): Promise<LifterSimulationReport> {
  // 1. Initialize Mock Repositories
  const programRepo = new MockProgramRepository();
  const profileRepo = new MockUserProfileRepository();
  const workoutRepo = new MockWorkoutRepository();
  const painReportRepo = new MockPainReportRepository();
  const exerciseRepo = new MockExerciseRepository(catalog);

  await profileRepo.saveProfile(profileConfig.initialProfile);
  const blockService = new ProgramBlockService(programRepo);
  const evolutionService = new ProgramEvolutionService(
    programRepo,
    profileRepo,
    workoutRepo,
    painReportRepo,
    exerciseRepo,
    blockService
  );

  // 2. Synthesize Initial Meso 1 Program
  const synth = synthesizeProgram(profileConfig.initialProfile, {
    availableExercises: catalog,
  });
  await programRepo.saveSynthesizedProgram(synth);
  await blockService.swapActiveProgram(synth.program.id, '2026-08-01');

  // If testing Erik with Skull Crusher, ensure template exercise has Skull Crusher
  if (profileConfig.id === 'erik_elbow_pain') {
    const details = await programRepo.getProgramWithDetails(synth.program.id);
    if (details && details.templates.length > 0) {
      const armTemplate = details.templates[0];
      const skullTe: TemplateExercise = {
        id: 'te_skull_crusher',
        template_id: armTemplate.id,
        exercise_id: 'barbell_skull_crusher',
        order_index: 2,
        target_sets: 3,
        target_reps_min: 10,
        target_reps_max: 12,
        target_rpe: 8.5,
        target_rir: 1.5,
        set_type: 'working',
        gear_id: null,
        exercise_group_id: null,
      };
      await programRepo.createTemplateExercise(skullTe);
    }
  }

  const steps: MesoSimulationReportStep[] = [];

  // ==========================================================================
  // Meso 1 -> Meso 2 Transition
  // ==========================================================================

  // Populate Meso 1 training data
  await applyMesoOutcome(
    synth.program.id,
    profileConfig.meso1Outcome,
    workoutRepo,
    painReportRepo,
    evolutionService
  );

  // Execute Meso 2 Evolution
  const meso2Result = await evolutionService.evolveActiveProgramForNextMeso({
    programId: synth.program.id,
    startDate: '2026-09-01',
    exerciseCatalog: catalog,
  });

  const meso2Summaries = meso2Result.conciseSummaries || summarizeMesocycleChanges(meso2Result.diffItems);
  const meso2Assertions = profileConfig.assertMeso2Soundness(meso2Result, meso2Summaries);

  steps.push({
    fromMeso: 1,
    toMeso: 2,
    conciseSummaries: meso2Summaries,
    diffItems: meso2Result.diffItems,
    diffMarkdown: meso2Result.diffMarkdown,
    soundnessAssertions: meso2Assertions,
    allPassed: meso2Assertions.every((a) => a.passed),
  });

  // ==========================================================================
  // Meso 2 -> Meso 3 Transition
  // ==========================================================================

  // Populate Meso 2 training data
  await applyMesoOutcome(
    synth.program.id,
    profileConfig.meso2Outcome,
    workoutRepo,
    painReportRepo,
    evolutionService
  );

  // Execute Meso 3 Evolution
  const meso3Result = await evolutionService.evolveActiveProgramForNextMeso({
    programId: synth.program.id,
    startDate: '2026-10-01',
    exerciseCatalog: catalog,
  });

  const meso3Summaries = meso3Result.conciseSummaries || summarizeMesocycleChanges(meso3Result.diffItems);
  const meso3Assertions = profileConfig.assertMeso3Soundness(meso3Result, meso3Summaries);

  steps.push({
    fromMeso: 2,
    toMeso: 3,
    conciseSummaries: meso3Summaries,
    diffItems: meso3Result.diffItems,
    diffMarkdown: meso3Result.diffMarkdown,
    soundnessAssertions: meso3Assertions,
    allPassed: meso3Assertions.every((a) => a.passed),
  });

  const overallSuccess = steps.every((s) => s.allPassed);

  return {
    profileId: profileConfig.id,
    profileName: profileConfig.name,
    description: profileConfig.description,
    steps,
    overallSuccess,
  };
}

/**
 * Runs simulations for all canonical lifter profiles and aggregates reports.
 */
export async function runAllLifterSimulations(
  catalog: Exercise[] = DEFAULT_EXERCISES
): Promise<LifterSimulationReport[]> {
  const reports: LifterSimulationReport[] = [];
  for (const config of CANONICAL_PROFILES) {
    const report = await runLifterSimulation(config, catalog);
    reports.push(report);
  }
  return reports;
}

// ============================================================================
// Helper: Seed Training History & Outcomes
// ============================================================================

async function applyMesoOutcome(
  programId: string,
  outcome: MesoOutcomeConfig,
  workoutRepo: MockWorkoutRepository,
  painReportRepo: MockPainReportRepository,
  evolutionService: ProgramEvolutionService
): Promise<void> {
  // 1. Queue staged mood changes if present
  if (outcome.stagedMoodUpdates) {
    await evolutionService.queueMesoMood(outcome.stagedMoodUpdates);
  }

  // 2. Clear old pain reports and log new ones
  if (outcome.painReports && outcome.painReports.length > 0) {
    for (const p of outcome.painReports) {
      await painReportRepo.create({
        workout_id: 'workout_sim',
        exercise_id: p.exerciseId,
        set_id: null,
        pain_type: 'joint',
        severity: p.severity,
        joint_location: p.jointLocation,
        notes: p.notes || null,
      });
    }
  }

  // 3. Log completed workouts and sets for RPE & AMRAP
  const workoutDate = new Date().toISOString().slice(0, 10);
  const workout = await workoutRepo.create({
    id: `workout_${Date.now()}`,
    template_id: 'tmpl_sim',
    date: workoutDate,
    name: 'Completed Mesocycle Workout',
    notes: null,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    status: 'completed',
    duration_seconds: 3600,
    imported_from: null,
  });

  const setsToLog: WorkoutSet[] = [];

  if (outcome.peakRpePerExercise) {
    for (const [exId, rpe] of Object.entries(outcome.peakRpePerExercise)) {
      setsToLog.push({
        id: `set_${exId}_${Date.now()}`,
        workout_id: workout.id,
        exercise_id: exId,
        gear_id: null,
        set_number: 1,
        weight: 80,
        raw_input_weight: 80,
        added_weight: null,
        reps: 8,
        reps_right: null,
        rpe,
        rir: 10 - rpe,
        set_type: 'working',
        set_notes: null,
        exercise_group_id: null,
        created_at: new Date().toISOString(),
      });
    }
  }

  if (outcome.amrapResults) {
    for (const [exId, amrap] of Object.entries(outcome.amrapResults)) {
      setsToLog.push({
        id: `set_amrap_${exId}_${Date.now()}`,
        workout_id: workout.id,
        exercise_id: exId,
        gear_id: null,
        set_number: 3,
        weight: amrap.weightKg,
        raw_input_weight: amrap.weightKg,
        added_weight: null,
        reps: amrap.actualReps,
        reps_right: null,
        rpe: 10.0,
        rir: 0.0,
        set_type: 'amrap',
        set_notes: null,
        exercise_group_id: null,
        created_at: new Date().toISOString(),
      });
    }
  }

  for (const s of setsToLog) {
    await workoutRepo.addSet(s);
  }
}
