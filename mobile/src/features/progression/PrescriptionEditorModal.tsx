import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
/**
 * Workout Suite — Prescription Editor Modal
 *
 * Implements Section 1.3: Template Exercise Prescription & Editor
 * Allows configuring Target Sets, Target Rep Range (min/max), Target Exertion (RPE vs RIR),
 * Gear/Tare assignment, and Rest Interval in seconds.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { TemplateExercise, GearInventory } from '../../core/types';

export interface PrescriptionEditorModalProps {
  visible: boolean;
  exerciseName: string;
  templateExercise: TemplateExercise;
  availableGear?: GearInventory[];
  onSave: (updated: TemplateExercise) => void;
  onClose: () => void;
}

export const PrescriptionEditorModal: React.FC<PrescriptionEditorModalProps> = ({
  visible,
  exerciseName,
  templateExercise,
  availableGear,
  onSave,
  onClose,
}) => {
  const [sets, setSets] = useState<number>(templateExercise.target_sets ?? 3);
  const [repsMin, setRepsMin] = useState<string>(String(templateExercise.target_reps_min ?? 8));
  const [repsMax, setRepsMax] = useState<string>(String(templateExercise.target_reps_max ?? 12));
  const [gearId, setGearId] = useState<string | null>(templateExercise.gear_id ?? null);
  const [exertionMode, setExertionMode] = useState<'rpe' | 'rir'>(
    templateExercise.target_rir != null ? 'rir' : 'rpe'
  );
  const [targetExertion, setTargetExertion] = useState<string>(
    templateExercise.target_rir != null
      ? String(templateExercise.target_rir)
      : String(templateExercise.target_rpe ?? 8.0)
  );

  useEffect(() => {
    setSets(templateExercise.target_sets ?? 3);
    setRepsMin(String(templateExercise.target_reps_min ?? 8));
    setRepsMax(String(templateExercise.target_reps_max ?? 12));
    setGearId(templateExercise.gear_id ?? null);
    const isRir = templateExercise.target_rir != null;
    setExertionMode(isRir ? 'rir' : 'rpe');
    setTargetExertion(
      isRir ? String(templateExercise.target_rir) : String(templateExercise.target_rpe ?? 8.0)
    );
  }, [templateExercise]);

  const handleSave = () => {
    const parsedMin = parseInt(repsMin, 10) || 8;
    const parsedMax = parseInt(repsMax, 10) || 12;
    const parsedExertion = parseFloat(targetExertion) || (exertionMode === 'rpe' ? 8.0 : 2);

    const updated: TemplateExercise = {
      ...templateExercise,
      gear_id: gearId,
      target_sets: Math.max(1, Math.min(10, sets)),
      target_reps_min: Math.max(1, parsedMin),
      target_reps_max: Math.max(parsedMin, parsedMax),
      target_rpe: exertionMode === 'rpe' ? parsedExertion : null,
      target_rir: exertionMode === 'rir' ? parsedExertion : null,
    };

    onSave(updated);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View testID="prescription-editor-modal" style={styles.content}>
          <Text style={styles.title}>Edit Prescription</Text>
          <Text style={styles.exerciseName} numberOfLines={1}>
            {exerciseName}
          </Text>

          <ScrollView style={styles.body}>
            {/* Target Sets Stepper */}
            <Text style={styles.inputLabel}>Target Working Sets</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                testID="sets-minus-btn"
                style={styles.stepperBtn}
                onPress={() => setSets((s) => Math.max(1, s - 1))}
              >
                <Text style={styles.stepperBtnText}>−</Text>
              </TouchableOpacity>
              <Text testID="target-sets-display" style={styles.stepperValue}>
                {sets} sets
              </Text>
              <TouchableOpacity
                testID="sets-plus-btn"
                style={styles.stepperBtn}
                onPress={() => setSets((s) => Math.min(10, s + 1))}
              >
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            {/* Rep Range Min / Max */}
            <Text style={[styles.inputLabel, { marginTop: 14 }]}>Target Rep Range</Text>
            <View style={styles.repRangeRow}>
              <View style={styles.repCol}>
                <Text style={styles.repColLabel}>Min Reps</Text>
                <TextInput
                  testID="reps-min-input"
                  style={styles.textInput}
                  keyboardType="numeric"
                  value={repsMin}
                  onChangeText={setRepsMin}
                  placeholder="8"
                  placeholderTextColor={uiColors.subtle}
                />
              </View>
              <Text style={styles.repDash}>to</Text>
              <View style={styles.repCol}>
                <Text style={styles.repColLabel}>Max Reps</Text>
                <TextInput
                  testID="reps-max-input"
                  style={styles.textInput}
                  keyboardType="numeric"
                  value={repsMax}
                  onChangeText={setRepsMax}
                  placeholder="12"
                  placeholderTextColor={uiColors.subtle}
                />
              </View>
            </View>

            {/* Exertion Metric: RPE vs RIR */}
            <Text style={[styles.inputLabel, { marginTop: 14 }]}>Target Exertion Metric</Text>
            <View style={styles.exertionToggleRow}>
              <TouchableOpacity
                testID="exertion-mode-rpe"
                style={[styles.toggleBtn, exertionMode === 'rpe' && styles.toggleBtnActive]}
                onPress={() => {
                  setExertionMode('rpe');
                  setTargetExertion('8.0');
                }}
              >
                <Text
                  style={[
                    styles.toggleBtnText,
                    exertionMode === 'rpe' && styles.toggleBtnTextActive,
                  ]}
                >
                  RPE (6.0–10.0)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="exertion-mode-rir"
                style={[styles.toggleBtn, exertionMode === 'rir' && styles.toggleBtnActive]}
                onPress={() => {
                  setExertionMode('rir');
                  setTargetExertion('2');
                }}
              >
                <Text
                  style={[
                    styles.toggleBtnText,
                    exertionMode === 'rir' && styles.toggleBtnTextActive,
                  ]}
                >
                  RIR (0–4 reps)
                </Text>
              </TouchableOpacity>
            </View>

            {/* Exertion Value */}
            <View style={{ marginTop: 8 }}>
              <Text style={styles.repColLabel}>
                {exertionMode === 'rpe' ? 'Target RPE Value' : 'Target Reps in Reserve (RIR)'}
              </Text>
              <TextInput
                testID="target-exertion-input"
                style={styles.textInput}
                keyboardType="numeric"
                value={targetExertion}
                onChangeText={setTargetExertion}
                placeholder={exertionMode === 'rpe' ? '8.0' : '2'}
                placeholderTextColor={uiColors.subtle}
              />
            </View>

            {/* Implement / Bar Selection (ADR-025) */}
            {availableGear && availableGear.length > 0 && (
              <View style={{ marginTop: 14 }}>
                <Text style={styles.inputLabel}>Assigned Equipment / Bar</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.gearChipsRow}
                  style={{ marginTop: 6 }}
                >
                  <TouchableOpacity
                    testID="gear-prescribe-default"
                    style={[styles.gearChip, gearId === null && styles.gearChipActive]}
                    onPress={() => setGearId(null)}
                  >
                    <Text
                      style={[
                        styles.gearChipText,
                        gearId === null && styles.gearChipTextActive,
                      ]}
                    >
                      Default Bar (Standard)
                    </Text>
                  </TouchableOpacity>

                  {availableGear.map((g) => {
                    const isSelected = gearId === g.id;
                    const spec =
                      g.type === 'cable_machine'
                        ? `${g.cable_ratio}:1`
                        : `${g.tare_weight_kg}kg`;
                    return (
                      <TouchableOpacity
                        key={g.id}
                        testID={`gear-prescribe-${g.id}`}
                        style={[styles.gearChip, isSelected && styles.gearChipActive]}
                        onPress={() => setGearId(g.id)}
                      >
                        <Text
                          style={[
                            styles.gearChipText,
                            isSelected && styles.gearChipTextActive,
                          ]}
                        >
                          {g.name} ({spec})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}
          </ScrollView>

          {/* Action Row */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              testID="cancel-prescription-btn"
              style={styles.cancelBtn}
              onPress={onClose}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="save-prescription-btn"
              style={styles.saveBtn}
              onPress={handleSave}
            >
              <Text style={styles.saveBtnText}>Save Prescription</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    backgroundColor: uiColors.surface,
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: uiColors.border,
    maxHeight: '80%',
  },
  title: {
    lineHeight: 28,
    flexShrink: 1,
    color: uiColors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  exerciseName: {
    color: uiColors.accentText,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
    marginBottom: 12,
  },
  body: {
    marginBottom: 10,
  },
  inputLabel: {
    color: uiColors.secondaryText,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: uiColors.raised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.border,
    padding: 6,
  },
  stepperBtn: {
    backgroundColor: uiColors.border,
    width: 36,
    height: 36,
    borderRadius: uiRadius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    color: uiColors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  stepperValue: {
    color: uiColors.accentText,
    fontSize: 15,
    fontWeight: '700',
  },
  repRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  repCol: {
    flex: 1,
  },
  repColLabel: {
    color: uiColors.subtle,
    fontSize: 11,
    marginBottom: 4,
  },
  repDash: {
    color: uiColors.subtle,
    fontSize: 13,
    marginTop: 14,
  },
  textInput: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    color: uiColors.text,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  exertionToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  toggleBtn: {
    flex: 1,
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    paddingVertical: 8,
    borderRadius: uiRadius.control,
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: uiColors.accent,
    borderColor: uiColors.accent,
  },
  toggleBtnText: {
    color: uiColors.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  toggleBtnTextActive: {
    color: uiColors.background,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 14,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelBtnText: {
    color: uiColors.subtle,
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: uiColors.accent,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: uiRadius.control,
  },
  saveBtnText: {
    color: uiColors.background,
    fontSize: 13,
    fontWeight: '700',
  },
  gearChipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  gearChip: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  gearChipActive: {
    backgroundColor: '#0F291E',
    borderColor: uiColors.accent,
  },
  gearChipText: {
    color: uiColors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  gearChipTextActive: {
    color: uiColors.accentText,
    fontWeight: '600',
  },
});
