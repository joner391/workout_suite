/**
 * Workout Suite — CalibratedParamService Unit Tests
 *
 * Implements Step 6.3 Verification Gate:
 * - Ingestion of calibrated_parameters.json payload
 * - Contract validation and bounds checking (0.03 <= k <= 0.20, 1RM > 0)
 * - SQLite write-through persistence into calibrated_params table
 * - Tier 1 heuristic e1RM calculation upgrade using individualized k
 */

import { CalibratedParamService, CalibratedParametersEnvelope } from '../calibratedParamService';
import { MockSQLiteDatabase } from '../../database/__tests__/MockSQLiteDatabase';

describe('CalibratedParamService (Step 6.3)', () => {
  let mockDb: MockSQLiteDatabase;
  let service: CalibratedParamService;

  const validEnvelope: CalibratedParametersEnvelope = {
    version: '1.0.0',
    exported_at: '2026-10-15T22:00:00.000Z',
    parameters: [
      {
        exercise_id: 'barbell_bench_press',
        calibrated_1rm: 105.5,
        calibrated_k: 0.0845,
        cov_p00: 0.0012,
        cov_p11: 0.0004,
        calibrated_at: '2026-10-15T22:00:00.000Z',
      },
      {
        exercise_id: 'barbell_deadlift',
        calibrated_1rm: 185.0,
        calibrated_k: 0.0685,
        cov_p00: 0.0025,
        cov_p11: 0.0008,
        calibrated_at: '2026-10-15T22:00:00.000Z',
      },
    ],
  };

  beforeEach(() => {
    mockDb = new MockSQLiteDatabase();
    service = new CalibratedParamService(mockDb);
  });

  describe('importParameters', () => {
    it('imports evidence with no curves and preserves explicit confidence metadata', async () => {
      const feedback = { recommended_accumulation_weeks: 6, confidence_score: 75, confidence_tier: 'HIGH' as const,
        detected_blocks_count: 8, explicit_rpe_coverage: 1, observed_through: '2026-10-20',
        exported_at: validEnvelope.exported_at, primary_goal: 'strength' };
      const result = await service.importParameters({ ...validEnvelope, parameters: [], mesocycle_feedback: feedback });
      expect(result.success).toBe(true);
      expect(mockDb.executedQueries.some(q => q.params.includes('training_meso_feedback') && q.params.includes(JSON.stringify(feedback)))).toBe(true);
    });
    it('does not persist invalid evidence alongside otherwise valid curves', async () => {
      const result = await service.importParameters({ ...validEnvelope,
        mesocycle_feedback: { recommended_accumulation_weeks: 99 } as any });
      expect(result.success).toBe(true);
      expect(result.errors).toContain('Invalid mesocycle feedback; block length retained.');
      expect(mockDb.executedQueries.some(q => q.params.includes('training_meso_feedback'))).toBe(false);
    });
    it('successfully imports a valid parameters envelope', async () => {
      const result = await service.importParameters(validEnvelope);

      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(2);
      expect(result.errors).toHaveLength(0);

      // Verify transaction wrapping
      expect(mockDb.execQueries).toContain('BEGIN TRANSACTION;');
      expect(mockDb.execQueries).toContain('COMMIT;');

      // Verify queries executed
      const insertQueries = mockDb.executedQueries.filter((q) =>
        q.sql.includes('INSERT INTO calibrated_params')
      );
      expect(insertQueries).toHaveLength(2);
      expect(insertQueries[0].params[0]).toBe('calib_barbell_bench_press');
      expect(insertQueries[0].params[1]).toBe('barbell_bench_press');
      expect(insertQueries[0].params[2]).toBe(105.5);
      expect(insertQueries[0].params[3]).toBe(0.0845);
    });

    it('successfully imports from raw JSON string', async () => {
      const jsonStr = JSON.stringify(validEnvelope);
      const result = await service.importParameters(jsonStr);

      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(2);
    });

    it('rejects invalid JSON string gracefully', async () => {
      const result = await service.importParameters('{ not valid json }');

      expect(result.success).toBe(false);
      expect(result.importedCount).toBe(0);
      expect(result.errors[0]).toContain('Failed to parse JSON string');
    });

    it('rejects envelope missing required metadata', async () => {
      const invalid = { version: '1.0.0' } as any;
      const result = await service.importParameters(invalid);

      expect(result.success).toBe(false);
      expect(result.importedCount).toBe(0);
      expect(result.errors[0]).toContain('missing version, exported_at, or parameters array');
    });

    it('skips invalid items (out-of-bounds k, non-positive 1RM) and logs descriptive errors', async () => {
      const mixedEnvelope: CalibratedParametersEnvelope = {
        version: '1.0.0',
        exported_at: '2026-10-15T22:00:00.000Z',
        parameters: [
          {
            exercise_id: 'bad_k_low',
            calibrated_1rm: 100,
            calibrated_k: 0.01, // < 0.03 min
            cov_p00: 0.0,
            cov_p11: 0.0,
            calibrated_at: '2026-10-15T22:00:00.000Z',
          },
          {
            exercise_id: 'bad_1rm_negative',
            calibrated_1rm: -50, // <= 0
            calibrated_k: 0.085,
            cov_p00: 0.0,
            cov_p11: 0.0,
            calibrated_at: '2026-10-15T22:00:00.000Z',
          },
          {
            exercise_id: 'valid_lift',
            calibrated_1rm: 120,
            calibrated_k: 0.095,
            cov_p00: 0.001,
            cov_p11: 0.0002,
            calibrated_at: '2026-10-15T22:00:00.000Z',
          },
        ],
      };

      const result = await service.importParameters(mixedEnvelope);

      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(1);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('calibrated_k must be between 0.03 and 0.20');
      expect(result.errors[1]).toContain('calibrated_1rm must be positive number');
    });

    it('handles SQLite rollback when query fails', async () => {
      jest.spyOn(mockDb, 'runAsync').mockRejectedValueOnce(new Error('Disk I/O error'));

      const result = await service.importParameters(validEnvelope);

      expect(result.success).toBe(false);
      expect(result.importedCount).toBe(0);
      expect(mockDb.execQueries).toContain('ROLLBACK;');
    });
  });

  describe('getCalibratedParam & calculateCalibrated1RM', () => {
    it('returns null when no calibrated parameter exists for exercise', async () => {
      const param = await service.getCalibratedParam('unknown_exercise');
      expect(param).toBeNull();
    });

    it('returns stored calibrated parameter when present in database', async () => {
      mockDb.mockData.set('WHERE exercise_id = ?', [
        {
          id: 'calib_bench',
          exercise_id: 'barbell_bench_press',
          calibrated_1rm: 105.5,
          calibrated_k: 0.0845,
          cov_p00: 0.0012,
          cov_p11: 0.0004,
          calibrated_at: '2026-10-15T22:00:00.000Z',
        },
      ]);

      const param = await service.getCalibratedParam('barbell_bench_press');
      expect(param).not.toBeNull();
      expect(param?.calibrated_1rm).toBe(105.5);
      expect(param?.calibrated_k).toBe(0.0845);
    });

    it('falls back to default k=0.10 when calculating 1RM for uncalibrated exercise', async () => {
      const calc = await service.calculateCalibrated1RM('unknown_exercise', 80, 8, { rir: 2 });

      expect(calc.isCalibrated).toBe(false);
      expect(calc.kUsed).toBe(0.10);
      // r_eff = 8 + 2 = 10, e1rm = 80 * 10^0.10 = 100.71
      expect(calc.e1rm).toBeCloseTo(80 * Math.pow(10, 0.10), 1);
    });

    it('uses calibrated k when calculating 1RM for calibrated exercise', async () => {
      mockDb.mockData.set('WHERE exercise_id = ?', [
        {
          id: 'calib_deadlift',
          exercise_id: 'barbell_deadlift',
          calibrated_1rm: 185.0,
          calibrated_k: 0.0685,
          cov_p00: 0.002,
          cov_p11: 0.0005,
          calibrated_at: '2026-10-15T22:00:00.000Z',
        },
      ]);

      const calc = await service.calculateCalibrated1RM('barbell_deadlift', 140, 5, { rir: 1 });

      expect(calc.isCalibrated).toBe(true);
      expect(calc.kUsed).toBe(0.0685);
      // r_eff = 5 + 1 = 6, e1rm = 140 * 6^0.0685 = 158.3
      expect(calc.e1rm).toBeCloseTo(140 * Math.pow(6, 0.0685), 1);
    });
  });

  describe('getAllCalibratedParams & clearAll', () => {
    it('returns all calibrated parameters', async () => {
      mockDb.mockData.set('FROM calibrated_params', [
        {
          id: 'calib_1',
          exercise_id: 'barbell_back_squat',
          calibrated_1rm: 140,
          calibrated_k: 0.095,
          cov_p00: 0.001,
          cov_p11: 0.0002,
          calibrated_at: '2026-10-15T22:00:00.000Z',
        },
      ]);

      const list = await service.getAllCalibratedParams();
      expect(list).toHaveLength(1);
      expect(list[0].exercise_id).toBe('barbell_back_squat');
    });

    it('clears all parameters', async () => {
      await service.clearAll();
      const deleteQuery = mockDb.executedQueries.find((q) =>
        q.sql.includes('DELETE FROM calibrated_params')
      );
      expect(deleteQuery).toBeDefined();
    });
  });
});
