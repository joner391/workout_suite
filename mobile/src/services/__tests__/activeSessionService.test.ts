import { ActiveSessionService } from '../activeSessionService';
import { MockWorkoutRepository } from '../../database/mocks/MockWorkoutRepository';
import { MockExerciseRepository } from '../../database/mocks/MockExerciseRepository';
import { MockGearRepository } from '../../database/mocks/MockGearRepository';
import { Exercise, GearInventory, Workout, WorkoutSet } from '../../core/types';

describe('ActiveSessionService', () => {
  let workoutRepo: MockWorkoutRepository;
  let exerciseRepo: MockExerciseRepository;
  let gearRepo: MockGearRepository;
  let sessionService: ActiveSessionService;

  const mockExercises: Exercise[] = [
    {
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
    },
    {
      id: 'db_bench',
      name: 'Dumbbell Bench Press',
      muscle_group: 'Chest',
      category: 'Dumbbell',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'per_hand',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 0.0,
      is_custom: false,
      parent_exercise_id: 'barbell_bench',
      standard_lift_type: null,
      default_rest_seconds: 120,
    },
    {
      id: 'cable_crossover',
      name: 'Cable Crossover',
      muscle_group: 'Chest',
      category: 'Cable',
      is_compound: false,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 0.5, // 2:1 pulley ratio
      default_bar_weight_kg: 0.0,
      is_custom: false,
      parent_exercise_id: null,
      standard_lift_type: null,
      default_rest_seconds: 90,
    },
    {
      id: 'weighted_pullup',
      name: 'Weighted Pull-Up',
      muscle_group: 'Back',
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
      default_rest_seconds: 150,
    },
    {
      id: 'db_lunge',
      name: 'Dumbbell Walking Lunge',
      muscle_group: 'Quads',
      category: 'Dumbbell',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: true, // Unilateral limb tracking
      load_mode: 'per_hand',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 0.0,
      is_custom: false,
      parent_exercise_id: null,
      standard_lift_type: null,
      default_rest_seconds: 90,
    },
  ];

  const mockGear: GearInventory[] = [
    {
      id: 'ssb_bar',
      name: 'Safety Squat Bar',
      type: 'specialty_bar',
      tare_weight_kg: 29.0,
      cable_ratio: 1.0,
      is_default: false,
      notes: null,
    },
    {
      id: 'lat_pulldown_1_to_1',
      name: 'Lat Pulldown 1:1',
      type: 'cable_machine',
      tare_weight_kg: 0.0,
      cable_ratio: 1.0,
      is_default: false,
      notes: null,
    },
  ];

  beforeEach(() => {
    workoutRepo = new MockWorkoutRepository();
    exerciseRepo = new MockExerciseRepository(mockExercises);
    gearRepo = new MockGearRepository(mockGear);
    sessionService = new ActiveSessionService(workoutRepo, exerciseRepo, gearRepo);
  });

  describe('Session Lifecycle Management', () => {
    it('starts an in-progress workout session with default values', async () => {
      const workout = await sessionService.startWorkout({ name: 'Chest Day' });

      expect(workout.id).toBeDefined();
      expect(workout.name).toBe('Chest Day');
      expect(workout.status).toBe('in_progress');
      expect(workout.date).toBeDefined();
      expect(workout.started_at).toBeDefined();
      expect(workout.duration_seconds).toBeNull();

      const active = await sessionService.getInProgressWorkout();
      expect(active?.id).toBe(workout.id);
    });

    it('prevents starting multiple concurrent in-progress workouts by default', async () => {
      await sessionService.startWorkout({ name: 'Workout 1' });

      await expect(
        sessionService.startWorkout({ name: 'Workout 2' })
      ).rejects.toThrow(/already in progress/);
    });

    it('allows starting a second workout when explicitly configured', async () => {
      const w1 = await sessionService.startWorkout({ name: 'Workout 1' });
      const w2 = await sessionService.startWorkout(
        { name: 'Workout 2' },
        { allowMultipleInProgress: true }
      );

      expect(w1.id).not.toBe(w2.id);
    });

    it('completes a workout and calculates elapsed duration', async () => {
      const startTime = '2026-10-14T10:00:00.000Z';
      const endTime = '2026-10-14T11:15:30.000Z'; // 75 minutes 30 seconds = 4530 seconds

      const workout = await sessionService.startWorkout({
        name: 'Full Body',
        startedAt: startTime,
      });

      const finished = await sessionService.finishWorkout(workout.id, {
        completedAt: endTime,
        notes: 'Great pump!',
      });

      expect(finished.status).toBe('completed');
      expect(finished.duration_seconds).toBe(4530);
      expect(finished.notes).toBe('Great pump!');
      expect(finished.completed_at).toBe(endTime);

      const inProgress = await sessionService.getInProgressWorkout();
      expect(inProgress).toBeNull();
    });

    it('discards an in-progress workout', async () => {
      const workout = await sessionService.startWorkout({ name: 'Chest Day' });
      const discarded = await sessionService.discardWorkout(workout.id);

      expect(discarded.status).toBe('discarded');
      expect(discarded.completed_at).toBeDefined();

      const inProgress = await sessionService.getInProgressWorkout();
      expect(inProgress).toBeNull();
    });

    it('permanently deletes a workout and cascades sets', async () => {
      const workout = await sessionService.startWorkout({ name: 'Leg Day' });
      await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
      });

      await sessionService.deleteWorkout(workout.id);

      const lookup = await workoutRepo.findById(workout.id);
      expect(lookup).toBeNull();
      const sets = await workoutRepo.getSetsByWorkoutId(workout.id);
      expect(sets).toHaveLength(0);
    });
  });

  describe('Dual-Field Weight Normalization (ADR-026)', () => {
    let workout: Workout;

    beforeEach(async () => {
      workout = await sessionService.startWorkout({ name: 'Normalization Tests' });
    });

    it('logs barbell set with canonical load matching raw input', async () => {
      const set = await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
        rpe: 8.5,
      });

      expect(set.raw_input_weight).toBe(100);
      expect(set.weight).toBe(100);
      expect(set.added_weight).toBeNull();
      expect(set.set_number).toBe(1);
    });

    it('logs dumbbell set with per-hand load auto-doubled for canonical weight', async () => {
      const set = await sessionService.addSet(workout.id, {
        exerciseId: 'db_bench',
        rawInputWeight: 32.5, // 32.5 kg single dumbbell
        reps: 8,
      });

      expect(set.raw_input_weight).toBe(32.5);
      expect(set.weight).toBe(65.0); // 32.5 * 2 = 65.0 kg effective mechanical load
      expect(set.added_weight).toBeNull();
    });

    it('logs cable set with 2:1 pulley ratio applied to canonical weight', async () => {
      const set = await sessionService.addSet(workout.id, {
        exerciseId: 'cable_crossover',
        rawInputWeight: 40.0, // 40 kg stack pin
        reps: 12,
      });

      expect(set.raw_input_weight).toBe(40.0);
      expect(set.weight).toBe(20.0); // 40 * 0.5 = 20.0 kg effective force
      expect(set.added_weight).toBeNull();
    });

    it('logs bodyweight set with active bodyweight + added delta for total system load (ADR-018)', async () => {
      const set = await sessionService.addSet(workout.id, {
        exerciseId: 'weighted_pullup',
        rawInputWeight: 15.0, // +15 kg on belt
        bodyweightKg: 80.0,
        addedWeight: 15.0,
        reps: 6,
      });

      expect(set.raw_input_weight).toBe(15.0);
      expect(set.added_weight).toBe(15.0);
      expect(set.weight).toBe(95.0); // 80 + 15 = 95.0 kg effective system load
    });

    it('logs assisted bodyweight set with negative delta (ADR-018)', async () => {
      const set = await sessionService.addSet(workout.id, {
        exerciseId: 'weighted_pullup',
        rawInputWeight: -20.0, // 20 kg counterweight assistance
        bodyweightKg: 80.0,
        addedWeight: -20.0,
        reps: 10,
      });

      expect(set.raw_input_weight).toBe(-20.0);
      expect(set.added_weight).toBe(-20.0);
      expect(set.weight).toBe(60.0); // 80 - 20 = 60.0 kg effective system load
    });

    it('logs unilateral limb tracking with reps_right preserved', async () => {
      const set = await sessionService.addSet(workout.id, {
        exerciseId: 'db_lunge',
        rawInputWeight: 20.0,
        reps: 10, // Left limb
        repsRight: 10, // Right limb
      });

      expect(set.raw_input_weight).toBe(20.0);
      expect(set.weight).toBe(40.0); // per_hand 20 * 2 = 40
      expect(set.reps).toBe(10);
      expect(set.reps_right).toBe(10);
    });
  });

  describe('Set Numbering, Updates, Deletions & Reordering', () => {
    let workout: Workout;

    beforeEach(async () => {
      workout = await sessionService.startWorkout({ name: 'Set Operations' });
    });

    it('assigns contiguous set numbers (1, 2, 3...) per exercise', async () => {
      const s1 = await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
      });
      const s2 = await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
      });
      const s3 = await sessionService.addSet(workout.id, {
        exerciseId: 'db_bench',
        rawInputWeight: 30,
        reps: 8,
      });
      const s4 = await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 105,
        reps: 3,
      });

      expect(s1.set_number).toBe(1);
      expect(s2.set_number).toBe(2);
      expect(s3.set_number).toBe(1); // Different exercise -> starts at 1
      expect(s4.set_number).toBe(3); // 3rd set of barbell_bench
    });

    it('updates an existing set and re-normalizes load when weight changes', async () => {
      const set = await sessionService.addSet(workout.id, {
        exerciseId: 'db_bench',
        rawInputWeight: 30,
        reps: 8,
      });

      expect(set.weight).toBe(60);

      const updated = await sessionService.updateSet(workout.id, set.id, {
        rawInputWeight: 34,
        reps: 6,
        rpe: 9.0,
      });

      expect(updated.raw_input_weight).toBe(34);
      expect(updated.weight).toBe(68); // 34 * 2
      expect(updated.reps).toBe(6);
      expect(updated.rpe).toBe(9.0);
    });

    it('deletes a set and renumbers remaining sets contiguously', async () => {
      const s1 = await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
      });
      const s2 = await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 102.5,
        reps: 5,
      });
      const s3 = await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 105,
        reps: 4,
      });

      // Delete set 2
      await sessionService.deleteSet(workout.id, s2.id);

      const remaining = await workoutRepo.getSetsByWorkoutId(workout.id);
      expect(remaining).toHaveLength(2);

      const remainingBench = remaining.filter((s) => s.exercise_id === 'barbell_bench');
      expect(remainingBench[0].id).toBe(s1.id);
      expect(remainingBench[0].set_number).toBe(1);

      // s3 was previously set_number 3; should now be renumbered to 2
      expect(remainingBench[1].id).toBe(s3.id);
      expect(remainingBench[1].set_number).toBe(2);
    });

    it('reorders sets for an exercise', async () => {
      const s1 = await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
      });
      const s2 = await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 105,
        reps: 3,
      });
      const s3 = await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 90,
        reps: 8,
      });

      // Reverse order: s3, s1, s2
      const reordered = await sessionService.reorderSets(workout.id, 'barbell_bench', [
        s3.id,
        s1.id,
        s2.id,
      ]);

      expect(reordered[0].id).toBe(s3.id);
      expect(reordered[0].set_number).toBe(1);
      expect(reordered[1].id).toBe(s1.id);
      expect(reordered[1].set_number).toBe(2);
      expect(reordered[2].id).toBe(s2.id);
      expect(reordered[2].set_number).toBe(3);
    });
  });

  describe('Ghost Sets Progressive Overload Lookup', () => {
    it('retrieves ghost sets from the most recently completed session only', async () => {
      // Completed session 1 (older)
      const pastWorkout1: Workout = {
        id: 'past_w1',
        template_id: null,
        date: '2026-10-01',
        name: 'Past Upper',
        notes: null,
        started_at: '2026-10-01T10:00:00.000Z',
        duration_seconds: 3600,
        status: 'completed',
        completed_at: '2026-10-01T11:00:00.000Z',
        imported_from: null,
      };
      const pastSets1: WorkoutSet[] = [
        {
          id: 'p1_s1',
          workout_id: 'past_w1',
          exercise_id: 'barbell_bench',
          gear_id: null,
          set_number: 1,
          weight: 95,
          raw_input_weight: 95,
          added_weight: null,
          reps: 5,
          reps_right: null,
          rpe: 8,
          rir: 2,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: '2026-10-01T10:10:00.000Z',
        },
      ];

      // Completed session 2 (more recent)
      const pastWorkout2: Workout = {
        id: 'past_w2',
        template_id: null,
        date: '2026-10-08',
        name: 'Recent Upper',
        notes: null,
        started_at: '2026-10-08T10:00:00.000Z',
        duration_seconds: 3600,
        status: 'completed',
        completed_at: '2026-10-08T11:00:00.000Z',
        imported_from: null,
      };
      const pastSets2: WorkoutSet[] = [
        {
          id: 'p2_s1',
          workout_id: 'past_w2',
          exercise_id: 'barbell_bench',
          gear_id: null,
          set_number: 1,
          weight: 100,
          raw_input_weight: 100,
          added_weight: null,
          reps: 5,
          reps_right: null,
          rpe: 8.5,
          rir: 1.5,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: '2026-10-08T10:10:00.000Z',
        },
        {
          id: 'p2_s2',
          workout_id: 'past_w2',
          exercise_id: 'barbell_bench',
          gear_id: null,
          set_number: 2,
          weight: 100,
          raw_input_weight: 100,
          added_weight: null,
          reps: 4,
          reps_right: null,
          rpe: 9.5,
          rir: 0.5,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: '2026-10-08T10:15:00.000Z',
        },
      ];

      workoutRepo.seed([pastWorkout1, pastWorkout2], [...pastSets1, ...pastSets2]);

      const ghostSets = await sessionService.getGhostSetsForExercise('barbell_bench');
      expect(ghostSets).toHaveLength(2);
      expect(ghostSets[0].workout_id).toBe('past_w2');
      expect(ghostSets[0].raw_input_weight).toBe(100);
      expect(ghostSets[1].reps).toBe(4);

      // Check specific ghost set helper
      const ghostSet1 = await sessionService.getGhostSet('barbell_bench', 1);
      expect(ghostSet1?.raw_input_weight).toBe(100);
      const ghostSet2 = await sessionService.getGhostSet('barbell_bench', 2);
      expect(ghostSet2?.reps).toBe(4);
      const ghostSet3 = await sessionService.getGhostSet('barbell_bench', 3);
      expect(ghostSet3).toBeNull();
    });
  });

  describe('Superset & Giant Set Grouping (Step 2.1 / ADR-009)', () => {
    it('groups 2+ exercises into a superset with a shared exercise_group_id', async () => {
      const workout = await sessionService.startWorkout({ name: 'Upper Body Superset Day' });

      // Add sets for Barbell Bench and Cable Crossover
      const s1 = await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 8,
      });
      const s2 = await sessionService.addSet(workout.id, {
        exerciseId: 'cable_crossover',
        rawInputWeight: 20,
        reps: 12,
      });

      expect(s1.exercise_group_id).toBeNull();
      expect(s2.exercise_group_id).toBeNull();

      // Group into a superset
      const groupId = await sessionService.groupExercises(workout.id, [
        'barbell_bench',
        'cable_crossover',
      ]);

      expect(groupId).toBeDefined();

      const updatedSets = await workoutRepo.getSetsByWorkoutId(workout.id);
      const benchSet = updatedSets.find((s) => s.id === s1.id);
      const cableSet = updatedSets.find((s) => s.id === s2.id);

      expect(benchSet?.exercise_group_id).toBe(groupId);
      expect(cableSet?.exercise_group_id).toBe(groupId);
    });

    it('rejects grouping fewer than 2 distinct exercises', async () => {
      const workout = await sessionService.startWorkout({ name: 'Invalid Grouping Test' });

      await expect(
        sessionService.groupExercises(workout.id, ['barbell_bench'])
      ).rejects.toThrow(/must contain at least 2 distinct exercises/);

      await expect(
        sessionService.groupExercises(workout.id, ['barbell_bench', 'barbell_bench'])
      ).rejects.toThrow(/must contain at least 2 distinct exercises/);
    });

    it('auto-inherits exercise_group_id when adding subsequent sets to a grouped exercise', async () => {
      const workout = await sessionService.startWorkout({ name: 'Inheritance Test' });

      await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 8,
      });
      await sessionService.addSet(workout.id, {
        exerciseId: 'cable_crossover',
        rawInputWeight: 20,
        reps: 12,
      });

      const groupId = await sessionService.groupExercises(workout.id, [
        'barbell_bench',
        'cable_crossover',
      ]);

      // Add a second set to barbell_bench WITHOUT specifying exerciseGroupId
      const set2 = await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 8,
      });

      expect(set2.exercise_group_id).toBe(groupId);
    });

    it('ungroups an entire superset group, setting exercise_group_id to null', async () => {
      const workout = await sessionService.startWorkout({ name: 'Disband Test' });

      await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 8,
      });
      await sessionService.addSet(workout.id, {
        exerciseId: 'cable_crossover',
        rawInputWeight: 20,
        reps: 12,
      });

      const groupId = await sessionService.groupExercises(workout.id, [
        'barbell_bench',
        'cable_crossover',
      ]);

      await sessionService.ungroupSuperset(workout.id, groupId);

      const updatedSets = await workoutRepo.getSetsByWorkoutId(workout.id);
      expect(updatedSets.every((s) => s.exercise_group_id === null)).toBe(true);

      const groups = await sessionService.getSupersetGroups(workout.id);
      expect(groups.size).toBe(0);
    });

    it('ungroups a single exercise and automatically dissolves the superset if only 1 exercise remains', async () => {
      const workout = await sessionService.startWorkout({ name: 'Single Ungroup Test' });

      await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 8,
      });
      await sessionService.addSet(workout.id, {
        exerciseId: 'cable_crossover',
        rawInputWeight: 20,
        reps: 12,
      });

      await sessionService.groupExercises(workout.id, [
        'barbell_bench',
        'cable_crossover',
      ]);

      // Ungroup only barbell_bench
      await sessionService.ungroupExercise(workout.id, 'barbell_bench');

      const updatedSets = await workoutRepo.getSetsByWorkoutId(workout.id);
      // Since cable_crossover was the only one left, it should also be dissolved
      expect(updatedSets.every((s) => s.exercise_group_id === null)).toBe(true);
    });

    it('ungroups a single exercise from a giant set of 3 without dissolving the remaining 2', async () => {
      const workout = await sessionService.startWorkout({ name: 'Giant Set Ungroup Test' });

      await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 8,
      });
      await sessionService.addSet(workout.id, {
        exerciseId: 'cable_crossover',
        rawInputWeight: 20,
        reps: 12,
      });
      await sessionService.addSet(workout.id, {
        exerciseId: 'db_bench',
        rawInputWeight: 30,
        reps: 10,
      });

      const groupId = await sessionService.groupExercises(workout.id, [
        'barbell_bench',
        'cable_crossover',
        'db_bench',
      ]);

      // Remove db_bench from the giant set
      await sessionService.ungroupExercise(workout.id, 'db_bench');

      const updatedSets = await workoutRepo.getSetsByWorkoutId(workout.id);
      const dbSet = updatedSets.find((s) => s.exercise_id === 'db_bench');
      const benchSet = updatedSets.find((s) => s.exercise_id === 'barbell_bench');
      const cableSet = updatedSets.find((s) => s.exercise_id === 'cable_crossover');

      expect(dbSet?.exercise_group_id).toBeNull();
      // The remaining 2 exercises stay grouped together!
      expect(benchSet?.exercise_group_id).toBe(groupId);
      expect(cableSet?.exercise_group_id).toBe(groupId);

      const groups = await sessionService.getSupersetGroups(workout.id);
      expect(groups.get(groupId)).toEqual(['barbell_bench', 'cable_crossover']);
    });
  });

  describe('Automated & Context-Aware Warm-up Synthesis (Phase 3)', () => {
    it('generates warm-up sets from first working set load and renumbers sets contiguously', async () => {
      const workout = await sessionService.startWorkout();
      // Add a working set of 100kg
      await sessionService.addSet(workout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 8,
        setType: 'working',
      });

      const warmupSets = await sessionService.generateWarmupSetsForExercise(
        workout.id,
        'barbell_bench'
      );

      expect(warmupSets.length).toBeGreaterThanOrEqual(3);
      expect(warmupSets.every((s) => s.set_type === 'warmup')).toBe(true);

      const allSets = await sessionService.getWorkoutSets(workout.id);
      const benchSets = allSets.filter((s) => s.exercise_id === 'barbell_bench');

      // Verify contiguous 1-indexed numbering: warmups (1..N), working set (N+1)
      benchSets.forEach((s, idx) => {
        expect(s.set_number).toBe(idx + 1);
      });

      const workingSet = benchSets.find((s) => s.set_type === 'working');
      expect(workingSet?.set_number).toBe(warmupSets.length + 1);
      expect(workingSet?.raw_input_weight).toBe(100);
    });

    it('falls back to ghost sets when no active working load is entered yet', async () => {
      // Seed a completed past workout with 80kg bench press
      const pastWorkout = await workoutRepo.create({
        id: 'past_bench_workout',
        template_id: null,
        date: '2026-10-10',
        name: 'Past Workout',
        notes: null,
        started_at: '2026-10-10T10:00:00.000Z',
        duration_seconds: 3000,
        status: 'completed',
        completed_at: '2026-10-10T11:00:00.000Z',
        imported_from: null,
      });
      await workoutRepo.saveSets([
        {
          id: 'past_bench_s1',
          workout_id: pastWorkout.id,
          exercise_id: 'barbell_bench',
          gear_id: null,
          set_number: 1,
          weight: 80,
          raw_input_weight: 80,
          added_weight: null,
          reps: 6,
          reps_right: null,
          rpe: 8,
          rir: 2,
          set_type: 'working',
          set_notes: null,
          exercise_group_id: null,
          created_at: '2026-10-10T10:15:00.000Z',
        },
      ]);

      const activeWorkout = await sessionService.startWorkout();
      // Add empty/placeholder working set with 0kg
      await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 0,
        reps: 0,
        setType: 'working',
      });

      const warmups = await sessionService.generateWarmupSetsForExercise(
        activeWorkout.id,
        'barbell_bench'
      );

      // Should have generated ladder based on ghost 80kg (bar 20kg, 50% 40kg, 70% 55kg, 87.5% 70kg)
      expect(warmups.length).toBeGreaterThanOrEqual(3);
      expect(warmups[0].raw_input_weight).toBe(20);
      expect(warmups[warmups.length - 1].raw_input_weight).toBeGreaterThanOrEqual(55);
    });

    it('falls back to default bar weight when neither working weight nor ghost set exists', async () => {
      const activeWorkout = await sessionService.startWorkout();
      // Add empty set with 0 weight on barbell bench
      await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 0,
        reps: 0,
      });

      const warmups = await sessionService.generateWarmupSetsForExercise(
        activeWorkout.id,
        'barbell_bench'
      );

      // Barbell fallback gives 2 acclimating sets at 20kg
      expect(warmups.length).toBe(2);
      expect(warmups[0].raw_input_weight).toBe(20);
      expect(warmups[0].reps).toBe(10);
      expect(warmups[1].raw_input_weight).toBe(20);
      expect(warmups[1].reps).toBe(5);
    });

    it('attenuates redundant warm-ups to at most 2 potentiation sets if muscle group is already warmed up', async () => {
      const activeWorkout = await sessionService.startWorkout();
      // First chest exercise (bench press)
      await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
        setType: 'working',
      });

      // Second chest exercise (dumbbell bench)
      await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'db_bench',
        rawInputWeight: 30,
        reps: 10,
        setType: 'working',
      });

      const warmupsDb = await sessionService.generateWarmupSetsForExercise(
        activeWorkout.id,
        'db_bench',
        { targetWorkingWeightKg: 60 }
      );

      // Because Chest already has completed working set from barbell_bench, capped to at most 2 potentiation sets
      expect(warmupsDb.length).toBeLessThanOrEqual(2);
    });

    it('does not duplicate warm-up sets if already generated for that exercise', async () => {
      const activeWorkout = await sessionService.startWorkout();
      await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
        setType: 'working',
      });

      const firstGen = await sessionService.generateWarmupSetsForExercise(
        activeWorkout.id,
        'barbell_bench'
      );
      const secondGen = await sessionService.generateWarmupSetsForExercise(
        activeWorkout.id,
        'barbell_bench'
      );

      expect(secondGen.length).toBe(firstGen.length);
      expect(secondGen[0].id).toBe(firstGen[0].id);
    });
  });

  describe('applyWarmupAutoregulation', () => {
    it('applies light warm-up rating (+5%) to remaining uncompleted working sets', async () => {
      const activeWorkout = await sessionService.startWorkout();
      // Add warmup set
      await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 87.5,
        reps: 1,
        setType: 'warmup',
      });
      // Add 2 working sets @ 100kg
      const s1 = await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
        setType: 'working',
      });
      const s2 = await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
        setType: 'working',
      });

      const result = await sessionService.applyWarmupAutoregulation(
        activeWorkout.id,
        'barbell_bench',
        'light'
      );

      expect(result.adjustment.adjustedLoadKg).toBe(105);
      expect(result.adjustment.percentageAdjustment).toBe(0.05);
      expect(result.updatedSets.length).toBe(2);
      expect(result.updatedSets[0].raw_input_weight).toBe(105);
      expect(result.updatedSets[1].raw_input_weight).toBe(105);

      // Verify persisted in repository
      const allSets = await workoutRepo.getSetsByWorkoutId(activeWorkout.id);
      const workSets = allSets.filter((s) => s.set_type === 'working');
      expect(workSets[0].raw_input_weight).toBe(105);
      expect(workSets[1].raw_input_weight).toBe(105);
    });

    it('applies heavy warm-up rating (-5%) and maintains normal rating (0%)', async () => {
      const activeWorkout = await sessionService.startWorkout();
      await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
        setType: 'working',
      });

      // Test heavy
      const heavyResult = await sessionService.applyWarmupAutoregulation(
        activeWorkout.id,
        'barbell_bench',
        'heavy'
      );
      expect(heavyResult.adjustment.adjustedLoadKg).toBe(95);
      expect(heavyResult.adjustment.percentageAdjustment).toBe(-0.05);

      // Test normal
      const normalResult = await sessionService.applyWarmupAutoregulation(
        activeWorkout.id,
        'barbell_bench',
        'normal'
      );
      expect(normalResult.adjustment.adjustedLoadKg).toBe(95); // baseline was now 95
      expect(normalResult.adjustment.percentageAdjustment).toBe(0);
    });

    it('respects completedSetIds by leaving completed working sets untouched', async () => {
      const activeWorkout = await sessionService.startWorkout();
      const s1 = await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
        setType: 'working',
      });
      const s2 = await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
        setType: 'working',
      });

      // Mark s1 as completed
      const completedSetIds = new Set<string>([s1.id]);

      const result = await sessionService.applyWarmupAutoregulation(
        activeWorkout.id,
        'barbell_bench',
        'light',
        { completedSetIds }
      );

      // Only s2 should be updated
      expect(result.updatedSets.length).toBe(1);
      expect(result.updatedSets[0].id).toBe(s2.id);
      expect(result.updatedSets[0].raw_input_weight).toBe(105);

      const allSets = await workoutRepo.getSetsByWorkoutId(activeWorkout.id);
      const dbS1 = allSets.find((s) => s.id === s1.id);
      const dbS2 = allSets.find((s) => s.id === s2.id);
      expect(dbS1?.raw_input_weight).toBe(100);
      expect(dbS2?.raw_input_weight).toBe(105);
    });

    it('applies conservative adjustments when hasRecentFatigueFlag is true', async () => {
      const activeWorkout = await sessionService.startWorkout();
      await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 100,
        reps: 5,
        setType: 'working',
      });

      const fatigueLight = await sessionService.applyWarmupAutoregulation(
        activeWorkout.id,
        'barbell_bench',
        'light',
        { hasRecentFatigueFlag: true }
      );
      expect(fatigueLight.adjustment.adjustedLoadKg).toBe(102.5); // +2.5%
      expect(fatigueLight.adjustment.percentageAdjustment).toBe(0.025);
    });

    it('throws when no uncompleted working sets exist', async () => {
      const activeWorkout = await sessionService.startWorkout();
      const s1 = await sessionService.addSet(activeWorkout.id, {
        exerciseId: 'barbell_bench',
        rawInputWeight: 80,
        reps: 5,
        setType: 'warmup',
      });

      await expect(
        sessionService.applyWarmupAutoregulation(activeWorkout.id, 'barbell_bench', 'light')
      ).rejects.toThrow('No uncompleted working sets found');
    });
  });
});


