import { ScreenHeader } from '../../ui/ScreenHeader';
import { AppIcon } from '../../ui/AppIcon';
import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
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
  const [expandedSections, setExpandedSections] = useState<{
    landmarks: boolean;
    daily: boolean;
    intensity: boolean;
  }>({
    landmarks: true,
    daily: false,
    intensity: false,
  });

  const toggleSection = (section: 'landmarks' | 'daily' | 'intensity') => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      let customLandmarks: Record<string, { mev: number; mav: number; mrv: number }> | undefined;
      if (userSettingsRepo) {
        try {
          const u = await userSettingsRepo.get('unit_system');
          if (u === 'lbs' || u === 'kg') setUnitSystem(u);
        } catch {
          // Fall back to kg
        }

        try {
          const raw = await userSettingsRepo.get('calibrated_muscle_landmarks');
          if (raw) {
            customLandmarks = JSON.parse(raw);
          }
        } catch {
          // Fall back to static constants
        }
      }

      const result = await computeWeeklyWorkloadDeepDive(workoutRepo, exerciseRepo, {
        weekOffset,
        customLandmarks,
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
        return uiColors.accent;
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
        <ScreenHeader title="Training workload" subtitle="Volume, effort and intensity" onClose={onClose} closeTestID="workload-modal-close-btn" />

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
            <ActivityIndicator size="large" color={uiColors.accent} />
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
                      Effective Reps
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
                      Working Sets
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                testID="deepdive-toggle-landmarks-btn"
                style={styles.cardSectionHeaderTouch}
                onPress={() => toggleSection('landmarks')}
                activeOpacity={0.7}
              >
                <View>
                  <Text style={styles.cardSectionSubtitle}>
                    {volumeMetricMode === 'ereps' ? 'HYPERTROPHY LANDMARKS' : 'VOLUME LANDMARKS'}
                  </Text>
                  <Text style={styles.cardSectionTitle}>Muscle Group Volume</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={styles.landmarkLegend}>
                    <Text style={styles.legendText}>
                      {volumeMetricMode === 'ereps' ? 'Target: 20–48 eReps/wk' : 'Target: 8–18 sets/wk'}
                    </Text>
                  </View>
                  <Text style={styles.accordionChevronText}>
                    {expandedSections.landmarks ? '▲' : '▼'}
                  </Text>
                </View>
              </TouchableOpacity>

              {expandedSections.landmarks ? (
                <>
                  {/* Coverage & Rating Disclosure */}
                  {volumeMetricMode === 'ereps' && (
                    <View testID="ereps-coverage-banner" style={styles.coverageBanner}>
                      <Text style={styles.coverageText}>
                          Rated sets: {deepDive.totalRatedSets}/{deepDive.totalWorkingSets} ({deepDive.ratingCoveragePercent}%)
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
                </>
              ) : (
                <Text style={styles.collapsedSummaryText}>
                  {deepDive.muscleGroupVolumes.length} muscle groups tracked • Tap to inspect distribution
                </Text>
              )}
            </View>

            {/* SECTION 2: DAILY SESSION WORKLOAD & TONNAGE */}
            <View style={styles.cardSection}>
              <TouchableOpacity
                testID="deepdive-toggle-daily-btn"
                style={styles.cardSectionHeaderTouch}
                onPress={() => toggleSection('daily')}
                activeOpacity={0.7}
              >
                <View>
                  <Text style={styles.cardSectionSubtitle}>WEEKLY DISTRIBUTION</Text>
                  <Text style={styles.cardSectionTitle}>Daily Session Volume</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.accordionSummaryPill}>
                    {deepDive.completedWorkoutsCount} sessions
                  </Text>
                  <Text style={styles.accordionChevronText}>
                    {expandedSections.daily ? '▲' : '▼'}
                  </Text>
                </View>
              </TouchableOpacity>

              {expandedSections.daily ? (
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
              ) : (
                <Text style={styles.collapsedSummaryText}>
                  {deepDive.completedWorkoutsCount} completed sessions ({formatWeight(deepDive.totalTonnageKg, unitSystem)}) • Tap to view daily breakdown
                </Text>
              )}
            </View>

            {/* SECTION 3: DUAL INTENSITY INTELLIGENCE */}
            <View style={styles.cardSection}>
              <TouchableOpacity
                testID="deepdive-toggle-intensity-btn"
                style={styles.cardSectionHeaderTouch}
                onPress={() => toggleSection('intensity')}
                activeOpacity={0.7}
              >
                <View>
                  <Text style={styles.cardSectionSubtitle}>PROXIMITY & LOAD</Text>
                  <Text style={styles.cardSectionTitle}>Intensity Intelligence</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.accordionSummaryPill}>
                    {deepDive.intensity.avgRpe ? `${deepDive.intensity.avgRpe} RPE` : 'Effort & Load'}
                  </Text>
                  <Text style={styles.accordionChevronText}>
                    {expandedSections.intensity ? '▲' : '▼'}
                  </Text>
                </View>
              </TouchableOpacity>

              {expandedSections.intensity ? (
                <>
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
                    const color = isUnrated ? uiColors.subtle : '#38BDF8';
                    return (
                      <View key={b.label} style={styles.bucketRow}>
                        <Text style={[styles.bucketLabel, isUnrated && { color: uiColors.muted }]}>{b.label}</Text>
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
                        <Text style={[styles.intensityBadge, { backgroundColor: '#14291B', color: uiColors.accentText }]}>
                    LOMBARDI MODEL
                  </Text>
                </View>

                <View style={styles.intensityStatRow}>
                  <View style={styles.intensityStatBox}>
                          <Text style={[styles.intensityStatVal, { color: uiColors.accentText }]}>
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
                    const color = isHeavy ? '#FF5252' : isMod ? uiColors.accent : '#FFD600';

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
            </>
          ) : (
            <Text style={styles.collapsedSummaryText}>
              Avg RPE: {deepDive.intensity.avgRpe ?? '—'} • Relative Load: {deepDive.intensity.avgRelativeIntensityPercent ?? '—'}% of e1RM • Tap header to inspect
            </Text>
          )}
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
    backgroundColor: uiColors.background,
  },
  weekSelectorBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: uiColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: '#1F1F23',
  },
  weekNavBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: uiRadius.control,
    backgroundColor: uiColors.raised,
  },
  weekNavBtnDisabled: {
    opacity: 0.3,
  },
  weekNavBtnText: {
    color: uiColors.accentText,
    fontSize: 12,
    fontWeight: '700',
  },
  weekNavBtnTextDisabled: {
    color: uiColors.subtle,
  },
  weekRangeGroup: {
    alignItems: 'center',
  },
  weekRangeText: {
    color: uiColors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  currentWeekBadge: {
    minHeight: 26,
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: uiRadius.badge,
    marginTop: 2,
  },
  currentWeekBadgeText: {
    lineHeight: 16,
    color: uiColors.accentText,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: uiColors.muted,
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
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: 10,
    padding: 12,
  },
  kpiLabel: {
    color: uiColors.subtle,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  kpiValue: {
    color: uiColors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  kpiSub: {
    color: uiColors.subtle,
    fontSize: 10,
  },
  metricToggleBar: {
    flexDirection: 'row',
    backgroundColor: uiColors.raised,
    borderRadius: 8,
    padding: 3,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: uiColors.border,
  },
  metricToggleBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: uiRadius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricToggleBtnActive: {
    backgroundColor: uiColors.border,
  },
  metricToggleText: {
    color: uiColors.subtle,
    fontSize: 11,
    fontWeight: '700',
  },
  metricToggleTextActive: {
    color: uiColors.accentText,
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
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: 12,
    padding: 14,
  },
  cardSectionHeaderTouch: {
    gap: 12,
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    marginBottom: 8,
  },
  accordionSummaryPill: {
    minHeight: 26,
    justifyContent: 'center',
    color: '#38BDF8',
    backgroundColor: '#0C2A38',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: uiRadius.badge,
    fontSize: 10,
    fontWeight: '700',
  },
  accordionChevronText: {
    color: uiColors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  collapsedSummaryText: {
    color: uiColors.subtle,
    fontSize: 11,
    paddingVertical: 4,
    fontStyle: 'italic',
  },
  cardSectionSubtitle: {
    color: uiColors.subtle,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  cardSectionTitle: {
    color: uiColors.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 1,
  },
  landmarkLegend: {
    backgroundColor: uiColors.raised,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  legendText: {
    color: uiColors.muted,
    fontSize: 10,
    fontWeight: '600',
  },
  emptyCardText: {
    color: uiColors.subtle,
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
    color: uiColors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  muscleTonnageText: {
    color: uiColors.subtle,
    fontSize: 11,
  },
  tierPill: {
    minHeight: 26,
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: uiRadius.badge,
  },
  tierPillText: {
    lineHeight: 16,
    fontSize: 11,
    fontWeight: '600',
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
    borderRadius: uiRadius.card,
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
    color: uiColors.subtle,
    fontSize: 11,
    fontWeight: '700',
  },
  dailyDayNameActive: {
    color: uiColors.accentText,
  },
  dailyDateSub: {
    color: '#52525B',
    fontSize: 10,
  },
  dailyCardBody: {
    gap: 2,
  },
  dailyWorkoutName: {
    color: uiColors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  dailyTonnageValue: {
    color: uiColors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  dailyMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dailySubInfo: {
    color: uiColors.muted,
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
    borderRadius: uiRadius.card,
    padding: 12,
  },
  intensityCardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  intensityCardLabel: {
    color: uiColors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  intensityBadge: {
    minHeight: 26,
    justifyContent: 'center',
    backgroundColor: '#1E293B',
    color: '#38BDF8',
    fontSize: 8,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: uiRadius.badge,
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
    fontWeight: '700',
    marginBottom: 2,
  },
  intensityStatLabel: {
    color: uiColors.subtle,
    fontSize: 9,
    fontWeight: '700',
  },
  distributionTitle: {
    color: uiColors.muted,
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
    color: uiColors.muted,
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
    color: uiColors.text,
    fontSize: 10,
    fontWeight: '700',
  },
});
