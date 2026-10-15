import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {
  IWorkoutRepository,
  IExerciseRepository,
  IBodyMetricsRepository,
  IProgramRepository,
  IUserSettingsRepository,
} from '../../domain/repositories';
import {
  ProgramBlockService,
  ActiveProgramInfo,
} from '../../services/programBlockService';
import {
  ProgramEraShadedChart,
  ProgramEraInfo,
  ChartSeries,
  ChartBarPoint,
} from './ProgramEraShadedChart';
import {
  calculateBodyweightRollingAverages,
  parseIsoDateToMs,
} from '../../core/math/navyBodyFat';
import { calculateHeuristic1RM } from '../../core/math/heuristic1rm';
import {
  cmToInches,
  kgToLbs,
  formatWeight,
  formatLength,
} from '../../core/math/unitConversion';
import {
  BodyMetric,
  Exercise,
  Workout,
  WeightUnit,
} from '../../core/types';

export type PlotChartType =
  | 'e1rm'
  | 'bodyweight'
  | 'body_fat'
  | 'circumferences'
  | 'volume';

export type CircumferenceType =
  | 'waist_cm'
  | 'neck_cm'
  | 'hip_cm'
  | 'bicep_cm'
  | 'chest_cm'
  | 'thigh_cm'
  | 'calf_cm';

const CIRCUMFERENCE_LABELS: Record<CircumferenceType, string> = {
  waist_cm: 'Waist',
  neck_cm: 'Neck',
  hip_cm: 'Hips',
  bicep_cm: 'Arms / Bicep',
  chest_cm: 'Chest',
  thigh_cm: 'Thighs',
  calf_cm: 'Calves',
};

export interface PlotsScreenProps {
  workoutRepo: IWorkoutRepository;
  exerciseRepo: IExerciseRepository;
  bodyMetricsRepo?: IBodyMetricsRepository;
  programRepo?: IProgramRepository;
  programBlockService?: ProgramBlockService;
  userSettingsRepo?: IUserSettingsRepository;
  initialChartType?: PlotChartType;
  onNavigateToBodyMetrics?: () => void;
  onClose?: () => void;
  isInline?: boolean;
}

export const PlotsScreen: React.FC<PlotsScreenProps> = ({
  workoutRepo,
  exerciseRepo,
  bodyMetricsRepo,
  programRepo,
  programBlockService,
  userSettingsRepo,
  initialChartType = 'bodyweight',
  onNavigateToBodyMetrics,
  onClose,
  isInline = false,
}) => {
  const [activeTab, setActiveTab] = useState<PlotChartType>(initialChartType);
  const [loading, setLoading] = useState<boolean>(true);
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');

  // Program era metadata
  const [programEras, setProgramEras] = useState<ProgramEraInfo[]>([]);

  // 1RM Data State
  const [compoundExercises, setCompoundExercises] = useState<Exercise[]>([]);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>('');
  const [e1rmSeries, setE1rmSeries] = useState<ChartSeries[]>([]);
  const [e1rmSummary, setE1rmSummary] = useState<{
    start: number;
    peak: number;
    current: number;
  } | null>(null);

  // Bodyweight Data State
  const [bodyweightSeries, setBodyweightSeries] = useState<ChartSeries[]>([]);
  const [bodyweightSummary, setBodyweightSummary] = useState<{
    latest: number;
    sma7: number;
    change30d: number;
  } | null>(null);

  // Body Fat Data State
  const [bodyFatSeries, setBodyFatSeries] = useState<ChartSeries[]>([]);
  const [bodyFatSummary, setBodyFatSummary] = useState<{
    latestNavy: number | null;
    latestManual: number | null;
  } | null>(null);

  // Circumferences Data State
  const [selectedCircumference, setSelectedCircumference] =
    useState<CircumferenceType>('waist_cm');
  const [circumferenceSeries, setCircumferenceSeries] = useState<ChartSeries[]>([]);
  const [circumferenceSummary, setCircumferenceSummary] = useState<{
    current: number;
    start: number;
    delta: number;
  } | null>(null);

  // Volume Data State
  const [volumeBars, setVolumeBars] = useState<ChartBarPoint[]>([]);
  const [volumeSummary, setVolumeSummary] = useState<{
    thisWeek: number;
    fourWeekAvg: number;
    peakWeek: number;
  } | null>(null);

  // 1. Load initial user settings & program eras
  const loadBaseMetadata = useCallback(async () => {
    try {
      if (userSettingsRepo) {
        const u = await userSettingsRepo.get('unit_system');
        if (u === 'lbs' || u === 'kg') setUnitSystem(u);
      }

      // Load program eras from programBlockService / programRepo
      if (programBlockService) {
        const blocksWithProg = await programBlockService.getAllProgramBlocks();
        const eras: ProgramEraInfo[] = blocksWithProg.map((b) => ({
          id: b.id,
          program_id: b.program_id,
          start_date: b.start_date,
          end_date: b.end_date,
          program: {
            id: b.program_id,
            name: b.program_name,
            color_hex: b.color_hex,
            notes: null,
            created_at: '',
          },
        }));
        setProgramEras(eras);
      } else if (programRepo) {
        const programs = await programRepo.findAll();
        const progMap = new Map(programs.map((p) => [p.id, p]));
        const blocks = await programRepo.findAllProgramBlocks();
        const eras: ProgramEraInfo[] = blocks.map((b) => ({
          id: b.id,
          program_id: b.program_id,
          start_date: b.start_date,
          end_date: b.end_date,
          program: progMap.get(b.program_id),
        }));
        setProgramEras(eras);
      }

      // Load candidate compound exercises for 1RM tab
      const allEx = await exerciseRepo.findAll();
      const compounds = allEx.filter(
        (e) =>
          e.is_compound ||
          (e.standard_lift_type &&
            ['squat', 'bench', 'deadlift', 'ohp', 'row'].includes(
              e.standard_lift_type
            ))
      );
      setCompoundExercises(compounds);
      if (compounds.length > 0 && !selectedExerciseId) {
        // Default to Bench Press or Squat
        const defaultEx =
          compounds.find((e) => e.standard_lift_type === 'bench') || compounds[0];
        setSelectedExerciseId(defaultEx.id);
      }
    } catch (err) {
      console.error('Failed to load plot metadata:', err);
    }
  }, [userSettingsRepo, programRepo, programBlockService, exerciseRepo, selectedExerciseId]);

  // 2. Load e1RM Time-Series
  const loadE1RMData = useCallback(async () => {
    if (!selectedExerciseId) return;

    try {
      const allWorkouts = await workoutRepo.findAll();
      const completed = allWorkouts.filter((w) => w.status === 'completed');

      const dataPoints: { date: string; value: number }[] = [];

      for (const w of completed) {
        const sets = await workoutRepo.getSetsByWorkoutId(w.id);
        const exSets = sets.filter((s) => s.exercise_id === selectedExerciseId);

        let maxE1rm = 0;
        for (const s of exSets) {
          if (s.reps > 0 && s.weight > 0) {
            const e1rm = calculateHeuristic1RM(s.weight, s.reps, {
              rpe: s.rpe,
              rir: s.rir,
            });
            if (e1rm > maxE1rm) maxE1rm = e1rm;
          }
        }

        if (maxE1rm > 0) {
          dataPoints.push({
            date: w.date,
            value: unitSystem === 'lbs' ? kgToLbs(maxE1rm) : maxE1rm,
          });
        }
      }

      dataPoints.sort((a, b) => a.date.localeCompare(b.date));

      if (dataPoints.length > 0) {
        setE1rmSeries([
          {
            id: 'e1rm_series',
            name: 'e1RM Trend',
            color: '#00E676',
            data: dataPoints,
            strokeWidth: 2.5,
          },
        ]);

        const start = dataPoints[0].value;
        const current = dataPoints[dataPoints.length - 1].value;
        const peak = Math.max(...dataPoints.map((d) => d.value));

        setE1rmSummary({ start, peak, current });
      } else {
        setE1rmSeries([]);
        setE1rmSummary(null);
      }
    } catch (err) {
      console.error('Failed to load e1RM plot data:', err);
    }
  }, [selectedExerciseId, workoutRepo, unitSystem]);

  // 3. Load Bodyweight & Rolling Avg Time-Series
  const loadBodyweightData = useCallback(async () => {
    if (!bodyMetricsRepo) return;

    try {
      const metrics = await bodyMetricsRepo.getAll();
      const entries = metrics.map((m) => ({
        date: m.date,
        bodyweight: m.bodyweight,
      }));

      const smoothed = calculateBodyweightRollingAverages(entries);

      if (smoothed.length > 0) {
        const rawPoints = smoothed.map((p) => ({
          date: p.date,
          value: unitSystem === 'lbs' ? kgToLbs(p.bodyweight) : p.bodyweight,
        }));

        const smaPoints = smoothed.map((p) => ({
          date: p.date,
          value: unitSystem === 'lbs' ? kgToLbs(p.sma7) : p.sma7,
        }));

        setBodyweightSeries([
          {
            id: 'raw_weight',
            name: 'Daily Log',
            color: '#666666',
            data: rawPoints,
            strokeWidth: 1.5,
            strokeDasharray: '2,2',
            dotRadius: 2.5,
          },
          {
            id: 'sma7_weight',
            name: '7-Day Avg (SMA)',
            color: '#00E676',
            data: smaPoints,
            strokeWidth: 2.5,
            dotRadius: 3.5,
          },
        ]);

        const latest = rawPoints[rawPoints.length - 1].value;
        const latestSma = smaPoints[smaPoints.length - 1].value;
        const first = rawPoints[0].value;
        const change30d = latest - first;

        setBodyweightSummary({
          latest,
          sma7: latestSma,
          change30d,
        });
      } else {
        setBodyweightSeries([]);
        setBodyweightSummary(null);
      }
    } catch (err) {
      console.error('Failed to load bodyweight plot data:', err);
    }
  }, [bodyMetricsRepo, unitSystem]);

  // 4. Load Body Fat Trends Time-Series
  const loadBodyFatData = useCallback(async () => {
    if (!bodyMetricsRepo) return;

    try {
      const metrics = await bodyMetricsRepo.getAll();

      const navyPoints: { date: string; value: number }[] = [];
      const manualPoints: { date: string; value: number }[] = [];

      for (const m of metrics) {
        if (m.navy_body_fat != null && m.navy_body_fat > 0) {
          navyPoints.push({ date: m.date, value: m.navy_body_fat });
        }
        if (m.body_fat_manual != null && m.body_fat_manual > 0) {
          manualPoints.push({ date: m.date, value: m.body_fat_manual });
        }
      }

      const series: ChartSeries[] = [];
      if (navyPoints.length > 0) {
        series.push({
          id: 'navy_bf',
          name: 'Navy Formula',
          color: '#00E676',
          data: navyPoints,
          strokeWidth: 2.5,
        });
      }
      if (manualPoints.length > 0) {
        series.push({
          id: 'manual_bf',
          name: 'Manual Entry',
          color: '#3B82F6',
          data: manualPoints,
          strokeWidth: 2,
          strokeDasharray: '4,4',
        });
      }

      setBodyFatSeries(series);

      const latestNavy =
        navyPoints.length > 0 ? navyPoints[navyPoints.length - 1].value : null;
      const latestManual =
        manualPoints.length > 0
          ? manualPoints[manualPoints.length - 1].value
          : null;

      setBodyFatSummary({ latestNavy, latestManual });
    } catch (err) {
      console.error('Failed to load body fat plot data:', err);
    }
  }, [bodyMetricsRepo]);

  // 5. Load Circumference Measurements
  const loadCircumferencesData = useCallback(async () => {
    if (!bodyMetricsRepo) return;

    try {
      const metrics = await bodyMetricsRepo.getAll();
      const points: { date: string; value: number }[] = [];

      for (const m of metrics) {
        const valCm = m[selectedCircumference];
        if (valCm != null && typeof valCm === 'number' && valCm > 0) {
          const displayVal =
            unitSystem === 'lbs' ? cmToInches(valCm) : valCm;
          points.push({
            date: m.date,
            value: Number(displayVal.toFixed(1)),
          });
        }
      }

      if (points.length > 0) {
        setCircumferenceSeries([
          {
            id: `circ_${selectedCircumference}`,
            name: CIRCUMFERENCE_LABELS[selectedCircumference],
            color: '#F59E0B',
            data: points,
            strokeWidth: 2.5,
          },
        ]);

        const start = points[0].value;
        const current = points[points.length - 1].value;
        const delta = current - start;

        setCircumferenceSummary({ current, start, delta });
      } else {
        setCircumferenceSeries([]);
        setCircumferenceSummary(null);
      }
    } catch (err) {
      console.error('Failed to load circumferences plot data:', err);
    }
  }, [bodyMetricsRepo, selectedCircumference, unitSystem]);

  // 6. Load Weekly Tonnage Volume
  const loadVolumeData = useCallback(async () => {
    try {
      const allWorkouts = await workoutRepo.findAll();
      const completed = allWorkouts.filter((w) => w.status === 'completed');

      // Group workouts into week buckets (Monday-based YYYY-MM-DD)
      const weekMap = new Map<string, number>();

      for (const w of completed) {
        const sets = await workoutRepo.getSetsByWorkoutId(w.id);
        let sessionTonnage = 0;
        for (const s of sets) {
          if (s.set_type !== 'warmup') {
            sessionTonnage += (s.weight || 0) * (s.reps || 0);
          }
        }

        // Compute Monday of the session's week
        const d = new Date(parseIsoDateToMs(w.date));
        const day = d.getUTCDay();
        const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setUTCDate(diff));
        const weekKey = monday.toISOString().split('T')[0];

        weekMap.set(weekKey, (weekMap.get(weekKey) || 0) + sessionTonnage);
      }

      const barPoints: ChartBarPoint[] = [];
      for (const [date, tonnageKg] of weekMap.entries()) {
        const displayTonnage =
          unitSystem === 'lbs' ? kgToLbs(tonnageKg) : tonnageKg;
        barPoints.push({
          date,
          value: Math.round(displayTonnage),
          label: 'Weekly Tonnage',
          color: '#3B82F6',
        });
      }

      barPoints.sort((a, b) => a.date.localeCompare(b.date));
      setVolumeBars(barPoints);

      if (barPoints.length > 0) {
        const thisWeek = barPoints[barPoints.length - 1].value;
        const peakWeek = Math.max(...barPoints.map((b) => b.value));
        const recent4 = barPoints.slice(-4);
        const fourWeekAvg = Math.round(
          recent4.reduce((acc, curr) => acc + curr.value, 0) / recent4.length
        );

        setVolumeSummary({ thisWeek, fourWeekAvg, peakWeek });
      } else {
        setVolumeSummary(null);
      }
    } catch (err) {
      console.error('Failed to load volume plot data:', err);
    }
  }, [workoutRepo, unitSystem]);

  // Master refresh controller
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    Promise.all([
      loadBaseMetadata(),
      loadE1RMData(),
      loadBodyweightData(),
      loadBodyFatData(),
      loadCircumferencesData(),
      loadVolumeData(),
    ]).finally(() => {
      if (isMounted) setLoading(false);
    });
    return () => {
      isMounted = false;
    };
  }, [
    loadBaseMetadata,
    loadE1RMData,
    loadBodyweightData,
    loadBodyFatData,
    loadCircumferencesData,
    loadVolumeData,
  ]);

  return (
    <View
      testID="plots-screen"
      style={[styles.container, isInline && styles.inlineContainer]}
    >
      {/* Optional Modal Header */}
      {!isInline && (
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerSubtitle}>LONGITUDINAL PERFORMANCE</Text>
            <Text style={styles.headerTitle}>Progress Analytics</Text>
          </View>

          <View style={styles.headerActions}>
            {onNavigateToBodyMetrics && (
              <TouchableOpacity
                testID="nav-body-metrics-btn"
                style={styles.actionBtn}
                onPress={onNavigateToBodyMetrics}
              >
                <Text style={styles.actionBtnText}>Log Body ⚖️</Text>
              </TouchableOpacity>
            )}

            {onClose && (
              <TouchableOpacity
                testID="plots-close-btn"
                style={styles.closeBtn}
                onPress={onClose}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Segment / Pill Selector (5 Chart Types) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillsContainer}
      >
        <TouchableOpacity
          testID="plot-pill-bodyweight"
          style={[
            styles.pill,
            activeTab === 'bodyweight' && styles.pillActive,
          ]}
          onPress={() => setActiveTab('bodyweight')}
        >
          <Text
            style={[
              styles.pillText,
              activeTab === 'bodyweight' && styles.pillTextActive,
            ]}
          >
            ⚖️ Bodyweight
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="plot-pill-e1rm"
          style={[styles.pill, activeTab === 'e1rm' && styles.pillActive]}
          onPress={() => setActiveTab('e1rm')}
        >
          <Text
            style={[
              styles.pillText,
              activeTab === 'e1rm' && styles.pillTextActive,
            ]}
          >
            📈 e1RM Trends
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="plot-pill-body_fat"
          style={[styles.pill, activeTab === 'body_fat' && styles.pillActive]}
          onPress={() => setActiveTab('body_fat')}
        >
          <Text
            style={[
              styles.pillText,
              activeTab === 'body_fat' && styles.pillTextActive,
            ]}
          >
            🔬 Body Fat %
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="plot-pill-circumferences"
          style={[
            styles.pill,
            activeTab === 'circumferences' && styles.pillActive,
          ]}
          onPress={() => setActiveTab('circumferences')}
        >
          <Text
            style={[
              styles.pillText,
              activeTab === 'circumferences' && styles.pillTextActive,
            ]}
          >
            📏 Tape Measurements
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="plot-pill-volume"
          style={[styles.pill, activeTab === 'volume' && styles.pillActive]}
          onPress={() => setActiveTab('volume')}
        >
          <Text
            style={[
              styles.pillText,
              activeTab === 'volume' && styles.pillTextActive,
            ]}
          >
            📊 Volume Tonnage
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Sub-selectors (e.g. Exercise Picker or Circumference Picker) */}
      {activeTab === 'e1rm' && compoundExercises.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subPillsContainer}
        >
          {compoundExercises.map((ex) => (
            <TouchableOpacity
              key={ex.id}
              testID={`e1rm-ex-${ex.id}`}
              style={[
                styles.subPill,
                selectedExerciseId === ex.id && styles.subPillActive,
              ]}
              onPress={() => setSelectedExerciseId(ex.id)}
            >
              <Text
                style={[
                  styles.subPillText,
                  selectedExerciseId === ex.id && styles.subPillTextActive,
                ]}
              >
                {ex.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {activeTab === 'circumferences' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subPillsContainer}
        >
          {(Object.keys(CIRCUMFERENCE_LABELS) as CircumferenceType[]).map(
            (cKey) => (
              <TouchableOpacity
                key={cKey}
                testID={`circ-btn-${cKey}`}
                style={[
                  styles.subPill,
                  selectedCircumference === cKey && styles.subPillActive,
                ]}
                onPress={() => setSelectedCircumference(cKey)}
              >
                <Text
                  style={[
                    styles.subPillText,
                    selectedCircumference === cKey && styles.subPillTextActive,
                  ]}
                >
                  {CIRCUMFERENCE_LABELS[cKey]}
                </Text>
              </TouchableOpacity>
            )
          )}
        </ScrollView>
      )}

      {/* Loading Indicator */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#00E676" />
          <Text style={styles.loadingText}>Rendering longitudinal curves...</Text>
        </View>
      ) : (
        <View style={styles.chartWrapper}>
          {/* TAB 1: Estimated 1RM Trends */}
          {activeTab === 'e1rm' && (
            <View testID="plot-e1rm-container">
              {e1rmSummary && (
                <View style={styles.summaryStatsRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>CURRENT e1RM</Text>
                    <Text style={styles.statValue}>
                      {formatWeight(e1rmSummary.current, unitSystem)}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>ALL-TIME PEAK</Text>
                    <Text style={[styles.statValue, { color: '#00E676' }]}>
                      {formatWeight(e1rmSummary.peak, unitSystem)}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>NET GAIN</Text>
                    <Text
                      style={[
                        styles.statValue,
                        {
                          color:
                            e1rmSummary.current >= e1rmSummary.start
                              ? '#00E676'
                              : '#EF4444',
                        },
                      ]}
                    >
                      {e1rmSummary.current >= e1rmSummary.start ? '+' : ''}
                      {(e1rmSummary.current - e1rmSummary.start).toFixed(1)}{' '}
                      {unitSystem}
                    </Text>
                  </View>
                </View>
              )}

              <ProgramEraShadedChart
                series={e1rmSeries}
                programEras={programEras}
                yAxisUnit={unitSystem}
                height={210}
                emptyMessage="No completed sessions logged for this exercise yet."
              />
            </View>
          )}

          {/* TAB 2: Bodyweight & 7-Day Rolling Average */}
          {activeTab === 'bodyweight' && (
            <View testID="plot-bodyweight-container">
              {bodyweightSummary && (
                <View style={styles.summaryStatsRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>LATEST WEIGH-IN</Text>
                    <Text style={styles.statValue}>
                      {formatWeight(bodyweightSummary.latest, unitSystem)}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>7-DAY ROLLING AVG</Text>
                    <Text style={[styles.statValue, { color: '#00E676' }]}>
                      {formatWeight(bodyweightSummary.sma7, unitSystem)}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>TRAJECTORY</Text>
                    <Text style={styles.statValue}>
                      {bodyweightSummary.change30d >= 0 ? '+' : ''}
                      {bodyweightSummary.change30d.toFixed(1)} {unitSystem}
                    </Text>
                  </View>
                </View>
              )}

              <ProgramEraShadedChart
                series={bodyweightSeries}
                programEras={programEras}
                yAxisUnit={unitSystem}
                height={210}
                emptyMessage="No bodyweight entries recorded yet. Tap 'Log Body' to start."
              />
            </View>
          )}

          {/* TAB 3: Body Fat % Trends */}
          {activeTab === 'body_fat' && (
            <View testID="plot-bodyfat-container">
              {bodyFatSummary && (
                <View style={styles.summaryStatsRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>NAVY ESTIMATE</Text>
                    <Text style={[styles.statValue, { color: '#00E676' }]}>
                      {bodyFatSummary.latestNavy != null
                        ? `${bodyFatSummary.latestNavy.toFixed(1)}%`
                        : '—'}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>MANUAL ENTRY</Text>
                    <Text style={[styles.statValue, { color: '#3B82F6' }]}>
                      {bodyFatSummary.latestManual != null
                        ? `${bodyFatSummary.latestManual.toFixed(1)}%`
                        : '—'}
                    </Text>
                  </View>
                </View>
              )}

              <ProgramEraShadedChart
                series={bodyFatSeries}
                programEras={programEras}
                yAxisUnit="%"
                height={210}
                emptyMessage="No body fat measurements found. Log neck & waist in Body Metrics."
              />
            </View>
          )}

          {/* TAB 4: Muscle Circumferences */}
          {activeTab === 'circumferences' && (
            <View testID="plot-circumferences-container">
              {circumferenceSummary && (
                <View style={styles.summaryStatsRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>CURRENT</Text>
                    <Text style={styles.statValue}>
                      {formatLength(circumferenceSummary.current, unitSystem)}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>BASELINE</Text>
                    <Text style={styles.statValue}>
                      {formatLength(circumferenceSummary.start, unitSystem)}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>NET DELTA</Text>
                    <Text
                      style={[
                        styles.statValue,
                        {
                          color:
                            circumferenceSummary.delta >= 0
                              ? '#00E676'
                              : '#F59E0B',
                        },
                      ]}
                    >
                      {circumferenceSummary.delta >= 0 ? '+' : ''}
                      {circumferenceSummary.delta.toFixed(1)}{' '}
                      {unitSystem === 'lbs' ? 'in' : 'cm'}
                    </Text>
                  </View>
                </View>
              )}

              <ProgramEraShadedChart
                series={circumferenceSeries}
                programEras={programEras}
                yAxisUnit={unitSystem === 'lbs' ? 'in' : 'cm'}
                height={210}
                emptyMessage={`No ${CIRCUMFERENCE_LABELS[selectedCircumference]} measurements recorded yet.`}
              />
            </View>
          )}

          {/* TAB 5: Weekly Volume Tonnage */}
          {activeTab === 'volume' && (
            <View testID="plot-volume-container">
              {volumeSummary && (
                <View style={styles.summaryStatsRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>THIS WEEK</Text>
                    <Text style={styles.statValue}>
                      {volumeSummary.thisWeek.toLocaleString()} {unitSystem}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>4-WEEK AVG</Text>
                    <Text style={styles.statValue}>
                      {volumeSummary.fourWeekAvg.toLocaleString()} {unitSystem}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>PEAK WEEK</Text>
                    <Text style={[styles.statValue, { color: '#00E676' }]}>
                      {volumeSummary.peakWeek.toLocaleString()} {unitSystem}
                    </Text>
                  </View>
                </View>
              )}

              <ProgramEraShadedChart
                bars={volumeBars}
                programEras={programEras}
                yAxisUnit={unitSystem}
                height={210}
                emptyMessage="No completed workouts found to aggregate weekly tonnage."
              />
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0A0A0A',
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  inlineContainer: {
    paddingHorizontal: 0,
    paddingTop: 0,
    backgroundColor: 'transparent',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerSubtitle: {
    color: '#00E676',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  actionBtnText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  closeBtn: {
    backgroundColor: '#1C1C1E',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#AAAAAA',
    fontSize: 16,
    fontWeight: 'bold',
  },
  pillsContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
    marginBottom: 8,
  },
  pill: {
    backgroundColor: '#181818',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  pillActive: {
    backgroundColor: '#14291B',
    borderColor: '#00E676',
  },
  pillText: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#00E676',
    fontWeight: '700',
  },
  subPillsContainer: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
    marginBottom: 8,
  },
  subPill: {
    backgroundColor: '#141414',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#242424',
  },
  subPillActive: {
    backgroundColor: '#262626',
    borderColor: '#FFFFFF',
  },
  subPillText: {
    color: '#777777',
    fontSize: 11,
  },
  subPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  chartWrapper: {
    marginTop: 2,
  },
  summaryStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#141414',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222222',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  statBox: {
    alignItems: 'center',
  },
  statLabel: {
    color: '#777777',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  loadingBox: {
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#888888',
    fontSize: 12,
  },
});
