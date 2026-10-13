import { IExerciseRepository } from '../../domain/repositories/IExerciseRepository';
import { Exercise, ExerciseCategory, MuscleGroup } from '../../core/types';

/**
 * In-memory mock implementation of IExerciseRepository for headless unit tests.
 */
export class MockExerciseRepository implements IExerciseRepository {
  private exercises: Map<string, Exercise> = new Map();

  constructor(initialExercises?: Exercise[]) {
    if (initialExercises) {
      this.seed(initialExercises);
    }
  }

  /**
   * Clears all in-memory exercises.
   */
  public clear(): void {
    this.exercises.clear();
  }

  /**
   * Seeds in-memory exercises for testing scenarios.
   */
  public seed(items: Exercise[]): void {
    for (const item of items) {
      this.exercises.set(item.id, { ...item });
    }
  }

  async findById(id: string): Promise<Exercise | null> {
    const item = this.exercises.get(id);
    return item ? { ...item } : null;
  }

  async findAll(): Promise<Exercise[]> {
    return Array.from(this.exercises.values()).map((e) => ({ ...e }));
  }

  async findByCategory(category: ExerciseCategory): Promise<Exercise[]> {
    return Array.from(this.exercises.values())
      .filter((e) => e.category === category)
      .map((e) => ({ ...e }));
  }

  async findByMuscleGroup(muscleGroup: MuscleGroup | string): Promise<Exercise[]> {
    const target = muscleGroup.toLowerCase();
    return Array.from(this.exercises.values())
      .filter((e) => e.muscle_group.toLowerCase() === target)
      .map((e) => ({ ...e }));
  }

  async findVariants(parentExerciseId: string): Promise<Exercise[]> {
    return Array.from(this.exercises.values())
      .filter((e) => e.parent_exercise_id === parentExerciseId)
      .map((e) => ({ ...e }));
  }

  async search(query: string): Promise<Exercise[]> {
    const q = query.trim().toLowerCase();
    if (!q) {
      return this.findAll();
    }
    return Array.from(this.exercises.values())
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.muscle_group.toLowerCase().includes(q)
      )
      .map((e) => ({ ...e }));
  }

  async create(exercise: Exercise): Promise<Exercise> {
    const cloned = { ...exercise };
    this.exercises.set(cloned.id, cloned);
    return { ...cloned };
  }

  async update(exercise: Exercise): Promise<Exercise> {
    if (!this.exercises.has(exercise.id)) {
      throw new Error(`Exercise with id '${exercise.id}' not found`);
    }
    const cloned = { ...exercise };
    this.exercises.set(cloned.id, cloned);
    return { ...cloned };
  }

  async delete(id: string): Promise<void> {
    this.exercises.delete(id);
  }
}
