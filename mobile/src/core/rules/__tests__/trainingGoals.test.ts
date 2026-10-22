import { normalizeTrainingGoals } from '../trainingGoals';

describe('legacy training goals', () => {
  it('expands a legacy primary goal without dropping other secondary goals', () => {
    expect(normalizeTrainingGoals('powerbuilding', ['endurance', 'strength'])).toEqual({
      primary_goal: 'strength', secondary_goals: ['endurance', 'hypertrophy'],
    });
  });

  it('expands secondary powerbuilding relative to the ordered primary goal', () => {
    expect(normalizeTrainingGoals('hypertrophy', ['powerbuilding', 'strength'])).toEqual({
      primary_goal: 'hypertrophy', secondary_goals: ['strength'],
    });
    expect(normalizeTrainingGoals('strength', ['powerbuilding'])).toEqual({
      primary_goal: 'strength', secondary_goals: ['hypertrophy'],
    });
  });

  it('preserves a missing secondary goal and unrelated preference tags', () => {
    expect(normalizeTrainingGoals('strength', null)).toEqual({ primary_goal: 'strength', secondary_goals: null });
    expect(normalizeTrainingGoals('hypertrophy', ['fat_loss'])).toEqual({
      primary_goal: 'hypertrophy', secondary_goals: ['fat_loss'],
    });
  });
});
