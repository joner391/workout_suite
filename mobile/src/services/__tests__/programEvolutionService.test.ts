import { harness, profile } from './trainingFixtures';
import { MESO_FEEDBACK_KEY, TRAINING_CONTROLS_KEY } from '../trainingAdaptationService';
import { MesocycleFeedback } from '../programEvolutionService';

describe('Response-led program evolution', () => {
  test('reports a tight time budget without stripping productive sets or main-lift rest', async () => {
    const h = await harness('strength');
    const current = await h.profiles.getProfile();
    await h.profiles.saveProfile({ ...current!, preferred_session_duration_mins: 15 });
    const before = await h.programs.getTemplateWithDetails('t');
    for (const te of before!.exercises) await h.programs.updateTemplateExercise({ ...te, target_sets: 5, rest_seconds: 240 });
    const result = await h.evolution.evolveActiveProgramForNextMeso();
    expect(result.evolvedTemplateExercises.every(te => te.target_sets === 5 && te.rest_seconds === 240)).toBe(true);
    expect(result.diffMarkdown).toContain('review session-time preference');
  });
  test('stages mood without changing the in-flight prescription', async () => {
    const h = await harness();
    const before = await h.programs.getTemplateWithDetails('t');
    await h.evolution.queueMesoMood({ training_mentality: 'fury' });
    expect(await h.evolution.hasPendingMesoMood()).toBe(true);
    expect(await h.programs.getTemplateWithDetails('t')).toEqual(before);
  });
  test('preserves productive prescriptions, identities and rules even for pure hypertrophy', async () => {
    const h = await harness('hypertrophy');
    const before = await h.programs.getTemplateWithDetails('t');
    const result = await h.evolution.evolveActiveProgramForNextMeso();
    expect(result.evolvedTemplateExercises).toEqual(before?.exercises);
    expect(result.programId).toBe('program');
    expect(result.mesoNumber).toBe(2);
    expect(result.summaryBadge).toBe('Baseline Maintained');
    expect(result.diffMarkdown).not.toMatch(/Chest Volume Increased|guarantee|RPE goal increased/);
    const blocks = await h.programs.findProgramBlocksByProgramId('program');
    expect(blocks.filter(b => b.end_date === null)).toHaveLength(1);
    expect(blocks.find(b => b.id === 'block')?.end_date).not.toBeNull();
  });
  test('does not declare an untrained calendar month a completed block', async () => {
    const h = await harness();
    await h.programs.updateProgramBlock({ id: 'block', program_id: 'program', start_date: '2020-01-01', end_date: null });
    expect((await h.evolution.isReadyForEvolution()).ready).toBe(false);
    for (let i = 0; i < 12; i++) { await h.session(`w${i}`, 8 + i); await h.finish(`w${i}`); }
    expect((await h.evolution.isReadyForEvolution()).ready).toBe(true);
  });
  test('refuses evolution during an active session or unfinished deload', async () => {
    const h = await harness();
    await h.session('w1');
    await expect(h.evolution.evolveActiveProgramForNextMeso()).rejects.toThrow('active workout');
    await h.finish('w1');
    const state = await h.adaptation.state('program');
    state.deload = { remaining: 3, completed: [] };
    await h.adaptation.save('program', state);
    await expect(h.evolution.evolveActiveProgramForNextMeso()).rejects.toThrow('recovery');
  });
  test('does not count an old block session again and serializes duplicate reviews', async () => {
    const h = await harness();
    await h.session('old-block'); await h.finish('old-block');
    const [a, b] = await Promise.all([h.evolution.evolveActiveProgramForNextMeso(), h.evolution.evolveActiveProgramForNextMeso()]);
    expect(a.newBlockId).toBe(b.newBlockId);
    expect(await h.programs.findProgramBlocksByProgramId('program')).toHaveLength(2);
    expect((await h.evolution.isReadyForEvolution()).completedWorkouts).toBe(0);
  });
  test('resets a flat exercise only at next block and applies mood to main lifts', async () => {
    const h = await harness();
    const state = await h.adaptation.state('program'); state.mood = 'precision'; await h.adaptation.save('program', state);
    for (let i = 0; i < 4; i++) { await h.session(`w${i}`); await h.finish(`w${i}`); }
    expect((await h.programs.findTemplateExerciseById('te-squat'))?.target_sets).toBe(2);
    await h.evolution.queueMesoMood({ training_mentality: 'fury' });
    const result = await h.evolution.evolveActiveProgramForNextMeso();
    expect(result.evolvedTemplateExercises.find(te => te.id === 'te-squat')?.target_rir).toBe(1.5);
    expect((await h.adaptation.state('program')).loadFactors['te-squat']).toBe(0.9);
    expect(result.diffMarkdown).toContain('load reset by 10%');
    expect(await h.evolution.hasPendingMesoMood()).toBe(false);
  });
  test('protects anchors from novelty and avoids disliked variants', async () => {
    const h = await harness();
    await h.settings.set(TRAINING_CONTROLS_KEY, JSON.stringify({ squat: { anchor: true } }));
    const state = await h.adaptation.state('program');
    state.adjustments['te-squat'] = 2;
    state.exposures['te-squat'] = Array.from({ length: 4 }, (_, i) => ({ workoutId: `w${i}`, signature: 'same', totalReps: 16, belowMinimum: false, effort: 2 }));
    await h.adaptation.save('program', state);
    const result = await h.evolution.evolveActiveProgramForNextMeso();
    expect(result.evolvedTemplateExercises.find(te => te.id === 'te-squat')?.exercise_id).toBe('squat');
  });
  test.each(['missing', 'low', 'stale', 'wrong-goal', 'valid'])('accepts only qualified companion evidence: %s', async kind => {
    const h = await harness();
    const feedback: MesocycleFeedback = { recommended_accumulation_weeks: 6, confidence_score: 80, confidence_tier: 'HIGH',
      detected_blocks_count: 8, explicit_rpe_coverage: 0.9, observed_through: new Date().toISOString(),
      exported_at: new Date().toISOString(), primary_goal: profile.primary_goal };
    if (kind === 'low') feedback.confidence_tier = 'LOW';
    if (kind === 'stale') feedback.observed_through = '2020-01-01';
    if (kind === 'wrong-goal') feedback.primary_goal = 'hypertrophy';
    if (kind !== 'missing') await h.settings.set(MESO_FEEDBACK_KEY, JSON.stringify(feedback));
    await h.evolution.evolveActiveProgramForNextMeso();
    expect((await h.adaptation.state('program')).weeks).toBe(kind === 'valid' ? 6 : 4);
  });
});
