import { ExercisePreference } from '../../core/types';
import { IExercisePreferenceRepository } from '../../domain/repositories/IExercisePreferenceRepository';

/**
 * In-memory mock implementation of IExercisePreferenceRepository for unit tests.
 */
export class MockExercisePreferenceRepository implements IExercisePreferenceRepository {
  public preferences: Map<string, ExercisePreference> = new Map();

  constructor(initialPreferences: ExercisePreference[] = []) {
    for (const p of initialPreferences) {
      this.preferences.set(p.exercise_id, { ...p });
    }
  }

  public clear(): void {
    this.preferences.clear();
  }

  async get(exerciseId: string): Promise<ExercisePreference | null> {
    const p = this.preferences.get(exerciseId);
    return p ? { ...p } : null;
  }

  async getAll(): Promise<ExercisePreference[]> {
    return Array.from(this.preferences.values())
      .map((p) => ({ ...p }))
      .sort((a, b) => a.exercise_id.localeCompare(b.exercise_id));
  }

  async save(preference: ExercisePreference): Promise<void> {
    this.preferences.set(preference.exercise_id, { ...preference });
  }

  async delete(exerciseId: string): Promise<void> {
    this.preferences.delete(exerciseId);
  }

  async count(): Promise<number> {
    return this.preferences.size;
  }
}
