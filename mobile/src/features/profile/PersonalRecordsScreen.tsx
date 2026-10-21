import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import { Exercise, PRBoardResult, WeightUnit } from '../../core/types';
import { IWorkoutRepository, IExerciseRepository, IGearRepository, IUserSettingsRepository } from '../../domain/repositories';
import { ProgramBlockService } from '../../services/programBlockService';
import { ExerciseInspectionService } from '../../services/exerciseInspectionService';
import { useOptionalRepositories } from '../../context/RepositoryContext';
import { PRBoardTable } from '../inspection/PRBoardTable';
import { ExerciseDetailScreen } from '../inspection/ExerciseDetailScreen';
import { SessionDetailModal } from '../calendar/SessionDetailModal';
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

export function PersonalRecordsScreen({ workoutRepo, exerciseRepo, gearRepo, userSettingsRepo, programBlockService, initialExerciseId, onClose }: PersonalRecordsScreenProps) {
  const repositories = useOptionalRepositories();
  const service = useMemo(() => new ExerciseInspectionService(workoutRepo, exerciseRepo), [workoutRepo, exerciseRepo]);
  const [exercises, setExercises] = useState<{ exercise: Exercise; date: string; liked: boolean; }[]>([]);
  const [exerciseId, setExerciseId] = useState<string | null>(initialExerciseId ?? null);
  const [search, setSearch] = useState('');
  const [board, setBoard] = useState<PRBoardResult | null>(null);
  const [scope, setScope] = useState<'all_time' | 'program_block'>('all_time');
  const [variants, setVariants] = useState(false);
  const [hasVariants, setHasVariants] = useState(false);
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [listLoading, setListLoading] = useState(true);
  const [boardLoading, setBoardLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [retry, setRetry] = useState(0);
  const [blockDates, setBlockDates] = useState<{ startDate: string; endDate?: string; } | null>(null);

  useEffect(() => {
    let alive = true;
    setListLoading(true); setListError(null);
    (async () => {
      try {
        const [catalog, workouts, currentUnit, preferences, active] = await Promise.all([
          exerciseRepo.findAll(), workoutRepo.findAll({ status: 'completed' }), userSettingsRepo?.getUnitSystem() ?? 'kg' as WeightUnit,
          repositories?.exercisePreferenceService?.getAllPreferences() ?? [], programBlockService?.getActiveProgram() ?? null,
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
        setUnit(currentUnit);
        setBlockDates(active?.block.start_date ? { startDate: active.block.start_date, endDate: active.block.end_date ?? undefined } : null);
      } catch { if (alive) setListError('Could not load personal records.'); }
      finally { if (alive) setListLoading(false); }
    })();
    return () => { alive = false; };
  }, [workoutRepo, exerciseRepo, userSettingsRepo, programBlockService, repositories?.exercisePreferenceService, retry]);

  useEffect(() => {
    if (!exerciseId) return;
    let alive = true;
    setBoardLoading(true); setBoard(null); setBoardError(null);
    (async () => {
      try {
        if (scope === 'program_block' && !blockDates) {
          if (alive) setBoardError('Activate a program to view records from its current training cycle.');
          return;
        }
        const exercise = await exerciseRepo.findById(exerciseId);
        const family = exercise ? await exerciseRepo.findVariants(exercise.parent_exercise_id ?? exercise.id) : [];
        const result = await service.getPRBoard({ exerciseId, scope, includeVariants: variants, ...(scope === 'program_block' ? blockDates : {}) });
        if (alive) { setBoard(result); setHasVariants(family.length > 0 || !!exercise?.parent_exercise_id); }
      } catch { if (alive) setBoardError('Could not load this exercise’s records.'); }
      finally { if (alive) setBoardLoading(false); }
    })();
    return () => { alive = false; };
  }, [exerciseId, scope, variants, blockDates, exerciseRepo, service, retry]);

  const selectedName = exercises.find(e => e.exercise.id === exerciseId)?.exercise.name ?? 'Exercise records';
  const loading = exerciseId ? boardLoading : listLoading;
  const error = exerciseId ? boardError : listError;
  return <View testID="personal-records-screen" style={styles.container}>
    <View style={styles.header}>
      <TouchableOpacity accessibilityRole="button" onPress={() => {
        if (exerciseId && !initialExerciseId) { setExerciseId(null); setScope('all_time'); setVariants(false); }
        else onClose();
      }} style={styles.button}>
        <Text style={styles.link}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>
        {exerciseId ? selectedName : 'Personal records'}
      </Text>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {!exerciseId && <>
        <Text style={styles.muted}>Your logged exercises. Liked lifts first, then most recently trained.</Text>
        <TextInput
          accessibilityLabel="Search personal records"
          testID="records-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search your lifts"
          placeholderTextColor="#71717A"
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
          <Text style={styles.link}>Records →</Text>
        </TouchableOpacity>)}
        {!loading && !error && !exercises.some(({ exercise }) => exercise.name.toLowerCase().includes(search.toLowerCase())) && <Text style={styles.muted}>
          {search ? 'No matching logged exercises.' : 'Complete a workout to start building your records.'}
        </Text>}
      </>}

      {loading && <ActivityIndicator color="#00E676" />}

      {error && <><Text accessibilityRole="alert" style={styles.muted}>
        {error}
      </Text><TouchableOpacity onPress={() => setRetry(n => n + 1)} style={styles.button}>
          <Text style={styles.link}>Try again</Text>
        </TouchableOpacity></>}

      {exerciseId && <>
        <Text style={styles.muted}>Rep records and estimated 1RM are shown separately. Tap a record to inspect its session.</Text>
        <PRBoardTable
          records={board?.records ?? []}
          peakRecord={board?.peakRecord ?? null}
          scope={scope}
          onScopeChange={setScope}
          includeVariants={variants}
          onIncludeVariantsChange={setVariants}
          hasVariants={hasVariants}
          unitSystem={unit}
          onSelectWorkout={setSessionId}
          loading={loading}
        />
        <TouchableOpacity style={styles.button} onPress={() => setShowDetail(true)}>
          <Text style={styles.link}>Exercise details & history →</Text>
        </TouchableOpacity>
      </>}
    </ScrollView>
    {sessionId && <SessionDetailModal
      visible
      workoutId={sessionId}
      workoutRepo={workoutRepo}
      exerciseRepo={exerciseRepo}
      userSettingsRepo={userSettingsRepo}
      unitSystem={unit}
      onClose={() => { setSessionId(null); setRetry(n => n + 1); }}
      onDeleteSession={() => { setSessionId(null); setRetry(n => n + 1); }}
    />}

    {showDetail && exerciseId && <Modal visible animationType="slide" onRequestClose={() => setShowDetail(false)}>
      <ExerciseDetailScreen
        exerciseId={exerciseId}
        workoutRepo={workoutRepo}
        exerciseRepo={exerciseRepo}
        gearRepo={gearRepo}
        userSettingsRepo={userSettingsRepo}
        onClose={() => setShowDetail(false)}
      />
    </Modal>}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { padding: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: '#27272A' },
  title: { color: '#FAFAFA', fontWeight: '700', fontSize: 24 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  muted: { color: '#A1A1AA', lineHeight: 20 },
  link: { color: '#86EFAC', fontWeight: '600' },
  input: { backgroundColor: '#18181B', borderRadius: 10, color: '#FAFAFA', padding: 14 },
  row: { backgroundColor: '#18181B', borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: '#FAFAFA', fontWeight: '600', fontSize: 16 },
  button: { paddingVertical: 12, minHeight: 44 },
  flex: { flex: 1, gap: 4 },
});
