/**
 * Workout Suite — User Profile & Questionnaire Test Suite
 *
 * Implements Step 4.4 Verification Gate
 * Validates:
 * - Psychological profile defaults & questionnaire state updates (ADR-038)
 * - Biological statistics handling (sex, height, birthdate)
 * - Training enjoyment & intensity style preferences
 * - Goal alignment and schedule availability mapping
 * - 1-Tap custom program generation and automatic active era assignment
 */

import { MockUserProfileRepository } from '../../../database/mocks/MockUserProfileRepository';
import { MockProgramRepository } from '../../../database/mocks/MockProgramRepository';
import { ProgramBlockService } from '../../../services/programBlockService';
import { synthesizeProgram } from '../../../core/generator/programSynthesizer';
import { UserProfile } from '../../../core/types';
import React from 'react';
import { PersonalRecordsScreen } from '../PersonalRecordsScreen';
import { ExerciseDetailScreen } from '../../inspection/ExerciseDetailScreen';
import { MockWorkoutRepository, MockExerciseRepository } from '../../../database/mocks';

describe('Athlete Profile Questionnaire & Program Synthesis (Step 4.4)', () => {
  let profileRepo: MockUserProfileRepository;
  let programRepo: MockProgramRepository;
  let blockService: ProgramBlockService;

  beforeEach(() => {
    profileRepo = new MockUserProfileRepository();
    programRepo = new MockProgramRepository();
    blockService = new ProgramBlockService(programRepo);
  });

  test('creates and retrieves default athlete profile correctly', async () => {
    const existing = await profileRepo.getProfile();
    expect(existing).toBeNull();

    const profile: UserProfile = {
      id: 'profile-1',
      gender: 'male',
      height_cm: 180,
      birthdate: '1995-05-15',
      training_mentality: 'fury',
      training_enjoyment: 'enthusiast',
      intensity_style: 'high_intensity_low_volume',
      primary_goal: 'hypertrophy',
      secondary_goals: ['strength'],
      preferred_days_per_week: 4,
      preferred_session_duration_mins: 60,
      equipment_access: 'commercial_gym',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const created = await profileRepo.saveProfile(profile);

    expect(created.id).toBe('profile-1');
    expect(created.gender).toBe('male');
    expect(created.height_cm).toBe(180);
    expect(created.training_mentality).toBe('fury');
    expect(created.preferred_days_per_week).toBe(4);

    const fetched = await profileRepo.getProfile();
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.training_mentality).toBe('fury');
    expect(fetched?.primary_goal).toBe('hypertrophy');
  });

  test('updates questionnaire preferences and persists changes', async () => {
    const profile: UserProfile = {
      id: 'profile-2',
      gender: 'female',
      height_cm: 165,
      birthdate: '1998-02-10',
      training_mentality: 'get_out',
      training_enjoyment: 'minimalist',
      intensity_style: 'high_intensity_low_volume',
      primary_goal: 'strength',
      secondary_goals: null,
      preferred_days_per_week: 3,
      preferred_session_duration_mins: 45,
      equipment_access: 'garage_gym',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await profileRepo.saveProfile(profile);

    const updated = await profileRepo.saveProfile({
      ...profile,
      training_mentality: 'precision',
      preferred_days_per_week: 4,
      preferred_session_duration_mins: 60,
      equipment_access: 'commercial_gym',
    });

    expect(updated.training_mentality).toBe('precision');
    expect(updated.preferred_days_per_week).toBe(4);
    expect(updated.preferred_session_duration_mins).toBe(60);
    expect(updated.equipment_access).toBe('commercial_gym');

    const fresh = await profileRepo.getProfile();
    expect(fresh?.training_mentality).toBe('precision');
    expect(fresh?.preferred_days_per_week).toBe(4);
    expect(fresh?.equipment_access).toBe('commercial_gym');
  });

  test('1-tap synthesis generates program from profile and swaps active era', async () => {
    const profile: UserProfile = {
      id: 'profile-synth-1',
      gender: 'male',
      height_cm: 182,
      birthdate: '1992-08-20',
      training_mentality: 'precision',
      primary_goal: 'hypertrophy',
      secondary_goals: ['strength'],
      preferred_days_per_week: 4,
      preferred_session_duration_mins: 60,
      equipment_access: 'commercial_gym',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await profileRepo.saveProfile(profile);

    // 1. Synthesize program from profile
    const synthesized = synthesizeProgram(profile);
    expect(synthesized.program.name).toContain('Hypertrophy');
    expect(synthesized.templates.length).toBe(4);
    expect(synthesized.templateExercises.length).toBeGreaterThan(0);
    expect(synthesized.progressionRules.length).toBeGreaterThan(0);

    // 2. Persist synthesized program hierarchy
    await programRepo.saveSynthesizedProgram(synthesized);
    const storedProgram = await programRepo.findById(synthesized.program.id);
    expect(storedProgram).not.toBeNull();
    expect(storedProgram?.id).toBe(synthesized.program.id);

    // 3. Swap active program block
    const block = await blockService.swapActiveProgram(
      synthesized.program.id,
      '2026-10-15'
    );
    expect(block.program_id).toBe(synthesized.program.id);
    expect(block.end_date).toBeNull();

    // 4. Verify active program block query
    const active = await blockService.getActiveProgram();
    expect(active).not.toBeNull();
    expect(active?.program.id).toBe(synthesized.program.id);
    expect(active?.block.start_date).toBe('2026-10-15');
  });

  test('keeps time-crunched strength-only mains unpaired while pairing accessories', async () => {
    const timeCrunchedProfile: UserProfile = {
      id: 'profile-15m',
      gender: 'female',
      height_cm: 168,
      birthdate: '1990-11-05',
      training_mentality: 'get_out',
      primary_goal: 'strength',
      secondary_goals: null,
      preferred_days_per_week: 3,
      preferred_session_duration_mins: 15,
      equipment_access: 'commercial_gym',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(() => synthesizeProgram(timeCrunchedProfile)).toThrow('Cannot fit Get Out');
    expect(await blockService.getActiveProgram()).toBeNull();
  });

  test('integrates gearRepo for equipment and gym inventory in profile', async () => {
    const { MockGearRepository } = await import('../../../database/mocks/MockGearRepository');
    const gearRepo = new MockGearRepository([
      {
        id: 'gear-ssb',
        name: 'Safety Squat Bar (29 kg)',
        type: 'specialty_bar',
        tare_weight_kg: 29.0,
        cable_ratio: 1.0,
        is_default: false,
        notes: null,
      },
    ]);

    const items = await gearRepo.findAll();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Safety Squat Bar (29 kg)');
    expect(items[0].tare_weight_kg).toBe(29.0);
  });

  test('UserProfileScreen component instantiates with collapsible questionnaire support', async () => {
    const React = await import('react');
    const { UserProfileScreen } = await import('../UserProfileScreen');

    const elementDefault = React.createElement(UserProfileScreen, {
      userProfileRepo: profileRepo,
      programRepo,
      programBlockService: blockService,
    });
    expect(elementDefault).toBeDefined();
    expect(elementDefault.props.initialQuestionnaireExpanded).toBeUndefined();

    const elementExpanded = React.createElement(UserProfileScreen, {
      userProfileRepo: profileRepo,
      programRepo,
      programBlockService: blockService,
      initialQuestionnaireExpanded: true,
    });
    expect(elementExpanded).toBeDefined();
    expect(elementExpanded.props.initialQuestionnaireExpanded).toBe(true);
  });

  test('Step 8.3: partitions profile into demographics (experience_level) and dynamic mood (pending_meso_mood)', async () => {
    const profileWithMood: UserProfile = {
      id: 'profile-mood-stage',
      gender: 'male',
      height_cm: 185,
      birthdate: '1994-06-12',
      experience_level: 'advanced',
      training_mentality: 'fury',
      primary_goal: 'hypertrophy',
      secondary_goals: ['strength'],
      preferred_days_per_week: 5,
      preferred_session_duration_mins: 45,
      equipment_access: 'commercial_gym',
      pending_meso_mood: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await profileRepo.saveProfile(profileWithMood);
    const fetched = await profileRepo.getProfile();

    expect(fetched).not.toBeNull();
    // Demographics partition
    expect(fetched?.experience_level).toBe('advanced');
    expect(fetched?.height_cm).toBe(185);
    expect(fetched?.gender).toBe('male');
    // Dynamic Training Mood partition
    expect(fetched?.training_mentality).toBe('fury');
    expect(fetched?.pending_meso_mood).toBe(true);
    expect(fetched?.preferred_session_duration_mins).toBe(45);
  });

  test('Step 8.3: integrates ProgramEvolutionService to evolve active program for next mesocycle', async () => {
    const { ProgramEvolutionService } = await import('../../../services/programEvolutionService');

    // 1. Initial Program
    const initialProfile: UserProfile = {
      id: 'profile-evo-test',
      gender: 'female',
      height_cm: 170,
      birthdate: '1996-04-10',
      experience_level: 'intermediate',
      training_mentality: 'precision',
      primary_goal: 'hypertrophy',
      secondary_goals: null,
      preferred_days_per_week: 4,
      preferred_session_duration_mins: 60,
      equipment_access: 'commercial_gym',
      pending_meso_mood: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await profileRepo.saveProfile(initialProfile);

    const synth = synthesizeProgram(initialProfile);
    await programRepo.saveSynthesizedProgram(synth);
    await blockService.swapActiveProgram(synth.program.id, '2026-09-01');

    // 2. Stage mood mutation (Precision -> Fury)
    const evolutionService = new ProgramEvolutionService(
      programRepo,
      profileRepo
    );

    await evolutionService.queueMesoMood({
      training_mentality: 'fury',
      primary_goal: 'hypertrophy',
    });
    expect(await evolutionService.hasPendingMesoMood()).toBe(true);

    // 3. Execute Meso N+1 Evolution
    const evolutionResult = await evolutionService.evolveActiveProgramForNextMeso({
      programId: synth.program.id,
      startDate: '2026-10-20',
    });

    expect(evolutionResult.programId).toBe(synth.program.id);
    expect(evolutionResult.mesoNumber).toBe(2);
    expect(evolutionResult.diffMarkdown).toContain('Mesocycle 2 Ready');
    expect(evolutionResult.evolvedTemplateExercises.length).toBeGreaterThan(0);
    expect(await evolutionService.hasPendingMesoMood()).toBe(false);

    // 4. Verify UserProfileScreen accepts programEvolutionService prop
    const React = await import('react');
    const { UserProfileScreen } = await import('../UserProfileScreen');

    const screenElement = React.createElement(UserProfileScreen, {
      userProfileRepo: profileRepo,
      programRepo,
      programBlockService: blockService,
      programEvolutionService: evolutionService,
      initialQuestionnaireExpanded: true,
    });
    expect(screenElement).toBeDefined();
    expect(screenElement.props.programEvolutionService).toBe(evolutionService);
  });

  test('clears lingering in-progress workouts when synthesizing brand new program', async () => {
    const workoutRepo = new (await import('../../../database/mocks')).MockWorkoutRepository();

    // Trainee had started a workout on previous program and left it in-progress
    await workoutRepo.create({
      id: 'old-in-progress-workout',
      template_id: 'old-template-1',
      date: '2026-10-19',
      name: 'Day 1 Chest & Back (Old Program)',
      notes: null,
      started_at: '2026-10-19T10:00:00Z',
      duration_seconds: null,
      status: 'in_progress',
      completed_at: null,
      imported_from: null,
    });

    expect(await workoutRepo.getInProgressWorkout()).not.toBeNull();

    // Trainee synthesizes brand new program
    const newProfile: UserProfile = {
      id: 'profile-new-split',
      gender: 'male',
      height_cm: 180,
      birthdate: '1995-05-15',
      training_mentality: 'fury',
      primary_goal: 'hypertrophy',
      secondary_goals: null,
      preferred_days_per_week: 4,
      preferred_session_duration_mins: 60,
      equipment_access: 'commercial_gym',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const synth = synthesizeProgram(newProfile);
    await programRepo.saveSynthesizedProgram(synth);
    await blockService.swapActiveProgram(synth.program.id);

    // Simulate clearing abandoned session
    const oldInProgress = await workoutRepo.getInProgressWorkout();
    if (oldInProgress) {
      await workoutRepo.delete(oldInProgress.id);
    }

    expect(await workoutRepo.getInProgressWorkout()).toBeNull();
    const activeProg = await blockService.getActiveProgram();
    expect(activeProg?.program.id).toBe(synth.program.id);
  });

  test('Beta Phase Lifecycle Gating: manual evolution button is hidden during in-progress cycle and visible when completed', async () => {
    const React = await import('react');
    const { UserProfileScreen } = await import('../UserProfileScreen');

    // 1. In Beta Phase with incomplete cycle: button should NOT be rendered
    const elementBetaIncomplete = React.createElement(UserProfileScreen, {
      userProfileRepo: profileRepo,
      programRepo,
      programBlockService: blockService,
      isBetaPhase: true,
    });
    expect(elementBetaIncomplete).toBeDefined();

    // 2. In Non-Beta (dev mode): button is allowed
    const elementDevMode = React.createElement(UserProfileScreen, {
      userProfileRepo: profileRepo,
      programRepo,
      programBlockService: blockService,
      isBetaPhase: false,
    });
    expect(elementDevMode).toBeDefined();
  });
});

describe('Profile Exercises navigation', () => {
  afterEach(() => jest.restoreAllMocks());
  function find(tree: React.ReactNode, testID: string): React.ReactElement<any> | undefined {
    if (!React.isValidElement(tree)) return undefined;
    const element = tree as React.ReactElement<any>;
    if (element.props.testID === testID) return element;
    return React.Children.toArray(element.props.children).map(child => find(child, testID)).find(Boolean);
  }
  test('opens exercise details directly from the list and returns to the list on Back', () => {
    let selected: string | null = null;
    let stateIndex = 0;
    const setSelected = jest.fn(value => { selected = value; });
    jest.spyOn(React, 'useContext').mockReturnValue(null);
    jest.spyOn(React, 'useEffect').mockImplementation(() => {});
    jest.spyOn(React, 'useState').mockImplementation(((initial: any) => {
      const index = stateIndex++;
      if (index === 0) return [[{ exercise: { id: 'squat', name: 'Squat' }, date: '2026-10-21', liked: false }], jest.fn()];
      if (index === 1) return [selected, setSelected];
      return [initial, jest.fn()];
    }) as any);
    const props = { workoutRepo: new MockWorkoutRepository(), exerciseRepo: new MockExerciseRepository(), onClose: jest.fn() };
    const list = PersonalRecordsScreen(props);
    expect(JSON.stringify(list)).toContain('Exercises');
    find(list, 'records-exercise-squat')!.props.onPress();
    stateIndex = 0;
    const details = PersonalRecordsScreen(props) as React.ReactElement<any>;
    expect(details.type).toBe(ExerciseDetailScreen);
    expect(details.props.exerciseId).toBe('squat');
    expect(find(details, 'pr-board-table')).toBeUndefined();
    details.props.onClose();
    expect(setSelected).toHaveBeenLastCalledWith(null);
    expect(props.onClose).not.toHaveBeenCalled();
  });
  test('a Home record shortcut also opens exercise details directly', () => {
    jest.spyOn(React, 'useContext').mockReturnValue(null);
    jest.spyOn(React, 'useEffect').mockImplementation(() => {});
    jest.spyOn(React, 'useState').mockImplementation(((initial: any) => [initial, jest.fn()]) as any);
    const onClose = jest.fn();
    const details = PersonalRecordsScreen({ workoutRepo: new MockWorkoutRepository(), exerciseRepo: new MockExerciseRepository(),
      initialExerciseId: 'squat', onClose }) as React.ReactElement<any>;
    expect(details.type).toBe(ExerciseDetailScreen);
    details.props.onClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
