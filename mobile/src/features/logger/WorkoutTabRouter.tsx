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
import { ActiveSessionService } from '../../services/activeSessionService';
import { ActiveLoggerScreen } from './ActiveLoggerScreen';
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
  onStartSession,
  onFinishSession,
  onDiscardSession,
  onOpenProgramPlanner,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [starting, setStarting] = useState<boolean>(false);
  const [activeInfo, setActiveInfo] = useState<ActiveProgramInfo | null>(null);
  const [programDetails, setProgramDetails] = useState<ProgramWithDetails | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkoutTemplateDetail | null>(null);
  const [exerciseCatalog, setExerciseCatalog] = useState<Map<string, Exercise>>(new Map());
  const [showDayPickerModal, setShowDayPickerModal] = useState<boolean>(false);

  // Load active program, template sequence, and exercises
  const loadRouterState = useCallback(async () => {
    try {
      setLoading(true);
      const exercises = await exerciseRepo.findAll();
      const exMap = new Map(exercises.map((e) => [e.id, e]));
      setExerciseCatalog(exMap);

      if (programBlockService && programRepo) {
        const active = await programBlockService.getActiveProgram();
        setActiveInfo(active);

        if (active) {
          const details = await programRepo.getProgramWithDetails(active.program.id);
          setProgramDetails(details);

          if (details && details.templates.length > 0) {
            const tmpls = details.templates;
            const recent = await workoutRepo.findAll({ limit: 20 });
            const tmplIds = tmpls.map((t) => t.id);
            const lastCompleted = recent.find(
              (w) => w.status === 'completed' && w.template_id && tmplIds.includes(w.template_id)
            );

            let nextIdx = 0;
            if (lastCompleted && lastCompleted.template_id) {
              const lastIdx = tmpls.findIndex((t) => t.id === lastCompleted.template_id);
              if (lastIdx !== -1) {
                nextIdx = (lastIdx + 1) % tmpls.length;
              }
            }
            setSelectedTemplate(tmpls[nextIdx]);
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
  }, [isActiveTab, hasActiveWorkout, loadRouterState]);

  // Start workout from a specific template
  const handleStartTemplateWorkout = async (template: WorkoutTemplateDetail) => {
    try {
      setStarting(true);
      const sessionService = new ActiveSessionService(workoutRepo, exerciseRepo, gearRepo);

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
        for (const te of template.exercises) {
          const setCount = te.target_sets || 3;
          for (let s = 1; s <= setCount; s++) {
            await sessionService.addSet(newWorkout.id, {
              exerciseId: te.exercise_id,
              rawInputWeight: 0,
              reps: te.target_reps_min || 8,
              rpe: te.target_rpe ?? null,
              rir: te.target_rir ?? null,
              gearId: te.gear_id ?? null,
              exerciseGroupId: te.exercise_group_id ?? null,
              setNumber: s,
            });
          }

          // Pre-populate smart warmups for SBD & compounds (ADR-082)
          if (warmupMode !== 'off') {
            const exObj = exerciseCatalog.get(te.exercise_id);
            const isSBDorCompound =
              exObj?.is_compound ||
              exObj?.standard_lift_type === 'squat' ||
              exObj?.standard_lift_type === 'bench' ||
              exObj?.standard_lift_type === 'deadlift' ||
              exObj?.category === 'Barbell' ||
              (exObj?.parent_exercise_id &&
                (exObj.parent_exercise_id.includes('squat') ||
                  exObj.parent_exercise_id.includes('bench') ||
                  exObj.parent_exercise_id.includes('deadlift')));

            if (warmupMode === 'all_exercises' || isSBDorCompound) {
              try {
                await sessionService.generateWarmupSetsForExercise(newWorkout.id, te.exercise_id);
              } catch (warmupErr) {
                console.warn(`Could not generate warmups for ${te.exercise_id}:`, warmupErr);
              }
            }
          }
        }
      }

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
        <ActivityIndicator size="large" color="#00E676" />
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
          {/* Header Banner */}
          <View style={styles.preflightHeader}>
            <View style={styles.programPill}>
              <View
                style={[
                  styles.colorDot,
                  { backgroundColor: activeInfo.program.color_hex || '#00E676' },
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
          <View style={styles.exerciseListContainer}>
            {selectedTemplate.exercises.map((te, idx) => {
              const ex = exerciseCatalog.get(te.exercise_id);
              const exName = ex?.name ?? te.exercise_id;

              return (
                <View
                  key={te.id}
                  testID={`preflight-exercise-${te.id}`}
                  style={styles.exerciseRow}
                >
                  <View style={styles.exerciseRowLeft}>
                    <View style={styles.exerciseIndexPill}>
                      <Text style={styles.exerciseIndexText}>{idx + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.exerciseTitleRow}>
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
                        {te.target_rpe != null
                          ? ` @ RPE ${te.target_rpe}`
                          : te.target_rir != null
                          ? ` @ ${te.target_rir} RIR`
                          : ''}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Primary CTA: START WORKOUT */}
          <TouchableOpacity
            testID="start-workout-cta"
            style={[styles.primaryStartBtn, starting && styles.btnDisabled]}
            onPress={() => handleStartTemplateWorkout(selectedTemplate)}
            disabled={starting}
            activeOpacity={0.8}
          >
            {starting ? (
              <ActivityIndicator size="small" color="#0A0A0A" />
            ) : (
              <Text style={styles.primaryStartBtnText}>⚡ START WORKOUT</Text>
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
        <Text style={styles.emptyStateIcon}>📋</Text>
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
          <Text style={styles.openPlannerBtnText}>Open Program Planner 📋</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="start-freestyle-cta"
          style={styles.startFreestyleEmptyBtn}
          onPress={handleStartFreestyleWorkout}
          activeOpacity={0.8}
        >
          <Text style={styles.startFreestyleEmptyBtnText}>
            Start Freestyle Workout ⚡
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
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
    color: '#FAFAFA',
    fontSize: 12,
    fontWeight: '700',
  },
  sequencePill: {
    color: '#00E676',
    backgroundColor: '#0F1A12',
    borderWidth: 1,
    borderColor: '#00E676',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  templateCard: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1E1E22',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  templateName: {
    color: '#FAFAFA',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 4,
  },
  templateNotes: {
    color: '#A1A1AA',
    fontSize: 12,
    marginBottom: 10,
  },
  summaryBar: {
    backgroundColor: '#18181B',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  summaryBarText: {
    color: '#86EFAC',
    fontSize: 11,
    fontWeight: '700',
  },
  sectionTitle: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  exerciseListContainer: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1E1E22',
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 20,
  },
  exerciseRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  exerciseRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  exerciseIndexPill: {
    backgroundColor: '#18181B',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  exerciseIndexText: {
    color: '#71717A',
    fontSize: 11,
    fontWeight: '800',
  },
  exerciseTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  exerciseNameText: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '700',
  },
  supersetPill: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  supersetPillText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
  },
  exerciseTargetText: {
    color: '#A1A1AA',
    fontSize: 12,
    marginTop: 2,
  },
  primaryStartBtn: {
    backgroundColor: '#00E676',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  primaryStartBtnText: {
    color: '#0A0A0A',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  secondaryActionsContainer: {
    gap: 8,
  },
  secondaryBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#D4D4D8',
    fontSize: 13,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  emptyStateCard: {
    margin: 20,
    marginTop: 60,
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1E1E22',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  emptyStateIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyStateTitle: {
    color: '#FAFAFA',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptyStateText: {
    color: '#A1A1AA',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  openPlannerBtn: {
    backgroundColor: '#00E676',
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  openPlannerBtnText: {
    color: '#0A0A0A',
    fontSize: 14,
    fontWeight: '900',
  },
  startFreestyleEmptyBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    width: '100%',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  startFreestyleEmptyBtnText: {
    color: '#D4D4D8',
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
    backgroundColor: '#121214',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 16,
  },
  modalTitle: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
  },
  dayPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  dayPickerItemActive: {
    borderColor: '#00E676',
    backgroundColor: '#0F1A12',
  },
  dayPickerItemIndex: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '800',
    marginRight: 10,
  },
  dayPickerItemName: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '600',
  },
  modalCancelBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  modalCancelBtnText: {
    color: '#71717A',
    fontSize: 13,
    fontWeight: '600',
  },
});
