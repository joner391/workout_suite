import { colors as uiColors } from '../../ui/theme';
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import { IWorkoutRepository, IExerciseRepository, IGearRepository, IUserSettingsRepository, IProgramRepository, IBodyMetricsRepository, IUserProfileRepository } from '../../domain/repositories';
import { ProgramBlockService, ActiveProgramInfo } from '../../services/programBlockService';
import { loadTrainingOverview, TrainingOverview } from '../../services/trainingOverviewService';
import { buildWorkoutPreview, selectNextTemplate, ExercisePrescription } from '../../services/workoutPreviewService';
import { WorkoutTemplateDetail } from '../../domain/repositories/IProgramRepository';
import { Exercise, WeightUnit, Workout } from '../../core/types';
import { formatWeight } from '../../core/math/unitConversion';
import { WorkoutPrescription } from './WorkoutPrescription';
import { SessionDetailModal } from '../calendar/SessionDetailModal';
import { WorkloadDeepDiveModal } from '../plots/WorkloadDeepDiveModal';
import { BodyMetricsScreen } from '../bodyMetrics/BodyMetricsScreen';
import { PersonalRecordsScreen } from '../profile/PersonalRecordsScreen';
import { useOptionalRepositories } from '../../context/RepositoryContext';

export interface HomeScreenProps {
  workoutRepo: IWorkoutRepository;
  exerciseRepo: IExerciseRepository;
  gearRepo?: IGearRepository;
  userSettingsRepo?: IUserSettingsRepository;
  programRepo?: IProgramRepository;
  programBlockService?: ProgramBlockService;
  bodyMetricsRepo?: IBodyMetricsRepository;
  userProfileRepo?: IUserProfileRepository;
  onNavigateToWorkout?: () => void;
  onNavigateToProfile?: () => void;
  onNavigateToPrograms?: () => void;
  onNavigateToCalendar?: () => void;
  onNavigateToAnalytics?: (targetGroup?: 'performance' | 'body_composition') => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = (props) => {
  const repositories = useOptionalRepositories();
  const { workoutRepo, exerciseRepo, gearRepo, userSettingsRepo, programRepo, programBlockService,
    bodyMetricsRepo, userProfileRepo, onNavigateToWorkout, onNavigateToProfile,
    onNavigateToPrograms, onNavigateToCalendar, onNavigateToAnalytics } = props;
  const [period, setPeriod] = useState<7 | 14>(7);
  const [periodReady, setPeriodReady] = useState(!userSettingsRepo);
  const [overview, setOverview] = useState<TrainingOverview | null>(null);
  const [active, setActive] = useState<ActiveProgramInfo | null>(null);
  const [next, setNext] = useState<WorkoutTemplateDetail | null>(null);
  const [inProgress, setInProgress] = useState<Workout | null>(null);
  const [catalog, setCatalog] = useState(new Map<string, Exercise>());
  const [rows, setRows] = useState<ExercisePrescription[]>([]);
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recordExercise, setRecordExercise] = useState<string | null>(null);
  const [showWorkload, setShowWorkload] = useState(false);
  const [showBody, setShowBody] = useState(false);

  useEffect(() => {
    let alive = true;
    userSettingsRepo?.get('home_overview_days').then(value => {
      if (alive) setPeriod(value === '14' ? 14 : 7);
    }).catch(() => { }).finally(() => { if (alive) setPeriodReady(true); });
    return () => { alive = false; };
  }, [userSettingsRepo]);

  useEffect(() => {
    if (!periodReady) return;
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [summary, exercises, current, activeProgram, currentUnit] = await Promise.all([
          loadTrainingOverview(workoutRepo, period), exerciseRepo.findAll(), workoutRepo.getInProgressWorkout(),
          programBlockService?.getActiveProgram() ?? null, userSettingsRepo?.getUnitSystem() ?? 'kg' as WeightUnit,
        ]);
        const exerciseMap = new Map(exercises.map(ex => [ex.id, ex]));
        let template: WorkoutTemplateDetail | null = null;
        if (activeProgram && programRepo) {
          const [details, completed] = await Promise.all([
            programRepo.getProgramWithDetails(activeProgram.program.id), workoutRepo.findAll({ status: 'completed' }),
          ]);
          template = selectNextTemplate(details?.templates ?? [], completed);
        }
        const bodyweight = await userSettingsRepo?.getUserBodyweight();
        const preview = template ? await buildWorkoutPreview(template, workoutRepo, exerciseMap, currentUnit, gearRepo, bodyweight,
          { settings: userSettingsRepo, programs: programRepo, profiles: userProfileRepo ?? repositories?.userProfileRepo,
            preferences: repositories?.exercisePreferenceRepo, calibration: repositories?.calibratedParamService }) : [];
        if (!alive) return;
        setOverview(summary); setCatalog(exerciseMap); setInProgress(current); setActive(activeProgram);
        setNext(template); setRows(preview); setUnit(currentUnit);
      } catch {
        if (alive) setError('Could not load your training overview.');
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [workoutRepo, exerciseRepo, gearRepo, programRepo, programBlockService, userSettingsRepo, period, periodReady, reload]);

  const choosePeriod = (value: 7 | 14) => {
    setPeriod(value);
    userSettingsRepo?.set('home_overview_days', String(value)).catch(() => { });
  };
  const openPrograms = onNavigateToPrograms ?? onNavigateToProfile;
  const difference = overview ? overview.sessions.length - overview.previousSessions : 0;

  return <View testID="home-screen" style={styles.container}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>YOUR TRAINING</Text>
      <View style={styles.headingRow}>
        <Text style={styles.title}>Home</Text>
        {openPrograms && <TouchableOpacity accessibilityRole="button" onPress={openPrograms} style={styles.smallButton}>
          <Text style={styles.link}>Programs →</Text>
        </TouchableOpacity>}
      </View>
      {loading && <ActivityIndicator accessibilityLabel="Loading training overview" color={uiColors.accent} />}

      {error && <View style={styles.card}>
        <Text style={styles.body}>
          {error}
        </Text>
        <TouchableOpacity onPress={() => setReload(n => n + 1)} style={styles.smallButton}>
          <Text style={styles.link}>Try again</Text>
        </TouchableOpacity>
      </View>}

      {!loading && !error && <>
        <View testID="next-workout-card" style={[styles.card, styles.nextCard]}>
          <Text style={styles.eyebrow}>
            {inProgress ? 'WORKOUT IN PROGRESS' : 'NEXT WORKOUT'}
          </Text>
          <Text style={styles.sectionTitle}>
            {inProgress?.name ?? next?.name ?? 'Ready when you are'}
          </Text>
          {inProgress ? <Text style={styles.body}>Your session is saved. Pick up where you left off.</Text> : next ? <>
            <Text style={styles.muted}>{active?.program.name} · {rows.length} exercises</Text>
            <WorkoutPrescription rows={rows} limit={3} />
          </> : <Text style={styles.body}>Choose a program or start a freestyle workout.</Text>}

          <TouchableOpacity
            testID="home-view-workout-btn"
            accessibilityRole="button"
            onPress={onNavigateToWorkout}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>
              {inProgress ? 'Resume workout' : next ? 'View workout & start →' : 'Open Workout →'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headingRow}>
          <Text style={styles.sectionTitle}>Recent training</Text>
          <View style={styles.toggle}>
            {([7, 14] as const).map(value => <TouchableOpacity
              key={value}
              testID={`home-period-${value}`}
              accessibilityRole="button"
              accessibilityState={{ selected: period === value }}
              onPress={() => choosePeriod(value)}
              style={[styles.period, period === value && styles.selected]}
            >
              <Text style={period === value ? styles.primaryText : styles.muted}>{value} days</Text>
            </TouchableOpacity>)}
          </View>
        </View>
        <View style={styles.timeline}>
          {overview?.days.map(day => <TouchableOpacity
            key={day.date}
            accessibilityRole="button"
            accessibilityLabel={`${day.date}: ${day.sessions} workouts`}
            onPress={() => {
              const session = overview.sessions.find(s => s.workout.date === day.date);
              if (session) setSessionId(session.workout.id); else onNavigateToCalendar?.();
            }}
            style={styles.day}
          >
            <Text style={styles.dayLabel}>
              {new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}
            </Text>
            <View style={[styles.dot, day.sessions > 0 && styles.activeDot]} />
            <Text style={styles.dayLabel}>
              {Number(day.date.slice(-2))}
            </Text>
          </TouchableOpacity>)}
        </View>
        <View style={styles.metrics}>
          {[[overview?.sessions.length ?? 0, 'Sessions'], [overview?.workingSets ?? 0, 'Working sets'], [overview?.records.length ?? 0, 'Rep PRs']].map(([value, label]) => <View key={label} style={styles.metric}>
            <Text style={styles.metricValue}>
              {value}
            </Text>
            <Text style={styles.muted}>
              {label}
            </Text>
          </View>)}
        </View>
        <Text style={styles.hint}>{difference === 0 ? 'Same number of sessions' : `${Math.abs(difference)} ${difference > 0 ? 'more' : 'fewer'} sessions`} than the previous {period} days · {overview?.previousWorkingSets ?? 0} working sets previously</Text>
        <Text style={styles.sectionTitle}>Recent highlights</Text>
        {overview?.records.slice(0, 3).map((record, index) => <TouchableOpacity
          key={`${record.workoutId}-${index}`}
          accessibilityRole="button"
          style={styles.row}
          onPress={() => setRecordExercise(record.exerciseId)}
        >
          <View style={styles.flex}>
            <Text style={styles.link}>{catalog.get(record.exerciseId)?.name ?? 'Exercise'} · {record.reps}-rep PR</Text>
            <Text style={styles.muted}>{formatWeight(record.weightKg, unit)} effective · {record.date}</Text>
          </View>
          <Text style={styles.link}>→</Text>
        </TouchableOpacity>)}
        {overview?.records.length === 0 && <Text style={styles.body}>New rep records will appear here as you beat previous performances.</Text>}
        <Text style={styles.hint}>Rep PRs compare loads at the same rep count and equipment against earlier completed sessions.</Text>
        <View style={styles.headingRow}>
          <Text style={styles.sectionTitle}>Latest sessions</Text>
          <TouchableOpacity onPress={onNavigateToCalendar} style={styles.smallButton}>
            <Text style={styles.link}>History →</Text>
          </TouchableOpacity>
        </View>
        {overview?.sessions.slice(0, 3).map(({ workout, workingSets, exerciseCount }) => <TouchableOpacity
          key={workout.id}
          testID={`home-session-${workout.id}`}
          accessibilityRole="button"
          style={styles.row}
          onPress={() => setSessionId(workout.id)}
        >
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>
              {workout.name}
            </Text>
            <Text style={styles.muted}>{workout.date} · {exerciseCount} exercises · {workingSets} working sets</Text>
          </View>
          <Text style={styles.link}>→</Text>
        </TouchableOpacity>)}
        {!overview?.sessions.length && <Text style={styles.body}>No completed sessions in the last {period} days. Your next workout is a good place to begin.</Text>}
      </>}

      <Text style={styles.sectionTitle}>Explore</Text>
      <View style={styles.shortcuts}>
        {onNavigateToCalendar && <TouchableOpacity testID="home-open-calendar-btn" style={styles.smallButton} onPress={onNavigateToCalendar}>
          <Text style={styles.link}>Calendar →</Text>
        </TouchableOpacity>}

        {onNavigateToAnalytics && <TouchableOpacity testID="home-open-analytics-btn" style={styles.smallButton} onPress={() => onNavigateToAnalytics('performance')}>
          <Text style={styles.link}>Performance →</Text>
        </TouchableOpacity>}

        <TouchableOpacity testID="home-workload-deep-dive-btn" style={styles.smallButton} onPress={() => setShowWorkload(true)}>
          <Text style={styles.link}>Workload →</Text>
        </TouchableOpacity>
        {bodyMetricsRepo && <TouchableOpacity style={styles.smallButton} onPress={() => setShowBody(true)}>
          <Text style={styles.link}>Log body metrics →</Text>
        </TouchableOpacity>}

        {onNavigateToAnalytics && <TouchableOpacity testID="home-open-body-plots-btn" style={styles.smallButton} onPress={() => onNavigateToAnalytics('body_composition')}>
          <Text style={styles.link}>Body trends →</Text>
        </TouchableOpacity>}
      </View>
    </ScrollView>
    {sessionId && <SessionDetailModal
      visible
      workoutId={sessionId}
      workoutRepo={workoutRepo}
      exerciseRepo={exerciseRepo}
      userSettingsRepo={userSettingsRepo}
      unitSystem={unit}
      onClose={() => { setSessionId(null); setReload(n => n + 1); }}
      onDeleteSession={() => { setSessionId(null); setReload(n => n + 1); }}
    />}

    {recordExercise && <Modal visible animationType="slide" onRequestClose={() => setRecordExercise(null)}>
      <PersonalRecordsScreen
        workoutRepo={workoutRepo}
        exerciseRepo={exerciseRepo}
        gearRepo={gearRepo}
        userSettingsRepo={userSettingsRepo}
        programBlockService={programBlockService}
        initialExerciseId={recordExercise}
        onClose={() => setRecordExercise(null)}
      />
    </Modal>}

    <WorkloadDeepDiveModal
      visible={showWorkload}
      workoutRepo={workoutRepo}
      exerciseRepo={exerciseRepo}
      userSettingsRepo={userSettingsRepo}
      onClose={() => setShowWorkload(false)}
    />
    {showBody && bodyMetricsRepo && <Modal visible animationType="slide" onRequestClose={() => setShowBody(false)}>
      <BodyMetricsScreen
        bodyMetricsRepo={bodyMetricsRepo}
        userProfileRepo={userProfileRepo}
        userSettingsRepo={userSettingsRepo}
        onClose={() => setShowBody(false)}
      />
    </Modal>}
  </View>;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: uiColors.background },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  title: { color: uiColors.text, fontSize: 30, fontWeight: '800' },
  eyebrow: { color: uiColors.accentText, fontSize: 11, letterSpacing: 1.2, fontWeight: '700' },
  sectionTitle: { color: uiColors.text, fontSize: 19, fontWeight: '700', marginTop: 8 },
  card: { backgroundColor: uiColors.surface, borderRadius: 16, borderWidth: 1, borderColor: uiColors.border, padding: 16, gap: 8 },
  nextCard: { borderColor: uiColors.accentBorder },
  body: { color: uiColors.secondaryText, lineHeight: 21 },
  muted: { color: uiColors.muted, fontSize: 12, marginTop: 3 },
  hint: { color: uiColors.muted, fontSize: 12, lineHeight: 18 },
  link: { color: uiColors.accentText, fontWeight: '600' },
  primary: { backgroundColor: uiColors.accent, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  primaryText: { color: uiColors.onAccent, fontWeight: '700' },
  smallButton: { backgroundColor: uiColors.raised, padding: 12, borderRadius: 10, minHeight: 44, justifyContent: 'center' },
  toggle: { flexDirection: 'row', backgroundColor: uiColors.raised, borderRadius: 9, padding: 3 },
  period: { padding: 9, borderRadius: 7, minHeight: 40, justifyContent: 'center' },
  selected: { backgroundColor: uiColors.accent },
  timeline: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { flex: 1, alignItems: 'center', gap: 7, paddingVertical: 8 },
  dayLabel: { color: uiColors.muted, fontSize: 10 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: uiColors.border },
  activeDot: { backgroundColor: uiColors.accent },
  metrics: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, backgroundColor: uiColors.raised, padding: 12, borderRadius: 12 },
  metricValue: { color: uiColors.text, fontSize: 25, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: uiColors.surface, borderRadius: 12, padding: 14 },
  rowTitle: { color: uiColors.text, fontSize: 15, fontWeight: '600' },
  flex: { flex: 1, gap: 4 },
  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
