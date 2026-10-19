import { PainReport, PainType, JointLocation } from '../../core/types';
import {
  CreatePainReportInput,
  IPainReportRepository,
} from '../../domain/repositories/IPainReportRepository';
import { ISQLiteDatabase } from '../schema';

interface PainReportRow {
  id: string;
  workout_id: string;
  exercise_id: string;
  set_id: string | null;
  pain_type: string;
  severity: number;
  joint_location?: string | null;
  notes: string | null;
  created_at: string;
}

function mapRowToPainReport(row: PainReportRow): PainReport {
  return {
    id: row.id,
    workout_id: row.workout_id,
    exercise_id: row.exercise_id,
    set_id: row.set_id,
    pain_type: row.pain_type as PainType,
    severity: Number(row.severity),
    joint_location: (row.joint_location as JointLocation) || null,
    notes: row.notes,
    created_at: row.created_at,
  };
}

/**
 * Concrete SQLite implementation of IPainReportRepository.
 */
export class SQLitePainReportRepository implements IPainReportRepository {
  constructor(private readonly db: ISQLiteDatabase) {}

  async create(input: CreatePainReportInput): Promise<PainReport> {
    const id = `pain_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const createdAt = new Date().toISOString();

    await this.db.runAsync(
      `INSERT INTO pain_reports (
        id, workout_id, exercise_id, set_id, pain_type, severity, joint_location, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      id,
      input.workout_id,
      input.exercise_id,
      input.set_id ?? null,
      input.pain_type,
      input.severity,
      input.joint_location ?? null,
      input.notes ?? null,
      createdAt
    );

    return {
      id,
      workout_id: input.workout_id,
      exercise_id: input.exercise_id,
      set_id: input.set_id ?? null,
      pain_type: input.pain_type,
      severity: input.severity,
      joint_location: input.joint_location ?? null,
      notes: input.notes ?? null,
      created_at: createdAt,
    };
  }

  async getById(id: string): Promise<PainReport | null> {
    const row = await this.db.getFirstAsync<PainReportRow>(
      'SELECT * FROM pain_reports WHERE id = ?;',
      id
    );
    return row ? mapRowToPainReport(row) : null;
  }

  async getByWorkoutId(workoutId: string): Promise<PainReport[]> {
    const rows = await this.db.getAllAsync<PainReportRow>(
      'SELECT * FROM pain_reports WHERE workout_id = ? ORDER BY created_at ASC;',
      workoutId
    );
    return rows.map(mapRowToPainReport);
  }

  async getByExerciseId(exerciseId: string): Promise<PainReport[]> {
    const rows = await this.db.getAllAsync<PainReportRow>(
      'SELECT * FROM pain_reports WHERE exercise_id = ? ORDER BY created_at DESC;',
      exerciseId
    );
    return rows.map(mapRowToPainReport);
  }

  async getAll(): Promise<PainReport[]> {
    const rows = await this.db.getAllAsync<PainReportRow>(
      'SELECT * FROM pain_reports ORDER BY created_at DESC;'
    );
    return rows.map(mapRowToPainReport);
  }

  async delete(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM pain_reports WHERE id = ?;', id);
  }

  async count(): Promise<number> {
    const row = await this.db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM pain_reports;'
    );
    return row?.count ?? 0;
  }
}
