import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_EXERCISES, DEFAULT_GEAR } from './seeds/defaultExercises';

export const DATABASE_NAME = 'workout_suite.db';
export const CURRENT_SCHEMA_VERSION = 9;

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
    default_rest_seconds INTEGER NOT NULL DEFAULT 120,
    axial_loading TEXT DEFAULT 'none',
    rom_tier TEXT DEFAULT 'standard_full',
    muscle_biases TEXT,
    primary_joints TEXT,
    secondary_joints TEXT,
    baseline_sfr REAL DEFAULT 50.0,
    required_gear TEXT,
    exercise_tier INTEGER DEFAULT 2
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
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    gear_id TEXT REFERENCES gear_inventory(id) ON DELETE SET NULL,
    target_sets INTEGER,
    target_reps_min INTEGER,
    target_reps_max INTEGER,
    target_rpe REAL,
    target_rir REAL,
    order_index INTEGER NOT NULL,
    exercise_group_id TEXT,
    set_type TEXT DEFAULT 'working'
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
    template_id TEXT REFERENCES workout_templates(id) ON DELETE SET NULL,
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
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
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
    navy_body_fat REAL,
    imported_from TEXT
);

-- Calibrated 1RM Parameters (imported from Companion Kalman engine)
CREATE TABLE IF NOT EXISTS calibrated_params (
    id TEXT PRIMARY KEY,
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    calibrated_1rm REAL NOT NULL,
    calibrated_k REAL NOT NULL,
    cov_p00 REAL NOT NULL DEFAULT 0.0,
    cov_p11 REAL NOT NULL DEFAULT 0.0,
    calibrated_at TEXT NOT NULL,
    calibrated_10rm REAL,
    sfr_score REAL,
    sfr_tier TEXT,
    recommended_swap_exercise_id TEXT,
    optimal_rest_seconds INTEGER,
    asymmetry_ratio REAL,
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
    training_mentality TEXT NOT NULL DEFAULT 'precision',
    primary_goal TEXT NOT NULL DEFAULT 'hypertrophy',
    secondary_goals TEXT,
    preferred_days_per_week INTEGER NOT NULL DEFAULT 4,
    preferred_session_duration_mins INTEGER NOT NULL DEFAULT 60,
    equipment_access TEXT NOT NULL DEFAULT 'commercial_gym',
    experience_level TEXT DEFAULT 'intermediate',
    pending_meso_mood INTEGER DEFAULT 0,
    has_axial_fatigue_sensitivity INTEGER DEFAULT 0,
    is_caloric_deficit INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Pain & Discomfort Reports (logged in-gym or post-workout)
CREATE TABLE IF NOT EXISTS pain_reports (
    id TEXT PRIMARY KEY,
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    set_id TEXT REFERENCES workout_sets(id) ON DELETE SET NULL,
    pain_type TEXT NOT NULL,
    severity INTEGER NOT NULL,
    joint_location TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
);

-- Exercise Preferences, Sentiment & Soft Affinity (ADR-096)
CREATE TABLE IF NOT EXISTS exercise_preferences (
    exercise_id TEXT PRIMARY KEY REFERENCES exercises(id) ON DELETE CASCADE,
    sentiment TEXT NOT NULL DEFAULT 'neutral',
    swap_in_count INTEGER NOT NULL DEFAULT 0,
    swap_out_count INTEGER NOT NULL DEFAULT 0,
    affinity_score REAL NOT NULL DEFAULT 0.0,
    last_pain_reported_at TEXT,
    max_pain_severity INTEGER,
    pain_joint TEXT,
    updated_at TEXT NOT NULL
);

-- Indices for rapid query performance and ghost set lookups
CREATE INDEX IF NOT EXISTS idx_workout_sets_workout_id ON workout_sets(workout_id);
CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise_id ON workout_sets(exercise_id);
CREATE INDEX IF NOT EXISTS idx_workout_sets_ex_created ON workout_sets(exercise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workouts_status ON workouts(status);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
CREATE INDEX IF NOT EXISTS idx_workouts_status_date ON workouts(status, date);
CREATE INDEX IF NOT EXISTS idx_exercises_parent_id ON exercises(parent_exercise_id);
CREATE INDEX IF NOT EXISTS idx_pain_reports_workout_id ON pain_reports(workout_id);
CREATE INDEX IF NOT EXISTS idx_pain_reports_exercise_id ON pain_reports(exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercise_preferences_sentiment ON exercise_preferences(sentiment);
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
  let currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion < 1) {
    await db.execAsync('BEGIN TRANSACTION;');
    try {
      // 1. Create all relational tables and indexes
      await db.execAsync(CREATE_TABLES_SQL);

      // 2. Seed foundational exercise catalog
      for (const ex of DEFAULT_EXERCISES) {
        await db.runAsync(
          `INSERT OR IGNORE INTO exercises (
            id, name, muscle_group, category, is_compound, is_bodyweight,
            is_unilateral, load_mode, default_cable_ratio, default_bar_weight_kg,
            is_custom, parent_exercise_id, standard_lift_type, default_rest_seconds,
            axial_loading, rom_tier, muscle_biases, primary_joints, secondary_joints,
            baseline_sfr, required_gear, exercise_tier
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
          ex.default_rest_seconds,
          ex.axial_loading ?? 'none',
          ex.rom_tier ?? 'standard_full',
          ex.muscle_biases ? JSON.stringify(ex.muscle_biases) : null,
          ex.primary_joints ? JSON.stringify(ex.primary_joints) : null,
          ex.secondary_joints ? JSON.stringify(ex.secondary_joints) : null,
          ex.baseline_sfr ?? 50.0,
          ex.required_gear ? JSON.stringify(ex.required_gear) : null,
          ex.exercise_tier ?? 2
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
      await db.execAsync('COMMIT;');
      currentVersion = CURRENT_SCHEMA_VERSION;
    } catch (err) {
      await db.execAsync('ROLLBACK;');
      throw err;
    }
  }

  if (currentVersion < 2) {
    await db.execAsync('BEGIN TRANSACTION;');
    try {
      // Migration v1 -> v2: Add training_mentality column to user_profiles
      try {
        await db.execAsync(
          "ALTER TABLE user_profiles ADD COLUMN training_mentality TEXT NOT NULL DEFAULT 'precision';"
        );
      } catch {
        // Column may already exist
      }
      await db.execAsync('PRAGMA user_version = 2;');
      await db.execAsync('COMMIT;');
      currentVersion = 2;
    } catch (err) {
      await db.execAsync('ROLLBACK;');
      throw err;
    }
  }

  if (currentVersion < 3) {
    await db.execAsync('BEGIN TRANSACTION;');
    try {
      // Migration v2 -> v3:
      // 1. Add cov_p00, cov_p11 to calibrated_params
      // 2. Add imported_from to body_metrics
      // 3. Create composite index idx_workout_sets_ex_created
      try {
        await db.execAsync(
          'ALTER TABLE calibrated_params ADD COLUMN cov_p00 REAL NOT NULL DEFAULT 0.0;'
        );
        await db.execAsync(
          'ALTER TABLE calibrated_params ADD COLUMN cov_p11 REAL NOT NULL DEFAULT 0.0;'
        );
      } catch {
        // Columns may already exist
      }
      try {
        await db.execAsync(
          'ALTER TABLE body_metrics ADD COLUMN imported_from TEXT;'
        );
      } catch {
        // Column may already exist
      }
      try {
        await db.execAsync(
          'CREATE INDEX IF NOT EXISTS idx_workout_sets_ex_created ON workout_sets(exercise_id, created_at DESC);'
        );
      } catch {
        // Index may already exist
      }
      await db.execAsync('PRAGMA user_version = 3;');
      await db.execAsync('COMMIT;');
      currentVersion = 3;
    } catch (err) {
      await db.execAsync('ROLLBACK;');
      throw err;
    }
  }

  if (currentVersion < 4) {
    await db.execAsync('BEGIN TRANSACTION;');
    try {
      // Migration v3 -> v4: Create pain_reports table and indexes
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS pain_reports (
            id TEXT PRIMARY KEY,
            workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
            exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
            set_id TEXT REFERENCES workout_sets(id) ON DELETE SET NULL,
            pain_type TEXT NOT NULL,
            severity INTEGER NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pain_reports_workout_id ON pain_reports(workout_id);
        CREATE INDEX IF NOT EXISTS idx_pain_reports_exercise_id ON pain_reports(exercise_id);
      `);
      await db.execAsync('PRAGMA user_version = 4;');
      await db.execAsync('COMMIT;');
      currentVersion = 4;
    } catch (err) {
      await db.execAsync('ROLLBACK;');
      throw err;
    }
  }

  if (currentVersion < 5) {
    await db.execAsync('BEGIN TRANSACTION;');
    try {
      // Migration v4 -> v5: Add hypertrophy fields to calibrated_params
      const columns = [
        'ALTER TABLE calibrated_params ADD COLUMN calibrated_10rm REAL;',
        'ALTER TABLE calibrated_params ADD COLUMN sfr_score REAL;',
        'ALTER TABLE calibrated_params ADD COLUMN sfr_tier TEXT;',
        'ALTER TABLE calibrated_params ADD COLUMN recommended_swap_exercise_id TEXT;',
        'ALTER TABLE calibrated_params ADD COLUMN optimal_rest_seconds INTEGER;',
        'ALTER TABLE calibrated_params ADD COLUMN asymmetry_ratio REAL;',
      ];
      for (const colSql of columns) {
        try {
          await db.execAsync(colSql);
        } catch {
          // Column may already exist
        }
      }
      await db.execAsync('PRAGMA user_version = 5;');
      await db.execAsync('COMMIT;');
      currentVersion = 5;
    } catch (err) {
      await db.execAsync('ROLLBACK;');
      throw err;
    }
  }

  if (currentVersion < 6) {
    await db.execAsync('BEGIN TRANSACTION;');
    try {
      // Migration v5 -> v6:
      // 1. Add joint_location to pain_reports
      // 2. Create idx_workouts_status_date on workouts(status, date)
      // 3. Create idx_workout_sets_exercise_id on workout_sets(exercise_id)
      try {
        await db.execAsync(
          'ALTER TABLE pain_reports ADD COLUMN joint_location TEXT;'
        );
      } catch {
        // Column may already exist
      }
      try {
        await db.execAsync(
          'CREATE INDEX IF NOT EXISTS idx_workouts_status_date ON workouts(status, date);'
        );
        await db.execAsync(
          'CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise_id ON workout_sets(exercise_id);'
        );
      } catch {
        // Indexes may already exist
      }
      await db.execAsync('PRAGMA user_version = 6;');
      await db.execAsync('COMMIT;');
      currentVersion = 6;
    } catch (err) {
      await db.execAsync('ROLLBACK;');
      throw err;
    }
  }

  if (currentVersion < 7) {
    await db.execAsync('BEGIN TRANSACTION;');
    try {
      // Migration v6 -> v7:
      // 1. Add set_type column to template_exercises
      // 2. Add experience_level column to user_profiles
      try {
        await db.execAsync(
          "ALTER TABLE template_exercises ADD COLUMN set_type TEXT DEFAULT 'working';"
        );
      } catch {
        // Column may already exist
      }
      try {
        await db.execAsync(
          "ALTER TABLE user_profiles ADD COLUMN experience_level TEXT DEFAULT 'intermediate';"
        );
      } catch {
        // Column may already exist
      }
      try {
        await db.execAsync(
          "ALTER TABLE user_profiles ADD COLUMN pending_meso_mood INTEGER DEFAULT 0;"
        );
      } catch {
        // Column may already exist
      }
      await db.execAsync('PRAGMA user_version = 7;');
      await db.execAsync('COMMIT;');
      currentVersion = 7;
    } catch (err) {
      await db.execAsync('ROLLBACK;');
      throw err;
    }
  }

  if (currentVersion < 8) {
    await db.execAsync('BEGIN TRANSACTION;');
    try {
      // Migration v7 -> v8: Biomechanical Exercise Taxonomy & Exercise Preferences (ADR-095, ADR-096)
      const columns = [
        "ALTER TABLE exercises ADD COLUMN axial_loading TEXT DEFAULT 'none';",
        "ALTER TABLE exercises ADD COLUMN rom_tier TEXT DEFAULT 'standard_full';",
        "ALTER TABLE exercises ADD COLUMN muscle_biases TEXT;",
        "ALTER TABLE exercises ADD COLUMN primary_joints TEXT;",
        "ALTER TABLE exercises ADD COLUMN secondary_joints TEXT;",
        "ALTER TABLE exercises ADD COLUMN baseline_sfr REAL DEFAULT 50.0;",
        "ALTER TABLE exercises ADD COLUMN required_gear TEXT;",
        "ALTER TABLE exercises ADD COLUMN exercise_tier INTEGER DEFAULT 2;",
      ];
      for (const colSql of columns) {
        try {
          await db.execAsync(colSql);
        } catch {
          // Ignore if column already exists (idempotence)
        }
      }

      // Create exercise_preferences table in v8
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS exercise_preferences (
            exercise_id TEXT PRIMARY KEY REFERENCES exercises(id) ON DELETE CASCADE,
            sentiment TEXT NOT NULL DEFAULT 'neutral',
            swap_in_count INTEGER NOT NULL DEFAULT 0,
            swap_out_count INTEGER NOT NULL DEFAULT 0,
            affinity_score REAL NOT NULL DEFAULT 0.0,
            last_pain_reported_at TEXT,
            max_pain_severity INTEGER,
            pain_joint TEXT,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_exercise_preferences_sentiment ON exercise_preferences(sentiment);
      `);

      // Update existing exercises with enriched biomechanical properties from seeds
      for (const ex of DEFAULT_EXERCISES) {
        await db.runAsync(
          `UPDATE exercises SET
            axial_loading = ?,
            rom_tier = ?,
            muscle_biases = ?,
            primary_joints = ?,
            secondary_joints = ?,
            baseline_sfr = ?,
            required_gear = ?,
            exercise_tier = ?
          WHERE id = ?;`,
          ex.axial_loading ?? 'none',
          ex.rom_tier ?? 'standard_full',
          ex.muscle_biases ? JSON.stringify(ex.muscle_biases) : null,
          ex.primary_joints ? JSON.stringify(ex.primary_joints) : null,
          ex.secondary_joints ? JSON.stringify(ex.secondary_joints) : null,
          ex.baseline_sfr ?? 50.0,
          ex.required_gear ? JSON.stringify(ex.required_gear) : null,
          ex.exercise_tier ?? 2,
          ex.id
        );
      }

      await db.execAsync('PRAGMA user_version = 8;');
      await db.execAsync('COMMIT;');
      currentVersion = 8;
    } catch (err) {
      await db.execAsync('ROLLBACK;');
      throw err;
    }
  }

  if (currentVersion < 9) {
    await db.execAsync('BEGIN TRANSACTION;');
    try {
      // Migration v8 -> v9: Fix missing user_profiles columns (pending_meso_mood, has_axial_fatigue_sensitivity, is_caloric_deficit)
      const userProfileColumns = [
        "ALTER TABLE user_profiles ADD COLUMN pending_meso_mood INTEGER DEFAULT 0;",
        "ALTER TABLE user_profiles ADD COLUMN has_axial_fatigue_sensitivity INTEGER DEFAULT 0;",
        "ALTER TABLE user_profiles ADD COLUMN is_caloric_deficit INTEGER DEFAULT 0;",
      ];
      for (const colSql of userProfileColumns) {
        try {
          await db.execAsync(colSql);
        } catch {
          // Ignore if column already exists (idempotence)
        }
      }
      await db.execAsync(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
      await db.execAsync('COMMIT;');
      currentVersion = CURRENT_SCHEMA_VERSION;
    } catch (err) {
      await db.execAsync('ROLLBACK;');
      throw err;
    }
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
    'exercise_preferences',
    'pain_reports',
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
