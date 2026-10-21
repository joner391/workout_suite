import { ExercisePreference, ExerciseSentiment } from '../../core/types';
import { IExercisePreferenceRepository } from '../../domain/repositories/IExercisePreferenceRepository';
import { ISQLiteDatabase } from '../schema';

interface ExercisePreferenceRow {
  exercise_id: string;
  sentiment: string;
  swap_in_count: number;
  swap_out_count: number;
  affinity_score: number;
  last_pain_reported_at: string | null;
  max_pain_severity: number | null;
  pain_joint: string | null;
  updated_at: string;
}

function mapRowToPreference(row: ExercisePreferenceRow): ExercisePreference {
  return {
    exercise_id: row.exercise_id,
    sentiment: (row.sentiment as ExerciseSentiment) || 'neutral',
    swap_in_count: Number(row.swap_in_count ?? 0),
    swap_out_count: Number(row.swap_out_count ?? 0),
    affinity_score: Number(row.affinity_score ?? 0.0),
    last_pain_reported_at: row.last_pain_reported_at,
    max_pain_severity: row.max_pain_severity != null ? Number(row.max_pain_severity) : null,
    pain_joint: row.pain_joint,
    updated_at: row.updated_at,
  };
}

/**
 * Concrete SQLite implementation of IExercisePreferenceRepository.
 */
export class SQLiteExercisePreferenceRepository implements IExercisePreferenceRepository {
  constructor(private readonly db: ISQLiteDatabase) {}

  async get(exerciseId: string): Promise<ExercisePreference | null> {
    const row = await this.db.getFirstAsync<ExercisePreferenceRow>(
      'SELECT * FROM exercise_preferences WHERE exercise_id = ?;',
      exerciseId
    );
    return row ? mapRowToPreference(row) : null;
  }

  async getAll(): Promise<ExercisePreference[]> {
    const rows = await this.db.getAllAsync<ExercisePreferenceRow>(
      'SELECT * FROM exercise_preferences ORDER BY exercise_id ASC;'
    );
    return rows.map(mapRowToPreference);
  }

  async save(preference: ExercisePreference): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO exercise_preferences (
        exercise_id, sentiment, swap_in_count, swap_out_count,
        affinity_score, last_pain_reported_at, max_pain_severity,
        pain_joint, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(exercise_id) DO UPDATE SET
        sentiment = excluded.sentiment,
        swap_in_count = excluded.swap_in_count,
        swap_out_count = excluded.swap_out_count,
        affinity_score = excluded.affinity_score,
        last_pain_reported_at = excluded.last_pain_reported_at,
        max_pain_severity = excluded.max_pain_severity,
        pain_joint = excluded.pain_joint,
        updated_at = excluded.updated_at;`,
      preference.exercise_id,
      preference.sentiment,
      preference.swap_in_count,
      preference.swap_out_count,
      preference.affinity_score,
      preference.last_pain_reported_at ?? null,
      preference.max_pain_severity ?? null,
      preference.pain_joint ?? null,
      preference.updated_at
    );
  }

  async delete(exerciseId: string): Promise<void> {
    await this.db.runAsync(
      'DELETE FROM exercise_preferences WHERE exercise_id = ?;',
      exerciseId
    );
  }

  async count(): Promise<number> {
    const row = await this.db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM exercise_preferences;'
    );
    return row ? Number(row.count) : 0;
  }
}
