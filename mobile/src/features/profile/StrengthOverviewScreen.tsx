import { colors as uiColors } from '../../ui/theme';
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import { Gender, SBDBalanceProfile, WeightUnit } from '../../core/types';
import { IWorkoutRepository, IExerciseRepository, IUserSettingsRepository, IUserProfileRepository, IBodyMetricsRepository } from '../../domain/repositories';
import { buildStrengthTimeline, StrengthSnapshot } from '../../services/strengthOverviewService';
import { calculateSBDBalanceProfile } from '../../core/math/strengthStandards';
import { calculateDotsScore } from '../../core/math/dotsCoefficients';
import { formatWeight } from '../../core/math/unitConversion';
import { SBDBalanceRadarChart } from '../inspection/SBDBalanceRadarChart';
import { BodyMetricsScreen } from '../bodyMetrics/BodyMetricsScreen';

export interface StrengthOverviewScreenProps {
  workoutRepo: IWorkoutRepository;
  exerciseRepo: IExerciseRepository;
  userSettingsRepo?: IUserSettingsRepository;
  userProfileRepo?: IUserProfileRepository;
  bodyMetricsRepo?: IBodyMetricsRepository;
  onClose: () => void;
}

export function StrengthOverviewScreen({ workoutRepo, exerciseRepo, userSettingsRepo, userProfileRepo, bodyMetricsRepo, onClose }: StrengthOverviewScreenProps) {
  const [history, setHistory] = useState<StrengthSnapshot[]>([]);
  const [profile, setProfile] = useState<SBDBalanceProfile | null>(null);
  const [gender, setGender] = useState<Gender>('male');
  const [bw, setBw] = useState<number | null>(null);
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [showRadar, setShowRadar] = useState(false);
  const [showBody, setShowBody] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(12);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(false);
    (async () => {
      try {
        const [workouts, exercises, metrics, athlete, settingGender, settingBw, currentUnit] = await Promise.all([
          workoutRepo.findAll({ status: 'completed' }), exerciseRepo.findAll(), bodyMetricsRepo?.getAll() ?? [], userProfileRepo?.getProfile() ?? null,
          userSettingsRepo?.getUserGender() ?? 'male' as Gender, userSettingsRepo?.getUserBodyweight() ?? null, userSettingsRepo?.getUnitSystem() ?? 'kg' as WeightUnit,
        ]);
        const sets = workouts.length ? await workoutRepo.getSetsByWorkoutIds(workouts.filter(w => w.status === 'completed').map(w => w.id)) : [];
        const currentGender = athlete?.gender ?? settingGender;
        const currentBw = [...metrics].filter(m => m.bodyweight != null && m.bodyweight > 0).sort((a, b) => b.date.localeCompare(a.date))[0]?.bodyweight ?? settingBw;
        const timeline = buildStrengthTimeline(workouts, sets, exercises, metrics, currentGender);
        const latest = timeline.at(-1);
        const balance = currentBw && latest ? calculateSBDBalanceProfile({ gender: currentGender, bodyweightKg: currentBw, squatE1rm: latest.squat, benchE1rm: latest.bench, deadliftE1rm: latest.deadlift }) : null;
        if (alive) { setHistory(timeline); setGender(currentGender); setBw(currentBw); setUnit(currentUnit); setProfile(balance); }
      } catch { if (alive) setError(true); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [workoutRepo, exerciseRepo, userSettingsRepo, userProfileRepo, bodyMetricsRepo, reload]);
  const latest = history.at(-1);
  const complete = !!latest?.squat && !!latest?.bench && !!latest?.deadlift;
  const dots = complete && bw && latest ? calculateDotsScore(gender, bw, latest.total) : null;
  return <View testID="strength-overview-screen" style={styles.container}>
    <View style={styles.header}>
      <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={onClose}>
        <Text style={styles.link}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>SBD / DOTS</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      {loading ? <ActivityIndicator color={uiColors.accent} /> : error ? <TouchableOpacity onPress={() => setReload(n => n + 1)} style={styles.card}>
        <Text style={styles.link}>Could not load strength overview. Try again →</Text>
      </TouchableOpacity> : <>
        <Text style={styles.muted}>Best estimated strength from your logged squat, bench press, and deadlift. Estimates are separate from tested single-rep records.</Text>
        {(['squat', 'bench', 'deadlift'] as const).map(lift => <View key={lift} style={styles.row}>
          <Text style={styles.name}>
            {lift === 'squat' ? 'Squat' : lift === 'bench' ? 'Bench press' : 'Deadlift'}
          </Text>
          <Text style={styles.value}>
            {latest?.[lift] ? formatWeight(latest[lift], unit) : '—'}

            <Text style={styles.muted}>e1RM</Text>
          </Text>
        </View>)}
        <View style={styles.card}>
          <Text style={styles.muted}>
            {complete ? 'ESTIMATED SBD TOTAL' : 'PARTIAL ESTIMATED TOTAL'}
          </Text>
          <Text style={styles.large}>
            {latest ? formatWeight(latest.total, unit) : '—'}
          </Text>
          <Text style={styles.muted}>Best estimates across sessions; this is not a competition total.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.muted}>ESTIMATED DOTS</Text>
          <Text style={styles.large}>
            {dots != null ? dots.toFixed(1) : '—'}
          </Text>
          <Text style={styles.muted}>
            {bw ? `Using ${formatWeight(bw, unit)} bodyweight · ${gender}` : 'Log bodyweight to calculate DOTS.'}
            {!complete ? ' Log all three lifts to complete your score.' : ''}
          </Text>
          {bodyMetricsRepo && <TouchableOpacity style={styles.button} onPress={() => setShowBody(true)}>
            <Text style={styles.link}>Update bodyweight →</Text>
          </TouchableOpacity>}
        </View>
        {profile && complete && <TouchableOpacity style={styles.button} onPress={() => setShowRadar(true)}>
          <Text style={styles.link}>View strength standards & balance radar →</Text>
        </TouchableOpacity>}
        <Text style={styles.title}>Strength history</Text>
        <Text style={styles.muted}>Running best e1RM total. Historical DOTS uses the latest recorded bodyweight on or before each session; missing bodyweight stays blank.</Text>
        {history.length === 0 && <Text style={styles.muted}>Your SBD sessions will appear here once logged.</Text>}
        {[...history].reverse().slice(0, historyLimit).map(point => <View key={point.date} style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.name}>
              {point.date}
            </Text>
            <Text style={styles.muted}>{formatWeight(point.total, unit)} estimated total</Text>
          </View>
          <Text style={styles.link}>
            {point.dots != null ? `${point.dots.toFixed(1)} DOTS` : 'DOTS —'}
          </Text>
        </View>)}
        {history.length > historyLimit && <TouchableOpacity style={styles.button} onPress={() => setHistoryLimit(n => n + 12)}>
          <Text style={styles.link}>Show older sessions →</Text>
        </TouchableOpacity>}
      </>}
    </ScrollView>
    {showRadar && <Modal visible animationType="slide" onRequestClose={() => setShowRadar(false)}>
      <SBDBalanceRadarChart
        balanceProfile={profile}
        gender={gender}
        bodyweightKg={bw}
        unitSystem={unit}
        onClose={() => setShowRadar(false)}
      />
    </Modal>}

    {showBody && bodyMetricsRepo && <Modal visible animationType="slide" onRequestClose={() => { setShowBody(false); setReload(n => n + 1); }}>
      <BodyMetricsScreen
        bodyMetricsRepo={bodyMetricsRepo}
        userProfileRepo={userProfileRepo}
        userSettingsRepo={userSettingsRepo}
        onClose={() => { setShowBody(false); setReload(n => n + 1); }}
      />
    </Modal>}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: uiColors.background },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: uiColors.border, gap: 10 },
  content: { padding: 16, paddingBottom: 40, gap: 16 },
  title: { color: uiColors.text, fontSize: 23, fontWeight: '700' },
  card: { padding: 18, borderRadius: 14, backgroundColor: uiColors.raised, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: uiColors.border },
  name: { color: uiColors.text, fontSize: 16, fontWeight: '600' },
  value: { color: uiColors.accentText, fontSize: 18, fontWeight: '700' },
  large: { color: uiColors.accentText, fontSize: 32, fontWeight: '700' },
  muted: { color: uiColors.muted, fontSize: 12, lineHeight: 20 },
  link: { color: uiColors.accentText, fontWeight: '600' },
  button: { paddingVertical: 12, minHeight: 44 },
  flex: { flex: 1, gap: 4 },
});
