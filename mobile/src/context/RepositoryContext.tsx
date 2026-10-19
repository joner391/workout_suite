/**
 * Workout Suite / datSet — Repository Context & Hook
 *
 * Implements Item 6: Eliminate prop-drilling across the component hierarchy
 * by providing unified access to SQLite repositories and core domain services.
 */

import React, { createContext, useContext, ReactNode } from 'react';
import {
  IWorkoutRepository,
  IExerciseRepository,
  IGearRepository,
  IUserSettingsRepository,
  IProgramRepository,
  IUserProfileRepository,
  IBodyMetricsRepository,
  IPainReportRepository,
} from '../domain/repositories';
import { ProgramBlockService } from '../services/programBlockService';

export interface Repositories {
  workoutRepo: IWorkoutRepository;
  exerciseRepo: IExerciseRepository;
  gearRepo: IGearRepository;
  userSettingsRepo: IUserSettingsRepository;
  programRepo: IProgramRepository;
  userProfileRepo: IUserProfileRepository;
  bodyMetricsRepo: IBodyMetricsRepository;
  painReportRepo: IPainReportRepository;
  programBlockService: ProgramBlockService;
}

export const RepositoryContext = createContext<Repositories | null>(null);

export interface RepositoryProviderProps {
  repositories: Repositories | null;
  children: ReactNode;
}

export const RepositoryProvider: React.FC<RepositoryProviderProps> = ({
  repositories,
  children,
}) => {
  return (
    <RepositoryContext.Provider value={repositories}>
      {children}
    </RepositoryContext.Provider>
  );
};

/**
 * Access repositories from context. Throws error if used outside RepositoryProvider.
 */
export const useRepositories = (): Repositories => {
  const context = useContext(RepositoryContext);
  if (!context) {
    throw new Error('useRepositories must be used within a RepositoryProvider');
  }
  return context;
};

/**
 * Access repositories from context optionally (e.g. for components that support both props and context).
 */
export const useOptionalRepositories = (): Repositories | null => {
  return useContext(RepositoryContext);
};
