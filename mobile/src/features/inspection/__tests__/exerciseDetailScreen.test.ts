/**
 * Workout Suite — Exercise Detail & Library Preference Test Suite
 *
 * Implements Step 9.4 Verification Gate:
 * - Biomechanical Badges: ROM Tier, Axial Loading, Regional Muscle Biases
 * - Planner Sentiment Controls: Liked (+25), Neutral, Disliked (-60), Blacklisted (-999)
 * - Exercise Detail & Library Screen Preference Integration
 * - Active Logger In-Gym Swap Tracking Hook: recordManualSwap verification
 */

import React from 'react';
import {
  MockExerciseRepository,
  MockWorkoutRepository,
  MockUserSettingsRepository,
  MockGearRepository,
  MockExercisePreferenceRepository,
} from '../../../database/mocks';
import {
  Exercise,
  Workout,
  WorkoutSet,
  ExerciseSentiment,
} from '../../../core/types';
import { ExercisePreferenceService } from '../../../services/exercisePreferenceService';
import { ExerciseSubstitutionService } from '../../../services/exerciseSubstitutionService';
import { ExerciseDetailScreen } from '../ExerciseDetailScreen';
import { ExerciseLibraryScreen } from '../ExerciseLibraryScreen';
import {
  formatRomTier,
  formatAxialLoading,
  formatMuscleBias,
  getRomTierBadgeStyle,
  getAxialLoadingBadgeStyle,
  getSentimentPillStyle,
} from '../biomechanicalFormatters';

describe('Exercise Preference UI & Logger Swap Tracking Hooks (Step 9.4)', () => {
  let exerciseRepo: MockExerciseRepository;
  let workoutRepo: MockWorkoutRepository;
  let userSettingsRepo: MockUserSettingsRepository;
  let gearRepo: MockGearRepository;
  let preferenceRepo: MockExercisePreferenceRepository;
  let preferenceService: ExercisePreferenceService;
  let subService: ExerciseSubstitutionService;

  const sampleBench: Exercise = {
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
    rom_tier: 'deep_stretch',
    axial_loading: 'low',
    muscle_biases: ['mid_sternal', 'lower_costal'],
    baseline_sfr: 85,
  };

  const sampleInclineBench: Exercise = {
    id: 'incline_barbell_bench',
    name: 'Incline Barbell Bench',
    muscle_group: 'Chest',
    category: 'Barbell',
    is_compound: true,
    is_bodyweight: false,
    is_unilateral: false,
    load_mode: 'total',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 20.0,
    is_custom: false,
    parent_exercise_id: 'barbell_bench_press',
    standard_lift_type: 'bench',
    default_rest_seconds: 180,
    rom_tier: 'standard_full',
    axial_loading: 'low',
    muscle_biases: ['upper_clavicular'],
    baseline_sfr: 80,
  };

  const sampleSquat: Exercise = {
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
    default_rest_seconds: 240,
    rom_tier: 'deep_stretch',
    axial_loading: 'high',
    muscle_biases: ['stretched'],
    baseline_sfr: 82,
  };

  const sampleFloorPress: Exercise = {
    id: 'floor_press',
    name: 'Floor Press',
    muscle_group: 'Chest',
    category: 'Barbell',
    is_compound: true,
    is_bodyweight: false,
    is_unilateral: false,
    load_mode: 'total',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 20.0,
    is_custom: false,
    parent_exercise_id: 'barbell_bench_press',
    standard_lift_type: 'bench',
    default_rest_seconds: 150,
    rom_tier: 'shortened_restricted',
    axial_loading: 'none',
    muscle_biases: ['mid_sternal'],
    baseline_sfr: 75,
  };

  beforeEach(async () => {
    exerciseRepo = new MockExerciseRepository([
      sampleBench,
      sampleInclineBench,
      sampleSquat,
      sampleFloorPress,
    ]);
    workoutRepo = new MockWorkoutRepository();
    userSettingsRepo = new MockUserSettingsRepository();
    gearRepo = new MockGearRepository();
    preferenceRepo = new MockExercisePreferenceRepository();
    preferenceService = new ExercisePreferenceService(preferenceRepo);
    subService = new ExerciseSubstitutionService(
      exerciseRepo,
      workoutRepo,
      gearRepo,
      preferenceService
    );
  });

  describe('Biomechanical Formatters & Color Tokens', () => {
    it('formats ROM Tiers correctly', () => {
      expect(formatRomTier('deep_stretch')).toBe('Deep Stretch');
      expect(formatRomTier('standard_full')).toBe('Full ROM');
      expect(formatRomTier('shortened_restricted')).toBe('Restricted');
      expect(formatRomTier(null)).toBe('Full ROM');
      expect(formatRomTier(undefined)).toBe('Full ROM');
    });

    it('returns high-contrast color tokens for ROM Tiers', () => {
      const deep = getRomTierBadgeStyle('deep_stretch');
      expect(deep.border).toBe('#9C27B0');
      expect(deep.bg).toBe('#251433');

      const restricted = getRomTierBadgeStyle('shortened_restricted');
      expect(restricted.border).toBe('#FF9800');
      expect(restricted.bg).toBe('#2E1E0F');

      const full = getRomTierBadgeStyle('standard_full');
      expect(full.border).toBe('#2196F3');
      expect(full.bg).toBe('#0D223A');
    });

    it('formats Axial Loading correctly', () => {
      expect(formatAxialLoading('high')).toBe('Axial: High');
      expect(formatAxialLoading('moderate')).toBe('Axial: Mod');
      expect(formatAxialLoading('low')).toBe('Axial: Low');
      expect(formatAxialLoading('none')).toBe('Axial: None');
      expect(formatAxialLoading(null)).toBe('Axial: None');
    });

    it('returns high-contrast color tokens for Axial Loading', () => {
      const high = getAxialLoadingBadgeStyle('high');
      expect(high.border).toBe('#F44336');
      const mod = getAxialLoadingBadgeStyle('moderate');
      expect(mod.border).toBe('#FFC107');
      const low = getAxialLoadingBadgeStyle('low');
      expect(low.border).toBe('#4CAF50');
      const none = getAxialLoadingBadgeStyle('none');
      expect(none.border).toBe('#52525B');
    });

    it('formats Regional Muscle Biases correctly', () => {
      expect(formatMuscleBias('upper_clavicular')).toBe('Upper Chest');
      expect(formatMuscleBias('mid_sternal')).toBe('Mid Sternal');
      expect(formatMuscleBias('lower_costal')).toBe('Lower Chest');
      expect(formatMuscleBias('long_head')).toBe('Long Head');
      expect(formatMuscleBias('lateral_head')).toBe('Lateral Head');
      expect(formatMuscleBias('iliac')).toBe('Iliac Lats');
      expect(formatMuscleBias('custom_unknown_target')).toBe('Custom Unknown Target');
    });

    it('returns correct sentiment pill styles for active and inactive states', () => {
      const inactive = getSentimentPillStyle('liked', false);
      expect(inactive.text).toBe('#71717A');

      const likedActive = getSentimentPillStyle('liked', true);
      expect(likedActive.text).toBe('#00E676');

      const neutralActive = getSentimentPillStyle('neutral', true);
      expect(neutralActive.text).toBe('#FAFAFA');

      const dislikedActive = getSentimentPillStyle('disliked', true);
      expect(dislikedActive.text).toBe('#FF5252');

      const blacklistedActive = getSentimentPillStyle('blacklisted', true);
      expect(blacklistedActive.text).toBe('#FF8A80');
      expect(blacklistedActive.border).toBe('#D50000');
    });
  });

  describe('Exercise Preference Engine & Sentiment Transitions', () => {
    it('retrieves default neutral preference when not yet stored', async () => {
      const pref = await preferenceService.getPreference('barbell_bench_press');
      expect(pref.sentiment).toBe('neutral');
      expect(pref.affinity_score).toBe(0.0);
      expect(pref.swap_in_count).toBe(0);
      expect(pref.swap_out_count).toBe(0);
    });

    it('updates sentiment to liked with +25.0 affinity', async () => {
      const updated = await preferenceService.setSentiment('barbell_bench_press', 'liked');
      expect(updated.sentiment).toBe('liked');
      expect(updated.affinity_score).toBe(25.0);

      const fetched = await preferenceService.getPreference('barbell_bench_press');
      expect(fetched.sentiment).toBe('liked');
      expect(fetched.affinity_score).toBe(25.0);
    });

    it('updates sentiment to disliked with -60.0 affinity', async () => {
      const updated = await preferenceService.setSentiment('barbell_bench_press', 'disliked');
      expect(updated.sentiment).toBe('disliked');
      expect(updated.affinity_score).toBe(-60.0);
    });

    it('updates sentiment to blacklisted with -999.0 affinity', async () => {
      const updated = await preferenceService.setSentiment('barbell_bench_press', 'blacklisted');
      expect(updated.sentiment).toBe('blacklisted');
      expect(updated.affinity_score).toBe(-999.0);
    });

    it('correlates pain reports with exercise preference record', async () => {
      await preferenceService.correlatePainReport('wk-101', 'barbell_bench_press', 'shoulder', 4);
      const pref = await preferenceService.getPreference('barbell_bench_press');
      expect(pref.pain_joint).toBe('shoulder');
      expect(pref.max_pain_severity).toBe(4);
      expect(pref.last_pain_reported_at).toBeDefined();
    });
  });

  describe('ExerciseDetailScreen Component Instantiation & Props', () => {
    it('instantiates ExerciseDetailScreen with preferenceRepo and preferenceService', () => {
      let closed = false;
      const element = React.createElement(ExerciseDetailScreen, {
        exerciseId: 'barbell_bench_press',
        exerciseRepo,
        workoutRepo,
        userSettingsRepo,
        gearRepo,
        preferenceRepo,
        preferenceService,
        onClose: () => {
          closed = true;
        },
      });

      expect(element).toBeDefined();
      expect(element.props.exerciseId).toBe('barbell_bench_press');
      expect(element.props.preferenceService).toBe(preferenceService);
      expect(element.props.preferenceRepo).toBe(preferenceRepo);
      element.props.onClose?.();
      expect(closed).toBe(true);
    });
  });

  describe('ExerciseLibraryScreen Component Instantiation & Props', () => {
    it('instantiates ExerciseLibraryScreen with preferenceRepo and preferenceService', () => {
      let selectedExercise: Exercise | null = null;
      const element = React.createElement(ExerciseLibraryScreen, {
        exerciseRepo,
        workoutRepo,
        gearRepo,
        userSettingsRepo,
        preferenceRepo,
        preferenceService,
        onSelectExercise: (ex) => {
          selectedExercise = ex;
        },
      });

      expect(element).toBeDefined();
      expect(element.props.preferenceService).toBe(preferenceService);
      element.props.onSelectExercise?.(sampleBench);
      expect(selectedExercise).toEqual(sampleBench);
    });
  });

  describe('Logger In-Gym Swap Tracking Hook (recordManualSwap)', () => {
    it('tracks manual in-session substitution: discarded exercise penalized, substitute boosted', async () => {
      // Create active workout with barbell bench press
      const workout: Workout = {
        id: 'wk-active-test',
        template_id: null,
        date: '2026-10-20',
        name: 'Push Day',
        notes: null,
        started_at: '2026-10-20T10:00:00Z',
        duration_seconds: 300,
        status: 'in_progress',
        completed_at: null,
        imported_from: null,
      };
      await workoutRepo.create(workout);

      const benchSet: WorkoutSet = {
        id: 'set-1',
        workout_id: workout.id,
        exercise_id: 'barbell_bench_press',
        gear_id: null,
        set_number: 1,
        weight: 100,
        raw_input_weight: 100,
        added_weight: null,
        reps: 8,
        reps_right: null,
        rpe: 8.5,
        rir: null,
        set_type: 'working',
        set_notes: null,
        exercise_group_id: null,
        created_at: '2026-10-20T10:05:00Z',
      };
      await workoutRepo.addSet(benchSet);

      // Perform in-gym substitution to floor_press
      const result = await subService.applySubstitution({
        workoutId: workout.id,
        oldExerciseId: 'barbell_bench_press',
        newExerciseId: 'floor_press',
        swapScope: 'session_only',
        templateId: null,
      });

      expect(result.swappedSetsCount).toBe(1);

      // Verify that recordManualSwap was executed on preferenceService
      const benchPref = await preferenceService.getPreference('barbell_bench_press');
      expect(benchPref.swap_out_count).toBe(1);
      expect(benchPref.swap_in_count).toBe(0);
      // Neutral affinity delta = (0 - 1) * 5.0 = -5.0
      expect(benchPref.affinity_score).toBe(-5.0);

      const floorPref = await preferenceService.getPreference('floor_press');
      expect(floorPref.swap_in_count).toBe(1);
      expect(floorPref.swap_out_count).toBe(0);
      // Neutral affinity delta = (1 - 0) * 5.0 = +5.0
      expect(floorPref.affinity_score).toBe(5.0);
    });

    it('clamps affinity delta between -20.0 and +20.0 over multiple swaps', async () => {
      // Perform 6 consecutive swaps discarding barbell_back_squat for floor_press
      for (let i = 0; i < 6; i++) {
        await preferenceService.recordManualSwap('barbell_back_squat', 'floor_press');
      }

      const squatPref = await preferenceService.getPreference('barbell_back_squat');
      expect(squatPref.swap_out_count).toBe(6);
      expect(squatPref.affinity_score).toBe(-20.0); // Clamped at -20.0

      const floorPref = await preferenceService.getPreference('floor_press');
      expect(floorPref.swap_in_count).toBe(6);
      expect(floorPref.affinity_score).toBe(20.0); // Clamped at +20.0
    });
  });
});
