import { AppIcon } from '../../ui/AppIcon';
import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
import { Badge } from '../../ui/Badge';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { commonStyles } from '../../ui/theme';
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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { normalizeExerciseGroups } from '../../core/exerciseGroups';
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

export type ProgressionBadge = 'Effort' | 'LP' | 'DP' | 'DDP' | 'Custom';

/**
 * Detects effort-based, LP, DP, DDP, or custom progression rules.
 */
export function detectProgressionBadge(rules?: ProgressionRule[]): ProgressionBadge | null {
  if (!rules || rules.length === 0) return null;

  if (rules.some(r => JSON.stringify(r.rule_json).includes('INCREASE_LOAD_FROM_ESTIMATED_CAPACITY'))) {
    return 'Effort';
  }

  // Check for DDP priority first
  for (const r of rules) {
    const id = (r.id || '').toLowerCase();
    let def: any = r.rule_json;
    if (typeof def === 'string') {
      try {
        def = JSON.parse(def);
      } catch {
        def = null;
      }
    }
    const notes = (def?.notes || '').toLowerCase();
    const condTypes: string[] = (def?.conditions || []).map((c: any) => c.type);

    if (
      id.includes('ddp') ||
      notes.includes('dynamic double') ||
      condTypes.includes('ANY_SET_HIT_TOP_REP_RANGE')
    ) {
      return 'DDP';
    }
  }

  // Check for DP or LP
  for (const r of rules) {
    const id = (r.id || '').toLowerCase();
    let def: any = r.rule_json;
    if (typeof def === 'string') {
      try {
        def = JSON.parse(def);
      } catch {
        def = null;
      }
    }
    const notes = (def?.notes || '').toLowerCase();
    const condTypes: string[] = (def?.conditions || []).map((c: any) => c.type);

    if (
      id.includes('dp') ||
      notes.includes('double progression') ||
      condTypes.includes('ALL_SETS_HIT_TOP_REP_RANGE')
    ) {
      return 'DP';
    }
    if (
      id.includes('lp') ||
      notes.includes('linear progression') ||
      condTypes.includes('ALL_SETS_HIT_TARGET_REPS')
    ) {
      return 'LP';
    }
  }

  return 'Custom';
}

/**
 * Formats program overview notes cleanly for lifters, eliminating raw JSON,
 * HTML comment tokens (<!-- ... -->), and technical archetype IDs.
 */
export function formatLifterProgramNotes(rawNotes?: string | null): string | null {
  if (!rawNotes || !rawNotes.trim()) return null;

  // 1. Strip raw HTML comment blocks (e.g. <!-- TRANSITION_WAVE: ... -->)
  let cleaned = rawNotes.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!cleaned) return null;

  // 2. Map internal archetype identifiers to clean names
  const archetypeMap: Record<string, string> = {
    archetype_i_pure_strength: 'Strength',
    archetype_ii_strength_hypertrophy: 'Strength & Hypertrophy',
    archetype_iii_hypertrophy_strength: 'Hypertrophy & Strength',
    archetype_i_powerlifting: 'Powerlifting (SBD)',
    archetype_ii_strength_primary: 'Strength & Hypertrophy',
    archetype_iii_athletic_power: 'Athletic Power',
    archetype_iv_pure_hypertrophy: 'Hypertrophy & Aesthetics',
    archetype_v_minimalist_longevity: 'Minimalist & Longevity',
  };

  for (const [key, label] of Object.entries(archetypeMap)) {
    cleaned = cleaned.replace(new RegExp(key, 'g'), label);
  }

  // 3. Map mentality tokens
  cleaned = cleaned.replace(/\bfury mentality\b/gi, 'Fury (High Intensity)');
  cleaned = cleaned.replace(/\bprecision mentality\b/gi, 'Precision (Volume & Technique)');
  cleaned = cleaned.replace(/\bget_out mentality\b/gi, 'Get Out (Time-Efficient)');

  // 4. Remove robotic "Synthesized for male lifter" / "Synthesized for female lifter" boilerplate
  cleaned = cleaned.replace(/Synthesized for (?:male|female) lifter\s*\(([^)]+)\)\.?/gi, '$1');
  cleaned = cleaned.replace(
    /Synthesized Two-Tier Novice Bifurcated Program for (?:male|female) lifter\s*\(([^)]+)\)\.?/gi,
    'Novice Two-Tier Protocol ($1)'
  );

  // 5. Clean up duplicate lines from mesocycle chaining
  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const uniqueLines = Array.from(new Set(lines));

  return uniqueLines.join(' • ');
}

export interface ProgramOverviewScreenProps {
  programRepo: IProgramRepository;
  programBlockService: ProgramBlockService;
  exerciseRepo?: IExerciseRepository;
  gearRepo?: IGearRepository;
  initialProgramId?: string;
  onClose?: () => void;
  onOpenSetup?: () => void;
  onSelectProgram?: (programId: string) => void;
}

export const ProgramOverviewScreen: React.FC<ProgramOverviewScreenProps> = ({
  programRepo,
  programBlockService,
  exerciseRepo,
  gearRepo,
  initialProgramId,
  onClose,
  onOpenSetup,
  onSelectProgram,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [activeInfo, setActiveInfo] = useState<ActiveProgramInfo | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [programDetails, setRawProgramDetails] = useState<ProgramWithDetails | null>(null);
  const setProgramDetails = useCallback((details: ProgramWithDetails | null) => {
    setRawProgramDetails(details ? { ...details, templates: details.templates.map(template => ({
      ...template, exercises: normalizeExerciseGroups(template.exercises),
    })) } : null);
  }, []);
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

  // Exercise Action Menu (Consolidates row actions into clean overflow sheet)
  const [actionMenuState, setActionMenuState] = useState<{
    visible: boolean;
    templateId: string;
    templateExercise: TemplateExercise;
    exerciseName: string;
    isExFirst: boolean;
    isExLast: boolean;
  } | null>(null);

  const lastInitialProgramIdRef = useRef<string | undefined>(undefined);

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

      setSelectedProgramId((currentSelected) => {
        const targetId =
          currentSelected ??
          initialProgramId ??
          active?.program.id ??
          (allPrograms.length > 0 ? allPrograms[0].id : null);

        if (targetId) {
          programRepo
            .getProgramWithDetails(targetId)
            .then((details) => {
              setProgramDetails(details);
            })
            .catch((err) => {
              console.error('Failed to load program details for targetId:', err);
            });
        }
        return targetId;
      });
    } catch (err) {
      console.error('Failed to load program overview data:', err);
    } finally {
      setLoading(false);
    }
  }, [programRepo, programBlockService, exerciseRepo, gearRepo, initialProgramId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Synchronize when initialProgramId prop explicitly changes from outside (e.g. after program synthesis)
  useEffect(() => {
    if (initialProgramId && initialProgramId !== lastInitialProgramIdRef.current) {
      lastInitialProgramIdRef.current = initialProgramId;
      setSelectedProgramId(initialProgramId);
      programRepo
        .getProgramWithDetails(initialProgramId)
        .then((details) => {
          setProgramDetails(details);
        })
        .catch((err) => {
          console.error('Failed to load program details for initialProgramId:', err);
        });
    }
  }, [initialProgramId, programRepo]);

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
        <ActivityIndicator size="large" color={uiColors.accent} />
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
      <ScreenHeader
        title="Training programs"
        subtitle="Your splits, workouts and progression"
        onClose={onClose}
        closeTestID="close-program-overview-btn"
        actions={<><TouchableOpacity testID="create-new-program-btn" style={commonStyles.button} onPress={() => setShowCreateProgramModal(true)}>
          <Text style={commonStyles.buttonText}>New program</Text>
        </TouchableOpacity>{onOpenSetup && <TouchableOpacity testID="program-hub-setup-btn" style={commonStyles.button} onPress={onOpenSetup}><Text style={commonStyles.buttonText}>Create / evolve</Text></TouchableOpacity>}</>}
      />

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
                  { borderColor: isSelected ? p.color_hex : uiColors.border },
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
                    <Badge label={isCustom ? "Custom program" : "Protected preset"} tone={isCustom ? "accent" : "neutral"} />
                  </View>
                  {(() => {
                    const cleanNotes = formatLifterProgramNotes(selectedProgram.notes);
                    if (!cleanNotes) return null;
                    return (
                      <View style={styles.programNotesContainer}>
                        <Text style={styles.programNotesText}>{cleanNotes}</Text>
                      </View>
                    );
                  })()}
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
                    <Text style={styles.cloneBtnText}>Duplicate </Text>
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
                          hitSlop={4}
                          style={[styles.miniControlBtn, isFirst && styles.btnDisabled]}
                          onPress={() => handleMoveTemplate(tmpl.id, 'up')}
                          disabled={isFirst} accessibilityRole="button" accessibilityLabel="Move workout up"
                        >
                          <AppIcon name="up" size={18} color={uiColors.accentText} />
                        </TouchableOpacity>

                        <TouchableOpacity
                          testID={`template-move-down-${tmpl.id}`}
                          hitSlop={4}
                          style={[styles.miniControlBtn, isLast && styles.btnDisabled]}
                          onPress={() => handleMoveTemplate(tmpl.id, 'down')}
                          disabled={isLast} accessibilityRole="button" accessibilityLabel="Move workout down"
                        >
                          <AppIcon name="down" size={18} color={uiColors.accentText} />
                        </TouchableOpacity>

                        <TouchableOpacity
                          hitSlop={4} testID={`edit-template-btn-${tmpl.id}`}
                          style={styles.miniControlBtn}
                          onPress={() =>
                            setEditTemplateModalState({
                              visible: true,
                              template: tmpl,
                            })
                          } accessibilityRole="button" accessibilityLabel="Edit workout"
                        >
                          <AppIcon name="edit" size={18} color={uiColors.accentText} />
                        </TouchableOpacity>

                        <TouchableOpacity
                          hitSlop={4} testID={`delete-template-btn-${tmpl.id}`}
                          style={styles.miniControlBtnDestructive}
                          onPress={() => handleDeleteTemplate(tmpl.id)} accessibilityRole="button" accessibilityLabel="Delete workout"
                        >
                          <AppIcon name="trash" size={20} color={uiColors.danger} />
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
                        const progBadge = detectProgressionBadge(te.rules);
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

                                <Text style={styles.exerciseNameText}>{eIdx + 1}. {exName}</Text>
                                <View style={commonStyles.wrapRow}>
                                  {progBadge && (
                                    <View
                                      testID={`prog-badge-${te.id}`}
                                      style={[
                                        styles.progBadge,
                                        progBadge === 'LP' && styles.progBadgeLP,
                                        progBadge === 'DP' && styles.progBadgeDP,
                                        progBadge === 'DDP' && styles.progBadgeDDP,
                                        (progBadge === 'Custom' || progBadge === 'Effort') && styles.progBadgeCustom,
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.progBadgeText,
                                          progBadge === 'LP' && styles.progBadgeTextLP,
                                          progBadge === 'DP' && styles.progBadgeTextDP,
                                          progBadge === 'DDP' && styles.progBadgeTextDDP,
                                          (progBadge === 'Custom' || progBadge === 'Effort') && styles.progBadgeTextCustom,
                                        ]}
                                      >
                                        {progBadge}
                                      </Text>
                                    </View>
                                  )}
                                  {te.exercise_group_id && (
                                    <View style={styles.supersetPill}>
                                      <Text style={styles.supersetPillText}>SUPERSET</Text>
                                    </View>
                                  )}
                                </View>
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
                                    {te.rules.length} Rule{te.rules.length > 1 ? 's' : ''}
                                  </Text>
                                </View>
                              )}
                            </View>

                            {/* Exercise Actions: Reorder, Swap, Superset, Rules, Delete */}
                            <View style={styles.exerciseActionCol}>
                              <View style={styles.exerciseActionRow}>
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
                                  <Text style={styles.configureRulesBtnText}>Rules </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  testID={`exercise-actions-menu-${te.id}`}
                                  style={styles.overflowMenuBtn}
                                  onPress={() =>
                                    setActionMenuState({
                                      visible: true,
                                      templateId: tmpl.id,
                                      templateExercise: te,
                                      exerciseName: exName,
                                      isExFirst,
                                      isExLast,
                                    })
                                  }
                                  accessibilityRole="button"
                                  accessibilityLabel={`More actions for ${exName}`}
                                >
                                  <Text style={styles.overflowMenuBtnText}>•••</Text>
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
                <Text style={{ color: uiColors.accentText, fontWeight: 'bold' }}>
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
                        <Text style={styles.supersetChoiceAction}>Pair </Text>
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
              placeholderTextColor={uiColors.subtle}
            />

            <Text style={[styles.inputLabel, { marginTop: 12 }]}>Accent Color</Text>
            <View style={styles.colorPickerRow}>
              {['#3B82F6', uiColors.accent, '#EF4444', '#F59E0B', '#8B5CF6', '#EC4899'].map((c) => (
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
              placeholderTextColor={uiColors.subtle}
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

      {/* Exercise Actions Overflow Modal */}
      {actionMenuState && (
        <Modal
          visible={actionMenuState.visible}
          transparent
          animationType="fade"
          onRequestClose={() => setActionMenuState(null)}
        >
          <TouchableOpacity
            style={styles.actionMenuOverlay}
            activeOpacity={1}
            onPress={() => setActionMenuState(null)}
          >
            <View style={styles.actionMenuCard}>
              <View style={styles.actionMenuHeader}>
                <Text style={styles.actionMenuTitle} numberOfLines={1}>
                  {actionMenuState.exerciseName}
                </Text>
                <TouchableOpacity
                  onPress={() => setActionMenuState(null)}
                  style={{ padding: 4 }}
                  accessibilityLabel="Close action menu" accessibilityRole="button"
                >
                  <AppIcon name="close" size={20} color={uiColors.accentText} />
                </TouchableOpacity>
              </View>

              {/* Move Up */}
              <TouchableOpacity
                testID={`exercise-move-up-${actionMenuState.templateExercise.id}`}
                style={[
                  styles.actionMenuItem,
                  actionMenuState.isExFirst && styles.actionMenuItemDisabled,
                ]}
                disabled={actionMenuState.isExFirst}
                onPress={() => {
                  handleMoveExercise(
                    actionMenuState.templateId,
                    actionMenuState.templateExercise.id,
                    'up'
                  );
                  setActionMenuState(null);
                }}
              >
                <AppIcon name="up" size={20} color={uiColors.accentText} />
                <Text style={styles.actionMenuItemText}>Move Up</Text>
              </TouchableOpacity>

              {/* Move Down */}
              <TouchableOpacity
                testID={`exercise-move-down-${actionMenuState.templateExercise.id}`}
                style={[
                  styles.actionMenuItem,
                  actionMenuState.isExLast && styles.actionMenuItemDisabled,
                ]}
                disabled={actionMenuState.isExLast}
                onPress={() => {
                  handleMoveExercise(
                    actionMenuState.templateId,
                    actionMenuState.templateExercise.id,
                    'down'
                  );
                  setActionMenuState(null);
                }}
              >
                <AppIcon name="down" size={20} color={uiColors.accentText} />
                <Text style={styles.actionMenuItemText}>Move Down</Text>
              </TouchableOpacity>

              {/* Swap Exercise */}
              <TouchableOpacity
                testID={`swap-template-exercise-${actionMenuState.templateExercise.id}`}
                style={styles.actionMenuItem}
                onPress={() => {
                  const targetTe = actionMenuState.templateExercise;
                  const tmplId = actionMenuState.templateId;
                  setActionMenuState(null);
                  setCatalogPickerState({
                    visible: true,
                    mode: 'swap',
                    templateId: tmplId,
                    targetTemplateExercise: targetTe,
                  });
                }}
              >
                <AppIcon name="swap" size={20} color={uiColors.accentText} />
                <Text style={styles.actionMenuItemText}>Swap Exercise</Text>
              </TouchableOpacity>

              {/* Superset Pair / Unlink */}
              {actionMenuState.templateExercise.exercise_group_id ? (
                <TouchableOpacity
                  testID={`unlink-superset-btn-${actionMenuState.templateExercise.id}`}
                  style={styles.actionMenuItem}
                  onPress={() => {
                    handleUnlinkSuperset(actionMenuState.templateExercise);
                    setActionMenuState(null);
                  }}
                >
                  <AppIcon name="unlink" size={20} color={uiColors.accentText} />
                  <Text style={[styles.actionMenuItemText, { color: '#F59E0B' }]}>
                    Unlink Superset
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  testID={`link-superset-btn-${actionMenuState.templateExercise.id}`}
                  style={styles.actionMenuItem}
                  onPress={() => {
                    const sourceTe = actionMenuState.templateExercise;
                    const tmplId = actionMenuState.templateId;
                    setActionMenuState(null);
                    setSupersetPickerState({
                      visible: true,
                      templateId: tmplId,
                      sourceExercise: sourceTe,
                    });
                  }}
                >
                  <AppIcon name="link" size={20} color={uiColors.accentText} />
                  <Text style={styles.actionMenuItemText}>Pair Superset</Text>
                </TouchableOpacity>
              )}

              {/* Delete Exercise */}
              <TouchableOpacity
                testID={`delete-template-exercise-${actionMenuState.templateExercise.id}`}
                style={[styles.actionMenuItem, styles.actionMenuItemDestructive]}
                onPress={() => {
                  const teId = actionMenuState.templateExercise.id;
                  setActionMenuState(null);
                  handleDeleteTemplateExercise(teId);
                }} accessibilityRole="button" accessibilityLabel="Delete exercise"
              >
                <AppIcon name="trash" size={20} color={uiColors.danger} />
                <Text style={[styles.actionMenuItemText, { color: '#EF4444' }]}>
                  Delete Exercise
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: uiColors.background,
  },
  loadingText: {
    color: uiColors.subtle,
    fontSize: 13,
    marginTop: 12,
  },
  programTabBar: {
    backgroundColor: uiColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
  },
  tabScrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  programTab: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  programTabSelected: {
    backgroundColor: uiColors.border,
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  programTabText: {
    color: uiColors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  programTabTextSelected: {
    color: uiColors.text,
    fontWeight: '600',
  },
  activePill: {
    minHeight: 26,
    justifyContent: 'center',
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: uiRadius.badge,
  },
  activePillText: {
    lineHeight: 16,
    color: uiColors.background,
    fontSize: 11,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  programHeaderCard: {
    backgroundColor: uiColors.surface,
    borderRadius: uiRadius.card,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: uiColors.border,
  },
  programHeaderRow: {
    gap: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  programTitleRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 8,
  },
  programNameText: {
    flexShrink: 1,
    lineHeight: 24,
    color: uiColors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  programNotesContainer: {
    marginTop: 6,
    backgroundColor: uiColors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderLeftWidth: 2,
    borderLeftColor: '#3F3F46',
  },
  programNotesText: {
    color: uiColors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  progBadge: {
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: uiRadius.badge,
    backgroundColor: uiColors.raised,
    marginLeft: 6,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: '#3F3F46',
  },
  progBadgeLP: {
    borderColor: '#3B82F6',
    backgroundColor: '#172554',
  },
  progBadgeDP: {
    borderColor: '#10B981',
    backgroundColor: '#064E3B',
  },
  progBadgeDDP: {
    borderColor: '#F59E0B',
    backgroundColor: '#451A03',
  },
  progBadgeCustom: {
    borderColor: '#A855F7',
    backgroundColor: '#3B0764',
  },
  progBadgeText: {
    lineHeight: 16,
    fontSize: 11,
    fontWeight: '600',
    color: uiColors.secondaryText,
    letterSpacing: 0.5,
  },
  progBadgeTextLP: {
    color: '#93C5FD',
  },
  progBadgeTextDP: {
    color: '#6EE7B7',
  },
  progBadgeTextDDP: {
    color: '#FCD34D',
  },
  progBadgeTextCustom: {
    color: '#D8B4FE',
  },
  activeStatusBadge: {
    minHeight: 26,
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: uiRadius.badge,
  },
  activeStatusBadgeText: {
    lineHeight: 16,
    color: uiColors.background,
    fontSize: 11,
    fontWeight: '600',
  },
  setActiveBtn: {
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
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
    borderTopColor: uiColors.border,
  },
  programMetaText: {
    color: uiColors.subtle,
    fontSize: 11,
    fontWeight: '500',
  },
  headerBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cloneBtn: {
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: '#38BDF8',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
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
    color: uiColors.accentText,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  addTemplateBtn: {
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.accent,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  addTemplateBtnText: {
    color: uiColors.accentText,
    fontSize: 11,
    fontWeight: '700',
  },
  templateCard: {
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    padding: 12,
    marginBottom: 12,
  },
  templateHeader: {
    gap: 12,
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    marginBottom: 6,
  },
  templateHeaderLeft: {
    width: '100%',
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 0,
  },
  templateOrderPill: {
    minHeight: 26,
    justifyContent: 'center',
    backgroundColor: uiColors.border,
    color: uiColors.muted,
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: uiRadius.badge,
    marginRight: 8,
  },
  templateName: {
    minWidth: 0,
    lineHeight: 22,
    color: uiColors.text,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  templateHeaderActions: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  miniControlBtn: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    width: 36,
    height: 36,
    borderRadius: uiRadius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniControlBtnDestructive: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateNotes: {
    color: uiColors.subtle,
    fontSize: 11,
    marginBottom: 8,
  },
  exerciseList: {
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
    paddingTop: 8,
  },
  exerciseRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
  },
  exerciseInfoCol: {
    marginBottom: 6,
  },
  exerciseNameRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
  },
  exerciseNameText: {
    lineHeight: 22,
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '600',
  },
  supersetPill: {
    minHeight: 26,
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: uiRadius.badge,
    marginLeft: 4,
  },
  supersetPillText: {
    lineHeight: 16,
    color: uiColors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  prescriptionTapTarget: {
    marginTop: 2,
  },
  exerciseTargetText: {
    color: uiColors.muted,
    fontSize: 11,
  },
  editPencil: {
    color: uiColors.accentText,
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
  configureRulesBtn: {
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: uiColors.raised,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: uiColors.border,
  },
  configureRulesBtnText: {
    color: uiColors.secondaryText,
    fontSize: 10,
    fontWeight: '600',
  },
  addExerciseBtn: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  addExerciseBtnText: {
    color: uiColors.accentText,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: uiColors.surface,
    padding: 16,
    borderRadius: uiRadius.card,
    alignItems: 'center',
  },
  emptyText: {
    color: uiColors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  emptySubtext: {
    color: uiColors.subtle,
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  inlineAddBtn: {
    minHeight: 40,
    justifyContent: 'center',
    marginTop: 10,
    backgroundColor: uiColors.raised,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  inlineAddBtnText: {
    color: uiColors.background,
    fontSize: 12,
    fontWeight: '700',
  },
  cardDescription: {
    color: uiColors.muted,
    fontSize: 12,
    marginBottom: 8,
  },
  supersetChoiceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: uiColors.raised,
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: uiColors.border,
  },
  supersetChoiceText: {
    color: uiColors.text,
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
    backgroundColor: uiColors.surface,
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: uiColors.border,
  },
  createModalTitle: {
    color: uiColors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 14,
  },
  inputLabel: {
    color: uiColors.secondaryText,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  modalTextInput: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    color: uiColors.text,
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
    borderRadius: uiRadius.control,
  },
  colorChoiceActive: {
    borderWidth: 3,
    borderColor: uiColors.text,
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
    color: uiColors.subtle,
    fontSize: 13,
    fontWeight: '600',
  },
  confirmBtn: {
    backgroundColor: uiColors.accent,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: uiRadius.control,
  },
  confirmBtnText: {
    color: uiColors.background,
    fontSize: 13,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.3,
  },
  overflowMenuBtn: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    paddingVertical: 5,
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overflowMenuBtnText: {
    color: '#E4E4E7',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
  actionMenuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  actionMenuCard: {
    backgroundColor: uiColors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: uiColors.border,
    padding: 16,
    paddingBottom: 32,
  },
  actionMenuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
    paddingBottom: 12,
    marginBottom: 8,
  },
  actionMenuTitle: {
    color: uiColors.text,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  actionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
    gap: 12,
  },
  actionMenuItemDisabled: {
    opacity: 0.35,
  },
  actionMenuItemDestructive: {
    borderBottomWidth: 0,
    marginTop: 4,
  },
  actionMenuItemText: {
    fontSize: 14,
    fontWeight: '700',
    color: uiColors.text,
  },
});
