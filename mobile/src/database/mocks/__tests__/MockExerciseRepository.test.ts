import { MockExerciseRepository } from '../MockExerciseRepository';
import { Exercise } from '../../../core/types';

describe('MockExerciseRepository', () => {
  let repo: MockExerciseRepository;

  const mockSquat: Exercise = {
    id: 'barbell_squat',
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
  };

  const mockFrontSquat: Exercise = {
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
    parent_exercise_id: 'barbell_squat',
    standard_lift_type: 'squat',
    default_rest_seconds: 150,
  };

  const mockBench: Exercise = {
    id: 'barbell_bench',
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
  };

  const mockPushup: Exercise = {
    id: 'pushup',
    name: 'Push Up',
    muscle_group: 'Chest',
    category: 'Bodyweight',
    is_compound: true,
    is_bodyweight: true,
    is_unilateral: false,
    load_mode: 'total',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 0.0,
    is_custom: false,
    parent_exercise_id: null,
    standard_lift_type: null,
    default_rest_seconds: 60,
  };

  beforeEach(() => {
    repo = new MockExerciseRepository([mockSquat, mockFrontSquat, mockBench, mockPushup]);
  });

  it('retrieves an exercise by id', async () => {
    const exercise = await repo.findById('barbell_squat');
    expect(exercise).not.toBeNull();
    expect(exercise?.name).toBe('Barbell Back Squat');
  });

  it('returns null when exercise id does not exist', async () => {
    const exercise = await repo.findById('non_existent');
    expect(exercise).toBeNull();
  });

  it('retrieves all exercises', async () => {
    const all = await repo.findAll();
    expect(all).toHaveLength(4);
  });

  it('filters exercises by category', async () => {
    const barbellExercises = await repo.findByCategory('Barbell');
    expect(barbellExercises).toHaveLength(3);
    const bodyweightExercises = await repo.findByCategory('Bodyweight');
    expect(bodyweightExercises).toHaveLength(1);
    expect(bodyweightExercises[0].id).toBe('pushup');
  });

  it('filters exercises by muscle group (case-insensitive)', async () => {
    const quads = await repo.findByMuscleGroup('Quads');
    expect(quads).toHaveLength(2);
    const chest = await repo.findByMuscleGroup('chest');
    expect(chest).toHaveLength(2);
  });

  it('finds variants linked to a parent exercise', async () => {
    const variants = await repo.findVariants('barbell_squat');
    expect(variants).toHaveLength(1);
    expect(variants[0].id).toBe('front_squat');

    const emptyVariants = await repo.findVariants('barbell_bench');
    expect(emptyVariants).toHaveLength(0);
  });

  it('searches exercises by name or muscle group substring', async () => {
    const squatSearch = await repo.search('squat');
    expect(squatSearch).toHaveLength(2);

    const chestSearch = await repo.search('Chest');
    expect(chestSearch).toHaveLength(2);

    const emptySearch = await repo.search('xyz123');
    expect(emptySearch).toHaveLength(0);

    const blankSearch = await repo.search('');
    expect(blankSearch).toHaveLength(4);
  });

  it('creates and persists a new exercise', async () => {
    const newEx: Exercise = {
      id: 'cable_row',
      name: 'Seated Cable Row',
      muscle_group: 'Back',
      category: 'Cable',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 0.0,
      is_custom: true,
      parent_exercise_id: null,
      standard_lift_type: 'row',
      default_rest_seconds: 90,
    };

    const created = await repo.create(newEx);
    expect(created.id).toBe('cable_row');

    const fetched = await repo.findById('cable_row');
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe('Seated Cable Row');
  });

  it('updates an existing exercise', async () => {
    const updated = await repo.update({
      ...mockSquat,
      name: 'Competition Back Squat',
      default_rest_seconds: 240,
    });
    expect(updated.name).toBe('Competition Back Squat');
    expect(updated.default_rest_seconds).toBe(240);

    const fetched = await repo.findById('barbell_squat');
    expect(fetched?.name).toBe('Competition Back Squat');
  });

  it('throws an error when updating a non-existent exercise', async () => {
    await expect(
      repo.update({
        ...mockSquat,
        id: 'unknown_id',
      })
    ).rejects.toThrow("Exercise with id 'unknown_id' not found");
  });

  it('deletes an exercise by id', async () => {
    await repo.delete('pushup');
    const fetched = await repo.findById('pushup');
    expect(fetched).toBeNull();
    const all = await repo.findAll();
    expect(all).toHaveLength(3);
  });

  it('preserves immutability by returning copies', async () => {
    const original = await repo.findById('barbell_squat');
    expect(original).not.toBeNull();
    if (original) {
      original.name = 'Mutated Squat';
    }
    const fresh = await repo.findById('barbell_squat');
    expect(fresh?.name).toBe('Barbell Back Squat');
  });

  it('clears all items via clear()', async () => {
    repo.clear();
    const all = await repo.findAll();
    expect(all).toHaveLength(0);
  });
});
