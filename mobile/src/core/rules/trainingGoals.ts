import { PrimaryGoal } from '../types';

/** Read old profiles without retaining a redundant selectable goal or changing their mood. */
export function normalizeTrainingGoals(
  primaryGoal: PrimaryGoal | 'powerbuilding',
  secondaryGoals: string[] | null
): { primary_goal: PrimaryGoal; secondary_goals: string[] | null } {
  const primary = primaryGoal === 'powerbuilding' ? 'strength' : primaryGoal;
  const secondary = (secondaryGoals ?? []).flatMap(goal =>
    goal === 'powerbuilding' ? ['strength', 'hypertrophy'] : [goal]
  );
  if (primaryGoal === 'powerbuilding') secondary.push('hypertrophy');
  return {
    primary_goal: primary,
    secondary_goals: secondaryGoals == null && primaryGoal !== 'powerbuilding'
      ? null : [...new Set(secondary.filter(goal => goal !== primary))],
  };
}
