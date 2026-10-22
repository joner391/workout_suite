/**
 * Workout Suite — Calibrated Parameter Ingestion Service
 *
 * Implements Step 6.3 of IMPLEMENTATION_PLAN.md:
 * Ingests calibrated_parameters.json exported from the Companion Python Tier 2
 * Adaptive Linear Kalman Filter into the SQLite `calibrated_params` table.
 *
 * Upgrades Tier 1 in-gym heuristic e1RM calculations from the generic k = 0.10
 * default to individualized movement-specific repetition fatigue exponents (k).
 *
 * Conforms to:
 * - schemas/calibrated_parameters.schema.json
 * - ADR-002: Dual-Tier 1RM Estimation Architecture
 * - ADR-026: Mechanical Load Normalization and Persistence Contract
 * - ADR-042: Pre-Phase 7 Schema Synchronization
 */

import { ISQLiteDatabase } from '../database/schema';
import { CalibratedParam, MuscleLandmarkPayload, ProgramAuditPayload, SFRTier } from '../core/types';
import { calculateEffectiveReps, calculateLombardi1RM, IntensityInput } from '../core/math/heuristic1rm';
import type { MesocycleFeedback } from './programEvolutionService';
import { CURVES_KEY, MESO_FEEDBACK_KEY } from './trainingAdaptationService';

export interface CalibratedParameterItem {
  exercise_id: string;
  calibrated_1rm: number;
  calibrated_k: number;
  cov_p00: number;
  cov_p11: number;
  calibrated_at: string;
  calibrated_10rm?: number | null;
  sfr_score?: number | null;
  sfr_tier?: SFRTier | null;
  recommended_swap_exercise_id?: string | null;
  optimal_rest_seconds?: number | null;
  asymmetry_ratio?: number | null;
}

export interface CalibratedParametersEnvelope {
  version: string;
  exported_at: string;
  parameters: CalibratedParameterItem[];
  muscle_landmarks?: Record<string, MuscleLandmarkPayload> | null;
  program_audits?: ProgramAuditPayload[] | null;
  mesocycle_feedback?: MesocycleFeedback | null;
}

export interface ImportResult {
  success: boolean;
  importedCount: number;
  errors: string[];
}

export class CalibratedParamService {
  constructor(private readonly db: ISQLiteDatabase) {}

  /**
   * Validates and imports a calibrated parameters payload into the local SQLite database.
   * Supports either a parsed object or a raw JSON string.
   */
  async importParameters(payloadOrJson: CalibratedParametersEnvelope | string): Promise<ImportResult> {
    const errors: string[] = [];
    let envelope: CalibratedParametersEnvelope;

    if (typeof payloadOrJson === 'string') {
      try {
        envelope = JSON.parse(payloadOrJson);
      } catch (err: unknown) {
        return {
          success: false,
          importedCount: 0,
          errors: [`Failed to parse JSON string: ${err instanceof Error ? err.message : String(err)}`],
        };
      }
    } else {
      envelope = payloadOrJson;
    }

    if (!envelope || typeof envelope !== 'object') {
      return { success: false, importedCount: 0, errors: ['Invalid envelope: expected object'] };
    }

    if (!envelope.version || !envelope.exported_at || !Array.isArray(envelope.parameters)) {
      return {
        success: false,
        importedCount: 0,
        errors: ['Invalid envelope format: missing version, exported_at, or parameters array'],
      };
    }

    const validParams: CalibratedParameterItem[] = [];

    for (let i = 0; i < envelope.parameters.length; i++) {
      const p = envelope.parameters[i];
      if (!p || typeof p !== 'object') {
        errors.push(`parameters[${i}]: item is not an object`);
        continue;
      }
      if (!p.exercise_id || typeof p.exercise_id !== 'string') {
        errors.push(`parameters[${i}]: missing or invalid exercise_id`);
        continue;
      }
      if (typeof p.calibrated_1rm !== 'number' || p.calibrated_1rm <= 0 || isNaN(p.calibrated_1rm)) {
        errors.push(`parameters[${i}] (${p.exercise_id}): calibrated_1rm must be positive number`);
        continue;
      }
      if (typeof p.calibrated_k !== 'number' || p.calibrated_k < 0.03 || p.calibrated_k > 0.20 || isNaN(p.calibrated_k)) {
        errors.push(`parameters[${i}] (${p.exercise_id}): calibrated_k must be between 0.03 and 0.20`);
        continue;
      }

      validParams.push({
        exercise_id: p.exercise_id.trim(),
        calibrated_1rm: Number(p.calibrated_1rm),
        calibrated_k: Number(p.calibrated_k),
        cov_p00: typeof p.cov_p00 === 'number' && !isNaN(p.cov_p00) ? p.cov_p00 : 0.0,
        cov_p11: typeof p.cov_p11 === 'number' && !isNaN(p.cov_p11) ? p.cov_p11 : 0.0,
        calibrated_at: p.calibrated_at || envelope.exported_at,
        calibrated_10rm: typeof p.calibrated_10rm === 'number' && !isNaN(p.calibrated_10rm) ? p.calibrated_10rm : null,
        sfr_score: typeof p.sfr_score === 'number' && !isNaN(p.sfr_score) ? p.sfr_score : null,
        sfr_tier: typeof p.sfr_tier === 'string' ? (p.sfr_tier as SFRTier) : null,
        recommended_swap_exercise_id: typeof p.recommended_swap_exercise_id === 'string' ? p.recommended_swap_exercise_id : null,
        optimal_rest_seconds: typeof p.optimal_rest_seconds === 'number' && !isNaN(p.optimal_rest_seconds) ? p.optimal_rest_seconds : null,
        asymmetry_ratio: typeof p.asymmetry_ratio === 'number' && !isNaN(p.asymmetry_ratio) ? p.asymmetry_ratio : null,
      });
    }

    const feedback = envelope.mesocycle_feedback;
    const validFeedback = feedback && Number.isInteger(feedback.recommended_accumulation_weeks) &&
      feedback.recommended_accumulation_weeks >= 3 && feedback.recommended_accumulation_weeks <= 12 &&
      Number.isFinite(feedback.confidence_score) && feedback.confidence_score >= 0 && feedback.confidence_score <= 100 &&
      ['LOW', 'MODERATE', 'HIGH'].includes(feedback.confidence_tier) &&
      Number.isInteger(feedback.detected_blocks_count) && feedback.detected_blocks_count >= 0 &&
      Number.isFinite(feedback.explicit_rpe_coverage) && feedback.explicit_rpe_coverage >= 0 && feedback.explicit_rpe_coverage <= 1 &&
      typeof feedback.primary_goal === 'string' && Number.isFinite(Date.parse(feedback.exported_at)) &&
      (feedback.observed_through === '' || Number.isFinite(Date.parse(feedback.observed_through)));
    if (feedback && !validFeedback) errors.push('Invalid mesocycle feedback; block length retained.');
    if (validParams.length === 0 && !validFeedback) {
      return {
        success: false,
        importedCount: 0,
        errors: errors.length > 0 ? errors : ['No valid calibrated parameters found in payload'],
      };
    }

    // Persist to SQLite inside an explicit transaction
    await this.db.execAsync('BEGIN TRANSACTION;');
    try {
      for (const p of validParams) {
        const id = `calib_${p.exercise_id}`;
        await this.db.runAsync(
          `INSERT INTO calibrated_params (
            id, exercise_id, calibrated_1rm, calibrated_k, cov_p00, cov_p11, calibrated_at,
            calibrated_10rm, sfr_score, sfr_tier, recommended_swap_exercise_id, optimal_rest_seconds, asymmetry_ratio
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(exercise_id) DO UPDATE SET
            calibrated_1rm = excluded.calibrated_1rm,
            calibrated_k = excluded.calibrated_k,
            cov_p00 = excluded.cov_p00,
            cov_p11 = excluded.cov_p11,
            calibrated_at = excluded.calibrated_at,
            calibrated_10rm = excluded.calibrated_10rm,
            sfr_score = excluded.sfr_score,
            sfr_tier = excluded.sfr_tier,
            recommended_swap_exercise_id = excluded.recommended_swap_exercise_id,
            optimal_rest_seconds = excluded.optimal_rest_seconds,
            asymmetry_ratio = excluded.asymmetry_ratio;`,
          id,
          p.exercise_id,
          p.calibrated_1rm,
          p.calibrated_k,
          p.cov_p00,
          p.cov_p11,
          p.calibrated_at,
          p.calibrated_10rm ?? null,
          p.sfr_score ?? null,
          p.sfr_tier ?? null,
          p.recommended_swap_exercise_id ?? null,
          p.optimal_rest_seconds ?? null,
          p.asymmetry_ratio ?? null
        );
      }

      // Persist muscle landmarks if present
      if (validParams.length) {
        const existing = await this.db.getFirstAsync<{ value: string }>('SELECT value FROM user_settings WHERE key = ?;', CURVES_KEY);
        let curves = {};
        try { curves = JSON.parse(existing?.value ?? '{}'); } catch { /* Replace malformed legacy cache. */ }
        await this.db.runAsync(
          `INSERT INTO user_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
          CURVES_KEY, JSON.stringify({ ...curves, ...Object.fromEntries(validParams.map(p => [p.exercise_id, p])) })
        );
      }
      if (validFeedback) {
        await this.db.runAsync(
          `INSERT INTO user_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
          MESO_FEEDBACK_KEY, JSON.stringify(feedback)
        );
      }
      if (envelope.muscle_landmarks && typeof envelope.muscle_landmarks === 'object') {
        await this.db.runAsync(
          `INSERT INTO user_settings (key, value) VALUES ('calibrated_muscle_landmarks', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
          JSON.stringify(envelope.muscle_landmarks)
        );
      }

      // Persist program audits if present
      if (envelope.program_audits && Array.isArray(envelope.program_audits)) {
        await this.db.runAsync(
          `INSERT INTO user_settings (key, value) VALUES ('calibrated_program_audits', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
          JSON.stringify(envelope.program_audits)
        );
      }

      await this.db.execAsync('COMMIT;');
    } catch (err: unknown) {
      await this.db.execAsync('ROLLBACK;');
      return {
        success: false,
        importedCount: 0,
        errors: [`SQLite persistence failure: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    return {
      success: true,
      importedCount: validParams.length,
      errors,
    };
  }

  /**
   * Retrieves the calibrated parameter entry for a given exercise ID, if one exists.
   */
  async getCalibratedParam(exerciseId: string): Promise<CalibratedParam | null> {
    const row = await this.db.getFirstAsync<Record<string, unknown>>(
      `SELECT id, exercise_id, calibrated_1rm, calibrated_k, cov_p00, cov_p11, calibrated_at,
              calibrated_10rm, sfr_score, sfr_tier, recommended_swap_exercise_id, optimal_rest_seconds, asymmetry_ratio
       FROM calibrated_params
       WHERE exercise_id = ?;`,
      [exerciseId]
    );

    if (!row) return null;

    return {
      id: String(row.id),
      exercise_id: String(row.exercise_id),
      calibrated_1rm: Number(row.calibrated_1rm),
      calibrated_k: Number(row.calibrated_k),
      cov_p00: Number(row.cov_p00 ?? 0.0),
      cov_p11: Number(row.cov_p11 ?? 0.0),
      calibrated_at: String(row.calibrated_at),
      calibrated_10rm: row.calibrated_10rm != null ? Number(row.calibrated_10rm) : null,
      sfr_score: row.sfr_score != null ? Number(row.sfr_score) : null,
      sfr_tier: row.sfr_tier != null ? (String(row.sfr_tier) as SFRTier) : null,
      recommended_swap_exercise_id: row.recommended_swap_exercise_id != null ? String(row.recommended_swap_exercise_id) : null,
      optimal_rest_seconds: row.optimal_rest_seconds != null ? Number(row.optimal_rest_seconds) : null,
      asymmetry_ratio: row.asymmetry_ratio != null ? Number(row.asymmetry_ratio) : null,
    };
  }

  /**
   * Returns all stored calibrated parameters.
   */
  async getAllCalibratedParams(): Promise<CalibratedParam[]> {
    const rows = await this.db.getAllAsync<Record<string, unknown>>(
      `SELECT id, exercise_id, calibrated_1rm, calibrated_k, cov_p00, cov_p11, calibrated_at,
              calibrated_10rm, sfr_score, sfr_tier, recommended_swap_exercise_id, optimal_rest_seconds, asymmetry_ratio
       FROM calibrated_params
       ORDER BY exercise_id ASC;`
    );

    return (rows || []).map((row) => ({
      id: String(row.id),
      exercise_id: String(row.exercise_id),
      calibrated_1rm: Number(row.calibrated_1rm),
      calibrated_k: Number(row.calibrated_k),
      cov_p00: Number(row.cov_p00 ?? 0.0),
      cov_p11: Number(row.cov_p11 ?? 0.0),
      calibrated_at: String(row.calibrated_at),
      calibrated_10rm: row.calibrated_10rm != null ? Number(row.calibrated_10rm) : null,
      sfr_score: row.sfr_score != null ? Number(row.sfr_score) : null,
      sfr_tier: row.sfr_tier != null ? (String(row.sfr_tier) as SFRTier) : null,
      recommended_swap_exercise_id: row.recommended_swap_exercise_id != null ? String(row.recommended_swap_exercise_id) : null,
      optimal_rest_seconds: row.optimal_rest_seconds != null ? Number(row.optimal_rest_seconds) : null,
      asymmetry_ratio: row.asymmetry_ratio != null ? Number(row.asymmetry_ratio) : null,
    }));
  }

  /**
   * Retrieves cached muscle landmarks from user_settings.
   */
  async getMuscleLandmarks(): Promise<Record<string, MuscleLandmarkPayload> | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      `SELECT value FROM user_settings WHERE key = 'calibrated_muscle_landmarks';`
    );
    if (!row?.value) return null;
    try {
      return JSON.parse(row.value) as Record<string, MuscleLandmarkPayload>;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves cached program parameter audits from user_settings.
   */
  async getProgramAudits(): Promise<ProgramAuditPayload[] | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      `SELECT value FROM user_settings WHERE key = 'calibrated_program_audits';`
    );
    if (!row?.value) return null;
    try {
      return JSON.parse(row.value) as ProgramAuditPayload[];
    } catch {
      return null;
    }
  }

  /**
   * Evaluates estimated 1RM using calibrated k if present, or falls back to default 0.10.
   */
  async calculateCalibrated1RM(
    exerciseId: string,
    weight: number,
    reps: number,
    options?: IntensityInput
  ): Promise<{ e1rm: number; isCalibrated: boolean; kUsed: number }> {
    const rEff = calculateEffectiveReps(reps, options);
    const param = await this.getCalibratedParam(exerciseId);
    if (param) {
      const e1rm = calculateLombardi1RM(weight, rEff, param.calibrated_k);
      return { e1rm, isCalibrated: true, kUsed: param.calibrated_k };
    }
    const defaultK = 0.10;
    const e1rm = calculateLombardi1RM(weight, rEff, defaultK);
    return { e1rm, isCalibrated: false, kUsed: defaultK };
  }

  /**
   * Clears all calibrated parameters from SQLite.
   */
  async clearAll(): Promise<void> {
    await this.db.runAsync('DELETE FROM calibrated_params;');
    await this.db.runAsync('DELETE FROM user_settings WHERE key IN (?, ?);', CURVES_KEY, MESO_FEEDBACK_KEY);
  }
}
