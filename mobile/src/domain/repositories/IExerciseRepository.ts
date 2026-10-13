import { Exercise, ExerciseCategory, MuscleGroup } from '../../core/types';

/**
 * Repository interface for managing Exercise definitions in the catalog and custom movements.
 */
export interface IExerciseRepository {
  /**
   * Retrieves an exercise by its unique identifier.
   */
  findById(id: string): Promise<Exercise | null>;

  /**
   * Retrieves all exercises in the database.
   */
  findAll(): Promise<Exercise[]>;

  /**
   * Retrieves exercises matching a specific category.
   */
  findByCategory(category: ExerciseCategory): Promise<Exercise[]>;

  /**
   * Retrieves exercises targeting a specific primary muscle group.
   */
  findByMuscleGroup(muscleGroup: MuscleGroup | string): Promise<Exercise[]>;

  /**
   * Retrieves variant movements linked to a root movement via parent_exercise_id.
   */
  findVariants(parentExerciseId: string): Promise<Exercise[]>;

  /**
   * Searches exercises by name or muscle group substring (case-insensitive).
   */
  search(query: string): Promise<Exercise[]>;

  /**
   * Persists a new exercise to storage.
   */
  create(exercise: Exercise): Promise<Exercise>;

  /**
   * Updates an existing exercise.
   */
  update(exercise: Exercise): Promise<Exercise>;

  /**
   * Deletes an exercise by its unique identifier.
   */
  delete(id: string): Promise<void>;
}
