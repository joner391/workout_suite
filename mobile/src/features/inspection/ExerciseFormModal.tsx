import { AppIcon } from '../../ui/AppIcon';
import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
/**
 * Workout Suite — ExerciseFormModal
 *
 * Implements Step 2.2: Exercise Catalog Manager & Variant Tree UI
 * Implements ADR-012: Exercise Variant Hierarchy with parent_exercise_id
 * Implements ADR-021: Dumbbell Per-Hand Input & Unilateral Limb Data Modeling
 * Implements ADR-024: Pure Utility Mode (OLED-friendly high-contrast styling)
 * Implements ADR-026: Mechanical Load Normalization Configuration
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
  Alert,
} from 'react-native';
import {
  Exercise,
  ExerciseCategory,
  MuscleGroup,
  LoadMode,
  StandardLiftType,
  WeightUnit,
} from '../../core/types';
import { kgToLbs, lbsToKg } from '../../core/math/unitConversion';

export interface ExerciseFormModalProps {
  visible: boolean;
  initialExercise?: Exercise | null;
  availableRootExercises: Exercise[];
  unitSystem?: WeightUnit;
  onClose: () => void;
  onSave: (exercise: Exercise) => Promise<void> | void;
}

const MUSCLE_GROUPS: MuscleGroup[] = [
  'Chest',
  'Back',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Forearms',
  'Calves',
  'Abs',
  'Traps',
];

const CATEGORIES: ExerciseCategory[] = [
  'Barbell',
  'Dumbbell',
  'Cable',
  'Bodyweight',
  'Machine',
  'Other',
];

const STANDARD_LIFTS: { label: string; value: StandardLiftType | null }[] = [
  { label: 'None', value: null },
  { label: 'Squat', value: 'squat' },
  { label: 'Bench Press', value: 'bench' },
  { label: 'Deadlift', value: 'deadlift' },
  { label: 'Overhead Press', value: 'ohp' },
  { label: 'Barbell Row', value: 'row' },
];

const REST_PRESETS = [60, 90, 120, 180, 240];

export const ExerciseFormModal: React.FC<ExerciseFormModalProps> = ({
  visible,
  initialExercise,
  availableRootExercises,
  unitSystem = 'kg',
  onClose,
  onSave,
}) => {
  const isEditing = Boolean(initialExercise);

  // Form states
  const [name, setName] = useState<string>('');
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>('Chest');
  const [category, setCategory] = useState<ExerciseCategory>('Barbell');
  const [parentExerciseId, setParentExerciseId] = useState<string | null>(null);
  const [standardLiftType, setStandardLiftType] = useState<StandardLiftType | null>(null);

  const [isCompound, setIsCompound] = useState<boolean>(true);
  const [isBodyweight, setIsBodyweight] = useState<boolean>(false);
  const [isUnilateral, setIsUnilateral] = useState<boolean>(false);
  const [loadMode, setLoadMode] = useState<LoadMode>('total');

  const [cableRatio, setCableRatio] = useState<string>('1.0');
  const [barWeightInput, setBarWeightInput] = useState<string>('20');
  const [restSeconds, setRestSeconds] = useState<number>(120);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showParentPicker, setShowParentPicker] = useState<boolean>(false);

  // Sync state when modal becomes visible or initialExercise changes
  useEffect(() => {
    if (visible) {
      if (initialExercise) {
        setName(initialExercise.name);
        setMuscleGroup((initialExercise.muscle_group as MuscleGroup) || 'Chest');
        setCategory(initialExercise.category);
        setParentExerciseId(initialExercise.parent_exercise_id);
        setStandardLiftType(initialExercise.standard_lift_type);
        setIsCompound(initialExercise.is_compound);
        setIsBodyweight(initialExercise.is_bodyweight);
        setIsUnilateral(initialExercise.is_unilateral);
        setLoadMode(initialExercise.load_mode);
        setCableRatio(String(initialExercise.default_cable_ratio || 1.0));

        // Format bar weight based on unit system
        const barKg = initialExercise.default_bar_weight_kg ?? 20.0;
        const displayBar = unitSystem === 'lbs' ? kgToLbs(barKg) : barKg;
        setBarWeightInput(String(Math.round(displayBar * 10) / 10));

        setRestSeconds(initialExercise.default_rest_seconds || 120);
      } else {
        // Defaults for new exercise
        setName('');
        setMuscleGroup('Chest');
        setCategory('Barbell');
        setParentExerciseId(null);
        setStandardLiftType(null);
        setIsCompound(true);
        setIsBodyweight(false);
        setIsUnilateral(false);
        setLoadMode('total');
        setCableRatio('1.0');
        setBarWeightInput(unitSystem === 'lbs' ? '45' : '20');
        setRestSeconds(120);
      }
      setErrorMessage(null);
      setShowParentPicker(false);
    }
  }, [visible, initialExercise, unitSystem]);

  // Adjust defaults when category changes
  const handleCategorySelect = (cat: ExerciseCategory) => {
    setCategory(cat);
    if (cat === 'Dumbbell') {
      setLoadMode('per_hand');
      setIsBodyweight(false);
    } else if (cat === 'Bodyweight') {
      setIsBodyweight(true);
      setLoadMode('total');
    } else if (cat === 'Cable') {
      setLoadMode('total');
      setIsBodyweight(false);
    } else {
      setLoadMode('total');
      setIsBodyweight(false);
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage('Exercise name is required.');
      return;
    }

    const parsedCableRatio = parseFloat(cableRatio);
    const validCableRatio = !isNaN(parsedCableRatio) && parsedCableRatio > 0 ? parsedCableRatio : 1.0;

    const parsedBarInput = parseFloat(barWeightInput);
    const rawBarValue = !isNaN(parsedBarInput) && parsedBarInput >= 0 ? parsedBarInput : 0;
    const barWeightKg = unitSystem === 'lbs' ? lbsToKg(rawBarValue) : rawBarValue;

    const exerciseId = initialExercise
      ? initialExercise.id
      : `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const exerciseToSave: Exercise = {
      id: exerciseId,
      name: trimmedName,
      muscle_group: muscleGroup,
      category,
      is_compound: isCompound,
      is_bodyweight: isBodyweight,
      is_unilateral: isUnilateral,
      load_mode: loadMode,
      default_cable_ratio: validCableRatio,
      default_bar_weight_kg: Math.round(barWeightKg * 10) / 10,
      is_custom: initialExercise ? initialExercise.is_custom : true,
      parent_exercise_id: parentExerciseId,
      standard_lift_type: standardLiftType,
      default_rest_seconds: restSeconds > 0 ? restSeconds : 120,
    };

    try {
      await onSave(exerciseToSave);
      onClose();
    } catch (err) {
      setErrorMessage((err as Error).message || 'Failed to save exercise.');
    }
  };

  // Filter root candidates (exclude self and child variants)
  const candidateParents = availableRootExercises.filter(
    (e) => (!initialExercise || e.id !== initialExercise.id) && e.parent_exercise_id === null
  );

  const selectedParent = candidateParents.find((e) => e.id === parentExerciseId);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>
                {isEditing ? 'Edit Exercise' : 'Create Custom Exercise'}
              </Text>
              <Text style={styles.modalSubtitle}>
                {isEditing ? 'Update exercise properties' : 'Add custom movement to your catalog'}
              </Text>
            </View>
            <TouchableOpacity
              testID="close-exercise-form-btn"
              style={styles.closeButton}
              onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"
            >
              <AppIcon name="close" size={20} color={uiColors.accentText} />
            </TouchableOpacity>
          </View>

          {errorMessage && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{errorMessage}</Text>
            </View>
          )}

          <ScrollView style={styles.scrollForm} showsVerticalScrollIndicator={false}>
            {/* Exercise Name */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>EXERCISE NAME *</Text>
              <TextInput
                testID="exercise-name-input"
                style={styles.textInput}
                placeholder="e.g. Incline Dumbbell Bench Press"
                placeholderTextColor={uiColors.subtle}
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  if (errorMessage) setErrorMessage(null);
                }}
              />
            </View>

            {/* Muscle Group */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>PRIMARY MUSCLE GROUP</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
                {MUSCLE_GROUPS.map((mg) => {
                  const isSelected = muscleGroup === mg;
                  return (
                    <TouchableOpacity
                      key={mg}
                      testID={`muscle-chip-${mg}`}
                      style={[styles.chip, isSelected && styles.chipActive]}
                      onPress={() => setMuscleGroup(mg)}
                    >
                      <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                        {mg}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Equipment / Category */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>EQUIPMENT / CATEGORY</Text>
              <View style={styles.chipsRow}>
                {CATEGORIES.map((cat) => {
                  const isSelected = category === cat;
                  return (
                    <TouchableOpacity
                      key={cat}
                      testID={`category-chip-${cat}`}
                      style={[styles.chip, isSelected && styles.chipActive]}
                      onPress={() => handleCategorySelect(cat)}
                    >
                      <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Variant Hierarchy */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>ROOT MOVEMENT VARIANT HIERARCHY</Text>
              <Text style={styles.fieldHelpText}>
                Link this movement to a root parent exercise (e.g. Incline Bench ➔ Bench Press) for cross-variant PR aggregation and smart substitution.
              </Text>

              <TouchableOpacity
                testID="parent-picker-btn"
                style={styles.pickerSelector}
                onPress={() => setShowParentPicker(!showParentPicker)}
              >
                <Text style={selectedParent ? styles.pickerSelectedText : styles.pickerPlaceholderText}>
                  {selectedParent ? `↳ Variant of: ${selectedParent.name}` : 'None (Root Movement)'}
                </Text>
                <Text style={styles.pickerChevron}>{showParentPicker ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {showParentPicker && (
                <View style={styles.pickerDropdown}>
                  <TouchableOpacity
                    testID="parent-none-option"
                    style={[styles.pickerItem, !parentExerciseId && styles.pickerItemActive]}
                    onPress={() => {
                      setParentExerciseId(null);
                      setShowParentPicker(false);
                    }}
                  >
                    <Text style={[styles.pickerItemText, !parentExerciseId && styles.pickerItemTextActive]}>
                      None (Independent Root Exercise)
                    </Text>
                  </TouchableOpacity>
                  {candidateParents.map((parent) => (
                    <TouchableOpacity
                      key={parent.id}
                      testID={`parent-option-${parent.id}`}
                      style={[styles.pickerItem, parentExerciseId === parent.id && styles.pickerItemActive]}
                      onPress={() => {
                        setParentExerciseId(parent.id);
                        setShowParentPicker(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.pickerItemText,
                          parentExerciseId === parent.id && styles.pickerItemTextActive,
                        ]}
                      >
                        ↳ {parent.name} ({parent.muscle_group})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Standard Lift Type */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>SBD STRENGTH STANDARD (OPTIONAL)</Text>
              <View style={styles.chipsRow}>
                {STANDARD_LIFTS.map((sl) => {
                  const isSelected = standardLiftType === sl.value;
                  return (
                    <TouchableOpacity
                      key={sl.label}
                      testID={`standard-lift-chip-${sl.value || 'none'}`}
                      style={[styles.chip, isSelected && styles.chipActive]}
                      onPress={() => setStandardLiftType(sl.value)}
                    >
                      <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                        {sl.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Movement Flags & Toggles */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>MECHANICS & ATTRIBUTES</Text>

              {/* Compound Toggle */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelCol}>
                  <Text style={styles.toggleLabel}>Multi-Joint / Compound</Text>
                  <Text style={styles.toggleDesc}>Engages multiple major joints simultaneously</Text>
                </View>
                <Switch
                  testID="compound-switch"
                  value={isCompound}
                  onValueChange={setIsCompound}
                  trackColor={{ false: uiColors.border, true: uiColors.accent }}
                  thumbColor={isCompound ? uiColors.background : uiColors.muted}
                />
              </View>

              {/* Unilateral Toggle */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelCol}>
                  <Text style={styles.toggleLabel}>Unilateral Movement</Text>
                  <Text style={styles.toggleDesc}>Enables independent Left / Right rep inputs in logger</Text>
                </View>
                <Switch
                  testID="unilateral-switch"
                  value={isUnilateral}
                  onValueChange={setIsUnilateral}
                  trackColor={{ false: uiColors.border, true: uiColors.accent }}
                  thumbColor={isUnilateral ? uiColors.background : uiColors.muted}
                />
              </View>

              {/* Bodyweight Toggle */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelCol}>
                  <Text style={styles.toggleLabel}>Bodyweight / Assisted</Text>
                  <Text style={styles.toggleDesc}>Total mechanical load includes athlete bodyweight</Text>
                </View>
                <Switch
                  testID="bodyweight-switch"
                  value={isBodyweight}
                  onValueChange={setIsBodyweight}
                  trackColor={{ false: uiColors.border, true: uiColors.accent }}
                  thumbColor={isBodyweight ? uiColors.background : uiColors.muted}
                />
              </View>
            </View>

            {/* Load Mode: Total vs Per Hand */}
            {category === 'Dumbbell' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>LOAD INPUT MODE</Text>
                <View style={styles.segmentRow}>
                  <TouchableOpacity
                    testID="load-mode-per-hand"
                    style={[styles.segmentBtn, loadMode === 'per_hand' && styles.segmentBtnActive]}
                    onPress={() => setLoadMode('per_hand')}
                  >
                    <Text style={[styles.segmentBtnText, loadMode === 'per_hand' && styles.segmentBtnTextActive]}>
                      Per Hand (Auto-doubles total volume)
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="load-mode-total"
                    style={[styles.segmentBtn, loadMode === 'total' && styles.segmentBtnActive]}
                    onPress={() => setLoadMode('total')}
                  >
                    <Text style={[styles.segmentBtnText, loadMode === 'total' && styles.segmentBtnTextActive]}>
                      Total Combined
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Equipment Specifics: Bar Tare or Cable Ratio */}
            {category === 'Barbell' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>DEFAULT BAR TARE ({unitSystem.toUpperCase()})</Text>
                <View style={styles.numericRow}>
                  <TextInput
                    testID="bar-tare-input"
                    style={styles.numericInput}
                    keyboardType="numeric"
                    value={barWeightInput}
                    onChangeText={setBarWeightInput}
                  />
                  <View style={styles.quickPresetsRow}>
                    {(unitSystem === 'lbs'
                      ? [
                          { val: 45, label: 'Olympic (45)' },
                          { val: 35, label: 'Tech (35)' },
                          { val: 55, label: 'Trap (55)' },
                          { val: 64, label: 'SSB (64)' },
                        ]
                      : [
                          { val: 20, label: 'Olympic (20)' },
                          { val: 15, label: 'Tech (15)' },
                          { val: 25, label: 'Trap (25)' },
                          { val: 29, label: 'SSB (29)' },
                        ]
                    ).map((preset) => (
                      <TouchableOpacity
                        key={preset.val}
                        testID={`bar-preset-${preset.val}`}
                        style={styles.quickChip}
                        onPress={() => setBarWeightInput(String(preset.val))}
                      >
                        <Text style={styles.quickChipText}>{preset.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {category === 'Cable' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>DEFAULT CABLE PULLEY RATIO</Text>
                <Text style={styles.fieldHelpText}>
                  1.0 = Direct 1:1 stack (Lat Pulldown/Row), 0.5 = 2:1 Functional Trainer (50kg pin = 25kg effective).
                </Text>
                <View style={styles.numericRow}>
                  <TextInput
                    testID="cable-ratio-input"
                    style={styles.numericInput}
                    keyboardType="numeric"
                    value={cableRatio}
                    onChangeText={setCableRatio}
                  />
                  <View style={styles.quickPresetsRow}>
                    <TouchableOpacity
                      style={styles.quickChip}
                      onPress={() => setCableRatio('1.0')}
                    >
                      <Text style={styles.quickChipText}>1:1 (1.0)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.quickChip}
                      onPress={() => setCableRatio('0.5')}
                    >
                      <Text style={styles.quickChipText}>2:1 (0.5)</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}

            {/* Default Rest Timer */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>DEFAULT REST TIMER (SECONDS)</Text>
              <View style={styles.chipsRow}>
                {REST_PRESETS.map((sec) => (
                  <TouchableOpacity
                    key={sec}
                    testID={`rest-preset-${sec}`}
                    style={[styles.chip, restSeconds === sec && styles.chipActive]}
                    onPress={() => setRestSeconds(sec)}
                  >
                    <Text style={[styles.chipText, restSeconds === sec && styles.chipTextActive]}>
                      {sec}s ({sec / 60}m)
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.footerActions}>
            <TouchableOpacity
              testID="cancel-exercise-btn"
              style={styles.cancelBtn}
              onPress={onClose}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="save-exercise-btn"
              style={styles.saveBtn}
              onPress={handleSave}
            >
              <Text style={styles.saveBtnText}>
                {isEditing ? 'Save Changes' : 'Create Exercise'}
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
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: uiColors.background,
    borderRadius: uiRadius.card,
    borderWidth: 1,
    borderColor: uiColors.border,
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
  },
  modalTitle: {
    lineHeight: 28,
    flexShrink: 1,
    fontSize: 22,
    fontWeight: '700',
    color: uiColors.text,
  },
  modalSubtitle: {
    fontSize: 12,
    color: uiColors.muted,
    marginTop: 2,
  },
  closeButton: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: 10,
    backgroundColor: uiColors.raised,
    padding: 6,
  },
  errorBanner: {
    backgroundColor: '#3F1212',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    borderRadius: 6,
    padding: 8,
    marginBottom: 10,
  },
  errorBannerText: {
    color: '#F87171',
    fontSize: 12,
    fontWeight: '600',
  },
  scrollForm: {
    flexGrow: 1,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: uiColors.muted,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  fieldHelpText: {
    fontSize: 11,
    color: uiColors.subtle,
    marginBottom: 6,
    lineHeight: 15,
  },
  textInput: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: uiColors.text,
    fontSize: 14,
  },
  chipsScroll: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 6,
    marginBottom: 6,
  },
  chipActive: {
    backgroundColor: '#0F291E',
    borderColor: uiColors.accent,
  },
  chipText: {
    fontSize: 12,
    color: uiColors.muted,
    fontWeight: '600',
  },
  chipTextActive: {
    color: uiColors.accentText,
    fontWeight: '600',
  },
  pickerSelector: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pickerPlaceholderText: {
    color: uiColors.subtle,
    fontSize: 13,
  },
  pickerSelectedText: {
    color: uiColors.accentText,
    fontSize: 13,
    fontWeight: '700',
  },
  pickerChevron: {
    color: uiColors.subtle,
    fontSize: 12,
  },
  pickerDropdown: {
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: 6,
    marginTop: 4,
    maxHeight: 180,
  },
  pickerItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
  },
  pickerItemActive: {
    backgroundColor: '#0F291E',
  },
  pickerItemText: {
    color: uiColors.secondaryText,
    fontSize: 12,
  },
  pickerItemTextActive: {
    color: uiColors.accentText,
    fontWeight: '700',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
  },
  toggleLabelCol: {
    flex: 1,
    paddingRight: 10,
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: uiColors.text,
  },
  toggleDesc: {
    fontSize: 11,
    color: uiColors.subtle,
    marginTop: 2,
  },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: uiColors.raised,
    borderRadius: 6,
    padding: 3,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: uiRadius.control,
  },
  segmentBtnActive: {
    backgroundColor: uiColors.border,
  },
  segmentBtnText: {
    fontSize: 11,
    color: uiColors.subtle,
    fontWeight: '600',
  },
  segmentBtnTextActive: {
    color: uiColors.text,
    fontWeight: '600',
  },
  numericRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  numericInput: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    width: 80,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: uiColors.text,
    fontSize: 14,
    textAlign: 'center',
  },
  quickPresetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  quickChip: {
    backgroundColor: uiColors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: uiRadius.control,
  },
  quickChipText: {
    color: uiColors.secondaryText,
    fontSize: 11,
    fontWeight: '600',
  },
  footerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: uiColors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  saveBtn: {
    flex: 2,
    backgroundColor: uiColors.accent,
    borderRadius: uiRadius.control,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: uiColors.background,
    fontSize: 13,
    fontWeight: '700',
  },
});
