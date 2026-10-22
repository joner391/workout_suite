import { AppIcon } from '../../ui/AppIcon';
import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Exercise, PainType, JointLocation } from '../../core/types';
import { resolveExerciseJoints } from '../../services/exerciseSubstitutionService';

export interface PainReportSubmitData {
  painType: PainType;
  severity: number;
  jointLocation?: JointLocation | null;
  notes?: string;
  shouldSkipRemainingSets: boolean;
}

export interface PainReportModalProps {
  visible: boolean;
  exercise: Exercise | null;
  workoutId: string;
  onDismiss: () => void;
  onSubmit: (data: PainReportSubmitData) => Promise<void> | void;
}

export const ALL_JOINTS: JointLocation[] = [
  'shoulder',
  'elbow',
  'wrist',
  'lower_back',
  'hip',
  'knee',
  'ankle',
  'neck',
  'chest_pec',
  'other',
];

export const JOINT_LABELS: Record<JointLocation, string> = {
  shoulder: 'Shoulder',
  elbow: 'Elbow',
  wrist: 'Wrist',
  lower_back: 'Lower Back',
  hip: 'Hip',
  knee: 'Knee',
  ankle: 'Ankle',
  neck: 'Neck',
  chest_pec: 'Chest / Pec',
  other: 'Other Joint',
};

export const PainReportModal: React.FC<PainReportModalProps> = ({
  visible,
  exercise,
  workoutId,
  onDismiss,
  onSubmit,
}) => {
  const [painType, setPainType] = useState<PainType>('joint');
  const [severity, setSeverity] = useState<number>(5);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showAllJoints, setShowAllJoints] = useState<boolean>(false);

  const resolvedJoints = useMemo(() => {
    return exercise ? resolveExerciseJoints(exercise) : [];
  }, [exercise]);

  const isMultiJoint = useMemo(() => {
    if (!exercise) return false;
    return exercise.is_compound || resolvedJoints.length > 1;
  }, [exercise, resolvedJoints]);

  const [selectedJoint, setSelectedJoint] = useState<JointLocation | null>(() => {
    if (exercise && !isMultiJoint && resolvedJoints.length === 1) {
      return resolvedJoints[0];
    }
    return null;
  });

  // Re-sync default joint when exercise changes
  useEffect(() => {
    if (exercise) {
      const joints = resolveExerciseJoints(exercise);
      const multi = exercise.is_compound || joints.length > 1;
      if (!multi && joints.length === 1) {
        setSelectedJoint(joints[0]);
      } else {
        setSelectedJoint(null);
      }
      setShowAllJoints(false);
    }
  }, [exercise]);

  const primaryJoints = useMemo(() => {
    return resolvedJoints.length > 0 ? resolvedJoints : (['other'] as JointLocation[]);
  }, [resolvedJoints]);

  const secondaryJoints = useMemo(() => {
    return ALL_JOINTS.filter((j) => !primaryJoints.includes(j));
  }, [primaryJoints]);

  const isSevere = severity > 6;
  const isSubmitDisabled = isSubmitting || (painType === 'joint' && isMultiJoint && !selectedJoint);

  const handleSubmit = async () => {
    if (!exercise || isSubmitting || isSubmitDisabled) return;
    setIsSubmitting(true);
    try {
      const trimmedNotes = notes.trim();
      const finalNotes = selectedJoint
        ? trimmedNotes !== ''
          ? `[Joint: ${selectedJoint}] ${trimmedNotes}`
          : `[Joint: ${selectedJoint}]`
        : trimmedNotes !== ''
        ? trimmedNotes
        : undefined;

      await onSubmit({
        painType,
        severity,
        jointLocation: selectedJoint,
        notes: finalNotes,
        shouldSkipRemainingSets: isSevere,
      });
      // Reset form fields
      setNotes('');
      setSeverity(5);
      setPainType('joint');
      setSelectedJoint(null);
      setShowAllJoints(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getSeverityLabel = (level: number): string => {
    if (level <= 3) return 'Mild (Annoying, technique unaffected)';
    if (level <= 6) return 'Moderate (Affects technique / focus)';
    return 'Severe (Sharp pain / high injury risk)';
  };

  const getSeverityColor = (level: number): string => {
    if (level <= 3) return '#22C55E'; // Green
    if (level <= 6) return '#F59E0B'; // Amber
    return '#EF4444'; // Red
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      testID="pain-report-modal"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerTitleCol}>
              <Text style={styles.modalTitle}>Report Discomfort / Pain</Text>
              {exercise && (
                <Text style={styles.exerciseSubtitle}>
                  {exercise.name} • {exercise.muscle_group}
                </Text>
              )}
            </View>
            <TouchableOpacity
              testID="pain-report-modal-close"
              onPress={onDismiss}
              style={styles.closeBtn}
              accessibilityLabel="Close pain report dialog" accessibilityRole="button"
            >
              <AppIcon name="close" size={20} color={uiColors.accentText} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.bodyScroll} showsVerticalScrollIndicator={false}>
            {/* Step 0: Joint / Articulation Selector */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeading}>Which joint or area hurts?</Text>
              {isMultiJoint && painType === 'joint' && !selectedJoint && (
                <Text testID="joint-required-indicator" style={styles.requiredBadge}>* Select Joint</Text>
              )}
            </View>

            <View style={styles.jointChipsContainer}>
              <View style={styles.jointChipsRow}>
                {primaryJoints.map((j) => {
                  const isSelected = selectedJoint === j;
                  return (
                    <TouchableOpacity
                      key={j}
                      testID={`joint-chip-${j}`}
                      style={[
                        styles.jointChip,
                        isSelected && styles.jointChipSelected,
                      ]}
                      onPress={() => setSelectedJoint(isSelected ? null : j)}
                    >
                      <Text
                        style={[
                          styles.jointChipText,
                          isSelected && styles.jointChipTextSelected,
                        ]}
                      >
                        {JOINT_LABELS[j] || j}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity
                  testID="toggle-all-joints-btn"
                  style={styles.allJointsToggleBtn}
                  onPress={() => setShowAllJoints((prev) => !prev)}
                >
                  <Text style={styles.allJointsToggleText}>
                    {showAllJoints ? '– Less' : '+ All / Other Joints'}
                  </Text>
                </TouchableOpacity>
              </View>

              {showAllJoints && (
                <View style={[styles.jointChipsRow, styles.secondaryChipsRow]}>
                  {secondaryJoints.map((j) => {
                    const isSelected = selectedJoint === j;
                    return (
                      <TouchableOpacity
                        key={j}
                        testID={`joint-chip-${j}`}
                        style={[
                          styles.jointChip,
                          styles.secondaryJointChip,
                          isSelected && styles.jointChipSelected,
                        ]}
                        onPress={() => setSelectedJoint(isSelected ? null : j)}
                      >
                        <Text
                          style={[
                            styles.jointChipText,
                            isSelected && styles.jointChipTextSelected,
                          ]}
                        >
                          {JOINT_LABELS[j] || j}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Step 1: Pain Category (Joint vs Muscle) */}
            <Text style={styles.sectionHeading}>1. What kind of pain is this?</Text>
            <View style={styles.typeSelectorRow}>
              <TouchableOpacity
                testID="pain-type-joint-btn"
                style={[
                  styles.typeCard,
                  painType === 'joint' && styles.typeCardSelectedJoint,
                ]}
                onPress={() => setPainType('joint')}
              >
                <Text style={styles.typeIcon}>🦴</Text>
                <Text
                  style={[
                    styles.typeTitle,
                    painType === 'joint' && styles.typeTitleSelected,
                  ]}
                >
                  Joint / Tendon
                </Text>
                <Text style={styles.typeDescription}>
                  Sharp, pinching, deep in articulation or joint capsule.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="pain-type-muscle-btn"
                style={[
                  styles.typeCard,
                  painType === 'muscle' && styles.typeCardSelectedMuscle,
                ]}
                onPress={() => setPainType('muscle')}
              >
                <AppIcon name="warning" size={20} color={uiColors.accentText} />
                <Text
                  style={[
                    styles.typeTitle,
                    painType === 'muscle' && styles.typeTitleSelected,
                  ]}
                >
                  Muscle
                </Text>
                <Text style={styles.typeDescription}>
                  Diffuse muscle belly strain, spasm, or localized tear ache.
                </Text>
              </TouchableOpacity>
            </View>

            {/* Step 2: Severity Rating Scale (1 to 10) */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeading}>2. Pain Severity (1–10)</Text>
              <Text style={[styles.severityBadge, { color: getSeverityColor(severity) }]}>
                {severity}/10 • {getSeverityLabel(severity)}
              </Text>
            </View>

            <View style={styles.severityGrid}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                const isSelected = severity === num;
                const isNumSevere = num > 6;
                const isNumModerate = num >= 4 && num <= 6;

                let activeBg = '#16A34A';
                if (isNumSevere) activeBg = '#DC2626';
                else if (isNumModerate) activeBg = '#D97706';

                return (
                  <TouchableOpacity
                    key={num}
                    testID={`pain-severity-btn-${num}`}
                    style={[
                      styles.severityBtn,
                      isSelected && {
                        backgroundColor: activeBg,
                        borderColor: uiColors.text,
                      },
                    ]}
                    onPress={() => setSeverity(num)}
                  >
                    <Text
                      style={[
                        styles.severityBtnText,
                        isSelected && styles.severityBtnTextSelected,
                      ]}
                    >
                      {num}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Dynamic Guardrail Warning for Severe Pain (> 6) */}
            {isSevere && (
              <View testID="pain-skip-warning" style={styles.severeWarningBox}>
                <Text style={styles.severeWarningIcon}>⚠️</Text>
                <View style={styles.severeWarningTextCol}>
                  <Text style={styles.severeWarningTitle}>
                    High Pain Score ({severity}/10)
                  </Text>
                  <Text style={styles.severeWarningBody}>
                    To prevent acute tissue injury, submitting will safely skip all remaining
                    uncompleted sets for this exercise.
                  </Text>
                </View>
              </View>
            )}

            {/* Notes Input */}
            <Text style={styles.sectionHeading}>3. Optional Notes</Text>
            <TextInput
              testID="pain-notes-input"
              style={styles.notesInput}
              placeholder="e.g., Sharp pinch at bottom stretch, hurts when locking out..."
              placeholderTextColor={uiColors.subtle}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={2}
            />

            {/* Medical / Physiotherapist Disclaimer */}
            <View testID="pain-physio-disclaimer" style={styles.disclaimerBox}>
              <Text style={styles.disclaimerIcon}>⚕️</Text>
              <Text style={styles.disclaimerText}>
                <Text style={styles.disclaimerBold}>Medical Disclaimer:</Text> datSet is a
                training ledger, not a medical diagnostics provider. If discomfort is sharp,
                radiating, or persists outside the gym, please consult a licensed physiotherapist
                or sports medicine physician before loading this movement again.
              </Text>
            </View>
          </ScrollView>

          {/* Action Footer */}
          <View style={styles.footerRow}>
            <TouchableOpacity
              testID="pain-report-cancel-btn"
              style={styles.cancelBtn}
              onPress={onDismiss}
            >
              <Text style={styles.cancelBtnText}>Dismiss</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="pain-report-submit-btn"
              style={[
                styles.submitBtn,
                isSevere && styles.submitBtnSevere,
                isSubmitDisabled && styles.submitBtnDisabled,
              ]}
              onPress={handleSubmit}
              disabled={isSubmitDisabled}
            >
              <Text style={styles.submitBtnText}>
                {isSubmitting
                  ? 'Saving...'
                  : isSevere
                  ? 'Log & Skip Remaining Sets'
                  : 'Log Pain'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  modalContent: {
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    padding: 18,
    width: '100%',
    maxHeight: '90%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
    paddingBottom: 12,
    marginBottom: 12,
  },
  headerTitleCol: {
    minWidth: 0,
    flex: 1,
  },
  modalTitle: {
    lineHeight: 28,
    flexShrink: 1,
    color: uiColors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  exerciseSubtitle: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  closeBtn: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: 10,
    backgroundColor: uiColors.raised,
    padding: 6,
    marginLeft: 8,
  },
  bodyScroll: {
    maxHeight: 460,
  },
  sectionHeading: {
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  requiredBadge: {
    color: '#F87171',
    fontSize: 11,
    fontWeight: '700',
  },
  jointChipsContainer: {
    marginBottom: 8,
  },
  jointChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  secondaryChipsRow: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
  },
  jointChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: uiColors.raised,
    borderRadius: uiRadius.control,
    borderWidth: 1,
    borderColor: '#3F3F46',
  },
  secondaryJointChip: {
    backgroundColor: uiColors.surface,
    borderColor: uiColors.border,
  },
  jointChipSelected: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: '#38BDF8',
  },
  jointChipText: {
    color: uiColors.secondaryText,
    fontSize: 12,
    fontWeight: '600',
  },
  jointChipTextSelected: {
    color: '#38BDF8',
    fontWeight: '600',
  },
  allJointsToggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: uiColors.border,
    borderRadius: uiRadius.control,
  },
  allJointsToggleText: {
    color: uiColors.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  severityBadge: {
    fontSize: 11,
    fontWeight: '700',
  },
  typeSelectorRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },
  typeCard: {
    flex: 1,
    backgroundColor: uiColors.raised,
    borderWidth: 1.5,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    padding: 12,
    alignItems: 'center',
  },
  typeCardSelectedJoint: {
    borderColor: '#38BDF8',
    backgroundColor: '#0C2233',
  },
  typeCardSelectedMuscle: {
    borderColor: '#EC4899',
    backgroundColor: '#2D1222',
  },
  typeIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  typeTitle: {
    color: uiColors.secondaryText,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  typeTitleSelected: {
    color: uiColors.text,
    fontWeight: '700',
  },
  typeDescription: {
    color: uiColors.subtle,
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 14,
  },
  severityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  severityBtn: {
    width: '18%',
    aspectRatio: 1.1,
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: '#3F3F46',
    borderRadius: uiRadius.control,
    justifyContent: 'center',
    alignItems: 'center',
  },
  severityBtnText: {
    color: '#E4E4E7',
    fontSize: 14,
    fontWeight: '700',
  },
  severityBtnTextSelected: {
    color: uiColors.text,
    fontWeight: '700',
  },
  severeWarningBox: {
    flexDirection: 'row',
    backgroundColor: '#450A0A',
    borderWidth: 1,
    borderColor: '#DC2626',
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    marginBottom: 10,
    alignItems: 'center',
    gap: 10,
  },
  severeWarningIcon: {
    fontSize: 20,
  },
  severeWarningTextCol: {
    flex: 1,
  },
  severeWarningTitle: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '700',
  },
  severeWarningBody: {
    color: '#FEE2E2',
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  notesInput: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    padding: 10,
    color: uiColors.text,
    fontSize: 12,
    textAlignVertical: 'top',
    minHeight: 52,
    marginBottom: 12,
  },
  disclaimerBox: {
    flexDirection: 'row',
    backgroundColor: '#1C1917',
    borderWidth: 1,
    borderColor: '#78350F',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    gap: 8,
  },
  disclaimerIcon: {
    fontSize: 16,
    marginTop: 1,
  },
  disclaimerText: {
    flex: 1,
    color: '#FDE68A',
    fontSize: 10,
    lineHeight: 14,
  },
  disclaimerBold: {
    fontWeight: '700',
    color: '#FBBF24',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
    paddingTop: 12,
    marginTop: 8,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: uiRadius.control,
    backgroundColor: uiColors.raised,
  },
  cancelBtnText: {
    color: uiColors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  submitBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: uiRadius.control,
    backgroundColor: '#2563EB',
  },
  submitBtnSevere: {
    backgroundColor: '#DC2626',
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: uiColors.text,
    fontSize: 13,
    fontWeight: '700',
  },
});
