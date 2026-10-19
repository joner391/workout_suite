/**
 * Workout Suite — ActiveLoggerScreen
 *
 * Implements Step 1.5: Active Workout Logger UI & QoL Popovers
 * Implements ADR-009: Superset & Exercise Grouping
 * Implements ADR-010: Write-Through Crash Recovery for Active Sessions
 * Implements ADR-021: Dumbbell Per-Hand Input & Unilateral Limb Data Modeling
 * Implements ADR-022: In-Logger Plate Loading Calculator & Cognitive Offloading
 * Implements ADR-023: In-Session 1-Tap Exercise Substitution
 * Implements ADR-024: Pure Utility Mode (OLED-friendly high-contrast styling)
 * Implements ADR-025: Equipment Mechanical Advantage Profiles (Gear Subtext Indicators)
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  FlatList,
  TextInput,
  Alert,
  AppState,
} from 'react-native';
import {
  Workout,
  WorkoutSet,
  WorkoutWithSets,
  Exercise,
  GearInventory,
  WeightUnit,
  IntensityMetric,
  ProgressionProposal,
  CalibratedParam,
  AutoWarmupMode,
} from '../../core/types';
import { IWorkoutRepository } from '../../domain/repositories/IWorkoutRepository';
import { IExerciseRepository } from '../../domain/repositories/IExerciseRepository';
import { IGearRepository } from '../../domain/repositories/IGearRepository';
import { IUserSettingsRepository } from '../../domain/repositories/IUserSettingsRepository';
import { IProgramRepository } from '../../domain/repositories/IProgramRepository';
import { IPainReportRepository } from '../../domain/repositories/IPainReportRepository';
import { CalibratedParamService } from '../../services/calibratedParamService';
import { ActiveSessionService } from '../../services/activeSessionService';
import { RestTimerService } from '../../services/restTimerService';
import { ExerciseSubstitutionService } from '../../services/exerciseSubstitutionService';
import {
  CrashRecoveryService,
  CrashRecoveryPromptData,
} from '../../services/crashRecoveryService';
import { evaluateProgressionRules } from '../../core/rules/progressionRuleEngine';

import { SetRowComponent } from './SetRowComponent';
import { RestTimerBanner, formatTimeRemaining } from './RestTimerBanner';
import { PlateCalculatorModal } from './PlateCalculatorModal';
import { ExerciseSubstitutionModal } from './ExerciseSubstitutionModal';
import { PainReportModal } from './PainReportModal';
import { CrashRecoveryDialog } from './CrashRecoveryDialog';
import { SupersetBracketGroup } from './SupersetBracketGroup';
import { ProgressionProposalBanner } from './ProgressionProposalBanner';
import { ExerciseLibraryScreen } from '../inspection/ExerciseLibraryScreen';
import { SessionDetailModal } from '../calendar/SessionDetailModal';
import { useKeepAwake } from 'expo-keep-awake';
import { generateWarmupSets } from '../../core/math/warmupEstimator';

export interface WorkoutDurationTickerProps {
  startedAt?: string | null;
  style?: any;
  testID?: string;
}

export const WorkoutDurationTicker: React.FC<WorkoutDurationTickerProps> = React.memo(({
  startedAt,
  style,
  testID = 'session-elapsed-ticker',
}) => {
  const [durationText, setDurationText] = useState<string>('00:00:00');

  useEffect(() => {
    if (!startedAt) return;
    const startMs = new Date(startedAt).getTime();

    const update = () => {
      const nowMs = Date.now();
      const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
      const hours = Math.floor(elapsedSec / 3600);
      const mins = Math.floor((elapsedSec % 3600) / 60);
      const secs = elapsedSec % 60;
      setDurationText(
        `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs
          .toString()
          .padStart(2, '0')}`
      );
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <Text testID={testID} style={style}>
      {durationText}
    </Text>
  );
});

export function formatElapsedDuration(startedAt?: string | null): string {
  if (!startedAt) return '00:00:00';
  const startMs = new Date(startedAt).getTime();
  const elapsedSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  const hours = Math.floor(elapsedSec / 3600);
  const mins = Math.floor((elapsedSec % 3600) / 60);
  const secs = elapsedSec % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs
    .toString()
    .padStart(2, '0')}`;
}

export interface ActiveLoggerScreenProps {
  initialWorkoutId?: string;
  workoutRepo: IWorkoutRepository;
  exerciseRepo: IExerciseRepository;
  gearRepo?: IGearRepository;
  userSettingsRepo?: IUserSettingsRepository;
  programRepo?: IProgramRepository;
  painReportRepo?: IPainReportRepository;
  calibratedParamService?: CalibratedParamService;
  activeSessionService?: ActiveSessionService;
  restTimerService?: RestTimerService;
  exerciseSubstitutionService?: ExerciseSubstitutionService;
  crashRecoveryService?: CrashRecoveryService;
  onFinishSession?: (workout: Workout) => void;
  onDiscardSession?: () => void;
}

export const ActiveLoggerScreen: React.FC<ActiveLoggerScreenProps> = ({
  initialWorkoutId,
  workoutRepo,
  exerciseRepo,
  gearRepo,
  userSettingsRepo,
  programRepo,
  painReportRepo,
  calibratedParamService,
  activeSessionService: propSessionService,
  restTimerService: propTimerService,
  exerciseSubstitutionService: propSubService,
  crashRecoveryService: propRecoveryService,
  onFinishSession,
  onDiscardSession,
}) => {
  // Lock screen awake during workout session
  try {
    useKeepAwake();
  } catch {
    // Safe fallback if native module is unavailable
  }

  // Services instantiation fallback
  const sessionService = useMemo(
    () => propSessionService ?? new ActiveSessionService(workoutRepo, exerciseRepo, gearRepo),
    [propSessionService, workoutRepo, exerciseRepo, gearRepo]
  );

  const timerService = useMemo(
    () => propTimerService ?? new RestTimerService(),
    [propTimerService]
  );

  const subService = useMemo(
    () => propSubService ?? new ExerciseSubstitutionService(exerciseRepo, workoutRepo, gearRepo),
    [propSubService, exerciseRepo, workoutRepo, gearRepo]
  );

  const recoveryService = useMemo(
    () => propRecoveryService ?? new CrashRecoveryService(workoutRepo),
    [propRecoveryService, workoutRepo]
  );

  // Core State
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [sets, setSets] = useState<WorkoutSet[]>([]);
  const [completedSetIds, setCompletedSetIds] = useState<Set<string>>(new Set());
  const [expandedExerciseIds, setExpandedExerciseIds] = useState<Set<string>>(new Set());
  const [expandedWarmupExercises, setExpandedWarmupExercises] = useState<Set<string>>(new Set());
  const [autoWarmupMode, setAutoWarmupMode] = useState<AutoWarmupMode>('smart_compounds');
  const cardOffsetsRef = useRef<Record<string, number>>({});
  const [markIncompleteAsComplete, setMarkIncompleteAsComplete] = useState<boolean>(false);
  const [exerciseMap, setExerciseMap] = useState<Map<string, Exercise>>(new Map());
  const [gearMap, setGearMap] = useState<Map<string, GearInventory>>(new Map());
  const [ghostSetsByExercise, setGhostSetsByExercise] = useState<Map<string, WorkoutSet[]>>(new Map());
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');
  const [intensityMetric, setIntensityMetric] = useState<IntensityMetric>('RPE');
  const [loading, setLoading] = useState<boolean>(true);
  const [expandedSetId, setExpandedSetId] = useState<string | null>(null);

  // Modals state
  const [recoveryData, setRecoveryData] = useState<CrashRecoveryPromptData | null>(null);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState<boolean>(false);

  const [plateModalTarget, setPlateModalTarget] = useState<{
    visible: boolean;
    weightKg: number;
    barTareKg: number;
    exerciseName?: string;
    gearName?: string | null;
    targetSetId?: string;
  }>({
    visible: false,
    weightKg: 20,
    barTareKg: 20,
  });

  const [subModalTarget, setSubModalTarget] = useState<{
    visible: boolean;
    exercise: Exercise | null;
  }>({
    visible: false,
    exercise: null,
  });

  const [painModalTarget, setPainModalTarget] = useState<{
    visible: boolean;
    exercise: Exercise | null;
  }>({
    visible: false,
    exercise: null,
  });

  const [painAlertBanner, setPainAlertBanner] = useState<string | null>(null);

  const [showAddExerciseModal, setShowAddExerciseModal] = useState<boolean>(false);
  const [showFullLibraryModal, setShowFullLibraryModal] = useState<boolean>(false);
  const [allCatalogExercises, setAllCatalogExercises] = useState<Exercise[]>([]);

  const [exerciseSearchQuery, setExerciseSearchQuery] = useState<string>('');
  const [showFinishConfirmModal, setShowFinishConfirmModal] = useState<boolean>(false);
  const [finishNotes, setFinishNotes] = useState<string>('');
  const [showSupersetModal, setShowSupersetModal] = useState<boolean>(false);
  const [supersetSourceExercise, setSupersetSourceExercise] = useState<Exercise | null>(null);
  const [gearPickerExercise, setGearPickerExercise] = useState<Exercise | null>(null);
  const [summaryWorkoutId, setSummaryWorkoutId] = useState<string | null>(null);
  const [finishedWorkoutObj, setFinishedWorkoutObj] = useState<Workout | null>(null);
  const [calibratedParamsMap, setCalibratedParamsMap] = useState<Map<string, CalibratedParam>>(
    new Map()
  );

  // Active Progression Proposal State (Step 4.4)
  const [activeProposal, setActiveProposal] = useState<{
    proposal: ProgressionProposal;
    exerciseName?: string;
    templateExerciseId?: string;
    exerciseId?: string;
  } | null>(null);

  // 1. Initial Load: Check Crash Recovery or Load Specified Workout
  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        setLoading(true);

        // Load user settings if available
        if (userSettingsRepo) {
          const [unit, intensity, warmupMode] = await Promise.all([
            userSettingsRepo.getUnitSystem(),
            userSettingsRepo.getIntensityMetric(),
            userSettingsRepo.getAutoWarmupMode(),
          ]);
          if (unit) setUnitSystem(unit);
          if (intensity) setIntensityMetric(intensity);
          if (warmupMode) setAutoWarmupMode(warmupMode);
        }

        // Load exercises & gear catalog
        const [exercises, gears] = await Promise.all([
          exerciseRepo.findAll(),
          gearRepo ? gearRepo.findAll() : Promise.resolve([]),
        ]);

        if (!isMounted) return;

        const eMap = new Map(exercises.map((e) => [e.id, e]));
        const gMap = new Map(gears.map((g) => [g.id, g]));
        setExerciseMap(eMap);
        setGearMap(gMap);
        setAllCatalogExercises(exercises);

        // Load calibrated parameters if service provided (ADR-072 / Phase 6)
        if (calibratedParamService) {
          try {
            const params = await calibratedParamService.getAllCalibratedParams();
            if (isMounted) {
              setCalibratedParamsMap(new Map(params.map((p) => [p.exercise_id, p])));
            }
          } catch (err) {
            console.warn('Failed to load calibrated params in logger:', err);
          }
        }

        let workoutToLoadId = initialWorkoutId;

        // If no explicit ID passed, check for interrupted session
        if (!workoutToLoadId) {
          const promptData = await recoveryService.checkForInterruptedWorkout();
          if (promptData && isMounted) {
            setRecoveryData(promptData);
            setShowRecoveryDialog(true);
            setLoading(false);
            return;
          }
        }

        // If still no workout ID, start a default empty workout
        if (!workoutToLoadId) {
          const newWorkout = await sessionService.startWorkout({
            name: `Workout • ${new Date().toLocaleDateString()}`,
          });
          workoutToLoadId = newWorkout.id;
        }

        if (workoutToLoadId && isMounted) {
          await loadWorkout(workoutToLoadId, eMap);
        }
      } catch (err) {
        console.error('Failed to initialize ActiveLoggerScreen:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    init();

    return () => {
      isMounted = false;
    };
  }, [initialWorkoutId]);

  // Load a workout and its ghost sets
  const loadWorkout = async (workoutId: string, currentExerciseMap = exerciseMap) => {
    const session = await sessionService.getActiveWorkout(workoutId);
    if (!session) return;

    setActiveWorkout(session.workout);
    setSets(session.sets);

    // Restore completed sets from settings if previously stored for this session
    let currentCompleted = new Set<string>();
    if (userSettingsRepo) {
      try {
        const saved = await userSettingsRepo.get(`active_completed_set_ids_${workoutId}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            currentCompleted = new Set(parsed);
            setCompletedSetIds(currentCompleted);
          }
        }
      } catch {
        // Non-critical cache error fallback
      }
    }

    // Fetch ghost sets for each unique exercise
    const uniqueExerciseIds = Array.from(new Set(session.sets.map((s) => s.exercise_id)));
    const ghostMap = new Map<string, WorkoutSet[]>();

    await Promise.all(
      uniqueExerciseIds.map(async (exId) => {
        const ghosts = await sessionService.getGhostSetsForExercise(exId);
        ghostMap.set(exId, ghosts);
      })
    );

    setGhostSetsByExercise(ghostMap);

    // Independent multi-card expansion: Expand all exercises in the workout by default
    setExpandedExerciseIds((prev) => {
      const next = new Set(prev);
      uniqueExerciseIds.forEach((id) => next.add(id));
      return next;
    });

    // Evaluate Progression Rules if programRepo and template_id are present (Step 4.4)
    if (programRepo && session.workout.template_id) {
      try {
        const templateDetail = await programRepo.getTemplateWithDetails(session.workout.template_id);
        if (templateDetail && templateDetail.exercises) {
          for (const tex of templateDetail.exercises) {
            if (tex.rules && tex.rules.length > 0) {
              const historicalSets = await workoutRepo.getHistoricalSetsForExercise(tex.exercise_id, {
                onlyCompletedWorkouts: true,
              });
              const sessionSetsMap = new Map<string, WorkoutSet[]>();
              for (const hs of historicalSets) {
                if (!sessionSetsMap.has(hs.workout_id)) {
                  sessionSetsMap.set(hs.workout_id, []);
                }
                sessionSetsMap.get(hs.workout_id)!.push(hs);
              }
              const recentSessions = Array.from(sessionSetsMap.entries()).map(([wId, wSets]) => ({
                id: wId,
                date: wSets[0]?.created_at?.split('T')[0] || '',
                sets: wSets,
              }));

              const result = evaluateProgressionRules(tex.rules, recentSessions, tex);
              if (result.primaryProposal) {
                const exName = currentExerciseMap.get(tex.exercise_id)?.name ?? 'Prescribed Movement';
                setActiveProposal({
                  proposal: result.primaryProposal,
                  exerciseName: exName,
                  templateExerciseId: tex.id,
                  exerciseId: tex.exercise_id,
                });
                break;
              }
            }
          }
        }
      } catch (err) {
        console.warn('Failed to evaluate progression rules in active logger:', err);
      }
    }
  };

  // Resynchronize rest timer when returning from background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        timerService.syncWithWallClock();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [timerService]);

  // Crash Recovery Actions
  const handleResumeCrashSession = async (workoutId: string) => {
    setShowRecoveryDialog(false);
    setLoading(true);
    await loadWorkout(workoutId);
    setLoading(false);
  };

  const handleDiscardCrashSession = async (workoutId: string) => {
    setShowRecoveryDialog(false);
    await recoveryService.discardSession(workoutId);
    if (onDiscardSession) {
      onDiscardSession();
    } else {
      // Start fresh session
      const fresh = await sessionService.startWorkout();
      await loadWorkout(fresh.id);
    }
  };

  // Progression Proposal Actions (Step 4.4)
  const handleAcceptProgressionProposal = async (proposal: ProgressionProposal) => {
    if (!activeProposal) return;
    try {
      const targetExId = activeProposal.exerciseId;
      if (targetExId) {
        const targetSets = sets.filter((s) => s.exercise_id === targetExId && !completedSetIds.has(s.id));
        if (proposal.setProposals && proposal.setProposals.length > 0) {
          for (const sp of proposal.setProposals) {
            const setObj =
              targetSets[sp.setIndex - 1] ||
              sets.find((s) => s.exercise_id === targetExId && s.set_number === sp.setIndex);
            if (setObj) {
              await handleUpdateSet(setObj.id, {
                raw_input_weight: sp.suggestedWeightKg ?? setObj.raw_input_weight,
              });
            }
          }
        } else if (proposal.suggestedWeightKg !== undefined) {
          for (const s of targetSets) {
            await handleUpdateSet(s.id, {
              raw_input_weight: proposal.suggestedWeightKg,
              reps: proposal.suggestedTargetReps !== undefined ? proposal.suggestedTargetReps : s.reps,
            });
          }
        }
      }
    } catch (err) {
      console.warn('Error applying progression proposal:', err);
    } finally {
      setActiveProposal(null);
    }
  };

  const handleDismissProgressionProposal = () => {
    setActiveProposal(null);
  };

  // Add Set to Exercise
  const handleAddSet = async (exerciseId: string) => {
    if (!activeWorkout) return;
    const exerciseSets = sets.filter((s) => s.exercise_id === exerciseId);
    const lastSet = exerciseSets[exerciseSets.length - 1];

    const ghostSets = ghostSetsByExercise.get(exerciseId) || [];
    const nextSetNumber = exerciseSets.length + 1;
    const ghostForSet = ghostSets.find((g) => g.set_number === nextSetNumber);

    const defaultWeight = lastSet ? lastSet.raw_input_weight : (ghostForSet ? ghostForSet.raw_input_weight : 0);
    const defaultReps = lastSet ? lastSet.reps : (ghostForSet ? ghostForSet.reps : 10);
    // Optional intensity: copy from last set of this exercise if set, otherwise start null
    const defaultRpe = lastSet ? (lastSet.rpe ?? null) : null;
    const defaultRir = lastSet ? (lastSet.rir ?? null) : null;

    const newSet = await sessionService.addSet(activeWorkout.id, {
      exerciseId,
      rawInputWeight: defaultWeight,
      reps: defaultReps,
      rpe: defaultRpe,
      rir: defaultRir,
      gearId: lastSet?.gear_id ?? null,
      exerciseGroupId: lastSet?.exercise_group_id ?? null,
    });

    setSets((prev) => [...prev, newSet]);
    setExpandedSetId(newSet.id);
  };

  // Generate Warmup Sets for Exercise (Warm_up_estimator.md)
  const handleGenerateWarmupSets = async (exerciseId: string) => {
    if (!activeWorkout) return;
    const createdWarmupSets = await sessionService.generateWarmupSetsForExercise(
      activeWorkout.id,
      exerciseId
    );
    if (createdWarmupSets.length > 0) {
      const updatedSets = await sessionService.getWorkoutSets(activeWorkout.id);
      setSets(updatedSets);
      setExpandedExerciseIds((prev) => new Set(prev).add(exerciseId));
    }
  };

  // Update Set
  const handleUpdateSet = useCallback(
    async (setId: string, updatedFields: Partial<WorkoutSet>) => {
      if (!activeWorkout) return;

      // Optimistic UI update
      setSets((prev) =>
        prev.map((s) => (s.id === setId ? { ...s, ...updatedFields } : s))
      );

      try {
        const persisted = await sessionService.updateSet(activeWorkout.id, setId, {
          rawInputWeight: updatedFields.raw_input_weight,
          reps: updatedFields.reps,
          repsRight: updatedFields.reps_right,
          rpe: updatedFields.rpe,
          rir: updatedFields.rir,
          setType: updatedFields.set_type,
          setNotes: updatedFields.set_notes,
          gearId: updatedFields.gear_id,
        });

        setSets((prev) => prev.map((s) => (s.id === setId ? persisted : s)));
      } catch (err) {
        console.error('Failed to update set:', err);
      }
    },
    [activeWorkout, sessionService]
  );

  // Switch gear/implement for all sets of an exercise in the active session (ADR-025)
  const handleSelectGearForExercise = async (exerciseId: string, selectedGearId: string | null) => {
    if (!activeWorkout) return;
    try {
      const exerciseSets = sets.filter((s) => s.exercise_id === exerciseId);
      for (const set of exerciseSets) {
        await handleUpdateSet(set.id, { gear_id: selectedGearId });
      }
    } catch (err) {
      console.error('Failed to update gear for exercise sets:', err);
    } finally {
      setGearPickerExercise(null);
    }
  };

  // Delete Set
  const handleDeleteSet = async (setId: string) => {
    if (!activeWorkout) return;
    await sessionService.deleteSet(activeWorkout.id, setId);
    const refreshed = await sessionService.getActiveWorkout(activeWorkout.id);
    if (refreshed) {
      setSets(refreshed.sets);
      setCompletedSetIds((prev) => {
        const next = new Set(prev);
        next.delete(setId);
        if (userSettingsRepo && activeWorkout) {
          userSettingsRepo
            .set(`active_completed_set_ids_${activeWorkout.id}`, JSON.stringify(Array.from(next)))
            .catch(() => {});
        }
        return next;
      });
    }
  };

  // Toggle Set Complete (1-Tap Completion, Auto-Advance & Rest Timer Trigger)
  const handleToggleCompleteSet = (targetSet: WorkoutSet) => {
    const isNowCompleted = !completedSetIds.has(targetSet.id);
    const nextCompleted = new Set(completedSetIds);

    if (isNowCompleted) {
      nextCompleted.add(targetSet.id);
    } else {
      nextCompleted.delete(targetSet.id);
    }
    setCompletedSetIds(nextCompleted);

    if (userSettingsRepo && activeWorkout) {
      userSettingsRepo
        .set(`active_completed_set_ids_${activeWorkout.id}`, JSON.stringify(Array.from(nextCompleted)))
        .catch(() => {});
    }

    if (isNowCompleted) {
      // Auto-advance hybrid: Check if ALL sets of this exercise are now completed
      const thisExSets = sets.filter((s) => s.exercise_id === targetSet.exercise_id);
      const isThisExAllCompleted =
        thisExSets.length > 0 && thisExSets.every((s) => nextCompleted.has(s.id));

      if (isThisExAllCompleted) {
        // Find next exercise with incomplete sets
        const distinctExIds = Array.from(new Set(sets.map((s) => s.exercise_id)));
        const currentIndex = distinctExIds.indexOf(targetSet.exercise_id);
        let nextExId: string | null = null;

        for (let i = 1; i < distinctExIds.length; i++) {
          const candidateId = distinctExIds[(currentIndex + i) % distinctExIds.length];
          const candidateSets = sets.filter((s) => s.exercise_id === candidateId);
          const hasIncomplete = candidateSets.some((s) => !nextCompleted.has(s.id));
          if (hasIncomplete) {
            nextExId = candidateId;
            break;
          }
        }

        if (nextExId) {
          setExpandedExerciseIds((prev) => new Set(prev).add(nextExId!));
        }
      }

      // ADR-009: Check if inside a superset group
      const exercise = exerciseMap.get(targetSet.exercise_id);
      const isGrouped = !!targetSet.exercise_group_id;

      let shouldStartTimer = true;
      if (isGrouped && targetSet.exercise_group_id) {
        // Collect ordered list of distinct exercise IDs belonging to this superset group
        const groupExerciseIds: string[] = [];
        for (const s of sets) {
          if (
            s.exercise_group_id === targetSet.exercise_group_id &&
            !groupExerciseIds.includes(s.exercise_id)
          ) {
            groupExerciseIds.push(s.exercise_id);
          }
        }
        // Rest timer suppressed between exercises inside superset group; triggers only after final exercise in group
        shouldStartTimer = RestTimerService.shouldTriggerForExerciseInGroup(
          targetSet.exercise_id,
          groupExerciseIds
        );
      }

      // Phase 2: Rest Timer Triggers by Set Type
      // - Drop set: 0s rest (suppress timer and reset/dismiss any active timer)
      // - Myo set: 10s rest
      // - DC set: 30s rest
      // - Working & Warmup sets: exercise default_rest_seconds or 90s fallback (respecting superset rules)
      if (targetSet.set_type === 'drop') {
        timerService.reset();
      } else if (targetSet.set_type === 'myorep') {
        if (exercise) {
          timerService.start(10, {
            exerciseId: exercise.id,
            exerciseGroupId: targetSet.exercise_group_id,
          });
        }
      } else if (targetSet.set_type === 'dc') {
        if (exercise) {
          timerService.start(30, {
            exerciseId: exercise.id,
            exerciseGroupId: targetSet.exercise_group_id,
          });
        }
      } else if (shouldStartTimer && exercise) {
        const restDuration = exercise.default_rest_seconds || 90;
        timerService.start(restDuration, {
          exerciseId: exercise.id,
          exerciseGroupId: targetSet.exercise_group_id,
        });
      }
    }
  };

  // 1-Tap Exercise Accordion Selection (Independent Multi-Card Expansion)
  const handleSelectExercise = (exerciseId: string) => {
    setExpandedExerciseIds((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) {
        next.delete(exerciseId);
      } else {
        next.add(exerciseId);
      }
      return next;
    });
  };

  // Open Plate Calculator Modal
  const handleOpenPlateCalc = (set: WorkoutSet, exercise: Exercise) => {
    const gear = set.gear_id ? gearMap.get(set.gear_id) : null;
    const barTare = gear?.tare_weight_kg ?? exercise.default_bar_weight_kg ?? 20.0;

    setPlateModalTarget({
      visible: true,
      weightKg: set.raw_input_weight > 0 ? set.raw_input_weight : barTare,
      barTareKg: barTare,
      exerciseName: exercise.name,
      gearName: gear?.name ?? null,
      targetSetId: set.id,
    });
  };

  // Apply Weight from Plate Calculator
  const handleApplyPlateWeight = (weightKg: number) => {
    if (plateModalTarget.targetSetId) {
      handleUpdateSet(plateModalTarget.targetSetId, { raw_input_weight: weightKg });
    }
  };

  // Open Substitution Modal
  const handleOpenSubstitution = (exercise: Exercise) => {
    setSubModalTarget({
      visible: true,
      exercise,
    });
  };

  // Apply Exercise Substitution
  const handleApplySubstitution = async (
    newExercise: Exercise,
    swapScope: 'session_only' | 'permanent_template'
  ) => {
    if (!activeWorkout || !subModalTarget.exercise) return;

    await subService.applySubstitution({
      workoutId: activeWorkout.id,
      oldExerciseId: subModalTarget.exercise.id,
      newExerciseId: newExercise.id,
      swapScope,
      templateId: activeWorkout.template_id,
    });

    // Refresh workout
    await loadWorkout(activeWorkout.id);
  };

  // Open Pain Report Modal
  const handleOpenPainReport = (exercise: Exercise) => {
    setPainModalTarget({
      visible: true,
      exercise,
    });
  };

  // Close Pain Report Modal
  const handleClosePainReport = () => {
    setPainModalTarget({
      visible: false,
      exercise: null,
    });
  };

  // Submit Pain Report and Execute Guardrail Logic
  const handleSubmitPainReport = async ({
    painType,
    severity,
    jointLocation,
    notes,
    shouldSkipRemainingSets,
  }: {
    painType: 'joint' | 'muscle';
    severity: number;
    jointLocation?: any;
    notes?: string;
    shouldSkipRemainingSets: boolean;
  }) => {
    if (!activeWorkout || !painModalTarget.exercise) return;
    const targetExercise = painModalTarget.exercise;

    // 1. Persist pain report to database if repository available
    if (painReportRepo) {
      await painReportRepo.create({
        workout_id: activeWorkout.id,
        exercise_id: targetExercise.id,
        pain_type: painType,
        severity,
        joint_location: jointLocation ?? null,
        notes,
      });
    }

    setPainModalTarget({ visible: false, exercise: null });

    // 2. If severity > 6, skip all remaining uncompleted sets for this exercise
    if (shouldSkipRemainingSets) {
      const uncompletedSets = sets.filter(
        (s) => s.exercise_id === targetExercise.id && !completedSetIds.has(s.id)
      );

      for (const uncompletedSet of uncompletedSets) {
        await sessionService.deleteSet(activeWorkout.id, uncompletedSet.id);
      }

      // Refresh workout sets
      await loadWorkout(activeWorkout.id);

      // Auto-advance accordion to next exercise with incomplete sets
      const distinctExIds = Array.from(new Set(sets.map((s) => s.exercise_id)));
      const currentIndex = distinctExIds.indexOf(targetExercise.id);
      let nextExId: string | null = null;

      for (let i = 1; i < distinctExIds.length; i++) {
        const candidateId = distinctExIds[(currentIndex + i) % distinctExIds.length];
        if (candidateId === targetExercise.id) continue;
        const candidateSets = sets.filter(
          (s) => s.exercise_id === candidateId && !completedSetIds.has(s.id)
        );
        if (candidateSets.length > 0) {
          nextExId = candidateId;
          break;
        }
      }

      if (nextExId) {
        setExpandedExerciseIds((prev) => new Set(prev).add(nextExId!));
      }

      setPainAlertBanner(
        `Skipped ${uncompletedSets.length} remaining set(s) on ${targetExercise.name} due to severe pain score (${severity}/10).`
      );
      setTimeout(() => setPainAlertBanner(null), 6000);
    }
  };

  // Add Exercise from Catalog
  const handleAddExerciseToWorkout = async (exercise: Exercise) => {
    if (!activeWorkout) return;
    setShowAddExerciseModal(false);
    setExerciseSearchQuery('');

    // Add first set for this exercise
    const ghostSets = await sessionService.getGhostSetsForExercise(exercise.id);
    const firstGhost = ghostSets[0];

    const initialWeight = firstGhost ? firstGhost.raw_input_weight : (exercise.default_bar_weight_kg || 20);
    const initialReps = firstGhost ? firstGhost.reps : 10;

    await sessionService.addSet(activeWorkout.id, {
      exerciseId: exercise.id,
      rawInputWeight: initialWeight,
      reps: initialReps,
      rpe: 8.0,
    });

    // Automated Warm-Up Synthesis (Phase 3)
    if (
      autoWarmupMode === 'all_exercises' ||
      (autoWarmupMode === 'smart_compounds' && exercise.is_compound)
    ) {
      await sessionService.generateWarmupSetsForExercise(activeWorkout.id, exercise.id, {
        targetWorkingWeightKg: initialWeight,
      });
    }

    setExpandedExerciseIds((prev) => new Set(prev).add(exercise.id));
    await loadWorkout(activeWorkout.id);
  };

  // Finish Workout
  const handleConfirmFinish = async () => {
    if (!activeWorkout) return;
    setShowFinishConfirmModal(false);
    timerService.skip();

    const uncompletedSets = sets.filter((s) => !completedSetIds.has(s.id));

    if (uncompletedSets.length > 0) {
      if (markIncompleteAsComplete) {
        // Mark remaining sets as completed
        const nextCompleted = new Set(completedSetIds);
        uncompletedSets.forEach((s) => nextCompleted.add(s.id));
        setCompletedSetIds(nextCompleted);
      } else {
        // Exclude uncompleted sets by deleting them from SQLite before final ledger commit
        for (const uncompletedSet of uncompletedSets) {
          await sessionService.deleteSet(activeWorkout.id, uncompletedSet.id);
        }
      }
    }

    if (userSettingsRepo) {
      await userSettingsRepo.delete(`active_completed_set_ids_${activeWorkout.id}`).catch(() => {});
    }

    const finished = await sessionService.finishWorkout(activeWorkout.id, {
      notes: finishNotes.trim() === '' ? activeWorkout.notes : finishNotes.trim(),
    });

    setFinishedWorkoutObj(finished);
    setSummaryWorkoutId(finished.id);
  };

  // Discard Workout
  const handleDiscardCurrentWorkout = async () => {
    if (!activeWorkout) return;
    timerService.skip();
    if (userSettingsRepo) {
      await userSettingsRepo.delete(`active_completed_set_ids_${activeWorkout.id}`).catch(() => {});
    }
    await sessionService.discardWorkout(activeWorkout.id);
    if (onDiscardSession) {
      onDiscardSession();
    }
  };

  // Group sets by exercise
  const exercisesWithSets = useMemo(() => {
    const map = new Map<string, WorkoutSet[]>();
    for (const s of sets) {
      const arr = map.get(s.exercise_id) || [];
      arr.push(s);
      map.set(s.exercise_id, arr);
    }

    return Array.from(map.entries()).map(([exerciseId, exerciseSets]) => {
      const exercise = exerciseMap.get(exerciseId) || {
        id: exerciseId,
        name: 'Unknown Exercise',
        muscle_group: 'Other',
        category: 'Other',
        is_compound: false,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 20.0,
        is_custom: false,
        parent_exercise_id: null,
        standard_lift_type: null,
        default_rest_seconds: 90,
      } as Exercise;

      return {
        exercise,
        sets: exerciseSets.sort((a, b) => a.set_number - b.set_number),
      };
    });
  }, [sets, exerciseMap]);

  // Open Superset Pairing Modal
  const handleOpenSupersetModal = (exercise: Exercise) => {
    setSupersetSourceExercise(exercise);
    setShowSupersetModal(true);
  };

  // Confirm Superset Pairing
  const handleConfirmPairExercises = async (targetExerciseId: string) => {
    if (!activeWorkout || !supersetSourceExercise) return;
    setShowSupersetModal(false);
    await sessionService.groupExercises(activeWorkout.id, [
      supersetSourceExercise.id,
      targetExerciseId,
    ]);
    await loadWorkout(activeWorkout.id);
  };

  // Ungroup Superset
  const handleUngroupSuperset = async (groupId: string) => {
    if (!activeWorkout) return;
    await sessionService.ungroupSuperset(activeWorkout.id, groupId);
    await loadWorkout(activeWorkout.id);
  };

  // Ungroup Single Exercise
  const handleUngroupExercise = async (exerciseId: string) => {
    if (!activeWorkout) return;
    await sessionService.ungroupExercise(activeWorkout.id, exerciseId);
    await loadWorkout(activeWorkout.id);
  };

  // Exercises available to pair into a superset with the currently selected exercise
  const availableExercisesToPair = useMemo(() => {
    if (!supersetSourceExercise) return [];
    const currentWorkoutExIds = Array.from(new Set(sets.map((s) => s.exercise_id)));
    return currentWorkoutExIds
      .filter((id) => id !== supersetSourceExercise.id)
      .map((id) => exerciseMap.get(id))
      .filter((e): e is Exercise => !!e);
  }, [supersetSourceExercise, sets, exerciseMap]);

  type RenderableWorkoutItem =
    | { type: 'single'; exercise: Exercise; sets: WorkoutSet[] }
    | { type: 'superset'; groupId: string; items: { exercise: Exercise; sets: WorkoutSet[] }[] };

  const renderableWorkoutItems = useMemo<RenderableWorkoutItem[]>(() => {
    const result: RenderableWorkoutItem[] = [];
    const processedExerciseIds = new Set<string>();

    for (const item of exercisesWithSets) {
      if (processedExerciseIds.has(item.exercise.id)) continue;

      const groupId = item.sets[0]?.exercise_group_id;
      if (groupId) {
        // Collect all exercises belonging to this group
        const groupItems = exercisesWithSets.filter(
          (other) => other.sets[0]?.exercise_group_id === groupId
        );
        groupItems.forEach((g) => processedExerciseIds.add(g.exercise.id));
        result.push({
          type: 'superset',
          groupId,
          items: groupItems,
        });
      } else {
        processedExerciseIds.add(item.exercise.id);
        result.push({
          type: 'single',
          exercise: item.exercise,
          sets: item.sets,
        });
      }
    }

    return result;
  }, [exercisesWithSets]);

  const renderExerciseCard = (exercise: Exercise, exSets: WorkoutSet[]) => {
    const ghostSets = ghostSetsByExercise.get(exercise.id) || [];
    const isDumbbell = exercise.load_mode === 'per_hand';
    const firstSetGearId = exSets[0]?.gear_id;
    const gear = firstSetGearId ? gearMap.get(firstSetGearId) : null;
    const isGrouped = !!exSets[0]?.exercise_group_id;
    const isExpanded = expandedExerciseIds.has(exercise.id);
    const isAllSetsCompleted = exSets.length > 0 && exSets.every((s) => completedSetIds.has(s.id));

    // Warm-up Sub-collapsing (Phase 4)
    const warmupSets = exSets.filter((s) => s.set_type === 'warmup');
    const completedWarmups = warmupSets.filter((s) => completedSetIds.has(s.id));
    const isWarmupsExpanded = expandedWarmupExercises.has(exercise.id);
    const shouldSubCollapseWarmups = completedWarmups.length >= 2 && !isWarmupsExpanded;

    const setsToRender = shouldSubCollapseWarmups
      ? exSets.filter((s) => s.set_type !== 'warmup' || !completedSetIds.has(s.id))
      : exSets;

    return (
      <View
        key={exercise.id}
        testID={`exercise-card-${exercise.id}`}
        onLayout={(e) => {
          cardOffsetsRef.current[exercise.id] = e.nativeEvent.layout.y;
        }}
        style={[
          styles.exerciseCard,
          isGrouped && styles.groupedExerciseCard,
          !isExpanded && isAllSetsCompleted && styles.completedExerciseCard,
        ]}
      >
        {/* Exercise Header - 1-Tap Expand / Switch */}
        <TouchableOpacity
          testID={`exercise-card-header-${exercise.id}`}
          style={[
            styles.exerciseCardHeader,
            !isExpanded && isAllSetsCompleted && styles.completedExerciseCardHeader,
          ]}
          onPress={() => handleSelectExercise(exercise.id)}
          activeOpacity={0.8}
        >
          <View style={styles.exerciseTitleCol}>
            <View style={styles.exerciseTitleRow}>
              <Text
                style={[
                  styles.exerciseNameText,
                  !isExpanded && isAllSetsCompleted && styles.completedExerciseNameText,
                ]}
              >
                {exercise.name}
              </Text>
              {isDumbbell && (
                <View testID="dumbbell-header-badge" style={styles.dumbbellHeaderBadge}>
                  <Text style={styles.dumbbellHeaderBadgeText}>Dumbbell (×2)</Text>
                </View>
              )}
              {isGrouped && (
                <View style={styles.supersetBadge}>
                  <Text style={styles.supersetBadgeText}>SUPERSET</Text>
                </View>
              )}
            </View>

            {/* Gear Subtext Indicator & 1-Tap Implement Switcher (ADR-025) */}
            {exercise.category === 'Barbell' || exercise.category === 'Cable' || gear ? (
              <TouchableOpacity
                testID={`change-gear-button-${exercise.id}`}
                style={styles.gearPillBtn}
                onPress={() => setGearPickerExercise(exercise)}
                activeOpacity={0.7}
              >
                <Text testID="gear-subtext-indicator" style={styles.gearSubtextInteractive}>
                  ⚙ {gear
                    ? `${gear.name} (${gear.tare_weight_kg} kg bar) ▾`
                    : exercise.category === 'Barbell'
                    ? `${exercise.default_bar_weight_kg || 20} kg Bar ▾`
                    : exercise.default_cable_ratio !== 1.0
                    ? `Cable Pulley (${exercise.default_cable_ratio}:1) ▾`
                    : 'Standard Cable (1:1) ▾'}
                </Text>
              </TouchableOpacity>
            ) : null}

            {/* SFR Warning Badge (ADR-072 / Phase 6) */}
            {(() => {
              const cp = calibratedParamsMap.get(exercise.id);
              if (cp?.sfr_tier === 'POOR_SWAP_RECOMMENDED') {
                return (
                  <TouchableOpacity
                    testID={`sfr-warning-badge-${exercise.id}`}
                    style={styles.sfrWarningBadge}
                    onPress={() => handleOpenSubstitution(exercise)}
                    accessibilityLabel={`Low stimulus-to-fatigue ratio warning. Tap to swap ${exercise.name}`}
                  >
                    <Text style={styles.sfrWarningBadgeText}>⚠️ LOW SFR • SWAP RECOMMENDED</Text>
                  </TouchableOpacity>
                );
              }
              return null;
            })()}
          </View>

          <View style={styles.headerRightActions}>
            {/* Superset Group / Ungroup Action Button */}
            {isGrouped ? (
              <TouchableOpacity
                testID={`ungroup-exercise-button-${exercise.id}`}
                style={styles.unlinkButton}
                onPress={() => handleUngroupExercise(exercise.id)}
                accessibilityLabel={`Unlink ${exercise.name} from superset`}
              >
                <Text style={styles.unlinkButtonText}>UNLINK</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                testID={`group-superset-button-${exercise.id}`}
                style={styles.linkButton}
                onPress={() => handleOpenSupersetModal(exercise)}
                accessibilityLabel={`Link ${exercise.name} into a superset`}
              >
                <Text style={styles.linkButtonText}>+ LINK</Text>
              </TouchableOpacity>
            )}

            {/* 1-Tap Exercise Swap Action (ADR-023) */}
            <TouchableOpacity
              testID={`swap-exercise-button-${exercise.id}`}
              style={styles.swapButton}
              onPress={() => handleOpenSubstitution(exercise)}
              accessibilityLabel={`Swap ${exercise.name}`}
            >
              <Text style={styles.swapButtonText}>SWAP</Text>
            </TouchableOpacity>

            {/* In-Gym Pain Report Action */}
            <TouchableOpacity
              testID={`report-pain-button-${exercise.id}`}
              style={styles.painButton}
              onPress={() => handleOpenPainReport(exercise)}
              accessibilityLabel={`Report pain for ${exercise.name}`}
            >
              <Text style={styles.painButtonText}>🩹 PAIN</Text>
            </TouchableOpacity>

            <Text
              style={[
                styles.expandChevron,
                !isExpanded && isAllSetsCompleted && styles.completedExpandChevron,
              ]}
            >
              {isExpanded ? '▼' : '▶'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Show Table and Sets ONLY if expanded */}
        {isExpanded && (
          <View testID={`exercise-card-body-${exercise.id}`}>
            {/* Sets Table Header Columns */}
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCol, { minWidth: 46, marginRight: 6, textAlign: 'center' }]}>SET</Text>
              <Text style={[styles.tableHeaderCol, { flex: 1, marginRight: 6 }]}>PREV</Text>
              <Text style={[styles.tableHeaderCol, { minWidth: 68, marginRight: 6, textAlign: 'center' }]}>
                {unitSystem.toUpperCase()}
              </Text>
              <Text style={[styles.tableHeaderCol, { minWidth: 48, marginRight: 6, textAlign: 'center' }]}>
                {exercise.is_unilateral ? 'L / R' : 'REPS'}
              </Text>
              <Text style={[styles.tableHeaderCol, { minWidth: 48, marginRight: 4, textAlign: 'center' }]}>
                {intensityMetric}
              </Text>
              <Text style={[styles.tableHeaderCol, { width: 24, marginRight: 4 }]} />
              <Text style={[styles.tableHeaderCol, { width: 38, textAlign: 'center' }]}>✓</Text>
            </View>

            {/* Sub-Collapsed Completed Warm-Up Sets Banner (Phase 4) */}
            {shouldSubCollapseWarmups && (
              <TouchableOpacity
                testID={`toggle-warmups-${exercise.id}`}
                style={styles.completedWarmupsBanner}
                onPress={() => {
                  setExpandedWarmupExercises((prev) => new Set(prev).add(exercise.id));
                }}
                accessibilityLabel={`Show ${completedWarmups.length} completed warm-up sets for ${exercise.name}`}
              >
                <Text style={styles.completedWarmupsBannerText}>
                  ✓ {completedWarmups.length} Warm-up Sets Completed (Tap to show)
                </Text>
              </TouchableOpacity>
            )}

            {isWarmupsExpanded && completedWarmups.length >= 2 && (
              <TouchableOpacity
                testID={`collapse-warmups-${exercise.id}`}
                style={styles.collapseWarmupsBanner}
                onPress={() => {
                  setExpandedWarmupExercises((prev) => {
                    const next = new Set(prev);
                    next.delete(exercise.id);
                    return next;
                  });
                }}
                accessibilityLabel={`Hide completed warm-up sets for ${exercise.name}`}
              >
                <Text style={styles.collapseWarmupsBannerText}>
                  ▴ Hide Completed Warm-up Sets
                </Text>
              </TouchableOpacity>
            )}

            {/* Set Rows */}
            {setsToRender.map((s) => {
              const ghostSet = ghostSets.find((g) => g.set_number === s.set_number) || null;
              const isCompleted = completedSetIds.has(s.id);

              return (
                <SetRowComponent
                  key={s.id}
                  set={s}
                  exercise={exercise}
                  ghostSet={ghostSet}
                  unitSystem={unitSystem}
                  intensityMetric={intensityMetric}
                  isCompleted={isCompleted}
                  isExpanded={expandedSetId === s.id}
                  onToggleExpand={() =>
                    setExpandedSetId((prev) => (prev === s.id ? null : s.id))
                  }
                  onUpdateSet={(fields) => handleUpdateSet(s.id, fields)}
                  onDeleteSet={() => handleDeleteSet(s.id)}
                  onToggleComplete={() => handleToggleCompleteSet(s)}
                  onOpenPlateCalculator={() => handleOpenPlateCalc(s, exercise)}
                />
              );
            })}

            {/* Add Set & Warm-up Buttons */}
            <View style={styles.setActionButtonRow}>
              <TouchableOpacity
                testID={`add-set-button-${exercise.id}`}
                style={styles.addSetButton}
                onPress={() => handleAddSet(exercise.id)}
                accessibilityLabel={`Add set to ${exercise.name}`}
              >
                <Text style={styles.addSetButtonText}>+ ADD SET</Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID={`generate-warmup-button-${exercise.id}`}
                style={styles.addWarmupButton}
                onPress={() => handleGenerateWarmupSets(exercise.id)}
                accessibilityLabel={`Generate warm-up sets for ${exercise.name}`}
              >
                <Text style={styles.addWarmupButtonText}>⚡ WARM-UP</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#00E676" />
        <Text style={styles.loadingText}>Loading training ledger...</Text>
      </View>
    );
  }

  return (
    <View testID="active-logger-screen" style={styles.screen}>
      {/* Sticky Top Header */}
      <View style={styles.headerBar}>
        <View style={styles.headerTitleSection}>
          <Text testID="active-workout-name" style={styles.headerWorkoutTitle} numberOfLines={1}>
            {activeWorkout?.name || 'Active Session'}
          </Text>
          <View style={styles.headerSubRow}>
            <View style={styles.livePulseDot} />
            <WorkoutDurationTicker
              startedAt={activeWorkout?.started_at}
              style={styles.headerTicker}
            />
            <Text style={styles.headerUnitPill}>{unitSystem.toUpperCase()} / {intensityMetric}</Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            testID="finish-workout-header-button"
            style={styles.finishHeaderButton}
            onPress={() => {
              setMarkIncompleteAsComplete(false);
              setShowFinishConfirmModal(true);
            }}
            accessibilityLabel="Finish workout"
          >
            <Text style={styles.finishHeaderButtonText}>FINISH</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Embedded Progression Proposal Banner (Step 4.4) */}
      <ProgressionProposalBanner
        proposal={activeProposal?.proposal ?? null}
        exerciseName={activeProposal?.exerciseName}
        onAccept={handleAcceptProgressionProposal}
        onDismiss={handleDismissProgressionProposal}
      />

      {/* Dynamic Pain Alert Banner */}
      {painAlertBanner && (
        <View testID="pain-alert-banner" style={styles.painAlertBanner}>
          <Text style={styles.painAlertBannerText}>⚠️ {painAlertBanner}</Text>
        </View>
      )}

      {/* Main Exercise & Sets Scrollable List */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {renderableWorkoutItems.map((item) => {
          if (item.type === 'superset') {
            return (
              <SupersetBracketGroup
                key={item.groupId}
                groupId={item.groupId}
                exercises={item.items.map((i) => i.exercise)}
                onUngroup={handleUngroupSuperset}
              >
                {item.items.map(({ exercise, sets: exSets }) =>
                  renderExerciseCard(exercise, exSets)
                )}
              </SupersetBracketGroup>
            );
          }
          return renderExerciseCard(item.exercise, item.sets);
        })}

        {/* Add Exercise Floating Action / Footer Button */}
        <TouchableOpacity
          testID="add-exercise-button"
          style={styles.addExerciseButton}
          onPress={() => setShowAddExerciseModal(true)}
        >
          <Text style={styles.addExerciseButtonText}>+ ADD EXERCISE</Text>
        </TouchableOpacity>

        {/* Discard Session Link */}
        <TouchableOpacity
          testID="discard-workout-footer-button"
          style={styles.discardFooterButton}
          onPress={handleDiscardCurrentWorkout}
        >
          <Text style={styles.discardFooterText}>Discard Workout</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Docked Rest Timer Banner (ADR-009 / Phase 4) */}
      <RestTimerBanner timerService={timerService} />

      {/* Implement / Bar Selection Modal (ADR-025) */}
      {gearPickerExercise && (
        <Modal
          visible={!!gearPickerExercise}
          transparent
          animationType="fade"
          onRequestClose={() => setGearPickerExercise(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.gearPickerModalContent}>
              <View style={styles.gearPickerHeader}>
                <Text style={styles.gearPickerTitle}>
                  Select Implement: {gearPickerExercise.name}
                </Text>
                <TouchableOpacity
                  testID="gear-picker-close-btn"
                  onPress={() => setGearPickerExercise(null)}
                >
                  <Text style={styles.closeText}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 350 }}>
                {/* Default option */}
                <TouchableOpacity
                  testID="select-gear-default"
                  style={styles.gearOptionRow}
                  onPress={() => handleSelectGearForExercise(gearPickerExercise.id, null)}
                >
                  <Text style={styles.gearOptionName}>
                    {gearPickerExercise.category === 'Barbell'
                      ? `Standard Bar (${gearPickerExercise.default_bar_weight_kg || 20} kg)`
                      : `Standard Cable (${gearPickerExercise.default_cable_ratio || 1.0}:1)`}
                  </Text>
                  <Text style={styles.gearOptionSubtext}>Default Catalog Implement</Text>
                </TouchableOpacity>

                {/* Inventory gear options */}
                {Array.from(gearMap.values())
                  .filter((g) => {
                    if (gearPickerExercise.category === 'Barbell') {
                      return g.type === 'barbell' || g.type === 'specialty_bar';
                    }
                    if (gearPickerExercise.category === 'Cable') {
                      return g.type === 'cable_machine';
                    }
                    return true;
                  })
                  .map((g) => (
                    <TouchableOpacity
                      key={g.id}
                      testID={`select-gear-${g.id}`}
                      style={styles.gearOptionRow}
                      onPress={() => handleSelectGearForExercise(gearPickerExercise.id, g.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.gearOptionName}>{g.name}</Text>
                        <Text style={styles.gearOptionSubtext}>
                          {g.type === 'cable_machine'
                            ? `Pulley Ratio: ${g.cable_ratio}:1`
                            : `Tare Weight: ${g.tare_weight_kg} kg bar`}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* Plate Calculator Popover Modal */}
      <PlateCalculatorModal
        visible={plateModalTarget.visible}
        initialWeightKg={plateModalTarget.weightKg}
        initialBarTareKg={plateModalTarget.barTareKg}
        exerciseName={plateModalTarget.exerciseName}
        gearName={plateModalTarget.gearName}
        onApplyWeight={handleApplyPlateWeight}
        onClose={() => setPlateModalTarget((p) => ({ ...p, visible: false }))}
      />

      {/* Exercise Substitution Popover Modal */}
      {subModalTarget.exercise && activeWorkout && (
        <ExerciseSubstitutionModal
          visible={subModalTarget.visible}
          currentExercise={subModalTarget.exercise}
          workoutId={activeWorkout.id}
          templateId={activeWorkout.template_id}
          substitutionService={subService}
          exerciseRepo={exerciseRepo}
          onApplySubstitution={handleApplySubstitution}
          onClose={() => setSubModalTarget({ visible: false, exercise: null })}
        />
      )}

      {/* Pain & Discomfort Report Modal */}
      {painModalTarget.visible && (
        <PainReportModal
          visible={painModalTarget.visible}
          exercise={painModalTarget.exercise}
          workoutId={activeWorkout?.id ?? ''}
          onDismiss={handleClosePainReport}
          onSubmit={handleSubmitPainReport}
        />
      )}

      {/* Crash Recovery Dialog */}
      <CrashRecoveryDialog
        visible={showRecoveryDialog}
        recoveryData={recoveryData}
        onResume={handleResumeCrashSession}
        onDiscard={handleDiscardCrashSession}
        onDismiss={() => setShowRecoveryDialog(false)}
      />

      {/* Add Exercise Modal */}
      <Modal
        visible={showAddExerciseModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddExerciseModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.addExerciseContent}>
            <View style={styles.addExerciseHeader}>
              <Text style={styles.addExerciseTitle}>Add Exercise</Text>
              <TouchableOpacity
                testID="add-exercise-modal-close"
                onPress={() => setShowAddExerciseModal(false)}
              >
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              testID="browse-full-library-btn"
              style={styles.browseFullLibraryBtn}
              onPress={() => setShowFullLibraryModal(true)}
            >
              <Text style={styles.browseFullLibraryBtnText}>
                ⚡ Browse Library & Variant Tree ➔
              </Text>
            </TouchableOpacity>

            <TextInput
              testID="search-exercise-input"
              style={styles.searchExerciseInput}
              placeholder="Search exercise catalog..."
              placeholderTextColor="#71717A"
              value={exerciseSearchQuery}
              onChangeText={setExerciseSearchQuery}
              autoCapitalize="none"
            />

            <FlatList
              data={allCatalogExercises.filter((e) =>
                e.name.toLowerCase().includes(exerciseSearchQuery.toLowerCase()) ||
                e.muscle_group.toLowerCase().includes(exerciseSearchQuery.toLowerCase())
              )}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  testID={`catalog-exercise-item-${item.id}`}
                  style={styles.catalogItem}
                  onPress={() => handleAddExerciseToWorkout(item)}
                >
                  <Text style={styles.catalogItemName}>{item.name}</Text>
                  <Text style={styles.catalogItemMeta}>
                    {item.muscle_group} • {item.category}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Full Exercise Library & Variant Tree Modal */}
      {showFullLibraryModal && (
        <Modal
          visible={showFullLibraryModal}
          animationType="slide"
          onRequestClose={async () => {
            setShowFullLibraryModal(false);
            const updated = await exerciseRepo.findAll();
            setAllCatalogExercises(updated);
          }}
        >
          <ExerciseLibraryScreen
            exerciseRepo={exerciseRepo}
            workoutRepo={workoutRepo}
            gearRepo={gearRepo}
            userSettingsRepo={userSettingsRepo}
            onSelectExercise={async (exercise) => {
              setShowFullLibraryModal(false);
              setShowAddExerciseModal(false);
              const updated = await exerciseRepo.findAll();
              setAllCatalogExercises(updated);
              await handleAddExerciseToWorkout(exercise);
            }}
            onClose={async () => {
              setShowFullLibraryModal(false);
              const updated = await exerciseRepo.findAll();
              setAllCatalogExercises(updated);
            }}
          />
        </Modal>
      )}


      {/* Finish Confirmation Modal */}
      <Modal
        visible={showFinishConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFinishConfirmModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalCard}>
            <Text style={styles.confirmModalTitle}>Finish Workout</Text>
            <Text style={styles.confirmModalSubtitle}>
              Great work! Duration: {formatElapsedDuration(activeWorkout?.started_at)}. Add any final notes:
            </Text>

            {sets.some((s) => !completedSetIds.has(s.id)) && (
              <View testID="uncompleted-sets-banner" style={styles.uncompletedSetsContainer}>
                <Text style={styles.uncompletedSetsHeading}>
                  ⚠️ {sets.filter((s) => !completedSetIds.has(s.id)).length} uncompleted {sets.filter((s) => !completedSetIds.has(s.id)).length === 1 ? 'set' : 'sets'}
                </Text>
                <TouchableOpacity
                  testID="toggle-mark-incomplete-checkbox"
                  style={styles.incompleteCheckboxRow}
                  onPress={() => setMarkIncompleteAsComplete((prev) => !prev)}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.checkboxBox,
                      markIncompleteAsComplete && styles.checkboxBoxActive,
                    ]}
                  >
                    {markIncompleteAsComplete && <Text style={styles.checkboxCheckText}>✓</Text>}
                  </View>
                  <Text style={styles.checkboxLabelText}>
                    Log remaining {sets.filter((s) => !completedSetIds.has(s.id)).length} {sets.filter((s) => !completedSetIds.has(s.id)).length === 1 ? 'set' : 'sets'} as complete
                  </Text>
                </TouchableOpacity>
                <Text style={styles.incompleteExplanationText}>
                  {markIncompleteAsComplete
                    ? 'All remaining sets will be logged as completed.'
                    : 'Uncompleted sets will be excluded from the finished workout.'}
                </Text>
              </View>
            )}

            <TextInput
              testID="finish-workout-notes-input"
              style={styles.finishNotesInput}
              placeholder="Session notes (e.g. good energy, top set felt smooth)..."
              placeholderTextColor="#71717A"
              value={finishNotes}
              onChangeText={setFinishNotes}
              multiline
            />

            <View style={styles.confirmActionsRow}>
              <TouchableOpacity
                testID="cancel-finish-button"
                style={styles.cancelButton}
                onPress={() => setShowFinishConfirmModal(false)}
              >
                <Text style={styles.cancelButtonText}>Keep Lifting</Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="confirm-finish-button"
                style={styles.confirmFinishButton}
                onPress={handleConfirmFinish}
              >
                <Text style={styles.confirmFinishButtonText}>Save & Finish</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Superset Pairing Modal */}
      <Modal
        visible={showSupersetModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSupersetModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.addExerciseContent}>
            <View style={styles.addExerciseHeader}>
              <Text style={styles.addExerciseTitle}>Create Superset</Text>
              <TouchableOpacity
                testID="superset-modal-close"
                onPress={() => setShowSupersetModal(false)}
              >
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.supersetModalPrompt}>
              Pair {supersetSourceExercise?.name} with another exercise in this workout:
            </Text>

            <ScrollView style={styles.exerciseList}>
              {availableExercisesToPair.length === 0 ? (
                <Text style={styles.noCandidatesText}>
                  No other exercises in this workout to pair. Add another exercise first!
                </Text>
              ) : (
                availableExercisesToPair.map((candidate) => (
                  <TouchableOpacity
                    key={candidate.id}
                    testID={`pair-exercise-${candidate.id}`}
                    style={styles.candidateRow}
                    onPress={() => handleConfirmPairExercises(candidate.id)}
                  >
                    <Text style={styles.candidateName}>{candidate.name}</Text>
                    <Text style={styles.candidateCategory}>
                      {candidate.muscle_group} • {candidate.category}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Immediate Post-Workout Summary Inspection Modal */}
      {summaryWorkoutId && (
        <SessionDetailModal
          visible={!!summaryWorkoutId}
          workoutId={summaryWorkoutId}
          workoutRepo={workoutRepo}
          exerciseRepo={exerciseRepo}
          userSettingsRepo={userSettingsRepo}
          unitSystem={unitSystem}
          intensityMetric={intensityMetric}
          isImmediateSummary={true}
          onClose={() => {
            const finished = finishedWorkoutObj;
            setSummaryWorkoutId(null);
            setFinishedWorkoutObj(null);
            if (finished && onFinishSession) {
              onFinishSession(finished);
            }
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000', // Pure OLED Black
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#A1A1AA',
    fontSize: 14,
    marginTop: 12,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#09090B',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  headerTitleSection: {
    flex: 1,
  },
  headerWorkoutTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  headerSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00E676',
  },
  headerTicker: {
    fontSize: 13,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#00E676',
  },
  headerUnitPill: {
    fontSize: 10,
    fontWeight: '700',
    color: '#71717A',
    backgroundColor: '#18181B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  headerActions: {
    marginLeft: 12,
  },
  finishHeaderButton: {
    backgroundColor: '#00E676',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  finishHeaderButtonText: {
    color: '#000000',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 12,
    paddingBottom: 96,
  },
  completedWarmupsBanner: {
    backgroundColor: '#0F1A12',
    borderColor: '#064E3B',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedWarmupsBannerText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  collapseWarmupsBanner: {
    backgroundColor: '#18181B',
    borderColor: '#27272A',
    borderWidth: 1,
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginBottom: 6,
    alignItems: 'center',
  },
  collapseWarmupsBannerText: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '600',
  },
  exerciseCard: {
    backgroundColor: '#09090B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#18181B',
    marginBottom: 16,
    overflow: 'hidden',
  },
  completedExerciseCard: {
    backgroundColor: '#0F1A12',
    borderColor: '#14532D',
  },
  groupedExerciseCard: {
    borderColor: '#3B82F6',
    borderLeftWidth: 4,
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 12,
    backgroundColor: '#121215',
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  completedExerciseCardHeader: {
    backgroundColor: '#0F1A12',
    borderBottomWidth: 0,
  },
  exerciseTitleCol: {
    flex: 1,
  },
  exerciseTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  exerciseNameText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  completedExerciseNameText: {
    color: '#86EFAC',
  },
  dumbbellHeaderBadge: {
    backgroundColor: '#27272A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  dumbbellHeaderBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#A1A1AA',
  },
  supersetBadge: {
    backgroundColor: '#1D4ED8',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  supersetBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#DBEAFE',
  },
  gearSubtext: {
    fontSize: 11,
    color: '#38BDF8',
    marginTop: 4,
    fontWeight: '500',
  },
  gearPillBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  gearSubtextInteractive: {
    fontSize: 11,
    color: '#38BDF8',
    fontWeight: '600',
  },
  sfrWarningBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  sfrWarningBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#EF4444',
    letterSpacing: 0.5,
  },
  gearPickerModalContent: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    padding: 16,
    width: '90%',
    maxHeight: '80%',
  },
  gearPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272A',
    paddingBottom: 8,
  },
  gearPickerTitle: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
  },
  gearOptionRow: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  gearOptionName: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '700',
  },
  gearOptionSubtext: {
    color: '#38BDF8',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  expandChevron: {
    fontSize: 14,
    color: '#71717A',
    fontWeight: '700',
    marginLeft: 4,
  },
  completedExpandChevron: {
    color: '#00E676',
  },
  swapButton: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#3F3F46',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    marginLeft: 8,
  },
  swapButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#D4D4D8',
  },
  painButton: {
    backgroundColor: '#1E1B1B',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    marginLeft: 4,
  },
  painButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F87171',
  },
  painAlertBanner: {
    backgroundColor: '#450A0A',
    borderWidth: 1,
    borderColor: '#DC2626',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  painAlertBannerText: {
    color: '#FEE2E2',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0E0E11',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  tableHeaderCol: {
    fontSize: 10,
    fontWeight: '800',
    color: '#71717A',
    letterSpacing: 0.5,
  },
  setActionButtonRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#18181B',
  },
  addSetButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#121215',
  },
  addSetButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#00E676',
    letterSpacing: 0.5,
  },
  addWarmupButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#121215',
    borderLeftWidth: 1,
    borderLeftColor: '#18181B',
  },
  addWarmupButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FEF08A',
    letterSpacing: 0.5,
  },
  addExerciseButton: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginVertical: 10,
  },
  addExerciseButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FAFAFA',
    letterSpacing: 0.5,
  },
  discardFooterButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 6,
  },
  discardFooterText: {
    fontSize: 13,
    color: '#EF4444',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  addExerciseContent: {
    width: '100%',
    maxHeight: '80%',
    backgroundColor: '#09090B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 18,
  },
  addExerciseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addExerciseTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  closeText: {
    fontSize: 16,
    color: '#A1A1AA',
    fontWeight: '700',
  },
  searchExerciseInput: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    padding: 10,
    color: '#FAFAFA',
    marginBottom: 12,
  },
  browseFullLibraryBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  browseFullLibraryBtnText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '800',
  },

  catalogItem: {
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#18181B',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  catalogItemName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  catalogItemMeta: {
    fontSize: 12,
    color: '#71717A',
    marginTop: 2,
  },
  confirmModalCard: {
    width: '100%',
    backgroundColor: '#09090B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 20,
  },
  confirmModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  confirmModalSubtitle: {
    fontSize: 13,
    color: '#A1A1AA',
    marginVertical: 8,
  },
  finishNotesInput: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    padding: 10,
    color: '#FAFAFA',
    minHeight: 60,
    marginVertical: 10,
  },
  confirmActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#18181B',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  cancelButtonText: {
    color: '#D4D4D8',
    fontSize: 14,
    fontWeight: '700',
  },
  confirmFinishButton: {
    flex: 1,
    backgroundColor: '#00E676',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmFinishButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '800',
  },
  uncompletedSetsContainer: {
    backgroundColor: '#18181B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3F3F46',
    padding: 12,
    marginVertical: 10,
  },
  uncompletedSetsHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F59E0B',
    marginBottom: 8,
  },
  incompleteCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#71717A',
    backgroundColor: '#27272A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxBoxActive: {
    backgroundColor: '#00E676',
    borderColor: '#00E676',
  },
  checkboxCheckText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '900',
  },
  checkboxLabelText: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  incompleteExplanationText: {
    color: '#A1A1AA',
    fontSize: 11,
    marginTop: 6,
    fontStyle: 'italic',
  },
  linkButton: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  linkButtonText: {
    color: '#60A5FA',
    fontSize: 10,
    fontWeight: '700',
  },
  unlinkButton: {
    backgroundColor: '#27272A',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  unlinkButtonText: {
    color: '#F87171',
    fontSize: 10,
    fontWeight: '700',
  },
  supersetModalPrompt: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 12,
  },
  candidateRow: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#27272A',
  },
  candidateName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  candidateCategory: {
    fontSize: 12,
    color: '#71717A',
    marginTop: 2,
  },
  noCandidatesText: {
    color: '#71717A',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  exerciseList: {
    maxHeight: 350,
  },
});

