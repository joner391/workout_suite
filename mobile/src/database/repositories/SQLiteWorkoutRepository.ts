import { IWorkoutRepository } from '../../domain/repositories/IWorkoutRepository';
import {
  ImportSource,
  SetType,
  Workout,
  WorkoutFilter,
  WorkoutSet,
  WorkoutStatus,
  WorkoutWithSets,
} from '../../core/types';
import { ISQLiteDatabase } from '../schema';

interface WorkoutRow {
  id: string;
  template_id: string | null;
  date: string;
  name: string;
  notes: string | null;
  started_at: string;
  duration_seconds: number | null;
  status: WorkoutStatus;
  completed_at: string | null;
  imported_from: ImportSource | string | null;
}

interface WorkoutSetRow {
  id: string;
  workout_id: string;
  exercise_id: string;
  gear_id: string | null;
  set_number: number;
  weight: number;
  raw_input_weight: number;
  added_weight: number | null;
  reps: number;
  reps_right: number | null;
  rpe: number | null;
  rir: number | null;
  set_type: SetType;
  set_notes: string | null;
  exercise_group_id: string | null;
  created_at: string;
}

function mapRowToWorkout(row: WorkoutRow): Workout {
  return {
    id: row.id,
    template_id: row.template_id,
    date: row.date,
    name: row.name,
    notes: row.notes,
    started_at: row.started_at,
    duration_seconds: row.duration_seconds,
    status: row.status,
    completed_at: row.completed_at,
    imported_from: row.imported_from,
  };
}

function mapRowToWorkoutSet(row: WorkoutSetRow): WorkoutSet {
  return {
    id: row.id,
    workout_id: row.workout_id,
    exercise_id: row.exercise_id,
    gear_id: row.gear_id,
    set_number: row.set_number,
    weight: row.weight,
    raw_input_weight: row.raw_input_weight,
    added_weight: row.added_weight,
    reps: row.reps,
    reps_right: row.reps_right,
    rpe: row.rpe,
    rir: row.rir,
    set_type: row.set_type,
    set_notes: row.set_notes,
    exercise_group_id: row.exercise_group_id,
    created_at: row.created_at,
  };
}

/**
 * Concrete SQLite implementation of IWorkoutRepository with write-through persistence,
 * crash recovery detection, and global ghost-set auto-referencing.
 */
export class SQLiteWorkoutRepository implements IWorkoutRepository {
  constructor(private readonly db: ISQLiteDatabase) {}

  // ==========================================================================
  // Workout Operations
  // ==========================================================================

  async findById(id: string): Promise<Workout | null> {
    const row = await this.db.getFirstAsync<WorkoutRow>(
      'SELECT * FROM workouts WHERE id = ?;',
      id
    );
    return row ? mapRowToWorkout(row) : null;
  }

  async findAll(filter?: WorkoutFilter): Promise<Workout[]> {
    let sql = 'SELECT * FROM workouts WHERE 1=1';
    const params: any[] = [];

    if (filter) {
      if (filter.status) {
        sql += ' AND status = ?';
        params.push(filter.status);
      }
      if (filter.startDate) {
        sql += ' AND date >= ?';
        params.push(filter.startDate);
      }
      if (filter.endDate) {
        sql += ' AND date <= ?';
        params.push(filter.endDate);
      }
      if (filter.templateId) {
        sql += ' AND template_id = ?';
        params.push(filter.templateId);
      }
    }

    sql += ' ORDER BY date DESC, started_at DESC';

    if (filter?.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }
    if (filter?.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }

    const rows = await this.db.getAllAsync<WorkoutRow>(sql, ...params);
    return rows.map(mapRowToWorkout);
  }

  async create(workout: Workout): Promise<Workout> {
    await this.db.runAsync(
      `INSERT INTO workouts (
        id, template_id, date, name, notes, started_at, duration_seconds,
        status, completed_at, imported_from
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      workout.id,
      workout.template_id,
      workout.date,
      workout.name,
      workout.notes,
      workout.started_at,
      workout.duration_seconds,
      workout.status,
      workout.completed_at,
      workout.imported_from
    );
    return { ...workout };
  }

  async update(workout: Workout): Promise<Workout> {
    const res = await this.db.runAsync(
      `UPDATE workouts SET
        template_id = ?, date = ?, name = ?, notes = ?, started_at = ?,
        duration_seconds = ?, status = ?, completed_at = ?, imported_from = ?
      WHERE id = ?;`,
      workout.template_id,
      workout.date,
      workout.name,
      workout.notes,
      workout.started_at,
      workout.duration_seconds,
      workout.status,
      workout.completed_at,
      workout.imported_from,
      workout.id
    );

    if (res.changes === 0) {
      throw new Error(`Workout with id '${workout.id}' not found`);
    }
    return { ...workout };
  }

  async delete(id: string): Promise<void> {
    // Explicit delete of sets before workout ensures safety even without foreign_keys enabled
    await this.deleteSetsByWorkoutId(id);
    await this.db.runAsync('DELETE FROM workouts WHERE id = ?;', id);
  }

  async getInProgressWorkout(): Promise<Workout | null> {
    const row = await this.db.getFirstAsync<WorkoutRow>(
      "SELECT * FROM workouts WHERE status = 'in_progress' ORDER BY started_at DESC LIMIT 1;"
    );
    return row ? mapRowToWorkout(row) : null;
  }

  async getWorkoutWithSets(workoutId: string): Promise<WorkoutWithSets | null> {
    const workout = await this.findById(workoutId);
    if (!workout) {
      return null;
    }
    const sets = await this.getSetsByWorkoutId(workoutId);
    return {
      workout,
      sets,
    };
  }

  // ==========================================================================
  // Set Operations
  // ==========================================================================

  async getSetsByWorkoutId(workoutId: string): Promise<WorkoutSet[]> {
    const rows = await this.db.getAllAsync<WorkoutSetRow>(
      'SELECT * FROM workout_sets WHERE workout_id = ? ORDER BY set_number ASC;',
      workoutId
    );
    return rows.map(mapRowToWorkoutSet);
  }

  async addSet(set: WorkoutSet): Promise<WorkoutSet> {
    await this.db.runAsync(
      `INSERT INTO workout_sets (
        id, workout_id, exercise_id, gear_id, set_number, weight, raw_input_weight,
        added_weight, reps, reps_right, rpe, rir, set_type, set_notes,
        exercise_group_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      set.id,
      set.workout_id,
      set.exercise_id,
      set.gear_id,
      set.set_number,
      set.weight,
      set.raw_input_weight,
      set.added_weight,
      set.reps,
      set.reps_right,
      set.rpe,
      set.rir,
      set.set_type,
      set.set_notes,
      set.exercise_group_id,
      set.created_at
    );
    return { ...set };
  }

  async updateSet(set: WorkoutSet): Promise<WorkoutSet> {
    const res = await this.db.runAsync(
      `UPDATE workout_sets SET
        workout_id = ?, exercise_id = ?, gear_id = ?, set_number = ?, weight = ?,
        raw_input_weight = ?, added_weight = ?, reps = ?, reps_right = ?, rpe = ?,
        rir = ?, set_type = ?, set_notes = ?, exercise_group_id = ?, created_at = ?
      WHERE id = ?;`,
      set.workout_id,
      set.exercise_id,
      set.gear_id,
      set.set_number,
      set.weight,
      set.raw_input_weight,
      set.added_weight,
      set.reps,
      set.reps_right,
      set.rpe,
      set.rir,
      set.set_type,
      set.set_notes,
      set.exercise_group_id,
      set.created_at,
      set.id
    );

    if (res.changes === 0) {
      throw new Error(`WorkoutSet with id '${set.id}' not found`);
    }
    return { ...set };
  }

  async deleteSet(setId: string): Promise<void> {
    await this.db.runAsync('DELETE FROM workout_sets WHERE id = ?;', setId);
  }

  async saveSets(sets: WorkoutSet[]): Promise<WorkoutSet[]> {
    for (const s of sets) {
      await this.db.runAsync(
        `INSERT OR REPLACE INTO workout_sets (
          id, workout_id, exercise_id, gear_id, set_number, weight, raw_input_weight,
          added_weight, reps, reps_right, rpe, rir, set_type, set_notes,
          exercise_group_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        s.id,
        s.workout_id,
        s.exercise_id,
        s.gear_id,
        s.set_number,
        s.weight,
        s.raw_input_weight,
        s.added_weight,
        s.reps,
        s.reps_right,
        s.rpe,
        s.rir,
        s.set_type,
        s.set_notes,
        s.exercise_group_id,
        s.created_at
      );
    }
    return sets.map((s) => ({ ...s }));
  }

  async deleteSetsByWorkoutId(workoutId: string): Promise<void> {
    await this.db.runAsync(
      'DELETE FROM workout_sets WHERE workout_id = ?;',
      workoutId
    );
  }

  // ==========================================================================
  // Historical & Ghosting Queries
  // ==========================================================================

  async getMostRecentCompletedSetsForExercise(
    exerciseId: string
  ): Promise<WorkoutSet[]> {
    const query = `
      SELECT s.* FROM workout_sets s
      INNER JOIN workouts w ON s.workout_id = w.id
      WHERE w.status = 'completed' AND s.exercise_id = ?
        AND w.id = (
          SELECT w2.id FROM workouts w2
          INNER JOIN workout_sets s2 ON s2.workout_id = w2.id
          WHERE w2.status = 'completed' AND s2.exercise_id = ?
          ORDER BY COALESCE(w2.completed_at, w2.started_at, w2.date) DESC
          LIMIT 1
        )
      ORDER BY s.set_number ASC;
    `;
    const rows = await this.db.getAllAsync<WorkoutSetRow>(
      query,
      exerciseId,
      exerciseId
    );
    return rows.map(mapRowToWorkoutSet);
  }

  async getHistoricalSetsForExercise(
    exerciseId: string,
    options?: { onlyCompletedWorkouts?: boolean }
  ): Promise<WorkoutSet[]> {
    let sql = `
      SELECT s.* FROM workout_sets s
      INNER JOIN workouts w ON s.workout_id = w.id
      WHERE s.exercise_id = ?
    `;
    const params: any[] = [exerciseId];

    if (options?.onlyCompletedWorkouts) {
      sql += " AND w.status = 'completed'";
    }

    sql += ' ORDER BY s.created_at ASC;';

    const rows = await this.db.getAllAsync<WorkoutSetRow>(sql, ...params);
    return rows.map(mapRowToWorkoutSet);
  }
}
