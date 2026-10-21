import { loadTrainingOverview, localTrainingDate } from '../trainingOverviewService';
import { buildStrengthTimeline } from '../strengthOverviewService';
import { buildWorkoutPreview, selectNextTemplate } from '../workoutPreviewService';
import { MockWorkoutRepository } from '../../database/mocks/MockWorkoutRepository';
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
    expect(rows[0]).toMatchObject({ target: '3 × 5–8 · RPE 8', load: 'Last 220.5 lbs' });
    const empty = await buildWorkoutPreview(template(), new MockWorkoutRepository(), catalog, 'kg');
    expect(empty[0].load).toBe('Set load in workout');
    expect((await repo.getSetsByWorkoutId('last'))[0].weight).toBe(100);
  });

  test('previews the existing progression proposal without applying it', async () => {
    const t = template();
    t.exercises[0].rules = [{ id: 'linear', template_exercise_id: 'slot-a', priority: 0, rule_json: { conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }], actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }] } }];
    const repo = new MockWorkoutRepository([workout('last', '2026-10-20')], [1, 2, 3].map(n => set(`s-${n}`, 'last', 100, { reps: 8, set_number: n })));
    const rows = await buildWorkoutPreview(t, repo, new Map(DEFAULT_EXERCISES.map(ex => [ex.id, ex])), 'kg');
    expect(rows[0].load).toBe('Suggested 102.5 kg');
    expect(rows[0].target).toContain('suggested');
    expect((await repo.getSetsByWorkoutId('last')).every(s => s.weight === 100)).toBe(true);
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

