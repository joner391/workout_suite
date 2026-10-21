import { IExerciseRepository } from '../../domain/repositories/IExerciseRepository';
import {
  Exercise,
  ExerciseCategory,
  LoadMode,
  MuscleGroup,
  StandardLiftType,
  AxialLoading,
  RomTier,
  JointLocation,
} from '../../core/types';
import { ISQLiteDatabase } from '../schema';

interface ExerciseRow {
  id: string;
  name: string;
  muscle_group: string;
  category: ExerciseCategory;
  is_compound: number;
  is_bodyweight: number;
  is_unilateral: number;
  load_mode: LoadMode;
  default_cable_ratio: number;
  default_bar_weight_kg: number;
  is_custom: number;
  parent_exercise_id: string | null;
  standard_lift_type: StandardLiftType | null;
  default_rest_seconds: number;
  secondary_muscles?: string | null;
  axial_loading?: AxialLoading | null;
  rom_tier?: RomTier | null;
  muscle_biases?: string | null;
  primary_joints?: string | null;
  secondary_joints?: string | null;
  baseline_sfr?: number | null;
  required_gear?: string | null;
  exercise_tier?: number | null;
}

function parseJsonArray<T = string>(val?: string | null): T[] | undefined {
  if (!val) return undefined;
  try {
    return JSON.parse(val);
  } catch {
    return val.split(',').map((s) => s.trim() as unknown as T);
  }
}

function mapRowToExercise(row: ExerciseRow): Exercise {
  const secondaryMuscles = parseJsonArray<string>(row.secondary_muscles);
  const muscleBiases = parseJsonArray<string>(row.muscle_biases);
  const primaryJoints = parseJsonArray<JointLocation>(row.primary_joints);
  const secondaryJoints = parseJsonArray<JointLocation>(row.secondary_joints);
  const requiredGear = parseJsonArray<string>(row.required_gear);

  return {
    id: row.id,
    name: row.name,
    muscle_group: row.muscle_group,
    category: row.category,
    is_compound: row.is_compound === 1,
    is_bodyweight: row.is_bodyweight === 1,
    is_unilateral: row.is_unilateral === 1,
    load_mode: row.load_mode,
    default_cable_ratio: row.default_cable_ratio,
    default_bar_weight_kg: row.default_bar_weight_kg,
    is_custom: row.is_custom === 1,
    parent_exercise_id: row.parent_exercise_id,
    standard_lift_type: row.standard_lift_type,
    default_rest_seconds: row.default_rest_seconds,
    secondary_muscles: secondaryMuscles,
    axial_loading: row.axial_loading ?? 'none',
    rom_tier: row.rom_tier ?? 'standard_full',
    muscle_biases: muscleBiases,
    primary_joints: primaryJoints,
    secondary_joints: secondaryJoints,
    baseline_sfr: row.baseline_sfr ?? 50.0,
    required_gear: requiredGear,
    exercise_tier: row.exercise_tier ?? 2,
  };
}

/**
 * Concrete SQLite implementation of IExerciseRepository using expo-sqlite.
 */
export class SQLiteExerciseRepository implements IExerciseRepository {
  constructor(private readonly db: ISQLiteDatabase) {}

  async findById(id: string): Promise<Exercise | null> {
    const row = await this.db.getFirstAsync<ExerciseRow>(
      'SELECT * FROM exercises WHERE id = ?;',
      id
    );
    return row ? mapRowToExercise(row) : null;
  }

  async findAll(): Promise<Exercise[]> {
    const rows = await this.db.getAllAsync<ExerciseRow>(
      'SELECT * FROM exercises ORDER BY name ASC;'
    );
    return rows.map(mapRowToExercise);
  }

  async findByCategory(category: ExerciseCategory): Promise<Exercise[]> {
    const rows = await this.db.getAllAsync<ExerciseRow>(
      'SELECT * FROM exercises WHERE category = ? ORDER BY name ASC;',
      category
    );
    return rows.map(mapRowToExercise);
  }

  async findByMuscleGroup(muscleGroup: MuscleGroup | string): Promise<Exercise[]> {
    const rows = await this.db.getAllAsync<ExerciseRow>(
      'SELECT * FROM exercises WHERE LOWER(muscle_group) = LOWER(?) ORDER BY name ASC;',
      muscleGroup
    );
    return rows.map(mapRowToExercise);
  }

  async findVariants(parentExerciseId: string): Promise<Exercise[]> {
    const rows = await this.db.getAllAsync<ExerciseRow>(
      'SELECT * FROM exercises WHERE parent_exercise_id = ? ORDER BY name ASC;',
      parentExerciseId
    );
    return rows.map(mapRowToExercise);
  }

  async search(query: string): Promise<Exercise[]> {
    const q = query.trim().toLowerCase();
    if (!q) {
      return this.findAll();
    }
    const param = `%${q}%`;
    const rows = await this.db.getAllAsync<ExerciseRow>(
      'SELECT * FROM exercises WHERE LOWER(name) LIKE ? OR LOWER(muscle_group) LIKE ? ORDER BY name ASC;',
      param,
      param
    );
    return rows.map(mapRowToExercise);
  }

  async create(exercise: Exercise): Promise<Exercise> {
    await this.db.runAsync(
      `INSERT INTO exercises (
        id, name, muscle_group, category, is_compound, is_bodyweight,
        is_unilateral, load_mode, default_cable_ratio, default_bar_weight_kg,
        is_custom, parent_exercise_id, standard_lift_type, default_rest_seconds,
        axial_loading, rom_tier, muscle_biases, primary_joints, secondary_joints,
        baseline_sfr, required_gear, exercise_tier
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      exercise.id,
      exercise.name,
      exercise.muscle_group,
      exercise.category,
      exercise.is_compound ? 1 : 0,
      exercise.is_bodyweight ? 1 : 0,
      exercise.is_unilateral ? 1 : 0,
      exercise.load_mode,
      exercise.default_cable_ratio,
      exercise.default_bar_weight_kg,
      exercise.is_custom ? 1 : 0,
      exercise.parent_exercise_id,
      exercise.standard_lift_type,
      exercise.default_rest_seconds,
      exercise.axial_loading ?? 'none',
      exercise.rom_tier ?? 'standard_full',
      exercise.muscle_biases ? JSON.stringify(exercise.muscle_biases) : null,
      exercise.primary_joints ? JSON.stringify(exercise.primary_joints) : null,
      exercise.secondary_joints ? JSON.stringify(exercise.secondary_joints) : null,
      exercise.baseline_sfr ?? 50.0,
      exercise.required_gear ? JSON.stringify(exercise.required_gear) : null,
      exercise.exercise_tier ?? 2
    );
    return { ...exercise };
  }

  async update(exercise: Exercise): Promise<Exercise> {
    const res = await this.db.runAsync(
      `UPDATE exercises SET
        name = ?, muscle_group = ?, category = ?, is_compound = ?, is_bodyweight = ?,
        is_unilateral = ?, load_mode = ?, default_cable_ratio = ?, default_bar_weight_kg = ?,
        is_custom = ?, parent_exercise_id = ?, standard_lift_type = ?, default_rest_seconds = ?,
        axial_loading = ?, rom_tier = ?, muscle_biases = ?, primary_joints = ?, secondary_joints = ?,
        baseline_sfr = ?, required_gear = ?, exercise_tier = ?
      WHERE id = ?;`,
      exercise.name,
      exercise.muscle_group,
      exercise.category,
      exercise.is_compound ? 1 : 0,
      exercise.is_bodyweight ? 1 : 0,
      exercise.is_unilateral ? 1 : 0,
      exercise.load_mode,
      exercise.default_cable_ratio,
      exercise.default_bar_weight_kg,
      exercise.is_custom ? 1 : 0,
      exercise.parent_exercise_id,
      exercise.standard_lift_type,
      exercise.default_rest_seconds,
      exercise.axial_loading ?? 'none',
      exercise.rom_tier ?? 'standard_full',
      exercise.muscle_biases ? JSON.stringify(exercise.muscle_biases) : null,
      exercise.primary_joints ? JSON.stringify(exercise.primary_joints) : null,
      exercise.secondary_joints ? JSON.stringify(exercise.secondary_joints) : null,
      exercise.baseline_sfr ?? 50.0,
      exercise.required_gear ? JSON.stringify(exercise.required_gear) : null,
      exercise.exercise_tier ?? 2,
      exercise.id
    );

    if (res.changes === 0) {
      throw new Error(`Exercise with id '${exercise.id}' not found`);
    }
    return { ...exercise };
  }

  async delete(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM exercises WHERE id = ?;', id);
  }
}
