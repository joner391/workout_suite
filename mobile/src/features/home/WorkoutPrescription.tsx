import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ExercisePrescription } from '../../services/workoutPreviewService';

export function WorkoutPrescription({ rows, limit }: { rows: ExercisePrescription[]; limit?: number; }) {
  return <View>
    {rows.slice(0, limit ?? rows.length).map(row => <View key={row.id} style={styles.row}>
      <Text style={styles.name}>
        {row.name}
      </Text>
      <Text style={styles.target}>
        {row.target}
      </Text>
      <Text style={styles.load}>
        {row.load}
      </Text>
    </View>)}

    {limit != null && rows.length > limit && <Text style={styles.more}>+ {rows.length - limit} more exercises · View workout</Text>}
  </View>;
}

const styles = StyleSheet.create({
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#27272A' },
  name: { color: '#FAFAFA', fontSize: 15, fontWeight: '600' },
  target: { color: '#D4D4D8', marginTop: 4 },
  load: { color: '#86EFAC', marginTop: 4 },
  more: { color: '#A1A1AA', paddingTop: 12 },
});
