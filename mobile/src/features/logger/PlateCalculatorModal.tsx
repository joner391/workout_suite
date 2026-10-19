/**
 * Workout Suite — PlateCalculatorModal
 *
 * Implements ADR-022: In-Logger Plate Loading Calculator & Cognitive Offloading
 * Implements ADR-025: Equipment Mechanical Advantage Profiles (Bar Tare Weights)
 *
 * Features:
 * - 1-tap barbell plate calculation per sleeve using greedy solver
 * - Specialty bar tare presets (20 kg Olympic, 29 kg SSB, 25 kg Trap Bar, 15 kg Tech Bar)
 * - Visual Olympic color-coded plate graphics per side
 * - Quick weight adjustment steppers (+/- 1.25, 2.5, 5 kg)
 * - Odd remainder warning
 * - "Apply to Set" 1-tap action
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import {
  calculatePlateLoading,
  DEFAULT_BAR_TARE_KG,
  DEFAULT_PLATE_DENOMINATIONS_KG,
} from '../../core/math/plateCalculator';

export interface PlateCalculatorModalProps {
  visible: boolean;
  initialWeightKg: number;
  initialBarTareKg?: number;
  exerciseName?: string;
  gearName?: string | null;
  onApplyWeight?: (weightKg: number) => void;
  onClose: () => void;
}

interface BarTarePreset {
  label: string;
  weightKg: number;
}

const BAR_PRESETS: BarTarePreset[] = [
  { label: 'Olympic (20 kg)', weightKg: 20.0 },
  { label: 'SSB (29 kg)', weightKg: 29.0 },
  { label: 'Trap Bar (25 kg)', weightKg: 25.0 },
  { label: 'Tech Bar (15 kg)', weightKg: 15.0 },
];

/**
 * Standard IWF Olympic plate colors and visual heights.
 */
const PLATE_STYLES: Record<number, { bg: string; text: string; height: number; width: number }> = {
  25: { bg: '#DC2626', text: '#FFFFFF', height: 90, width: 22 }, // Red
  20: { bg: '#2563EB', text: '#FFFFFF', height: 86, width: 20 }, // Blue
  15: { bg: '#CA8A04', text: '#000000', height: 78, width: 18 }, // Yellow
  10: { bg: '#16A34A', text: '#FFFFFF', height: 70, width: 16 }, // Green
  5: { bg: '#E4E4E7', text: '#000000', height: 56, width: 14 }, // White
  2.5: { bg: '#3F3F46', text: '#FFFFFF', height: 46, width: 12 }, // Black/Dark
  1.25: { bg: '#94A3B8', text: '#000000', height: 38, width: 10 }, // Chrome/Silver
};

export const PlateCalculatorModal: React.FC<PlateCalculatorModalProps> = ({
  visible,
  initialWeightKg,
  initialBarTareKg = DEFAULT_BAR_TARE_KG,
  exerciseName,
  gearName,
  onApplyWeight,
  onClose,
}) => {
  const initialValue = initialWeightKg > 0 ? initialWeightKg : initialBarTareKg;
  const [targetWeight, setTargetWeight] = useState<number>(initialValue);
  const [barTare, setBarTare] = useState<number>(initialBarTareKg);
  const [rawText, setRawText] = useState<string>(String(initialValue));

  // Sync state whenever modal is opened or initial props change
  useEffect(() => {
    if (visible) {
      const init = initialWeightKg > 0 ? initialWeightKg : initialBarTareKg;
      setTargetWeight(init);
      setRawText(String(init));
      setBarTare(initialBarTareKg);
    }
  }, [visible, initialWeightKg, initialBarTareKg]);

  // Re-calculate plates per side
  const calculation = useMemo(() => {
    return calculatePlateLoading(targetWeight, {
      barTareKg: barTare,
      availablePlatesKg: DEFAULT_PLATE_DENOMINATIONS_KG,
    });
  }, [targetWeight, barTare]);

  // Aggregate plate counts for display (e.g. { 25: 2, 10: 1 })
  const plateCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const p of calculation.platesPerSide) {
      counts[p] = (counts[p] || 0) + 1;
    }
    return counts;
  }, [calculation.platesPerSide]);

  // Weight stepper adjustment
  const handleAdjustWeight = (delta: number) => {
    setTargetWeight((prev) => {
      const next = Math.max(0, Math.round((prev + delta) * 100) / 100);
      setRawText(String(next));
      return next;
    });
  };

  // Direct numeric input adjustment
  const handleTextChange = (text: string) => {
    const normalized = text.replace(',', '.');
    const cleaned = normalized.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    const sanitized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
    setRawText(sanitized);

    if (sanitized === '' || sanitized === '.') {
      setTargetWeight(0);
    } else {
      const parsed = parseFloat(sanitized);
      if (!isNaN(parsed) && parsed >= 0) {
        setTargetWeight(parsed);
      }
    }
  };

  const handleApply = () => {
    if (onApplyWeight) {
      onApplyWeight(targetWeight);
    }
    onClose();
  };

  return (
    <Modal
      testID="plate-calculator-modal"
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.modalTitle}>Plate Calculator</Text>
              {exerciseName && (
                <Text style={styles.modalSubtitle} numberOfLines={1}>
                  {exerciseName} {gearName ? `• ${gearName}` : ''}
                </Text>
              )}
            </View>
            <TouchableOpacity
              testID="plate-calculator-close"
              style={styles.closeButton}
              onPress={onClose}
              accessibilityLabel="Close plate calculator"
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Target Weight Header, Numeric Input & Steppers */}
            <View style={styles.targetSection}>
              <Text style={styles.targetLabel}>TOTAL BARBELL WEIGHT</Text>
              <View style={styles.targetInputContainer}>
                <TextInput
                  testID="plate-calc-target-input"
                  style={styles.targetNumericInput}
                  keyboardType="decimal-pad"
                  value={rawText}
                  onChangeText={handleTextChange}
                  selectTextOnFocus
                  placeholder="0"
                  placeholderTextColor="#71717A"
                  accessibilityLabel="Target barbell weight in kg"
                />
                <Text style={styles.targetUnit}>kg</Text>
              </View>
              <Text testID="plate-calc-target-weight" style={styles.targetSubDisplay}>
                {targetWeight.toFixed(2).replace(/\.00$/, '')} kg
              </Text>

              {/* Quick Stepper Row */}
              <View style={styles.stepperRow}>
                <TouchableOpacity
                  testID="plate-stepper-minus-5"
                  style={styles.stepperChip}
                  onPress={() => handleAdjustWeight(-5)}
                >
                  <Text style={styles.stepperChipText}>-5</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="plate-stepper-minus-2.5"
                  style={styles.stepperChip}
                  onPress={() => handleAdjustWeight(-2.5)}
                >
                  <Text style={styles.stepperChipText}>-2.5</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="plate-stepper-minus-1.25"
                  style={styles.stepperChip}
                  onPress={() => handleAdjustWeight(-1.25)}
                >
                  <Text style={styles.stepperChipText}>-1.25</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="plate-stepper-plus-1.25"
                  style={styles.stepperChip}
                  onPress={() => handleAdjustWeight(1.25)}
                >
                  <Text style={styles.stepperChipText}>+1.25</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="plate-stepper-plus-2.5"
                  style={styles.stepperChip}
                  onPress={() => handleAdjustWeight(2.5)}
                >
                  <Text style={styles.stepperChipText}>+2.5</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="plate-stepper-plus-5"
                  style={styles.stepperChip}
                  onPress={() => handleAdjustWeight(5)}
                >
                  <Text style={styles.stepperChipText}>+5</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Barbell Implement Selection */}
            <View style={styles.barSection}>
              <Text style={styles.sectionHeader}>BARBELL TARE</Text>
              <View style={styles.barPresetsRow}>
                {BAR_PRESETS.map((preset) => {
                  const isSelected = barTare === preset.weightKg;
                  return (
                    <TouchableOpacity
                      key={preset.label}
                      testID={`bar-preset-${preset.weightKg}`}
                      style={[styles.barPresetChip, isSelected && styles.barPresetChipSelected]}
                      onPress={() => setBarTare(preset.weightKg)}
                    >
                      <Text
                        style={[styles.barPresetText, isSelected && styles.barPresetTextSelected]}
                      >
                        {preset.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Graphic Barbell Sleeve Visualizer */}
            <View style={styles.visualizerContainer}>
              <Text style={styles.sectionHeader}>PER SLEEVE (ONE SIDE)</Text>
              <View style={styles.sleeveWrapper}>
                {/* Barbell collar / sleeve core */}
                <View style={styles.barCollar} />
                <View style={styles.barSleeve}>
                  {calculation.platesPerSide.length > 0 ? (
                    calculation.platesPerSide.map((plateWeight, index) => {
                      const styleInfo = PLATE_STYLES[plateWeight] || {
                        bg: '#52525B',
                        text: '#FFFFFF',
                        height: 50,
                        width: 14,
                      };
                      return (
                        <View
                          key={`${plateWeight}-${index}`}
                          testID={`visual-plate-${plateWeight}`}
                          style={[
                            styles.visualPlate,
                            {
                              backgroundColor: styleInfo.bg,
                              height: styleInfo.height,
                              width: styleInfo.width,
                            },
                          ]}
                        >
                          <Text style={[styles.visualPlateText, { color: styleInfo.text }]}>
                            {plateWeight}
                          </Text>
                        </View>
                      );
                    })
                  ) : (
                    <Text style={styles.emptySleeveText}>Empty Bar</Text>
                  )}
                </View>
              </View>

              {/* Weight Breakdown Summary */}
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Weight per side:</Text>
                <Text testID="plate-weight-per-side" style={styles.breakdownValue}>
                  {calculation.weightPerSideKg.toFixed(2).replace(/\.00$/, '')} kg
                </Text>
              </View>

              {/* Odd remainder warning */}
              {calculation.remainderKg > 0 && (
                <View testID="plate-remainder-warning" style={styles.remainderWarningBox}>
                  <Text style={styles.remainderWarningText}>
                    ⚠ Remainder: {calculation.remainderKg} kg cannot be evenly loaded with available plates.
                  </Text>
                </View>
              )}
            </View>

            {/* Inventory List of Plates per Side */}
            <View style={styles.inventoryListSection}>
              <Text style={styles.sectionHeader}>PLATE COUNT PER SIDE</Text>
              {Object.keys(plateCounts).length > 0 ? (
                <View style={styles.plateBadgesWrap}>
                  {Object.entries(plateCounts)
                    .sort(([a], [b]) => parseFloat(b) - parseFloat(a))
                    .map(([weightStr, count]) => {
                      const weightNum = parseFloat(weightStr);
                      const styleInfo = PLATE_STYLES[weightNum] || { bg: '#27272A', text: '#FAFAFA' };
                      return (
                        <View
                          key={weightStr}
                          testID={`plate-count-badge-${weightStr}`}
                          style={[styles.plateCountBadge, { borderColor: styleInfo.bg }]}
                        >
                          <Text style={[styles.plateBadgeWeight, { color: styleInfo.bg }]}>
                            {weightStr} kg
                          </Text>
                          <Text style={styles.plateBadgeCount}>× {count}</Text>
                        </View>
                      );
                    })}
                </View>
              ) : (
                <Text style={styles.noPlatesText}>No plates needed (lift empty bar).</Text>
              )}
            </View>
          </ScrollView>

          {/* Footer Actions */}
          <View style={styles.footerRow}>
            {onApplyWeight && (
              <TouchableOpacity
                testID="plate-apply-button"
                style={styles.applyButton}
                onPress={handleApply}
              >
                <Text style={styles.applyButtonText}>Apply {targetWeight} kg to Set</Text>
              </TouchableOpacity>
            )}
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
  modalContent: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: '#09090B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 18,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
    paddingBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#A1A1AA',
    marginTop: 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#18181B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 14,
    color: '#A1A1AA',
    fontWeight: '700',
  },
  targetSection: {
    alignItems: 'center',
    marginVertical: 14,
  },
  targetLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#71717A',
    letterSpacing: 1,
  },
  targetInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 2,
    gap: 8,
  },
  targetNumericInput: {
    backgroundColor: '#18181B',
    borderWidth: 1.5,
    borderColor: '#38BDF8',
    borderRadius: 8,
    color: '#38BDF8',
    fontSize: 32,
    fontWeight: '900',
    paddingHorizontal: 16,
    paddingVertical: 6,
    textAlign: 'center',
    minWidth: 130,
  },
  targetSubDisplay: {
    fontSize: 12,
    fontWeight: '700',
    color: '#71717A',
    marginBottom: 4,
  },
  targetValueText: {
    fontSize: 40,
    fontWeight: '900',
    color: '#38BDF8',
    marginVertical: 2,
  },
  targetUnit: {
    fontSize: 20,
    color: '#94A3B8',
    fontWeight: '600',
  },
  stepperRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  stepperChip: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  stepperChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E4E4E7',
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#71717A',
    letterSpacing: 1,
    marginBottom: 8,
  },
  barSection: {
    marginVertical: 10,
  },
  barPresetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  barPresetChip: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  barPresetChipSelected: {
    borderColor: '#38BDF8',
    backgroundColor: '#0C4A6E',
  },
  barPresetText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#A1A1AA',
  },
  barPresetTextSelected: {
    color: '#FAFAFA',
    fontWeight: '700',
  },
  visualizerContainer: {
    backgroundColor: '#121215',
    borderRadius: 12,
    padding: 14,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#1E1E24',
  },
  sleeveWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 100,
    justifyContent: 'flex-start',
    paddingHorizontal: 10,
    backgroundColor: '#09090B',
    borderRadius: 8,
    marginVertical: 8,
    overflow: 'hidden',
  },
  barCollar: {
    width: 14,
    height: 40,
    backgroundColor: '#52525B',
    borderRadius: 2,
    marginRight: 6,
  },
  barSleeve: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 14,
    backgroundColor: '#71717A',
    flex: 1,
    borderRadius: 2,
    gap: 3,
    paddingLeft: 4,
  },
  visualPlate: {
    borderRadius: 3,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(0, 0, 0, 0.4)',
  },
  visualPlateText: {
    fontSize: 8,
    fontWeight: '900',
    transform: [{ rotate: '-90deg' }],
  },
  emptySleeveText: {
    fontSize: 11,
    color: '#52525B',
    fontStyle: 'italic',
    paddingLeft: 8,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  breakdownLabel: {
    fontSize: 13,
    color: '#A1A1AA',
  },
  breakdownValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  remainderWarningBox: {
    backgroundColor: '#451A03',
    padding: 8,
    borderRadius: 6,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#B45309',
  },
  remainderWarningText: {
    color: '#FDE68A',
    fontSize: 11,
    fontWeight: '600',
  },
  inventoryListSection: {
    marginVertical: 8,
  },
  plateBadgesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  plateCountBadge: {
    backgroundColor: '#18181B',
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  plateBadgeWeight: {
    fontSize: 13,
    fontWeight: '800',
  },
  plateBadgeCount: {
    fontSize: 12,
    color: '#E4E4E7',
    fontWeight: '600',
  },
  noPlatesText: {
    fontSize: 12,
    color: '#71717A',
    fontStyle: 'italic',
  },
  footerRow: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#18181B',
    paddingTop: 12,
  },
  applyButton: {
    backgroundColor: '#00E676',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#000000',
  },
});
