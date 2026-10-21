/**
 * Workout Suite — ProgressionBuilderModal
 *
 * Implements Step 4.4: Declarative IF/THEN/ELSE Progression Rule Builder UI
 * Implements ADR-004: Declarative Condition-Action Schema for Progression Builder
 * Implements ADR-037: Pure Evaluator & DDP Set-Level Granularity
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
  TextInput,
} from 'react-native';
import {
  TemplateExercise,
  ProgressionRule,
  ProgressionConditionType,
  ProgressionActionType,
  ProgressionRuleDefinition,
} from '../../core/types';
import { IProgramRepository } from '../../domain/repositories/IProgramRepository';
import {
  createLinearProgressionRule,
  createDoubleProgressionRule,
  createDynamicDoubleProgressionRule,
  createEstimatedCapacityProgressionRule,
} from '../../core/rules/progressionRuleEngine';

export function formatProgressionRuleSummary(rule: ProgressionRule): string {
  const def =
    typeof rule.rule_json === 'string'
      ? JSON.parse(rule.rule_json)
      : rule.rule_json;

  const conditionMap: Record<string, (threshold?: number) => string> = {
    ESTIMATED_CAPACITY_SUPPORTS_INCREASE: () => 'effort-rated working sets support a load increase',
    ALL_SETS_HIT_TARGET_REPS: () => 'all sets hit target reps',
    ANY_SET_HIT_TOP_REP_RANGE: () => 'any set hits top of rep range',
    AVERAGE_RPE_LESS_THAN: (t) => `average RPE < ${t ?? 8}`,
    CONSECUTIVE_SUCCESSFUL_SESSIONS: (t) =>
      `${t ?? 1} consecutive successful session${(t ?? 1) > 1 ? 's' : ''}`,
    CONSECUTIVE_FAILED_SESSIONS: (t) =>
      `${t ?? 2} consecutive failed session${(t ?? 2) > 1 ? 's' : ''} (plateau)`,
    MESOCYCLE_FINAL_WEEK: () => 'final accumulation week (L)',
    MESOCYCLE_MIDWAY_WEEK: (t) =>
      t ? `mid-mesocycle week ${t}` : 'mid-mesocycle diagnostic week (floor(L/2))',
    AMRAP_COMPLETED: (t) =>
      t ? `AMRAP completed (>= ${t} reps)` : 'AMRAP set completed',
  };

  const actionMap: Record<string, (val: number) => string> = {
    INCREASE_LOAD_FROM_ESTIMATED_CAPACITY: (v) => `use e1RM/e10RM to increase load by up to ${v} kg at prescribed effort`,
    INCREASE_LOAD_FIXED: (v) => `add +${v} kg`,
    INCREASE_LOAD_PERCENT: (v) => `increase load by ${v}%`,
    DECREASE_LOAD_FIXED: (v) => `decrease load by ${v} kg`,
    INCREASE_TARGET_REPS: (v) => `increase target reps by +${v || 1}`,
    TRIGGER_DELOAD: (v) => `trigger deload (-${v || 10}%)`,
    SCHEDULE_AMRAP_FINAL_WEEK: () => 'schedule end-of-meso diagnostic AMRAP',
    SCHEDULE_AMRAP_MIDWAY: () => 'schedule mid-meso diagnostic AMRAP',
    INCREASE_LOAD_AMRAP_OVER_CAP: (v) =>
      `+1%/rep over cap (floor-rounded to ${v || 2.5} kg)`,
  };

  const conditionText = def.conditions
    ?.map((c: any) =>
      conditionMap[c.type]
        ? conditionMap[c.type](c.threshold)
        : `${c.type}${c.threshold != null ? ` (${c.threshold})` : ''}`
    )
    .join(' AND ');

  const actionText = def.actions
    ?.map((a: any) =>
      actionMap[a.type] ? actionMap[a.type](a.value) : `${a.type}: ${a.value}`
    )
    .join(', ');

  return `When ${conditionText} ➔ ${actionText}`;
}

export interface ProgressionBuilderModalProps {
  visible: boolean;
  templateExercise: TemplateExercise | null;
  exerciseName?: string;
  programRepo: IProgramRepository;
  onClose: () => void;
  onRulesUpdated?: () => void;
}

export const ProgressionBuilderModal: React.FC<ProgressionBuilderModalProps> = ({
  visible,
  templateExercise,
  exerciseName,
  programRepo,
  onClose,
  onRulesUpdated,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [rules, setRules] = useState<ProgressionRule[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<'capacity' | 'lp' | 'dp' | 'ddp' | 'custom'>('custom');

  // Custom Rule Form State
  const [conditionType, setConditionType] = useState<ProgressionConditionType>(
    'ALL_SETS_HIT_TARGET_REPS'
  );
  const [conditionThreshold, setConditionThreshold] = useState<string>('');
  const [actionType, setActionType] = useState<ProgressionActionType>('INCREASE_LOAD_FIXED');
  const [actionValue, setActionValue] = useState<string>('2.5');
  const [priority, setPriority] = useState<string>('1');

  // Load existing rules for this exercise slot
  const loadRules = useCallback(async () => {
    if (!templateExercise) return;
    try {
      setLoading(true);
      const existing = await programRepo.findRulesByTemplateExerciseId(templateExercise.id);
      setRules(existing);
    } catch (err) {
      console.error('Failed to load progression rules:', err);
    } finally {
      setLoading(false);
    }
  }, [templateExercise, programRepo]);

  useEffect(() => {
    if (visible && templateExercise) {
      loadRules();
    }
  }, [visible, templateExercise, loadRules]);

  // Apply Quick Preset
  const handleApplyPreset = async (type: 'capacity' | 'lp' | 'dp' | 'ddp') => {
    if (!templateExercise) return;
    try {
      setLoading(true);
      let presetRules: ProgressionRule[] = [];
      const minReps = templateExercise.target_reps_min ?? 8;
      const maxReps = templateExercise.target_reps_max ?? 12;

      if (type === 'capacity') {
        presetRules = [
          createEstimatedCapacityProgressionRule(templateExercise.id),
          ...createDoubleProgressionRule(templateExercise.id),
        ];
      } else if (type === 'lp') {
        presetRules = createLinearProgressionRule(templateExercise.id, { incrementKg: 2.5 });
      } else if (type === 'dp') {
        presetRules = createDoubleProgressionRule(templateExercise.id, {
          incrementKg: 2.5,
        });
      } else if (type === 'ddp') {
        presetRules = createDynamicDoubleProgressionRule(templateExercise.id, {
          incrementKg: 2.5,
        });
      }

      await programRepo.setProgressionRules(templateExercise.id, presetRules);
      setSelectedPreset(type);
      await loadRules();
      if (onRulesUpdated) onRulesUpdated();
    } catch (err) {
      console.error('Failed to apply preset rules:', err);
    } finally {
      setLoading(false);
    }
  };

  // Add Custom Rule
  const handleAddCustomRule = async () => {
    if (!templateExercise) return;
    try {
      const parsedValue = parseFloat(actionValue) || 2.5;
      const parsedPriority = parseInt(priority, 10) || 1;
      const parsedThreshold = conditionThreshold ? parseFloat(conditionThreshold) : undefined;

      const ruleDef: ProgressionRuleDefinition = {
        conditions: [
          {
            type: conditionType,
            threshold: parsedThreshold,
          },
        ],
        actions: [
          {
            type: actionType,
            value: parsedValue,
          },
        ],
      };

      const newRule: ProgressionRule = {
        id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        template_exercise_id: templateExercise.id,
        priority: parsedPriority,
        rule_json: ruleDef,
      };

      await programRepo.createProgressionRule(newRule);
      await loadRules();
      if (onRulesUpdated) onRulesUpdated();
    } catch (err) {
      console.error('Failed to add custom rule:', err);
    }
  };

  // Delete Rule
  const handleDeleteRule = async (ruleId: string) => {
    try {
      await programRepo.deleteProgressionRule(ruleId);
      await loadRules();
      if (onRulesUpdated) onRulesUpdated();
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };

  const formatRuleSummary = formatProgressionRuleSummary;


  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View testID="progression-builder-modal" style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Progression Rule Builder</Text>
              <Text style={styles.subtitle}>
                {exerciseName ?? 'Exercise Prescription'} • {templateExercise?.target_sets ?? 3} sets @{' '}
                {templateExercise?.target_reps_min ?? 8}–{templateExercise?.target_reps_max ?? 12} reps
              </Text>
            </View>
            <TouchableOpacity
              testID="close-progression-builder-btn"
              style={styles.closeBtn}
              onPress={onClose}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            {/* Quick Presets */}
            <Text style={styles.sectionHeader}>QUICK PROGRESSION PRESETS</Text>
            <View style={styles.presetRow}>
              <TouchableOpacity
                testID="preset-capacity-btn"
                style={[styles.presetBtn, selectedPreset === 'capacity' && styles.presetBtnActive]}
                onPress={() => handleApplyPreset('capacity')}
              >
                <Text style={styles.presetTitle}>Effort-based progression</Text>
                <Text style={styles.presetDesc}>Use reps, load and RPE/RIR to guide your next increase</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.presetRow}>
              <TouchableOpacity
                testID="preset-lp-btn"
                style={[styles.presetBtn, selectedPreset === 'lp' && styles.presetBtnActive]}
                onPress={() => handleApplyPreset('lp')}
              >
                <Text style={styles.presetBadge}>LP</Text>
                <Text style={styles.presetTitle}>Linear</Text>
                <Text style={styles.presetDesc}>+2.5 kg on target</Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="preset-dp-btn"
                style={[styles.presetBtn, selectedPreset === 'dp' && styles.presetBtnActive]}
                onPress={() => handleApplyPreset('dp')}
              >
                <Text style={styles.presetBadge}>DP</Text>
                <Text style={styles.presetTitle}>Double</Text>
                <Text style={styles.presetDesc}>Rep bracket + load</Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="preset-ddp-btn"
                style={[styles.presetBtn, selectedPreset === 'ddp' && styles.presetBtnActive]}
                onPress={() => handleApplyPreset('ddp')}
              >
                <Text style={styles.presetBadge}>DDP</Text>
                <Text style={styles.presetTitle}>Dynamic</Text>
                <Text style={styles.presetDesc}>Per-set promotion</Text>
              </TouchableOpacity>
            </View>

            {/* Currently Active Rules */}
            <Text style={styles.sectionHeader}>ATTACHED PROGRESSION RULES ({rules.length})</Text>
            {loading ? (
              <ActivityIndicator size="small" color="#00E676" style={{ marginVertical: 12 }} />
            ) : rules.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No progression rules attached.</Text>
                <Text style={styles.emptySubtext}>
                  Select a preset above or build a custom rule below.
                </Text>
              </View>
            ) : (
              rules.map((r, idx) => (
                <View key={r.id} testID={`rule-item-${r.id}`} style={styles.ruleCard}>
                  <View style={styles.ruleHeader}>
                    <Text style={styles.rulePriorityBadge}>Priority #{r.priority}</Text>
                    <TouchableOpacity
                      testID={`delete-rule-btn-${r.id}`}
                      onPress={() => handleDeleteRule(r.id)}
                    >
                      <Text style={styles.deleteRuleText}>✕ Delete</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.ruleBody}>{formatRuleSummary(r)}</Text>
                </View>
              ))
            )}

            {/* Custom Rule Builder */}
            <Text style={styles.sectionHeader}>BUILD CUSTOM IF/THEN RULE</Text>
            <View style={styles.customRuleCard}>
              <Text style={styles.label}>IF Condition:</Text>
              {[
                { type: 'ALL_SETS_HIT_TARGET_REPS', label: 'All sets hit target reps' },
                { type: 'ANY_SET_HIT_TOP_REP_RANGE', label: 'Any set hits top of rep range (DDP)' },
                { type: 'AVERAGE_RPE_LESS_THAN', label: 'Average RPE less than threshold' },
                { type: 'CONSECUTIVE_SUCCESSFUL_SESSIONS', label: 'Consecutive successful sessions' },
                { type: 'CONSECUTIVE_FAILED_SESSIONS', label: 'Consecutive failed sessions (plateau)' },
              ].map((cond) => (
                <TouchableOpacity
                  key={cond.type}
                  testID={`condition-${cond.type}`}
                  style={[
                    styles.radioRow,
                    conditionType === cond.type && styles.radioRowActive,
                  ]}
                  onPress={() => setConditionType(cond.type as ProgressionConditionType)}
                >
                  <View style={styles.radioDot}>
                    {conditionType === cond.type && <View style={styles.radioDotInner} />}
                  </View>
                  <Text style={styles.radioLabel}>{cond.label}</Text>
                </TouchableOpacity>
              ))}

              {(conditionType === 'AVERAGE_RPE_LESS_THAN' ||
                conditionType === 'CONSECUTIVE_SUCCESSFUL_SESSIONS' ||
                conditionType === 'CONSECUTIVE_FAILED_SESSIONS') && (
                <View style={[styles.inputCol, { marginTop: 8, marginBottom: 4 }]}>
                  <Text style={styles.label}>
                    {conditionType === 'AVERAGE_RPE_LESS_THAN'
                      ? 'Condition Threshold (Target RPE, e.g. 8.0)'
                      : 'Condition Threshold (Session Count, e.g. 2)'}
                  </Text>
                  <TextInput
                    testID="condition-threshold-input"
                    style={styles.textInput}
                    keyboardType="numeric"
                    value={conditionThreshold}
                    onChangeText={setConditionThreshold}
                    placeholder={conditionType === 'AVERAGE_RPE_LESS_THAN' ? '8.0' : '2'}
                    placeholderTextColor="#71717A"
                    accessibilityLabel="Condition threshold value"
                  />
                </View>
              )}

              <Text style={[styles.label, { marginTop: 12 }]}>THEN Action:</Text>
              {[
                { type: 'INCREASE_LOAD_FIXED', label: 'Increase load by fixed kg' },
                { type: 'INCREASE_LOAD_PERCENT', label: 'Increase load by percent' },
                { type: 'DECREASE_LOAD_FIXED', label: 'Decrease load by fixed kg' },
                { type: 'INCREASE_TARGET_REPS', label: 'Increase target reps (+1)' },
                { type: 'TRIGGER_DELOAD', label: 'Trigger deload (reduce weight)' },
              ].map((act) => (
                <TouchableOpacity
                  key={act.type}
                  testID={`action-${act.type}`}
                  style={[
                    styles.radioRow,
                    actionType === act.type && styles.radioRowActive,
                  ]}
                  onPress={() => setActionType(act.type as ProgressionActionType)}
                >
                  <View style={styles.radioDot}>
                    {actionType === act.type && <View style={styles.radioDotInner} />}
                  </View>
                  <Text style={styles.radioLabel}>{act.label}</Text>
                </TouchableOpacity>
              ))}

              <View style={styles.inputRow}>
                <View style={styles.inputCol}>
                  <Text style={styles.label}>Action Value (kg or %)</Text>
                  <TextInput
                    testID="action-value-input"
                    style={styles.textInput}
                    keyboardType="numeric"
                    value={actionValue}
                    onChangeText={setActionValue}
                    placeholder="2.5"
                    placeholderTextColor="#71717A"
                  />
                </View>

                <View style={styles.inputCol}>
                  <Text style={styles.label}>Rule Priority</Text>
                  <TextInput
                    testID="priority-input"
                    style={styles.textInput}
                    keyboardType="numeric"
                    value={priority}
                    onChangeText={setPriority}
                    placeholder="1"
                    placeholderTextColor="#71717A"
                  />
                </View>
              </View>

              <TouchableOpacity
                testID="add-custom-rule-btn"
                style={styles.addRuleBtn}
                onPress={handleAddCustomRule}
              >
                <Text style={styles.addRuleBtnText}>+ Attach Custom Rule</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#0A0A0A',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: '#27272A',
    maxHeight: '90%',
    minHeight: '60%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  title: {
    color: '#FAFAFA',
    fontSize: 17,
    fontWeight: '800',
  },
  subtitle: {
    color: '#71717A',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    color: '#A1A1AA',
    fontSize: 18,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionHeader: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 8,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  presetBtn: {
    flex: 1,
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  presetBtnActive: {
    borderColor: '#00E676',
    backgroundColor: '#0F1A12',
  },
  presetBadge: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '900',
  },
  presetTitle: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  presetDesc: {
    color: '#71717A',
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  emptyCard: {
    backgroundColor: '#121214',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1E1E22',
  },
  emptyText: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '600',
  },
  emptySubtext: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 2,
  },
  ruleCard: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  ruleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  rulePriorityBadge: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: '#0F172A',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  deleteRuleText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '600',
  },
  ruleBody: {
    color: '#D4D4D8',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  customRuleCard: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 10,
    padding: 14,
    marginTop: 4,
  },
  label: {
    color: '#D4D4D8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  radioRowActive: {
    backgroundColor: '#18181B',
    borderRadius: 4,
  },
  radioDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#71717A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  radioDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00E676',
  },
  radioLabel: {
    color: '#E4E4E7',
    fontSize: 12,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  inputCol: {
    flex: 1,
  },
  textInput: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    color: '#FAFAFA',
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addRuleBtn: {
    backgroundColor: '#00E676',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 14,
  },
  addRuleBtnText: {
    color: '#0A0A0A',
    fontSize: 13,
    fontWeight: '800',
  },
});
