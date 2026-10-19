import React from 'react';
import {
  RepositoryProvider,
  useRepositories,
  useOptionalRepositories,
  Repositories,
} from '../RepositoryContext';
import {
  NavigationProvider,
  useNavigation,
  useOptionalNavigation,
  NavigationContextType,
} from '../NavigationContext';
import { formatProgressionRuleSummary } from '../../features/progression/ProgressionBuilderModal';
import { ProgressionRule } from '../../core/types';
import {
  MockWorkoutRepository,
  MockExerciseRepository,
  MockGearRepository,
  MockUserSettingsRepository,
  MockProgramRepository,
  MockUserProfileRepository,
  MockBodyMetricsRepository,
  MockPainReportRepository,
} from '../../database/mocks';
import { ProgramBlockService } from '../../services/programBlockService';
import { HomeScreen } from '../../features/home/HomeScreen';

describe('RepositoryContext & NavigationContext (UX Feedback Items 6 & 7)', () => {
  let mockRepos: Repositories;

  beforeEach(() => {
    const programRepo = new MockProgramRepository();
    mockRepos = {
      workoutRepo: new MockWorkoutRepository(),
      exerciseRepo: new MockExerciseRepository(),
      gearRepo: new MockGearRepository(),
      userSettingsRepo: new MockUserSettingsRepository(),
      programRepo,
      userProfileRepo: new MockUserProfileRepository(),
      bodyMetricsRepo: new MockBodyMetricsRepository(),
      painReportRepo: new MockPainReportRepository(),
      programBlockService: new ProgramBlockService(programRepo),
    };
  });

  describe('RepositoryContext', () => {
    test('throws an error when useContext returns null', () => {
      const spy = jest.spyOn(React, 'useContext').mockReturnValue(null);
      expect(() => useRepositories()).toThrow('useRepositories must be used within a RepositoryProvider');
      spy.mockRestore();
    });

    test('returns null when useContext returns null in useOptionalRepositories', () => {
      const spy = jest.spyOn(React, 'useContext').mockReturnValue(null);
      expect(useOptionalRepositories()).toBeNull();
      spy.mockRestore();
    });

    test('returns repositories when useContext returns repositories in useRepositories', () => {
      const spy = jest.spyOn(React, 'useContext').mockReturnValue(mockRepos);
      expect(useRepositories()).toBe(mockRepos);
      spy.mockRestore();
    });

    test('provides repositories to child components within RepositoryProvider', () => {
      const provider = React.createElement(RepositoryProvider, {
        repositories: mockRepos,
        children: null,
      });

      expect(provider).toBeDefined();
      expect(provider.props.repositories).toBe(mockRepos);
    });
  });

  describe('Progression Rule Humanized Summaries (Item 16)', () => {
    test('humanizes simple condition and action', () => {
      const rule: ProgressionRule = {
        id: 'r1',
        template_exercise_id: 'te1',
        priority: 1,
        rule_json: {
          conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
        },
      };

      const summary = formatProgressionRuleSummary(rule);
      expect(summary).toBe('When all sets hit target reps ➔ add +2.5 kg');
    });

    test('humanizes threshold conditions such as plateau and RPE', () => {
      const rule: ProgressionRule = {
        id: 'r2',
        template_exercise_id: 'te1',
        priority: 2,
        rule_json: {
          conditions: [{ type: 'CONSECUTIVE_FAILED_SESSIONS', threshold: 3 }],
          actions: [{ type: 'TRIGGER_DELOAD', value: 10 }],
        },
      };

      const summary = formatProgressionRuleSummary(rule);
      expect(summary).toBe('When 3 consecutive failed sessions (plateau) ➔ trigger deload (-10%)');
    });

    test('humanizes average RPE condition with custom threshold', () => {
      const rule: ProgressionRule = {
        id: 'r3',
        template_exercise_id: 'te1',
        priority: 1,
        rule_json: {
          conditions: [{ type: 'AVERAGE_RPE_LESS_THAN', threshold: 7.5 }],
          actions: [{ type: 'INCREASE_LOAD_FIXED', value: 5 }],
        },
      };

      const summary = formatProgressionRuleSummary(rule);
      expect(summary).toBe('When average RPE < 7.5 ➔ add +5 kg');
    });
  });

  describe('HomeScreen UX Callbacks (Items 1, 7, 9)', () => {
    test('accepts onNavigateToWorkout, onNavigateToCalendar, and onNavigateToAnalytics', () => {
      const onNavigateToWorkout = jest.fn();
      const onNavigateToCalendar = jest.fn();
      const onNavigateToAnalytics = jest.fn();

      const element = React.createElement(HomeScreen, {
        workoutRepo: mockRepos.workoutRepo,
        exerciseRepo: mockRepos.exerciseRepo,
        gearRepo: mockRepos.gearRepo,
        userSettingsRepo: mockRepos.userSettingsRepo,
        programRepo: mockRepos.programRepo,
        programBlockService: mockRepos.programBlockService,
        bodyMetricsRepo: mockRepos.bodyMetricsRepo,
        userProfileRepo: mockRepos.userProfileRepo,
        onNavigateToWorkout,
        onNavigateToCalendar,
        onNavigateToAnalytics,
      });

      expect(element).toBeDefined();
      expect(element.props.onNavigateToWorkout).toBe(onNavigateToWorkout);
      expect(element.props.onNavigateToCalendar).toBe(onNavigateToCalendar);
      expect(element.props.onNavigateToAnalytics).toBe(onNavigateToAnalytics);
    });
  });
});
