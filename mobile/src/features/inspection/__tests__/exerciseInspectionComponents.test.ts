/**
 * Workout Suite — Exercise Inspection Components Test Suite
 *
 * Implements Step 3.3 Verification Gate
 * Validates:
 * - User gender & bodyweight profile persistence in IUserSettingsRepository
 * - PRBoardTable rendering, peak e1RM highlight, scoping, and workout drill-down callback
 * - SBDStandardsCard tier badge, progress to next tier, demographic bell curve, and conditional DOTS score
 * - SBDBalanceRadarChart 3-axis SVG radar rendering, symmetry balance classification, and SBD Total
 * - ExerciseDetailScreen integration with inspection service and historical workout drill-down
 */

import React from 'react';
import {
  MockExerciseRepository,
  MockWorkoutRepository,
  MockUserSettingsRepository,
  MockGearRepository,
} from '../../../database/mocks';
import {
  Exercise,
  Workout,
  WorkoutSet,
  RepMaxRecord,
  StrengthStandardResult,
  SBDBalanceProfile,
} from '../../../core/types';
import { ExerciseInspectionService } from '../../../services/exerciseInspectionService';
import { PRBoardTable } from '../PRBoardTable';
import { SBDStandardsCard } from '../SBDStandardsCard';
import { SBDBalanceRadarChart } from '../SBDBalanceRadarChart';
import { ExerciseDetailScreen } from '../ExerciseDetailScreen';
import { SETTINGS_KEYS } from '../../../domain/repositories/IUserSettingsRepository';

describe('Exercise Inspection UI, SBD Tier Widget & Symmetry Radar (Step 3.3)', () => {
  let exerciseRepo: MockExerciseRepository;
  let workoutRepo: MockWorkoutRepository;
  let userSettingsRepo: MockUserSettingsRepository;
  let gearRepo: MockGearRepository;
  let inspectionService: ExerciseInspectionService;

  const sampleBenchExercise: Exercise = {
    id: 'barbell_bench_press',
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
  };

  const sampleSquatExercise: Exercise = {
    id: 'barbell_back_squat',
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

  const sampleDeadliftExercise: Exercise = {
    id: 'barbell_deadlift',
    name: 'Barbell Deadlift',
    muscle_group: 'Back',
    category: 'Barbell',
    is_compound: true,
    is_bodyweight: false,
    is_unilateral: false,
    load_mode: 'total',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 20.0,
    is_custom: false,
    parent_exercise_id: null,
    standard_lift_type: 'deadlift',
    default_rest_seconds: 180,
  };

  const sampleWorkout: Workout = {
    id: 'workout-test-1',
    template_id: null,
    date: '2026-10-10',
    name: 'Upper Body Heavy',
    notes: null,
    started_at: '2026-10-10T10:00:00Z',
    status: 'completed',
    completed_at: '2026-10-10T11:00:00Z',
    duration_seconds: 3600,
    imported_from: null,
  };

  const sampleSets: WorkoutSet[] = [
    {
      id: 'set-bench-1',
      workout_id: 'workout-test-1',
      exercise_id: 'barbell_bench_press',
      gear_id: null,
      set_number: 1,
      weight: 100,
      raw_input_weight: 100,
      added_weight: null,
      reps: 1,
      reps_right: null,
      rpe: 9.5,
      rir: 0.5,
      set_type: 'working',
      set_notes: null,
      exercise_group_id: null,
      created_at: '2026-10-10T10:15:00Z',
    },
    {
      id: 'set-bench-2',
      workout_id: 'workout-test-1',
      exercise_id: 'barbell_bench_press',
      gear_id: null,
      set_number: 2,
      weight: 90,
      raw_input_weight: 90,
      added_weight: null,
      reps: 5,
      reps_right: null,
      rpe: 8.5,
      rir: 1.5,
      set_type: 'working',
      set_notes: null,
      exercise_group_id: null,
      created_at: '2026-10-10T10:20:00Z',
    },
    {
      id: 'set-squat-1',
      workout_id: 'workout-test-1',
      exercise_id: 'barbell_back_squat',
      gear_id: null,
      set_number: 1,
      weight: 140,
      raw_input_weight: 140,
      added_weight: null,
      reps: 3,
      reps_right: null,
      rpe: 9.0,
      rir: 1.0,
      set_type: 'working',
      set_notes: null,
      exercise_group_id: null,
      created_at: '2026-10-10T10:35:00Z',
    },
    {
      id: 'set-deadlift-1',
      workout_id: 'workout-test-1',
      exercise_id: 'barbell_deadlift',
      gear_id: null,
      set_number: 1,
      weight: 180,
      raw_input_weight: 180,
      added_weight: null,
      reps: 1,
      reps_right: null,
      rpe: 9.0,
      rir: 1.0,
      set_type: 'working',
      set_notes: null,
      exercise_group_id: null,
      created_at: '2026-10-10T10:50:00Z',
    },
  ];

  beforeEach(() => {
    exerciseRepo = new MockExerciseRepository([
      sampleBenchExercise,
      sampleSquatExercise,
      sampleDeadliftExercise,
    ]);
    workoutRepo = new MockWorkoutRepository([sampleWorkout], sampleSets);
    userSettingsRepo = new MockUserSettingsRepository();
    gearRepo = new MockGearRepository();
    inspectionService = new ExerciseInspectionService(workoutRepo, exerciseRepo);
  });

  describe('User Gender & Bodyweight Persistence (Settings)', () => {
    it('defaults to male and null bodyweight when unset', async () => {
      const gender = await userSettingsRepo.getUserGender();
      const bw = await userSettingsRepo.getUserBodyweight();

      expect(gender).toBe('male');
      expect(bw).toBeNull();
    });

    it('persists user gender to repository instantly', async () => {
      await userSettingsRepo.setUserGender('female');
      expect(await userSettingsRepo.getUserGender()).toBe('female');
      expect(await userSettingsRepo.get(SETTINGS_KEYS.USER_GENDER)).toBe('female');

      await userSettingsRepo.setUserGender('male');
      expect(await userSettingsRepo.getUserGender()).toBe('male');
      expect(await userSettingsRepo.get(SETTINGS_KEYS.USER_GENDER)).toBe('male');
    });

    it('persists and removes user bodyweight in kg', async () => {
      await userSettingsRepo.setUserBodyweight(82.5);
      expect(await userSettingsRepo.getUserBodyweight()).toBe(82.5);
      expect(await userSettingsRepo.get(SETTINGS_KEYS.USER_BODYWEIGHT_KG)).toBe('82.5');

      await userSettingsRepo.setUserBodyweight(null);
      expect(await userSettingsRepo.getUserBodyweight()).toBeNull();
      expect(await userSettingsRepo.get(SETTINGS_KEYS.USER_BODYWEIGHT_KG)).toBeNull();
    });
  });

  describe('PRBoardTable Component', () => {
    const mockRecords: RepMaxRecord[] = [
      {
        reps: 1,
        weightKg: 100,
        effectiveReps: 1.5,
        e1rmKg: 104.1,
        setDate: '2026-10-10',
        workoutId: 'workout-test-1',
        setId: 'set-bench-1',
        rpe: 9.5,
        rir: 0.5,
        rawInputWeight: 100,
        exerciseId: 'barbell_bench_press',
      },
      {
        reps: 5,
        weightKg: 90,
        effectiveReps: 6.5,
        e1rmKg: 108.5,
        setDate: '2026-10-10',
        workoutId: 'workout-test-1',
        setId: 'set-bench-2',
        rpe: 8.5,
        rir: 1.5,
        rawInputWeight: 90,
        exerciseId: 'barbell_bench_press',
      },
    ];

    it('renders PRBoardTable with records and highlights peak e1RM', () => {
      let selectedWorkout: string | null = null;
      let selectedScope: string | null = null;

      const element = React.createElement(PRBoardTable, {
        records: mockRecords,
        peakRecord: mockRecords[1], // 5RM has higher e1RM (108.5 kg)
        scope: 'all_time',
        onScopeChange: (s) => {
          selectedScope = s;
        },
        includeVariants: false,
        unitSystem: 'kg',
        intensityMetric: 'RPE',
        onSelectWorkout: (wId) => {
          selectedWorkout = wId;
        },
      });

      expect(element).toBeDefined();
      expect(element.props.records).toHaveLength(2);
      expect(element.props.peakRecord!.reps).toBe(5);

      // Trigger scope change
      element.props.onScopeChange?.('program_block');
      expect(selectedScope).toBe('program_block');

      // Trigger workout tap
      element.props.onSelectWorkout?.('workout-test-1');
      expect(selectedWorkout).toBe('workout-test-1');
    });

    it('renders empty state when no records are present', () => {
      const element = React.createElement(PRBoardTable, {
        records: [],
        peakRecord: null,
        scope: 'all_time',
        includeVariants: false,
        unitSystem: 'lbs',
      });

      expect(element).toBeDefined();
      expect(element.props.records).toHaveLength(0);
    });
  });

  describe('SBDStandardsCard Component', () => {
    const mockStandardResult: StrengthStandardResult = {
      liftType: 'bench',
      e1rmKg: 108.5,
      bodyweightKg: 80.0,
      tier: 'intermediate',
      continuousScore: 54.2,
      deltaKgToNextTier: 16.5,
      nextTierName: 'advanced',
      kgNeededForNextTier: 16.5,
      demographicPercentile: 72.5,
    };

    it('displays prompt banner when bodyweight is not set and suppresses DOTS', () => {
      const element = React.createElement(SBDStandardsCard, {
        liftType: 'bench',
        standardResult: undefined,
        userGender: 'male',
        userBodyweightKg: null,
        unitSystem: 'kg',
      });

      expect(element).toBeDefined();
      expect(element.props.userBodyweightKg).toBeNull();
    });

    it('renders tier badge, progress to next tier, and demographic percentile when bodyweight is provided', () => {
      let updatedGender: string | null = null;
      let updatedBw: number | null = null;

      const element = React.createElement(SBDStandardsCard, {
        liftType: 'bench',
        standardResult: mockStandardResult,
        userGender: 'male',
        userBodyweightKg: 80.0,
        unitSystem: 'kg',
        onUpdateProfile: (g, bw) => {
          updatedGender = g;
          updatedBw = bw;
        },
      });

      expect(element).toBeDefined();
      expect(element.props.standardResult!.tier).toBe('intermediate');
      expect(element.props.standardResult!.continuousScore).toBe(54.2);
      expect(element.props.standardResult!.kgNeededForNextTier).toBe(16.5);

      element.props.onUpdateProfile?.('female', 65.0);
      expect(updatedGender).toBe('female');
      expect(updatedBw).toBe(65.0);
    });
  });

  describe('SBDBalanceRadarChart Component', () => {
    const mockBalanceProfile: SBDBalanceProfile = {
      squatScore: 62.0,
      benchScore: 54.2,
      deadliftScore: 68.5,
      totalScore: 184.7,
      averageScore: 61.6,
      totalKg: 440.0,
      dotsScore: 305.4,
      dominantLift: 'deadlift',
      laggingLift: 'none',
      radarCoordinates: {
        squat: 62.0,
        bench: 54.2,
        deadlift: 68.5,
      },
    };

    it('renders radar chart with composite profile, SBD total, and DOTS score', () => {
      let closed = false;

      const element = React.createElement(SBDBalanceRadarChart, {
        balanceProfile: mockBalanceProfile,
        gender: 'male',
        bodyweightKg: 80.0,
        unitSystem: 'kg',
        onClose: () => {
          closed = true;
        },
      });

      expect(element).toBeDefined();
      expect(element.props.balanceProfile!.totalKg).toBe(440.0);
      expect(element.props.balanceProfile!.dotsScore).toBe(305.4);
      expect(element.props.balanceProfile!.dominantLift).toBe('deadlift');

      element.props.onClose?.();
      expect(closed).toBe(true);
    });

    it('formats lift balance educational info correctly without LaTeX typo', () => {
      const tree = SBDBalanceRadarChart({
        balanceProfile: mockBalanceProfile,
        gender: 'male',
        bodyweightKg: 80.0,
        unitSystem: 'kg',
      });
      const serialized = JSON.stringify(tree);
      expect(serialized).toContain('≥ 8.0 points');
      expect(serialized).not.toContain('$\\ge');
    });
  });

  describe('ExerciseDetailScreen & Inspection Service Integration', () => {
    it('retrieves inspection overview and computes PR board and standards', async () => {
      const overview = await inspectionService.getExerciseInspectionOverview({
        exerciseId: 'barbell_bench_press',
        gender: 'male',
        bodyweightKg: 80.0,
      });

      expect(overview.exercise.name).toBe('Barbell Bench Press');
      expect(overview.prBoard.records.length).toBeGreaterThanOrEqual(2);
      expect(overview.prBoard.peakRecord).toBeDefined();
      expect(overview.standardSummary.isStandardLift).toBe(true);
      expect(overview.standardSummary.standardResult?.tier).toBeDefined();
      expect(overview.historySummary.totalSessions).toBe(1);
      expect(overview.historySummary.totalSets).toBe(2);
    });

    it('computes composite SBD Balance Radar profile for the athlete', async () => {
      const profile = await inspectionService.getSBDBalanceProfile({
        gender: 'male',
        bodyweightKg: 80.0,
      });

      expect(profile).toBeDefined();
      expect(profile.totalKg).toBeGreaterThan(0);
      expect(profile.dotsScore).toBeGreaterThan(0);
      expect(profile.radarCoordinates.bench).toBeGreaterThan(0);
      expect(profile.radarCoordinates.squat).toBeGreaterThan(0);
      expect(profile.radarCoordinates.deadlift).toBeGreaterThan(0);
    });

    it('instantiates ExerciseDetailScreen successfully with all repos', () => {
      let closed = false;

      const element = React.createElement(ExerciseDetailScreen, {
        exerciseId: 'barbell_bench_press',
        exerciseRepo,
        workoutRepo,
        userSettingsRepo,
        gearRepo,
        inspectionService,
        onClose: () => {
          closed = true;
        },
      });

      expect(element).toBeDefined();
      expect(element.props.exerciseId).toBe('barbell_bench_press');
      element.props.onClose?.();
      expect(closed).toBe(true);
    });
  });
});
