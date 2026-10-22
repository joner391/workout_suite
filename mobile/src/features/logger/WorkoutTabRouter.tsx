import { AppIcon } from '../../ui/AppIcon';
import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
/**
 * Workout Suite — WorkoutTabRouter
 *
 * Implements Section 4.2: Tab 2: WORKOUT (Smart Session Router & Pre-Flight Screen)
 * Dynamically resolves one of three states:
 * - State A: Workout In Progress -> ActiveLoggerScreen
 * - State B: No Workout In Progress, Active Program -> Pre-Flight Screen
 * - State C: No Workout In Progress, No Active Program -> Empty State Banner
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
} from 'react-native';
import {
  IWorkoutRepository,
  IExerciseRepository,
  IGearRepository,
  IUserSettingsRepository,
  IProgramRepository,
  IPainReportRepository,
  IExercisePreferenceRepository,
} from '../../domain/repositories';
import {
  ProgramBlockService,
  ActiveProgramInfo,
} from '../../services/programBlockService';
import { ExercisePreferenceService } from '../../services/exercisePreferenceService';
import { TrainingAdaptationService } from '../../services/trainingAdaptationService';
import { ProgramEvolutionService } from '../../services/programEvolutionService';
import { useOptionalRepositories } from '../../context/RepositoryContext';
import { ActiveSessionService } from '../../services/activeSessionService';
import { ActiveLoggerScreen } from './ActiveLoggerScreen';
import { shouldGenerateWarmups } from '../../core/math/warmupEstimator';
import { WorkoutPrescription } from '../home/WorkoutPrescription';
import { buildWorkoutPreview, selectNextTemplate, ExercisePrescription } from '../../services/workoutPreviewService';
import {
  Workout,
  WorkoutTemplate,
  Exercise,
  TemplateExercise,
  AutoWarmupMode,
} from '../../core/types';
import { ProgramWithDetails, WorkoutTemplateDetail } from '../../domain/repositories/IProgramRepository';

export interface WorkoutTabRouterProps {
  workoutRepo: IWorkoutRepository;
  exerciseRepo: IExerciseRepository;
  gearRepo?: IGearRepository;
  userSettingsRepo?: IUserSettingsRepository;
  programRepo?: IProgramRepository;
  painReportRepo?: IPainReportRepository;
  exercisePreferenceRepo?: IExercisePreferenceRepository;
  exercisePreferenceService?: ExercisePreferenceService;
  programBlockService?: ProgramBlockService;
  hasActiveWorkout: boolean;
  currentWorkoutId?: string;
  isActiveTab?: boolean;
  programRevision?: number;
  onStartSession: (workoutId: string) => void;
  onFinishSession: (completedWorkout: Workout) => void;
  onDiscardSession: () => void;
  onOpenProgramPlanner: () => void;
}

export const WorkoutTabRouter: React.FC<WorkoutTabRouterProps> = ({
  workoutRepo,
  exerciseRepo,
  gearRepo,
  userSettingsRepo,
  programRepo,
  painReportRepo,
  exercisePreferenceRepo,
  exercisePreferenceService,
  programBlockService,
  hasActiveWorkout,
  currentWorkoutId,
  isActiveTab,
  programRevision,
  onStartSession,
  onFinishSession,
  onDiscardSession,
  onOpenProgramPlanner,
}) => {
  const repositories = useOptionalRepositories();
  const adaptationContext = { settings: userSettingsRepo, programs: programRepo,
    profiles: repositories?.userProfileRepo, preferences: exercisePreferenceRepo ?? repositories?.exercisePreferenceRepo,
    calibration: repositories?.calibratedParamService };
  const [loading, setLoading] = useState<boolean>(true);
  const [starting, setStarting] = useState<boolean>(false);
  const [activeInfo, setActiveInfo] = useState<ActiveProgramInfo | null>(null);
  const [programDetails, setProgramDetails] = useState<ProgramWithDetails | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkoutTemplateDetail | null>(null);
  const [exerciseCatalog, setExerciseCatalog] = useState<Map<string, Exercise>>(new Map());
  const [showDayPickerModal, setShowDayPickerModal] = useState<boolean>(false);
  const [previewRows, setPreviewRows] = useState<ExercisePrescription[]>([]);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    if (!selectedTemplate || !(isActiveTab ?? true) || hasActiveWorkout) return;
    let alive = true;
    setPreviewRows([]); setPreviewError(false);
    (async () => {
      try {
        const unit = await userSettingsRepo?.getUnitSystem() ?? 'kg';
        const bodyweight = await userSettingsRepo?.getUserBodyweight();
        const rows = await buildWorkoutPreview(selectedTemplate, workoutRepo, exerciseCatalog, unit, gearRepo, bodyweight, adaptationContext);
        if (alive) setPreviewRows(rows);
      } catch { if (alive) setPreviewError(true); }
    })();
    return () => { alive = false; };
  }, [selectedTemplate, workoutRepo, exerciseCatalog, gearRepo, userSettingsRepo, isActiveTab, hasActiveWorkout]);

  // Load active program, template sequence, and exercises
  const loadRouterState = useCallback(async () => {
    try {
      setLoading(true);
      const exercises = await exerciseRepo.findAll();
      const exMap = new Map(exercises.map((e) => [e.id, e]));
      setExerciseCatalog(exMap);

      if (programBlockService && programRepo) {
        let active = await programBlockService.getActiveProgram();
        if (active && userSettingsRepo && repositories?.userProfileRepo) {
          const adaptation = new TrainingAdaptationService(workoutRepo, adaptationContext);
          const recent = await workoutRepo.findAll({ status: 'completed', startDate: active.block.start_date });
          for (const workout of [...recent].reverse()) await adaptation.complete(workout.id);
          const evolution = new ProgramEvolutionService(programRepo, repositories.userProfileRepo, workoutRepo,
            painReportRepo, exerciseRepo, programBlockService, userSettingsRepo,
            exercisePreferenceRepo ?? repositories.exercisePreferenceRepo);
          if ((await evolution.isReadyForEvolution(active.program.id)).ready) {
            await evolution.evolveActiveProgramForNextMeso({ programId: active.program.id });
            active = await programBlockService.getActiveProgram();
          }
        }
        setActiveInfo(active);
        setSelectedTemplate(null);
        setProgramDetails(null);

        if (active) {
          const details = await programRepo.getProgramWithDetails(active.program.id);
          setProgramDetails(details);

          if (details && details.templates.length > 0) {
            const completed = await workoutRepo.findAll({ status: 'completed' });
            setSelectedTemplate(selectNextTemplate(details.templates, completed));
          }
        }
      }
    } catch (err) {
      console.error('Failed to load workout router state:', err);
    } finally {
      setLoading(false);
    }
  }, [workoutRepo, exerciseRepo, programRepo, programBlockService]);

  useEffect(() => {
    if ((isActiveTab ?? true) && !hasActiveWorkout) {
      loadRouterState();
    }
  }, [isActiveTab, hasActiveWorkout, loadRouterState, programRevision]);

  // Start workout from a specific template
  const handleStartTemplateWorkout = async (template: WorkoutTemplateDetail) => {
    try {
      setStarting(true);
      const sessionService = new ActiveSessionService(workoutRepo, exerciseRepo, gearRepo);
      const bodyweight = await userSettingsRepo?.getUserBodyweight();
      const adaptation = new TrainingAdaptationService(workoutRepo, adaptationContext);
      const resolvedTemplate = await adaptation.resolve(template, exerciseCatalog);
      const plan = await buildWorkoutPreview(template, workoutRepo, exerciseCatalog, 'kg', gearRepo, bodyweight, adaptationContext);

      const newWorkout = await sessionService.startWorkout({
        name: template.name,
        templateId: template.id,
        notes: template.notes,
      });

      // Fetch auto warmup mode preference
      let warmupMode: AutoWarmupMode = 'smart_compounds';
      if (userSettingsRepo) {
        try {
          const mode = await userSettingsRepo.getAutoWarmupMode();
          if (mode) warmupMode = mode;
        } catch {
          // fallback to smart_compounds
        }
      }

      // Populate planned sets from template exercises
      if (template.exercises && template.exercises.length > 0) {
        for (const row of plan) {
          const te = row.templateExercise;
          for (const [index, set] of row.sets.entries()) {
            await sessionService.addSet(newWorkout.id, {
              exerciseId: te.exercise_id,
              rawInputWeight: set.rawInputWeight ?? 0,
              reps: set.reps,
              setType: set.setType,
              bodyweightKg: row.bodyweightKg,
              rpe: null,
              rir: null,
              gearId: te.gear_id ?? null,
              exerciseGroupId: row.groupId,
              setNumber: index + 1,
            });
          }

          // Use the same warm-up policy as adding an exercise during a session.
          if (warmupMode !== 'off') {
            const exObj = exerciseCatalog.get(te.exercise_id);
            if (exObj && shouldGenerateWarmups(warmupMode, exObj)) {
              try {
                await sessionService.generateWarmupSetsForExercise(newWorkout.id, te.exercise_id);
              } catch (warmupErr) {
                console.warn(`Could not generate warmups for ${te.exercise_id}:`, warmupErr);
              }
            }
          }
        }
      }

      await adaptation.capture(newWorkout.id, resolvedTemplate, exerciseCatalog);
      onStartSession(newWorkout.id);
    } catch (err: any) {
      console.error('Failed to start template workout:', err);
    } finally {
      setStarting(false);
    }
  };

  // Start empty freestyle workout
  const handleStartFreestyleWorkout = async () => {
    try {
      setStarting(true);
      const sessionService = new ActiveSessionService(workoutRepo, exerciseRepo, gearRepo);
      const newWorkout = await sessionService.startWorkout({
        name: `Freestyle Workout • ${new Date().toLocaleDateString()}`,
      });
      onStartSession(newWorkout.id);
    } catch (err: any) {
      console.error('Failed to start freestyle workout:', err);
    } finally {
      setStarting(false);
    }
  };

  // ==========================================================================
  // STATE A: WORKOUT IN PROGRESS -> ActiveLoggerScreen
  // ==========================================================================
  if (hasActiveWorkout && currentWorkoutId) {
    return (
      <View testID="workout-state-a-logger" style={styles.container}>
        <ActiveLoggerScreen
          isActiveTab={isActiveTab}
          initialWorkoutId={currentWorkoutId}
          workoutRepo={workoutRepo}
          exerciseRepo={exerciseRepo}
          gearRepo={gearRepo}
          userSettingsRepo={userSettingsRepo}
          programRepo={programRepo}
          painReportRepo={painReportRepo}
          exercisePreferenceRepo={exercisePreferenceRepo}
          exercisePreferenceService={exercisePreferenceService}
          onFinishSession={onFinishSession}
          onDiscardSession={onDiscardSession}
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={uiColors.accent} />
        <Text style={styles.loadingText}>Resolving workout status...</Text>
      </View>
    );
  }

  // ==========================================================================
  // STATE B: NO WORKOUT IN PROGRESS, USER HAS ACTIVE PROGRAM (Pre-Flight)
  // ==========================================================================
  if (activeInfo && selectedTemplate) {
    const templates = programDetails?.templates || [];
    const currentIndex = templates.findIndex((t) => t.id === selectedTemplate.id);
    const dayBadgeText =
      currentIndex !== -1
        ? `DAY ${currentIndex + 1} OF ${templates.length}`
        : 'PLANNED ROUTINE';

    return (
      <View testID="workout-state-b-preflight" style={styles.container}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity
            testID="workout-manage-programs-btn"
            accessibilityRole="button"
            style={styles.secondaryBtn}
            onPress={onOpenProgramPlanner}
          >
            <Text style={styles.secondaryBtnText}>Manage programs →</Text>
          </TouchableOpacity>
          {/* Header Banner */}
          <View style={styles.preflightHeader}>
            <View style={styles.programPill}>
              <View
                style={[
                  styles.colorDot,
                  { backgroundColor: activeInfo.program.color_hex || uiColors.accent },
                ]}
              />
              <Text style={styles.programPillText}>{activeInfo.program.name}</Text>
            </View>
            <Text style={styles.sequencePill}>{dayBadgeText}</Text>
          </View>

          {/* Template Details Card */}
          <View style={styles.templateCard}>
            <Text testID="preflight-template-name" style={styles.templateName}>
              {selectedTemplate.name}
            </Text>
            {selectedTemplate.notes && (
              <Text style={styles.templateNotes}>{selectedTemplate.notes}</Text>
            )}

            <View style={styles.summaryBar}>
              <Text style={styles.summaryBarText}>
                {selectedTemplate.exercises.length} Exercises Planned
              </Text>
            </View>
          </View>

          {/* Planned Exercise List Preview */}
          <Text style={styles.sectionTitle}>PLANNED EXERCISES & TARGETS</Text>
          <WorkoutPrescription rows={previewRows} />
          {previewRows.length > 0 && previewRows.length < (selectedTemplate?.exercises.length ?? 0) &&
            <Text style={styles.exerciseTargetText}>An exercise is omitted because no acceptable pain-recovery substitute is available. Review exercise preferences before restoring it.</Text>}
          {previewError && <Text style={styles.exerciseTargetText}>Load preview unavailable. Your template is still available in the logger.</Text>}
          {/* Primary CTA: START WORKOUT */}
          <TouchableOpacity
            testID="start-workout-cta"
            style={[styles.primaryStartBtn, starting && styles.btnDisabled]}
            onPress={() => handleStartTemplateWorkout(selectedTemplate)}
            disabled={starting}
            activeOpacity={0.8}
          >
            {starting ? (
              <ActivityIndicator size="small" color={uiColors.background} />
            ) : (
                <Text style={styles.primaryStartBtnText}>START WORKOUT</Text>
            )}
          </TouchableOpacity>

          {/* Secondary CTAs */}
          <View style={styles.secondaryActionsContainer}>
            <TouchableOpacity
              testID="select-other-day-btn"
              style={styles.secondaryBtn}
              onPress={() => setShowDayPickerModal(true)}
            >
              <Text style={styles.secondaryBtnText}>
                Select another day from this program
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="start-freestyle-btn"
              style={styles.secondaryBtn}
              onPress={handleStartFreestyleWorkout}
            >
              <Text style={styles.secondaryBtnText}>Start empty freestyle workout</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Day Picker Modal */}
        <Modal
          visible={showDayPickerModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowDayPickerModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Select Workout Day</Text>
              <ScrollView style={{ maxHeight: 300 }}>
                {templates.map((tmpl, idx) => (
                  <TouchableOpacity
                    key={tmpl.id}
                    testID={`day-picker-item-${tmpl.id}`}
                    style={[
                      styles.dayPickerItem,
                      selectedTemplate.id === tmpl.id && styles.dayPickerItemActive,
                    ]}
                    onPress={() => {
                      setSelectedTemplate(tmpl);
                      setShowDayPickerModal(false);
                    }}
                  >
                    <Text style={styles.dayPickerItemIndex}>Day {idx + 1}</Text>
                    <Text style={styles.dayPickerItemName}>{tmpl.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowDayPickerModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ==========================================================================
  // STATE C: NO WORKOUT IN PROGRESS, NO ACTIVE PROGRAM
  // ==========================================================================
  return (
    <View testID="workout-state-c-no-program" style={styles.container}>
      <View style={styles.emptyStateCard}>
        <AppIcon name="clipboard" size={32} color={uiColors.accentText} />
        <Text style={styles.emptyStateTitle}>No Active Training Program</Text>
        <Text style={styles.emptyStateText}>
          You are not currently subscribed to a training program. Select a pre-built split,
          generate a custom routine, or start an ad-hoc freestyle session.
        </Text>

        <TouchableOpacity
          testID="open-planner-cta"
          style={styles.openPlannerBtn}
          onPress={onOpenProgramPlanner}
          activeOpacity={0.8}
        >
          <Text style={styles.openPlannerBtnText}>Open Program Planner </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="start-freestyle-cta"
          style={styles.startFreestyleEmptyBtn}
          onPress={handleStartFreestyleWorkout}
          activeOpacity={0.8}
        >
          <Text style={styles.startFreestyleEmptyBtnText}>
            Start Freestyle Workout
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  preflightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  programPill: {
    minHeight: 26,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: uiRadius.badge,
    flex: 1,
    marginRight: 8,
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  programPillText: {
    lineHeight: 16,
    color: uiColors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  sequencePill: {
    minHeight: 26,
    justifyContent: 'center',
    color: uiColors.accentText,
    backgroundColor: '#0F1A12',
    borderWidth: 1,
    borderColor: uiColors.accent,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: uiRadius.badge,
  },
  templateCard: {
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    padding: 16,
    marginBottom: 16,
  },
  templateName: {
    color: uiColors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  templateNotes: {
    color: uiColors.muted,
    fontSize: 12,
    marginBottom: 10,
  },
  summaryBar: {
    backgroundColor: uiColors.raised,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  summaryBarText: {
    color: uiColors.accentText,
    fontSize: 11,
    fontWeight: '700',
  },
  sectionTitle: {
    color: uiColors.accentText,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  exerciseTargetText: {
    color: uiColors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  primaryStartBtn: {
    backgroundColor: uiColors.accent,
    paddingVertical: 16,
    borderRadius: uiRadius.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  primaryStartBtnText: {
    color: uiColors.background,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  secondaryActionsContainer: {
    gap: 8,
  },
  secondaryBtn: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    paddingVertical: 12,
    borderRadius: uiRadius.control,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: uiColors.secondaryText,
    fontSize: 13,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  emptyStateCard: {
    margin: 20,
    marginTop: 60,
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    padding: 24,
    alignItems: 'center',
  },
  emptyStateTitle: {
    color: uiColors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyStateText: {
    color: uiColors.muted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  openPlannerBtn: {
    backgroundColor: uiColors.accent,
    width: '100%',
    paddingVertical: 14,
    borderRadius: uiRadius.control,
    alignItems: 'center',
    marginBottom: 10,
  },
  openPlannerBtnText: {
    color: uiColors.background,
    fontSize: 14,
    fontWeight: '700',
  },
  startFreestyleEmptyBtn: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    width: '100%',
    paddingVertical: 12,
    borderRadius: uiRadius.control,
    alignItems: 'center',
  },
  startFreestyleEmptyBtnText: {
    color: uiColors.secondaryText,
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: uiColors.surface,
    borderRadius: uiRadius.card,
    borderWidth: 1,
    borderColor: uiColors.border,
    padding: 16,
  },
  modalTitle: {
    lineHeight: 28,
    flexShrink: 1,
    color: uiColors.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  dayPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: uiColors.raised,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: uiColors.border,
  },
  dayPickerItemActive: {
    borderColor: uiColors.accent,
    backgroundColor: '#0F1A12',
  },
  dayPickerItemIndex: {
    color: uiColors.accentText,
    fontSize: 11,
    fontWeight: '700',
    marginRight: 10,
  },
  dayPickerItemName: {
    color: uiColors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  modalCancelBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  modalCancelBtnText: {
    color: uiColors.subtle,
    fontSize: 13,
    fontWeight: '600',
  },
});
