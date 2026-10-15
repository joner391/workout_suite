/**
 * Workout Suite — ProgramOverviewScreen
 *
 * Implements Section 1: Custom Program Builder & Template/Exercise Full CRUD
 * Implements Section 1.1: Default Presets Protection & Cloning
 * Implements Section 1.2: Daily Workout Template CRUD & Reordering
 * Implements Section 1.3: Template Exercise Prescriptions, 1-Tap Swapping & Antagonist Supersets
 * Implements ADR-006: Meso-Cycle Program Era Tracking
 * Implements ADR-017: Multi-Day Program Hierarchy
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
import { IGearRepository } from '../../domain/repositories/IGearRepository';
import {
  ProgramBlockService,
  ActiveProgramInfo,
} from '../../services/programBlockService';
import {
  isCustomProgram,
  cloneProgramAsCustom,
  generateCustomProgramId,
} from '../../services/programCloneService';
import { ProgressionBuilderModal } from './ProgressionBuilderModal';
import { CatalogPickerModal } from './CatalogPickerModal';
import { PrescriptionEditorModal } from './PrescriptionEditorModal';
import { EditTemplateModal } from './EditTemplateModal';
import { GearInventory } from '../../core/types';

export interface ProgramOverviewScreenProps {
  programRepo: IProgramRepository;
  programBlockService: ProgramBlockService;
  exerciseRepo?: IExerciseRepository;
  gearRepo?: IGearRepository;
  onClose?: () => void;
  onSelectProgram?: (programId: string) => void;
}

export const ProgramOverviewScreen: React.FC<ProgramOverviewScreenProps> = ({
  programRepo,
  programBlockService,
  exerciseRepo,
  gearRepo,
  onClose,
  onSelectProgram,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [activeInfo, setActiveInfo] = useState<ActiveProgramInfo | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [programDetails, setProgramDetails] = useState<ProgramWithDetails | null>(null);
  const [exerciseCatalog, setExerciseCatalog] = useState<Map<string, Exercise>>(new Map());
  const [catalogList, setCatalogList] = useState<Exercise[]>([]);
  const [availableGear, setAvailableGear] = useState<GearInventory[]>([]);

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

  // Catalog Picker Modal State (for + Add Exercise and 1-Tap Swap)
  const [catalogPickerState, setCatalogPickerState] = useState<{
    visible: boolean;
    mode: 'add' | 'swap';
    templateId: string;
    targetTemplateExercise?: TemplateExercise;
  } | null>(null);

  // Prescription Editor Modal State
  const [prescriptionModalState, setPrescriptionModalState] = useState<{
    visible: boolean;
    templateExercise: TemplateExercise;
    exerciseName: string;
  } | null>(null);

  // Edit Template Modal State
  const [editTemplateModalState, setEditTemplateModalState] = useState<{
    visible: boolean;
    template: WorkoutTemplate | null;
  } | null>(null);

  // Superset Link Picker State
  const [supersetPickerState, setSupersetPickerState] = useState<{
    visible: boolean;
    templateId: string;
    sourceExercise: TemplateExercise;
  } | null>(null);

  // Initial Data Load
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [allPrograms, active, exercises, gears] = await Promise.all([
        programRepo.findAll(),
        programBlockService.getActiveProgram(),
        exerciseRepo ? exerciseRepo.findAll() : Promise.resolve([]),
        gearRepo ? gearRepo.findAll() : Promise.resolve([]),
      ]);

      setPrograms(allPrograms);
      setActiveInfo(active);
      setCatalogList(exercises);
      setExerciseCatalog(new Map(exercises.map((e) => [e.id, e])));
      setAvailableGear(gears);

      const initialId =
        selectedProgramId ??
        active?.program.id ??
        (allPrograms.length > 0 ? allPrograms[0].id : null);

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
  }, [programRepo, programBlockService, exerciseRepo, gearRepo, selectedProgramId]);

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

  // Section 1.1: Guard that clones non-custom programs before mutating
  const ensureCustomProgram = async (): Promise<string> => {
    if (!selectedProgramId) throw new Error('No program selected');
    if (isCustomProgram(selectedProgramId)) {
      return selectedProgramId;
    }

    // Trigger auto-clone flow
    const clonedProgId = await cloneProgramAsCustom(programRepo, selectedProgramId);
    await loadData();
    await handleSelectProgram(clonedProgId);
    return clonedProgId;
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

  // Clone Program Handler (Explicit 1-tap Duplicate)
  const handleCloneProgram = async () => {
    if (!selectedProgramId) return;
    try {
      setLoading(true);
      const clonedProgId = await cloneProgramAsCustom(programRepo, selectedProgramId);
      await loadData();
      await handleSelectProgram(clonedProgId);
    } catch (err: any) {
      Alert.alert('Clone Error', err?.message ?? 'Failed to duplicate program.');
    } finally {
      setLoading(false);
    }
  };

  // Create Blank Program Handler (always creates custom program)
  const handleCreateProgram = async () => {
    if (!newProgramName.trim()) return;
    try {
      const newProgram: Program = {
        id: generateCustomProgramId(),
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
              setSelectedProgramId(null);
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

  // --------------------------------------------------------------------------
  // Daily Workout Template CRUD Handlers (Section 1.2)
  // --------------------------------------------------------------------------

  // Add Day / Template
  const handleAddDay = async () => {
    try {
      const targetProgId = await ensureCustomProgram();
      const current = await programRepo.getProgramWithDetails(targetProgId);
      const nextIndex = current?.templates.length ?? 0;

      const newTmpl: WorkoutTemplate = {
        id: `tpl_custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        program_id: targetProgId,
        name: `Day ${nextIndex + 1}`,
        notes: null,
        order_index: nextIndex,
        created_at: new Date().toISOString(),
      };

      await programRepo.createTemplate(newTmpl);
      const updated = await programRepo.getProgramWithDetails(targetProgId);
      setProgramDetails(updated);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to add workout template.');
    }
  };

  // Edit Template Metadata (Name, Notes)
  const handleSaveTemplateMetadata = async (name: string, notes: string | null) => {
    if (!editTemplateModalState?.template) return;
    try {
      const targetProgId = await ensureCustomProgram();
      const updatedTmpl: WorkoutTemplate = {
        ...editTemplateModalState.template,
        name,
        notes,
      };
      await programRepo.updateTemplate(updatedTmpl);
      const updated = await programRepo.getProgramWithDetails(targetProgId);
      setProgramDetails(updated);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to update template.');
    }
  };

  // Reorder Days (Move Up / Down)
  const handleMoveTemplate = async (templateId: string, direction: 'up' | 'down') => {
    try {
      const targetProgId = await ensureCustomProgram();
      const current = await programRepo.getProgramWithDetails(targetProgId);
      if (!current) return;

      const tmpls = [...current.templates].sort((a, b) => a.order_index - b.order_index);
      const idx = tmpls.findIndex((t) => t.id === templateId);
      if (idx === -1) return;

      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= tmpls.length) return;

      const currentTmpl = tmpls[idx];
      const otherTmpl = tmpls[targetIdx];

      const currentOrder = currentTmpl.order_index;
      const otherOrder = otherTmpl.order_index;

      await programRepo.updateTemplate({ ...currentTmpl, order_index: otherOrder });
      await programRepo.updateTemplate({ ...otherTmpl, order_index: currentOrder });

      const updated = await programRepo.getProgramWithDetails(targetProgId);
      setProgramDetails(updated);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to reorder templates.');
    }
  };

  // Delete Day
  const handleDeleteTemplate = async (templateId: string) => {
    Alert.alert(
      'Delete Workout Day',
      'Are you sure you want to delete this workout template and its exercises?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const targetProgId = await ensureCustomProgram();
              await programRepo.deleteTemplate(templateId);
              const updated = await programRepo.getProgramWithDetails(targetProgId);
              setProgramDetails(updated);
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? 'Failed to delete template.');
            }
          },
        },
      ]
    );
  };

  // --------------------------------------------------------------------------
  // Template Exercise CRUD Handlers (Section 1.3)
  // --------------------------------------------------------------------------

  // Select exercise from catalog (for Add or Swap)
  const handleCatalogExerciseSelected = async (exercise: Exercise) => {
    if (!catalogPickerState) return;
    try {
      const targetProgId = await ensureCustomProgram();
      const current = await programRepo.getProgramWithDetails(targetProgId);
      const tmpl = current?.templates.find((t) => t.id === catalogPickerState.templateId);
      if (!tmpl) return;

      if (catalogPickerState.mode === 'add') {
        const nextOrder = tmpl.exercises.length;
        const newTe: TemplateExercise = {
          id: `te_custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          template_id: tmpl.id,
          exercise_id: exercise.id,
          gear_id: null,
          target_sets: 3,
          target_reps_min: 8,
          target_reps_max: 12,
          target_rpe: 8.0,
          target_rir: null,
          order_index: nextOrder,
          exercise_group_id: null,
        };
        await programRepo.createTemplateExercise(newTe);
      } else if (
        catalogPickerState.mode === 'swap' &&
        catalogPickerState.targetTemplateExercise
      ) {
        const existingTe = catalogPickerState.targetTemplateExercise;
        const swappedTe: TemplateExercise = {
          ...existingTe,
          exercise_id: exercise.id,
        };
        await programRepo.updateTemplateExercise(swappedTe);
      }

      const updated = await programRepo.getProgramWithDetails(targetProgId);
      setProgramDetails(updated);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to update exercise.');
    }
  };

  // Delete Template Exercise
  const handleDeleteTemplateExercise = async (exerciseId: string) => {
    try {
      const targetProgId = await ensureCustomProgram();
      await programRepo.deleteTemplateExercise(exerciseId);
      const updated = await programRepo.getProgramWithDetails(targetProgId);
      setProgramDetails(updated);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to delete exercise.');
    }
  };

  // Reorder Exercises (Move Up / Down)
  const handleMoveExercise = async (
    templateId: string,
    exerciseId: string,
    direction: 'up' | 'down'
  ) => {
    try {
      const targetProgId = await ensureCustomProgram();
      const current = await programRepo.getProgramWithDetails(targetProgId);
      const tmpl = current?.templates.find((t) => t.id === templateId);
      if (!tmpl) return;

      const exercises = [...tmpl.exercises].sort((a, b) => a.order_index - b.order_index);
      const idx = exercises.findIndex((e) => e.id === exerciseId);
      if (idx === -1) return;

      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= exercises.length) return;

      const curEx = exercises[idx];
      const otherEx = exercises[targetIdx];

      const curOrder = curEx.order_index;
      const otherOrder = otherEx.order_index;

      await programRepo.updateTemplateExercise({ ...curEx, order_index: otherOrder });
      await programRepo.updateTemplateExercise({ ...otherEx, order_index: curOrder });

      const updated = await programRepo.getProgramWithDetails(targetProgId);
      setProgramDetails(updated);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to reorder exercises.');
    }
  };

  // Save Prescription
  const handleSavePrescription = async (updatedTe: TemplateExercise) => {
    try {
      const targetProgId = await ensureCustomProgram();
      await programRepo.updateTemplateExercise(updatedTe);
      const updated = await programRepo.getProgramWithDetails(targetProgId);
      setProgramDetails(updated);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to save prescription.');
    }
  };

  // Antagonist Superset Pairing Handlers
  const handleUnlinkSuperset = async (te: TemplateExercise) => {
    try {
      const targetProgId = await ensureCustomProgram();
      await programRepo.updateTemplateExercise({
        ...te,
        exercise_group_id: null,
      });
      const updated = await programRepo.getProgramWithDetails(targetProgId);
      setProgramDetails(updated);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to unlink superset.');
    }
  };

  const handleLinkSupersetWith = async (targetTeId: string) => {
    if (!supersetPickerState) return;
    try {
      const targetProgId = await ensureCustomProgram();
      const sharedGroupId = `ss_${supersetPickerState.templateId}_${Date.now()}`;

      // Update source
      await programRepo.updateTemplateExercise({
        ...supersetPickerState.sourceExercise,
        exercise_group_id: sharedGroupId,
      });

      // Update target
      const targetTe = await programRepo.findTemplateExerciseById(targetTeId);
      if (targetTe) {
        await programRepo.updateTemplateExercise({
          ...targetTe,
          exercise_group_id: sharedGroupId,
        });
      }

      setSupersetPickerState(null);
      const updated = await programRepo.getProgramWithDetails(targetProgId);
      setProgramDetails(updated);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to pair superset.');
    }
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
  const isCustom = selectedProgram ? isCustomProgram(selectedProgram.id) : false;

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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabScrollContent}
        >
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
                  <View style={styles.programTitleRow}>
                    <Text style={styles.programNameText}>{selectedProgram.name}</Text>
                    {isCustom ? (
                      <View style={styles.customBadge}>
                        <Text style={styles.customBadgeText}>CUSTOM</Text>
                      </View>
                    ) : (
                      <View style={styles.presetBadge}>
                        <Text style={styles.presetBadgeText}>PRESET (PROTECTED)</Text>
                      </View>
                    )}
                  </View>
                  {selectedProgram.notes && (
                    <Text style={styles.programNotesText}>{selectedProgram.notes}</Text>
                  )}
                </View>

                {isActiveSelected ? (
                  <View
                    testID="program-active-badge"
                    style={[styles.activeStatusBadge, { backgroundColor: selectedProgram.color_hex }]}
                  >
                    <Text style={styles.activeStatusBadgeText}>✓ ACTIVE</Text>
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

              {/* Top-Level Program Actions (Clone, Delete) */}
              <View style={styles.programMetaRow}>
                <Text style={styles.programMetaText}>
                  {programDetails?.templates.length ?? 0} Daily Templates
                </Text>
                <View style={styles.headerBtnGroup}>
                  <TouchableOpacity
                    testID="clone-program-btn"
                    style={styles.cloneBtn}
                    onPress={handleCloneProgram}
                  >
                    <Text style={styles.cloneBtnText}>Duplicate 📋</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID={`delete-program-btn-${selectedProgram.id}`}
                    onPress={() => handleDeleteProgram(selectedProgram.id)}
                  >
                    <Text style={styles.deleteProgramText}>Delete Program</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Daily Templates & Exercises Header */}
            <View style={styles.templatesSectionHeader}>
              <Text style={styles.sectionTitle}>DAILY WORKOUT TEMPLATES</Text>
              <TouchableOpacity
                testID="add-workout-template-btn"
                style={styles.addTemplateBtn}
                onPress={handleAddDay}
              >
                <Text style={styles.addTemplateBtnText}>+ Add Day</Text>
              </TouchableOpacity>
            </View>

            {programDetails?.templates.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No workout templates defined for this program.</Text>
                <TouchableOpacity style={styles.inlineAddBtn} onPress={handleAddDay}>
                  <Text style={styles.inlineAddBtnText}>+ Add First Workout Day</Text>
                </TouchableOpacity>
              </View>
            ) : (
              programDetails?.templates.map((tmpl, tIdx) => {
                const isFirst = tIdx === 0;
                const isLast = tIdx === (programDetails?.templates.length ?? 0) - 1;

                return (
                  <View
                    key={tmpl.id}
                    testID={`workout-template-card-${tmpl.id}`}
                    style={styles.templateCard}
                  >
                    {/* Template Card Header */}
                    <View style={styles.templateHeader}>
                      <View style={styles.templateHeaderLeft}>
                        <Text style={styles.templateOrderPill}>Day {tIdx + 1}</Text>
                        <Text style={styles.templateName}>{tmpl.name}</Text>
                      </View>

                      {/* Template Controls: Reorder, Edit, Delete */}
                      <View style={styles.templateHeaderActions}>
                        <TouchableOpacity
                          testID={`template-move-up-${tmpl.id}`}
                          style={[styles.miniControlBtn, isFirst && styles.btnDisabled]}
                          onPress={() => handleMoveTemplate(tmpl.id, 'up')}
                          disabled={isFirst}
                        >
                          <Text style={styles.miniControlBtnText}>▲</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          testID={`template-move-down-${tmpl.id}`}
                          style={[styles.miniControlBtn, isLast && styles.btnDisabled]}
                          onPress={() => handleMoveTemplate(tmpl.id, 'down')}
                          disabled={isLast}
                        >
                          <Text style={styles.miniControlBtnText}>▼</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          testID={`edit-template-btn-${tmpl.id}`}
                          style={styles.miniControlBtn}
                          onPress={() =>
                            setEditTemplateModalState({
                              visible: true,
                              template: tmpl,
                            })
                          }
                        >
                          <Text style={styles.miniControlBtnText}>✎</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          testID={`delete-template-btn-${tmpl.id}`}
                          style={styles.miniControlBtnDestructive}
                          onPress={() => handleDeleteTemplate(tmpl.id)}
                        >
                          <Text style={styles.miniControlBtnDestructiveText}>✕</Text>
                        </TouchableOpacity>
                      </View>
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
                        const isExFirst = eIdx === 0;
                        const isExLast = eIdx === tmpl.exercises.length - 1;

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

                              {/* Prescriptions */}
                              <TouchableOpacity
                                testID={`edit-prescription-btn-${te.id}`}
                                style={styles.prescriptionTapTarget}
                                onPress={() =>
                                  setPrescriptionModalState({
                                    visible: true,
                                    templateExercise: te,
                                    exerciseName: exName,
                                  })
                                }
                              >
                                <Text style={styles.exerciseTargetText}>
                                  {te.target_sets ?? 3} sets × {te.target_reps_min ?? 8}–
                                  {te.target_reps_max ?? 12} reps
                                  {te.target_rpe != null
                                    ? ` @ RPE ${te.target_rpe}`
                                    : te.target_rir != null
                                    ? ` @ ${te.target_rir} RIR`
                                    : ''}
                                  {'  '}<Text style={styles.editPencil}>✎ Edit</Text>
                                </Text>
                              </TouchableOpacity>

                              {/* Attached Rules Summary */}
                              {hasRules && (
                                <View style={styles.rulesSummaryRow}>
                                  <Text style={styles.rulesSummaryBadge}>
                                    ⚙️ {te.rules.length} Rule{te.rules.length > 1 ? 's' : ''}
                                  </Text>
                                </View>
                              )}
                            </View>

                            {/* Exercise Actions: Reorder, Swap, Superset, Rules, Delete */}
                            <View style={styles.exerciseActionCol}>
                              <View style={styles.exerciseActionRow}>
                                <TouchableOpacity
                                  testID={`exercise-move-up-${te.id}`}
                                  style={[styles.smallBtn, isExFirst && styles.btnDisabled]}
                                  onPress={() => handleMoveExercise(tmpl.id, te.id, 'up')}
                                  disabled={isExFirst}
                                >
                                  <Text style={styles.smallBtnText}>▲</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  testID={`exercise-move-down-${te.id}`}
                                  style={[styles.smallBtn, isExLast && styles.btnDisabled]}
                                  onPress={() => handleMoveExercise(tmpl.id, te.id, 'down')}
                                  disabled={isExLast}
                                >
                                  <Text style={styles.smallBtnText}>▼</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  testID={`swap-template-exercise-${te.id}`}
                                  style={styles.smallBtn}
                                  onPress={() =>
                                    setCatalogPickerState({
                                      visible: true,
                                      mode: 'swap',
                                      templateId: tmpl.id,
                                      targetTemplateExercise: te,
                                    })
                                  }
                                >
                                  <Text style={styles.smallBtnText}>⇄ Swap</Text>
                                </TouchableOpacity>

                                {te.exercise_group_id ? (
                                  <TouchableOpacity
                                    testID={`unlink-superset-btn-${te.id}`}
                                    style={styles.supersetBtnActive}
                                    onPress={() => handleUnlinkSuperset(te)}
                                  >
                                    <Text style={styles.supersetBtnActiveText}>Unlink ⛓️‍💥</Text>
                                  </TouchableOpacity>
                                ) : (
                                  <TouchableOpacity
                                    testID={`link-superset-btn-${te.id}`}
                                    style={styles.smallBtn}
                                    onPress={() =>
                                      setSupersetPickerState({
                                        visible: true,
                                        templateId: tmpl.id,
                                        sourceExercise: te,
                                      })
                                    }
                                  >
                                    <Text style={styles.smallBtnText}>Pair 🔗</Text>
                                  </TouchableOpacity>
                                )}

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

                                <TouchableOpacity
                                  testID={`delete-template-exercise-${te.id}`}
                                  style={styles.smallBtnDestructive}
                                  onPress={() => handleDeleteTemplateExercise(te.id)}
                                >
                                  <Text style={styles.smallBtnDestructiveText}>✕</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          </View>
                        );
                      })}

                      {/* "+ Add Exercise" Button */}
                      <TouchableOpacity
                        testID={`add-exercise-to-template-${tmpl.id}`}
                        style={styles.addExerciseBtn}
                        onPress={() =>
                          setCatalogPickerState({
                            visible: true,
                            mode: 'add',
                            templateId: tmpl.id,
                          })
                        }
                      >
                        <Text style={styles.addExerciseBtnText}>+ Add Exercise</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
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

      {/* Catalog Picker Modal (Add / Swap Exercise) */}
      {catalogPickerState && (
        <CatalogPickerModal
          visible={catalogPickerState.visible}
          title={
            catalogPickerState.mode === 'swap'
              ? 'Swap Exercise'
              : 'Add Exercise to Template'
          }
          exercises={catalogList}
          onSelect={handleCatalogExerciseSelected}
          onClose={() => setCatalogPickerState(null)}
        />
      )}

      {/* Prescription Editor Modal */}
      {prescriptionModalState && (
        <PrescriptionEditorModal
          visible={prescriptionModalState.visible}
          exerciseName={prescriptionModalState.exerciseName}
          templateExercise={prescriptionModalState.templateExercise}
          availableGear={availableGear}
          onSave={handleSavePrescription}
          onClose={() => setPrescriptionModalState(null)}
        />
      )}

      {/* Edit Template Metadata Modal */}
      {editTemplateModalState && (
        <EditTemplateModal
          visible={editTemplateModalState.visible}
          template={editTemplateModalState.template}
          onSave={handleSaveTemplateMetadata}
          onClose={() => setEditTemplateModalState(null)}
        />
      )}

      {/* Superset Pairing Picker Modal */}
      {supersetPickerState && (
        <Modal
          visible={supersetPickerState.visible}
          transparent
          animationType="slide"
          onRequestClose={() => setSupersetPickerState(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.createModalContent}>
              <Text style={styles.createModalTitle}>Pair Antagonist Superset</Text>
              <Text style={styles.cardDescription}>
                Select an exercise to pair into a superset with{' '}
                <Text style={{ color: '#00E676', fontWeight: 'bold' }}>
                  {exerciseCatalog.get(supersetPickerState.sourceExercise.exercise_id)?.name ??
                    supersetPickerState.sourceExercise.exercise_id}
                </Text>:
              </Text>

              <ScrollView style={{ maxHeight: 250, marginVertical: 10 }}>
                {programDetails?.templates
                  .find((t) => t.id === supersetPickerState.templateId)
                  ?.exercises.filter((te) => te.id !== supersetPickerState.sourceExercise.id)
                  .map((otherTe) => {
                    const otherName =
                      exerciseCatalog.get(otherTe.exercise_id)?.name ?? otherTe.exercise_id;
                    return (
                      <TouchableOpacity
                        key={otherTe.id}
                        testID={`pair-with-exercise-${otherTe.id}`}
                        style={styles.supersetChoiceItem}
                        onPress={() => handleLinkSupersetWith(otherTe.id)}
                      >
                        <Text style={styles.supersetChoiceText}>{otherName}</Text>
                        <Text style={styles.supersetChoiceAction}>Pair 🔗</Text>
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>

              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setSupersetPickerState(null)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Create Blank Program Modal */}
      <Modal
        visible={showCreateProgramModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateProgramModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.createModalContent}>
            <Text style={styles.createModalTitle}>Create New Custom Program</Text>

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
  programTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  programNameText: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '800',
  },
  customBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  customBadgeText: {
    color: '#0A0A0A',
    fontSize: 9,
    fontWeight: '900',
  },
  presetBadge: {
    backgroundColor: '#6366F1',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  presetBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
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
  headerBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cloneBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#38BDF8',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  cloneBtnText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  deleteProgramText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '600',
  },
  templatesSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  addTemplateBtn: {
    backgroundColor: '#1E1E22',
    borderWidth: 1,
    borderColor: '#00E676',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  addTemplateBtnText: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '700',
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  templateHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
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
  templateHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniControlBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    width: 26,
    height: 26,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniControlBtnText: {
    color: '#D4D4D8',
    fontSize: 11,
    fontWeight: '700',
  },
  miniControlBtnDestructive: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    width: 26,
    height: 26,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniControlBtnDestructiveText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '700',
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
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  exerciseInfoCol: {
    marginBottom: 6,
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
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    marginLeft: 4,
  },
  supersetPillText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
  },
  prescriptionTapTarget: {
    marginTop: 2,
  },
  exerciseTargetText: {
    color: '#A1A1AA',
    fontSize: 11,
  },
  editPencil: {
    color: '#00E676',
    fontSize: 10,
    fontWeight: '600',
  },
  rulesSummaryRow: {
    marginTop: 3,
  },
  rulesSummaryBadge: {
    color: '#38BDF8',
    fontSize: 10,
  },
  exerciseActionCol: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  exerciseActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  smallBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 5,
  },
  smallBtnText: {
    color: '#D4D4D8',
    fontSize: 10,
    fontWeight: '600',
  },
  smallBtnDestructive: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 5,
  },
  smallBtnDestructiveText: {
    color: '#EF4444',
    fontSize: 10,
    fontWeight: '700',
  },
  supersetBtnActive: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#38BDF8',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 5,
  },
  supersetBtnActiveText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '700',
  },
  configureRulesBtn: {
    backgroundColor: '#1E1E22',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  configureRulesBtnText: {
    color: '#D4D4D8',
    fontSize: 10,
    fontWeight: '600',
  },
  addExerciseBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  addExerciseBtnText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '700',
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
  inlineAddBtn: {
    marginTop: 10,
    backgroundColor: '#00E676',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  inlineAddBtnText: {
    color: '#0A0A0A',
    fontSize: 12,
    fontWeight: '800',
  },
  cardDescription: {
    color: '#A1A1AA',
    fontSize: 12,
    marginBottom: 8,
  },
  supersetChoiceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#18181B',
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  supersetChoiceText: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '600',
  },
  supersetChoiceAction: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
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
    alignItems: 'center',
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
  btnDisabled: {
    opacity: 0.3,
  },
});
