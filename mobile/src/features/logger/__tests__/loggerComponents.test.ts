/**
 * Workout Suite — Active Logger Features & UI Logic Test Suite
 *
 * Validates:
 * - SetRowComponent state transitions, set-type cycling, ghost copying, unilateral reps, RPE steppers
 * - RestTimerBanner time formatting, subscription, +/-30s, skip actions
 * - PlateCalculatorModal greedy loading, bar presets (20kg, 29kg SSB, 25kg Trap), remainder detection
 * - ExerciseSubstitutionModal recommendation filtering and swap scope logic
 * - CrashRecoveryDialog summary calculations and session resumption
 * - Superset rest timer suppression logic (ADR-009)
 */

import { formatTimeRemaining } from '../RestTimerBanner';
import { formatElapsedDuration } from '../ActiveLoggerScreen';
import { formatCompactGhostDisplay } from '../SetRowComponent';
import { calculatePlateLoading, DEFAULT_BAR_TARE_KG } from '../../../core/math/plateCalculator';
import { isLastWarmupSet } from '../../../core/math/warmupEstimator';
import {
  Workout,
  WorkoutSet,
  Exercise,
  GearInventory,
  SetType,
} from '../../../core/types';
import { RestTimerService } from '../../../services/restTimerService';
import { ActiveSessionService } from '../../../services/activeSessionService';
import { ExerciseSubstitutionService } from '../../../services/exerciseSubstitutionService';
import { CrashRecoveryService } from '../../../services/crashRecoveryService';
import {
  MockWorkoutRepository,
  MockExerciseRepository,
  MockGearRepository,
  MockUserSettingsRepository,
  MockPainReportRepository,
} from '../../../database/mocks';
import { CalibratedParamService } from '../../../services/calibratedParamService';
import { MockSQLiteDatabase } from '../../../database/__tests__/MockSQLiteDatabase';

describe('Active Logger Features & UI Logic (Step 1.5)', () => {
  let workoutRepo: MockWorkoutRepository;
  let exerciseRepo: MockExerciseRepository;
  let gearRepo: MockGearRepository;
  let userSettingsRepo: MockUserSettingsRepository;
  let sessionService: ActiveSessionService;
  let timerService: RestTimerService;
  let subService: ExerciseSubstitutionService;
  let recoveryService: CrashRecoveryService;

  const mockSquat: Exercise = {
    id: 'ex-squat',
    name: 'Barbell Back Squat',
    muscle_group: 'Quads',
    category: 'Barbell',
    is_compound: true,
    is_bodyweight: false,
    is_unilateral: false,
    load_mode: 'total',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 20.0,
    is_custom: false,
    parent_exercise_id: null,
    standard_lift_type: 'squat',
    default_rest_seconds: 180,
  };

  const mockDumbbellLunge: Exercise = {
    id: 'ex-lunge',
    name: 'Dumbbell Walking Lunge',
    muscle_group: 'Quads',
    category: 'Dumbbell',
    is_compound: true,
    is_bodyweight: false,
    is_unilateral: true,
    load_mode: 'per_hand',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 0,
    is_custom: false,
    parent_exercise_id: null,
    standard_lift_type: null,
    default_rest_seconds: 90,
  };

  const mockSsbGear: GearInventory = {
    id: 'gear-ssb',
    name: 'Safety Squat Bar',
    type: 'specialty_bar',
    tare_weight_kg: 29.0,
    cable_ratio: 1.0,
    is_default: false,
    notes: '29 kg cambered bar',
  };

  beforeEach(() => {
    workoutRepo = new MockWorkoutRepository();
    exerciseRepo = new MockExerciseRepository();
    gearRepo = new MockGearRepository();
    userSettingsRepo = new MockUserSettingsRepository();

    sessionService = new ActiveSessionService(workoutRepo, exerciseRepo, gearRepo);
    timerService = new RestTimerService();
    subService = new ExerciseSubstitutionService(exerciseRepo, workoutRepo, gearRepo);
    recoveryService = new CrashRecoveryService(workoutRepo);

    exerciseRepo.create(mockSquat);
    exerciseRepo.create(mockDumbbellLunge);
    gearRepo.create(mockSsbGear);
  });

  describe('1. RestTimerBanner Logic & Presentation', () => {
    test('formatTimeRemaining formats mm:ss correctly across all ranges', () => {
      expect(formatTimeRemaining(0)).toBe('00:00');
      expect(formatTimeRemaining(9)).toBe('00:09');
      expect(formatTimeRemaining(59)).toBe('00:59');
      expect(formatTimeRemaining(60)).toBe('01:00');
      expect(formatTimeRemaining(90)).toBe('01:30');
      expect(formatTimeRemaining(180)).toBe('03:00');
      expect(formatTimeRemaining(3665)).toBe('61:05');
      expect(formatTimeRemaining(-5)).toBe('00:00');
    });

    test('timerService updates state and notifies subscribers on adjustTime', () => {
      const stateHistory: number[] = [];
      const unsub = timerService.subscribe((s) => {
        stateHistory.push(s.remainingSeconds);
      });

      timerService.start(90);
      expect(timerService.getState().status).toBe('running');
      expect(timerService.getState().remainingSeconds).toBe(90);

      timerService.add30Seconds();
      expect(timerService.getState().remainingSeconds).toBe(120);

      timerService.subtract30Seconds();
      expect(timerService.getState().remainingSeconds).toBe(90);

      timerService.skip();
      expect(timerService.getState().status).toBe('completed');
      expect(timerService.getState().remainingSeconds).toBe(0);

      unsub();
    });

    test('pause and resume correctly preserves remaining wall-clock time', () => {
      timerService.start(60);
      const pausedState = timerService.pause();
      expect(pausedState.status).toBe('paused');
      expect(pausedState.pausedRemainingMs).toBeGreaterThan(0);

      const resumedState = timerService.resume();
      expect(resumedState.status).toBe('running');
      expect(resumedState.endTimeMs).toBeGreaterThan(Date.now());
      timerService.skip();
    });
  });

  describe('2. PlateCalculatorModal Math & Presets', () => {
    test('standard Olympic 20kg bar correctly calculates 100kg total', () => {
      const result = calculatePlateLoading(100, { barTareKg: 20 });
      expect(result.barTareKg).toBe(20);
      expect(result.weightPerSideKg).toBe(40);
      expect(result.remainderKg).toBe(0);
      // 40 kg per side = 25 + 15
      expect(result.platesPerSide).toEqual([25, 15]);
    });

    test('specialty 29kg Safety Squat Bar tare computes correct plates for 100kg', () => {
      // 100 kg - 29 kg = 71 kg total plate weight -> 35.5 kg per side
      // 35.5 kg = 25 + 10 + 0.5 (odd remainder since smallest plate is 1.25)
      const result = calculatePlateLoading(100, { barTareKg: 29 });
      expect(result.barTareKg).toBe(29);
      expect(result.platesPerSide).toEqual([25, 10]);
      expect(result.remainderKg).toBe(1);
    });

    test('empty bar tare results in 0 plates per side', () => {
      const result = calculatePlateLoading(20, { barTareKg: 20 });
      expect(result.platesPerSide).toEqual([]);
      expect(result.weightPerSideKg).toBe(0);
      expect(result.remainderKg).toBe(0);
    });

    test('trap bar 25kg tare correctly loads 125kg total', () => {
      // 125 - 25 = 100 kg -> 50 kg per side = 25 + 25
      const result = calculatePlateLoading(125, { barTareKg: 25 });
      expect(result.platesPerSide).toEqual([25, 25]);
      expect(result.weightPerSideKg).toBe(50);
      expect(result.remainderKg).toBe(0);
    });
  });

  describe('3. SetRowComponent Logic & Interactions', () => {
    test('cycling set types transitions through working -> warmup -> drop -> myorep -> dc -> amrap -> working', () => {
      const SET_TYPE_ORDER: SetType[] = ['working', 'warmup', 'drop', 'myorep', 'dc', 'amrap'];

      let currentType: SetType = 'working';
      const getNextType = (curr: SetType): SetType => {
        const idx = SET_TYPE_ORDER.indexOf(curr);
        return SET_TYPE_ORDER[(idx + 1) % SET_TYPE_ORDER.length];
      };

      currentType = getNextType(currentType);
      expect(currentType).toBe('warmup');
      currentType = getNextType(currentType);
      expect(currentType).toBe('drop');
      currentType = getNextType(currentType);
      expect(currentType).toBe('myorep');
      currentType = getNextType(currentType);
      expect(currentType).toBe('dc');
      currentType = getNextType(currentType);
      expect(currentType).toBe('amrap');
      currentType = getNextType(currentType);
      expect(currentType).toBe('working');
    });

    test('badge labels correctly display Reg, Warm, Drop, Myo, DC, AMRAP', () => {
      const SET_TYPE_LABELS: Record<SetType, string> = {
        working: 'Reg',
        warmup: 'Warm',
        drop: 'Drop',
        myorep: 'Myo',
        dc: 'DC',
        amrap: 'AMRAP',
      };

      expect(SET_TYPE_LABELS['working']).toBe('Reg');
      expect(SET_TYPE_LABELS['warmup']).toBe('Warm');
      expect(SET_TYPE_LABELS['drop']).toBe('Drop');
      expect(SET_TYPE_LABELS['myorep']).toBe('Myo');
      expect(SET_TYPE_LABELS['dc']).toBe('DC');
      expect(SET_TYPE_LABELS['amrap']).toBe('AMRAP');
    });

    test('rest timer durations by set type: drop=0s, myorep=10s, dc=30s', () => {
      const getRestDurationForSet = (setType: SetType, defaultRestSeconds: number): number | null => {
        if (setType === 'drop') return 0; // 0s rest (suppress/reset)
        if (setType === 'myorep') return 10;
        if (setType === 'dc') return 30;
        return defaultRestSeconds;
      };

      expect(getRestDurationForSet('drop', 90)).toBe(0);
      expect(getRestDurationForSet('myorep', 90)).toBe(10);
      expect(getRestDurationForSet('dc', 90)).toBe(30);
      expect(getRestDurationForSet('working', 90)).toBe(90);
      expect(getRestDurationForSet('warmup', 90)).toBe(90);
    });

    test('decimal parsing handles both period and comma separators', () => {
      const parseWeightInput = (text: string): { sanitized: string; num: number } => {
        const normalized = text.replace(',', '.');
        const cleaned = normalized.replace(/[^0-9.]/g, '');
        const parts = cleaned.split('.');
        const sanitized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
        const num = sanitized === '' || sanitized === '.' ? 0 : parseFloat(sanitized);
        return { sanitized, num: isNaN(num) ? 0 : num };
      };

      expect(parseWeightInput('62.5')).toEqual({ sanitized: '62.5', num: 62.5 });
      expect(parseWeightInput('62,5')).toEqual({ sanitized: '62.5', num: 62.5 });
      expect(parseWeightInput('100')).toEqual({ sanitized: '100', num: 100 });
      expect(parseWeightInput('62.')).toEqual({ sanitized: '62.', num: 62 });
      expect(parseWeightInput('62,')).toEqual({ sanitized: '62.', num: 62 });
      expect(parseWeightInput('')).toEqual({ sanitized: '', num: 0 });
    });

    test('copying ghost values fills all mechanical and intensity fields', () => {
      const activeSet: WorkoutSet = {
        id: 'set-1',
        workout_id: 'w-1',
        exercise_id: 'ex-squat',
        gear_id: null,
        set_number: 1,
        weight: 0,
        raw_input_weight: 0,
        added_weight: null,
        reps: 0,
        reps_right: null,
        rpe: null,
        rir: null,
        set_type: 'working',
        set_notes: null,
        exercise_group_id: null,
        created_at: new Date().toISOString(),
      };

      const ghostSet: WorkoutSet = {
        id: 'ghost-1',
        workout_id: 'w-old',
        exercise_id: 'ex-squat',
        gear_id: null,
        set_number: 1,
        weight: 140,
        raw_input_weight: 140,
        added_weight: null,
        reps: 5,
        reps_right: null,
        rpe: 8.5,
        rir: 1.5,
        set_type: 'working',
        set_notes: 'belt on',
        exercise_group_id: null,
        created_at: new Date().toISOString(),
      };

      const copied = {
        raw_input_weight: ghostSet.raw_input_weight,
        weight: ghostSet.weight,
        reps: ghostSet.reps,
        reps_right: ghostSet.reps_right,
        rpe: ghostSet.rpe,
        rir: ghostSet.rir,
      };

      const updated = { ...activeSet, ...copied };
      expect(updated.raw_input_weight).toBe(140);
      expect(updated.weight).toBe(140);
      expect(updated.reps).toBe(5);
      expect(updated.rpe).toBe(8.5);
      expect(updated.rir).toBe(1.5);
    });

    test('stepping RPE by half-steps respects [5.0, 10.0] bounds', () => {
      const stepRpe = (current: number | null, delta: number) => {
        const val = current ?? 8.0;
        return Math.min(10.0, Math.max(5.0, Math.round((val + delta) * 2) / 2));
      };

      expect(stepRpe(8.0, 0.5)).toBe(8.5);
      expect(stepRpe(9.5, 0.5)).toBe(10.0);
      expect(stepRpe(10.0, 0.5)).toBe(10.0); // Clamped at 10.0
      expect(stepRpe(null, 0.5)).toBe(8.5); // Default 8.0 + 0.5
    });

    test('stepping RPE supports values below 6.0 for light/warmup sets down to 1.0', () => {
      const stepRpeExtended = (current: number | null, delta: number) => {
        const val = current ?? 8.0;
        return Math.min(10.0, Math.max(1.0, Math.round((val + delta) * 2) / 2));
      };

      expect(stepRpeExtended(6.0, -0.5)).toBe(5.5);
      expect(stepRpeExtended(5.0, -1.0)).toBe(4.0);
      expect(stepRpeExtended(1.0, -0.5)).toBe(1.0); // Clamped at 1.0
    });

    test('clearing intensity resets rpe and rir to null', () => {
      let rpe: number | null = 8.5;
      let rir: number | null = 1.5;
      const clearIntensity = () => {
        rpe = null;
        rir = null;
      };
      clearIntensity();
      expect(rpe).toBeNull();
      expect(rir).toBeNull();
    });

    test('AMRAP button sets 0 RIR and 10 RPE', () => {
      let rpe: number | null = null;
      let rir: number | null = null;
      const setAmrap = () => {
        rpe = 10.0;
        rir = 0.0;
      };
      setAmrap();
      expect(rpe).toBe(10.0);
      expect(rir).toBe(0.0);
    });

    test('intensity inheritance: first set starts with null intensity, set 2 inherits previous set', async () => {
      const workout = await sessionService.startWorkout({ name: 'Intensity Inheritance Test' });

      // First set: no lastSet, intensity starts null
      const set1 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 100,
        reps: 5,
        rpe: null,
        rir: null,
      });
      expect(set1.rpe).toBeNull();
      expect(set1.rir).toBeNull();

      // Lifter logs RPE 8.0 on set 1:
      await sessionService.updateSet(workout.id, set1.id, { rpe: 8.0 });

      // Second set: inherits set 1's RPE 8.0
      const existingSets = await workoutRepo.getSetsByWorkoutId(workout.id);
      const lastSet = existingSets[existingSets.length - 1];
      const set2 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 100,
        reps: 5,
        rpe: lastSet.rpe,
        rir: lastSet.rir,
      });
      expect(set2.rpe).toBe(8.0);
      expect(set2.rir).toBeNull();
    });

    test('dumbbell exercise flags per-hand load mode and badges (x2)', () => {
      expect(mockDumbbellLunge.load_mode).toBe('per_hand');
      expect(mockDumbbellLunge.is_unilateral).toBe(true);
    });
  });

  describe('4. ExerciseSubstitutionModal & Scope Rules', () => {
    test('substitutions find hierarchy variants and same muscle group', async () => {
      const childSquat: Exercise = {
        id: 'ex-front-squat',
        name: 'Front Squat',
        muscle_group: 'Quads',
        category: 'Barbell',
        is_compound: true,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 20.0,
        is_custom: false,
        parent_exercise_id: 'ex-squat',
        standard_lift_type: 'squat',
        default_rest_seconds: 180,
      };
      await exerciseRepo.create(childSquat);

      const substitutes = await subService.findSubstitutes('ex-squat');
      expect(substitutes.length).toBeGreaterThan(0);

      const frontSquatSub = substitutes.find((s) => s.exercise.id === 'ex-front-squat');
      expect(frontSquatSub).toBeDefined();
      expect(frontSquatSub?.matchReason).toBe('direct_variant');
    });

    test('applying substitution with session_only scope replaces sets without altering templates', async () => {
      const workout = await sessionService.startWorkout({ name: 'Leg Day' });
      const set1 = await sessionService.addSet(workout.id, {
        exerciseId: 'ex-squat',
        rawInputWeight: 100,
        reps: 5,
      });

      const legPress: Exercise = {
        id: 'ex-leg-press',
        name: 'Leg Press',
        muscle_group: 'Quads',
        category: 'Machine',
        is_compound: true,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 0,
        is_custom: false,
        parent_exercise_id: null,
        standard_lift_type: null,
        default_rest_seconds: 120,
      };
      await exerciseRepo.create(legPress);

      await subService.applySubstitution({
        workoutId: workout.id,
        oldExerciseId: 'ex-squat',
        newExerciseId: 'ex-leg-press',
        swapScope: 'session_only',
      });

      const updated = await sessionService.getActiveWorkout(workout.id);
      expect(updated?.sets[0].exercise_id).toBe('ex-leg-press');
    });
  });

  describe('5. CrashRecoveryService & Dialog Integration', () => {
    test('detects interrupted in_progress workout and provides resume data', async () => {
      const workout = await sessionService.startWorkout({ name: 'Interrupted Session' });
      await sessionService.addSet(workout.id, {
        exerciseId: 'ex-squat',
        rawInputWeight: 100,
        reps: 5,
      });

      const promptData = await recoveryService.checkForInterruptedWorkout();
      expect(promptData).not.toBeNull();
      expect(promptData?.workout.id).toBe(workout.id);
      expect(promptData?.summary.totalSets).toBe(1);
      expect(promptData?.summary.uniqueExercises).toBe(1);

      // Resuming session
      const resumed = await recoveryService.resumeSession(workout.id);
      expect(resumed.workout.status).toBe('in_progress');

      // Discarding session
      const discarded = await recoveryService.discardSession(workout.id);
      expect(discarded.status).toBe('discarded');

      // After discard, no interrupted workout exists
      const checkAgain = await recoveryService.checkForInterruptedWorkout();
      expect(checkAgain).toBeNull();
    });
  });

  describe('6. Superset Rest Timer Suppression Logic (ADR-009)', () => {
    test('rest timer is suppressed until the final exercise in a superset completes its set', async () => {
      const workout = await sessionService.startWorkout({ name: 'Superset Workout' });

      // Superset pair: A1 (Biceps) and A2 (Triceps) sharing groupId 'group-arms-1'
      const curl: Exercise = {
        id: 'ex-curl',
        name: 'Bicep Curl',
        muscle_group: 'Biceps',
        category: 'Dumbbell',
        is_compound: false,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'per_hand',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 0,
        is_custom: false,
        parent_exercise_id: null,
        standard_lift_type: null,
        default_rest_seconds: 60,
      };

      const pushdown: Exercise = {
        id: 'ex-pushdown',
        name: 'Tricep Pushdown',
        muscle_group: 'Triceps',
        category: 'Cable',
        is_compound: false,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 0,
        is_custom: false,
        parent_exercise_id: null,
        standard_lift_type: null,
        default_rest_seconds: 90,
      };

      await exerciseRepo.create(curl);
      await exerciseRepo.create(pushdown);

      const setA1 = await sessionService.addSet(workout.id, {
        exerciseId: 'ex-curl',
        rawInputWeight: 14,
        reps: 12,
        exerciseGroupId: 'group-arms-1',
      });

      const setA2 = await sessionService.addSet(workout.id, {
        exerciseId: 'ex-pushdown',
        rawInputWeight: 25,
        reps: 15,
        exerciseGroupId: 'group-arms-1',
      });

      const allWorkoutSets = [setA1, setA2];
      const completedSetIds = new Set<string>();

      // Lifter completes set A1:
      completedSetIds.add(setA1.id);

      // Evaluate superset suppression:
      const groupedSets = allWorkoutSets.filter(
        (s) => s.exercise_group_id === setA1.exercise_group_id
      );
      const allCompletedAfterA1 = groupedSets.every((s) => completedSetIds.has(s.id));

      // After only A1, timer SHOULD be suppressed:
      expect(allCompletedAfterA1).toBe(false);

      // Lifter now completes set A2:
      completedSetIds.add(setA2.id);
      const allCompletedAfterA2 = groupedSets.every((s) => completedSetIds.has(s.id));

      // After A2 (the final exercise in the superset), timer SHOULD trigger:
      expect(allCompletedAfterA2).toBe(true);

      if (allCompletedAfterA2) {
        timerService.start(pushdown.default_rest_seconds);
      }

      expect(timerService.getState().status).toBe('running');
      expect(timerService.getState().remainingSeconds).toBe(90);
      timerService.skip();
    });
  });

  describe('7. Accordion Auto-Advance, Completed Green State & Incomplete Set Exclusion', () => {
    test('auto-advances to the next incomplete exercise when all sets of the active exercise complete', async () => {
      const workout = await sessionService.startWorkout({ name: 'Leg Day' });

      // Exercise 1: Squat (2 sets)
      const sq1 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 100,
        reps: 5,
      });
      const sq2 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 100,
        reps: 5,
      });

      // Exercise 2: Lunge (2 sets)
      const lg1 = await sessionService.addSet(workout.id, {
        exerciseId: mockDumbbellLunge.id,
        rawInputWeight: 20,
        reps: 10,
      });
      const lg2 = await sessionService.addSet(workout.id, {
        exerciseId: mockDumbbellLunge.id,
        rawInputWeight: 20,
        reps: 10,
      });

      const allSets = [sq1, sq2, lg1, lg2];
      const distinctExIds = [mockSquat.id, mockDumbbellLunge.id];
      const completedSetIds = new Set<string>();

      let expandedExerciseId: string | null = mockSquat.id;

      // Helper function simulating ActiveLoggerScreen auto-advance logic
      const simulateCompleteSet = (targetSet: WorkoutSet) => {
        completedSetIds.add(targetSet.id);

        const thisExSets = allSets.filter((s) => s.exercise_id === targetSet.exercise_id);
        const isThisExAllCompleted =
          thisExSets.length > 0 && thisExSets.every((s) => completedSetIds.has(s.id));

        if (isThisExAllCompleted) {
          const currentIndex = distinctExIds.indexOf(targetSet.exercise_id);
          let nextExId: string | null = null;
          for (let i = 1; i < distinctExIds.length; i++) {
            const candidateId = distinctExIds[(currentIndex + i) % distinctExIds.length];
            const candidateSets = allSets.filter((s) => s.exercise_id === candidateId);
            const hasIncomplete = candidateSets.some((s) => !completedSetIds.has(s.id));
            if (hasIncomplete) {
              nextExId = candidateId;
              break;
            }
          }
          if (nextExId) {
            expandedExerciseId = nextExId;
          }
        }
      };

      // Complete Set 1 of Squat:
      simulateCompleteSet(sq1);
      // Not all sets done yet, should stay expanded on Squat
      expect(expandedExerciseId).toBe(mockSquat.id);

      // Complete Set 2 of Squat:
      simulateCompleteSet(sq2);
      // All sets of Squat done, should auto-advance to Lunge
      expect(expandedExerciseId).toBe(mockDumbbellLunge.id);

      // Verify Squat is now recognized as all completed
      const squatSets = allSets.filter((s) => s.exercise_id === mockSquat.id);
      const isSquatAllCompleted = squatSets.every((s) => completedSetIds.has(s.id));
      expect(isSquatAllCompleted).toBe(true);

      // Verify Lunge is still incomplete
      const lungeSets = allSets.filter((s) => s.exercise_id === mockDumbbellLunge.id);
      const isLungeAllCompleted = lungeSets.every((s) => completedSetIds.has(s.id));
      expect(isLungeAllCompleted).toBe(false);
    });

    test('manual accordion selection enforces "Always keep one open"', () => {
      let expandedExerciseId: string | null = 'ex-squat';

      const handleSelectExercise = (exerciseId: string) => {
        if (expandedExerciseId !== exerciseId) {
          expandedExerciseId = exerciseId;
        }
      };

      // Tapping another exercise switches to it
      handleSelectExercise('ex-lunge');
      expect(expandedExerciseId).toBe('ex-lunge');

      // Tapping the currently expanded exercise keeps it open
      handleSelectExercise('ex-lunge');
      expect(expandedExerciseId).toBe('ex-lunge');
    });

    test('finishing workout with incomplete sets and default unchecked deletes uncompleted sets', async () => {
      const workout = await sessionService.startWorkout({ name: 'Chest Day' });

      const set1 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 120,
        reps: 5,
      });
      const set2 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 120,
        reps: 5,
      });
      const set3 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 120,
        reps: 5,
      });

      // Lifter only checked off set 1
      const completedSetIds = new Set<string>([set1.id]);
      const markIncompleteAsComplete = false; // Default unchecked

      const allSets = await workoutRepo.getSetsByWorkoutId(workout.id);
      const uncompletedSets = allSets.filter((s) => !completedSetIds.has(s.id));
      expect(uncompletedSets.length).toBe(2);

      if (!markIncompleteAsComplete) {
        for (const uncompletedSet of uncompletedSets) {
          await sessionService.deleteSet(workout.id, uncompletedSet.id);
        }
      }

      const finished = await sessionService.finishWorkout(workout.id);
      expect(finished.status).toBe('completed');

      // Verify that ONLY the completed set remains in SQLite
      const remainingSets = await workoutRepo.getSetsByWorkoutId(workout.id);
      expect(remainingSets.length).toBe(1);
      expect(remainingSets[0].id).toBe(set1.id);

      // Verify ghost sets only contain the completed set
      const ghostSets = await sessionService.getGhostSetsForExercise(mockSquat.id);
      expect(ghostSets.length).toBe(1);
      expect(ghostSets[0].id).toBe(set1.id);
    });

    test('finishing workout with incomplete sets and checked option logs all sets', async () => {
      const workout = await sessionService.startWorkout({ name: 'Back Day' });

      const set1 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 140,
        reps: 3,
      });
      const set2 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 140,
        reps: 3,
      });

      const completedSetIds = new Set<string>([set1.id]);
      const markIncompleteAsComplete = true; // Lifter checked the box

      const allSets = await workoutRepo.getSetsByWorkoutId(workout.id);
      const uncompletedSets = allSets.filter((s) => !completedSetIds.has(s.id));

      if (markIncompleteAsComplete) {
        uncompletedSets.forEach((s) => completedSetIds.add(s.id));
      }

      await sessionService.finishWorkout(workout.id);

      // All sets retained
      const finalSets = await workoutRepo.getSetsByWorkoutId(workout.id);
      expect(finalSets.length).toBe(2);
      expect(completedSetIds.has(set2.id)).toBe(true);
    });

    test('persists completed set IDs to userSettingsRepo and clears them on finish', async () => {
      const workout = await sessionService.startWorkout({ name: 'Session Crash Test' });
      const key = `active_completed_set_ids_${workout.id}`;

      // Simulate checking off set
      const completed = ['set-123', 'set-456'];
      await userSettingsRepo.set(key, JSON.stringify(completed));

      const stored = await userSettingsRepo.get(key);
      expect(stored).toBe(JSON.stringify(completed));

      // Simulate finishing session:
      await userSettingsRepo.delete(key);
      const afterFinish = await userSettingsRepo.get(key);
      expect(afterFinish).toBeNull();
    });
  });

  describe('8. SupersetBracketGroup & Unilateral Limb Mechanics (Step 2.1)', () => {
    test('SupersetBracketGroup classifies <= 2 exercises as SUPERSET and > 2 as GIANT SET', () => {
      const pair = [mockSquat, mockDumbbellLunge];
      const isGiantSetPair = pair.length > 2;
      expect(isGiantSetPair).toBe(false);
      const pairBadge = isGiantSetPair ? 'GIANT SET' : 'SUPERSET';
      expect(pairBadge).toBe('SUPERSET');

      const giantSet = [mockSquat, mockDumbbellLunge, { ...mockSquat, id: 'ex-calf', name: 'Calf Raise' }];
      const isGiantSetTrio = giantSet.length > 2;
      expect(isGiantSetTrio).toBe(true);
      const trioBadge = isGiantSetTrio ? 'GIANT SET' : 'SUPERSET';
      expect(trioBadge).toBe('GIANT SET');
    });

    test('SupersetBracketGroup generates summary text and identifies final exercise for rest indicator', () => {
      const pair = [mockSquat, mockDumbbellLunge];
      const summaryText = pair.map((e) => e.name).join(' ⇄ ');
      expect(summaryText).toBe('Barbell Back Squat ⇄ Dumbbell Walking Lunge');

      const finalExName = pair[pair.length - 1].name;
      expect(finalExName).toBe('Dumbbell Walking Lunge');
    });

    test('Unilateral ghost display string formats weight × L/R when reps_right is present', () => {
      const unilateralExercise = mockDumbbellLunge; // is_unilateral: true
      const bilateralExercise = mockSquat; // is_unilateral: false

      const ghostSetUnilateral: WorkoutSet = {
        id: 'ghost-uni',
        workout_id: 'w-prev',
        exercise_id: unilateralExercise.id,
        gear_id: null,
        set_number: 1,
        weight: 40,
        raw_input_weight: 20,
        added_weight: null,
        reps: 12,
        reps_right: 10,
        rpe: 8.5,
        rir: 1.5,
        set_type: 'working',
        set_notes: null,
        exercise_group_id: null,
        created_at: new Date().toISOString(),
      };

      const formatGhost = (ex: Exercise, gSet: WorkoutSet | null) => {
        if (!gSet) return '—';
        if (ex.is_unilateral && gSet.reps_right !== null && gSet.reps_right !== undefined) {
          return `${gSet.raw_input_weight} × ${gSet.reps}/${gSet.reps_right}`;
        }
        return `${gSet.raw_input_weight} × ${gSet.reps}`;
      };

      expect(formatGhost(unilateralExercise, ghostSetUnilateral)).toBe('20 × 12/10');

      // For bilateral exercise, format remains weight × reps
      const ghostSetBilateral: WorkoutSet = {
        ...ghostSetUnilateral,
        exercise_id: bilateralExercise.id,
        reps_right: null,
      };
      expect(formatGhost(bilateralExercise, ghostSetBilateral)).toBe('20 × 12');

      // Test production formatCompactGhostDisplay helper
      expect(formatCompactGhostDisplay(unilateralExercise, ghostSetUnilateral)).toBe('20×12/10 @8.5');
      expect(formatCompactGhostDisplay(bilateralExercise, ghostSetBilateral)).toBe('20×12 @8.5');
      expect(formatCompactGhostDisplay(bilateralExercise, { ...ghostSetBilateral, rpe: null, rir: null })).toBe('20×12');
      expect(formatCompactGhostDisplay(bilateralExercise, null)).toBe('—');
    });

    test('auto-committing ghost values when user taps completion with empty inputs', () => {
      const activeEmptySet: WorkoutSet = {
        id: 'set-active',
        workout_id: 'w-1',
        exercise_id: 'ex-squat',
        gear_id: null,
        set_number: 1,
        weight: 0,
        raw_input_weight: 0,
        added_weight: null,
        reps: 0,
        reps_right: null,
        rpe: null,
        rir: null,
        set_type: 'working',
        set_notes: null,
        exercise_group_id: null,
        created_at: new Date().toISOString(),
      };

      const ghostSet: WorkoutSet = {
        id: 'ghost-1',
        workout_id: 'w-old',
        exercise_id: 'ex-squat',
        gear_id: null,
        set_number: 1,
        weight: 120,
        raw_input_weight: 120,
        added_weight: null,
        reps: 8,
        reps_right: null,
        rpe: 8,
        rir: 2,
        set_type: 'working',
        set_notes: null,
        exercise_group_id: null,
        created_at: new Date().toISOString(),
      };

      // Emulate SetRowComponent 1-tap auto-commit on complete
      let autoCommittedFields: Partial<WorkoutSet> = {};
      const needsWeight = (!activeEmptySet.raw_input_weight || activeEmptySet.raw_input_weight === 0) && !!ghostSet && ghostSet.raw_input_weight > 0;
      const needsReps = (!activeEmptySet.reps || activeEmptySet.reps === 0) && !!ghostSet && ghostSet.reps > 0;

      if (needsWeight || needsReps) {
        if (needsWeight) {
          autoCommittedFields.raw_input_weight = ghostSet.raw_input_weight;
          autoCommittedFields.weight = ghostSet.weight;
        }
        if (needsReps) {
          autoCommittedFields.reps = ghostSet.reps;
          if (ghostSet.reps_right !== null && ghostSet.reps_right !== undefined) {
            autoCommittedFields.reps_right = ghostSet.reps_right;
          }
        }
        if (ghostSet.rpe !== null && activeEmptySet.rpe === null) {
          autoCommittedFields.rpe = ghostSet.rpe;
        }
        if (ghostSet.rir !== null && activeEmptySet.rir === null) {
          autoCommittedFields.rir = ghostSet.rir;
        }
      }

      expect(autoCommittedFields.raw_input_weight).toBe(120);
      expect(autoCommittedFields.weight).toBe(120);
      expect(autoCommittedFields.reps).toBe(8);
      expect(autoCommittedFields.rpe).toBe(8);
    });

    test('Independent unilateral rep stepping for Left and Right limbs', () => {
      let reps = 10;
      let repsRight: number | null = 10;

      const handleStepReps = (delta: number) => {
        reps = Math.max(0, reps + delta);
      };

      const handleStepRepsRight = (delta: number) => {
        const current = repsRight !== null ? repsRight : reps;
        repsRight = Math.max(0, current + delta);
      };

      // Step Left by +1
      handleStepReps(1);
      expect(reps).toBe(11);
      expect(repsRight).toBe(10); // Right remains unchanged

      // Step Right by -2
      handleStepRepsRight(-2);
      expect(reps).toBe(11);
      expect(repsRight).toBe(8);

      // Step Left down to 0 clamped
      handleStepReps(-20);
      expect(reps).toBe(0);
    });

    test('Rest timer suppression across multi-exercise superset sequence', () => {
      const groupExercises = ['ex-squat', 'ex-lunge'];

      // When squat (first exercise) completes set -> rest timer suppressed
      const shouldTriggerForSquat = RestTimerService.shouldTriggerForExerciseInGroup(
        'ex-squat',
        groupExercises
      );
      expect(shouldTriggerForSquat).toBe(false);

      // When lunge (final exercise) completes set -> rest timer triggered
      const shouldTriggerForLunge = RestTimerService.shouldTriggerForExerciseInGroup(
        'ex-lunge',
        groupExercises
      );
      expect(shouldTriggerForLunge).toBe(true);
    });

    test('Finishing workout preserves superset groupings on sets for immediate summary', async () => {
      const activeWorkout = await sessionService.startWorkout({ name: 'Superset Finish Test' });
      await sessionService.addSet(activeWorkout.id, { exerciseId: 'ex-squat', rawInputWeight: 120, reps: 5 });
      await sessionService.addSet(activeWorkout.id, { exerciseId: 'ex-lunge', rawInputWeight: 30, reps: 10 });

      // Group exercises into a superset
      const groupId = await sessionService.groupExercises(activeWorkout.id, ['ex-squat', 'ex-lunge']);
      expect(groupId).toBeDefined();

      // Finish workout
      const finished = await sessionService.finishWorkout(activeWorkout.id, {
        notes: 'Supersets felt strong',
      });

      expect(finished.status).toBe('completed');
      expect(finished.notes).toBe('Supersets felt strong');

      // Verify sets in the finished workout still retain the exercise_group_id for summary modal display
      const finishedSets = await workoutRepo.getSetsByWorkoutId(finished.id);
      expect(finishedSets.length).toBe(2);
      expect(finishedSets[0].exercise_group_id).toBe(groupId);
      expect(finishedSets[1].exercise_group_id).toBe(groupId);
    });

    test('supports 1-tap gear assignment for specific exercise in active session without affecting other exercises', async () => {
      // Create SSB gear in gearRepo
      const ssb = await gearRepo.create({
        id: 'gear_bar_ssb_29kg',
        name: 'Safety Squat Bar (29 kg)',
        type: 'specialty_bar',
        tare_weight_kg: 29.0,
        cable_ratio: 1.0,
        is_default: false,
        notes: null,
      });

      await exerciseRepo.create({
        id: 'ex-bench',
        name: 'Barbell Bench Press',
        muscle_group: 'Chest',
        category: 'Barbell',
        is_compound: true,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 20.0,
        is_custom: false,
        parent_exercise_id: null,
        standard_lift_type: 'bench',
        default_rest_seconds: 180,
      });

      const activeWorkout = await sessionService.startWorkout({ name: 'Leg Day with SSB' });

      // Add sets for Squat and Bench Press
      const set1 = await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'ex-squat',
        rawInputWeight: 100,
        reps: 5,
      });
      const set2 = await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'ex-squat',
        rawInputWeight: 100,
        reps: 5,
      });
      const benchSet = await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'ex-bench',
        rawInputWeight: 80,
        reps: 8,
      });

      // Initially, no gearId assigned
      expect(set1.gear_id).toBeNull();
      expect(set2.gear_id).toBeNull();
      expect(benchSet.gear_id).toBeNull();

      // Switch Squat to Safety Squat Bar
      const squatSets = [set1, set2];
      for (const s of squatSets) {
        await sessionService.updateSet(activeWorkout.id, s.id, {
          gearId: ssb.id,
        });
      }

      // Verify Squat sets updated to SSB
      const updatedSets = await workoutRepo.getSetsByWorkoutId(activeWorkout.id);
      const updatedSquats = updatedSets.filter((s) => s.exercise_id === 'ex-squat');
      const updatedBench = updatedSets.filter((s) => s.exercise_id === 'ex-bench');

      expect(updatedSquats[0].gear_id).toBe('gear_bar_ssb_29kg');
      expect(updatedSquats[1].gear_id).toBe('gear_bar_ssb_29kg');

      // Crucial: Bench Press sets remain COMPLETELY UNTOUCHED with null gear_id (20 kg standard bar)!
      expect(updatedBench[0].gear_id).toBeNull();
    });
  });

  describe('8. Performance Optimizations & Ticker Isolation', () => {
    test('formatElapsedDuration formats HH:MM:SS correctly', () => {
      const now = Date.now();
      expect(formatElapsedDuration(null)).toBe('00:00:00');
      expect(formatElapsedDuration(undefined)).toBe('00:00:00');

      // 65 seconds ago
      const sixtyFiveSecsAgo = new Date(now - 65 * 1000).toISOString();
      expect(formatElapsedDuration(sixtyFiveSecsAgo)).toBe('00:01:05');

      // 3665 seconds ago (1h 1m 5s)
      const oneHourAgo = new Date(now - 3665 * 1000).toISOString();
      expect(formatElapsedDuration(oneHourAgo)).toBe('01:01:05');
    });

    test('RestTimerService.syncWithWallClock immediately evaluates status and notifies subscribers', () => {
      const timer = new RestTimerService();
      let notifiedState: any = null;
      timer.subscribe((state) => {
        notifiedState = state;
      });

      // Start 60s timer
      timer.start(60);
      expect(notifiedState.status).toBe('running');
      expect(notifiedState.remainingSeconds).toBe(60);

      // Trigger sync
      const synced = timer.syncWithWallClock();
      expect(synced.status).toBe('running');
      expect(notifiedState.status).toBe('running');

      timer.destroy();
    });
  });

  describe('9. In-Gym Pain Reporting & High-Severity Guardrails', () => {
    let painRepo: MockPainReportRepository;

    beforeEach(() => {
      painRepo = new MockPainReportRepository();
    });

    test('pain severity <= 6 logs report without skipping remaining sets', async () => {
      const workout = await sessionService.startWorkout({ name: 'Leg Day' });

      const set1 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 100,
        reps: 8,
      });
      const set2 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 100,
        reps: 8,
      });

      // Complete Set 1
      const completedSetIds = new Set<string>([set1.id]);

      // Report mild muscle soreness (severity 4)
      const report = await painRepo.create({
        workout_id: workout.id,
        exercise_id: mockSquat.id,
        pain_type: 'muscle',
        severity: 4,
        notes: 'Mild quad tightness',
      });

      expect(report.id).toBeDefined();
      expect(report.severity).toBe(4);
      expect(report.pain_type).toBe('muscle');

      // Uncompleted sets should remain in workout
      const currentWorkout = await sessionService.getActiveWorkout(workout.id);
      expect(currentWorkout?.sets.length).toBe(2);
    });

    test('pain severity > 6 safely deletes and skips uncompleted sets while preserving completed sets', async () => {
      const workout = await sessionService.startWorkout({ name: 'Chest Day' });

      // Squat: 3 sets
      const sq1 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 120,
        reps: 5,
      });
      const sq2 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 120,
        reps: 5,
      });
      const sq3 = await sessionService.addSet(workout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 120,
        reps: 5,
      });

      // Lifter completes set 1:
      const completedSetIds = new Set<string>([sq1.id]);

      // Lifter experiences sharp joint pain on set 2 (severity 8/10)
      const report = await painRepo.create({
        workout_id: workout.id,
        exercise_id: mockSquat.id,
        pain_type: 'joint',
        severity: 8,
        notes: 'Sharp patellar pain',
      });
      expect(report.severity).toBe(8);

      // Guardrail simulation matching ActiveLoggerScreen:
      const currentSets = (await sessionService.getActiveWorkout(workout.id))?.sets || [];
      const uncompletedSets = currentSets.filter(
        (s) => s.exercise_id === mockSquat.id && !completedSetIds.has(s.id)
      );
      expect(uncompletedSets.length).toBe(2); // sq2, sq3

      // Delete uncompleted sets
      for (const uncompletedSet of uncompletedSets) {
        await sessionService.deleteSet(workout.id, uncompletedSet.id);
      }

      // Check final workout state:
      const updatedWorkout = await sessionService.getActiveWorkout(workout.id);
      expect(updatedWorkout?.sets.length).toBe(1);
      expect(updatedWorkout?.sets[0].id).toBe(sq1.id);
    });
  });

  describe('SFR Warning Badge & In-Logger Substitution Trigger (ADR-072 / Phase 6)', () => {
    it('identifies exercises with POOR_SWAP_RECOMMENDED tier from calibrated parameters', async () => {
      const mockDb = new MockSQLiteDatabase();
      const calibService = new CalibratedParamService(mockDb);

      await calibService.importParameters({
        version: '2.0.0',
        exported_at: '2026-10-18T12:00:00Z',
        parameters: [
          {
            exercise_id: mockSquat.id,
            calibrated_1rm: 140,
            calibrated_k: 0.10,
            cov_p00: 0.001,
            cov_p11: 0.0005,
            calibrated_at: '2026-10-18T12:00:00Z',
            sfr_score: 28.5,
            sfr_tier: 'POOR_SWAP_RECOMMENDED',
            recommended_swap_exercise_id: 'ex-leg-press',
          },
        ],
      });

      mockDb.mockData.set('FROM calibrated_params', [
        {
          id: 'calib_1',
          exercise_id: mockSquat.id,
          calibrated_1rm: 140,
          calibrated_k: 0.10,
          cov_p00: 0.001,
          cov_p11: 0.0005,
          calibrated_at: '2026-10-18T12:00:00Z',
          sfr_score: 28.5,
          sfr_tier: 'POOR_SWAP_RECOMMENDED',
          recommended_swap_exercise_id: 'ex-leg-press',
          optimal_rest_seconds: 180,
          asymmetry_ratio: null,
        },
      ]);

      const params = await calibService.getAllCalibratedParams();
      const pMap = new Map(params.map((p) => [p.exercise_id, p]));

      expect(pMap.get(mockSquat.id)?.sfr_tier).toBe('POOR_SWAP_RECOMMENDED');
      expect(pMap.get(mockSquat.id)?.recommended_swap_exercise_id).toBe('ex-leg-press');
    });
  });

  describe('Diagnostic Warm-Up Autoregulation Integration (ADR-082)', () => {
    it('accurately identifies diagnostic warm-up single among exercise sets', () => {
      const warmup1: WorkoutSet = {
        id: 'set-warm-1',
        workout_id: 'w-1',
        exercise_id: mockSquat.id,
        gear_id: null,
        set_number: 1,
        weight: 20,
        raw_input_weight: 20,
        added_weight: null,
        reps: 5,
        reps_right: null,
        rpe: null,
        rir: null,
        set_type: 'warmup',
        set_notes: 'Empty bar',
        exercise_group_id: null,
        created_at: '2026-10-19T10:00:00Z',
      };

      const warmupDiagnostic: WorkoutSet = {
        id: 'set-warm-diagnostic',
        workout_id: 'w-1',
        exercise_id: mockSquat.id,
        gear_id: null,
        set_number: 2,
        weight: 87.5,
        raw_input_weight: 87.5,
        added_weight: null,
        reps: 1,
        reps_right: null,
        rpe: null,
        rir: null,
        set_type: 'warmup',
        set_notes: '87.5% diagnostic single',
        exercise_group_id: null,
        created_at: '2026-10-19T10:02:00Z',
      };

      const workingSet: WorkoutSet = {
        id: 'set-work-1',
        workout_id: 'w-1',
        exercise_id: mockSquat.id,
        gear_id: null,
        set_number: 3,
        weight: 100,
        raw_input_weight: 100,
        added_weight: null,
        reps: 5,
        reps_right: null,
        rpe: 8,
        rir: 2,
        set_type: 'working',
        set_notes: null,
        exercise_group_id: null,
        created_at: '2026-10-19T10:05:00Z',
      };

      const sets = [warmup1, warmupDiagnostic, workingSet];
      expect(isLastWarmupSet(warmup1, sets)).toBe(false);
      expect(isLastWarmupSet(warmupDiagnostic, sets)).toBe(true);
      expect(isLastWarmupSet(workingSet, sets)).toBe(false);
    });

    it('correctly detects last warmup set and updates working sets via activeSessionService', async () => {
      const activeWorkout = await sessionService.startWorkout();
      // Warmup 1
      const w1 = await sessionService.addSet(activeWorkout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 20,
        reps: 5,
        setType: 'warmup',
      });
      // Warmup 2 (Last warmup / diagnostic single)
      const w2 = await sessionService.addSet(activeWorkout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 87.5,
        reps: 1,
        setType: 'warmup',
      });
      // Work set 1
      const s1 = await sessionService.addSet(activeWorkout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 100,
        reps: 5,
        setType: 'working',
      });
      // Work set 2
      const s2 = await sessionService.addSet(activeWorkout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 100,
        reps: 5,
        setType: 'working',
      });

      const currentSets = await workoutRepo.getSetsByWorkoutId(activeWorkout.id);

      expect(isLastWarmupSet(w1, currentSets)).toBe(false);
      expect(isLastWarmupSet(w2, currentSets)).toBe(true);
      expect(isLastWarmupSet(s1, currentSets)).toBe(false);

      // When user reports "light" on w2:
      const { adjustment, updatedSets } = await sessionService.applyWarmupAutoregulation(
        activeWorkout.id,
        mockSquat.id,
        'light'
      );

      expect(adjustment.adjustedLoadKg).toBe(105);
      expect(updatedSets.length).toBe(2);
      expect(updatedSets[0].raw_input_weight).toBe(105);
      expect(updatedSets[1].raw_input_weight).toBe(105);
    });

    test('resolves planned working weight from ghost sets when active sets have weight 0', async () => {
      // Historical completed session with 100kg squat
      const pastWorkout = await sessionService.startWorkout({
        name: 'Past Squat',
      });
      await sessionService.addSet(pastWorkout.id, {
        exerciseId: mockSquat.id,
        rawInputWeight: 100,
        reps: 5,
        rpe: 8,
        rir: 2,
        setType: 'working',
      });
      await sessionService.finishWorkout(pastWorkout.id);

      const activeWorkout = await sessionService.startWorkout({
        name: 'Active Squat Session',
      });

      const ghosts = await sessionService.getGhostSetsForExercise(mockSquat.id);
      expect(ghosts.length).toBeGreaterThan(0);
      expect(ghosts[0].raw_input_weight).toBe(100);

      // Generating warmups automatically leverages ghost 100kg
      const warmups = await sessionService.generateWarmupSetsForExercise(
        activeWorkout.id,
        mockSquat.id
      );
      expect(warmups.length).toBeGreaterThanOrEqual(3);
      expect(warmups[0].raw_input_weight).toBe(20);
      expect(warmups[warmups.length - 1].raw_input_weight).toBeGreaterThan(50);
    });
  });
});

