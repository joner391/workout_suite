/**
 * Workout Suite — Exercise Library & Variant Tree Test Suite
 *
 * Implements Step 2.2 Verification Gate
 * Validates:
 * - Search by exercise name and target muscle group
 * - Multi-criteria filtering (muscle group, category, custom only)
 * - Variant hierarchy grouping (root movements and nested child variants per ADR-012)
 * - Custom exercise creation with canonical kg normalization
 * - Updating and deleting custom exercises
 */

import { MockExerciseRepository } from '../../../database/mocks/MockExerciseRepository';
import { MockUserSettingsRepository } from '../../../database/mocks/MockUserSettingsRepository';
import { Exercise } from '../../../core/types';
import { lbsToKg, kgToLbs } from '../../../core/math/unitConversion';

describe('Exercise Library & Variant Tree Management (Step 2.2)', () => {
  let exerciseRepo: MockExerciseRepository;
  let userSettingsRepo: MockUserSettingsRepository;

  const sampleCatalog: Exercise[] = [
    {
      id: 'barbell_back_squat',
      name: 'Barbell Back Squat',
      muscle_group: 'Quads',
      category: 'Barbell',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 20.0,
      is_custom: false,
      parent_exercise_id: null,
      standard_lift_type: 'squat',
      default_rest_seconds: 180,
    },
    {
      id: 'front_squat',
      name: 'Front Squat',
      muscle_group: 'Quads',
      category: 'Barbell',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 20.0,
      is_custom: false,
      parent_exercise_id: 'barbell_back_squat',
      standard_lift_type: 'squat',
      default_rest_seconds: 150,
    },
    {
      id: 'box_squat',
      name: 'Box Squat',
      muscle_group: 'Quads',
      category: 'Barbell',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 20.0,
      is_custom: false,
      parent_exercise_id: 'barbell_back_squat',
      standard_lift_type: 'squat',
      default_rest_seconds: 150,
    },
    {
      id: 'barbell_bench_press',
      name: 'Barbell Bench Press',
      muscle_group: 'Chest',
      category: 'Barbell',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 20.0,
      is_custom: false,
      parent_exercise_id: null,
      standard_lift_type: 'bench',
      default_rest_seconds: 180,
    },
    {
      id: 'incline_bench_press',
      name: 'Incline Barbell Bench Press',
      muscle_group: 'Chest',
      category: 'Barbell',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 20.0,
      is_custom: false,
      parent_exercise_id: 'barbell_bench_press',
      standard_lift_type: 'bench',
      default_rest_seconds: 150,
    },
    {
      id: 'dumbbell_curl',
      name: 'Dumbbell Bicep Curl',
      muscle_group: 'Biceps',
      category: 'Dumbbell',
      is_compound: false,
      is_bodyweight: false,
      is_unilateral: true,
      load_mode: 'per_hand',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 0.0,
      is_custom: false,
      parent_exercise_id: null,
      standard_lift_type: null,
      default_rest_seconds: 90,
    },
    {
      id: 'custom_lat_raise',
      name: 'My Special Cable Lateral Raise',
      muscle_group: 'Shoulders',
      category: 'Cable',
      is_compound: false,
      is_bodyweight: false,
      is_unilateral: true,
      load_mode: 'total',
      default_cable_ratio: 0.5,
      default_bar_weight_kg: 0.0,
      is_custom: true,
      parent_exercise_id: null,
      standard_lift_type: null,
      default_rest_seconds: 60,
    },
  ];

  beforeEach(() => {
    exerciseRepo = new MockExerciseRepository(sampleCatalog);
    userSettingsRepo = new MockUserSettingsRepository();
  });

  describe('Catalog Search and Filter Logic', () => {
    it('retrieves all catalog items', async () => {
      const all = await exerciseRepo.findAll();
      expect(all).toHaveLength(7);
    });

    it('filters exercises by muscle group (case-insensitive)', async () => {
      const chestExercises = await exerciseRepo.findByMuscleGroup('chest');
      expect(chestExercises).toHaveLength(2);
      expect(chestExercises.every((e) => e.muscle_group === 'Chest')).toBe(true);

      const quadsExercises = await exerciseRepo.findByMuscleGroup('Quads');
      expect(quadsExercises).toHaveLength(3);
    });

    it('filters exercises by category/equipment', async () => {
      const barbells = await exerciseRepo.findByCategory('Barbell');
      expect(barbells).toHaveLength(5);

      const dumbbells = await exerciseRepo.findByCategory('Dumbbell');
      expect(dumbbells).toHaveLength(1);
      expect(dumbbells[0].name).toBe('Dumbbell Bicep Curl');
    });

    it('searches by name substring', async () => {
      const results = await exerciseRepo.search('squat');
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.id)).toEqual(
        expect.arrayContaining(['barbell_back_squat', 'front_squat', 'box_squat'])
      );
    });

    it('searches by muscle group substring', async () => {
      const results = await exerciseRepo.search('biceps');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Dumbbell Bicep Curl');
    });
  });

  describe('Variant Hierarchy (ADR-012)', () => {
    it('finds child variants linked to a root movement', async () => {
      const squatVariants = await exerciseRepo.findVariants('barbell_back_squat');
      expect(squatVariants).toHaveLength(2);
      expect(squatVariants.map((v) => v.name)).toEqual(['Front Squat', 'Box Squat']);
    });

    it('returns empty array when an exercise has no child variants', async () => {
      const variants = await exerciseRepo.findVariants('box_squat');
      expect(variants).toEqual([]);
    });

    it('links a custom exercise as a variant of a root movement', async () => {
      const customPinPress: Exercise = {
        id: 'custom_pin_press',
        name: 'Pin Bench Press',
        muscle_group: 'Chest',
        category: 'Barbell',
        is_compound: true,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 20.0,
        is_custom: true,
        parent_exercise_id: 'barbell_bench_press',
        standard_lift_type: 'bench',
        default_rest_seconds: 150,
      };

      await exerciseRepo.create(customPinPress);

      const benchVariants = await exerciseRepo.findVariants('barbell_bench_press');
      expect(benchVariants).toHaveLength(2);
      expect(benchVariants.some((v) => v.id === 'custom_pin_press')).toBe(true);
    });
  });

  describe('Custom Exercise CRUD', () => {
    it('creates a custom exercise with is_custom set to true', async () => {
      const newExercise: Exercise = {
        id: 'custom_hack_squat',
        name: 'Reverse Hack Squat',
        muscle_group: 'Glutes',
        category: 'Machine',
        is_compound: true,
        is_bodyweight: false,
        is_unilateral: false,
        load_mode: 'total',
        default_cable_ratio: 1.0,
        default_bar_weight_kg: 0.0,
        is_custom: true,
        parent_exercise_id: null,
        standard_lift_type: null,
        default_rest_seconds: 120,
      };

      const created = await exerciseRepo.create(newExercise);
      expect(created.id).toBe('custom_hack_squat');
      expect(created.is_custom).toBe(true);

      const fetched = await exerciseRepo.findById('custom_hack_squat');
      expect(fetched?.name).toBe('Reverse Hack Squat');
    });

    it('updates an existing custom exercise', async () => {
      const existing = await exerciseRepo.findById('custom_lat_raise');
      expect(existing).not.toBeNull();

      const updated: Exercise = {
        ...existing!,
        name: 'Dual Cable Y-Raise',
        muscle_group: 'Shoulders',
        default_rest_seconds: 75,
      };

      await exerciseRepo.update(updated);

      const fetched = await exerciseRepo.findById('custom_lat_raise');
      expect(fetched?.name).toBe('Dual Cable Y-Raise');
      expect(fetched?.default_rest_seconds).toBe(75);
    });

    it('deletes a custom exercise', async () => {
      await exerciseRepo.delete('custom_lat_raise');
      const fetched = await exerciseRepo.findById('custom_lat_raise');
      expect(fetched).toBeNull();
    });
  });

  describe('Unit Conversion in Exercise Configuration (ADR-008)', () => {
    it('converts bar weight from lbs to canonical kg when saving', () => {
      const inputLbs = 45;
      const convertedKg = lbsToKg(inputLbs);
      expect(Math.round(convertedKg * 10) / 10).toBe(20.4);

      // And displays back correctly
      const displayLbs = kgToLbs(convertedKg);
      expect(Math.round(displayLbs)).toBe(45);
    });
  });
});
