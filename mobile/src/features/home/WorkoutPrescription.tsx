import { colors as uiColors } from '../../ui/theme';
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ExercisePrescription } from '../../services/workoutPreviewService';

export function WorkoutPrescription({ rows, limit }: { rows: ExercisePrescription[]; limit?: number; }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups: { id: string; superset: boolean; rows: ExercisePrescription[] }[] = [];
  for (const row of rows) {
    const group = row.groupId ? groups.find(g => g.id === row.groupId && g.superset) : undefined;
    if (group) group.rows.push(row);
    else groups.push({ id: row.groupId ?? row.id, superset: !!row.groupId, rows: [row] });
  }
  for (const group of groups) {
    group.superset = group.superset && new Set(group.rows.map(row => row.templateExercise.exercise_id ?? row.id)).size > 1;
  }
  // Keep a superset together when Home limits the number of visible exercises.
  let shown = 0;
  const visible = groups.filter(group => {
    if (limit != null && shown >= limit) return false;
    shown += group.rows.length;
    return true;
  });
  return <View>
    {visible.map(group => <View key={group.id} style={group.superset ? styles.group : undefined}>
      {group.superset && <Text style={styles.groupTitle}>Superset</Text>}
      {group.rows.map(row => <TouchableOpacity key={row.id} style={styles.row}
        disabled={!row.explanation} accessibilityRole="button"
        accessibilityLabel={`${row.name}. ${row.summary}${row.explanation ? '. View plan details' : ''}`}
        accessibilityState={row.explanation ? { expanded: expanded === row.id } : undefined}
        onPress={() => setExpanded(expanded === row.id ? null : row.id)}>
      <Text style={styles.name}>
        {row.name}
      </Text>
      <Text style={styles.load}>
        {row.summary}
      </Text>
      {expanded === row.id && row.explanation && <Text style={styles.target}>{row.explanation}</Text>}
    </TouchableOpacity>)}
    </View>)}

    {rows.length > shown && <Text style={styles.more}>+ {rows.length - shown} more exercises · View workout</Text>}
  </View>;
}

const styles = StyleSheet.create({
  group: { borderLeftWidth: 2, borderLeftColor: uiColors.accent, paddingLeft: 12, marginTop: 10 },
  groupTitle: { color: uiColors.secondaryText, fontWeight: '600' },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: uiColors.border },
  name: { color: uiColors.text, fontSize: 15, fontWeight: '600' },
  target: { color: uiColors.secondaryText, marginTop: 4 },
  load: { color: uiColors.accentText, marginTop: 4 },
  more: { color: uiColors.muted, paddingTop: 12 },
});
