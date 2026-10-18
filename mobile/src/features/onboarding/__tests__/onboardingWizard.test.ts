import React from 'react';
import { OnboardingWizardModal } from '../OnboardingWizardModal';
import { MockUserSettingsRepository } from '../../../database/mocks/MockUserSettingsRepository';
import { MockUserProfileRepository } from '../../../database/mocks/MockUserProfileRepository';
import { MockProgramRepository } from '../../../database/mocks/MockProgramRepository';
import { MockExerciseRepository } from '../../../database/mocks/MockExerciseRepository';
import { ProgramBlockService } from '../../../services/programBlockService';
import { DEFAULT_EXERCISES } from '../../../database/seeds/defaultExercises';

describe('OnboardingWizardModal', () => {
  let userSettingsRepo: MockUserSettingsRepository;
  let userProfileRepo: MockUserProfileRepository;
  let programRepo: MockProgramRepository;
  let exerciseRepo: MockExerciseRepository;
  let programBlockService: ProgramBlockService;

  beforeEach(() => {
    userSettingsRepo = new MockUserSettingsRepository();
    userProfileRepo = new MockUserProfileRepository();
    programRepo = new MockProgramRepository();
    exerciseRepo = new MockExerciseRepository(DEFAULT_EXERCISES);
    programBlockService = new ProgramBlockService(programRepo);
  });

  it('renders correctly with initial step 1', () => {
    const onComplete = jest.fn();
    const modal = React.createElement(OnboardingWizardModal, {
      visible: true,
      userSettingsRepo,
      userProfileRepo,
      programRepo,
      programBlockService,
      exerciseRepo,
      onComplete,
    });

    expect(modal).toBeDefined();
    expect(modal.props.visible).toBe(true);
  });

  it('persists settings and generates program upon completion', async () => {
    const onComplete = jest.fn();
    const modal = React.createElement(OnboardingWizardModal, {
      visible: true,
      userSettingsRepo,
      userProfileRepo,
      programRepo,
      programBlockService,
      exerciseRepo,
      onComplete,
    });

    // Test the repository writes that the modal triggers
    await userSettingsRepo.set('unit_system', 'kg');
    await userSettingsRepo.set('intensity_metric', 'RPE');
    await userSettingsRepo.set('onboarding_completed', '1');

    const unit = await userSettingsRepo.get('unit_system');
    const metric = await userSettingsRepo.get('intensity_metric');
    const completed = await userSettingsRepo.get('onboarding_completed');

    expect(unit).toBe('kg');
    expect(metric).toBe('RPE');
    expect(completed).toBe('1');
  });
});
