/**
 * Workout Suite — Workload Analysis Service
 *
 * Implements Weekly Workload, Volume Landmarks, Daily Tonnage Distribution,
 * and Dual-Faceted Intensity Analysis (Effort-based RPE proximity to failure
 * and relative load-based % of 1RM).
 */

import { IWorkoutRepository } from '../domain/repositories/IWorkoutRepository';
import { IExerciseRepository } from '../domain/repositories/IExerciseRepository';
import { Exercise, MuscleGroup, Workout, WorkoutSet } from '../core/types';
import { calculateHeuristic1RM } from '../core/math/heuristic1rm';
import {
  calculateHypertrophicEffectiveReps,
  classifyEffectiveRepsTier,
} from '../core/math/effectiveReps';

export type VolumeLandmarkTier = 'low' | 'optimal' | 'high' | 'peak';

export interface MuscleGroupVolumeReport {
  muscleGroup: MuscleGroup | string;
  workingSets: number;
  effectiveReps: number;
  effectiveRepsTier: VolumeLandmarkTier;
  totalTonnageKg: number;
  tier: VolumeLandmarkTier;
  targetMinSets: number;
  targetMaxSets: number;
  targetMinEffectiveReps: number;
  targetMaxEffectiveReps: number;
  ratedSets: number;
  totalSets: number;
}

export interface DailyWorkloadSummary {
  date: string; // YYYY-MM-DD
  dayName: string; // 'Mon', 'Tue', etc.
  hasWorkout: boolean;
  workoutName: string | null;
  workoutId: string | null;
  tonnageKg: number;
  workingSets: number;
  effectiveReps: number;
  avgRpe: number | null;
}

export interface IntensityDistributionBucket {
  label: string;
  count: number;
  percentage: number;
}

export interface IntensityAnalysis {
  avgRpe: number | null;
  highIntensitySetCount: number; // RPE >= 8.0 or RIR <= 2
  highIntensityRatioPercent: number;
  rpeBuckets: IntensityDistributionBucket[];
  avgRelativeIntensityPercent: number | null; // Volume-weighted % of e1RM
  loadZoneBuckets: IntensityDistributionBucket[];
  totalRatedSets: number;
  totalUnratedSets: number;
}

export interface WeeklyWorkloadDeepDive {
  weekStartDate: string; // YYYY-MM-DD (Monday)
  weekEndDate: string; // YYYY-MM-DD (Sunday)
  totalTonnageKg: number;
  totalWorkingSets: number;
  totalEffectiveReps: number;
  totalRatedSets: number;
  totalUnratedSets: number;
  ratingCoveragePercent: number;
  completedWorkoutsCount: number;
  dailyWorkloads: DailyWorkloadSummary[];
  muscleGroupVolumes: MuscleGroupVolumeReport[];
  intensity: IntensityAnalysis;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Resolves Monday to Sunday calendar boundaries for a given week offset.
 * weekOffset = 0 -> current week
 * weekOffset = -1 -> previous week
 */
export function getWeekBoundaries(
  refDate: Date = new Date(),
  weekOffset: number = 0
): { mondayIso: string; sundayIso: string; mondayDate: Date } {
  const d = new Date(refDate);
  d.setDate(d.getDate() + weekOffset * 7);

  const dayOfWeek = (d.getDay() + 6) % 7; // 0 = Mon, 6 = Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - dayOfWeek);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const toIsoDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  return {
    mondayIso: toIsoDateString(monday),
    sundayIso: toIsoDateString(sunday),
    mondayDate: monday,
  };
}

/**
 * Classifies weekly muscle group set volume against hypertrophy landmarks:
 * - Low / Maintenance: < 8 sets
 * - Optimal Growth (MAV): 8 - 18 sets
 * - High Volume: 19 - 24 sets
 * - Peak / Overreaching: > 24 sets
 */
export function classifyVolumeTier(sets: number): {
  tier: VolumeLandmarkTier;
  targetMinSets: number;
  targetMaxSets: number;
} {
  const targetMinSets = 8;
  const targetMaxSets = 18;

  if (sets < 8) return { tier: 'low', targetMinSets, targetMaxSets };
  if (sets <= 18) return { tier: 'optimal', targetMinSets, targetMaxSets };
  if (sets <= 24) return { tier: 'high', targetMinSets, targetMaxSets };
  return { tier: 'peak', targetMinSets, targetMaxSets };
}

/**
 * Canonical synergist / assisting muscle mappings for compound movements.
 * Assisting muscles receive 0.5 set volume credit in weekly hypertrophy landmarks.
 */
export const CANONICAL_ASSISTING_MUSCLES: Record<string, string[]> = {
  // Chest compounds -> Triceps, Shoulders
  barbell_bench_press: ['Triceps', 'Shoulders'],
  barbell_incline_bench_press: ['Triceps', 'Shoulders'],
  dumbbell_bench_press: ['Triceps', 'Shoulders'],
  dumbbell_incline_bench_press: ['Triceps', 'Shoulders'],
  push_up: ['Triceps', 'Shoulders'],
  chest_dip: ['Triceps', 'Shoulders'],
  parallel_bar_dip: ['Triceps', 'Shoulders'],
  machine_chest_press: ['Triceps', 'Shoulders'],

  // Triceps compounds -> Chest, Shoulders
  barbell_close_grip_bench_press: ['Chest', 'Shoulders'],

  // Shoulders compounds -> Triceps, Traps
  barbell_ohp: ['Triceps', 'Traps'],
  dumbbell_shoulder_press: ['Triceps'],
  arnold_press: ['Triceps'],
  machine_shoulder_press: ['Triceps'],

  // Back compounds (horizontal/vertical pulls) -> Biceps, Forearms
  barbell_bent_over_row: ['Biceps', 'Forearms'],
  dumbbell_single_arm_row: ['Biceps', 'Forearms'],
  cable_seated_row: ['Biceps', 'Forearms'],
  cable_lat_pulldown: ['Biceps', 'Forearms'],
  pull_up: ['Biceps', 'Forearms'],
  chin_up: ['Biceps', 'Forearms'],
  t_bar_row: ['Biceps', 'Forearms'],

  // Quads compounds -> Glutes
  barbell_squat: ['Glutes'],
  barbell_front_squat: ['Glutes'],
  leg_press: ['Glutes'],
  hack_squat: ['Glutes'],
  bulgarian_split_squat: ['Glutes'],
  goblet_squat: ['Glutes'],
  walking_lunge: ['Glutes'],

  // Posterior chain & Deadlifts
  barbell_deadlift: ['Glutes', 'Hamstrings', 'Traps', 'Forearms'],
  barbell_sumo_deadlift: ['Quads', 'Glutes', 'Traps', 'Forearms'],
  barbell_romanian_deadlift: ['Glutes', 'Back'],
  dumbbell_romanian_deadlift: ['Glutes', 'Back'],
  good_morning: ['Glutes', 'Back'],
  hip_thrust: ['Hamstrings'],
  glute_bridge: ['Hamstrings'],
};

/**
 * Resolves assisting / secondary muscles for an exercise.
 * Prioritizes the exercise entity's explicit `secondary_muscles` field,
 * falling back to the canonical movement map and standard lift category.
 */
export function resolveAssistingMuscles(exercise: Exercise): (MuscleGroup | string)[] {
  if (exercise.secondary_muscles && exercise.secondary_muscles.length > 0) {
    return exercise.secondary_muscles;
  }

  const byId = CANONICAL_ASSISTING_MUSCLES[exercise.id];
  if (byId) return byId;

  // Standard lift type fallback
  if (exercise.standard_lift_type === 'bench') return ['Triceps', 'Shoulders'];
  if (exercise.standard_lift_type === 'ohp') return ['Triceps', 'Traps'];
  if (exercise.standard_lift_type === 'row') return ['Biceps', 'Forearms'];
  if (exercise.standard_lift_type === 'squat') return ['Glutes'];
  if (exercise.standard_lift_type === 'deadlift') return ['Glutes', 'Hamstrings', 'Traps', 'Forearms'];

  // Compound heuristic fallback based on primary muscle group
  if (exercise.is_compound) {
    const primary = (exercise.muscle_group || '').toLowerCase();
    if (primary === 'chest') return ['Triceps', 'Shoulders'];
    if (primary === 'back') return ['Biceps', 'Forearms'];
    if (primary === 'quads') return ['Glutes'];
    if (primary === 'shoulders') return ['Triceps'];
  }

  return [];
}

/**
 * Computes comprehensive workload, volume landmarks, and dual intensity intelligence.
 */
export async function computeWeeklyWorkloadDeepDive(
  workoutRepo: IWorkoutRepository,
  exerciseRepo: IExerciseRepository,
  options: {
    refDate?: Date;
    weekOffset?: number;
  } = {}
): Promise<WeeklyWorkloadDeepDive> {
  const { refDate = new Date(), weekOffset = 0 } = options;
  const { mondayIso, sundayIso, mondayDate } = getWeekBoundaries(refDate, weekOffset);

  // 1. Fetch workouts and exercises
  const allWorkouts = await workoutRepo.findAll();
  const completedWorkouts = allWorkouts.filter((w) => w.status === 'completed');
  const allExercises = await exerciseRepo.findAll();
  const exerciseMap = new Map<string, Exercise>(allExercises.map((e) => [e.id, e]));

  // 2. Pre-calculate best historical e1RM per exercise across all completed workouts
  // for relative intensity benchmarking
  const bestE1rmMap = new Map<string, number>();
  for (const w of completedWorkouts) {
    const sets = await workoutRepo.getSetsByWorkoutId(w.id);
    for (const s of sets) {
      if (s.weight && s.weight > 0 && s.reps && s.reps > 0) {
        const est = calculateHeuristic1RM(s.weight, s.reps, {
          rpe: s.rpe,
          rir: s.rir,
        });
        const prev = bestE1rmMap.get(s.exercise_id) || 0;
        if (est > prev) {
          bestE1rmMap.set(s.exercise_id, est);
        }
      }
    }
  }

  // 3. Filter workouts in the target week
  const weekWorkouts = completedWorkouts.filter(
    (w) => w.date >= mondayIso && w.date <= sundayIso
  );

  // Map workouts by date
  const workoutsByDate = new Map<string, { workout: Workout; sets: WorkoutSet[] }[]>();
  for (const w of weekWorkouts) {
    const sets = await workoutRepo.getSetsByWorkoutId(w.id);
    const existing = workoutsByDate.get(w.date) || [];
    existing.push({ workout: w, sets });
    workoutsByDate.set(w.date, existing);
  }

  // 4. Generate 7-day daily workload summary (Mon -> Sun)
  const dailyWorkloads: DailyWorkloadSummary[] = [];
  let totalWeekTonnage = 0;
  let totalWeekWorkingSets = 0;

  for (let i = 0; i < 7; i++) {
    const currentDay = new Date(mondayDate);
    currentDay.setDate(mondayDate.getDate() + i);
    const year = currentDay.getFullYear();
    const month = String(currentDay.getMonth() + 1).padStart(2, '0');
    const day = String(currentDay.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const daySessions = workoutsByDate.get(dateStr);

    if (daySessions && daySessions.length > 0) {
      let dayTonnage = 0;
      let dayWorkingSets = 0;
      let dayEffectiveReps = 0;
      let dayRpeSum = 0;
      let dayRpeCount = 0;

      for (const session of daySessions) {
        for (const s of session.sets) {
          if (s.set_type !== 'warmup') {
            dayWorkingSets++;
            if (s.weight != null && s.reps != null) {
              dayTonnage += s.weight * s.reps;
            }
            const bestE1rm = bestE1rmMap.get(s.exercise_id);
            const eRepsRes = calculateHypertrophicEffectiveReps(s.reps, {
              rpe: s.rpe,
              rir: s.rir,
              set_type: s.set_type,
              weightKg: s.weight,
              e1rmKg: bestE1rm,
            });
            dayEffectiveReps += eRepsRes.effectiveReps;
            if (s.rpe != null && s.rpe > 0) {
              dayRpeSum += s.rpe;
              dayRpeCount++;
            }
          }
        }
      }

      totalWeekTonnage += dayTonnage;
      totalWeekWorkingSets += dayWorkingSets;

      dailyWorkloads.push({
        date: dateStr,
        dayName: DAY_NAMES[i],
        hasWorkout: true,
        workoutName: daySessions.map((s) => s.workout.name).join(' & '),
        workoutId: daySessions[0].workout.id,
        tonnageKg: Math.round(dayTonnage),
        workingSets: dayWorkingSets,
        effectiveReps: dayEffectiveReps,
        avgRpe: dayRpeCount > 0 ? Number((dayRpeSum / dayRpeCount).toFixed(1)) : null,
      });
    } else {
      dailyWorkloads.push({
        date: dateStr,
        dayName: DAY_NAMES[i],
        hasWorkout: false,
        workoutName: null,
        workoutId: null,
        tonnageKg: 0,
        workingSets: 0,
        effectiveReps: 0,
        avgRpe: null,
      });
    }
  }

  // 5. Aggregate Muscle Group Volumes (Working Sets, Effective Reps & Tonnage)
  // Primary muscle gets 1.0 volume credit; assisting / secondary muscles get 0.5 volume credit
  const muscleSetCounts = new Map<
    string,
    { sets: number; tonnage: number; effectiveReps: number; ratedSets: number; totalSets: number }
  >();

  let totalWeekEffectiveReps = 0;
  let totalWeekRatedSets = 0;
  let totalWeekUnratedSets = 0;

  for (const sessionGroup of workoutsByDate.values()) {
    for (const session of sessionGroup) {
      for (const s of session.sets) {
        if (s.set_type !== 'warmup') {
          const ex = exerciseMap.get(s.exercise_id);
          const primaryGroup = ex?.muscle_group || 'Other';
          const setTonnage = s.weight != null && s.reps != null ? s.weight * s.reps : 0;
          const bestE1rm = bestE1rmMap.get(s.exercise_id);
          const eRepsRes = calculateHypertrophicEffectiveReps(s.reps, {
            rpe: s.rpe,
            rir: s.rir,
            set_type: s.set_type,
            weightKg: s.weight,
            e1rmKg: bestE1rm,
          });

          totalWeekEffectiveReps += eRepsRes.effectiveReps;
          if (eRepsRes.isRated) {
            totalWeekRatedSets++;
          } else {
            totalWeekUnratedSets++;
          }

          // 1.0 credit to primary muscle group
          const prevPrimary = muscleSetCounts.get(primaryGroup) || {
            sets: 0,
            tonnage: 0,
            effectiveReps: 0,
            ratedSets: 0,
            totalSets: 0,
          };
          prevPrimary.sets += 1;
          prevPrimary.tonnage += setTonnage;
          prevPrimary.effectiveReps += eRepsRes.effectiveReps;
          prevPrimary.totalSets += 1;
          if (eRepsRes.isRated) {
            prevPrimary.ratedSets += 1;
          }
          muscleSetCounts.set(primaryGroup, prevPrimary);

          // 0.5 credit to assisting / secondary muscle groups
          if (ex) {
            const assisting = resolveAssistingMuscles(ex);
            for (const sec of assisting) {
              if (sec && sec.toLowerCase() !== primaryGroup.toLowerCase()) {
                const prevSec = muscleSetCounts.get(sec) || {
                  sets: 0,
                  tonnage: 0,
                  effectiveReps: 0,
                  ratedSets: 0,
                  totalSets: 0,
                };
                prevSec.sets += 0.5;
                prevSec.tonnage += Math.round(setTonnage * 0.5);
                prevSec.effectiveReps += Math.round(eRepsRes.effectiveReps * 0.5 * 10) / 10;
                prevSec.totalSets += 0.5;
                if (eRepsRes.isRated) {
                  prevSec.ratedSets += 0.5;
                }
                muscleSetCounts.set(sec, prevSec);
              }
            }
          }
        }
      }
    }
  }

  const ratingCoveragePercent =
    totalWeekWorkingSets > 0
      ? Math.round((totalWeekRatedSets / totalWeekWorkingSets) * 100)
      : 100;

  const muscleGroupVolumes: MuscleGroupVolumeReport[] = Array.from(
    muscleSetCounts.entries()
  )
    .map(([group, data]) => {
      const setsLandmark = classifyVolumeTier(data.sets);
      const eRepsLandmark = classifyEffectiveRepsTier(data.effectiveReps);
      return {
        muscleGroup: group,
        workingSets: data.sets,
        effectiveReps: Math.round(data.effectiveReps * 10) / 10,
        effectiveRepsTier: eRepsLandmark.tier,
        totalTonnageKg: Math.round(data.tonnage),
        tier: setsLandmark.tier,
        targetMinSets: setsLandmark.targetMinSets,
        targetMaxSets: setsLandmark.targetMaxSets,
        targetMinEffectiveReps: eRepsLandmark.targetMinReps,
        targetMaxEffectiveReps: eRepsLandmark.targetMaxReps,
        ratedSets: Math.round(data.ratedSets * 10) / 10,
        totalSets: Math.round(data.totalSets * 10) / 10,
      };
    })
    .sort(
      (a, b) =>
        b.effectiveReps - a.effectiveReps ||
        b.workingSets - a.workingSets ||
        a.muscleGroup.localeCompare(b.muscleGroup)
    );

  // 6. Dual Intensity Analysis
  // 6A. Effort Intensity (RPE & Proximity to Failure)
  let totalRpeSum = 0;
  let totalRpeSets = 0;
  let totalUnratedSets = 0;
  let highIntensitySets = 0; // RPE >= 8.0 or RIR <= 2

  let rpeSubmaximal = 0; // < 7.0
  let rpeModerate = 0; // 7.0 - 7.5
  let rpeHard = 0; // 8.0 - 8.5
  let rpeMaximal = 0; // 9.0 - 10.0

  // 6B. Relative Load Intensity (% 1RM)
  let weightedRelIntensitySum = 0;
  let totalRelIntensityTonnage = 0;
  let zoneHeavy = 0; // > 85%
  let zoneModerate = 0; // 70% - 85%
  let zoneLight = 0; // < 70%
  let totalRelSetsCount = 0;

  for (const sessionGroup of workoutsByDate.values()) {
    for (const session of sessionGroup) {
      for (const s of session.sets) {
        if (s.set_type !== 'warmup') {
          // Effort (RPE)
          const effRpe = s.rpe != null ? s.rpe : s.rir != null ? 10 - s.rir : null;
          if (effRpe != null && effRpe > 0) {
            totalRpeSum += effRpe;
            totalRpeSets++;
            if (effRpe >= 8.0) {
              highIntensitySets++;
            }
            if (effRpe < 7.0) rpeSubmaximal++;
            else if (effRpe <= 7.5) rpeModerate++;
            else if (effRpe <= 8.5) rpeHard++;
            else rpeMaximal++;
          } else {
            totalUnratedSets++;
          }

          // Relative Intensity (% 1RM)
          const bestE1rm = bestE1rmMap.get(s.exercise_id);
          if (bestE1rm && bestE1rm > 0 && s.weight && s.weight > 0 && s.reps && s.reps > 0) {
            const relIntensityFraction = Math.min(1.2, s.weight / bestE1rm);
            const setTonnage = s.weight * s.reps;
            weightedRelIntensitySum += setTonnage * relIntensityFraction;
            totalRelIntensityTonnage += setTonnage;
            totalRelSetsCount++;

            if (relIntensityFraction > 0.85) zoneHeavy++;
            else if (relIntensityFraction >= 0.70) zoneModerate++;
            else zoneLight++;
          }
        }
      }
    }
  }

  const avgRpe =
    totalRpeSets > 0 ? Number((totalRpeSum / totalRpeSets).toFixed(1)) : null;
  const highIntensityRatioPercent =
    totalRpeSets > 0 ? Math.round((highIntensitySets / totalRpeSets) * 100) : 0;

  const totalEffortSets = totalRpeSets + totalUnratedSets;
  const toBucketPercent = (count: number, total: number) =>
    total > 0 ? Math.round((count / total) * 100) : 0;

  const rpeBuckets: IntensityDistributionBucket[] = [
    {
      label: '< 7.0 (Submaximal)',
      count: rpeSubmaximal,
      percentage: toBucketPercent(rpeSubmaximal, totalEffortSets),
    },
    {
      label: '7.0–7.5 (Moderate)',
      count: rpeModerate,
      percentage: toBucketPercent(rpeModerate, totalEffortSets),
    },
    {
      label: '8.0–8.5 (Stimulating)',
      count: rpeHard,
      percentage: toBucketPercent(rpeHard, totalEffortSets),
    },
    {
      label: '9.0–10.0 (Maximal)',
      count: rpeMaximal,
      percentage: toBucketPercent(rpeMaximal, totalEffortSets),
    },
    {
      label: 'Unrated (No RPE)',
      count: totalUnratedSets,
      percentage: toBucketPercent(totalUnratedSets, totalEffortSets),
    },
  ];

  const avgRelativeIntensityPercent =
    totalRelIntensityTonnage > 0
      ? Number(((weightedRelIntensitySum / totalRelIntensityTonnage) * 100).toFixed(1))
      : null;

  const loadZoneBuckets: IntensityDistributionBucket[] = [
    {
      label: 'Heavy (> 85% 1RM)',
      count: zoneHeavy,
      percentage: toBucketPercent(zoneHeavy, totalRelSetsCount),
    },
    {
      label: 'Moderate (70–85% 1RM)',
      count: zoneModerate,
      percentage: toBucketPercent(zoneModerate, totalRelSetsCount),
    },
    {
      label: 'Light (< 70% 1RM)',
      count: zoneLight,
      percentage: toBucketPercent(zoneLight, totalRelSetsCount),
    },
  ];

  return {
    weekStartDate: mondayIso,
    weekEndDate: sundayIso,
    totalTonnageKg: Math.round(totalWeekTonnage),
    totalWorkingSets: totalWeekWorkingSets,
    totalEffectiveReps: Math.round(totalWeekEffectiveReps * 10) / 10,
    totalRatedSets: totalWeekRatedSets,
    totalUnratedSets: totalWeekUnratedSets,
    ratingCoveragePercent,
    completedWorkoutsCount: weekWorkouts.length,
    dailyWorkloads,
    muscleGroupVolumes,
    intensity: {
      avgRpe,
      highIntensitySetCount: highIntensitySets,
      highIntensityRatioPercent,
      rpeBuckets,
      avgRelativeIntensityPercent,
      loadZoneBuckets,
      totalRatedSets: totalRpeSets,
      totalUnratedSets,
    },
  };
}
