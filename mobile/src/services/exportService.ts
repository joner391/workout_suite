/**
 * Workout Suite — Standardized JSON Export Service
 *
 * Implements Step 2.3: Contract-Verified JSON Database Export
 * Synchronized with:
 * - schemas/workout_export.schema.json (JSON Schema Draft-07)
 * - companion/src/ingestion/schemas.py (Pydantic v2 strict models)
 * - ADR-001 (Local-First SQLite Architecture)
 * - ADR-026 (Dual-Weight Mechanical vs Raw Load Tracking)
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { ISQLiteDatabase } from '../database/schema';
import {
  WorkoutExportPayload,
  Program,
  ProgramBlock,
  WorkoutTemplate,
  TemplateExercise,
  ProgressionRule,
  Workout,
  WorkoutSet,
  Exercise,
  GearInventory,
  BodyMetric,
  UserProfile,
  TrainingMentality,
  CalibratedParam,
} from '../core/types';

export const EXPORT_SCHEMA_VERSION = '1.0.0';

export interface ExportResult {
  payload: WorkoutExportPayload;
  jsonString: string;
  filePath: string;
  shared: boolean;
}

export interface ExportOptions {
  fileName?: string;
  share?: boolean;
}

export interface ExportServiceDependencies {
  fileWriter?: (filePath: string, contents: string) => Promise<void>;
  fileSharer?: (filePath: string) => Promise<boolean>;
  getCacheDirectory?: () => string | null;
}

/**
 * Service orchestrating extraction, normalization, serialization, and mobile sharing
 * of all SQLite relational tables matching the canonical Workout Suite export contract.
 */
export class ExportService {
  private readonly fileWriter: (filePath: string, contents: string) => Promise<void>;
  private readonly fileSharer: (filePath: string) => Promise<boolean>;
  private readonly getCacheDirectory: () => string | null;

  constructor(
    private readonly defaultDb?: ISQLiteDatabase,
    deps?: ExportServiceDependencies
  ) {
    this.fileWriter = deps?.fileWriter ?? (async (filePath, contents) => {
      await FileSystem.writeAsStringAsync(filePath, contents, {
        encoding: FileSystem.EncodingType ? FileSystem.EncodingType.UTF8 : 'utf8',
      });
    });

    this.fileSharer = deps?.fileSharer ?? (async (filePath) => {
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'application/json',
          dialogTitle: 'Export Workout Suite Data',
          UTI: 'public.json',
        });
        return true;
      }
      return false;
    });

    this.getCacheDirectory = deps?.getCacheDirectory ?? (() => {
      return FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? null;
    });
  }

  /**
   * Queries and serializes all SQLite database tables into the exact structure
   * defined by schemas/workout_export.schema.json.
   */
  async buildExportPayload(database?: ISQLiteDatabase): Promise<WorkoutExportPayload> {
    const db = database ?? this.defaultDb;
    if (!db) {
      throw new Error('ExportService: No SQLite database instance provided.');
    }

    // 1. Programs
    const rawPrograms = await db.getAllAsync<any>(
      'SELECT id, name, color_hex, notes, created_at FROM programs ORDER BY created_at ASC;'
    );
    const programs: Program[] = (rawPrograms || []).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      color_hex: String(r.color_hex),
      notes: r.notes != null ? String(r.notes) : null,
      created_at: String(r.created_at),
    }));

    // 2. Program Blocks
    const rawBlocks = await db.getAllAsync<any>(
      'SELECT id, program_id, start_date, end_date FROM program_blocks ORDER BY start_date ASC;'
    );
    const program_blocks: ProgramBlock[] = (rawBlocks || []).map((r) => ({
      id: String(r.id),
      program_id: String(r.program_id),
      start_date: String(r.start_date),
      end_date: r.end_date != null ? String(r.end_date) : null,
    }));

    // 3. Workout Templates
    const rawTemplates = await db.getAllAsync<any>(
      'SELECT id, program_id, name, notes, order_index, created_at FROM workout_templates ORDER BY order_index ASC;'
    );
    const workout_templates: WorkoutTemplate[] = (rawTemplates || []).map((r) => ({
      id: String(r.id),
      program_id: r.program_id != null ? String(r.program_id) : null,
      name: String(r.name),
      notes: r.notes != null ? String(r.notes) : null,
      order_index: Number(r.order_index ?? 0),
      created_at: String(r.created_at),
    }));

    // 4. Template Exercises
    const rawTemplateExercises = await db.getAllAsync<any>(
      `SELECT id, template_id, exercise_id, gear_id, target_sets, target_reps_min,
              target_reps_max, target_rpe, target_rir, order_index, exercise_group_id
       FROM template_exercises
       ORDER BY template_id ASC, order_index ASC;`
    );
    const template_exercises: TemplateExercise[] = (rawTemplateExercises || []).map((r) => ({
      id: String(r.id),
      template_id: String(r.template_id),
      exercise_id: String(r.exercise_id),
      gear_id: r.gear_id != null ? String(r.gear_id) : null,
      target_sets: r.target_sets != null ? Number(r.target_sets) : null,
      target_reps_min: r.target_reps_min != null ? Number(r.target_reps_min) : null,
      target_reps_max: r.target_reps_max != null ? Number(r.target_reps_max) : null,
      target_rpe: r.target_rpe != null ? Number(r.target_rpe) : null,
      target_rir: r.target_rir != null ? Number(r.target_rir) : null,
      order_index: Number(r.order_index ?? 0),
      exercise_group_id: r.exercise_group_id != null ? String(r.exercise_group_id) : null,
    }));

    // 5. Progression Rules
    const rawRules = await db.getAllAsync<any>(
      'SELECT id, template_exercise_id, priority, rule_json FROM progression_rules ORDER BY priority ASC;'
    );
    const progression_rules: ProgressionRule[] = (rawRules || []).map((r) => {
      let parsedRule: any = r.rule_json;
      if (typeof r.rule_json === 'string') {
        try {
          parsedRule = JSON.parse(r.rule_json);
        } catch {
          parsedRule = r.rule_json;
        }
      }
      return {
        id: String(r.id),
        template_exercise_id: String(r.template_exercise_id),
        priority: Number(r.priority ?? 0),
        rule_json: parsedRule,
      };
    });

    // 6. Workouts
    const rawWorkouts = await db.getAllAsync<any>(
      `SELECT id, template_id, date, name, notes, started_at, duration_seconds,
              status, completed_at, imported_from
       FROM workouts
       ORDER BY date ASC, started_at ASC;`
    );
    const workouts: Workout[] = (rawWorkouts || []).map((r) => ({
      id: String(r.id),
      template_id: r.template_id != null ? String(r.template_id) : null,
      date: String(r.date),
      name: String(r.name),
      notes: r.notes != null ? String(r.notes) : null,
      started_at: String(r.started_at),
      duration_seconds: r.duration_seconds != null ? Number(r.duration_seconds) : null,
      status: r.status,
      completed_at: r.completed_at != null ? String(r.completed_at) : null,
      imported_from: r.imported_from != null ? String(r.imported_from) : null,
    }));

    // 7. Workout Sets (ADR-026 dual-weight load preservation)
    const rawSets = await db.getAllAsync<any>(
      `SELECT id, workout_id, exercise_id, gear_id, set_number, weight,
              raw_input_weight, added_weight, reps, reps_right, rpe, rir,
              set_type, set_notes, exercise_group_id, created_at
       FROM workout_sets
       ORDER BY workout_id ASC, set_number ASC;`
    );
    const workout_sets: WorkoutSet[] = (rawSets || []).map((r) => ({
      id: String(r.id),
      workout_id: String(r.workout_id),
      exercise_id: String(r.exercise_id),
      gear_id: r.gear_id != null ? String(r.gear_id) : null,
      set_number: Number(r.set_number),
      weight: Number(r.weight),
      raw_input_weight: Number(r.raw_input_weight),
      added_weight: r.added_weight != null ? Number(r.added_weight) : null,
      reps: Number(r.reps),
      reps_right: r.reps_right != null ? Number(r.reps_right) : null,
      rpe: r.rpe != null ? Number(r.rpe) : null,
      rir: r.rir != null ? Number(r.rir) : null,
      set_type: r.set_type ?? 'working',
      set_notes: r.set_notes != null ? String(r.set_notes) : null,
      exercise_group_id: r.exercise_group_id != null ? String(r.exercise_group_id) : null,
      created_at: String(r.created_at),
    }));

    // 8. Exercises (Convert integer flags 0/1 to boolean)
    const rawExercises = await db.getAllAsync<any>(
      `SELECT id, name, muscle_group, category, is_compound, is_bodyweight,
              is_unilateral, load_mode, default_cable_ratio, default_bar_weight_kg,
              is_custom, parent_exercise_id, standard_lift_type, default_rest_seconds
       FROM exercises
       ORDER BY name ASC;`
    );
    const exercises: Exercise[] = (rawExercises || []).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      muscle_group: String(r.muscle_group),
      category: r.category,
      is_compound: Boolean(r.is_compound),
      is_bodyweight: Boolean(r.is_bodyweight),
      is_unilateral: Boolean(r.is_unilateral),
      load_mode: r.load_mode ?? 'total',
      default_cable_ratio: Number(r.default_cable_ratio ?? 1.0),
      default_bar_weight_kg: Number(r.default_bar_weight_kg ?? 20.0),
      is_custom: Boolean(r.is_custom),
      parent_exercise_id: r.parent_exercise_id != null ? String(r.parent_exercise_id) : null,
      standard_lift_type: r.standard_lift_type != null ? r.standard_lift_type : null,
      default_rest_seconds: Number(r.default_rest_seconds ?? 120),
    }));

    // 9. Gear Inventory (Convert is_default integer to boolean)
    const rawGear = await db.getAllAsync<any>(
      'SELECT id, name, type, tare_weight_kg, cable_ratio, is_default, notes FROM gear_inventory ORDER BY name ASC;'
    );
    const gear_inventory: GearInventory[] = (rawGear || []).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      type: r.type,
      tare_weight_kg: Number(r.tare_weight_kg ?? 20.0),
      cable_ratio: Number(r.cable_ratio ?? 1.0),
      is_default: Boolean(r.is_default),
      notes: r.notes != null ? String(r.notes) : null,
    }));

    // 10. Body Metrics
    const rawMetrics = await db.getAllAsync<any>(
      `SELECT id, date, bodyweight, body_fat_manual, waist_cm, neck_cm,
              hip_cm, bicep_cm, chest_cm, thigh_cm, calf_cm, navy_body_fat, imported_from
       FROM body_metrics
       ORDER BY date ASC;`
    );
    const body_metrics: BodyMetric[] = (rawMetrics || []).map((r) => ({
      id: String(r.id),
      date: String(r.date),
      bodyweight: Number(r.bodyweight),
      body_fat_manual: r.body_fat_manual != null ? Number(r.body_fat_manual) : null,
      waist_cm: r.waist_cm != null ? Number(r.waist_cm) : null,
      neck_cm: r.neck_cm != null ? Number(r.neck_cm) : null,
      hip_cm: r.hip_cm != null ? Number(r.hip_cm) : null,
      bicep_cm: r.bicep_cm != null ? Number(r.bicep_cm) : null,
      chest_cm: r.chest_cm != null ? Number(r.chest_cm) : null,
      thigh_cm: r.thigh_cm != null ? Number(r.thigh_cm) : null,
      calf_cm: r.calf_cm != null ? Number(r.calf_cm) : null,
      navy_body_fat: r.navy_body_fat != null ? Number(r.navy_body_fat) : null,
      imported_from: r.imported_from != null ? String(r.imported_from) : null,
    }));

    // 11. User Settings (Transforms relational rows to string key-value map)
    const rawSettings = await db.getAllAsync<any>(
      'SELECT key, value FROM user_settings ORDER BY key ASC;'
    );
    const user_settings: Record<string, string> = {};
    for (const r of rawSettings || []) {
      user_settings[String(r.key)] = String(r.value);
    }

    // 12. User Profiles
    const rawProfiles = await db.getAllAsync<any>(
      `SELECT * FROM user_profiles ORDER BY created_at ASC;`
    );
    const user_profiles: UserProfile[] = (rawProfiles || []).map((r) => {
      let secondaryGoals: string[] | null = null;
      if (r.secondary_goals) {
        if (typeof r.secondary_goals === 'string') {
          try {
            secondaryGoals = JSON.parse(r.secondary_goals);
          } catch {
            secondaryGoals = [r.secondary_goals];
          }
        } else if (Array.isArray(r.secondary_goals)) {
          secondaryGoals = r.secondary_goals;
        }
      }
      const mentality: TrainingMentality = r.training_mentality ??
        (r.intensity_style === 'high_intensity_low_volume' ? 'fury' :
         r.training_enjoyment === 'minimalist' ? 'get_out' : 'precision');

      return {
        id: String(r.id),
        gender: r.gender,
        birthdate: r.birthdate != null ? String(r.birthdate) : null,
        height_cm: r.height_cm != null ? Number(r.height_cm) : null,
        training_mentality: mentality,
        primary_goal: r.primary_goal ?? 'hypertrophy',
        secondary_goals: secondaryGoals,
        preferred_days_per_week: Number(r.preferred_days_per_week ?? 4),
        preferred_session_duration_mins: Number(r.preferred_session_duration_mins ?? 60),
        equipment_access: r.equipment_access ?? 'commercial_gym',
        created_at: String(r.created_at),
        updated_at: String(r.updated_at),
      };
    });

    // 13. Calibrated Parameters (Tier 2 Kalman Filter state)
    const rawCalibrated = await db.getAllAsync<any>(
      `SELECT id, exercise_id, calibrated_1rm, calibrated_k, cov_p00, cov_p11, calibrated_at
       FROM calibrated_params
       ORDER BY exercise_id ASC;`
    );
    const calibrated_params: CalibratedParam[] = (rawCalibrated || []).map((r) => ({
      id: String(r.id),
      exercise_id: String(r.exercise_id),
      calibrated_1rm: Number(r.calibrated_1rm),
      calibrated_k: Number(r.calibrated_k),
      cov_p00: Number(r.cov_p00 ?? 0.0),
      cov_p11: Number(r.cov_p11 ?? 0.0),
      calibrated_at: String(r.calibrated_at),
    }));

    return {
      version: EXPORT_SCHEMA_VERSION,
      exported_at: new Date().toISOString(),
      programs,
      program_blocks,
      workout_templates,
      template_exercises,
      progression_rules,
      workouts,
      workout_sets,
      exercises,
      gear_inventory,
      body_metrics,
      user_settings,
      user_profiles,
      calibrated_params,
    };
  }

  /**
   * Generates formatted or compact JSON string of the entire database state.
   */
  async exportToJsonString(
    database?: ISQLiteDatabase,
    pretty: boolean = true
  ): Promise<string> {
    const payload = await this.buildExportPayload(database);
    return JSON.stringify(payload, null, pretty ? 2 : undefined);
  }

  /**
   * Builds the export payload, writes it to local device storage, and triggers
   * the native OS sharing sheet (1-tap export from SettingsScreen).
   */
  async exportAndShare(
    database?: ISQLiteDatabase,
    options?: ExportOptions
  ): Promise<ExportResult> {
    const payload = await this.buildExportPayload(database);
    const jsonString = JSON.stringify(payload, null, 2);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = options?.fileName ?? `workout_suite_export_${timestamp}.json`;

    const cacheDir = this.getCacheDirectory() ?? '';
    // Ensure trailing slash on directory path if needed
    const normalizedDir = cacheDir.endsWith('/') || cacheDir === '' ? cacheDir : `${cacheDir}/`;
    const filePath = `${normalizedDir}${fileName}`;

    await this.fileWriter(filePath, jsonString);

    let shared = false;
    if (options?.share !== false) {
      shared = await this.fileSharer(filePath);
    }

    return {
      payload,
      jsonString,
      filePath,
      shared,
    };
  }
}
