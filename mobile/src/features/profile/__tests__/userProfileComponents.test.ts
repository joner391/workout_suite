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
      training_enjoyment: 'enthusiast',
      intensity_style: 'volume_accumulation',
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
    expect(created.training_enjoyment).toBe('enthusiast');
    expect(created.intensity_style).toBe('volume_accumulation');
    expect(created.preferred_days_per_week).toBe(4);

    const fetched = await profileRepo.getProfile();
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.primary_goal).toBe('hypertrophy');
  });

  test('updates questionnaire preferences and persists changes', async () => {
    const profile: UserProfile = {
      id: 'profile-2',
      gender: 'female',
      height_cm: 165,
      birthdate: '1998-02-10',
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
      training_enjoyment: 'neutral',
      preferred_days_per_week: 4,
      preferred_session_duration_mins: 60,
      equipment_access: 'commercial_gym',
    });

    expect(updated.training_enjoyment).toBe('neutral');
    expect(updated.preferred_days_per_week).toBe(4);
    expect(updated.preferred_session_duration_mins).toBe(60);
    expect(updated.equipment_access).toBe('commercial_gym');

    const fresh = await profileRepo.getProfile();
    expect(fresh?.preferred_days_per_week).toBe(4);
    expect(fresh?.equipment_access).toBe('commercial_gym');
  });

  test('1-tap synthesis generates program from profile and swaps active era', async () => {
    const profile: UserProfile = {
      id: 'profile-synth-1',
      gender: 'male',
      height_cm: 182,
      birthdate: '1992-08-20',
      training_enjoyment: 'enthusiast',
      intensity_style: 'volume_accumulation',
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

  test('handles minimalist time-crunched profile with superset generation', async () => {
    const minimalistProfile: UserProfile = {
      id: 'profile-minimalist',
      gender: 'female',
      height_cm: 168,
      birthdate: '1990-11-05',
      training_enjoyment: 'minimalist',
      intensity_style: 'high_intensity_low_volume',
      primary_goal: 'strength',
      secondary_goals: null,
      preferred_days_per_week: 2,
      preferred_session_duration_mins: 30,
      equipment_access: 'dumbbells_only',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const synthesized = synthesizeProgram(minimalistProfile);
    expect(synthesized.summary.daysPerWeek).toBe(2);
    expect(synthesized.summary.splitType).toBe('full_body');
    expect(synthesized.summary.hasSupersets).toBe(true);
    expect(synthesized.templates.length).toBe(2);

    await programRepo.saveSynthesizedProgram(synthesized);
    const details = await programRepo.getProgramWithDetails(synthesized.program.id);
    expect(details).not.toBeNull();
    expect(details?.templates.length).toBe(2);
  });
});
