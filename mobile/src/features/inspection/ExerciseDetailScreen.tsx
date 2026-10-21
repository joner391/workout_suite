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
  ExercisePreference,
  ExerciseSentiment,
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
import { IExercisePreferenceRepository } from '../../domain/repositories/IExercisePreferenceRepository';
import { ExerciseInspectionService } from '../../services/exerciseInspectionService';
import {
  ExercisePreferenceService,
  calculateAffinityScore,
} from '../../services/exercisePreferenceService';
import { useOptionalRepositories } from '../../context/RepositoryContext';
import {
  formatRomTier,
  getRomTierBadgeStyle,
  formatAxialLoading,
  getAxialLoadingBadgeStyle,
  formatMuscleBias,
  getSentimentPillStyle,
} from './biomechanicalFormatters';
import { PRBoardTable } from './PRBoardTable';
import { SBDStandardsCard } from './SBDStandardsCard';
import { SBDBalanceRadarChart } from './SBDBalanceRadarChart';
import { SessionDetailModal } from '../calendar/SessionDetailModal';
import { formatWeight } from '../../core/math/unitConversion';

export interface ExerciseDetailScreenProps {
  exerciseId: string;
  exerciseRepo: IExerciseRepository;
  workoutRepo: IWorkoutRepository;
  userSettingsRepo?: IUserSettingsRepository;
  gearRepo?: IGearRepository;
  preferenceRepo?: IExercisePreferenceRepository;
  preferenceService?: ExercisePreferenceService;
  inspectionService?: ExerciseInspectionService;
  onClose?: () => void;
}

export const ExerciseDetailScreen: React.FC<ExerciseDetailScreenProps> = ({
  exerciseId,
  exerciseRepo,
  workoutRepo,
  userSettingsRepo,
  gearRepo,
  preferenceRepo: propPreferenceRepo,
  preferenceService: propPreferenceService,
  inspectionService: propInspectionService,
  onClose,
}) => {
  const optionalRepos = useOptionalRepositories();

  const inspectionService = useMemo(
    () => propInspectionService ?? new ExerciseInspectionService(workoutRepo, exerciseRepo),
    [propInspectionService, workoutRepo, exerciseRepo]
  );

  const prefService = useMemo(() => {
    if (propPreferenceService) return propPreferenceService;
    const repo = propPreferenceRepo ?? optionalRepos?.exercisePreferenceRepo;
    if (repo) return new ExercisePreferenceService(repo);
    return null;
  }, [propPreferenceService, propPreferenceRepo, optionalRepos?.exercisePreferenceRepo]);

  const [loading, setLoading] = useState<boolean>(true);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [prBoard, setPrBoard] = useState<PRBoardResult | null>(null);
  const [standardSummary, setStandardSummary] = useState<StrengthStandardSummaryResult | null>(null);
  const [balanceProfile, setBalanceProfile] = useState<SBDBalanceProfile | null>(null);
  const [hasVariants, setHasVariants] = useState<boolean>(false);
  const [preference, setPreference] = useState<ExercisePreference | null>(null);

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

  // Load Exercise Preference & Sentiment
  const loadPreference = useCallback(async () => {
    if (!prefService) return;
    try {
      const p = await prefService.getPreference(exerciseId);
      setPreference(p);
    } catch {
      // Ignore
    }
  }, [prefService, exerciseId]);

  useEffect(() => {
    loadPreference();
  }, [loadPreference]);

  // Handle sentiment action toggle
  const handleSelectSentiment = async (sentiment: ExerciseSentiment) => {
    const prev = preference;
    const currentSwapIn = prev?.swap_in_count ?? 0;
    const currentSwapOut = prev?.swap_out_count ?? 0;
    const optimisticAffinity = calculateAffinityScore({
      sentiment,
      swap_in_count: currentSwapIn,
      swap_out_count: currentSwapOut,
    });

    setPreference({
      exercise_id: exerciseId,
      sentiment,
      swap_in_count: currentSwapIn,
      swap_out_count: currentSwapOut,
      affinity_score: optimisticAffinity,
      last_pain_reported_at: prev?.last_pain_reported_at ?? null,
      max_pain_severity: prev?.max_pain_severity ?? null,
      pain_joint: prev?.pain_joint ?? null,
      updated_at: new Date().toISOString(),
    });

    if (prefService) {
      try {
        const updated = await prefService.setSentiment(exerciseId, sentiment);
        setPreference(updated);
      } catch {
        setPreference(prev);
      }
    }
  };

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
  const displayLifetimeVolume = formatWeight(historyStats.totalVolumeKg, unitSystem, {
    precision: 0,
  });

  // Display Peak e1RM
  const peakE1rmDisplay = prBoard?.peakRecord
    ? formatWeight(prBoard.peakRecord.e1rmKg, unitSystem)
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

        {/* Biomechanical Specifications & Badges */}
        <View style={styles.biomechanicsCard} testID="exercise-biomechanics-card">
          <Text style={styles.cardHeaderTitle}>BIOMECHANICAL SPECIFICATIONS</Text>

          <View style={styles.biomechanicsBadgesRow}>
            {/* ROM Tier Badge */}
            {(() => {
              const romStyle = getRomTierBadgeStyle(exercise.rom_tier);
              return (
                <View
                  testID="badge-rom-tier"
                  style={[
                    styles.specBadge,
                    { backgroundColor: romStyle.bg, borderColor: romStyle.border },
                  ]}
                >
                  <Text style={[styles.specBadgeText, { color: romStyle.text }]}>
                    {formatRomTier(exercise.rom_tier)}
                  </Text>
                </View>
              );
            })()}

            {/* Axial Load Badge */}
            {(() => {
              const axialStyle = getAxialLoadingBadgeStyle(exercise.axial_loading);
              return (
                <View
                  testID="badge-axial-loading"
                  style={[
                    styles.specBadge,
                    { backgroundColor: axialStyle.bg, borderColor: axialStyle.border },
                  ]}
                >
                  <Text style={[styles.specBadgeText, { color: axialStyle.text }]}>
                    {formatAxialLoading(exercise.axial_loading)}
                  </Text>
                </View>
              );
            })()}

            {/* Baseline SFR Badge if defined */}
            {exercise.baseline_sfr != null && (
              <View testID="badge-baseline-sfr" style={styles.sfrBadge}>
                <Text style={styles.sfrBadgeText}>SFR {exercise.baseline_sfr}/100</Text>
              </View>
            )}
          </View>

          {/* Regional Bias Chips */}
          {exercise.muscle_biases && exercise.muscle_biases.length > 0 && (
            <View style={styles.regionalBiasContainer}>
              <Text style={styles.regionalBiasLabel}>REGIONAL FOCUS</Text>
              <View style={styles.regionalBiasRow}>
                {exercise.muscle_biases.map((bias) => (
                  <View
                    key={bias}
                    testID={`chip-muscle-bias-${bias}`}
                    style={styles.biasChip}
                  >
                    <Text style={styles.biasChipText}>{formatMuscleBias(bias)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* Planner Preference & Sentiment Controls */}
        <View style={styles.preferenceCard} testID="exercise-preference-card">
          <View style={styles.preferenceHeaderRow}>
            <Text style={styles.cardHeaderTitle}>PLANNER PREFERENCE</Text>
            {preference && preference.sentiment !== 'neutral' && (
              <Text style={styles.affinityBadgeText}>
                Affinity: {preference.affinity_score > 0 ? `+${preference.affinity_score.toFixed(0)}` : preference.affinity_score.toFixed(0)}
              </Text>
            )}
          </View>

          {/* Sentiment Action Pill Row */}
          <View style={styles.sentimentPillRow} testID="sentiment-pill-row">
            {/* Liked (Heart) */}
            {(() => {
              const isLiked = (preference?.sentiment ?? 'neutral') === 'liked';
              const style = getSentimentPillStyle('liked', isLiked);
              return (
                <TouchableOpacity
                  testID="sentiment-liked-btn"
                  style={[
                    styles.sentimentBtn,
                    { backgroundColor: style.bg, borderColor: style.border },
                  ]}
                  onPress={() => handleSelectSentiment('liked')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.sentimentBtnText, { color: style.text }]}>♥ Liked</Text>
                </TouchableOpacity>
              );
            })()}

            {/* Neutral */}
            {(() => {
              const isNeutral = (preference?.sentiment ?? 'neutral') === 'neutral';
              const style = getSentimentPillStyle('neutral', isNeutral);
              return (
                <TouchableOpacity
                  testID="sentiment-neutral-btn"
                  style={[
                    styles.sentimentBtn,
                    { backgroundColor: style.bg, borderColor: style.border },
                  ]}
                  onPress={() => handleSelectSentiment('neutral')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.sentimentBtnText, { color: style.text }]}>— Neutral</Text>
                </TouchableOpacity>
              );
            })()}

            {/* Disliked */}
            {(() => {
              const isDisliked = (preference?.sentiment ?? 'neutral') === 'disliked';
              const style = getSentimentPillStyle('disliked', isDisliked);
              return (
                <TouchableOpacity
                  testID="sentiment-disliked-btn"
                  style={[
                    styles.sentimentBtn,
                    { backgroundColor: style.bg, borderColor: style.border },
                  ]}
                  onPress={() => handleSelectSentiment('disliked')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.sentimentBtnText, { color: style.text }]}>✕ Dislike</Text>
                </TouchableOpacity>
              );
            })()}

            {/* Blacklisted */}
            {(() => {
              const isBlacklisted = (preference?.sentiment ?? 'neutral') === 'blacklisted';
              const style = getSentimentPillStyle('blacklisted', isBlacklisted);
              return (
                <TouchableOpacity
                  testID="sentiment-blacklisted-btn"
                  style={[
                    styles.sentimentBtn,
                    { backgroundColor: style.bg, borderColor: style.border },
                  ]}
                  onPress={() => handleSelectSentiment('blacklisted')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.sentimentBtnText, { color: style.text }]}>⊘ Blacklist</Text>
                </TouchableOpacity>
              );
            })()}
          </View>

          {/* Helper / explanation note */}
          <Text style={styles.preferenceExplanationText}>
            {preference?.sentiment === 'liked' && 'Prioritized by program generator & adaptive substitution (+25 bonus).'}
            {preference?.sentiment === 'disliked' && 'De-prioritized by generator (-60 penalty).'}
            {preference?.sentiment === 'blacklisted' && 'Strictly excluded from synthesizer and logger substitutions.'}
            {(!preference || preference.sentiment === 'neutral') &&
              ((preference?.swap_in_count ?? 0) > 0 || (preference?.swap_out_count ?? 0) > 0
                ? `Neutral balance: Swapped in ${preference?.swap_in_count}x, swapped out ${preference?.swap_out_count}x.`
                : 'Neutral: Eligible for automated synthesizer rotation.')}
          </Text>

          {/* Pain correlation warning if recorded */}
          {preference?.last_pain_reported_at && (
            <View style={styles.painWarningBox}>
              <Text style={styles.painWarningText}>
                ⚠ Discomfort reported on {preference.pain_joint ?? 'joint'} (Severity {preference.max_pain_severity}/5)
              </Text>
            </View>
          )}
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
  biomechanicsCard: {
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  cardHeaderTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#71717A',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  biomechanicsBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  specBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  specBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  sfrBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#102A1E',
    borderColor: '#00E676',
  },
  sfrBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00E676',
  },
  regionalBiasContainer: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1E1E24',
  },
  regionalBiasLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#71717A',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  regionalBiasRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  biasChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#1A1A22',
    borderWidth: 1,
    borderColor: '#2D2D38',
  },
  biasChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#D4D4D8',
  },
  preferenceCard: {
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  preferenceHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  affinityBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00E676',
  },
  sentimentPillRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  sentimentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentimentBtnText: {
    fontSize: 11,
    fontWeight: '800',
  },
  preferenceExplanationText: {
    fontSize: 11,
    color: '#A1A1AA',
    lineHeight: 16,
  },
  painWarningBox: {
    marginTop: 8,
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#2E1515',
    borderWidth: 1,
    borderColor: '#E53935',
  },
  painWarningText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFCDD2',
  },
});
