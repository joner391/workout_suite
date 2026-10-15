import { applyMonotonicUpperEnvelope } from '../repMaxEnvelope';
import { RepMaxRecord } from '../../types';

describe('applyMonotonicUpperEnvelope', () => {
  it('returns empty array or single record unchanged', () => {
    expect(applyMonotonicUpperEnvelope([])).toEqual([]);

    const singleRecord: RepMaxRecord = {
      reps: 1,
      weightKg: 100,
      effectiveReps: 1,
      e1rmKg: 100,
      setDate: '2026-10-01',
      workoutId: 'w1',
      setId: 's1',
    };
    const res = applyMonotonicUpperEnvelope([singleRecord]);
    expect(res).toHaveLength(1);
    expect(res[0].weightKg).toBe(100);
    expect(res[0].isEnveloped).toBeUndefined();
  });

  it('preserves an already monotonic rep-max curve without enveloping', () => {
    const records: RepMaxRecord[] = [
      {
        reps: 1,
        weightKg: 125,
        effectiveReps: 1,
        e1rmKg: 125,
        setDate: '2026-10-01',
        workoutId: 'w1',
      },
      {
        reps: 3,
        weightKg: 115,
        effectiveReps: 3,
        e1rmKg: 128,
        setDate: '2026-10-01',
        workoutId: 'w1',
      },
      {
        reps: 5,
        weightKg: 105,
        effectiveReps: 5,
        e1rmKg: 123,
        setDate: '2026-10-01',
        workoutId: 'w1',
      },
      {
        reps: 10,
        weightKg: 85,
        effectiveReps: 10,
        e1rmKg: 107,
        setDate: '2026-08-15',
        workoutId: 'w0',
      },
    ];

    const result = applyMonotonicUpperEnvelope(records);
    expect(result).toHaveLength(4);
    expect(result.map((r) => r.weightKg)).toEqual([125, 115, 105, 85]);
    for (const r of result) {
      expect(r.isEnveloped).toBeFalsy();
    }
  });

  it('correctly envelopes dominated record for user scenario (20RM 40kg vs 21RM 62.5kg)', () => {
    const records: RepMaxRecord[] = [
      {
        reps: 20,
        weightKg: 40.0,
        effectiveReps: 20,
        e1rmKg: 53.97,
        setDate: '2026-01-15',
        workoutId: 'w_old',
        setId: 's_old',
        rpe: 8.0,
        rir: 2.0,
      },
      {
        reps: 21,
        weightKg: 62.5,
        effectiveReps: 21,
        e1rmKg: 84.74,
        setDate: '2026-10-10',
        workoutId: 'w_new',
        setId: 's_new',
        rpe: 9.5,
        rir: 0.5,
      },
    ];

    const result = applyMonotonicUpperEnvelope(records);
    expect(result).toHaveLength(2);

    const rec20 = result[0];
    const rec21 = result[1];

    // 21RM remains unchanged
    expect(rec21.reps).toBe(21);
    expect(rec21.weightKg).toBe(62.5);
    expect(rec21.isEnveloped).toBeFalsy();

    // 20RM is enveloped to 62.5 kg
    expect(rec20.reps).toBe(20);
    expect(rec20.weightKg).toBe(62.5);
    expect(rec20.isEnveloped).toBe(true);
    expect(rec20.derivedFromReps).toBe(21);
    expect(rec20.originalWeightKg).toBe(40.0);
    expect(rec20.originalSetDate).toBe('2026-01-15');
    expect(rec20.originalWorkoutId).toBe('w_old');
    expect(rec20.originalSetId).toBe('s_old');

    // Tap-to-view historical drilldown points to the 21RM workout where 62.5kg was proven
    expect(rec20.workoutId).toBe('w_new');
    expect(rec20.setDate).toBe('2026-10-10');

    // e1RM for 20RM is elevated to reflect 62.5kg capacity at 20 reps
    expect(rec20.e1rmKg).toBeGreaterThan(80.0);
  });

  it('handles multi-step cascaded dominance across several rep brackets', () => {
    // 3RM @ 70kg, 5RM @ 65kg, 8RM @ 75kg
    const records: RepMaxRecord[] = [
      {
        reps: 3,
        weightKg: 70,
        effectiveReps: 3,
        e1rmKg: 78,
        setDate: '2026-08-01',
        workoutId: 'w1',
      },
      {
        reps: 5,
        weightKg: 65,
        effectiveReps: 5,
        e1rmKg: 76,
        setDate: '2026-08-02',
        workoutId: 'w2',
      },
      {
        reps: 8,
        weightKg: 75,
        effectiveReps: 8,
        e1rmKg: 92,
        setDate: '2026-09-01',
        workoutId: 'w3',
      },
    ];

    const result = applyMonotonicUpperEnvelope(records);
    expect(result).toHaveLength(3);

    // Both 3RM and 5RM must be enveloped to 75kg derived from 8RM
    expect(result[0].reps).toBe(3);
    expect(result[0].weightKg).toBe(75);
    expect(result[0].isEnveloped).toBe(true);
    expect(result[0].derivedFromReps).toBe(8);
    expect(result[0].originalWeightKg).toBe(70);

    expect(result[1].reps).toBe(5);
    expect(result[1].weightKg).toBe(75);
    expect(result[1].isEnveloped).toBe(true);
    expect(result[1].derivedFromReps).toBe(8);
    expect(result[1].originalWeightKg).toBe(65);

    expect(result[2].reps).toBe(8);
    expect(result[2].weightKg).toBe(75);
    expect(result[2].isEnveloped).toBeFalsy();
  });

  it('maintains stability when input records are not pre-sorted by reps', () => {
    const unsorted: RepMaxRecord[] = [
      { reps: 10, weightKg: 80, effectiveReps: 10, e1rmKg: 100, setDate: '2026-08-01' },
      { reps: 2, weightKg: 120, effectiveReps: 2, e1rmKg: 128, setDate: '2026-08-01' },
      { reps: 5, weightKg: 90, effectiveReps: 5, e1rmKg: 105, setDate: '2026-08-01' },
    ];

    const result = applyMonotonicUpperEnvelope(unsorted);
    expect(result.map((r) => r.reps)).toEqual([2, 5, 10]);
    expect(result.map((r) => r.weightKg)).toEqual([120, 90, 80]);
  });

  it('does not envelope identical weights at lower reps', () => {
    const records: RepMaxRecord[] = [
      { reps: 5, weightKg: 80, effectiveReps: 5, e1rmKg: 93, setDate: '2026-08-01' },
      { reps: 6, weightKg: 80, effectiveReps: 6, e1rmKg: 95, setDate: '2026-08-02' },
    ];

    const result = applyMonotonicUpperEnvelope(records);
    expect(result[0].weightKg).toBe(80);
    expect(result[0].isEnveloped).toBeFalsy();
    expect(result[1].weightKg).toBe(80);
    expect(result[1].isEnveloped).toBeFalsy();
  });
});
