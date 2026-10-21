/**
 * Workout Suite — Biomechanical Candidate Exercise Scorer & Joint-ROM Protection Router
 *
 * Implements Step 9.3 of IMPLEMENTATION_PLAN.md:
 * 1. Candidate Exercise Scoring Function:
 *    CandidateScore = BaselineSFR + AffinityBonus - AxialPenalty - PainPenalty - ROMMismatchPenalty
 *    - BaselineSFR in [0, 100] (from exercise.baseline_sfr ?? 50)
 *    - AffinityBonus = affinity_score in [-60, +25]. If affinity_score <= -900 (blacklisted),
 *      candidate is completely excluded (CandidateScore = -Infinity, isExcluded = true).
 *    - AxialPenalty = 30 if axial_loading == 'high' and user profile has axial fatigue sensitivity
 *      or caloric deficit.
 *    - PainPenalty = 60 if exercise loads a joint that had pain reported (severity >= 3)
 *      within the last 28 days.
 * 2. Joint-ROM Protection Router:
 *    - If a lifter reports joint discomfort (severity >= 3) on joint J:
 *      - Penalize exercises loading joint J with rom_tier == 'deep_stretch' by -80 points (ROMMismatchPenalty = 80).
 *      - Elevate exercises with rom_tier == 'shortened_restricted' (+20 bonus, ROMMismatchPenalty = -20).
 *      - Elevate exercises with rom_tier == 'standard_full' (+10 bonus, ROMMismatchPenalty = -10).
 * 3. Regional Muscle Bias Balancer Helper:
 *    - Evaluates complementary regional bodybuilding sub-targets across weekly splits.
 */

import { Exercise, ExercisePreference, JointLocation, RomTier } from '../types';

// ============================================================================
// Biomechanical Joint Resolution Helper
// ============================================================================

/**
 * Maps an exercise to its mechanically loaded joints and articulations.
 * Prioritizes explicit exercise.primary_joints array, falling back to deterministic heuristics.
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
// Candidate Scoring Interfaces
// ============================================================================

export interface ActiveJointDiscomfort {
  joint: JointLocation | string;
  severity: number;
  reportedAt?: string | null;
}

export interface CandidateScoringContext {
  /**
   * Stored exercise preference record for this candidate exercise.
   */
  preference?: ExercisePreference | null;
  /**
   * Explicit flag indicating user has sensitivity to compressive spinal / axial fatigue.
   */
  hasAxialFatigueSensitivity?: boolean;
  /**
   * Explicit flag indicating user is in a caloric deficit / cut.
   */
  isCaloricDeficit?: boolean;
  /**
   * User secondary goals array (e.g. ['caloric_deficit', 'fat_loss', 'axial_fatigue_sensitive']).
   */
  secondaryGoals?: string[] | null;
  /**
   * Single active painful joint shortcut (e.g. from in-session substitution modal).
   */
  painfulJoint?: JointLocation | string | null;
  /**
   * Severity for painfulJoint (1-10 scale). Default: 3.
   */
  painSeverity?: number;
  /**
   * Active joint pain history list (severity >= 3 within 28 days).
   */
  painfulJoints?: ActiveJointDiscomfort[];
}

export interface CandidateScoreResult {
  score: number;
  isExcluded: boolean;
  baselineSfr: number;
  affinityBonus: number;
  axialPenalty: number;
  painPenalty: number;
  romMismatchPenalty: number;
  loadedJoints: JointLocation[];
  hasPainCollision: boolean;
}

// ============================================================================
// Core Candidate Scoring Function
// ============================================================================

const TWENTY_EIGHT_DAYS_MS = 28 * 24 * 60 * 60 * 1000;

/**
 * Computes CandidateScore according to Step 9.3 specification:
 * CandidateScore = BaselineSFR + AffinityBonus - AxialPenalty - PainPenalty - ROMMismatchPenalty
 */
export function computeCandidateScore(
  exercise: Exercise,
  context: CandidateScoringContext = {}
): CandidateScoreResult {
  // 1. Baseline SFR in [0, 100]
  const rawSfr = exercise.baseline_sfr ?? 50;
  const baselineSfr = Math.max(0, Math.min(100, rawSfr));

  // 2. Affinity Bonus & Hard Blacklist Exclusion
  const preference = context.preference;
  const rawAffinity = preference?.affinity_score ?? 0;
  const isBlacklisted = preference?.sentiment === 'blacklisted' || rawAffinity <= -900;

  if (isBlacklisted) {
    return {
      score: -Infinity,
      isExcluded: true,
      baselineSfr,
      affinityBonus: -999,
      axialPenalty: 0,
      painPenalty: 0,
      romMismatchPenalty: 0,
      loadedJoints: resolveExerciseJoints(exercise),
      hasPainCollision: false,
    };
  }

  const affinityBonus = Math.max(-60, Math.min(25, rawAffinity));

  // 3. Axial Penalty (-30 if axial_loading == 'high' and axial fatigue sensitivity or caloric deficit)
  const isAxialSensitive =
    context.hasAxialFatigueSensitivity === true ||
    Boolean(
      context.secondaryGoals &&
      context.secondaryGoals.some((g) => {
        const lower = g.toLowerCase();
        return (
          lower === 'axial_fatigue_sensitive' ||
          lower === 'axial_fatigue' ||
          lower === 'low_axial' ||
          lower === 'spinal_offload'
        );
      })
    );

  const isDeficit =
    context.isCaloricDeficit === true ||
    Boolean(
      context.secondaryGoals &&
      context.secondaryGoals.some((g) => {
        const lower = g.toLowerCase();
        return (
          lower === 'caloric_deficit' ||
          lower === 'fat_loss' ||
          lower === 'cutting' ||
          lower === 'cut'
        );
      })
    );

  const axialPenalty =
    exercise.axial_loading === 'high' && (isAxialSensitive || isDeficit) ? 30 : 0;

  // 4. Mechanically Loaded Joints
  const loadedJointsList = resolveExerciseJoints(exercise);
  const loadedJointsSet = new Set<string>();
  loadedJointsList.forEach((j) => loadedJointsSet.add(j.toLowerCase()));
  if (exercise.secondary_joints) {
    exercise.secondary_joints.forEach((j) => loadedJointsSet.add(j.toLowerCase()));
  }

  // 5. Active Pain Collisions (severity >= 3 within 28 days)
  const activePainJoints: Array<{ joint: string; severity: number }> = [];

  // Direct painfulJoint option
  if (context.painfulJoint && (context.painSeverity ?? 3) >= 3) {
    activePainJoints.push({
      joint: context.painfulJoint.toLowerCase(),
      severity: context.painSeverity ?? 3,
    });
  }

  // List of pain reports
  if (context.painfulJoints) {
    const now = Date.now();
    for (const report of context.painfulJoints) {
      if (report.severity >= 3) {
        if (report.reportedAt) {
          const age = now - new Date(report.reportedAt).getTime();
          if (age <= TWENTY_EIGHT_DAYS_MS) {
            activePainJoints.push({
              joint: report.joint.toLowerCase(),
              severity: report.severity,
            });
          }
        } else {
          activePainJoints.push({
            joint: report.joint.toLowerCase(),
            severity: report.severity,
          });
        }
      }
    }
  }

  // Stored preference pain correlation
  if (
    preference?.pain_joint &&
    (preference.max_pain_severity ?? 0) >= 3
  ) {
    let within28Days = true;
    if (preference.last_pain_reported_at) {
      const age = Date.now() - new Date(preference.last_pain_reported_at).getTime();
      within28Days = age <= TWENTY_EIGHT_DAYS_MS;
    }
    if (within28Days) {
      activePainJoints.push({
        joint: preference.pain_joint.toLowerCase(),
        severity: preference.max_pain_severity ?? 3,
      });
    }
  }

  const matchingPainDiscomfort = activePainJoints.filter((p) =>
    loadedJointsSet.has(p.joint)
  );
  const hasPainCollision = matchingPainDiscomfort.length > 0;
  const painPenalty = hasPainCollision ? 60 : 0;

  // 6. Joint-ROM Protection Router
  // If a lifter reports joint discomfort (severity >= 3) on joint J:
  // - penalize deep_stretch by -80 points (romMismatchPenalty = 80)
  // - elevate shortened_restricted by +20 points (romMismatchPenalty = -20)
  // - elevate standard_full by +10 points (romMismatchPenalty = -10)
  let romMismatchPenalty = 0;
  if (hasPainCollision) {
    const romTier = exercise.rom_tier ?? 'standard_full';
    if (romTier === 'deep_stretch') {
      romMismatchPenalty = 80;
    } else if (romTier === 'shortened_restricted') {
      romMismatchPenalty = -20;
    } else if (romTier === 'standard_full') {
      romMismatchPenalty = -10;
    }
  }

  // 7. Calculate Total Score
  const score =
    baselineSfr + affinityBonus - axialPenalty - painPenalty - romMismatchPenalty;

  return {
    score,
    isExcluded: false,
    baselineSfr,
    affinityBonus,
    axialPenalty,
    painPenalty,
    romMismatchPenalty,
    loadedJoints: loadedJointsList,
    hasPainCollision,
  };
}
