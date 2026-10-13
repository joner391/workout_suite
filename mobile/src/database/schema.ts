import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_EXERCISES, DEFAULT_GEAR } from './seeds/defaultExercises';

export const DATABASE_NAME = 'workout_suite.db';
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Minimal abstraction matching the modern expo-sqlite async interface.
 * Allows repository and migration tests to run headlessly in Jest with mock drivers.
 */
export interface ISQLiteDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(
    source: string,
    ...params: any[]
  ): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(source: string, ...params: any[]): Promise<T[]>;
  getFirstAsync<T>(source: string, ...params: any[]): Promise<T | null>;
}

/**
 * Canonical relational schema DDL matching IMPLEMENTATION_PLAN.md Section 2.
 */
export const CREATE_TABLES_SQL = `
-- Core Exercises Library
CREATE TABLE IF NOT EXISTS exercises (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    muscle_group TEXT NOT NULL,
    category TEXT NOT NULL,
    is_compound INTEGER NOT NULL DEFAULT 0,
    is_bodyweight INTEGER NOT NULL DEFAULT 0,
    is_unilateral INTEGER NOT NULL DEFAULT 0,
    load_mode TEXT NOT NULL DEFAULT 'total',
    default_cable_ratio REAL DEFAULT 1.0,
    default_bar_weight_kg REAL DEFAULT 20.0,
    is_custom INTEGER NOT NULL DEFAULT 0,
    parent_exercise_id TEXT REFERENCES exercises(id) ON DELETE SET NULL,
    standard_lift_type TEXT,
    default_rest_seconds INTEGER NOT NULL DEFAULT 120
);

-- Gear & Equipment Inventory
CREATE TABLE IF NOT EXISTS gear_inventory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    tare_weight_kg REAL NOT NULL DEFAULT 20.0,
    cable_ratio REAL NOT NULL DEFAULT 1.0,
    is_default INTEGER NOT NULL DEFAULT 0,
    notes TEXT
);

-- Training Programs / Meso-Cycle Splits
CREATE TABLE IF NOT EXISTS programs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color_hex TEXT NOT NULL DEFAULT '#3B82F6',
    notes TEXT,
    created_at TEXT NOT NULL
);

-- Workout Templates / Routines
CREATE TABLE IF NOT EXISTS workout_templates (
    id TEXT PRIMARY KEY,
    program_id TEXT REFERENCES programs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    notes TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

-- Active Program Meso-Cycles / Training Eras
CREATE TABLE IF NOT EXISTS program_blocks (
    id TEXT PRIMARY KEY,
    program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date TEXT
);

-- Template Exercise Slots
CREATE TABLE IF NOT EXISTS template_exercises (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercises(id),
    gear_id TEXT REFERENCES gear_inventory(id) ON DELETE SET NULL,
    target_sets INTEGER,
    target_reps_min INTEGER,
    target_reps_max INTEGER,
    target_rpe REAL,
    target_rir REAL,
    order_index INTEGER NOT NULL,
    exercise_group_id TEXT
);

-- Progression Rules (declarative condition-action engine)
CREATE TABLE IF NOT EXISTS progression_rules (
    id TEXT PRIMARY KEY,
    template_exercise_id TEXT NOT NULL REFERENCES template_exercises(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 0,
    rule_json TEXT NOT NULL
);

-- Completed / In-Progress Workouts
CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY,
    template_id TEXT REFERENCES workout_templates(id),
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    notes TEXT,
    started_at TEXT NOT NULL,
    duration_seconds INTEGER,
    status TEXT NOT NULL DEFAULT 'in_progress',
    completed_at TEXT,
    imported_from TEXT
);

-- Exercise Sets Logged
CREATE TABLE IF NOT EXISTS workout_sets (
    id TEXT PRIMARY KEY,
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercises(id),
    gear_id TEXT REFERENCES gear_inventory(id) ON DELETE SET NULL,
    set_number INTEGER NOT NULL,
    weight REAL NOT NULL,
    raw_input_weight REAL NOT NULL,
    added_weight REAL,
    reps INTEGER NOT NULL,
    reps_right INTEGER,
    rpe REAL,
    rir REAL,
    set_type TEXT NOT NULL DEFAULT 'working',
    set_notes TEXT,
    exercise_group_id TEXT,
    created_at TEXT NOT NULL
);

-- Body Composition & Anthropometry
CREATE TABLE IF NOT EXISTS body_metrics (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    bodyweight REAL NOT NULL,
    body_fat_manual REAL,
    waist_cm REAL,
    neck_cm REAL,
    hip_cm REAL,
    bicep_cm REAL,
    chest_cm REAL,
    thigh_cm REAL,
    calf_cm REAL,
    navy_body_fat REAL
);

-- Calibrated 1RM Parameters (imported from Companion Kalman engine)
CREATE TABLE IF NOT EXISTS calibrated_params (
    id TEXT PRIMARY KEY,
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    calibrated_1rm REAL NOT NULL,
    calibrated_k REAL NOT NULL,
    calibrated_at TEXT NOT NULL,
    UNIQUE(exercise_id)
);

-- App Settings (key-value flags)
CREATE TABLE IF NOT EXISTS user_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- User Psychological Profile & Goals Matrix
CREATE TABLE IF NOT EXISTS user_profiles (
    id TEXT PRIMARY KEY,
    gender TEXT NOT NULL,
    birthdate TEXT,
    height_cm REAL,
    training_enjoyment TEXT NOT NULL DEFAULT 'neutral',
    intensity_style TEXT NOT NULL DEFAULT 'balanced',
    primary_goal TEXT NOT NULL DEFAULT 'hypertrophy',
    secondary_goals TEXT,
    preferred_days_per_week INTEGER NOT NULL DEFAULT 4,
    preferred_session_duration_mins INTEGER NOT NULL DEFAULT 60,
    equipment_access TEXT NOT NULL DEFAULT 'commercial_gym',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Pre-Seeded SBD Strength Standards Benchmarks
CREATE TABLE IF NOT EXISTS strength_standards (
    id TEXT PRIMARY KEY,
    lift_type TEXT NOT NULL,
    gender TEXT NOT NULL,
    bodyweight_kg REAL NOT NULL,
    untrained_1rm REAL NOT NULL,
    novice_1rm REAL NOT NULL,
    intermediate_1rm REAL NOT NULL,
    advanced_1rm REAL NOT NULL,
    elite_1rm REAL NOT NULL
);

-- Indices for rapid query performance and ghost set lookups
CREATE INDEX IF NOT EXISTS idx_workout_sets_workout_id ON workout_sets(workout_id);
CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise_id ON workout_sets(exercise_id);
CREATE INDEX IF NOT EXISTS idx_workouts_status ON workouts(status);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
CREATE INDEX IF NOT EXISTS idx_exercises_parent_id ON exercises(parent_exercise_id);
`;

/**
 * Applies SQLite PRAGMAs, executes schema migrations based on PRAGMA user_version,
 * and seeds baseline exercises and gear items.
 */
export async function migrateDatabase(db: ISQLiteDatabase): Promise<void> {
  // Enforce WAL mode and foreign key constraint cascades
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const versionRow = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version;'
  );
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion < 1) {
    // 1. Create all relational tables and indexes
    await db.execAsync(CREATE_TABLES_SQL);

    // 2. Seed foundational exercise catalog
    for (const ex of DEFAULT_EXERCISES) {
      await db.runAsync(
        `INSERT OR IGNORE INTO exercises (
          id, name, muscle_group, category, is_compound, is_bodyweight,
          is_unilateral, load_mode, default_cable_ratio, default_bar_weight_kg,
          is_custom, parent_exercise_id, standard_lift_type, default_rest_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        ex.id,
        ex.name,
        ex.muscle_group,
        ex.category,
        ex.is_compound ? 1 : 0,
        ex.is_bodyweight ? 1 : 0,
        ex.is_unilateral ? 1 : 0,
        ex.load_mode,
        ex.default_cable_ratio,
        ex.default_bar_weight_kg,
        ex.is_custom ? 1 : 0,
        ex.parent_exercise_id,
        ex.standard_lift_type,
        ex.default_rest_seconds
      );
    }

    // 3. Seed default gear inventory
    for (const gear of DEFAULT_GEAR) {
      await db.runAsync(
        `INSERT OR IGNORE INTO gear_inventory (
          id, name, type, tare_weight_kg, cable_ratio, is_default, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        gear.id,
        gear.name,
        gear.type,
        gear.tare_weight_kg,
        gear.cable_ratio,
        gear.is_default ? 1 : 0,
        gear.notes
      );
    }

    // 4. Seed baseline default settings
    await db.runAsync(
      `INSERT OR IGNORE INTO user_settings (key, value) VALUES ('unit_system', 'kg');`
    );
    await db.runAsync(
      `INSERT OR IGNORE INTO user_settings (key, value) VALUES ('intensity_metric', 'RPE');`
    );
    await db.runAsync(
      `INSERT OR IGNORE INTO user_settings (key, value) VALUES ('pure_utility_mode', '0');`
    );

    // 5. Update schema version
    await db.execAsync(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
  }
}

/**
 * Initializes and opens the application SQLite database, applying any pending migrations.
 */
let cachedDb: SQLiteDatabase | null = null;

export async function getDatabase(dbName: string = DATABASE_NAME): Promise<SQLiteDatabase> {
  if (cachedDb) {
    return cachedDb;
  }
  const db = await openDatabaseAsync(dbName);
  await migrateDatabase(db);
  cachedDb = db;
  return db;
}

/**
 * Resets all database tables by dropping them and re-running migrations.
 * Useful for development diagnostics and automated testing.
 */
export async function resetDatabase(db: ISQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  const tables = [
    'strength_standards',
    'user_profiles',
    'user_settings',
    'calibrated_params',
    'body_metrics',
    'workout_sets',
    'workouts',
    'progression_rules',
    'template_exercises',
    'program_blocks',
    'workout_templates',
    'programs',
    'gear_inventory',
    'exercises',
  ];

  for (const table of tables) {
    await db.execAsync(`DROP TABLE IF EXISTS ${table};`);
  }

  await db.execAsync('PRAGMA user_version = 0;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await migrateDatabase(db);
}
