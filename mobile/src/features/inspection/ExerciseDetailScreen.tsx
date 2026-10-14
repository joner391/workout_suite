/**
 * Workout Suite — ExerciseDetailScreen
 *
 * Implements Step 3.3: Exercise Inspection UI, SBD Tier Widget & Symmetry Radar
 * Implements ADR-011: SBD Standards, Continuous Score & Demographic Percentile
 * Implements ADR-012: Exercise Variant Hierarchy & Cross-Variant PR Aggregation
 * Implements ADR-024: Pure Utility Mode (OLED-friendly high-contrast styling)
 *
 * Capabilities:
 * - Comprehensive exercise deep-dive profile (lifetime sessions, sets, volume tonnage)
 * - Rep-Max PR Board with All-Time vs. Program Block scoping and variant toggling
 * - Tap-to-view historical workout session via SessionDetailModal
 * - SBD Allometric Classification Card with progress bar, bell curve, and conditional DOTS
 * - Dedicated SBD Balance & Symmetry Radar Chart modal
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
} from 'react-native';
import {
  Exercise,
  Gender,
  IntensityMetric,
  PRBoardResult,
  SBDBalanceProfile,
  StrengthStandardSummaryResult,
  WeightUnit,
} from '../../core/types';
import { IExerciseRepository } from '../../domain/repositories/IExerciseRepository';
import { IWorkoutRepository } from '../../domain/repositories/IWorkoutRepository';
import { IUserSettingsRepository } from '../../domain/repositories/IUserSettingsRepository';
import { IGearRepository } from '../../domain/repositories/IGearRepository';
import { ExerciseInspectionService } from '../../services/exerciseInspectionService';
import { PRBoardTable } from './PRBoardTable';
import { SBDStandardsCard } from './SBDStandardsCard';
import { SBDBalanceRadarChart } from './SBDBalanceRadarChart';
import { SessionDetailModal } from '../calendar/SessionDetailModal';
import { formatWeight, kgToLbs } from '../../core/math/unitConversion';

export interface ExerciseDetailScreenProps {
  exerciseId: string;
  exerciseRepo: IExerciseRepository;
  workoutRepo: IWorkoutRepository;
  userSettingsRepo?: IUserSettingsRepository;
  gearRepo?: IGearRepository;
  inspectionService?: ExerciseInspectionService;
  onClose?: () => void;
}

export const ExerciseDetailScreen: React.FC<ExerciseDetailScreenProps> = ({
  exerciseId,
  exerciseRepo,
  workoutRepo,
  userSettingsRepo,
  gearRepo,
  inspectionService: propInspectionService,
  onClose,
}) => {
  const inspectionService = useMemo(
    () => propInspectionService ?? new ExerciseInspectionService(workoutRepo, exerciseRepo),
    [propInspectionService, workoutRepo, exerciseRepo]
  );

  const [loading, setLoading] = useState<boolean>(true);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [prBoard, setPrBoard] = useState<PRBoardResult | null>(null);
  const [standardSummary, setStandardSummary] = useState<StrengthStandardSummaryResult | null>(null);
  const [balanceProfile, setBalanceProfile] = useState<SBDBalanceProfile | null>(null);
  const [hasVariants, setHasVariants] = useState<boolean>(false);

  // User Profile & Settings
  const [userGender, setUserGender] = useState<Gender>('male');
  const [userBodyweightKg, setUserBodyweightKg] = useState<number | null>(null);
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');
  const [intensityMetric, setIntensityMetric] = useState<IntensityMetric>('RPE');

  // Filter States
  const [scope, setScope] = useState<'all_time' | 'program_block'>('all_time');
  const [includeVariants, setIncludeVariants] = useState<boolean>(false);
  const [tableLoading, setTableLoading] = useState<boolean>(false);

  // Lifetime History Metrics
  const [historyStats, setHistoryStats] = useState<{
    totalSessions: number;
    totalSets: number;
    totalVolumeKg: number;
    firstLoggedDate: string | null;
    lastLoggedDate: string | null;
  }>({
    totalSessions: 0,
    totalSets: 0,
    totalVolumeKg: 0,
    firstLoggedDate: null,
    lastLoggedDate: null,
  });

  // Modals
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);
  const [showRadarModal, setShowRadarModal] = useState<boolean>(false);

  // Load User Preferences
  const loadPreferences = useCallback(async () => {
    if (!userSettingsRepo) return;
    try {
      const [gender, bw, unit, intensity] = await Promise.all([
        userSettingsRepo.getUserGender(),
        userSettingsRepo.getUserBodyweight(),
        userSettingsRepo.getUnitSystem(),
        userSettingsRepo.getIntensityMetric(),
      ]);
      setUserGender(gender);
      setUserBodyweightKg(bw);
      setUnitSystem(unit);
      setIntensityMetric(intensity);
    } catch {
      // Use defaults
    }
  }, [userSettingsRepo]);

  // Load Exercise & Initial Overview
  const loadExerciseData = useCallback(async () => {
    try {
      setLoading(true);
      const ex = await exerciseRepo.findById(exerciseId);
      if (!ex) return;
      setExercise(ex);

      // Check if this movement has variants or is a variant
      const rootId = ex.parent_exercise_id || ex.id;
      const variants = await exerciseRepo.findVariants(rootId);
      setHasVariants(variants.length > 0 || !!ex.parent_exercise_id);

      // Fetch Overview
      const overview = await inspectionService.getExerciseInspectionOverview({
        exerciseId,
        gender: userGender,
        bodyweightKg: userBodyweightKg,
        prBoardOptions: {
          scope,
          includeVariants,
        },
      });

      setPrBoard(overview.prBoard);
      setStandardSummary(overview.standardSummary);
      setHistoryStats(overview.historySummary);

      // If an SBD lift, fetch composite radar profile if bodyweight is entered
      if (
        ex.standard_lift_type === 'squat' ||
        ex.standard_lift_type === 'bench' ||
        ex.standard_lift_type === 'deadlift'
      ) {
        if (userBodyweightKg && userBodyweightKg > 0) {
          const profile = await inspectionService.getSBDBalanceProfile({
            gender: userGender,
            bodyweightKg: userBodyweightKg,
          });
          setBalanceProfile(profile);
        } else {
          setBalanceProfile(null);
        }
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [
    exerciseId,
    exerciseRepo,
    inspectionService,
    userGender,
    userBodyweightKg,
    scope,
    includeVariants,
  ]);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  useEffect(() => {
    loadExerciseData();
  }, [loadExerciseData]);

  // Update PR Board when scope or includeVariants changes
  const handleScopeChange = async (newScope: 'all_time' | 'program_block') => {
    setScope(newScope);
    try {
      setTableLoading(true);
      const newPR = await inspectionService.getPRBoard({
        exerciseId,
        scope: newScope,
        includeVariants,
      });
      setPrBoard(newPR);
    } catch {
      // Ignore
    } finally {
      setTableLoading(false);
    }
  };

  const handleIncludeVariantsChange = async (include: boolean) => {
    setIncludeVariants(include);
    try {
      setTableLoading(true);
      const newPR = await inspectionService.getPRBoard({
        exerciseId,
        scope,
        includeVariants: include,
      });
      setPrBoard(newPR);
    } catch {
      // Ignore
    } finally {
      setTableLoading(false);
    }
  };

  // Update User Profile (Gender & Bodyweight)
  const handleUpdateProfile = async (newGender: Gender, newBwKg: number | null) => {
    setUserGender(newGender);
    setUserBodyweightKg(newBwKg);
    if (userSettingsRepo) {
      await userSettingsRepo.setUserGender(newGender);
      await userSettingsRepo.setUserBodyweight(newBwKg);
    }
    // Re-evaluate standards
    try {
      const summary = await inspectionService.getStrengthStandardSummary({
        exerciseId,
        gender: newGender,
        bodyweightKg: newBwKg,
      });
      setStandardSummary(summary);

      if (newBwKg && newBwKg > 0) {
        const profile = await inspectionService.getSBDBalanceProfile({
          gender: newGender,
          bodyweightKg: newBwKg,
        });
        setBalanceProfile(profile);
      } else {
        setBalanceProfile(null);
      }
    } catch {
      // Ignore
    }
  };

  if (loading || !exercise) {
    return (
      <View style={styles.loadingScreen} testID="exercise-detail-loading">
        <ActivityIndicator size="large" color="#00E676" />
        <Text style={styles.loadingText}>Loading exercise analytics...</Text>
      </View>
    );
  }

  // Display Total Volume in current units
  const displayLifetimeVolume =
    unitSystem === 'lbs'
      ? `${formatWeight(kgToLbs(historyStats.totalVolumeKg))} lbs`
      : `${formatWeight(historyStats.totalVolumeKg)} kg`;

  // Display Peak e1RM
  const peakE1rmDisplay = prBoard?.peakRecord
    ? `${formatWeight(
        unitSystem === 'lbs'
          ? kgToLbs(prBoard.peakRecord.e1rmKg)
          : prBoard.peakRecord.e1rmKg
      )} ${unitSystem}`
    : '—';

  return (
    <View style={styles.container} testID="exercise-detail-screen">
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleCol}>
          <Text style={styles.headerSubtitle}>
            {exercise.muscle_group.toUpperCase()} • {exercise.category.toUpperCase()}
          </Text>
          <Text style={styles.headerTitle}>{exercise.name}</Text>
          {exercise.default_bar_weight_kg > 0 && exercise.category === 'Barbell' && (
            <Text style={styles.gearTareSubtext}>
              Tare: {exercise.default_bar_weight_kg} kg standard bar
            </Text>
          )}
        </View>

        {onClose && (
          <TouchableOpacity
            testID="close-exercise-detail-btn"
            style={styles.closeBtn}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Lifetime Summary Stats Bar */}
        <View style={styles.summaryBar} testID="exercise-summary-stats">
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>PEAK e1RM</Text>
            <Text style={styles.statValueAccent}>{peakE1rmDisplay}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>TOTAL SESSIONS</Text>
            <Text style={styles.statValue}>{historyStats.totalSessions}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>TOTAL SETS</Text>
            <Text style={styles.statValue}>{historyStats.totalSets}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>LIFETIME TONNAGE</Text>
            <Text style={styles.statValue}>{displayLifetimeVolume}</Text>
          </View>
        </View>

        {/* SBD Strength Standards Card (If Standard Lift) */}
        {standardSummary?.isStandardLift && standardSummary.liftType && (
          <SBDStandardsCard
            liftType={standardSummary.liftType}
            standardResult={standardSummary.standardResult}
            userGender={userGender}
            userBodyweightKg={userBodyweightKg}
            unitSystem={unitSystem}
            onUpdateProfile={handleUpdateProfile}
            onOpenRadar={() => setShowRadarModal(true)}
          />
        )}

        {/* Rep-Max PR Board Section */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>REP-MAX PR BOARD</Text>
          <Text style={styles.sectionCountText}>
            {prBoard?.records.length ?? 0} PRs
          </Text>
        </View>

        <PRBoardTable
          records={prBoard?.records ?? []}
          peakRecord={prBoard?.peakRecord ?? null}
          scope={scope}
          onScopeChange={handleScopeChange}
          includeVariants={includeVariants}
          onIncludeVariantsChange={handleIncludeVariantsChange}
          hasVariants={hasVariants}
          unitSystem={unitSystem}
          intensityMetric={intensityMetric}
          onSelectWorkout={(workoutId) => setSelectedWorkoutId(workoutId)}
          loading={tableLoading}
        />
      </ScrollView>

      {/* Historical Session Detail Modal */}
      {selectedWorkoutId && (
        <SessionDetailModal
          visible={!!selectedWorkoutId}
          workoutId={selectedWorkoutId}
          workoutRepo={workoutRepo}
          exerciseRepo={exerciseRepo}
          userSettingsRepo={userSettingsRepo}
          unitSystem={unitSystem}
          intensityMetric={intensityMetric}
          onClose={() => setSelectedWorkoutId(null)}
        />
      )}

      {/* SBD Balance Radar Modal */}
      {showRadarModal && (
        <Modal
          visible={showRadarModal}
          animationType="slide"
          onRequestClose={() => setShowRadarModal(false)}
        >
          <SBDBalanceRadarChart
            balanceProfile={balanceProfile}
            gender={userGender}
            bodyweightKg={userBodyweightKg}
            unitSystem={unitSystem}
            onClose={() => setShowRadarModal(false)}
            onOpenProfile={() => setShowRadarModal(false)}
          />
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#A1A1AA',
    fontSize: 14,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  headerTitleCol: {
    flex: 1,
    paddingRight: 10,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00E676',
    letterSpacing: 0.6,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FAFAFA',
    marginTop: 2,
  },
  gearTareSubtext: {
    fontSize: 11,
    color: '#71717A',
    marginTop: 2,
    fontStyle: 'italic',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 15,
    color: '#FAFAFA',
    fontWeight: '700',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statCol: {
    alignItems: 'center',
    flex: 1,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#27272A',
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#71717A',
    letterSpacing: 0.4,
    marginBottom: 3,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  statValueAccent: {
    fontSize: 13,
    fontWeight: '900',
    color: '#00E676',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#71717A',
    letterSpacing: 0.8,
  },
  sectionCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#A1A1AA',
  },
});
