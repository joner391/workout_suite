/**
 * Workout Suite — Workload & Intensity Deep Dive Modal
 *
 * Implements Comprehensive Analytics for:
 * 1. Hypertrophy Muscle Group Volume Landmarks (Working sets per muscle group per week)
 * 2. Daily Session Workload & Tonnage Distribution (Comparing days across the week)
 * 3. Dual-Faceted Intensity Intelligence:
 *    - Effort Intensity: Average RPE proximity to failure & stimulating set ratio (RPE >= 8.0)
 *    - Relative Load Intensity: Volume-weighted % of e1RM and intensity zone distribution
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { IWorkoutRepository, IExerciseRepository, IUserSettingsRepository } from '../../domain/repositories';
import {
  computeWeeklyWorkloadDeepDive,
  WeeklyWorkloadDeepDive,
  MuscleGroupVolumeReport,
  DailyWorkloadSummary,
} from '../../services/workloadAnalysisService';
import { formatWeight } from '../../core/math/unitConversion';
import { WeightUnit } from '../../core/types';

export interface WorkloadDeepDiveModalProps {
  visible: boolean;
  workoutRepo: IWorkoutRepository;
  exerciseRepo: IExerciseRepository;
  userSettingsRepo?: IUserSettingsRepository;
  onClose: () => void;
}

export const WorkloadDeepDiveModal: React.FC<WorkloadDeepDiveModalProps> = ({
  visible,
  workoutRepo,
  exerciseRepo,
  userSettingsRepo,
  onClose,
}) => {
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');
  const [volumeMetricMode, setVolumeMetricMode] = useState<'ereps' | 'sets'>('ereps');
  const [deepDive, setDeepDive] = useState<WeeklyWorkloadDeepDive | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      if (userSettingsRepo) {
        try {
          const u = await userSettingsRepo.get('unit_system');
          if (u === 'lbs' || u === 'kg') setUnitSystem(u);
        } catch {
          // Fall back to kg
        }
      }

      const result = await computeWeeklyWorkloadDeepDive(workoutRepo, exerciseRepo, {
        weekOffset,
      });
      setDeepDive(result);
    } catch {
      // Error fallback
    } finally {
      setLoading(false);
    }
  }, [workoutRepo, exerciseRepo, userSettingsRepo, weekOffset]);

  useEffect(() => {
    if (visible) {
      loadData();
    }
  }, [visible, loadData]);

  if (!visible) return null;

  const formatDateRange = (startIso: string, endIso: string) => {
    try {
      const s = new Date(startIso + 'T00:00:00Z');
      const e = new Date(endIso + 'T00:00:00Z');
      const sStr = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      const eStr = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      return `${sStr} – ${eStr}`;
    } catch {
      return `${startIso} to ${endIso}`;
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'optimal':
        return '#00E676';
      case 'high':
        return '#FF9100';
      case 'peak':
        return '#FF5252';
      default:
        return '#38BDF8';
    }
  };

  const getTierLabel = (tier: string) => {
    switch (tier) {
      case 'optimal':
        return 'Optimal (MAV)';
      case 'high':
        return 'High Volume';
      case 'peak':
        return 'Fatigue Risk';
      default:
        return 'Maintenance';
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View testID="workload-deep-dive-modal" style={styles.container}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerTitleGroup}>
            <Text style={styles.headerSubtitle}>WORKLOAD & INTENSITY INTELLIGENCE</Text>
            <Text style={styles.headerTitle}>Volume Deep Dive</Text>
          </View>
          <TouchableOpacity
            testID="workload-modal-close-btn"
            style={styles.closeBtn}
            onPress={onClose}
            accessibilityLabel="Close Workload Deep Dive"
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Week Selector Bar */}
        <View style={styles.weekSelectorBar}>
          <TouchableOpacity
            testID="workload-prev-week-btn"
            style={styles.weekNavBtn}
            onPress={() => setWeekOffset((prev) => prev - 1)}
          >
            <Text style={styles.weekNavBtnText}>◀ Prev</Text>
          </TouchableOpacity>

          <View style={styles.weekRangeGroup}>
            <Text style={styles.weekRangeText}>
              {deepDive ? formatDateRange(deepDive.weekStartDate, deepDive.weekEndDate) : 'Loading week...'}
            </Text>
            {weekOffset === 0 && (
              <View style={styles.currentWeekBadge}>
                <Text style={styles.currentWeekBadgeText}>THIS WEEK</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            testID="workload-next-week-btn"
            style={[styles.weekNavBtn, weekOffset >= 0 && styles.weekNavBtnDisabled]}
            disabled={weekOffset >= 0}
            onPress={() => setWeekOffset((prev) => prev + 1)}
          >
            <Text style={[styles.weekNavBtnText, weekOffset >= 0 && styles.weekNavBtnTextDisabled]}>
              Next ▶
            </Text>
          </TouchableOpacity>
        </View>

        {loading || !deepDive ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#00E676" />
            <Text style={styles.loadingText}>Synthesizing workload metrics...</Text>
          </View>
        ) : (
          <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
            {/* Top KPI Metrics Strip */}
            <View style={styles.kpiContainer}>
              <View style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>TOTAL TONNAGE</Text>
                <Text style={styles.kpiValue}>
                  {formatWeight(deepDive.totalTonnageKg, unitSystem)}
                </Text>
                <Text style={styles.kpiSub}>across {deepDive.completedWorkoutsCount} sessions</Text>
              </View>

              <View style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>
                  {volumeMetricMode === 'ereps' ? 'EFFECTIVE REPS' : 'WORKING SETS'}
                </Text>
                <Text style={styles.kpiValue}>
                  {volumeMetricMode === 'ereps' ? deepDive.totalEffectiveReps : deepDive.totalWorkingSets}
                </Text>
                <Text style={styles.kpiSub}>
                  {volumeMetricMode === 'ereps'
                    ? `${deepDive.totalRatedSets}/${deepDive.totalWorkingSets} sets rated`
                    : 'hard sets total'}
                </Text>
              </View>

              <View style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>AVG RPE EFFORT</Text>
                <Text style={styles.kpiValue}>
                  {deepDive.intensity.avgRpe ? `${deepDive.intensity.avgRpe}` : '—'}
                </Text>
                <Text style={styles.kpiSub}>
                  {deepDive.intensity.totalUnratedSets > 0
                    ? `${deepDive.intensity.totalRatedSets}/${deepDive.intensity.totalRatedSets + deepDive.intensity.totalUnratedSets} sets logged`
                    : `${deepDive.intensity.highIntensityRatioPercent}% at RPE 8+`}
                </Text>
              </View>

              <View style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>AVG INTENSITY</Text>
                <Text style={styles.kpiValue}>
                  {deepDive.intensity.avgRelativeIntensityPercent
                    ? `${deepDive.intensity.avgRelativeIntensityPercent}%`
                    : '—'}
                </Text>
                <Text style={styles.kpiSub}>of estimated 1RM</Text>
              </View>
            </View>

            {/* SECTION 1: MUSCLE GROUP VOLUME LANDMARKS */}
            <View style={styles.cardSection}>
              {/* Metric Mode Toggle (Default to Effective Reps) */}
              <View style={styles.metricToggleBar}>
                <TouchableOpacity
                  testID="metric-toggle-ereps"
                  style={[
                    styles.metricToggleBtn,
                    volumeMetricMode === 'ereps' && styles.metricToggleBtnActive,
                  ]}
                  onPress={() => setVolumeMetricMode('ereps')}
                  accessibilityLabel="Switch to Effective Reps"
                >
                  <Text
                    style={[
                      styles.metricToggleText,
                      volumeMetricMode === 'ereps' && styles.metricToggleTextActive,
                    ]}
                  >
                    ⚡ Effective Reps
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  testID="metric-toggle-sets"
                  style={[
                    styles.metricToggleBtn,
                    volumeMetricMode === 'sets' && styles.metricToggleBtnActive,
                  ]}
                  onPress={() => setVolumeMetricMode('sets')}
                  accessibilityLabel="Switch to Working Sets"
                >
                  <Text
                    style={[
                      styles.metricToggleText,
                      volumeMetricMode === 'sets' && styles.metricToggleTextActive,
                    ]}
                  >
                    📋 Working Sets
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.cardSectionHeader}>
                <View>
                  <Text style={styles.cardSectionSubtitle}>
                    {volumeMetricMode === 'ereps' ? 'HYPERTROPHY LANDMARKS' : 'VOLUME LANDMARKS'}
                  </Text>
                  <Text style={styles.cardSectionTitle}>Muscle Group Volume</Text>
                </View>
                <View style={styles.landmarkLegend}>
                  <Text style={styles.legendText}>
                    {volumeMetricMode === 'ereps' ? 'Target: 20–48 eReps/wk' : 'Target: 8–18 sets/wk'}
                  </Text>
                </View>
              </View>

              {/* Coverage & Rating Disclosure */}
              {volumeMetricMode === 'ereps' && (
                <View testID="ereps-coverage-banner" style={styles.coverageBanner}>
                  <Text style={styles.coverageText}>
                    ⚡ Rated sets: {deepDive.totalRatedSets}/{deepDive.totalWorkingSets} ({deepDive.ratingCoveragePercent}%)
                    {deepDive.totalUnratedSets > 0 &&
                      ` • ${deepDive.totalUnratedSets} unrated sets omitted (0 eReps)`}
                  </Text>
                </View>
              )}

              {deepDive.muscleGroupVolumes.length === 0 ? (
                <Text style={styles.emptyCardText}>No completed workout sets logged for this week.</Text>
              ) : (
                <View style={styles.muscleList}>
                  {deepDive.muscleGroupVolumes.map((m: MuscleGroupVolumeReport) => {
                    const isEreps = volumeMetricMode === 'ereps';
                    const displayVal = isEreps
                      ? `${m.effectiveReps % 1 === 0 ? m.effectiveReps : m.effectiveReps.toFixed(1)} eReps`
                      : `${m.workingSets % 1 === 0 ? m.workingSets : m.workingSets.toFixed(1)} sets`;
                    const tier = isEreps ? m.effectiveRepsTier : m.tier;
                    const color = getTierColor(tier);
                    const progressFraction = isEreps
                      ? Math.min(1.0, m.effectiveReps / 48)
                      : Math.min(1.0, m.workingSets / 18);

                    return (
                      <View key={m.muscleGroup} style={styles.muscleRow}>
                        <View style={styles.muscleInfoRow}>
                          <Text style={styles.muscleName}>{m.muscleGroup}</Text>
                          <View style={styles.muscleStatsRight}>
                            <Text style={styles.muscleSetsText}>{displayVal}</Text>
                            <Text style={styles.muscleTonnageText}>
                              ({formatWeight(m.totalTonnageKg, unitSystem)})
                            </Text>
                            <View style={[styles.tierPill, { backgroundColor: color + '22', borderColor: color }]}>
                              <Text style={[styles.tierPillText, { color }]}>{getTierLabel(tier)}</Text>
                            </View>
                          </View>
                        </View>
                        {/* Progress Bar */}
                        <View style={styles.progressBarTrack}>
                          <View
                            style={[
                              styles.progressBarFill,
                              { width: `${Math.round(progressFraction * 100)}%`, backgroundColor: color },
                            ]}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* SECTION 2: DAILY SESSION WORKLOAD & TONNAGE */}
            <View style={styles.cardSection}>
              <View style={styles.cardSectionHeader}>
                <View>
                  <Text style={styles.cardSectionSubtitle}>WEEKLY DISTRIBUTION</Text>
                  <Text style={styles.cardSectionTitle}>Daily Session Volume</Text>
                </View>
              </View>

              <View style={styles.dailyGrid}>
                {deepDive.dailyWorkloads.map((day: DailyWorkloadSummary) => (
                  <View
                    key={day.date}
                    style={[styles.dailyCard, day.hasWorkout ? styles.dailyCardActive : styles.dailyCardRest]}
                  >
                    <View style={styles.dailyCardHeader}>
                      <Text style={[styles.dailyDayName, day.hasWorkout && styles.dailyDayNameActive]}>
                        {day.dayName}
                      </Text>
                      <Text style={styles.dailyDateSub}>{day.date.slice(5)}</Text>
                    </View>

                    {day.hasWorkout ? (
                      <View style={styles.dailyCardBody}>
                        <Text style={styles.dailyWorkoutName} numberOfLines={1}>
                          {day.workoutName}
                        </Text>
                        <Text style={styles.dailyTonnageValue}>
                          {formatWeight(day.tonnageKg, unitSystem)}
                        </Text>
                        <View style={styles.dailyMetricsRow}>
                          <Text style={styles.dailySubInfo}>{day.workingSets} sets</Text>
                          {day.avgRpe && (
                            <Text style={styles.dailySubInfo}> • {day.avgRpe} RPE</Text>
                          )}
                        </View>
                      </View>
                    ) : (
                      <View style={styles.dailyRestBody}>
                        <Text style={styles.dailyRestText}>Rest Day</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </View>

            {/* SECTION 3: DUAL INTENSITY INTELLIGENCE */}
            <View style={styles.cardSection}>
              <View style={styles.cardSectionHeader}>
                <View>
                  <Text style={styles.cardSectionSubtitle}>PROXIMITY & LOAD</Text>
                  <Text style={styles.cardSectionTitle}>Intensity Intelligence</Text>
                </View>
              </View>

              {/* 3A: Effort Intensity (RPE) */}
              <View style={styles.intensityCard}>
                <View style={styles.intensityCardTitleRow}>
                  <Text style={styles.intensityCardLabel}>1. Effort Intensity (Proximity to Failure)</Text>
                  <Text style={styles.intensityBadge}>RPE / RIR MODEL</Text>
                </View>

                <View style={styles.intensityStatRow}>
                  <View style={styles.intensityStatBox}>
                    <Text style={styles.intensityStatVal}>
                      {deepDive.intensity.avgRpe ? `${deepDive.intensity.avgRpe}` : '—'}
                    </Text>
                    <Text style={styles.intensityStatLabel}>
                      {deepDive.intensity.totalUnratedSets > 0
                        ? `Average RPE (${deepDive.intensity.totalRatedSets}/${deepDive.intensity.totalRatedSets + deepDive.intensity.totalUnratedSets} rated)`
                        : 'Average RPE'}
                    </Text>
                  </View>
                  <View style={styles.intensityStatBox}>
                    <Text style={styles.intensityStatVal}>
                      {deepDive.intensity.highIntensityRatioPercent}%
                    </Text>
                    <Text style={styles.intensityStatLabel}>Effective Stimulating Sets (RPE ≥ 8.0)</Text>
                  </View>
                </View>

                {/* RPE Distribution Bar */}
                <Text style={styles.distributionTitle}>RPE Distribution (% of Working Sets)</Text>
                <View style={styles.bucketList}>
                  {deepDive.intensity.rpeBuckets.map((b) => {
                    const isUnrated = b.label.includes('Unrated');
                    const color = isUnrated ? '#71717A' : '#38BDF8';
                    return (
                      <View key={b.label} style={styles.bucketRow}>
                        <Text style={[styles.bucketLabel, isUnrated && { color: '#A1A1AA' }]}>{b.label}</Text>
                        <View style={styles.bucketTrack}>
                          <View style={[styles.bucketFill, { width: `${b.percentage}%`, backgroundColor: color }]} />
                        </View>
                        <Text style={styles.bucketPercentText}>{b.count} ({b.percentage}%)</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* 3B: Relative Load Intensity (% 1RM) */}
              <View style={[styles.intensityCard, { marginTop: 12 }]}>
                <View style={styles.intensityCardTitleRow}>
                  <Text style={styles.intensityCardLabel}>2. Relative Load Intensity (% of 1RM)</Text>
                  <Text style={[styles.intensityBadge, { backgroundColor: '#14291B', color: '#00E676' }]}>
                    LOMBARDI MODEL
                  </Text>
                </View>

                <View style={styles.intensityStatRow}>
                  <View style={styles.intensityStatBox}>
                    <Text style={[styles.intensityStatVal, { color: '#00E676' }]}>
                      {deepDive.intensity.avgRelativeIntensityPercent
                        ? `${deepDive.intensity.avgRelativeIntensityPercent}%`
                        : '—'}
                    </Text>
                    <Text style={styles.intensityStatLabel}>Volume-Weighted % 1RM</Text>
                  </View>
                  <View style={styles.intensityStatBox}>
                    <Text style={styles.intensityStatVal}>
                      {deepDive.intensity.loadZoneBuckets.find((z) => z.label.includes('Heavy'))?.count || 0}
                    </Text>
                    <Text style={styles.intensityStatLabel}>Heavy Sets (&gt; 85% 1RM)</Text>
                  </View>
                </View>

                {/* Load Zone Distribution */}
                <Text style={styles.distributionTitle}>Training Load Zones (% of Volume)</Text>
                <View style={styles.bucketList}>
                  {deepDive.intensity.loadZoneBuckets.map((b) => {
                    const isHeavy = b.label.includes('Heavy');
                    const isMod = b.label.includes('Moderate');
                    const color = isHeavy ? '#FF5252' : isMod ? '#00E676' : '#FFD600';

                    return (
                      <View key={b.label} style={styles.bucketRow}>
                        <Text style={styles.bucketLabel}>{b.label}</Text>
                        <View style={styles.bucketTrack}>
                          <View style={[styles.bucketFill, { width: `${b.percentage}%`, backgroundColor: color }]} />
                        </View>
                        <Text style={styles.bucketPercentText}>{b.count} ({b.percentage}%)</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  headerTitleGroup: {
    flex: 1,
  },
  headerSubtitle: {
    color: '#71717A',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  headerTitle: {
    color: '#FAFAFA',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#E4E4E7',
    fontSize: 16,
    fontWeight: '600',
  },
  weekSelectorBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#121214',
    borderBottomWidth: 1,
    borderBottomColor: '#1F1F23',
  },
  weekNavBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1E1E22',
  },
  weekNavBtnDisabled: {
    opacity: 0.3,
  },
  weekNavBtnText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '700',
  },
  weekNavBtnTextDisabled: {
    color: '#71717A',
  },
  weekRangeGroup: {
    alignItems: 'center',
  },
  weekRangeText: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '700',
  },
  currentWeekBadge: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  currentWeekBadgeText: {
    color: '#00E676',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#888888',
    fontSize: 13,
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  kpiContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  kpiBox: {
    width: '48.5%',
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1E1E22',
    borderRadius: 10,
    padding: 12,
  },
  kpiLabel: {
    color: '#71717A',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  kpiValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 2,
  },
  kpiSub: {
    color: '#71717A',
    fontSize: 10,
  },
  metricToggleBar: {
    flexDirection: 'row',
    backgroundColor: '#1C1C1E',
    borderRadius: 8,
    padding: 3,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  metricToggleBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricToggleBtnActive: {
    backgroundColor: '#27272A',
  },
  metricToggleText: {
    color: '#71717A',
    fontSize: 11,
    fontWeight: '700',
  },
  metricToggleTextActive: {
    color: '#00E676',
  },
  coverageBanner: {
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderColor: 'rgba(56, 189, 248, 0.25)',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 12,
  },
  coverageText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '600',
  },
  cardSection: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1E1E22',
    borderRadius: 12,
    padding: 14,
  },
  cardSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardSectionSubtitle: {
    color: '#71717A',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardSectionTitle: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 1,
  },
  landmarkLegend: {
    backgroundColor: '#1C1C1E',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  legendText: {
    color: '#A1A1AA',
    fontSize: 10,
    fontWeight: '600',
  },
  emptyCardText: {
    color: '#71717A',
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 10,
  },
  muscleList: {
    gap: 10,
  },
  muscleRow: {
    gap: 4,
  },
  muscleInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  muscleName: {
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '700',
  },
  muscleStatsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  muscleSetsText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  muscleTonnageText: {
    color: '#71717A',
    fontSize: 11,
  },
  tierPill: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  tierPillText: {
    fontSize: 9,
    fontWeight: '800',
  },
  progressBarTrack: {
    height: 5,
    backgroundColor: '#1F1F23',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  dailyGrid: {
    gap: 8,
  },
  dailyCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  dailyCardActive: {
    backgroundColor: '#161618',
    borderColor: '#2A2A2E',
  },
  dailyCardRest: {
    backgroundColor: '#0F0F11',
    borderColor: '#19191D',
    opacity: 0.6,
  },
  dailyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  dailyDayName: {
    color: '#71717A',
    fontSize: 11,
    fontWeight: '800',
  },
  dailyDayNameActive: {
    color: '#00E676',
  },
  dailyDateSub: {
    color: '#52525B',
    fontSize: 10,
  },
  dailyCardBody: {
    gap: 2,
  },
  dailyWorkoutName: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '700',
  },
  dailyTonnageValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  dailyMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dailySubInfo: {
    color: '#A1A1AA',
    fontSize: 11,
  },
  dailyRestBody: {
    paddingVertical: 2,
  },
  dailyRestText: {
    color: '#52525B',
    fontSize: 11,
    fontStyle: 'italic',
  },
  intensityCard: {
    backgroundColor: '#161618',
    borderWidth: 1,
    borderColor: '#242428',
    borderRadius: 8,
    padding: 12,
  },
  intensityCardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  intensityCardLabel: {
    color: '#FAFAFA',
    fontSize: 12,
    fontWeight: '800',
  },
  intensityBadge: {
    backgroundColor: '#1E293B',
    color: '#38BDF8',
    fontSize: 8,
    fontWeight: '800',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  intensityStatRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  intensityStatBox: {
    flex: 1,
    backgroundColor: '#0F0F11',
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: '#1F1F23',
  },
  intensityStatVal: {
    color: '#38BDF8',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
  },
  intensityStatLabel: {
    color: '#71717A',
    fontSize: 9,
    fontWeight: '700',
  },
  distributionTitle: {
    color: '#A1A1AA',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 6,
  },
  bucketList: {
    gap: 6,
  },
  bucketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bucketLabel: {
    width: 110,
    color: '#A1A1AA',
    fontSize: 10,
    fontWeight: '600',
  },
  bucketTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#1F1F23',
    borderRadius: 3,
    overflow: 'hidden',
  },
  bucketFill: {
    height: '100%',
    borderRadius: 3,
  },
  bucketPercentText: {
    width: 65,
    textAlign: 'right',
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
});
