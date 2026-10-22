/** A group needs two distinct movements, regardless of its number of sets. */
export function normalizeExerciseGroups<T extends { exercise_id: string; exercise_group_id: string | null }>(rows: T[]): T[] {
  const members = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.exercise_group_id) continue;
    const group = members.get(row.exercise_group_id) ?? new Set<string>();
    group.add(row.exercise_id);
    members.set(row.exercise_group_id, group);
  }
  return rows.map(row => row.exercise_group_id && (members.get(row.exercise_group_id)?.size ?? 0) < 2
    ? { ...row, exercise_group_id: null } : row);
}
