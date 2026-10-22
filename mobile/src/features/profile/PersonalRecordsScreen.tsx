import { colors as uiColors } from '../../ui/theme';
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Exercise } from '../../core/types';
import { IWorkoutRepository, IExerciseRepository, IGearRepository, IUserSettingsRepository } from '../../domain/repositories';
import { ProgramBlockService } from '../../services/programBlockService';

import { useOptionalRepositories } from '../../context/RepositoryContext';

import { ExerciseDetailScreen } from '../inspection/ExerciseDetailScreen';

import { isPerformedWorkingSet } from '../../services/trainingOverviewService';

export interface PersonalRecordsScreenProps {
  workoutRepo: IWorkoutRepository;
  exerciseRepo: IExerciseRepository;
  gearRepo?: IGearRepository;
  userSettingsRepo?: IUserSettingsRepository;
  programBlockService?: ProgramBlockService;
  initialExerciseId?: string;
  onClose: () => void;
}

export function PersonalRecordsScreen({ workoutRepo, exerciseRepo, gearRepo, userSettingsRepo, initialExerciseId, onClose }: PersonalRecordsScreenProps) {
  const repositories = useOptionalRepositories();
  const [exercises, setExercises] = useState<{ exercise: Exercise; date: string; liked: boolean; }[]>([]);
  const [exerciseId, setExerciseId] = useState<string | null>(initialExerciseId ?? null);
  const [search, setSearch] = useState('');
  const [listLoading, setListLoading] = useState(true);

  const [listError, setListError] = useState<string | null>(null);

  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setListLoading(true); setListError(null);
    (async () => {
      try {
        const [catalog, workouts, preferences] = await Promise.all([
          exerciseRepo.findAll(), workoutRepo.findAll({ status: 'completed' }),
          repositories?.exercisePreferenceService?.getAllPreferences() ?? [],
        ]);
        const completed = workouts.filter(w => w.status === 'completed');
        const sets = completed.length ? await workoutRepo.getSetsByWorkoutIds(completed.map(w => w.id)) : [];
        const dates = new Map(completed.map(w => [w.id, w.date]));
        const latest = new Map<string, string>();
        for (const set of sets.filter(isPerformedWorkingSet)) {
          const date = dates.get(set.workout_id) ?? '';
          if (date > (latest.get(set.exercise_id) ?? '')) latest.set(set.exercise_id, date);
        }
        const liked = new Set(preferences.filter(p => p.sentiment === 'liked').map(p => p.exercise_id));
        if (!alive) return;
        setExercises(catalog.filter(ex => latest.has(ex.id)).map(exercise => ({ exercise, date: latest.get(exercise.id)!, liked: liked.has(exercise.id) }))
          .sort((a, b) => Number(b.liked) - Number(a.liked) || b.date.localeCompare(a.date) || a.exercise.name.localeCompare(b.exercise.name)));
      } catch { if (alive) setListError('Could not load exercises.'); }
      finally { if (alive) setListLoading(false); }
    })();
    return () => { alive = false; };
  }, [workoutRepo, exerciseRepo, repositories?.exercisePreferenceService, retry]);

  if (exerciseId) return <ExerciseDetailScreen
    exerciseId={exerciseId}
    workoutRepo={workoutRepo}
    exerciseRepo={exerciseRepo}
    gearRepo={gearRepo}
    userSettingsRepo={userSettingsRepo}
    onClose={() => { if (initialExerciseId) onClose(); else { setExerciseId(null); setRetry(n => n + 1); } }}
  />;
  return <View testID="personal-records-screen" style={styles.container}>
    <View style={styles.header}>
      <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.button}>
        <Text style={styles.link}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Exercises</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {!exerciseId && <>
        <Text style={styles.muted}>Your logged exercises. Liked lifts first, then most recently trained.</Text>
        <TextInput
          accessibilityLabel="Search exercises"
          testID="records-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search your lifts"
          placeholderTextColor={uiColors.subtle}
          style={styles.input}
        />
        {exercises.filter(({ exercise }) => exercise.name.toLowerCase().includes(search.toLowerCase())).map(({ exercise, date, liked }) => <TouchableOpacity
          key={exercise.id}
          testID={`records-exercise-${exercise.id}`}
          accessibilityRole="button"
          style={styles.row}
          onPress={() => setExerciseId(exercise.id)}
        >
          <View style={styles.flex}>
            <Text style={styles.name}>
              {liked ? '♥ ' : ''}
              {exercise.name}
            </Text>
            <Text style={styles.muted}>Last trained {date}</Text>
          </View>
          <Text style={styles.link}>Details →</Text>
        </TouchableOpacity>)}
        {!listLoading && !listError && !exercises.some(({ exercise }) => exercise.name.toLowerCase().includes(search.toLowerCase())) && <Text style={styles.muted}>
          {search ? 'No matching logged exercises.' : 'Complete a workout to start building your records.'}
        </Text>}
      </>}

      {listLoading && <ActivityIndicator color={uiColors.accent} />}

      {listError && <><Text accessibilityRole="alert" style={styles.muted}>
        {listError}
      </Text><TouchableOpacity onPress={() => setRetry(n => n + 1)} style={styles.button}>
          <Text style={styles.link}>Try again</Text>
        </TouchableOpacity></>}

    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: uiColors.background },
  header: { padding: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: uiColors.border },
  title: { color: uiColors.text, fontWeight: '700', fontSize: 24 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  muted: { color: uiColors.muted, lineHeight: 20 },
  link: { color: uiColors.accentText, fontWeight: '600' },
  input: { backgroundColor: uiColors.raised, borderRadius: 10, color: uiColors.text, padding: 14 },
  row: { backgroundColor: uiColors.raised, borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: uiColors.text, fontWeight: '600', fontSize: 16 },
  button: { paddingVertical: 12, minHeight: 44 },
  flex: { flex: 1, gap: 4 },
});
