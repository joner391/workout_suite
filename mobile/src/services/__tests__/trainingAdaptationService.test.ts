import { harness } from './trainingFixtures';
import { CURVES_KEY, TRAINING_CONTROLS_KEY, readTrainingJson, PrescriptionSnapshot } from '../trainingAdaptationService';
import { buildWorkoutPreview } from '../workoutPreviewService';
import { predictTrainingLoad, trainingStatus } from '../../core/rules/trainingAdaptation';

describe('Automatic session adaptation', () => {
  test('does not treat prescribed short mini-sets as missed full activation sets', async () => {
    const h = await harness('hypertrophy');
    const template = (await h.programs.getTemplateWithDetails('t'))!;
    const first = { ...template.exercises[0], target_sets: 1, target_reps_min: 12, target_reps_max: 15,
      set_type: 'myorep' as const, rest_pause: { mini_sets: 3, mini_reps_min: 3, mini_reps_max: 5, rest_seconds: 15 } };
    await h.programs.updateTemplateExercise(first);
    const resolved = await h.session('cluster', 12);
    const activation = (await h.workouts.getSetsByWorkoutId('cluster')).find(s => s.exercise_id === first.exercise_id)!;
    for (let n = 2; n <= 4; n++) await h.workouts.addSet({ ...activation, id: `mini-${n}`, set_number: n, reps: 3, set_type: 'myorep' });
    await h.adaptation.capture('cluster', resolved, h.exerciseMap);
    await h.finish('cluster');
    const exposure = (await h.adaptation.state('program')).exposures[first.id].at(-1)!;
    expect(exposure.belowMinimum).toBe(false);
    expect(exposure.totalReps).toBe(21);
  });
  test('ignores flat performance, accessory misses and incomparable load changes for systemic fatigue', async () => {
    const h = await harness();
    for (let i = 0; i < 4; i++) { await h.session(`flat${i}`); await h.finish(`flat${i}`); }
    expect((await h.adaptation.state('program')).deload).toBeUndefined();
    for (let i = 0; i < 2; i++) {
      await h.session(`row${i}`);
      const sets = await h.workouts.getSetsByWorkoutId(`row${i}`);
      for (const s of sets.filter(s => s.exercise_id === 'row')) await h.workouts.updateSet({ ...s, reps: 4 });
      await h.finish(`row${i}`);
    }
    expect((await h.adaptation.state('program')).deload).toBeUndefined();
    for (let i = 0; i < 2; i++) { await h.session(`load${i}`, 4, 90 + i * 5); await h.finish(`load${i}`); }
    expect((await h.adaptation.state('program')).deload).toBeUndefined();
  });
  test.each(['strength', 'hypertrophy'] as const)('deloads %s for one week of sessions, then restarts easier', async goal => {
    const h = await harness(goal);
    for (let i = 0; i < 2; i++) { await h.session(`miss${i}`, 4); await h.finish(`miss${i}`); }
    expect((await h.adaptation.state('program')).deload?.remaining).toBe(3);
    for (let i = 0; i < 3; i++) {
      const resolved = await h.session(`recover${i}`, 6, 65, 4);
      expect(resolved.exercises.every(te => te.target_sets === 2 && te.target_rir === 4 && te.rules.length === 0)).toBe(true);
      await h.finish(`recover${i}`);
      await h.adaptation.complete(`recover${i}`); // retries cannot consume an extra recovery session
    }
    expect((await h.adaptation.state('program')).deload).toBeUndefined();
    expect((await h.adaptation.state('program')).restart).toBe(true);
    await h.evolution.evolveActiveProgramForNextMeso();
    expect((await h.programs.findTemplateExerciseById('te-squat'))?.target_rir).toBe(3);
    await h.session('restart', 6, 75, 3); await h.finish('restart');
    expect((await h.programs.findTemplateExerciseById('te-squat'))?.target_rir).toBe(2);
  });
  test('requires the two consecutive declining comparisons, not one bad day', () => {
    const history = [18, 17, 16].map((totalReps, i) => ({ workoutId: `${i}`, signature: 'a', totalReps, belowMinimum: false, effort: 2 }));
    expect(trainingStatus(history.slice(0, 2))).not.toBe('deteriorating');
    expect(trainingStatus(history)).toBe('deteriorating');
    expect(trainingStatus([...history, { ...history[2], signature: 'changed' }])).not.toBe('deteriorating');
  });
  test('high pain ends current work, prompts only first return and swaps on any returning pain', async () => {
    const h = await harness();
    await h.settings.set(TRAINING_CONTROLS_KEY, JSON.stringify({ squat: { anchor: true } }));
    await h.exercises.create({ ...h.exerciseMap.get('squat')!, id: 'leg-press', name: 'Leg Press', category: 'Machine', standard_lift_type: null });
    h.exerciseMap.set('leg-press', (await h.exercises.findById('leg-press'))!);
    await h.session('pain');
    const performed = (await h.workouts.getSetsByWorkoutId('pain')).find(s => s.exercise_id === 'squat')!;
    expect(await h.adaptation.recordPain('pain', 'squat', 7, new Set([performed.id]))).toBe(true);
    expect((await h.workouts.getSetsByWorkoutId('pain')).filter(s => s.exercise_id === 'squat')).toHaveLength(1);
    await h.finish('pain');
    await h.session('return');
    const snapshot = await readTrainingJson<PrescriptionSnapshot | null>(h.settings, 'training_snapshot_return', null);
    expect(snapshot?.exercises.find(e => e.prescription.exercise_id === 'squat')?.painReturn).toBe(true);
    await h.adaptation.recordPain('return', 'squat', 1, new Set());
    await h.finish('return');
    const substituted = await h.session('swapped');
    expect(substituted.exercises.some(te => te.exercise_id === 'squat')).toBe(false);
    expect(substituted.exercises.some(te => te.exercise_id === 'leg-press')).toBe(true);
    expect((await h.programs.findTemplateExerciseById('te-squat'))?.exercise_id).toBe('leg-press');
  });
  test('uses personalized shape, recent strength, recovery RIR and effective-to-entered loads', async () => {
    const h = await harness();
    await h.settings.set(CURVES_KEY, JSON.stringify({ squat: { calibrated_1rm: 150, calibrated_k: 0.15, calibrated_at: '2026-10-01' } }));
    await h.session('baseline', 8, 80, 2); await h.finish('baseline');
    const te = (await h.programs.getTemplateWithDetails('t'))!.exercises[0];
    const history = await h.workouts.getHistoricalSetsForExercise('squat', { onlyCompletedWorkouts: true });
    const expected = 80 * Math.pow(10 / 8, 0.15);
    expect(await h.adaptation.loadFor(te, history, 'program')).toBeCloseTo(expected);
    expect(predictTrainingLoad(150, 0.15, 10, 4)).toBeCloseTo(150 / Math.pow(14, 0.15));
    expect(predictTrainingLoad(150, 0.15, 8, 6)).not.toBeNull();
    const state = await h.adaptation.state('program'); state.deload = { remaining: 3, completed: [] }; await h.adaptation.save('program', state);
    const plan = await buildWorkoutPreview((await h.programs.getTemplateWithDetails('t'))!, h.workouts, h.exerciseMap, 'kg', undefined, undefined, h.adaptation.context);
    expect(plan[0].proposal).toBeNull();
    expect(plan[0].templateExercise.target_rir).toBe(4);
    expect(plan[0].sets[0].rawInputWeight).toBeLessThan(expected);
  });
  test('pain rebuild uses a fixed reference and never exceeds its normal prescription', async () => {
    const h = await harness();
    await h.session('baseline', 8, 80); await h.finish('baseline');
    await h.session('pain');
    await h.adaptation.recordPain('pain', 'squat', 8, new Set()); await h.finish('pain');
    let previous = 0;
    for (let i = 0; i < 8; i++) {
      const template = (await h.programs.getTemplateWithDetails('t'))!;
      const state = await h.adaptation.state('program');
      if (!state.pain.squat) break;
      const history = await h.workouts.getHistoricalSetsForExercise('squat', { onlyCompletedWorkouts: true });
      const weight = (await h.adaptation.loadFor(template.exercises[0], history, 'program'))!;
      expect(weight).toBeGreaterThan(previous);
      expect(weight).toBeLessThanOrEqual(80 * Math.pow(10 / 8, 0.1));
      previous = weight;
      await h.session(`rebuild${i}`, 6, weight, 5); await h.finish(`rebuild${i}`);
    }
    expect((await h.adaptation.state('program')).pain.squat).toBeUndefined();
  });
  test('counts distinct main movements across separate training days', async () => {
    const h = await harness();
    await h.programs.createTemplate({ id: 't2', program_id: 'program', name: 'Other day', notes: null, order_index: 1, created_at: '2026-10-01' });
    const bench = (await h.programs.findTemplateExerciseById('te-bench'))!;
    await h.programs.updateTemplateExercise({ ...bench, template_id: 't2' });
    for (let i = 0; i < 2; i++) { await h.session(`squat-miss${i}`, 4); await h.finish(`squat-miss${i}`); }
    expect((await h.adaptation.state('program')).deload).toBeUndefined();
    for (let i = 0; i < 2; i++) {
      await h.session(`bench-miss${i}`, 4, 80, 2, 't2');
      await h.finish(`bench-miss${i}`);
    }
    expect((await h.adaptation.state('program')).deload?.remaining).toBe(3);
  });
  test('late-imported old performance cannot overwrite a newer companion strength estimate', async () => {
    const h = await harness();
    await h.session('imported-old', 8, 20); await h.finish('imported-old');
    const workout = (await h.workouts.findById('imported-old'))!;
    await h.workouts.update({ ...workout, date: '2025-01-01', started_at: '2025-01-01T12:00:00Z' });
    await h.settings.set(CURVES_KEY, JSON.stringify({ squat: { calibrated_1rm: 150, calibrated_k: 0.15, calibrated_at: '2026-10-01' } }));
    const template = (await h.programs.getTemplateWithDetails('t'))!;
    const history = await h.workouts.getHistoricalSetsForExercise('squat', { onlyCompletedWorkouts: true });
    expect(await h.adaptation.loadFor(template.exercises[0], history, 'program')).toBeCloseTo(150 / Math.pow(8, 0.15));
  });
});
