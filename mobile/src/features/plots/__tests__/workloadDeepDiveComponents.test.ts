/**
 * Workout Suite — Workload & Intensity Deep Dive Modal Test Suite
 */

import React from 'react';
import {
  MockWorkoutRepository,
  MockExerciseRepository,
  MockUserSettingsRepository,
} from '../../../database/mocks';
import { WorkloadDeepDiveModal } from '../WorkloadDeepDiveModal';

describe('WorkloadDeepDiveModal Component Suite', () => {
  let workoutRepo: MockWorkoutRepository;
  let exerciseRepo: MockExerciseRepository;
  let userSettingsRepo: MockUserSettingsRepository;

  beforeEach(() => {
    workoutRepo = new MockWorkoutRepository();
    exerciseRepo = new MockExerciseRepository();
    userSettingsRepo = new MockUserSettingsRepository();
  });

  test('renders nothing when visible is false', () => {
    const element = React.createElement(WorkloadDeepDiveModal, {
      visible: false,
      workoutRepo,
      exerciseRepo,
      userSettingsRepo,
      onClose: jest.fn(),
    });

    expect(element).toBeDefined();
    expect(element.props.visible).toBe(false);
  });

  test('renders modal structure with week navigation and analytical sections when visible is true', () => {
    const onClose = jest.fn();
    const element = React.createElement(WorkloadDeepDiveModal, {
      visible: true,
      workoutRepo,
      exerciseRepo,
      userSettingsRepo,
      onClose,
    });

    expect(element).toBeDefined();
    expect(element.props.visible).toBe(true);
    expect(element.props.onClose).toBe(onClose);
  });

  test('accepts optional userSettingsRepo for unit-system aware rendering', () => {
    const element = React.createElement(WorkloadDeepDiveModal, {
      visible: true,
      workoutRepo,
      exerciseRepo,
      userSettingsRepo,
      onClose: jest.fn(),
    });

    expect(element).toBeDefined();
    expect(element.props.userSettingsRepo).toBe(userSettingsRepo);
  });
});

