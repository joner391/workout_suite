/**
 * Workout Suite — WarmupAssessmentModal
 *
 * Implements ADR-082 & Warm_up_estimator.md:
 * - Diagnostic warm-up assessment: 'light', 'normal', 'heavy'
 * - Quantized mathematical autoregulation (-10% to +5% asymmetric clamping)
 * - Fatigue-aware scaling (+2.5% vs +5.0% for light; -7.5% vs -5.0% for heavy)
 * - Secondary Groove Fallacy confirmation dialog for heavy warm-up single:
 *   choice between immediate preventive load drop or 90s rest and retry.
 * - OLED high-contrast dark theme.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Exercise, WorkoutSet, WeightUnit } from '../../core/types';
import {
  WarmupPerceptionRating,
  calculateWarmupAutoregulation,
  AutoregulatedLoadAdjustment,
} from '../../core/math/warmupEstimator';
import { formatWeight } from '../../core/math/unitConversion';

export interface WarmupAssessmentModalProps {
  visible: boolean;
  exercise: Exercise | null;
  warmupSet: WorkoutSet | null;
  plannedWorkingWeightKg: number;
  remainingWorkSetsCount: number;
  unitSystem?: WeightUnit;
  hasRecentFatigueFlag?: boolean;
  onApplyAdjustment: (
    rating: WarmupPerceptionRating,
    adjustedLoadKg: number,
    action?: 'apply_reduction' | 'groove_retry'
  ) => Promise<void> | void;
  onDismiss: () => void;
}

export const WarmupAssessmentModal: React.FC<WarmupAssessmentModalProps> = ({
  visible,
  exercise,
  warmupSet,
  plannedWorkingWeightKg,
  remainingWorkSetsCount,
  unitSystem = 'kg',
  hasRecentFatigueFlag = false,
  onApplyAdjustment,
  onDismiss,
}) => {
  const [selectedRating, setSelectedRating] = useState<WarmupPerceptionRating | null>(null);

  // Reset state when opening modal
  useEffect(() => {
    if (visible) {
      setSelectedRating(null);
    }
  }, [visible]);

  // Quantized autoregulated load adjustments
  const lightAdj = useMemo(
    () => calculateWarmupAutoregulation(plannedWorkingWeightKg, 'light', 2.5, hasRecentFatigueFlag),
    [plannedWorkingWeightKg, hasRecentFatigueFlag]
  );

  const normalAdj = useMemo(
    () => calculateWarmupAutoregulation(plannedWorkingWeightKg, 'normal', 2.5, hasRecentFatigueFlag),
    [plannedWorkingWeightKg, hasRecentFatigueFlag]
  );

  const heavyAdj = useMemo(
    () => calculateWarmupAutoregulation(plannedWorkingWeightKg, 'heavy', 2.5, hasRecentFatigueFlag),
    [plannedWorkingWeightKg, hasRecentFatigueFlag]
  );

  const currentAdjustment: AutoregulatedLoadAdjustment | null = useMemo(() => {
    if (selectedRating === 'light') return lightAdj;
    if (selectedRating === 'normal') return normalAdj;
    if (selectedRating === 'heavy' || selectedRating === 'hard') return heavyAdj;
    return null;
  }, [selectedRating, lightAdj, normalAdj, heavyAdj]);

  if (!visible || !exercise || !warmupSet) {
    return null;
  }

  const warmupLoadDisplay =
    warmupSet.raw_input_weight > 0
      ? formatWeight(warmupSet.raw_input_weight, unitSystem)
      : formatWeight(warmupSet.weight, unitSystem);

  const plannedWorkLoadDisplay = formatWeight(plannedWorkingWeightKg, unitSystem);

  const handleConfirmPrimary = () => {
    if (!selectedRating || !currentAdjustment) return;
    onApplyAdjustment(selectedRating, currentAdjustment.adjustedLoadKg, 'apply_reduction');
  };

  const handleGrooveRetry = () => {
    onApplyAdjustment('heavy', plannedWorkingWeightKg, 'groove_retry');
  };

  return (
    <Modal
      testID="warmup-assessment-modal"
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerTitleGroup}>
              <Text style={styles.headerBadge}>AUTOREGULATION</Text>
              <Text style={styles.headerTitle}>Warm-Up Set Assessment</Text>
              <Text style={styles.exerciseSubtitle} numberOfLines={1}>
                {exercise.name}
              </Text>
            </View>
            <TouchableOpacity
              testID="close-warmup-assessment-modal"
              style={styles.closeButton}
              onPress={onDismiss}
              accessibilityLabel="Close warm-up assessment modal"
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollContentContainer}>
            {/* Context Summary Strip */}
            <View style={styles.contextStrip}>
              <View style={styles.contextItem}>
                <Text style={styles.contextLabel}>LAST WARM-UP</Text>
                <Text style={styles.contextValue}>
                  {warmupLoadDisplay} × {warmupSet.reps}
                </Text>
              </View>
              <View style={styles.contextDivider} />
              <View style={styles.contextItem}>
                <Text style={styles.contextLabel}>PLANNED WORK LOAD</Text>
                <Text style={styles.contextValue}>{plannedWorkLoadDisplay}</Text>
              </View>
              <View style={styles.contextDivider} />
              <View style={styles.contextItem}>
                <Text style={styles.contextLabel}>WORK SETS</Text>
                <Text style={styles.contextValue}>{remainingWorkSetsCount} left</Text>
              </View>
            </View>

            {/* Fatigue Flag Advisory */}
            {hasRecentFatigueFlag && (
              <View style={styles.fatigueBanner}>
                <Text style={styles.fatigueBannerText}>
                  ⚠️ Fatigue/pain flagged: Applying conservative bounds (+2.5% / -7.5%).
                </Text>
              </View>
            )}

            <Text style={styles.promptText}>How did that last warm-up single move?</Text>

            {/* Assessment Option Cards: Light, Normal, Heavy */}
            <View style={styles.optionsContainer}>
              {/* Option 1: Light */}
              <TouchableOpacity
                testID="warmup-rating-light"
                style={[
                  styles.ratingCard,
                  selectedRating === 'light' && styles.ratingCardActiveLight,
                ]}
                onPress={() => setSelectedRating('light')}
                activeOpacity={0.7}
                accessibilityLabel="Report warm-up felt light and crisp"
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardIcon}>⚡</Text>
                  <View style={styles.cardTitleBox}>
                    <Text style={styles.cardTitle}>Light / Crisp</Text>
                    <Text style={styles.cardSubtitle}>Moved fast with low perceived effort</Text>
                  </View>
                  <View style={[styles.previewPill, styles.previewPillLight]}>
                    <Text style={styles.previewPillTextLight}>
                      +{Math.round(lightAdj.percentageAdjustment * 1000) / 10}%
                    </Text>
                  </View>
                </View>
                <Text style={styles.cardLoadPreview}>
                  Target: {formatWeight(lightAdj.adjustedLoadKg, unitSystem)}
                </Text>
              </TouchableOpacity>

              {/* Option 2: Normal */}
              <TouchableOpacity
                testID="warmup-rating-normal"
                style={[
                  styles.ratingCard,
                  selectedRating === 'normal' && styles.ratingCardActiveNormal,
                ]}
                onPress={() => setSelectedRating('normal')}
                activeOpacity={0.7}
                accessibilityLabel="Report warm-up felt normal on target"
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardIcon}>🎯</Text>
                  <View style={styles.cardTitleBox}>
                    <Text style={styles.cardTitle}>Normal / On Target</Text>
                    <Text style={styles.cardSubtitle}>Standard speed and readiness</Text>
                  </View>
                  <View style={[styles.previewPill, styles.previewPillNormal]}>
                    <Text style={styles.previewPillTextNormal}>Maintain</Text>
                  </View>
                </View>
                <Text style={styles.cardLoadPreview}>
                  Target: {formatWeight(normalAdj.adjustedLoadKg, unitSystem)}
                </Text>
              </TouchableOpacity>

              {/* Option 3: Heavy / Sluggish */}
              <TouchableOpacity
                testID="warmup-rating-heavy"
                style={[
                  styles.ratingCard,
                  (selectedRating === 'heavy' || selectedRating === 'hard') &&
                    styles.ratingCardActiveHeavy,
                ]}
                onPress={() => setSelectedRating('heavy')}
                activeOpacity={0.7}
                accessibilityLabel="Report warm-up felt heavy and sluggish"
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardIcon}>🛡️</Text>
                  <View style={styles.cardTitleBox}>
                    <Text style={styles.cardTitle}>Heavy / Sluggish</Text>
                    <Text style={styles.cardSubtitle}>Moved slow or felt heavier than expected</Text>
                  </View>
                  <View style={[styles.previewPill, styles.previewPillHeavy]}>
                    <Text style={styles.previewPillTextHeavy}>
                      {Math.round(heavyAdj.percentageAdjustment * 1000) / 10}%
                    </Text>
                  </View>
                </View>
                <Text style={styles.cardLoadPreview}>
                  Target: {formatWeight(heavyAdj.adjustedLoadKg, unitSystem)}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Recommendation Explanation Box */}
            {currentAdjustment && (
              <View style={styles.recommendationContainer}>
                <Text testID="warmup-recommendation-text" style={styles.recommendationText}>
                  {currentAdjustment.recommendation}
                </Text>
                <Text style={styles.recommendationDetail}>
                  Adjustment: {plannedWorkLoadDisplay} →{' '}
                  <Text style={styles.recommendationHighlight}>
                    {formatWeight(currentAdjustment.adjustedLoadKg, unitSystem)}
                  </Text>{' '}
                  (
                  {currentAdjustment.percentageAdjustment >= 0 ? '+' : ''}
                  {Math.round(currentAdjustment.percentageAdjustment * 1000) / 10}%)
                </Text>
              </View>
            )}

            {/* Secondary Confirmation Dialogue for Heavy (Groove Fallacy Protocol) */}
            {(selectedRating === 'heavy' || selectedRating === 'hard') && (
              <View style={styles.grooveCheckContainer}>
                <Text style={styles.grooveCheckTitle}>💡 Groove Check Protocol</Text>
                <Text style={styles.grooveCheckDescription}>
                  Sluggishness can be coordination rather than fatigue. You can take 90s rest and
                  retry the warm-up single to verify before dropping work set load.
                </Text>
                <TouchableOpacity
                  testID="groove-check-retry-btn"
                  style={styles.grooveCheckButton}
                  onPress={handleGrooveRetry}
                  activeOpacity={0.8}
                  accessibilityLabel="Initiate 90 second rest and retry warm-up single"
                >
                  <Text style={styles.grooveCheckButtonText}>
                    ⏱️ Rest 90s & Retry Warm-Up (Keep {plannedWorkLoadDisplay})
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          {/* Action Footer */}
          <View style={styles.footerRow}>
            <TouchableOpacity
              testID="dismiss-warmup-assessment-btn"
              style={styles.dismissButton}
              onPress={onDismiss}
              activeOpacity={0.7}
              accessibilityLabel="Dismiss assessment without changing work loads"
            >
              <Text style={styles.dismissButtonText}>Skip</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="apply-warmup-adjustment-btn"
              style={[
                styles.applyButton,
                !selectedRating && styles.applyButtonDisabled,
                selectedRating === 'light' && styles.applyButtonLight,
                selectedRating === 'normal' && styles.applyButtonNormal,
                (selectedRating === 'heavy' || selectedRating === 'hard') &&
                  styles.applyButtonHeavy,
              ]}
              onPress={handleConfirmPrimary}
              disabled={!selectedRating}
              activeOpacity={0.8}
              accessibilityLabel="Apply load adjustment to working sets"
            >
              <Text style={styles.applyButtonText}>
                {!selectedRating
                  ? 'Select an Assessment'
                  : selectedRating === 'light'
                  ? `Apply ${formatWeight(lightAdj.adjustedLoadKg, unitSystem)} (+${Math.round(lightAdj.percentageAdjustment * 1000) / 10}%)`
                  : selectedRating === 'normal'
                  ? `Maintain ${plannedWorkLoadDisplay}`
                  : `Apply ${formatWeight(heavyAdj.adjustedLoadKg, unitSystem)} (${Math.round(heavyAdj.percentageAdjustment * 1000) / 10}%)`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    backgroundColor: '#121214',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272A',
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#27272A',
  },
  headerTitleGroup: {
    flex: 1,
    paddingRight: 12,
  },
  headerBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#3B82F6',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  exerciseSubtitle: {
    fontSize: 13,
    color: '#A1A1AA',
    marginTop: 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#27272A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 15,
    color: '#A1A1AA',
    fontWeight: 'bold',
  },
  scrollContent: {
    flexGrow: 0,
  },
  scrollContentContainer: {
    padding: 20,
  },
  contextStrip: {
    flexDirection: 'row',
    backgroundColor: '#18181B',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#27272A',
    marginBottom: 16,
    alignItems: 'center',
  },
  contextItem: {
    flex: 1,
    alignItems: 'center',
  },
  contextDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#27272A',
  },
  contextLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#71717A',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  contextValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FAFAFA',
  },
  fatigueBanner: {
    backgroundColor: '#78350F22',
    borderColor: '#B45309',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  fatigueBannerText: {
    fontSize: 12,
    color: '#FDE68A',
    fontWeight: '500',
  },
  promptText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E4E4E7',
    marginBottom: 12,
  },
  optionsContainer: {
    gap: 10,
    marginBottom: 16,
  },
  ratingCard: {
    backgroundColor: '#18181B',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#27272A',
    padding: 14,
  },
  ratingCardActiveLight: {
    borderColor: '#10B981',
    backgroundColor: '#064E3B20',
  },
  ratingCardActiveNormal: {
    borderColor: '#3B82F6',
    backgroundColor: '#1E3A8A20',
  },
  ratingCardActiveHeavy: {
    borderColor: '#EF4444',
    backgroundColor: '#7F1D1D20',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  cardTitleBox: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  cardSubtitle: {
    fontSize: 11,
    color: '#71717A',
    marginTop: 1,
  },
  previewPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  previewPillLight: {
    backgroundColor: '#064E3B',
  },
  previewPillTextLight: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6EE7B7',
  },
  previewPillNormal: {
    backgroundColor: '#1E3A8A',
  },
  previewPillTextNormal: {
    fontSize: 11,
    fontWeight: '700',
    color: '#93C5FD',
  },
  previewPillHeavy: {
    backgroundColor: '#7F1D1D',
  },
  previewPillTextHeavy: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FCA5A5',
  },
  cardLoadPreview: {
    fontSize: 12,
    fontWeight: '600',
    color: '#D4D4D8',
    marginLeft: 30,
  },
  recommendationContainer: {
    backgroundColor: '#18181B',
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#3B82F6',
    padding: 12,
    marginBottom: 16,
  },
  recommendationText: {
    fontSize: 13,
    color: '#E4E4E7',
    fontWeight: '500',
    lineHeight: 18,
    marginBottom: 4,
  },
  recommendationDetail: {
    fontSize: 12,
    color: '#A1A1AA',
  },
  recommendationHighlight: {
    color: '#FAFAFA',
    fontWeight: '700',
  },
  grooveCheckContainer: {
    backgroundColor: '#27272A44',
    borderWidth: 1,
    borderColor: '#3F3F46',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  grooveCheckTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F59E0B',
    marginBottom: 4,
  },
  grooveCheckDescription: {
    fontSize: 11,
    color: '#A1A1AA',
    lineHeight: 16,
    marginBottom: 10,
  },
  grooveCheckButton: {
    backgroundColor: '#78350F44',
    borderColor: '#D97706',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  grooveCheckButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FDE68A',
  },
  footerRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#27272A',
    gap: 12,
  },
  dismissButton: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3F3F46',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#A1A1AA',
  },
  applyButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyButtonDisabled: {
    opacity: 0.5,
  },
  applyButtonLight: {
    backgroundColor: '#059669',
  },
  applyButtonNormal: {
    backgroundColor: '#2563EB',
  },
  applyButtonHeavy: {
    backgroundColor: '#DC2626',
  },
  applyButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FAFAFA',
  },
});
