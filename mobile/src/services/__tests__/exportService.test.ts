/**
 * Workout Suite — Standardized JSON Export Service Unit Tests
 *
 * Implements Step 2.3 Verification Gate:
 * - Contract-verified SQLite relational data serialization
 * - Dual-weight preservation (ADR-026)
 * - Boolean flag transformations (SQLite 0/1 -> JSON boolean)
 * - Stringified JSON column deserialization (progression rules, secondary goals)
 * - Key-value settings dictionary mapping
 * - expo-file-system writing and expo-sharing sheet triggering
 * - Emits schemas/fixtures/sample_workout_export.json for Python cross-stack validation
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExportService, EXPORT_SCHEMA_VERSION } from '../exportService';
import { MockSQLiteDatabase } from '../../database/__tests__/MockSQLiteDatabase';

describe('ExportService (Step 2.3)', () => {
  let mockDb: MockSQLiteDatabase;

  const mockPrograms = [
    {
      id: 'prog-hypertrophy-01',
      name: 'Upper/Lower Hypertrophy Meso 1',
      color_hex: '#3B82F6',
      notes: 'Focus on chest and back progressive overload',
      created_at: '2026-10-01T08:00:00.000Z',
    },
  ];

  const mockProgramBlocks = [
    {
      id: 'block-2026-q4',
      program_id: 'prog-hypertrophy-01',
      start_date: '2026-10-01',
      end_date: null,
    },
  ];

  const mockWorkoutTemplates = [
    {
      id: 'template-upper-a',
      program_id: 'prog-hypertrophy-01',
      name: 'Upper A - Strength Focus',
      notes: 'Heavy compound pressing',
      order_index: 0,
      created_at: '2026-10-01T08:30:00.000Z',
    },
  ];

  const mockTemplateExercises = [
    {
      id: 'te-bench-01',
      template_id: 'template-upper-a',
      exercise_id: 'barbell_bench_press',
      gear_id: 'gear-olympic-bar',
      target_sets: 4,
      target_reps_min: 6,
      target_reps_max: 8,
      target_rpe: 8.5,
      target_rir: 1.5,
      order_index: 0,
      exercise_group_id: null,
    },
  ];

  const mockProgressionRules = [
    {
      id: 'rule-bench-01',
      template_exercise_id: 'te-bench-01',
      priority: 1,
      rule_json: JSON.stringify({
        conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
        actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
      }),
    },
  ];

  const mockWorkouts = [
    {
      id: 'workout-20261013-01',
      template_id: 'template-upper-a',
      date: '2026-10-13',
      name: 'Upper A - Strength Focus',
      notes: 'Great energy today; hit top bracket reps on bench',
      started_at: '2026-10-13T17:30:00.000Z',
      duration_seconds: 4200,
      status: 'completed',
      completed_at: '2026-10-13T18:40:00.000Z',
      imported_from: null,
    },
  ];

  const mockWorkoutSets = [
    {
      id: 'set-bench-w1',
      workout_id: 'workout-20261013-01',
      exercise_id: 'barbell_bench_press',
      gear_id: 'gear-olympic-bar',
      set_number: 1,
      weight: 100.0,
      raw_input_weight: 100.0,
      added_weight: null,
      reps: 8,
      reps_right: null,
      rpe: 8.0,
      rir: 2.0,
      set_type: 'working',
      set_notes: 'Felt clean, explosive bar speed',
      exercise_group_id: null,
      created_at: '2026-10-13T17:42:00.000Z',
    },
    {
      id: 'set-bench-w2',
      workout_id: 'workout-20261013-01',
      exercise_id: 'barbell_bench_press',
      gear_id: 'gear-olympic-bar',
      set_number: 2,
      weight: 100.0,
      raw_input_weight: 100.0,
      added_weight: null,
      reps: 8,
      reps_right: null,
      rpe: 8.5,
      rir: 1.5,
      set_type: 'working',
      set_notes: null,
      exercise_group_id: null,
      created_at: '2026-10-13T17:46:00.000Z',
    },
  ];

  const mockExercises = [
    {
      id: 'barbell_bench_press',
      name: 'Barbell Bench Press',
      muscle_group: 'Chest',
      category: 'Barbell',
      is_compound: 1,
      is_bodyweight: 0,
      is_unilateral: 0,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 20.0,
      is_custom: 0,
      parent_exercise_id: null,
      standard_lift_type: 'bench',
      default_rest_seconds: 180,
    },
    {
      id: 'dumbbell_incline_press',
      name: 'Incline Dumbbell Press',
      muscle_group: 'Chest',
      category: 'Dumbbell',
      is_compound: 1,
      is_bodyweight: 0,
      is_unilateral: 0,
      load_mode: 'per_hand',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 0.0,
      is_custom: 0,
      parent_exercise_id: 'barbell_bench_press',
      standard_lift_type: 'bench',
      default_rest_seconds: 120,
    },
  ];

  const mockGearInventory = [
    {
      id: 'gear-olympic-bar',
      name: 'Standard Olympic Barbell',
      type: 'barbell',
      tare_weight_kg: 20.0,
      cable_ratio: 1.0,
      is_default: 1,
      notes: 'Standard 20kg 28.5mm bar',
    },
    {
      id: 'gear-cable-stack-1',
      name: 'Dual Cable Functional Trainer',
      type: 'cable_machine',
      tare_weight_kg: 0.0,
      cable_ratio: 0.5,
      is_default: 1,
      notes: '2:1 pulley reduction stack',
    },
  ];

  const mockBodyMetrics = [
    {
      id: 'metric-20261013-01',
      date: '2026-10-13',
      bodyweight: 84.2,
      body_fat_manual: 14.2,
      waist_cm: 82.5,
      neck_cm: 39.5,
      hip_cm: null,
      bicep_cm: 38.5,
      chest_cm: 105.0,
      thigh_cm: 61.5,
      calf_cm: 38.0,
      navy_body_fat: 14.0,
      imported_from: 'strengthlog',
    },
    {
      id: 'metric-20261014-02',
      date: '2026-10-14',
      bodyweight: 0,
      body_fat_manual: null,
      waist_cm: 83.0,
      neck_cm: null,
      hip_cm: null,
      bicep_cm: null,
      chest_cm: null,
      thigh_cm: null,
      calf_cm: null,
      navy_body_fat: null,
      imported_from: 'strengthlog',
    },
  ];

  const mockCalibratedParams = [
    {
      id: 'cal-bench-01',
      exercise_id: 'barbell_bench_press',
      calibrated_1rm: 125.0,
      calibrated_k: 0.085,
      cov_p00: 0.001,
      cov_p11: 0.001,
      calibrated_at: '2026-10-13T20:00:00.000Z',
    },
  ];

  const mockUserSettings = [
    { key: 'unit_system', value: 'kg' },
    { key: 'intensity_metric', value: 'RPE' },
    { key: 'pure_utility_mode', value: '0' },
  ];

  const mockUserProfiles = [
    {
      id: 'profile-primary-user',
      gender: 'male',
      birthdate: '1995-06-20',
      height_cm: 182.0,
      training_mentality: 'precision',
      training_enjoyment: 'enthusiast',
      intensity_style: 'balanced',
      primary_goal: 'hypertrophy',
      secondary_goals: JSON.stringify(['strength', 'powerbuilding']),
      preferred_days_per_week: 4,
      preferred_session_duration_mins: 75,
      equipment_access: 'commercial_gym',
      created_at: '2026-10-01T07:00:00.000Z',
      updated_at: '2026-10-13T20:00:00.000Z',
    },
  ];

  function seedMockDb(db: MockSQLiteDatabase): void {
    db.mockData.set('FROM programs', mockPrograms);
    db.mockData.set('FROM program_blocks', mockProgramBlocks);
    db.mockData.set('FROM workout_templates', mockWorkoutTemplates);
    db.mockData.set('FROM template_exercises', mockTemplateExercises);
    db.mockData.set('FROM progression_rules', mockProgressionRules);
    db.mockData.set('FROM workouts', mockWorkouts);
    db.mockData.set('FROM workout_sets', mockWorkoutSets);
    db.mockData.set('FROM exercises', mockExercises);
    db.mockData.set('FROM gear_inventory', mockGearInventory);
    db.mockData.set('FROM body_metrics', mockBodyMetrics);
    db.mockData.set('FROM user_settings', mockUserSettings);
    db.mockData.set('FROM user_profiles', mockUserProfiles);
    db.mockData.set('FROM calibrated_params', mockCalibratedParams);
  }

  beforeEach(() => {
    mockDb = new MockSQLiteDatabase();
    seedMockDb(mockDb);
  });

  describe('buildExportPayload', () => {
    it('serializes all 12 tables into canonical contract structure', async () => {
      const service = new ExportService(mockDb);
      const payload = await service.buildExportPayload();

      // Top-level schema properties
      expect(payload.version).toBe(EXPORT_SCHEMA_VERSION);
      expect(typeof payload.exported_at).toBe('string');
      expect(new Date(payload.exported_at).getTime()).not.toBeNaN();

      // Programs & Blocks
      expect(payload.programs).toHaveLength(1);
      expect(payload.programs[0].id).toBe('prog-hypertrophy-01');
      expect(payload.programs[0].color_hex).toBe('#3B82F6');
      expect(payload.program_blocks).toHaveLength(1);
      expect(payload.program_blocks[0].start_date).toBe('2026-10-01');
      expect(payload.program_blocks[0].end_date).toBeNull();

      // Templates & Prescriptions
      expect(payload.workout_templates).toHaveLength(1);
      expect(payload.workout_templates[0].name).toBe('Upper A - Strength Focus');
      expect(payload.template_exercises).toHaveLength(1);
      expect(payload.template_exercises[0].target_sets).toBe(4);
      expect(payload.template_exercises[0].target_rpe).toBe(8.5);

      // Progression Rules (JSON string parse verification)
      expect(payload.progression_rules).toHaveLength(1);
      expect(typeof payload.progression_rules[0].rule_json).toBe('object');
      expect(payload.progression_rules[0].rule_json).toEqual({
        conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
        actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
      });

      // Workouts & Sets (ADR-026 dual-weight persistence)
      expect(payload.workouts).toHaveLength(1);
      expect(payload.workouts[0].status).toBe('completed');
      expect(payload.workouts[0].duration_seconds).toBe(4200);

      expect(payload.workout_sets).toHaveLength(2);
      expect(payload.workout_sets[0].weight).toBe(100.0);
      expect(payload.workout_sets[0].raw_input_weight).toBe(100.0);
      expect(payload.workout_sets[0].reps).toBe(8);
      expect(payload.workout_sets[0].set_type).toBe('working');

      // Exercises (boolean transformations)
      expect(payload.exercises).toHaveLength(2);
      const bench = payload.exercises.find((e) => e.id === 'barbell_bench_press');
      expect(bench).toBeDefined();
      expect(bench?.is_compound).toBe(true);
      expect(bench?.is_bodyweight).toBe(false);
      expect(bench?.is_unilateral).toBe(false);
      expect(bench?.is_custom).toBe(false);
      expect(bench?.load_mode).toBe('total');

      const incline = payload.exercises.find((e) => e.id === 'dumbbell_incline_press');
      expect(incline?.parent_exercise_id).toBe('barbell_bench_press');
      expect(incline?.load_mode).toBe('per_hand');

      // Gear Inventory
      expect(payload.gear_inventory).toHaveLength(2);
      const bar = payload.gear_inventory.find((g) => g.id === 'gear-olympic-bar');
      expect(bar?.is_default).toBe(true);
      expect(bar?.tare_weight_kg).toBe(20.0);

      // Body Metrics
      expect(payload.body_metrics).toHaveLength(2);
      expect(payload.body_metrics[0].bodyweight).toBe(84.2);
      expect(payload.body_metrics[0].navy_body_fat).toBe(14.0);
      expect(payload.body_metrics[1].bodyweight).toBeNull();
      expect(payload.body_metrics[1].waist_cm).toBe(83.0);

      // User Settings (Dictionary conversion)
      expect(payload.user_settings).toEqual({
        unit_system: 'kg',
        intensity_metric: 'RPE',
        pure_utility_mode: '0',
      });

      // User Profiles (Secondary goals JSON array parsing)
      expect(payload.user_profiles).toHaveLength(1);
      const prof = payload.user_profiles[0];
      expect(prof.gender).toBe('male');
      expect(prof.equipment_access).toBe('commercial_gym');
      expect(prof.secondary_goals).toEqual(['strength', 'powerbuilding']);

      // Calibrated Parameters
      expect(payload.calibrated_params).toHaveLength(1);
      expect(payload.calibrated_params[0].calibrated_1rm).toBe(125.0);
      expect(payload.calibrated_params[0].calibrated_k).toBe(0.085);
      expect(payload.calibrated_params[0].cov_p00).toBe(0.001);
      expect(payload.calibrated_params[0].cov_p11).toBe(0.001);
    });

    it('handles empty database tables without failing', async () => {
      const emptyDb = new MockSQLiteDatabase();
      const service = new ExportService(emptyDb);
      const payload = await service.buildExportPayload();

      expect(payload.version).toBe('1.0.0');
      expect(payload.programs).toEqual([]);
      expect(payload.program_blocks).toEqual([]);
      expect(payload.workout_templates).toEqual([]);
      expect(payload.template_exercises).toEqual([]);
      expect(payload.progression_rules).toEqual([]);
      expect(payload.workouts).toEqual([]);
      expect(payload.workout_sets).toEqual([]);
      expect(payload.exercises).toEqual([]);
      expect(payload.gear_inventory).toEqual([]);
      expect(payload.body_metrics).toEqual([]);
      expect(payload.user_settings).toEqual({});
      expect(payload.user_profiles).toEqual([]);
      expect(payload.calibrated_params).toEqual([]);
      expect(payload.pain_reports).toEqual([]);
    });

    it('throws when no database is provided', async () => {
      const service = new ExportService();
      await expect(service.buildExportPayload()).rejects.toThrow(
        'ExportService: No SQLite database instance provided.'
      );
    });
  });

  describe('exportToJsonString', () => {
    it('produces valid parseable JSON string representation', async () => {
      const service = new ExportService(mockDb);
      const jsonStr = await service.exportToJsonString();

      const parsed = JSON.parse(jsonStr);
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.workouts).toHaveLength(1);
      expect(parsed.user_settings.unit_system).toBe('kg');
    });

    it('supports compact output formatting', async () => {
      const service = new ExportService(mockDb);
      const compactJson = await service.exportToJsonString(undefined, false);

      expect(compactJson.includes('\n')).toBe(false);
    });
  });

  describe('exportAndShare', () => {
    it('invokes injected fileWriter and fileSharer', async () => {
      let writtenPath = '';
      let writtenContent = '';
      let sharedPath = '';

      const mockWriter = async (filePath: string, contents: string) => {
        writtenPath = filePath;
        writtenContent = contents;
      };

      const mockSharer = async (filePath: string) => {
        sharedPath = filePath;
        return true;
      };

      const service = new ExportService(mockDb, {
        fileWriter: mockWriter,
        fileSharer: mockSharer,
        getCacheDirectory: () => 'file:///data/user/0/cache',
      });

      const result = await service.exportAndShare();

      expect(result.shared).toBe(true);
      expect(writtenPath).toMatch(/^file:\/\/\/data\/user\/0\/cache\/workout_suite_export_/);
      expect(sharedPath).toBe(writtenPath);
      expect(JSON.parse(writtenContent).version).toBe('1.0.0');
    });

    it('bypasses sharing when share option is false', async () => {
      let sharerCalled = false;
      const service = new ExportService(mockDb, {
        fileWriter: async () => {},
        fileSharer: async () => {
          sharerCalled = true;
          return true;
        },
        getCacheDirectory: () => 'file:///data/user/0/cache',
      });

      const result = await service.exportAndShare(undefined, { share: false });
      expect(result.shared).toBe(false);
      expect(sharerCalled).toBe(false);
    });
  });

  describe('Sample Export Fixture Generation (Deliverable 3)', () => {
    it('writes sample_workout_export.json to schemas/fixtures/ for Python contract verification', async () => {
      const service = new ExportService(mockDb);
      const payload = await service.buildExportPayload();

      // Ensure fixtures directory exists
      const fixturesDir = path.resolve(__dirname, '../../../../schemas/fixtures');
      if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
      }

      const fixtureFilePath = path.join(fixturesDir, 'sample_workout_export.json');
      fs.writeFileSync(fixtureFilePath, JSON.stringify(payload, null, 2), 'utf-8');

      expect(fs.existsSync(fixtureFilePath)).toBe(true);

      const readBack = JSON.parse(fs.readFileSync(fixtureFilePath, 'utf-8'));
      expect(readBack.version).toBe('1.0.0');
      expect(readBack.programs).toHaveLength(1);
      expect(readBack.exercises).toHaveLength(2);
      expect(readBack.workout_sets).toHaveLength(2);
      expect(readBack.user_profiles).toHaveLength(1);
    });
  });
});
