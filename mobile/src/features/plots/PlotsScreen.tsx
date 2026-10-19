import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  IUserProfileRepository,
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
  calculateEstimatedLeanBodyMass,
  calculateChronologicalELBM,
  calculateNavyBodyFat,
  parseIsoDateToMs,
  RollingAveragePoint,
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
  WorkoutSet,
  WeightUnit,
  UserProfile,
} from '../../core/types';
import {
  PlotTimeSpan,
  TIME_SPAN_OPTIONS,
  filterDataByTimeSpan,
  filterWeeklyBarsByTimeSpan,
} from './timeSpanUtils';

export * from './timeSpanUtils';

export type PlotChartType =
  | 'e1rm'
  | 'bodyweight'
  | 'body_fat'
  | 'elbm'
  | 'circumferences'
  | 'volume';

export type PlotGroup = 'performance' | 'body_composition';

export const PERFORMANCE_CHARTS: PlotChartType[] = ['e1rm', 'volume'];
export const BODY_COMPOSITION_CHARTS: PlotChartType[] = [
  'bodyweight',
  'body_fat',
  'elbm',
  'circumferences',
];

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
  userProfileRepo?: IUserProfileRepository;
  programRepo?: IProgramRepository;
  programBlockService?: ProgramBlockService;
  userSettingsRepo?: IUserSettingsRepository;
  initialChartType?: PlotChartType;
  targetGroup?: PlotGroup;
  initialTimeSpan?: PlotTimeSpan;
  timeSpan?: PlotTimeSpan;
  onTimeSpanChange?: (timeSpan: PlotTimeSpan) => void;
  referenceDate?: Date;
  onNavigateToBodyMetrics?: () => void;
  onClose?: () => void;
  isInline?: boolean;
}

export const PlotsScreen: React.FC<PlotsScreenProps> = ({
  workoutRepo,
  exerciseRepo,
  bodyMetricsRepo,
  userProfileRepo,
  programRepo,
  programBlockService,
  userSettingsRepo,
  initialChartType,
  targetGroup,
  initialTimeSpan,
  timeSpan: controlledTimeSpan,
  onTimeSpanChange,
  referenceDate,
  onNavigateToBodyMetrics,
  onClose,
  isInline = false,
}) => {
  const initialGroup: PlotGroup =
    targetGroup ??
    (initialChartType && PERFORMANCE_CHARTS.includes(initialChartType)
      ? 'performance'
      : 'body_composition');

  const [activeGroup, setActiveGroup] = useState<PlotGroup>(initialGroup);
  const effectiveGroup: PlotGroup = targetGroup ?? activeGroup;

  const defaultTab: PlotChartType =
    initialChartType ??
    (effectiveGroup === 'performance' ? 'e1rm' : 'bodyweight');

  const [activeTab, setActiveTab] = useState<PlotChartType>(defaultTab);

  const [internalTimeSpan, setInternalTimeSpan] = useState<PlotTimeSpan>(
    initialTimeSpan ?? 'all'
  );
  const selectedTimeSpan = controlledTimeSpan ?? internalTimeSpan;

  const handleTimeSpanChange = (span: PlotTimeSpan) => {
    setInternalTimeSpan(span);
    onTimeSpanChange?.(span);
  };

  useEffect(() => {
    if (targetGroup) {
      setActiveGroup(targetGroup);
      if (targetGroup === 'performance' && !PERFORMANCE_CHARTS.includes(activeTab)) {
        setActiveTab('e1rm');
      } else if (
        targetGroup === 'body_composition' &&
        !BODY_COMPOSITION_CHARTS.includes(activeTab)
      ) {
        setActiveTab('bodyweight');
      }
    }
  }, [targetGroup]);

  const [loading, setLoading] = useState<boolean>(true);
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Program era metadata
  const [programEras, setProgramEras] = useState<ProgramEraInfo[]>([]);

  // 1RM Data State
  const [compoundExercises, setCompoundExercises] = useState<Exercise[]>([]);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>('');
  const [rawE1rmPoints, setRawE1rmPoints] = useState<{ date: string; value: number }[]>([]);

  // Bodyweight Data State
  const [rawBodyweightPoints, setRawBodyweightPoints] = useState<RollingAveragePoint[]>([]);

  // Body Fat Data State
  const [rawNavyPoints, setRawNavyPoints] = useState<{ date: string; value: number }[]>([]);
  const [rawManualPoints, setRawManualPoints] = useState<{ date: string; value: number }[]>([]);

  // Estimated Lean Body Mass (eLBM) Data State
  const [rawElbmPoints, setRawElbmPoints] = useState<{ date: string; value: number }[]>([]);

  // Circumferences Data State
  const [selectedCircumference, setSelectedCircumference] =
    useState<CircumferenceType>('waist_cm');
  const [rawCircumferencePoints, setRawCircumferencePoints] = useState<{ date: string; value: number }[]>([]);

  // Volume Data State
  const [rawVolumeBars, setRawVolumeBars] = useState<ChartBarPoint[]>([]);

  // Derived filtered series & summaries via useMemo (instant responsive updates on time-span change)
  const { e1rmSeries, e1rmSummary } = useMemo(() => {
    const pts = filterDataByTimeSpan(rawE1rmPoints, selectedTimeSpan, referenceDate);
    if (pts.length === 0) {
      return { e1rmSeries: [] as ChartSeries[], e1rmSummary: null };
    }
    const start = pts[0].value;
    const current = pts[pts.length - 1].value;
    const peak = Math.max(...pts.map((d) => d.value));
    return {
      e1rmSeries: [
        {
          id: 'e1rm_series',
          name: 'e1RM Trend',
          color: '#00E676',
          data: pts,
          strokeWidth: 2.5,
        },
      ],
      e1rmSummary: { start, peak, current },
    };
  }, [rawE1rmPoints, selectedTimeSpan, referenceDate]);

  const { bodyweightSeries, bodyweightSummary } = useMemo(() => {
    const pts = filterDataByTimeSpan(rawBodyweightPoints, selectedTimeSpan, referenceDate);
    if (pts.length === 0) {
      return { bodyweightSeries: [] as ChartSeries[], bodyweightSummary: null };
    }
    const rawPoints = pts.map((p) => ({
      date: p.date,
      value: unitSystem === 'lbs' ? kgToLbs(p.bodyweight) : p.bodyweight,
    }));
    const smaPoints = pts.map((p) => ({
      date: p.date,
      value: unitSystem === 'lbs' ? kgToLbs(p.sma7) : p.sma7,
    }));

    const latest = rawPoints[rawPoints.length - 1].value;
    const latestSma = smaPoints[smaPoints.length - 1].value;
    const first = rawPoints[0].value;
    const change30d = latest - first;

    return {
      bodyweightSeries: [
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
      ],
      bodyweightSummary: {
        latest,
        sma7: latestSma,
        change30d,
      },
    };
  }, [rawBodyweightPoints, selectedTimeSpan, referenceDate, unitSystem]);

  const { bodyFatSeries, bodyFatSummary } = useMemo(() => {
    const navyPts = filterDataByTimeSpan(rawNavyPoints, selectedTimeSpan, referenceDate);
    const manualPts = filterDataByTimeSpan(rawManualPoints, selectedTimeSpan, referenceDate);

    const series: ChartSeries[] = [];
    if (navyPts.length > 0) {
      series.push({
        id: 'navy_bf',
        name: 'Navy Formula',
        color: '#00E676',
        data: navyPts,
        strokeWidth: 2.5,
      });
    }
    if (manualPts.length > 0) {
      series.push({
        id: 'manual_bf',
        name: 'Manual Entry',
        color: '#3B82F6',
        data: manualPts,
        strokeWidth: 2,
        strokeDasharray: '4,4',
      });
    }

    const latestNavy = navyPts.length > 0 ? navyPts[navyPts.length - 1].value : null;
    const latestManual = manualPts.length > 0 ? manualPts[manualPts.length - 1].value : null;

    if (latestNavy === null && latestManual === null) {
      return { bodyFatSeries: [] as ChartSeries[], bodyFatSummary: null };
    }
    return {
      bodyFatSeries: series,
      bodyFatSummary: { latestNavy, latestManual },
    };
  }, [rawNavyPoints, rawManualPoints, selectedTimeSpan, referenceDate]);

  const { elbmSeries, elbmSummary } = useMemo(() => {
    const pts = filterDataByTimeSpan(rawElbmPoints, selectedTimeSpan, referenceDate);
    if (pts.length === 0) {
      return { elbmSeries: [] as ChartSeries[], elbmSummary: null };
    }
    const displayPts = pts.map((p) => ({
      date: p.date,
      value: unitSystem === 'lbs' ? kgToLbs(p.value) : p.value,
    }));
    const startKg = pts[0].value;
    const latestKg = pts[pts.length - 1].value;
    const peakKg = Math.max(...pts.map((d) => d.value));
    const deltaDisplay =
      unitSystem === 'lbs'
        ? kgToLbs(latestKg - startKg)
        : latestKg - startKg;

    return {
      elbmSeries: [
        {
          id: 'elbm_series',
          name: 'eLBM (Navy)',
          color: '#10B981',
          data: displayPts,
          strokeWidth: 2.5,
          dotRadius: 3.5,
        },
      ],
      elbmSummary: { latestKg, peakKg, deltaDisplay },
    };
  }, [rawElbmPoints, selectedTimeSpan, referenceDate, unitSystem]);

  const { circumferenceSeries, circumferenceSummary } = useMemo(() => {
    const pts = filterDataByTimeSpan(rawCircumferencePoints, selectedTimeSpan, referenceDate);
    if (pts.length === 0) {
      return { circumferenceSeries: [] as ChartSeries[], circumferenceSummary: null };
    }
    const start = pts[0].value;
    const current = pts[pts.length - 1].value;
    const delta = current - start;

    return {
      circumferenceSeries: [
        {
          id: `circ_${selectedCircumference}`,
          name: CIRCUMFERENCE_LABELS[selectedCircumference],
          color: '#F59E0B',
          data: pts,
          strokeWidth: 2.5,
        },
      ],
      circumferenceSummary: { current, start, delta },
    };
  }, [rawCircumferencePoints, selectedTimeSpan, referenceDate, selectedCircumference]);

  const { volumeBars, volumeSummary } = useMemo(() => {
    const bars = filterWeeklyBarsByTimeSpan(rawVolumeBars, selectedTimeSpan, referenceDate);
    if (bars.length === 0) {
      return { volumeBars: [] as ChartBarPoint[], volumeSummary: null };
    }
    const thisWeek = bars[bars.length - 1].value;
    const peakWeek = Math.max(...bars.map((b) => b.value));
    const recent4 = bars.slice(-4);
    const fourWeekAvg = Math.round(
      recent4.reduce((acc, curr) => acc + curr.value, 0) / recent4.length
    );
    return {
      volumeBars: bars,
      volumeSummary: { thisWeek, fourWeekAvg, peakWeek },
    };
  }, [rawVolumeBars, selectedTimeSpan, referenceDate]);

  // 1. Load initial user settings & program eras
  const loadBaseMetadata = useCallback(async () => {
    try {
      if (userSettingsRepo) {
        const u = await userSettingsRepo.get('unit_system');
        if (u === 'lbs' || u === 'kg') setUnitSystem(u);
      }

      if (userProfileRepo) {
        const profile = await userProfileRepo.getProfile();
        setUserProfile(profile);
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
  }, [userSettingsRepo, userProfileRepo, programRepo, programBlockService, exerciseRepo, selectedExerciseId]);

  // 2. Load e1RM Time-Series
  const loadE1RMData = useCallback(async () => {
    if (!selectedExerciseId) return;

    try {
      const allWorkouts = await workoutRepo.findAll();
      const completed = allWorkouts.filter((w) => w.status === 'completed');

      const dataPoints: { date: string; value: number }[] = [];

      const allSets = await workoutRepo.getSetsByWorkoutIds(completed.map((w) => w.id));
      const setsByWorkoutId = new Map<string, WorkoutSet[]>();
      for (const s of allSets) {
        if (s.exercise_id === selectedExerciseId) {
          const arr = setsByWorkoutId.get(s.workout_id) || [];
          arr.push(s);
          setsByWorkoutId.set(s.workout_id, arr);
        }
      }

      for (const w of completed) {
        const exSets = setsByWorkoutId.get(w.id) || [];

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
      setRawE1rmPoints(dataPoints);
    } catch (err) {
      console.error('Failed to load e1RM plot data:', err);
    }
  }, [selectedExerciseId, workoutRepo, unitSystem]);

  // 3. Load Bodyweight & Rolling Avg Time-Series
  const loadBodyweightData = useCallback(async () => {
    if (!bodyMetricsRepo) return;

    try {
      const metrics = await bodyMetricsRepo.getAll();
      const entries = metrics
        .filter(
          (m): m is BodyMetric & { bodyweight: number } =>
            m.bodyweight != null && m.bodyweight > 0
        )
        .map((m) => ({
          date: m.date,
          bodyweight: m.bodyweight,
        }));

      const smoothed = calculateBodyweightRollingAverages(entries);
      setRawBodyweightPoints(smoothed);
    } catch (err) {
      console.error('Failed to load bodyweight plot data:', err);
    }
  }, [bodyMetricsRepo]);

  // 4. Load Body Fat Trends Time-Series
  const loadBodyFatData = useCallback(async () => {
    if (!bodyMetricsRepo) return;

    try {
      let profile = userProfile;
      if (!profile && userProfileRepo) {
        profile = await userProfileRepo.getProfile();
      }

      const metrics = await bodyMetricsRepo.getAll();
      const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date));

      const navyPoints: { date: string; value: number }[] = [];
      const manualPoints: { date: string; value: number }[] = [];

      let lastWaist: number | null = null;
      let lastNeck: number | null = null;
      let lastHip: number | null = null;
      const gender = profile?.gender || 'male';
      const heightCm = profile?.height_cm;

      for (const m of sorted) {
        if (typeof m.waist_cm === 'number' && m.waist_cm > 0) lastWaist = m.waist_cm;
        if (typeof m.neck_cm === 'number' && m.neck_cm > 0) lastNeck = m.neck_cm;
        if (typeof m.hip_cm === 'number' && m.hip_cm > 0) lastHip = m.hip_cm;

        let navyBf: number | null =
          typeof m.navy_body_fat === 'number' && m.navy_body_fat > 0
            ? m.navy_body_fat
            : null;

        // Recalculate via LOCF if missing on row but circumference session occurred
        if (
          navyBf == null &&
          (m.waist_cm != null || m.neck_cm != null) &&
          heightCm &&
          lastWaist &&
          lastNeck
        ) {
          navyBf = calculateNavyBodyFat({
            gender,
            heightCm,
            waistCm: lastWaist,
            neckCm: lastNeck,
            hipCm: lastHip,
          });
        }

        if (navyBf != null && navyBf > 0) {
          navyPoints.push({ date: m.date, value: navyBf });
        }
        if (m.body_fat_manual != null && m.body_fat_manual > 0) {
          manualPoints.push({ date: m.date, value: m.body_fat_manual });
        }
      }

      // Deduplicate points by date, keeping the latest for each date
      const dedupeByDate = (pts: { date: string; value: number }[]) => {
        const map = new Map<string, { date: string; value: number }>();
        for (const p of pts) {
          map.set(p.date, p);
        }
        return Array.from(map.values());
      };

      setRawNavyPoints(dedupeByDate(navyPoints));
      setRawManualPoints(dedupeByDate(manualPoints));
    } catch (err) {
      console.error('Failed to load body fat plot data:', err);
    }
  }, [bodyMetricsRepo, userProfile, userProfileRepo]);

  // 5. Load Estimated Lean Body Mass (eLBM) Time-Series
  const loadElbmData = useCallback(async () => {
    if (!bodyMetricsRepo) return;

    try {
      let profile = userProfile;
      if (!profile && userProfileRepo) {
        profile = await userProfileRepo.getProfile();
      }

      const metrics = await bodyMetricsRepo.getAll();
      const elbmPoints = calculateChronologicalELBM(metrics, {
        gender: profile?.gender || 'male',
        heightCm: profile?.height_cm,
      });

      const points = elbmPoints.map((p) => ({
        date: p.date,
        value: p.elbmKg,
      }));

      setRawElbmPoints(points);
    } catch (err) {
      console.error('Failed to load eLBM plot data:', err);
    }
  }, [bodyMetricsRepo, userProfile, userProfileRepo]);

  // 6. Load Circumference Measurements
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

      setRawCircumferencePoints(points);
    } catch (err) {
      console.error('Failed to load circumferences plot data:', err);
    }
  }, [bodyMetricsRepo, selectedCircumference, unitSystem]);

  // 7. Load Weekly Tonnage Volume
  const loadVolumeData = useCallback(async () => {
    try {
      const allWorkouts = await workoutRepo.findAll();
      const completed = allWorkouts.filter((w) => w.status === 'completed');

      // Group workouts into week buckets (Monday-based YYYY-MM-DD)
      const weekMap = new Map<string, number>();

      const allSets = await workoutRepo.getSetsByWorkoutIds(completed.map((w) => w.id));
      const setsByWorkoutId = new Map<string, WorkoutSet[]>();
      for (const s of allSets) {
        const arr = setsByWorkoutId.get(s.workout_id) || [];
        arr.push(s);
        setsByWorkoutId.set(s.workout_id, arr);
      }

      for (const w of completed) {
        const sets = setsByWorkoutId.get(w.id) || [];
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
      setRawVolumeBars(barPoints);
    } catch (err) {
      console.error('Failed to load volume plot data:', err);
    }
  }, [workoutRepo, unitSystem]);

  // Base metadata loader on mount
  useEffect(() => {
    let isMounted = true;
    loadBaseMetadata();
    return () => {
      isMounted = false;
    };
  }, [loadBaseMetadata]);

  // Selective lazy-loader conditioned on activeTab
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const loadActiveChartData = async () => {
      try {
        switch (activeTab) {
          case 'e1rm':
            await loadE1RMData();
            break;
          case 'volume':
            await loadVolumeData();
            break;
          case 'bodyweight':
            await loadBodyweightData();
            break;
          case 'body_fat':
            await loadBodyFatData();
            break;
          case 'elbm':
            await loadElbmData();
            break;
          case 'circumferences':
            await loadCircumferencesData();
            break;
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadActiveChartData();

    return () => {
      isMounted = false;
    };
  }, [
    activeTab,
    loadE1RMData,
    loadVolumeData,
    loadBodyweightData,
    loadBodyFatData,
    loadElbmData,
    loadCircumferencesData,
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

      {/* Group Selector Switcher (when targetGroup is not locked) */}
      {!targetGroup && (
        <View style={styles.groupSwitchRow}>
          <TouchableOpacity
            testID="plot-group-performance-btn"
            style={[
              styles.groupSwitchBtn,
              effectiveGroup === 'performance' && styles.groupSwitchBtnActive,
            ]}
            onPress={() => {
              setActiveGroup('performance');
              if (!PERFORMANCE_CHARTS.includes(activeTab)) {
                setActiveTab('e1rm');
              }
            }}
          >
            <Text
              style={[
                styles.groupSwitchText,
                effectiveGroup === 'performance' && styles.groupSwitchTextActive,
              ]}
            >
              ⚡ Strength & Performance
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="plot-group-body-btn"
            style={[
              styles.groupSwitchBtn,
              effectiveGroup === 'body_composition' && styles.groupSwitchBtnActive,
            ]}
            onPress={() => {
              setActiveGroup('body_composition');
              if (!BODY_COMPOSITION_CHARTS.includes(activeTab)) {
                setActiveTab('bodyweight');
              }
            }}
          >
            <Text
              style={[
                styles.groupSwitchText,
                effectiveGroup === 'body_composition' && styles.groupSwitchTextActive,
              ]}
            >
              ⚖️ Body Composition
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Segment / Pill Selector (Filtered by active group) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillsContainer}
      >
        {effectiveGroup === 'body_composition' && (
          <>
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
              testID="plot-pill-elbm"
              style={[styles.pill, activeTab === 'elbm' && styles.pillActive]}
              onPress={() => setActiveTab('elbm')}
            >
              <Text
                style={[
                  styles.pillText,
                  activeTab === 'elbm' && styles.pillTextActive,
                ]}
              >
                💪 eLBM
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
          </>
        )}

        {effectiveGroup === 'performance' && (
          <>
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
          </>
        )}
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

      {/* Time Span Filter Bar */}
      <View style={styles.timeSpanRow} testID="plot-timespan-selector">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.timeSpanContainer}
        >
          {TIME_SPAN_OPTIONS.map((opt) => {
            const isActive = selectedTimeSpan === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                testID={`plot-timespan-${opt.key}`}
                style={[
                  styles.timeSpanBtn,
                  isActive && styles.timeSpanBtnActive,
                ]}
                onPress={() => handleTimeSpanChange(opt.key)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.timeSpanText,
                    isActive && styles.timeSpanTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

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
                    <Text style={styles.statLabel}>
                      {selectedTimeSpan === 'all' ? 'ALL-TIME PEAK' : 'PERIOD PEAK'}
                    </Text>
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
                emptyMessage={
                  selectedTimeSpan === 'all'
                    ? 'No completed sessions logged for this exercise yet.'
                    : `No completed sessions logged for this exercise in the selected time span (${TIME_SPAN_OPTIONS.find((o) => o.key === selectedTimeSpan)?.label ?? selectedTimeSpan}).`
                }
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
                emptyMessage={
                  selectedTimeSpan === 'all'
                    ? "No bodyweight entries recorded yet. Tap 'Log Body' to start."
                    : `No bodyweight entries recorded in the selected time span (${TIME_SPAN_OPTIONS.find((o) => o.key === selectedTimeSpan)?.label ?? selectedTimeSpan}).`
                }
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
                emptyMessage={
                  selectedTimeSpan === 'all'
                    ? 'No body fat measurements found. Log neck & waist in Body Metrics.'
                    : `No body fat measurements found in the selected time span (${TIME_SPAN_OPTIONS.find((o) => o.key === selectedTimeSpan)?.label ?? selectedTimeSpan}).`
                }
              />
            </View>
          )}

          {/* TAB: Estimated Lean Body Mass (eLBM) */}
          {activeTab === 'elbm' && (
            <View testID="plot-elbm-container">
              {elbmSummary && (
                <View style={styles.summaryStatsRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>LATEST eLBM</Text>
                    <Text
                      style={[styles.statValue, { color: '#10B981' }]}
                      testID="elbm-latest-stat"
                    >
                      {formatWeight(elbmSummary.latestKg, unitSystem)}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>
                      {selectedTimeSpan === 'all' ? 'ALL-TIME PEAK' : 'PERIOD PEAK'}
                    </Text>
                    <Text style={styles.statValue} testID="elbm-peak-stat">
                      {formatWeight(elbmSummary.peakKg, unitSystem)}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>NET TRAJECTORY</Text>
                    <Text
                      style={[
                        styles.statValue,
                        {
                          color:
                            elbmSummary.deltaDisplay >= 0 ? '#10B981' : '#EF4444',
                        },
                      ]}
                      testID="elbm-trajectory-stat"
                    >
                      {elbmSummary.deltaDisplay >= 0 ? '+' : ''}
                      {elbmSummary.deltaDisplay.toFixed(1)} {unitSystem}
                    </Text>
                  </View>
                </View>
              )}

              <ProgramEraShadedChart
                series={elbmSeries}
                programEras={programEras}
                yAxisUnit={unitSystem}
                height={210}
                emptyMessage={
                  selectedTimeSpan === 'all'
                    ? 'No eLBM data available. Log bodyweight, neck & waist in Body Metrics.'
                    : `No eLBM data found in the selected time span (${TIME_SPAN_OPTIONS.find((o) => o.key === selectedTimeSpan)?.label ?? selectedTimeSpan}).`
                }
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
                emptyMessage={
                  selectedTimeSpan === 'all'
                    ? `No ${CIRCUMFERENCE_LABELS[selectedCircumference]} measurements recorded yet.`
                    : `No ${CIRCUMFERENCE_LABELS[selectedCircumference]} measurements recorded in the selected time span (${TIME_SPAN_OPTIONS.find((o) => o.key === selectedTimeSpan)?.label ?? selectedTimeSpan}).`
                }
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
                emptyMessage={
                  selectedTimeSpan === 'all'
                    ? 'No completed workouts found to aggregate weekly tonnage.'
                    : `No completed workouts found in the selected time span (${TIME_SPAN_OPTIONS.find((o) => o.key === selectedTimeSpan)?.label ?? selectedTimeSpan}).`
                }
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
  groupSwitchRow: {
    flexDirection: 'row',
    backgroundColor: '#181818',
    borderRadius: 10,
    padding: 3,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#262626',
  },
  groupSwitchBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
  },
  groupSwitchBtnActive: {
    backgroundColor: '#262626',
    borderWidth: 1,
    borderColor: '#00E676',
  },
  groupSwitchText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888888',
  },
  groupSwitchTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  timeSpanRow: {
    marginBottom: 8,
  },
  timeSpanContainer: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  timeSpanBtn: {
    backgroundColor: '#141416',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  timeSpanBtnActive: {
    backgroundColor: '#14291B',
    borderColor: '#00E676',
  },
  timeSpanText: {
    color: '#71717A',
    fontSize: 11,
    fontWeight: '600',
  },
  timeSpanTextActive: {
    color: '#00E676',
    fontWeight: '700',
  },
});
