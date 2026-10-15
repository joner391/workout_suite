/**
 * Workout Suite — Dashboard Metrics Service
 *
 * Implements Section 4.1: Weekly Summary Metrics (Workouts this week, Tonnage, Active Streak).
 */

import { IWorkoutRepository } from '../domain/repositories/IWorkoutRepository';

export interface WeeklyMetrics {
  workoutsThisWeek: number;
  totalTonnageKg: number;
  activeStreakWeeks: number;
}

export async function computeDashboardMetrics(
  workoutRepo: IWorkoutRepository
): Promise<WeeklyMetrics> {
  const allWorkouts = await workoutRepo.findAll();
  const completed = allWorkouts.filter((w) => w.status === 'completed');

  // Determine current week Monday to Sunday
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7; // 0 = Mon, 6 = Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek);
  monday.setHours(0, 0, 0, 0);
  const mondayIso = monday.toISOString().split('T')[0];

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  const sundayIso = sunday.toISOString().split('T')[0];

  const thisWeekWorkouts = completed.filter(
    (w) => w.date >= mondayIso && w.date <= sundayIso
  );

  let totalTonnageKg = 0;
  for (const w of thisWeekWorkouts) {
    const sets = await workoutRepo.getSetsByWorkoutId(w.id);
    for (const s of sets) {
      if (s.weight != null && s.reps != null) {
        totalTonnageKg += s.weight * s.reps;
      }
    }
  }

  // Calculate weekly streak (consecutive weeks with at least one workout)
  const weekSet = new Set<string>();
  for (const w of completed) {
    const d = new Date(w.date + 'T00:00:00Z');
    const startOfYear = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getUTCDay() + 1) / 7);
    weekSet.add(`${d.getUTCFullYear()}-W${weekNum}`);
  }

  let streak = 0;
  const checkDate = new Date(now);
  while (true) {
    const startOfYear = new Date(Date.UTC(checkDate.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((checkDate.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getUTCDay() + 1) / 7);
    const key = `${checkDate.getUTCFullYear()}-W${weekNum}`;
    if (weekSet.has(key)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 7);
    } else {
      break;
    }
  }

  return {
    workoutsThisWeek: thisWeekWorkouts.length,
    totalTonnageKg: Math.round(totalTonnageKg),
    activeStreakWeeks: streak,
  };
}
