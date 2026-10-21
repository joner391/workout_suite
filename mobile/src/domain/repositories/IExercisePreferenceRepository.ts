import { ExercisePreference } from '../../core/types';

/**
 * Repository interface for exercise preferences, sentiment, and soft affinity records.
 */
export interface IExercisePreferenceRepository {
  /**
   * Retrieves preference record for a specific exercise by its ID.
   */
  get(exerciseId: string): Promise<ExercisePreference | null>;

  /**
   * Retrieves all exercise preferences.
   */
  getAll(): Promise<ExercisePreference[]>;

  /**
   * Persists or updates an exercise preference record.
   */
  save(preference: ExercisePreference): Promise<void>;

  /**
   * Deletes preference record for an exercise.
   */
  delete(exerciseId: string): Promise<void>;

  /**
   * Returns total count of customized exercise preferences.
   */
  count(): Promise<number>;
}
