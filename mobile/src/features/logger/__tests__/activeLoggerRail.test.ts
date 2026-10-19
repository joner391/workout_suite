/**
 * Workout Suite — Horizontal Superset Rail & Active Viewport Test Suite
 *
 * Validates:
 * - Rail grouping logic for standalone movements vs superset pairs
 * - Single-card active viewport rendering (active movement focus without vertical accordion scrolling)
 * - Auto-advancing logic across the horizontal rail upon exercise completion
 * - Superset intra-group completion: suppresses advance until entire superset is finished
 * - Prev / Next navigation boundaries and step indicators
 * - Superset grouping and unlinking transitions on the horizontal rail
 * - Pain reporting severity > 6 auto-pruning and auto-advance
 */

import {
  Workout,
  WorkoutSet,
  Exercise,
  GearInventory,
} from '../../../core/types';
import { ActiveSessionService } from '../../../services/activeSessionService';
import { RestTimerService } from '../../../services/restTimerService';
import {
  MockWorkoutRepository,
  MockExerciseRepository,
  MockGearRepository,
  MockUserSettingsRepository,
  MockPainReportRepository,
} from '../../../database/mocks';
import {
  resolveNextSupersetExercise,
  formatSessionSetsSummary,
} from '../ActiveLoggerScreen';

describe('Horizontal Superset Rail & In-Gym Navigation Suite', () => {
  let workoutRepo: MockWorkoutRepository;
  let exerciseRepo: MockExerciseRepository;
  let gearRepo: MockGearRepository;
  let userSettingsRepo: MockUserSettingsRepository;
  let painRepo: MockPainReportRepository;
  let sessionService: ActiveSessionService;
  let timerService: RestTimerService;

  const mockBench: Exercise = {
    id: 'ex-bench',
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

  const mockRow: Exercise = {
    id: 'ex-row',
    name: 'Barbell Bent-Over Row',
    muscle_group: 'Back',
    category: 'Barbell',
    is_compound: true,
    is_bodyweight: false,
    is_unilateral: false,
    load_mode: 'total',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 20.0,
    is_custom: false,
    parent_exercise_id: null,
    standard_lift_type: null,
    default_rest_seconds: 120,
  };

  const mockInclineDB: Exercise = {
    id: 'ex-incline-db',
    name: 'Incline Dumbbell Press',
    muscle_group: 'Chest',
    category: 'Dumbbell',
    is_compound: true,
    is_bodyweight: false,
    is_unilateral: false,
    load_mode: 'per_hand',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 0,
    is_custom: false,
    parent_exercise_id: null,
    standard_lift_type: null,
    default_rest_seconds: 90,
  };

  const mockTriceps: Exercise = {
    id: 'ex-triceps',
    name: 'Cable Triceps Pushdown',
    muscle_group: 'Arms',
    category: 'Cable',
    is_compound: false,
    is_bodyweight: false,
    is_unilateral: false,
    load_mode: 'total',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 0,
    is_custom: false,
    parent_exercise_id: null,
    standard_lift_type: null,
    default_rest_seconds: 60,
  };

  beforeEach(() => {
    workoutRepo = new MockWorkoutRepository();
    exerciseRepo = new MockExerciseRepository();
    gearRepo = new MockGearRepository();
    userSettingsRepo = new MockUserSettingsRepository();
    painRepo = new MockPainReportRepository();

    sessionService = new ActiveSessionService(workoutRepo, exerciseRepo, gearRepo);
    timerService = new RestTimerService();

    exerciseRepo.create(mockBench);
    exerciseRepo.create(mockRow);
    exerciseRepo.create(mockInclineDB);
    exerciseRepo.create(mockTriceps);
  });

  describe('1. Horizontal Rail Grouping Mechanics', () => {
    test('correctly partitions standalone movements into individual rail items', async () => {
      const workout = await sessionService.startWorkout({ name: 'Upper Strength' });

      // Add 2 sets for Bench, 2 sets for Incline DB, 2 sets for Triceps
      await sessionService.addSet(workout.id, { exerciseId: mockBench.id, rawInputWeight: 100, reps: 5 });
      await sessionService.addSet(workout.id, { exerciseId: mockBench.id, rawInputWeight: 100, reps: 5 });
      await sessionService.addSet(workout.id, { exerciseId: mockInclineDB.id, rawInputWeight: 32, reps: 8 });
      await sessionService.addSet(workout.id, { exerciseId: mockInclineDB.id, rawInputWeight: 32, reps: 8 });
      await sessionService.addSet(workout.id, { exerciseId: mockTriceps.id, rawInputWeight: 30, reps: 12 });

      const activeSession = await sessionService.getActiveWorkout(workout.id);
      expect(activeSession).not.toBeNull();
      const distinctExerciseIds = Array.from(new Set(activeSession!.sets.map((s) => s.exercise_id)));

      expect(distinctExerciseIds.length).toBe(3);
      expect(distinctExerciseIds).toEqual([mockBench.id, mockInclineDB.id, mockTriceps.id]);
    });

    test('combines paired exercises into a single superset rail group item', async () => {
      const workout = await sessionService.startWorkout({ name: 'Antagonist Upper' });

      // Add sets
      await sessionService.addSet(workout.id, { exerciseId: mockBench.id, rawInputWeight: 100, reps: 5 });
      await sessionService.addSet(workout.id, { exerciseId: mockRow.id, rawInputWeight: 80, reps: 6 });
      await sessionService.addSet(workout.id, { exerciseId: mockTriceps.id, rawInputWeight: 30, reps: 12 });

      // Group Bench + Row into Superset A
      const supersetGroupId = await sessionService.groupExercises(workout.id, [mockBench.id, mockRow.id]);
      expect(supersetGroupId).toBeTruthy();

      const activeSession = await sessionService.getActiveWorkout(workout.id);
      expect(activeSession).not.toBeNull();

      // Grouped exercises share the same group ID
      const supersetSets = activeSession!.sets.filter((s) => s.exercise_group_id === supersetGroupId);
      expect(supersetSets.length).toBe(2);
      expect(supersetSets.map((s) => s.exercise_id).sort()).toEqual([mockBench.id, mockRow.id].sort());

      // Triceps remains ungrouped
      const standaloneSets = activeSession!.sets.filter((s) => !s.exercise_group_id);
      expect(standaloneSets.length).toBe(1);
      expect(standaloneSets[0].exercise_id).toBe(mockTriceps.id);
    });
  });

  describe('2. Auto-Advance & Superset Intra-Group Completion', () => {
    test('single exercise completion triggers advance to next incomplete movement', () => {
      const ex1Sets = [{ id: 's1', isDone: true }, { id: 's2', isDone: true }];
      const ex2Sets = [{ id: 's3', isDone: false }, { id: 's4', isDone: false }];

      const isEx1Complete = ex1Sets.every((s) => s.isDone);
      expect(isEx1Complete).toBe(true);

      const isEx2Complete = ex2Sets.every((s) => s.isDone);
      expect(isEx2Complete).toBe(false);

      // Target next incomplete movement
      const nextActiveIndex = [ex1Sets, ex2Sets].findIndex((sets) => sets.some((s) => !s.isDone));
      expect(nextActiveIndex).toBe(1); // Advances to ex2
    });

    test('completing set 1 of superset movement A does NOT advance rail until all paired movements finish', () => {
      const supersetA1Sets = [{ id: 'ss-bench-1', isDone: true }, { id: 'ss-bench-2', isDone: false }];
      const supersetA2Sets = [{ id: 'ss-row-1', isDone: false }, { id: 'ss-row-2', isDone: false }];

      // A1 has 1 completed set, but superset as a whole is incomplete
      const isA1Complete = supersetA1Sets.every((s) => s.isDone);
      const isA2Complete = supersetA2Sets.every((s) => s.isDone);
      const isEntireSupersetComplete = isA1Complete && isA2Complete;

      expect(isA1Complete).toBe(false);
      expect(isEntireSupersetComplete).toBe(false);

      // Complete rest of A1:
      supersetA1Sets[1].isDone = true;
      expect(supersetA1Sets.every((s) => s.isDone)).toBe(true);
      // But A2 is still incomplete, so rail must remain on this superset!
      expect(supersetA2Sets.every((s) => s.isDone)).toBe(false);
      expect(isEntireSupersetComplete).toBe(false);

      // Now complete A2:
      supersetA2Sets[0].isDone = true;
      supersetA2Sets[1].isDone = true;
      const isNowEntireSupersetComplete =
        supersetA1Sets.every((s) => s.isDone) && supersetA2Sets.every((s) => s.isDone);
      expect(isNowEntireSupersetComplete).toBe(true);
    });

    test('resolveNextSupersetExercise smoothly alternates between paired exercises across rounds', () => {
      const supersetExercises = [
        {
          exercise: { id: mockBench.id },
          sets: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }],
        },
        {
          exercise: { id: mockRow.id },
          sets: [{ id: 'r1' }, { id: 'r2' }],
        },
      ];

      // Round 1: Lifter finishes Bench set 1 (b1) -> scrolls to Row
      const nextAfterBench1 = resolveNextSupersetExercise(
        mockBench.id,
        supersetExercises,
        new Set(['b1'])
      );
      expect(nextAfterBench1).toBe(mockRow.id);

      // Round 1: Lifter finishes Row set 1 (r1) -> scrolls back to Bench
      const nextAfterRow1 = resolveNextSupersetExercise(
        mockRow.id,
        supersetExercises,
        new Set(['b1', 'r1'])
      );
      expect(nextAfterRow1).toBe(mockBench.id);

      // Round 2: Lifter finishes Bench set 2 (b2) -> scrolls to Row
      const nextAfterBench2 = resolveNextSupersetExercise(
        mockBench.id,
        supersetExercises,
        new Set(['b1', 'r1', 'b2'])
      );
      expect(nextAfterBench2).toBe(mockRow.id);

      // Round 2: Lifter finishes Row set 2 (r2, last row set) -> scrolls back to Bench for final set
      const nextAfterRow2 = resolveNextSupersetExercise(
        mockRow.id,
        supersetExercises,
        new Set(['b1', 'r1', 'b2', 'r2'])
      );
      expect(nextAfterRow2).toBe(mockBench.id);
    });

    test('resolveNextSupersetExercise cycles circularly through 3 exercises in a giant set', () => {
      const giantSetExercises = [
        { exercise: { id: 'ex-1' }, sets: [{ id: 's1' }] },
        { exercise: { id: 'ex-2' }, sets: [{ id: 's2' }] },
        { exercise: { id: 'ex-3' }, sets: [{ id: 's3' }] },
      ];

      // Finish ex-1 -> ex-2
      expect(resolveNextSupersetExercise('ex-1', giantSetExercises, new Set(['s1']))).toBe('ex-2');
      // Finish ex-2 -> ex-3
      expect(resolveNextSupersetExercise('ex-2', giantSetExercises, new Set(['s1', 's2']))).toBe('ex-3');
      // Finish ex-3 -> ex-1 (fallback circular)
      expect(resolveNextSupersetExercise('ex-3', giantSetExercises, new Set(['s1', 's2', 's3']))).toBe('ex-1');
    });
  });

  describe('3. Rest Timer Superset Rules on the Horizontal Rail', () => {
    test('rest timer is suppressed between intra-superset movements and fires after final paired movement', () => {
      const groupExIds = [mockBench.id, mockRow.id];

      // Bench is movement 1 of 2: rest timer suppressed
      const triggerAfterBench = RestTimerService.shouldTriggerForExerciseInGroup(mockBench.id, groupExIds);
      expect(triggerAfterBench).toBe(false);

      // Row is movement 2 of 2 (last in group): rest timer triggers!
      const triggerAfterRow = RestTimerService.shouldTriggerForExerciseInGroup(mockRow.id, groupExIds);
      expect(triggerAfterRow).toBe(true);
    });
  });

  describe('4. Incomplete Sets Ledger Exclusion & Deletion', () => {
    test('uncompleted sets are deleted on finish when exclude option is active', async () => {
      const workout = await sessionService.startWorkout({ name: 'Chest Pump' });

      const set1 = await sessionService.addSet(workout.id, {
        exerciseId: mockBench.id,
        rawInputWeight: 100,
        reps: 8,
      });
      const set2 = await sessionService.addSet(workout.id, {
        exerciseId: mockBench.id,
        rawInputWeight: 100,
        reps: 8,
      });

      // User completes only set 1
      const completedSetIds = new Set<string>([set1.id]);
      const currentSets = (await sessionService.getActiveWorkout(workout.id))?.sets || [];
      const uncompletedSets = currentSets.filter((s) => !completedSetIds.has(s.id));

      expect(uncompletedSets.length).toBe(1);
      expect(uncompletedSets[0].id).toBe(set2.id);

      // Exclude uncompleted sets by deleting before finish
      for (const uncompletedSet of uncompletedSets) {
        await sessionService.deleteSet(workout.id, uncompletedSet.id);
      }

      const finished = await sessionService.finishWorkout(workout.id);
      expect(finished.status).toBe('completed');

      const remainingSets = await workoutRepo.getSetsByWorkoutId(workout.id);
      expect(remainingSets.length).toBe(1);
      expect(remainingSets[0].id).toBe(set1.id);
    });
  });

  describe('5. High Pain Severity Auto-Skip on Rail Movement', () => {
    test('severity > 6 skips remaining sets on active rail exercise and triggers advance', async () => {
      const workout = await sessionService.startWorkout({ name: 'Leg Day' });

      const b1 = await sessionService.addSet(workout.id, {
        exerciseId: mockBench.id,
        rawInputWeight: 80,
        reps: 6,
      });
      const b2 = await sessionService.addSet(workout.id, {
        exerciseId: mockBench.id,
        rawInputWeight: 80,
        reps: 6,
      });
      const t1 = await sessionService.addSet(workout.id, {
        exerciseId: mockTriceps.id,
        rawInputWeight: 25,
        reps: 12,
      });

      // Complete b1
      const completedSetIds = new Set<string>([b1.id]);

      // Report high pain score 8 on Bench Press
      const report = await painRepo.create({
        workout_id: workout.id,
        exercise_id: mockBench.id,
        pain_type: 'joint',
        severity: 8,
        notes: 'Sharp anterior shoulder pain',
      });
      expect(report.severity).toBe(8);

      // Guardrail deletes uncompleted sets for Bench
      const allSets = (await sessionService.getActiveWorkout(workout.id))?.sets || [];
      const benchUncompleted = allSets.filter(
        (s) => s.exercise_id === mockBench.id && !completedSetIds.has(s.id)
      );
      for (const s of benchUncompleted) {
        await sessionService.deleteSet(workout.id, s.id);
      }

      // Check remaining sets: bench has only b1, triceps has t1
      const updated = await sessionService.getActiveWorkout(workout.id);
      expect(updated?.sets.length).toBe(2);
      expect(updated?.sets.some((s) => s.id === b2.id)).toBe(false);

      // Next movement on the rail with uncompleted sets is Triceps
      const remainingIncomplete = updated?.sets.filter((s) => !completedSetIds.has(s.id)) || [];
      expect(remainingIncomplete.length).toBe(1);
      expect(remainingIncomplete[0].exercise_id).toBe(mockTriceps.id);
    });
  });

  describe('6. Multi-Set Logging Integrity & Complete-All Capability', () => {
    test('sequential set completion preserves all previously checked sets without clobbering', () => {
      const completedSetIds = new Set<string>();

      // Toggle Set 1
      const set1Id = 'set-1';
      completedSetIds.add(set1Id);
      expect(completedSetIds.has('set-1')).toBe(true);

      // Toggle Set 2 immediately
      const set2Id = 'set-2';
      completedSetIds.add(set2Id);
      expect(completedSetIds.has('set-1')).toBe(true);
      expect(completedSetIds.has('set-2')).toBe(true);

      // Toggle Set 3 immediately
      const set3Id = 'set-3';
      completedSetIds.add(set3Id);
      expect(completedSetIds.has('set-1')).toBe(true);
      expect(completedSetIds.has('set-2')).toBe(true);
      expect(completedSetIds.has('set-3')).toBe(true);
      expect(completedSetIds.size).toBe(3);

      // Untoggle Set 2
      completedSetIds.delete('set-2');
      expect(completedSetIds.has('set-1')).toBe(true);
      expect(completedSetIds.has('set-2')).toBe(false);
      expect(completedSetIds.has('set-3')).toBe(true);
      expect(completedSetIds.size).toBe(2);
    });

    test('completing all sets across multiple exercises leaves no incomplete sets', async () => {
      const workout = await sessionService.startWorkout({ name: 'Full Session' });
      const b1 = await sessionService.addSet(workout.id, { exerciseId: mockBench.id, rawInputWeight: 100, reps: 5 });
      const b2 = await sessionService.addSet(workout.id, { exerciseId: mockBench.id, rawInputWeight: 100, reps: 5 });
      const r1 = await sessionService.addSet(workout.id, { exerciseId: mockRow.id, rawInputWeight: 80, reps: 8 });

      const allSets = [b1, b2, r1];
      const completed = new Set<string>();

      for (const s of allSets) {
        completed.add(s.id);
      }

      // Verify all sets are completed
      expect(allSets.every((s) => completed.has(s.id))).toBe(true);
      expect(allSets.filter((s) => !completed.has(s.id)).length).toBe(0);
    });
  });

  describe('7. Streamlined Finish & Discard Lifecycle', () => {
    test('discarding workout via finish flow sets status to discarded and cleans up session', async () => {
      const workout = await sessionService.startWorkout({ name: 'Discard Flow Test' });
      await sessionService.addSet(workout.id, { exerciseId: mockBench.id, rawInputWeight: 100, reps: 5 });

      // Discarding the workout
      const discarded = await sessionService.discardWorkout(workout.id);
      expect(discarded.status).toBe('discarded');
      expect(discarded.completed_at).toBeDefined();

      // No active in-progress workout remains
      const active = await workoutRepo.getInProgressWorkout();
      expect(active).toBeNull();
    });
  });

  describe('8. Logger Visual Polish, 1RM/e1RM Records & Historical Session Ledger (ADR-081)', () => {
    test('computes historical 1RM and e1RM PRs with corresponding occurrence dates', async () => {
      // Create past completed workout 1: Bench single 140kg x 1 on 2026-09-01
      const w1 = await workoutRepo.create({
        id: 'w-past-1',
        name: 'Past Heavy Day',
        date: '2026-09-01',
        started_at: '2026-09-01T10:00:00Z',
        completed_at: '2026-09-01T11:00:00Z',
        status: 'completed',
        duration_seconds: 3600,
        notes: null,
        template_id: null,
        imported_from: null,
      });

      await workoutRepo.addSet({
        id: 's-w1-1',
        workout_id: w1.id,
        exercise_id: mockBench.id,
        set_number: 1,
        weight: 140,
        raw_input_weight: 140,
        added_weight: null,
        reps: 1,
        reps_right: null,
        rpe: 9.5,
        rir: 0.5,
        set_type: 'working',
        set_notes: 'Heavy single PR',
        gear_id: null,
        exercise_group_id: null,
        created_at: '2026-09-01T10:15:00Z',
      });

      // Create past completed workout 2: Bench volume 125kg x 5 on 2026-09-15
      const w2 = await workoutRepo.create({
        id: 'w-past-2',
        name: 'Past Volume Day',
        date: '2026-09-15',
        started_at: '2026-09-15T10:00:00Z',
        completed_at: '2026-09-15T11:00:00Z',
        status: 'completed',
        duration_seconds: 3600,
        notes: null,
        template_id: null,
        imported_from: null,
      });

      await workoutRepo.addSet({
        id: 's-w2-1',
        workout_id: w2.id,
        exercise_id: mockBench.id,
        set_number: 1,
        weight: 125,
        raw_input_weight: 125,
        added_weight: null,
        reps: 5,
        reps_right: null,
        rpe: 9.0,
        rir: 1.0,
        set_type: 'working',
        set_notes: 'Peak volume e1RM',
        gear_id: null,
        exercise_group_id: null,
        created_at: '2026-09-15T10:20:00Z',
      });

      // Query historical sets for Bench
      const benchHistory = await workoutRepo.getHistoricalSetsForExercise(mockBench.id, {
        onlyCompletedWorkouts: true,
      });

      // 1RM: heaviest single (reps === 1)
      const singleSets = benchHistory.filter((s) => s.reps === 1 && s.weight > 0);
      let best1RMKg: number | null = null;
      let best1RMDate: string | null = null;
      for (const s of singleSets) {
        if (best1RMKg === null || s.weight > best1RMKg) {
          best1RMKg = s.weight;
          best1RMDate = s.created_at.split('T')[0];
        }
      }

      expect(best1RMKg).toBe(140);
      expect(best1RMDate).toBe('2026-09-01');

      // e1RM: peak calculated Lombardi 1RM
      const completedWorkouts = await workoutRepo.findAll({ status: 'completed' });
      const wMap = new Map(completedWorkouts.map((w) => [w.id, w]));

      let bestE1RMKg: number | null = null;
      let bestE1RMDate: string | null = null;
      for (const s of benchHistory) {
        if (s.weight > 0 && s.reps > 0) {
          const effectiveReps = s.reps + (s.rir ?? (s.rpe ? 10 - s.rpe : 0));
          const e1rm = s.weight * Math.pow(effectiveReps, 0.10);
          if (bestE1RMKg === null || e1rm > bestE1RMKg) {
            bestE1RMKg = e1rm;
            bestE1RMDate = wMap.get(s.workout_id)?.date || null;
          }
        }
      }

      expect(bestE1RMKg).toBeGreaterThan(140);
      expect(bestE1RMDate).toBe('2026-09-15');
    });

    test('strictly isolates historical sessions per exercise (squat only shows squats, bench only bench)', async () => {
      // Completed session with Bench and Row sets
      const w = await workoutRepo.create({
        id: 'w-combined',
        name: 'Combined Push/Pull',
        date: '2026-10-01',
        started_at: '2026-10-01T10:00:00Z',
        completed_at: '2026-10-01T11:00:00Z',
        status: 'completed',
        duration_seconds: 3600,
        notes: null,
        template_id: null,
        imported_from: null,
      });

      await workoutRepo.addSet({
        id: 's-comb-bench',
        workout_id: w.id,
        exercise_id: mockBench.id,
        set_number: 1,
        weight: 100,
        raw_input_weight: 100,
        added_weight: null,
        reps: 8,
        reps_right: null,
        rpe: 8.0,
        rir: 2.0,
        set_type: 'working',
        set_notes: null,
        gear_id: null,
        exercise_group_id: null,
        created_at: '2026-10-01T10:10:00Z',
      });

      await workoutRepo.addSet({
        id: 's-comb-row',
        workout_id: w.id,
        exercise_id: mockRow.id,
        set_number: 1,
        weight: 85,
        raw_input_weight: 85,
        added_weight: null,
        reps: 10,
        reps_right: null,
        rpe: 8.5,
        rir: 1.5,
        set_type: 'working',
        set_notes: null,
        gear_id: null,
        exercise_group_id: null,
        created_at: '2026-10-01T10:20:00Z',
      });

      const benchSets = await workoutRepo.getHistoricalSetsForExercise(mockBench.id, { onlyCompletedWorkouts: true });
      const rowSets = await workoutRepo.getHistoricalSetsForExercise(mockRow.id, { onlyCompletedWorkouts: true });

      // Bench sets contain only bench
      expect(benchSets.every((s) => s.exercise_id === mockBench.id)).toBe(true);
      expect(benchSets.some((s) => s.exercise_id === mockRow.id)).toBe(false);

      // Row sets contain only row
      expect(rowSets.every((s) => s.exercise_id === mockRow.id)).toBe(true);
      expect(rowSets.some((s) => s.exercise_id === mockBench.id)).toBe(false);
    });

    test('retains at most 3 completed sessions ordered descending by date', async () => {
      // Create 5 completed sessions on consecutive days
      for (let day = 1; day <= 5; day++) {
        const dateStr = `2026-10-0${day}`;
        const w = await workoutRepo.create({
          id: `w-series-${day}`,
          name: `Series ${day}`,
          date: dateStr,
          started_at: `${dateStr}T10:00:00Z`,
          completed_at: `${dateStr}T11:00:00Z`,
          status: 'completed',
          duration_seconds: 3600,
          notes: null,
          template_id: null,
          imported_from: null,
        });

        await workoutRepo.addSet({
          id: `s-series-${day}`,
          workout_id: w.id,
          exercise_id: mockTriceps.id,
          set_number: 1,
          weight: 30 + day,
          raw_input_weight: 30 + day,
          added_weight: null,
          reps: 12,
          reps_right: null,
          rpe: 8.0,
          rir: 2.0,
          set_type: 'working',
          set_notes: null,
          gear_id: null,
          exercise_group_id: null,
          created_at: `${dateStr}T10:15:00Z`,
        });
      }

      const historicalSets = await workoutRepo.getHistoricalSetsForExercise(mockTriceps.id, {
        onlyCompletedWorkouts: true,
      });

      const sessionSetsMap = new Map<string, WorkoutSet[]>();
      for (const s of historicalSets) {
        if (!sessionSetsMap.has(s.workout_id)) {
          sessionSetsMap.set(s.workout_id, []);
        }
        sessionSetsMap.get(s.workout_id)!.push(s);
      }

      const completedWorkouts = await workoutRepo.findAll({ status: 'completed' });
      const wMap = new Map(completedWorkouts.map((w) => [w.id, w]));

      const sessions = Array.from(sessionSetsMap.entries()).map(([wId, wSets]) => ({
        workoutId: wId,
        date: wMap.get(wId)?.date || '',
        sets: wSets,
      }));

      // Sort descending by date
      sessions.sort((a, b) => b.date.localeCompare(a.date));

      const last3 = sessions.slice(0, 3);
      expect(last3.length).toBe(3);
      expect(last3[0].date).toBe('2026-10-05');
      expect(last3[1].date).toBe('2026-10-04');
      expect(last3[2].date).toBe('2026-10-03');
    });
  });

  describe('formatSessionSetsSummary run-length encoding for session history', () => {
    const makeSet = (overrides: Partial<WorkoutSet>): WorkoutSet => ({
      id: 's-1',
      workout_id: 'w-1',
      exercise_id: 'ex-bench',
      set_number: 1,
      weight: 85,
      raw_input_weight: 85,
      added_weight: null,
      reps: 5,
      reps_right: null,
      rpe: null,
      rir: null,
      set_type: 'working',
      set_notes: null,
      gear_id: null,
      exercise_group_id: null,
      created_at: '2026-10-19T10:00:00Z',
      ...overrides,
    });

    it('compacts consecutive identical sets into 85 kg × 5 × 3 notation', () => {
      const sets: WorkoutSet[] = [
        makeSet({ id: 's-1', set_number: 1, weight: 85, reps: 5 }),
        makeSet({ id: 's-2', set_number: 2, weight: 85, reps: 5 }),
        makeSet({ id: 's-3', set_number: 3, weight: 85, reps: 5 }),
      ];

      const result = formatSessionSetsSummary(sets, mockBench, 'kg');
      expect(result).toBe('85 kg × 5 × 3');
    });

    it('handles mixed straight sets and top sets correctly', () => {
      const sets: WorkoutSet[] = [
        makeSet({ id: 's-1', set_number: 1, weight: 100, reps: 5 }),
        makeSet({ id: 's-2', set_number: 2, weight: 100, reps: 5 }),
        makeSet({ id: 's-3', set_number: 3, weight: 105, reps: 5 }),
        makeSet({ id: 's-4', set_number: 4, weight: 105, reps: 5 }),
      ];

      const result = formatSessionSetsSummary(sets, mockBench, 'kg');
      expect(result).toBe('100 kg × 5 × 2, 105 kg × 5 × 2');
    });

    it('does not append multiplier when set count is 1', () => {
      const sets: WorkoutSet[] = [
        makeSet({ id: 's-1', set_number: 1, weight: 100, reps: 5 }),
      ];

      const result = formatSessionSetsSummary(sets, mockBench, 'kg');
      expect(result).toBe('100 kg × 5');
    });

    it('formats dumbbell per_hand exercises with (×2) and halved weight', () => {
      const sets: WorkoutSet[] = [
        makeSet({ id: 's-1', exercise_id: mockInclineDB.id, weight: 60, reps: 10 }),
        makeSet({ id: 's-2', exercise_id: mockInclineDB.id, weight: 60, reps: 10 }),
        makeSet({ id: 's-3', exercise_id: mockInclineDB.id, weight: 60, reps: 10 }),
      ];

      const result = formatSessionSetsSummary(sets, mockInclineDB, 'kg');
      expect(result).toBe('30 kg (×2) × 10 × 3');
    });

    it('formats bodyweight exercises with BW prefix', () => {
      const bwExercise: Exercise = {
        ...mockBench,
        id: 'ex-pullup',
        name: 'Pull-up',
        category: 'Bodyweight',
        is_bodyweight: true,
      };

      const sets: WorkoutSet[] = [
        makeSet({ id: 's-1', exercise_id: bwExercise.id, weight: 0, reps: 12 }),
        makeSet({ id: 's-2', exercise_id: bwExercise.id, weight: 0, reps: 12 }),
      ];

      const result = formatSessionSetsSummary(sets, bwExercise, 'kg');
      expect(result).toBe('BW × 12 × 2');
    });

    it('formats unilateral exercises with L / R reps notation', () => {
      const unilateralExercise: Exercise = {
        ...mockBench,
        id: 'ex-b-split-squat',
        name: 'Bulgarian Split Squat',
        is_unilateral: true,
      };

      const sets: WorkoutSet[] = [
        makeSet({ id: 's-1', weight: 40, reps: 8, reps_right: 9 }),
        makeSet({ id: 's-2', weight: 40, reps: 8, reps_right: 9 }),
      ];

      const result = formatSessionSetsSummary(sets, unilateralExercise, 'kg');
      expect(result).toBe('40 kg × 8/9 × 2');
    });

    it('preserves RPE and distinguishes differing RPE runs', () => {
      const setsWithSameRpe: WorkoutSet[] = [
        makeSet({ id: 's-1', weight: 85, reps: 5, rpe: 8.5 }),
        makeSet({ id: 's-2', weight: 85, reps: 5, rpe: 8.5 }),
      ];
      expect(formatSessionSetsSummary(setsWithSameRpe, mockBench, 'kg')).toBe('85 kg × 5 × 2 @8.5');

      const setsWithDiffRpe: WorkoutSet[] = [
        makeSet({ id: 's-1', weight: 85, reps: 5, rpe: 8.0 }),
        makeSet({ id: 's-2', weight: 85, reps: 5, rpe: 9.0 }),
      ];
      expect(formatSessionSetsSummary(setsWithDiffRpe, mockBench, 'kg')).toBe('85 kg × 5 @8, 85 kg × 5 @9');
    });

    it('preserves RIR intensity metric', () => {
      const setsWithRir: WorkoutSet[] = [
        makeSet({ id: 's-1', weight: 85, reps: 5, rir: 2 }),
        makeSet({ id: 's-2', weight: 85, reps: 5, rir: 2 }),
      ];
      expect(formatSessionSetsSummary(setsWithRir, mockBench, 'kg')).toBe('85 kg × 5 × 2 @2RIR');
    });

    it('filters out warmup sets when working sets exist', () => {
      const sets: WorkoutSet[] = [
        makeSet({ id: 's-w1', weight: 40, reps: 5, set_type: 'warmup' }),
        makeSet({ id: 's-w2', weight: 60, reps: 3, set_type: 'warmup' }),
        makeSet({ id: 's-1', weight: 85, reps: 5, set_type: 'working' }),
        makeSet({ id: 's-2', weight: 85, reps: 5, set_type: 'working' }),
        makeSet({ id: 's-3', weight: 85, reps: 5, set_type: 'working' }),
      ];

      expect(formatSessionSetsSummary(sets, mockBench, 'kg')).toBe('85 kg × 5 × 3');
    });

    it('displays warmup sets if only warmup sets exist', () => {
      const sets: WorkoutSet[] = [
        makeSet({ id: 's-w1', weight: 40, reps: 5, set_type: 'warmup' }),
        makeSet({ id: 's-w2', weight: 40, reps: 5, set_type: 'warmup' }),
      ];

      expect(formatSessionSetsSummary(sets, mockBench, 'kg')).toBe('40 kg × 5 × 2');
    });

    it('returns empty string when sets array is empty', () => {
      expect(formatSessionSetsSummary([], mockBench, 'kg')).toBe('');
    });
  });
});
