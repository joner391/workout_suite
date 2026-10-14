/**
 * Workout Suite — ProgramOverviewScreen
 *
 * Implements Step 4.4: Program Builder, Multi-Day Split Manager & Rule Editor
 * Implements ADR-006: Meso-Cycle Program Era Tracking
 * Implements ADR-017: Multi-Day Program Hierarchy with Parent programs Table
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
  Alert,
} from 'react-native';
import {
  Program,
  WorkoutTemplate,
  TemplateExercise,
  ProgressionRule,
  Exercise,
} from '../../core/types';
import {
  IProgramRepository,
  ProgramWithDetails,
  WorkoutTemplateDetail,
  TemplateExerciseDetail,
} from '../../domain/repositories/IProgramRepository';
import { IExerciseRepository } from '../../domain/repositories/IExerciseRepository';
import {
  ProgramBlockService,
  ActiveProgramInfo,
} from '../../services/programBlockService';
import { ProgressionBuilderModal } from './ProgressionBuilderModal';

export interface ProgramOverviewScreenProps {
  programRepo: IProgramRepository;
  programBlockService: ProgramBlockService;
  exerciseRepo?: IExerciseRepository;
  onClose?: () => void;
  onSelectProgram?: (programId: string) => void;
}

export const ProgramOverviewScreen: React.FC<ProgramOverviewScreenProps> = ({
  programRepo,
  programBlockService,
  exerciseRepo,
  onClose,
  onSelectProgram,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [activeInfo, setActiveInfo] = useState<ActiveProgramInfo | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [programDetails, setProgramDetails] = useState<ProgramWithDetails | null>(null);
  const [exerciseCatalog, setExerciseCatalog] = useState<Map<string, Exercise>>(new Map());

  // Rule Builder Modal State
  const [editingTargetExercise, setEditingTargetExercise] = useState<{
    templateExercise: TemplateExercise;
    exerciseName: string;
  } | null>(null);

  // New Program Modal State
  const [showCreateProgramModal, setShowCreateProgramModal] = useState<boolean>(false);
  const [newProgramName, setNewProgramName] = useState<string>('');
  const [newProgramColor, setNewProgramColor] = useState<string>('#3B82F6');
  const [newProgramNotes, setNewProgramNotes] = useState<string>('');

  // Initial Load
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [allPrograms, active, exercises] = await Promise.all([
        programRepo.findAll(),
        programBlockService.getActiveProgram(),
        exerciseRepo ? exerciseRepo.findAll() : Promise.resolve([]),
      ]);

      setPrograms(allPrograms);
      setActiveInfo(active);
      setExerciseCatalog(new Map(exercises.map((e) => [e.id, e])));

      // Default selected program: active program or first program
      const initialId = active?.program.id ?? (allPrograms.length > 0 ? allPrograms[0].id : null);
      setSelectedProgramId(initialId);

      if (initialId) {
        const details = await programRepo.getProgramWithDetails(initialId);
        setProgramDetails(details);
      }
    } catch (err) {
      console.error('Failed to load program overview data:', err);
    } finally {
      setLoading(false);
    }
  }, [programRepo, programBlockService, exerciseRepo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle selecting a program tab
  const handleSelectProgram = async (programId: string) => {
    setSelectedProgramId(programId);
    try {
      const details = await programRepo.getProgramWithDetails(programId);
      setProgramDetails(details);
      if (onSelectProgram) onSelectProgram(programId);
    } catch (err) {
      console.error('Failed to load program details:', err);
    }
  };

  // 1-Tap Active Program Swap
  const handleSwapActiveProgram = async (programId: string) => {
    try {
      setLoading(true);
      await programBlockService.swapActiveProgram(programId);
      const updatedActive = await programBlockService.getActiveProgram();
      setActiveInfo(updatedActive);
    } catch (err: any) {
      Alert.alert('Program Swap Error', err?.message ?? 'Failed to swap active program.');
    } finally {
      setLoading(false);
    }
  };

  // Create Program Handler
  const handleCreateProgram = async () => {
    if (!newProgramName.trim()) return;
    try {
      const newProgram: Program = {
        id: `prog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: newProgramName.trim(),
        color_hex: newProgramColor,
        notes: newProgramNotes.trim() || null,
        created_at: new Date().toISOString(),
      };

      await programRepo.create(newProgram);
      setShowCreateProgramModal(false);
      setNewProgramName('');
      setNewProgramNotes('');
      await loadData();
      await handleSelectProgram(newProgram.id);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to create program.');
    }
  };

  // Delete Program Handler
  const handleDeleteProgram = async (programId: string) => {
    Alert.alert(
      'Delete Program',
      'Are you sure you want to delete this program and all its workout templates?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await programRepo.delete(programId);
              await loadData();
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? 'Failed to delete program.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  if (loading && programs.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00E676" />
        <Text style={styles.loadingText}>Loading training programs...</Text>
      </View>
    );
  }

  const selectedProgram = programDetails?.program;
  const isActiveSelected = activeInfo?.program.id === selectedProgram?.id;

  return (
    <View testID="program-overview-screen" style={styles.screen}>
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Training Programs</Text>
          <Text style={styles.headerSubtitle}>
            Meso-cycle splits, daily templates & progression rules
          </Text>
        </View>
        <View style={styles.headerActionRow}>
          <TouchableOpacity
            testID="create-new-program-btn"
            style={styles.addBtn}
            onPress={() => setShowCreateProgramModal(true)}
          >
            <Text style={styles.addBtnText}>+ New</Text>
          </TouchableOpacity>
          {onClose && (
            <TouchableOpacity
              testID="close-program-overview-btn"
              style={styles.closeBtn}
              onPress={onClose}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Program Selector Horizontal Tabs */}
      <View style={styles.programTabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScrollContent}>
          {programs.map((p) => {
            const isSelected = p.id === selectedProgramId;
            const isActive = activeInfo?.program.id === p.id;
            return (
              <TouchableOpacity
                key={p.id}
                testID={`program-tab-${p.id}`}
                style={[
                  styles.programTab,
                  isSelected && styles.programTabSelected,
                  { borderColor: isSelected ? p.color_hex : '#27272A' },
                ]}
                onPress={() => handleSelectProgram(p.id)}
              >
                <View style={[styles.colorDot, { backgroundColor: p.color_hex }]} />
                <Text
                  style={[
                    styles.programTabText,
                    isSelected && styles.programTabTextSelected,
                  ]}
                  numberOfLines={1}
                >
                  {p.name}
                </Text>
                {isActive && (
                  <View style={[styles.activePill, { backgroundColor: p.color_hex }]}>
                    <Text style={styles.activePillText}>ACTIVE</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {selectedProgram ? (
          <>
            {/* Selected Program Header Card */}
            <View
              testID="selected-program-header-card"
              style={[
                styles.programHeaderCard,
                { borderLeftColor: selectedProgram.color_hex, borderLeftWidth: 4 },
              ]}
            >
              <View style={styles.programHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.programNameText}>{selectedProgram.name}</Text>
                  {selectedProgram.notes && (
                    <Text style={styles.programNotesText}>{selectedProgram.notes}</Text>
                  )}
                </View>
                {isActiveSelected ? (
                  <View
                    testID="program-active-badge"
                    style={[styles.activeStatusBadge, { backgroundColor: selectedProgram.color_hex }]}
                  >
                    <Text style={styles.activeStatusBadgeText}>✓ CURRENT ACTIVE</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    testID="set-active-program-btn"
                    style={[styles.setActiveBtn, { borderColor: selectedProgram.color_hex }]}
                    onPress={() => handleSwapActiveProgram(selectedProgram.id)}
                  >
                    <Text style={[styles.setActiveBtnText, { color: selectedProgram.color_hex }]}>
                      Set as Active
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.programMetaRow}>
                <Text style={styles.programMetaText}>
                  {programDetails?.templates.length ?? 0} Daily Templates
                </Text>
                <TouchableOpacity
                  testID={`delete-program-btn-${selectedProgram.id}`}
                  onPress={() => handleDeleteProgram(selectedProgram.id)}
                >
                  <Text style={styles.deleteProgramText}>Delete Program</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Daily Templates & Exercises */}
            <Text style={styles.sectionTitle}>DAILY WORKOUT TEMPLATES</Text>
            {programDetails?.templates.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No workout templates defined for this program.</Text>
              </View>
            ) : (
              programDetails?.templates.map((tmpl, tIdx) => (
                <View
                  key={tmpl.id}
                  testID={`workout-template-card-${tmpl.id}`}
                  style={styles.templateCard}
                >
                  <View style={styles.templateHeader}>
                    <Text style={styles.templateOrderPill}>Day {tIdx + 1}</Text>
                    <Text style={styles.templateName}>{tmpl.name}</Text>
                    <Text style={styles.exerciseCountText}>
                      {tmpl.exercises.length} Exercises
                    </Text>
                  </View>

                  {tmpl.notes && (
                    <Text style={styles.templateNotes}>{tmpl.notes}</Text>
                  )}

                  {/* Template Exercise List */}
                  <View style={styles.exerciseList}>
                    {tmpl.exercises.map((te, eIdx) => {
                      const ex = exerciseCatalog.get(te.exercise_id);
                      const exName = ex?.name ?? te.exercise_id;
                      const hasRules = te.rules && te.rules.length > 0;

                      return (
                        <View
                          key={te.id}
                          testID={`template-exercise-row-${te.id}`}
                          style={styles.exerciseRow}
                        >
                          <View style={styles.exerciseInfoCol}>
                            <View style={styles.exerciseNameRow}>
                              <Text style={styles.exerciseIndexText}>{eIdx + 1}.</Text>
                              <Text style={styles.exerciseNameText}>{exName}</Text>
                              {te.exercise_group_id && (
                                <View style={styles.supersetPill}>
                                  <Text style={styles.supersetPillText}>SUPERSET</Text>
                                </View>
                              )}
                            </View>

                            <Text style={styles.exerciseTargetText}>
                              {te.target_sets ?? 3} sets × {te.target_reps_min ?? 8}–
                              {te.target_reps_max ?? 12} reps
                              {te.target_rpe != null ? ` @ RPE ${te.target_rpe}` : ''}
                            </Text>

                            {/* Attached Rules Summary */}
                            {hasRules && (
                              <View style={styles.rulesSummaryRow}>
                                <Text style={styles.rulesSummaryBadge}>
                                  ⚙️ {te.rules.length} Rule{te.rules.length > 1 ? 's' : ''}
                                </Text>
                              </View>
                            )}
                          </View>

                          <TouchableOpacity
                            testID={`configure-rules-btn-${te.id}`}
                            style={styles.configureRulesBtn}
                            onPress={() =>
                              setEditingTargetExercise({
                                templateExercise: te,
                                exerciseName: exName,
                              })
                            }
                          >
                            <Text style={styles.configureRulesBtnText}>Rules ⚙️</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))
            )}
          </>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No programs found.</Text>
            <Text style={styles.emptySubtext}>
              Tap "+ New" above or visit the Profile questionnaire to generate one!
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Progression Builder Modal */}
      {editingTargetExercise && (
        <ProgressionBuilderModal
          visible={!!editingTargetExercise}
          templateExercise={editingTargetExercise.templateExercise}
          exerciseName={editingTargetExercise.exerciseName}
          programRepo={programRepo}
          onClose={() => setEditingTargetExercise(null)}
          onRulesUpdated={async () => {
            if (selectedProgramId) {
              const updated = await programRepo.getProgramWithDetails(selectedProgramId);
              setProgramDetails(updated);
            }
          }}
        />
      )}

      {/* Create Program Modal */}
      <Modal
        visible={showCreateProgramModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateProgramModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.createModalContent}>
            <Text style={styles.createModalTitle}>Create New Program</Text>

            <Text style={styles.inputLabel}>Program Name</Text>
            <TextInput
              testID="new-program-name-input"
              style={styles.modalTextInput}
              value={newProgramName}
              onChangeText={setNewProgramName}
              placeholder="e.g. 4-Day Upper / Lower Split"
              placeholderTextColor="#71717A"
            />

            <Text style={[styles.inputLabel, { marginTop: 12 }]}>Accent Color</Text>
            <View style={styles.colorPickerRow}>
              {['#3B82F6', '#00E676', '#EF4444', '#F59E0B', '#8B5CF6', '#EC4899'].map((c) => (
                <TouchableOpacity
                  key={c}
                  testID={`color-choice-${c}`}
                  style={[
                    styles.colorChoiceBtn,
                    { backgroundColor: c },
                    newProgramColor === c && styles.colorChoiceActive,
                  ]}
                  onPress={() => setNewProgramColor(c)}
                />
              ))}
            </View>

            <Text style={[styles.inputLabel, { marginTop: 12 }]}>Notes / Overview</Text>
            <TextInput
              testID="new-program-notes-input"
              style={[styles.modalTextInput, { height: 60 }]}
              multiline
              value={newProgramNotes}
              onChangeText={setNewProgramNotes}
              placeholder="Program goals, periodization notes..."
              placeholderTextColor="#71717A"
            />

            <View style={styles.modalActionRow}>
              <TouchableOpacity
                testID="cancel-create-program-btn"
                style={styles.cancelBtn}
                onPress={() => setShowCreateProgramModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="confirm-create-program-btn"
                style={styles.confirmBtn}
                onPress={handleCreateProgram}
              >
                <Text style={styles.confirmBtnText}>Create Program</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
  },
  loadingText: {
    color: '#71717A',
    fontSize: 13,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FAFAFA',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#71717A',
    marginTop: 2,
  },
  headerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addBtn: {
    backgroundColor: '#00E676',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  addBtnText: {
    color: '#0A0A0A',
    fontSize: 12,
    fontWeight: '800',
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    color: '#A1A1AA',
    fontSize: 18,
    fontWeight: 'bold',
  },
  programTabBar: {
    backgroundColor: '#121214',
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E22',
  },
  tabScrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  programTab: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  programTabSelected: {
    backgroundColor: '#27272A',
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  programTabText: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
  },
  programTabTextSelected: {
    color: '#FAFAFA',
    fontWeight: '700',
  },
  activePill: {
    marginLeft: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  activePillText: {
    color: '#0A0A0A',
    fontSize: 8,
    fontWeight: '900',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  programHeaderCard: {
    backgroundColor: '#121214',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1E1E22',
  },
  programHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  programNameText: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '800',
  },
  programNotesText: {
    color: '#A1A1AA',
    fontSize: 12,
    marginTop: 4,
  },
  activeStatusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  activeStatusBadgeText: {
    color: '#0A0A0A',
    fontSize: 10,
    fontWeight: '900',
  },
  setActiveBtn: {
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  setActiveBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  programMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1E1E22',
  },
  programMetaText: {
    color: '#71717A',
    fontSize: 11,
    fontWeight: '500',
  },
  deleteProgramText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '600',
  },
  sectionTitle: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  templateCard: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1E1E22',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  templateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  templateOrderPill: {
    backgroundColor: '#27272A',
    color: '#A1A1AA',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  templateName: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  exerciseCountText: {
    color: '#71717A',
    fontSize: 11,
  },
  templateNotes: {
    color: '#71717A',
    fontSize: 11,
    marginBottom: 8,
  },
  exerciseList: {
    borderTopWidth: 1,
    borderTopColor: '#1E1E22',
    paddingTop: 8,
  },
  exerciseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  exerciseInfoCol: {
    flex: 1,
  },
  exerciseNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  exerciseIndexText: {
    color: '#71717A',
    fontSize: 12,
    fontWeight: '700',
  },
  exerciseNameText: {
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '600',
  },
  supersetPill: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    marginLeft: 4,
  },
  supersetPillText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
  },
  exerciseTargetText: {
    color: '#A1A1AA',
    fontSize: 11,
    marginTop: 2,
  },
  rulesSummaryRow: {
    marginTop: 3,
  },
  rulesSummaryBadge: {
    color: '#38BDF8',
    fontSize: 10,
  },
  configureRulesBtn: {
    backgroundColor: '#1E1E22',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  configureRulesBtnText: {
    color: '#D4D4D8',
    fontSize: 11,
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: '#121214',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  emptyText: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '600',
  },
  emptySubtext: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    padding: 20,
  },
  createModalContent: {
    backgroundColor: '#121214',
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  createModalTitle: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 14,
  },
  inputLabel: {
    color: '#D4D4D8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  modalTextInput: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    color: '#FAFAFA',
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  colorPickerRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },
  colorChoiceBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  colorChoiceActive: {
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  modalActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelBtnText: {
    color: '#71717A',
    fontSize: 13,
    fontWeight: '600',
  },
  confirmBtn: {
    backgroundColor: '#00E676',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  confirmBtnText: {
    color: '#0A0A0A',
    fontSize: 13,
    fontWeight: '800',
  },
});
