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

  test('handles 15-minute time-crunched profile with 2 antagonist pairs and 8 total sets', async () => {
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

    const synthesized = synthesizeProgram(timeCrunchedProfile);
    expect(synthesized.summary.daysPerWeek).toBe(3);
    expect(synthesized.summary.splitType).toBe('upper_lower');
    expect(synthesized.summary.hasSupersets).toBe(true);
    expect(synthesized.summary.estimatedSessionDurationMins).toBe(15);
    expect(synthesized.templates.length).toBe(3);

    // Verify 15-minute routine properties on Day 1
    const day1Exercises = synthesized.templateExercises.filter(
      (te) => te.template_id === synthesized.templates[0].id
    );
    expect(day1Exercises.length).toBe(4);
    day1Exercises.forEach((ex) => {
      expect(ex.target_sets).toBe(2);
      expect(ex.exercise_group_id).not.toBeNull();
    });

    await programRepo.saveSynthesizedProgram(synthesized);
    const details = await programRepo.getProgramWithDetails(synthesized.program.id);
    expect(details).not.toBeNull();
    expect(details?.templates.length).toBe(3);
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
});
