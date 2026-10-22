import { loadTrainingOverview, localTrainingDate } from '../trainingOverviewService';
import { buildStrengthTimeline } from '../strengthOverviewService';
import { buildWorkoutPreview, captureWorkoutProgression, matchesWorkoutPrescription, selectNextTemplate } from '../workoutPreviewService';
import { MockUserSettingsRepository } from '../../database/mocks/MockUserSettingsRepository';
import { MockWorkoutRepository } from '../../database/mocks/MockWorkoutRepository';
import { MockExerciseRepository } from '../../database/mocks/MockExerciseRepository';
import { MockGearRepository } from '../../database/mocks/MockGearRepository';
import { ActiveSessionService } from '../activeSessionService';
import { DEFAULT_EXERCISES } from '../../database/seeds/defaultExercises';
import { BodyMetric, Workout, WorkoutSet } from '../../core/types';
import { WorkoutTemplateDetail } from '../../domain/repositories/IProgramRepository';

function workout(id: string, date: string, changes: Partial<Workout> = {}): Workout {
  return { id, date, name: id, template_id: 'a', notes: null, status: 'completed', started_at: `${date}T10:00:00Z`, completed_at: `${date}T11:00:00Z`, duration_seconds: 3600, imported_from: null, ...changes };
}
function set(id: string, workoutId: string, weight: number, changes: Partial<WorkoutSet> = {}): WorkoutSet {
  return { id, workout_id: workoutId, exercise_id: 'barbell_back_squat', gear_id: null, set_number: 1, weight, raw_input_weight: weight, added_weight: null, reps: 5, reps_right: null, rpe: 8, rir: null, set_type: 'working', set_notes: null, exercise_group_id: null, created_at: '2026-10-21T10:00:00Z', ...changes };
}
function template(id = 'a', order = 0): WorkoutTemplateDetail {
  return { id, program_id: 'program', name: id, notes: null, order_index: order, created_at: '2026-10-01T00:00:00Z', exercises: [{ id: `slot-${id}`, template_id: id, exercise_id: 'barbell_back_squat', gear_id: null, target_sets: 3, target_reps_min: 5, target_reps_max: 8, target_rpe: 8, target_rir: null, order_index: 0, exercise_group_id: null, rules: [] }] };
}

describe('Rolling training overview', () => {
  test('expands a rest-pause prescription into activation and mini rows at one shared load', async () => {
    const t = template();
    Object.assign(t.exercises[0], { exercise_id: 'dumbbell_bicep_curl', target_sets: 1,
      target_reps_min: 12, target_reps_max: 15, set_type: 'myorep',
      rest_pause: { mini_sets: 3, mini_reps_min: 3, mini_reps_max: 5, rest_seconds: 15 } });
    const [row] = await buildWorkoutPreview(t, new MockWorkoutRepository(), new Map(DEFAULT_EXERCISES.map(ex => [ex.id, ex])), 'kg');
    expect(row.sets.map(s => [s.reps, s.setType])).toEqual([[12, 'working'], [3, 'myorep'], [3, 'myorep'], [3, 'myorep']]);
    expect(row.summary).toContain('3 × 3–5 mini (myorep)');
    expect(row.summary).toContain('15s between efforts');
  });
  test('uses inclusive local calendar days, a separate previous window, and excludes unfinished sessions and warmups', async () => {
    const workouts = [workout('old', '2026-09-01'), workout('previous', '2026-10-14'), workout('first', '2026-10-15'), workout('today', '2026-10-21'), workout('active', '2026-10-21', { status: 'in_progress' }), workout('future', '2026-10-22')];
    const repo = new MockWorkoutRepository(workouts, [set('old', 'old', 90), set('p', 'previous', 95), set('first', 'first', 100), set('repeat', 'first', 100), set('today', 'today', 105), set('warmup', 'today', 300, { set_type: 'warmup' }), set('empty', 'today', 300, { reps: 0 }), set('active', 'active', 500), set('future', 'future', 500)]);
    const result = await loadTrainingOverview(repo, 7, new Date(2026, 9, 21, 23, 59));
    expect(result.days.map(d => d.date)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']);
    expect(result.sessions.map(s => s.workout.id)).toEqual(['today', 'first']);
    expect(result.workingSets).toBe(3);
    expect(result.previousSessions).toBe(1);
    expect(result.previousWorkingSets).toBe(1);
    expect(result.records.map(r => r.weightKg)).toEqual([105, 100]);
  });

  test('does not call first observations, ties, changed gear, or changed rep counts new PRs', async () => {
    const repo = new MockWorkoutRepository([workout('old', '2026-09-01'), workout('new', '2026-10-21')], [set('old', 'old', 100), set('tie', 'new', 100), set('gear', 'new', 200, { gear_id: 'different' }), set('reps', 'new', 150, { reps: 3 })]);
    expect((await loadTrainingOverview(repo, 14, new Date(2026, 9, 21))).records).toEqual([]);
  });

  test('handles empty data and a 14-day window across a month boundary', async () => {
    const result = await loadTrainingOverview(new MockWorkoutRepository(), 14, new Date(2026, 10, 2));
    expect(result.days).toHaveLength(14);
    expect(result.days[0].date).toBe('2026-10-20');
    expect(result.days.at(-1)?.date).toBe('2026-11-02');
    expect(result.sessions).toEqual([]);
    expect(result.workingSets).toBe(0);
    expect(localTrainingDate(new Date(2026, 0, 1, 0, 1))).toBe('2026-01-01');
  });
});

describe('Shared next workout and prescriptions', () => {
  test('uses template order, wraps, and finds matching history beyond unrelated recent workouts', () => {
    const a = template('a', 0), b = template('b', 1);
    const unrelated = Array.from({ length: 30 }, (_, i) => workout(`other-${i}`, '2026-10-21', { template_id: 'other' }));
    expect(selectNextTemplate([b, a], [...unrelated, workout('old', '2026-09-01')])?.id).toBe('b');
    expect(selectNextTemplate([b, a], [workout('last', '2026-10-21', { template_id: 'b' })])?.id).toBe('a');
    expect(selectNextTemplate([b, a], [workout('active', '2026-10-21', { status: 'in_progress' })])?.id).toBe('a');
    expect(selectNextTemplate([], [])).toBeNull();
  });

  test('shows honest load references with unit conversion and effort targets; no fabricated load for new exercises', async () => {
    const catalog = new Map(DEFAULT_EXERCISES.map(ex => [ex.id, ex]));
    const repo = new MockWorkoutRepository([workout('last', '2026-10-20')], [set('squat', 'last', 100)]);
    const rows = await buildWorkoutPreview(template(), repo, catalog, 'lbs');
    expect(rows[0].summary).toBe('3 × 5–8 · 220.5 lbs · RPE 8');
    const empty = await buildWorkoutPreview(template(), new MockWorkoutRepository(), catalog, 'kg');
    expect(empty[0].summary).toBe('3 × 5–8 · – · RPE 8');
    expect((await repo.getSetsByWorkoutId('last'))[0].weight).toBe(100);
  });

  test('resolves progression into the plan without changing completed history', async () => {
    const t = template();
    t.exercises[0].rules = [{ id: 'linear', template_exercise_id: 'slot-a', priority: 0, rule_json: { conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }], actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }] } }];
    const repo = new MockWorkoutRepository([workout('last', '2026-10-20')], [1, 2, 3].map(n => set(`s-${n}`, 'last', 100, { reps: 8, set_number: n })));
    const rows = await buildWorkoutPreview(t, repo, new Map(DEFAULT_EXERCISES.map(ex => [ex.id, ex])), 'kg');
    expect(rows[0].summary).toBe('3 × 5–8 · 102.5 kg · RPE 8');
    expect(rows[0].sets.map(s => s.rawInputWeight)).toEqual([102.5, 102.5, 102.5]);
    expect((await repo.getSetsByWorkoutId('last')).every(s => s.weight === 100)).toBe(true);
  });

  test('lists varying set loads with commas, excluding warmups and other equipment', async () => {
    const t = template();
    t.exercises[0].exercise_group_id = 'pair';
    t.exercises[0].target_rpe = null;
    t.exercises[0].target_rir = 2;
    const repo = new MockWorkoutRepository([workout('last', '2026-10-20')], [
      set('warmup', 'last', 5, { set_type: 'warmup' }),
      set('one', 'last', 10, { set_number: 2 }),
      set('two', 'last', 12.5, { set_number: 3 }),
      set('three', 'last', 15, { set_number: 4 }),
      set('other', 'last', 50, { set_number: 5, gear_id: 'other' }),
    ]);
    const [row] = await buildWorkoutPreview(t, repo, new Map(DEFAULT_EXERCISES.map(ex => [ex.id, ex])), 'kg');
    expect(row.summary).toBe('5–8 × 10 kg, 5–8 × 12.5 kg, 5–8 × 15 kg · 2 RIR');
    expect(row.groupId).toBeNull();
  });

  test('converts effective progression to entered dumbbell and cable loads, and persists that same plan', async () => {
    const exercise = { ...DEFAULT_EXERCISES[0], id: 'barbell_back_squat', load_mode: 'per_hand' as const, is_bodyweight: false, default_cable_ratio: 0.5 };
    const catalog = new Map([[exercise.id, exercise]]);
    const t = template();
    t.exercises[0].rules = [{ id: 'linear', template_exercise_id: 'slot-a', priority: 0, rule_json: { conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }], actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }] } }];
    const gear = new MockGearRepository();
    const repo = new MockWorkoutRepository([workout('last', '2026-10-20')], [1, 2, 3].map(n => set(`s-${n}`, 'last', 20, { raw_input_weight: 20, reps: 8, set_number: n })));
    const [row] = await buildWorkoutPreview(t, repo, catalog, 'kg', gear);
    expect(row.summary).toBe('3 × 5–8 · 22.5 kg · RPE 8');
    const service = new ActiveSessionService(repo, new MockExerciseRepository([exercise]), gear);
    const active = await service.startWorkout({ templateId: t.id });
    for (const [index, planned] of row.sets.entries()) {
      await service.addSet(active.id, { exerciseId: exercise.id, rawInputWeight: planned.rawInputWeight ?? 0,
        reps: planned.reps, setType: planned.setType, setNumber: index + 1 });
    }
    expect((await repo.getSetsByWorkoutId(active.id)).map(s => [s.raw_input_weight, s.weight, s.reps])).toEqual([
      [22.5, 22.5, 5], [22.5, 22.5, 5], [22.5, 22.5, 5],
    ]);
    const activeSets = await repo.getSetsByWorkoutId(active.id);
    expect(matchesWorkoutPrescription(row, activeSets)).toBe(true);
    expect(matchesWorkoutPrescription(row, activeSets.slice(1))).toBe(false);
    expect(matchesWorkoutPrescription(row, activeSets.map(s => ({ ...s, raw_input_weight: 0 })))).toBe(false);
    expect(matchesWorkoutPrescription(row, [...activeSets, set('warm', active.id, 5, { set_type: 'warmup' })])).toBe(true);
    exercise.default_cable_ratio = 1;
    expect((await buildWorkoutPreview(t, repo, catalog, 'kg'))[0].load).toBe('11.3 kg');
  });

  test('uses a dash for unknown zero loads even when a reps-only rule matches', async () => {
    const t = template();
    t.exercises[0].rules = [{ id: 'reps', template_exercise_id: 'slot-a', priority: 0, rule_json: { conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }], actions: [{ type: 'INCREASE_TARGET_REPS', value: 1 }] } }];
    const repo = new MockWorkoutRepository([workout('last', '2026-10-20')], [1, 2, 3].map(n => set(`s-${n}`, 'last', 0, { reps: 8, set_number: n })));
    const [row] = await buildWorkoutPreview(t, repo, new Map(DEFAULT_EXERCISES.map(ex => [ex.id, ex])), 'kg');
    expect(row.load).toBe('–');
    expect(row.summary).not.toMatch(/suggested|effective|Last/);
  });

  test('preserves individual working loads for rep-only progression and maps DDP past warmups', async () => {
    const t = template();
    const catalog = new Map(DEFAULT_EXERCISES.map(ex => [ex.id, ex]));
    const rule = { id: 'progress', template_exercise_id: 'slot-a', priority: 0,
      rule_json: { conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' as const }], actions: [{ type: 'INCREASE_TARGET_REPS' as const, value: 1 }] } };
    t.exercises[0].rules = [rule];
    const repo = new MockWorkoutRepository([workout('last', '2026-10-20')], [
      set('warm', 'last', 5, { set_type: 'warmup' }),
      ...[10, 12.5, 15].map((w, i) => set(`s-${i}`, 'last', w, { reps: 8, set_number: i + 2 })),
    ]);
    const [reps] = await buildWorkoutPreview(t, repo, catalog, 'kg');
    expect(reps.summary).toBe('9 × 10 kg, 9 × 12.5 kg, 9 × 15 kg · RPE 8');
    t.exercises[0].rules = [{ ...rule, rule_json: { conditions: [{ type: 'ANY_SET_HIT_TOP_REP_RANGE' }], actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }] } }];
    const [ddp] = await buildWorkoutPreview(t, repo, catalog, 'kg');
    expect(ddp.sets.map(s => s.rawInputWeight)).toEqual([12.5, 15, 17.5]);
  });

  test('shows bodyweight, added weight, and assistance without exposing system load', async () => {
    const exercise = { ...DEFAULT_EXERCISES[0], id: 'barbell_back_squat', is_bodyweight: true };
    const catalog = new Map([[exercise.id, exercise]]);
    expect((await buildWorkoutPreview(template(), new MockWorkoutRepository(), catalog, 'kg'))[0].load).toBe('Bodyweight');
    for (const [raw, expected] of [[10, 'Bodyweight + 10 kg'], [-20, '20 kg assistance']] as const) {
      const repo = new MockWorkoutRepository([workout('last', '2026-10-20')], [set('last', 'last', 80 + raw, { raw_input_weight: raw, added_weight: raw })]);
      expect((await buildWorkoutPreview(template(), repo, catalog, 'kg'))[0].load).toBe(expected);
    }
  });
});

describe('SBD history', () => {
  test('keeps historical bodyweight separate from later weigh-ins and omits partial DOTS', () => {
    const workouts = [workout('squat', '2026-10-01'), workout('bench', '2026-10-02'), workout('deadlift', '2026-10-03')];
    const sets = [set('s', 'squat', 100), set('b', 'bench', 70, { exercise_id: 'barbell_bench_press' }), set('d', 'deadlift', 140, { exercise_id: 'barbell_deadlift' })];
    const metric: BodyMetric = { id: 'bw', date: '2026-10-03', bodyweight: 80, body_fat_manual: null, waist_cm: null, neck_cm: null, hip_cm: null, bicep_cm: null, chest_cm: null, thigh_cm: null, calf_cm: null, navy_body_fat: null };
    const timeline = buildStrengthTimeline(workouts, sets, DEFAULT_EXERCISES, [metric, { ...metric, id: 'later', date: '2026-10-10', bodyweight: 85 }], 'male');
    expect(timeline[0].dots).toBeNull();
    expect(timeline[1].dots).toBeNull();
    expect(timeline[2].bodyweight).toBe(80);
    expect(timeline[2].dots).toBeGreaterThan(0);
    expect(timeline[2].total).toBeGreaterThan(310);
    expect(timeline[2].squat).toBe(timeline[0].squat);
  });
});


describe('earned next-workout load increases', () => {
  const catalog = new Map(DEFAULT_EXERCISES.map(ex => [ex.id, ex]));
  function linearTemplate() {
    const t = template();
    t.exercises[0].rules = [{ id: 'linear', template_exercise_id: 'slot-a', priority: 0,
      rule_json: { conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }], actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }] } }];
    return t;
  }
  test('records increases in the workout that earned them, with the same loads used at next startup', async () => {
    const t = linearTemplate();
    const settings = new MockUserSettingsRepository();
    const repo = new MockWorkoutRepository([workout('earned', '2026-10-21')],
      [1, 2, 3].map(n => set(`s-${n}`, 'earned', 100, { reps: 8, set_number: n })));
    const changes = await captureWorkoutProgression('earned', t, repo, catalog, 'kg', undefined, undefined, { settings });
    expect(changes).toHaveLength(1);
    expect(changes[0].summary).toBe('3 × 5–8 · 102.5 kg · RPE 8');
    const next = await buildWorkoutPreview(t, repo, catalog, 'kg', undefined, undefined, { settings });
    expect(next[0].sets.map(s => s.rawInputWeight)).toEqual([102.5, 102.5, 102.5]);
    expect(changes[0].explanation).toBe(next[0].explanation);
    expect(JSON.parse((await settings.get('training_progression_summary_earned'))!)).toEqual(changes);
    // A later program edit cannot rewrite what this completed workout earned.
    t.exercises[0].rules = [];
    expect(await captureWorkoutProgression('earned', t, repo, catalog, 'lbs', undefined, undefined, { settings })).toEqual(changes);
  });
  test('does not report a load increase if requirements were missed or the workout is unfinished', async () => {
    for (const status of ['completed', 'in_progress'] as const) {
      const repo = new MockWorkoutRepository([workout('miss', '2026-10-21', { status })],
        [1, 2, 3].map(n => set(`s-${n}`, 'miss', 100, { reps: 5, set_number: n })));
      expect(await captureWorkoutProgression('miss', linearTemplate(), repo, catalog, 'kg')).toEqual([]);
    }
  });
  test('old singleton template groups become ordinary prescribed exercises', async () => {
    const t = template(); t.exercises[0].exercise_group_id = 'orphan';
    const rows = await buildWorkoutPreview(t, new MockWorkoutRepository(), catalog, 'kg');
    expect(rows[0].groupId).toBeNull();
    expect(rows[0].templateExercise.exercise_group_id).toBeNull();
    expect(t.exercises[0].exercise_group_id).toBe('orphan');
  });
});

test('active-session reads ignore orphan groups without rewriting stored sets', async () => {
  const repo = new MockWorkoutRepository();
  const exercises = new MockExerciseRepository(DEFAULT_EXERCISES);
  const service = new ActiveSessionService(repo, exercises);
  await repo.create(workout('active', '2026-10-21', { status: 'in_progress' }));
  await repo.addSet(set('one', 'active', 100, { exercise_group_id: 'orphan' }));
  await repo.addSet(set('two', 'active', 100, { exercise_group_id: 'orphan', set_number: 2 }));
  expect((await service.getActiveWorkout('active'))!.sets.every(s => s.exercise_group_id === null)).toBe(true);
  expect((await service.getSupersetGroups('active')).size).toBe(0);
  expect((await repo.getSetsByWorkoutId('active')).every(s => s.exercise_group_id === 'orphan')).toBe(true);
});
