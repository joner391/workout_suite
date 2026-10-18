/**
 * Workout Suite — SetRowComponent
 *
 * Implements ADR-010: Write-Through Active Session Logging
 * Implements ADR-021: Dumbbell Per-Hand Input & Unilateral Limb Data Modeling
 * Implements ADR-022: In-Logger Plate Loading Calculator Popover Trigger
 * Implements ADR-024: Pure Utility Mode (OLED-friendly high-contrast styling)
 *
 * Features:
 * - Clean, uncrowded compact set row by default with generous input touch targets
 * - Accordion expandable editor drawer revealing weight & rep pills, intensity steppers, and clear action
 * - 1-tap set completion checkmark with vivid green feedback (#00E676)
 * - Cycleable Set Type tags: Warmup (W), Working (1..N), Drop (D), Myo-rep (M), Failure (F)
 * - Previous session ghost placeholders (auto-reference for progressive overload)
 * - 1-tap copy ghost values into active set
 * - Barbell plate calculator trigger button '[Plates]'
 * - Optional per-set notes annotation
 * - Delete set action
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { WorkoutSet, Exercise, SetType, WeightUnit, IntensityMetric } from '../../core/types';

export interface SetRowProps {
  set: WorkoutSet;
  exercise: Exercise;
  ghostSet?: WorkoutSet | null;
  unitSystem?: WeightUnit;
  intensityMetric?: IntensityMetric;
  isCompleted?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onUpdateSet: (updatedFields: Partial<WorkoutSet>) => void;
  onDeleteSet: () => void;
  onToggleComplete: () => void;
  onOpenPlateCalculator?: (targetWeightKg: number) => void;
}

const SET_TYPE_ORDER: SetType[] = ['working', 'warmup', 'drop', 'myorep', 'dc', 'amrap'];

const SET_TYPE_LABELS: Record<SetType, string> = {
  working: 'Reg',
  warmup: 'Warm',
  drop: 'Drop',
  myorep: 'Myo',
  dc: 'DC',
  amrap: 'AMRAP',
};

const SET_TYPE_COLORS: Record<SetType, { bg: string; text: string }> = {
  working: { bg: '#27272A', text: '#FAFAFA' },
  warmup: { bg: '#854D0E', text: '#FEF08A' }, // Amber
  drop: { bg: '#581C87', text: '#E9D5FF' }, // Purple
  myorep: { bg: '#164E63', text: '#A5F3FC' }, // Cyan
  dc: { bg: '#1E3A8A', text: '#BFDBFE' }, // Blue/Indigo
  amrap: { bg: '#7F1D1D', text: '#FEE2E2' }, // Crimson/Red
};

const SetRowComponentInner: React.FC<SetRowProps> = ({
  set,
  exercise,
  ghostSet,
  unitSystem = 'kg',
  intensityMetric = 'RPE',
  isCompleted = false,
  isExpanded: propIsExpanded,
  onToggleExpand,
  onUpdateSet,
  onDeleteSet,
  onToggleComplete,
  onOpenPlateCalculator,
}) => {
  const [internalExpanded, setInternalExpanded] = useState<boolean>(false);
  const [showNotes, setShowNotes] = useState<boolean>(!!set.set_notes);
  const [notesText, setNotesText] = useState<string>(set.set_notes ?? '');
  const [weightInput, setWeightInput] = useState<string | null>(null);
  const [repsInput, setRepsInput] = useState<string | null>(null);
  const [repsRightInput, setRepsRightInput] = useState<string | null>(null);
  const [intensityInput, setIntensityInput] = useState<string | null>(null);

  // Debouncing refs for SQLite write-through reduction
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUpdatesRef = useRef<Partial<WorkoutSet>>({});

  const flushPendingUpdates = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (Object.keys(pendingUpdatesRef.current).length > 0) {
      const updates = { ...pendingUpdatesRef.current };
      pendingUpdatesRef.current = {};
      onUpdateSet(updates);
    }
  }, [onUpdateSet]);

  const queueUpdate = useCallback(
    (fields: Partial<WorkoutSet>, immediate: boolean = false) => {
      pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...fields };
      if (immediate) {
        flushPendingUpdates();
      } else {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          flushPendingUpdates();
        }, 350);
      }
    },
    [flushPendingUpdates]
  );

  // Flush on unmount if any updates are pending
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (Object.keys(pendingUpdatesRef.current).length > 0) {
        onUpdateSet(pendingUpdatesRef.current);
      }
    };
  }, [onUpdateSet]);

  const isExpanded = propIsExpanded !== undefined ? propIsExpanded : internalExpanded;

  const toggleExpand = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      setInternalExpanded((prev) => !prev);
    }
  };

  // Cycle set type on tag tap (immediate persistence)
  const handleCycleSetType = () => {
    flushPendingUpdates();
    const currentIndex = SET_TYPE_ORDER.indexOf(set.set_type);
    const nextIndex = (currentIndex + 1) % SET_TYPE_ORDER.length;
    const nextType = SET_TYPE_ORDER[nextIndex];
    if (nextType === 'amrap') {
      onUpdateSet({ set_type: 'amrap', rpe: 10.0, rir: 0.0 });
    } else {
      onUpdateSet({ set_type: nextType });
    }
  };

  // Copy ghost values into current set (immediate persistence)
  const handleCopyGhostValues = () => {
    if (!ghostSet) return;
    flushPendingUpdates();
    setWeightInput(null);
    setRepsInput(null);
    setRepsRightInput(null);
    setIntensityInput(null);
    onUpdateSet({
      raw_input_weight: ghostSet.raw_input_weight,
      weight: ghostSet.weight,
      reps: ghostSet.reps,
      reps_right: ghostSet.reps_right,
      rpe: ghostSet.rpe,
      rir: ghostSet.rir,
    });
  };

  // Handle weight change (debounced persistence)
  const handleWeightChange = (text: string) => {
    const normalized = text.replace(',', '.');
    const cleaned = normalized.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    const sanitized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;

    setWeightInput(sanitized);

    if (sanitized === '' || sanitized === '.') {
      queueUpdate({ raw_input_weight: 0 });
    } else {
      const num = parseFloat(sanitized);
      if (!isNaN(num)) {
        queueUpdate({ raw_input_weight: num });
      }
    }
  };

  const handleWeightBlur = () => {
    setWeightInput(null);
    flushPendingUpdates();
  };

  // Step weight by delta (immediate persistence)
  const handleStepWeight = (delta: number) => {
    flushPendingUpdates();
    setWeightInput(null);
    const current = set.raw_input_weight || 0;
    const next = Math.max(0, Math.round((current + delta) * 10) / 10);
    onUpdateSet({ raw_input_weight: next });
  };

  // Handle reps change (debounced persistence)
  const handleRepsChange = (text: string) => {
    const cleaned = text.replace(/[^0-9]/g, '');
    setRepsInput(cleaned);
    const num = parseInt(cleaned, 10);
    queueUpdate({
      reps: isNaN(num) ? 0 : num,
    });
  };

  const handleRepsBlur = () => {
    setRepsInput(null);
    flushPendingUpdates();
  };

  // Step reps by delta (immediate persistence)
  const handleStepReps = (delta: number) => {
    flushPendingUpdates();
    setRepsInput(null);
    const current = set.reps || 0;
    const next = Math.max(0, current + delta);
    onUpdateSet({ reps: next });
  };

  // Handle unilateral right reps change (debounced persistence)
  const handleRepsRightChange = (text: string) => {
    const cleaned = text.replace(/[^0-9]/g, '');
    setRepsRightInput(cleaned);
    const num = parseInt(cleaned, 10);
    queueUpdate({
      reps_right: isNaN(num) ? null : num,
    });
  };

  const handleRepsRightBlur = () => {
    setRepsRightInput(null);
    flushPendingUpdates();
  };

  // Step unilateral right reps by delta (immediate persistence)
  const handleStepRepsRight = (delta: number) => {
    flushPendingUpdates();
    setRepsRightInput(null);
    const current = set.reps_right !== null && set.reps_right !== undefined ? set.reps_right : (set.reps || 0);
    const next = Math.max(0, current + delta);
    onUpdateSet({ reps_right: next });
  };

  // Handle intensity metric (RPE or RIR) change (debounced persistence)
  const handleIntensityChange = (text: string) => {
    const normalized = text.replace(',', '.');
    const cleaned = normalized.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    const sanitized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;

    setIntensityInput(sanitized);

    if (sanitized === '' || sanitized === '.') {
      if (intensityMetric === 'RPE') {
        queueUpdate({ rpe: null });
      } else {
        queueUpdate({ rir: null });
      }
      return;
    }
    const num = parseFloat(sanitized);
    if (intensityMetric === 'RPE') {
      queueUpdate({ rpe: isNaN(num) ? null : num });
    } else {
      queueUpdate({ rir: isNaN(num) ? null : num });
    }
  };

  const handleIntensityBlur = () => {
    setIntensityInput(null);
    flushPendingUpdates();
  };

  // Step intensity by +/- 0.5 (immediate persistence)
  const handleStepIntensity = (delta: number) => {
    flushPendingUpdates();
    setIntensityInput(null);
    if (intensityMetric === 'RPE') {
      const current = set.rpe ?? 8.0;
      const next = Math.min(10.0, Math.max(1.0, Math.round((current + delta) * 2) / 2));
      onUpdateSet({ rpe: next });
    } else {
      const current = set.rir ?? 2.0;
      const next = Math.min(10.0, Math.max(0.0, Math.round((current + delta) * 2) / 2));
      onUpdateSet({ rir: next });
    }
  };

  // Clear intensity metric (immediate persistence)
  const handleClearIntensity = () => {
    flushPendingUpdates();
    setIntensityInput(null);
    onUpdateSet({ rpe: null, rir: null });
  };

  // Save notes (debounced persistence)
  const handleSaveNotes = (text: string) => {
    setNotesText(text);
    queueUpdate({ set_notes: text.trim() === '' ? null : text.trim() });
  };

  const handleNotesBlur = () => {
    flushPendingUpdates();
  };

  // Determine tag display text
  const typeBadgeLabel = SET_TYPE_LABELS[set.set_type] || 'Reg';
  const typeBadgeColor = SET_TYPE_COLORS[set.set_type] || SET_TYPE_COLORS.working;

  // Ghost display string (formats unilateral L/R reps as weight × L/R)
  const ghostDisplay = ghostSet
    ? exercise.is_unilateral && ghostSet.reps_right !== null && ghostSet.reps_right !== undefined
      ? `${ghostSet.raw_input_weight} × ${ghostSet.reps}/${ghostSet.reps_right}`
      : `${ghostSet.raw_input_weight} × ${ghostSet.reps}`
    : '—';

  const isDumbbell = exercise.load_mode === 'per_hand';
  const isBarbell = exercise.category === 'Barbell';

  return (
    <View style={[styles.container, isCompleted && styles.completedRow]}>
      {/* Primary Compact Row */}
      <View style={styles.row}>
        {/* Set Type Tag (Tappable to cycle) */}
        <TouchableOpacity
          testID="set-type-tag"
          style={[styles.typeBadge, { backgroundColor: typeBadgeColor.bg }]}
          onPress={handleCycleSetType}
          accessibilityLabel={`Set type: ${set.set_type}, set number: ${set.set_number}`}
        >
          <Text style={[styles.typeBadgeText, { color: typeBadgeColor.text }]}>
            {typeBadgeLabel}
          </Text>
        </TouchableOpacity>

        {/* Ghost Reference Column */}
        <TouchableOpacity
          testID="ghost-set-trigger"
          style={styles.ghostColumn}
          onPress={handleCopyGhostValues}
          disabled={!ghostSet}
          accessibilityLabel={`Previous session: ${ghostDisplay}`}
        >
          <Text style={styles.ghostText} numberOfLines={1}>
            {ghostDisplay}
          </Text>
        </TouchableOpacity>

        {/* Weight Column */}
        <View style={styles.weightColumn}>
          <View style={styles.inputWithUnit}>
            <TextInput
              testID="weight-input"
              style={[styles.input, isCompleted && styles.completedInput]}
              keyboardType="decimal-pad"
              selectTextOnFocus={true}
              placeholder={ghostSet ? `${ghostSet.raw_input_weight}` : '0'}
              placeholderTextColor="#71717A"
              value={weightInput !== null ? weightInput : (set.raw_input_weight > 0 ? `${set.raw_input_weight}` : '')}
              onChangeText={handleWeightChange}
              onBlur={handleWeightBlur}
              editable={!isCompleted}
              onFocus={() => { if (!isExpanded) toggleExpand(); }}
            />
            {isDumbbell && (
              <View testID="dumbbell-badge" style={styles.dumbbellBadge}>
                <Text style={styles.dumbbellBadgeText}>×2</Text>
              </View>
            )}
          </View>
        </View>

        {/* Reps Column (Supports Unilateral L/R) */}
        <View style={styles.repsColumn}>
          {exercise.is_unilateral ? (
            <View style={styles.unilateralContainer}>
              <View style={styles.unilateralInputWrapper}>
                <TextInput
                  testID="reps-input-left"
                  style={[styles.miniInput, isCompleted && styles.completedInput]}
                  keyboardType="number-pad"
                  selectTextOnFocus={true}
                  placeholder={ghostSet ? `${ghostSet.reps}` : 'L'}
                  placeholderTextColor="#71717A"
                  value={repsInput !== null ? repsInput : (set.reps > 0 ? `${set.reps}` : '')}
                  onChangeText={handleRepsChange}
                  onBlur={handleRepsBlur}
                  editable={!isCompleted}
                  onFocus={() => { if (!isExpanded) toggleExpand(); }}
                  accessibilityLabel="Left limb reps"
                />
              </View>
              <Text style={styles.unilateralSeparator}>/</Text>
              <View style={styles.unilateralInputWrapper}>
                <TextInput
                  testID="reps-input-right"
                  style={[styles.miniInput, isCompleted && styles.completedInput]}
                  keyboardType="number-pad"
                  selectTextOnFocus={true}
                  placeholder={ghostSet?.reps_right !== null && ghostSet?.reps_right !== undefined ? `${ghostSet.reps_right}` : 'R'}
                  placeholderTextColor="#71717A"
                  value={repsRightInput !== null ? repsRightInput : (set.reps_right && set.reps_right > 0 ? `${set.reps_right}` : '')}
                  onChangeText={handleRepsRightChange}
                  onBlur={handleRepsRightBlur}
                  editable={!isCompleted}
                  onFocus={() => { if (!isExpanded) toggleExpand(); }}
                  accessibilityLabel="Right limb reps"
                />
              </View>
            </View>
          ) : (
            <TextInput
              testID="reps-input"
              style={[styles.input, isCompleted && styles.completedInput]}
              keyboardType="number-pad"
              selectTextOnFocus={true}
              placeholder={ghostSet ? `${ghostSet.reps}` : '0'}
              placeholderTextColor="#71717A"
              value={repsInput !== null ? repsInput : (set.reps > 0 ? `${set.reps}` : '')}
              onChangeText={handleRepsChange}
              onBlur={handleRepsBlur}
              editable={!isCompleted}
              onFocus={() => { if (!isExpanded) toggleExpand(); }}
            />
          )}
        </View>

        {/* Intensity Metric (RPE / RIR) Column */}
        <View style={styles.intensityColumn}>
          <TextInput
            testID="intensity-input"
            style={[styles.intensityInput, isCompleted && styles.completedInput]}
            keyboardType="decimal-pad"
            selectTextOnFocus={true}
            placeholder="—"
            placeholderTextColor="#71717A"
            value={
              intensityInput !== null
                ? intensityInput
                : intensityMetric === 'RPE'
                  ? (set.rpe !== null ? `${set.rpe}` : '')
                  : (set.rir !== null ? `${set.rir}` : '')
            }
            onChangeText={handleIntensityChange}
            onBlur={handleIntensityBlur}
            editable={!isCompleted}
            onFocus={() => { if (!isExpanded) toggleExpand(); }}
          />
        </View>

        {/* Expand Toggle Button */}
        <TouchableOpacity
          style={styles.expandToggleButton}
          onPress={toggleExpand}
          accessibilityLabel={isExpanded ? 'Collapse editor' : 'Expand editor'}
        >
          <Text style={[styles.expandToggleText, isExpanded && styles.expandToggleTextActive]}>
            {isExpanded ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>

        {/* 1-Tap Checkbox Complete Action */}
        <TouchableOpacity
          testID="complete-set-checkbox"
          style={[styles.checkbox, isCompleted && styles.completedCheckbox]}
          onPress={() => {
            if (!isCompleted) {
              try {
                if (Haptics?.impactAsync && Haptics?.ImpactFeedbackStyle) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                }
              } catch {
                // Safe fallback
              }
            }
            onToggleComplete();
          }}
          accessibilityLabel={isCompleted ? 'Mark set incomplete' : 'Mark set complete'}
        >
          {isCompleted ? (
            <Text style={styles.checkmarkText}>✓</Text>
          ) : (
            <View style={styles.emptyCheckboxDot} />
          )}
        </TouchableOpacity>
      </View>

      {/* Accordion Editor Drawer (reveals steppers, plate calculator, and clear button) */}
      {isExpanded && !isCompleted && (
        <View style={styles.editorDrawer}>
          {/* Row 1: Weight Steppers & Plate Calculator */}
          <View style={styles.drawerControlGroup}>
            <Text style={styles.drawerControlLabel}>WEIGHT ({unitSystem.toUpperCase()})</Text>
            <View style={styles.pillRow}>
              {isBarbell && (
                <TouchableOpacity
                  style={styles.pillButton}
                  onPress={() => handleStepWeight(-5)}
                >
                  <Text style={styles.pillButtonText}>-5</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.pillButton}
                onPress={() => handleStepWeight(-2.5)}
              >
                <Text style={styles.pillButtonText}>-2.5</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.pillButton}
                onPress={() => handleStepWeight(-1)}
              >
                <Text style={styles.pillButtonText}>-1</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pillButton, styles.pillButtonPositive]}
                onPress={() => handleStepWeight(1)}
              >
                <Text style={[styles.pillButtonText, styles.pillButtonTextPositive]}>+1</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pillButton, styles.pillButtonPositive]}
                onPress={() => handleStepWeight(2.5)}
              >
                <Text style={[styles.pillButtonText, styles.pillButtonTextPositive]}>+2.5</Text>
              </TouchableOpacity>
              {isBarbell && (
                <TouchableOpacity
                  style={[styles.pillButton, styles.pillButtonPositive]}
                  onPress={() => handleStepWeight(5)}
                >
                  <Text style={[styles.pillButtonText, styles.pillButtonTextPositive]}>+5</Text>
                </TouchableOpacity>
              )}
              {isBarbell && onOpenPlateCalculator && (
                <TouchableOpacity
                  testID="plate-calculator-trigger"
                  style={styles.platePillButton}
                  onPress={() => onOpenPlateCalculator(set.raw_input_weight)}
                  accessibilityLabel="Open plate calculator"
                >
                  <Text style={styles.platePillButtonText}>⚖ Plates</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Row 2: Reps & Intensity Steppers */}
          <View style={styles.drawerSplitRow}>
            {/* Reps */}
            <View style={styles.drawerHalfGroup}>
              <Text style={styles.drawerControlLabel}>
                {exercise.is_unilateral ? 'REPS (L / R)' : 'REPS'}
              </Text>
              {exercise.is_unilateral ? (
                <View style={styles.pillRow}>
                  <TouchableOpacity
                    testID="step-reps-left-minus"
                    style={styles.pillButton}
                    onPress={() => handleStepReps(-1)}
                    accessibilityLabel="Left reps minus 1"
                  >
                    <Text style={styles.pillButtonText}>L-1</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="step-reps-left-plus"
                    style={[styles.pillButton, styles.pillButtonPositive]}
                    onPress={() => handleStepReps(1)}
                    accessibilityLabel="Left reps plus 1"
                  >
                    <Text style={[styles.pillButtonText, styles.pillButtonTextPositive]}>L+1</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="step-reps-right-minus"
                    style={styles.pillButton}
                    onPress={() => handleStepRepsRight(-1)}
                    accessibilityLabel="Right reps minus 1"
                  >
                    <Text style={styles.pillButtonText}>R-1</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="step-reps-right-plus"
                    style={[styles.pillButton, styles.pillButtonPositive]}
                    onPress={() => handleStepRepsRight(1)}
                    accessibilityLabel="Right reps plus 1"
                  >
                    <Text style={[styles.pillButtonText, styles.pillButtonTextPositive]}>R+1</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.pillRow}>
                  <TouchableOpacity
                    testID="step-reps-minus"
                    style={styles.pillButton}
                    onPress={() => handleStepReps(-1)}
                  >
                    <Text style={styles.pillButtonText}>-1</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="step-reps-plus"
                    style={[styles.pillButton, styles.pillButtonPositive]}
                    onPress={() => handleStepReps(1)}
                  >
                    <Text style={[styles.pillButtonText, styles.pillButtonTextPositive]}>+1</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Intensity */}
            <View style={styles.drawerHalfGroup}>
              <Text style={styles.drawerControlLabel}>{intensityMetric}</Text>
              <View style={styles.pillRow}>
                <TouchableOpacity
                  testID="step-intensity-minus"
                  style={styles.pillButton}
                  onPress={() => handleStepIntensity(-0.5)}
                >
                  <Text style={styles.pillButtonText}>-0.5</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="step-intensity-plus"
                  style={[styles.pillButton, styles.pillButtonPositive]}
                  onPress={() => handleStepIntensity(0.5)}
                >
                  <Text style={[styles.pillButtonText, styles.pillButtonTextPositive]}>+0.5</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="clear-intensity-button"
                  style={styles.clearPillButton}
                  onPress={handleClearIntensity}
                >
                  <Text style={styles.clearPillButtonText}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="amrap-intensity-button"
                  style={[
                    styles.amrapPillButton,
                    (set.rir === 0 || set.rpe === 10) && styles.amrapPillButtonActive,
                  ]}
                  onPress={() => {
                    flushPendingUpdates();
                    setIntensityInput(null);
                    onUpdateSet({ rir: 0.0, rpe: 10.0 });
                  }}
                  accessibilityLabel="Set as AMRAP 0 RIR"
                >
                  <Text
                    style={[
                      styles.amrapPillButtonText,
                      (set.rir === 0 || set.rpe === 10) && styles.amrapPillButtonTextActive,
                    ]}
                  >
                    AMRAP
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Row 3: Notes toggle & Delete set */}
          <View style={styles.drawerActionsRow}>
            <TouchableOpacity
              testID="toggle-notes-button"
              onPress={() => setShowNotes(!showNotes)}
              style={styles.notesToggleButton}
            >
              <Text style={styles.notesToggleText}>
                {showNotes ? 'Hide note' : set.set_notes ? `Note: "${set.set_notes}"` : '+ Note'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="delete-set-button"
              onPress={() => {
                if (debounceTimerRef.current) {
                  clearTimeout(debounceTimerRef.current);
                  debounceTimerRef.current = null;
                }
                pendingUpdatesRef.current = {};
                onDeleteSet();
              }}
              style={styles.deleteButton}
              accessibilityLabel="Delete set"
            >
              <Text style={styles.deleteButtonText}>✕ Delete</Text>
            </TouchableOpacity>
          </View>

          {/* Expandable Set Note Input */}
          {showNotes && (
            <View style={styles.notesContainer}>
              <TextInput
                testID="set-notes-input"
                style={styles.notesInput}
                placeholder="Add set note (e.g. paused rep, belt on, felt tight)..."
                placeholderTextColor="#71717A"
                value={notesText}
                onChangeText={handleSaveNotes}
                onBlur={handleNotesBlur}
                multiline
              />
            </View>
          )}
        </View>
      )}
    </View>
  );
};

export const SetRowComponent = React.memo(
  SetRowComponentInner,
  (prev, next) => {
    return (
      prev.set === next.set &&
      prev.exercise === next.exercise &&
      prev.ghostSet === next.ghostSet &&
      prev.unitSystem === next.unitSystem &&
      prev.intensityMetric === next.intensityMetric &&
      prev.isCompleted === next.isCompleted &&
      prev.isExpanded === next.isExpanded
    );
  }
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#09090B',
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  completedRow: {
    backgroundColor: '#0F1A12', // Subtle green tint for completed set
    borderBottomColor: '#14532D',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeBadge: {
    minWidth: 46,
    height: 34,
    paddingHorizontal: 6,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  ghostColumn: {
    width: 64,
    justifyContent: 'center',
    marginRight: 6,
  },
  ghostText: {
    fontSize: 11,
    color: '#71717A',
    fontWeight: '500',
  },
  weightColumn: {
    flex: 1.3,
    marginRight: 6,
  },
  inputWithUnit: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 38,
    backgroundColor: '#18181B',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#27272A',
    color: '#FAFAFA',
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  completedInput: {
    color: '#86EFAC',
    borderColor: '#166534',
  },
  dumbbellBadge: {
    marginLeft: 3,
    backgroundColor: '#27272A',
    paddingHorizontal: 3,
    paddingVertical: 2,
    borderRadius: 4,
  },
  dumbbellBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#A1A1AA',
  },
  repsColumn: {
    flex: 1.0,
    marginRight: 6,
  },
  unilateralContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  unilateralInputWrapper: {
    flex: 1,
  },
  unilateralSeparator: {
    color: '#71717A',
    fontSize: 12,
  },
  miniInput: {
    width: '100%',
    height: 38,
    backgroundColor: '#18181B',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#27272A',
    color: '#FAFAFA',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 2,
  },
  intensityColumn: {
    width: 52,
    marginRight: 4,
  },
  intensityInput: {
    width: '100%',
    height: 38,
    backgroundColor: '#18181B',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#27272A',
    color: '#FAFAFA',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
  },
  expandToggleButton: {
    width: 24,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  expandToggleText: {
    fontSize: 10,
    color: '#71717A',
  },
  expandToggleTextActive: {
    color: '#00E676',
  },
  checkbox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#3F3F46',
    backgroundColor: '#18181B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  completedCheckbox: {
    backgroundColor: '#00E676', // Vivid green 1-tap feedback
    borderColor: '#00E676',
  },
  checkmarkText: {
    color: '#000000',
    fontSize: 18,
    fontWeight: '900',
  },
  emptyCheckboxDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#52525B',
  },
  // Expanded Drawer Styles
  editorDrawer: {
    marginTop: 8,
    paddingTop: 8,
    paddingBottom: 4,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: '#27272A',
    backgroundColor: '#121215',
    borderRadius: 8,
  },
  drawerControlGroup: {
    marginBottom: 8,
  },
  drawerControlLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#71717A',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  drawerSplitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  drawerHalfGroup: {
    flex: 1,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  pillButton: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#27272A',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3F3F46',
  },
  pillButtonPositive: {
    backgroundColor: 'rgba(0, 230, 118, 0.1)',
    borderColor: 'rgba(0, 230, 118, 0.3)',
  },
  pillButtonText: {
    color: '#FAFAFA',
    fontSize: 12,
    fontWeight: '700',
  },
  pillButtonTextPositive: {
    color: '#00E676',
  },
  platePillButton: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#1E293B',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  platePillButtonText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  clearPillButton: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: '#18181B',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#52525B',
  },
  clearPillButtonText: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '600',
  },
  amrapPillButton: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: '#1C1917',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#78350F',
  },
  amrapPillButtonActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: '#EF4444',
  },
  amrapPillButtonText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '700',
  },
  amrapPillButtonTextActive: {
    color: '#EF4444',
  },
  drawerActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#18181B',
    marginTop: 4,
  },
  notesToggleButton: {
    paddingVertical: 4,
  },
  notesToggleText: {
    fontSize: 12,
    color: '#A1A1AA',
    fontStyle: 'italic',
  },
  deleteButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  deleteButtonText: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '600',
  },
  notesContainer: {
    marginTop: 6,
  },
  notesInput: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    color: '#E4E4E7',
    fontSize: 12,
    padding: 8,
    minHeight: 40,
  },
});
