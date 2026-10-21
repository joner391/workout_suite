import {
  IBodyMetricsRepository,
  BodyMetricProfileContext,
} from '../../domain/repositories/IBodyMetricsRepository';
import { BodyMetric, Gender } from '../../core/types';
import { ISQLiteDatabase } from '../schema';
import { calculateNavyBodyFat } from '../../core/math/navyBodyFat';

interface BodyMetricRow {
  id: string;
  date: string;
  bodyweight: number;
  body_fat_manual: number | null;
  waist_cm: number | null;
  neck_cm: number | null;
  hip_cm: number | null;
  bicep_cm: number | null;
  chest_cm: number | null;
  thigh_cm: number | null;
  calf_cm: number | null;
  navy_body_fat: number | null;
  imported_from: string | null;
}

interface UserProfileSubsetRow {
  gender: Gender;
  height_cm: number | null;
}

function mapRowToBodyMetric(row: BodyMetricRow): BodyMetric {
  return {
    id: row.id,
    date: row.date,
    bodyweight:
      row.bodyweight != null && Number(row.bodyweight) > 0
        ? Number(row.bodyweight)
        : null,
    body_fat_manual:
      row.body_fat_manual != null ? Number(row.body_fat_manual) : null,
    waist_cm: row.waist_cm != null ? Number(row.waist_cm) : null,
    neck_cm: row.neck_cm != null ? Number(row.neck_cm) : null,
    hip_cm: row.hip_cm != null ? Number(row.hip_cm) : null,
    bicep_cm: row.bicep_cm != null ? Number(row.bicep_cm) : null,
    chest_cm: row.chest_cm != null ? Number(row.chest_cm) : null,
    thigh_cm: row.thigh_cm != null ? Number(row.thigh_cm) : null,
    calf_cm: row.calf_cm != null ? Number(row.calf_cm) : null,
    navy_body_fat:
      row.navy_body_fat != null ? Number(row.navy_body_fat) : null,
    imported_from: row.imported_from != null ? String(row.imported_from) : null,
  };
}

/**
 * Concrete SQLite implementation of IBodyMetricsRepository using expo-sqlite.
 */
export class SQLiteBodyMetricsRepository implements IBodyMetricsRepository {
  constructor(private readonly db: ISQLiteDatabase) {}

  async getAll(): Promise<BodyMetric[]> {
    const rows = await this.db.getAllAsync<BodyMetricRow>(
      'SELECT * FROM body_metrics ORDER BY date ASC;'
    );
    return rows.map(mapRowToBodyMetric);
  }

  async getById(id: string): Promise<BodyMetric | null> {
    const row = await this.db.getFirstAsync<BodyMetricRow>(
      'SELECT * FROM body_metrics WHERE id = ?;',
      id
    );
    return row ? mapRowToBodyMetric(row) : null;
  }

  async getByDate(date: string): Promise<BodyMetric | null> {
    const row = await this.db.getFirstAsync<BodyMetricRow>(
      'SELECT * FROM body_metrics WHERE date = ? ORDER BY id DESC LIMIT 1;',
      date
    );
    return row ? mapRowToBodyMetric(row) : null;
  }

  async getLatest(): Promise<BodyMetric | null> {
    const row = await this.db.getFirstAsync<BodyMetricRow>(
      'SELECT * FROM body_metrics ORDER BY date DESC, id DESC LIMIT 1;'
    );
    return row ? mapRowToBodyMetric(row) : null;
  }

  async getByDateRange(
    startDate: string,
    endDate: string
  ): Promise<BodyMetric[]> {
    const rows = await this.db.getAllAsync<BodyMetricRow>(
      'SELECT * FROM body_metrics WHERE date >= ? AND date <= ? ORDER BY date ASC;',
      startDate,
      endDate
    );
    return rows.map(mapRowToBodyMetric);
  }

  async save(
    metric: BodyMetric,
    profileOverride?: BodyMetricProfileContext
  ): Promise<BodyMetric> {
    const toSave: BodyMetric = { ...metric };

    // Automatically calculate U.S. Navy body fat if not explicitly provided (using LOCF for missing circumferences)
    if (
      toSave.navy_body_fat == null &&
      (toSave.waist_cm != null || toSave.neck_cm != null)
    ) {
      let waistCm = toSave.waist_cm;
      let neckCm = toSave.neck_cm;
      let hipCm = toSave.hip_cm;

      if (waistCm == null) {
        const row = await this.db.getFirstAsync<{ waist_cm: number }>(
          'SELECT waist_cm FROM body_metrics WHERE waist_cm IS NOT NULL AND date <= ? ORDER BY date DESC, id DESC LIMIT 1;',
          toSave.date
        );
        waistCm = row ? Number(row.waist_cm) : null;
      }
      if (neckCm == null) {
        const row = await this.db.getFirstAsync<{ neck_cm: number }>(
          'SELECT neck_cm FROM body_metrics WHERE neck_cm IS NOT NULL AND date <= ? ORDER BY date DESC, id DESC LIMIT 1;',
          toSave.date
        );
        neckCm = row ? Number(row.neck_cm) : null;
      }
      if (hipCm == null) {
        const row = await this.db.getFirstAsync<{ hip_cm: number }>(
          'SELECT hip_cm FROM body_metrics WHERE hip_cm IS NOT NULL AND date <= ? ORDER BY date DESC, id DESC LIMIT 1;',
          toSave.date
        );
        hipCm = row ? Number(row.hip_cm) : null;
      }

      if (waistCm != null && neckCm != null) {
        let gender: Gender | undefined = profileOverride?.gender;
        let heightCm: number | null | undefined = profileOverride?.height_cm;

        // Query active user profile if biological metrics are not passed explicitly
        if (!gender || heightCm == null) {
          const profileRow = await this.db.getFirstAsync<UserProfileSubsetRow>(
            'SELECT gender, height_cm FROM user_profiles ORDER BY updated_at DESC LIMIT 1;'
          );
          if (profileRow) {
            gender = gender ?? profileRow.gender;
            heightCm = heightCm ?? profileRow.height_cm;
          }
        }

        if (gender && heightCm != null && heightCm > 0) {
          const computed = calculateNavyBodyFat({
            gender,
            heightCm: Number(heightCm),
            waistCm,
            neckCm,
            hipCm,
          });

          if (computed != null) {
            toSave.navy_body_fat = computed;
          }
        }
      }
    }

    await this.db.runAsync(
      `INSERT OR REPLACE INTO body_metrics (
         id, date, bodyweight, body_fat_manual, waist_cm, neck_cm,
         hip_cm, bicep_cm, chest_cm, thigh_cm, calf_cm, navy_body_fat, imported_from
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      toSave.id,
      toSave.date,
      toSave.bodyweight != null && toSave.bodyweight > 0 ? toSave.bodyweight : 0,
      toSave.body_fat_manual ?? null,
      toSave.waist_cm ?? null,
      toSave.neck_cm ?? null,
      toSave.hip_cm ?? null,
      toSave.bicep_cm ?? null,
      toSave.chest_cm ?? null,
      toSave.thigh_cm ?? null,
      toSave.calf_cm ?? null,
      toSave.navy_body_fat ?? null,
      toSave.imported_from ?? null
    );

    return { ...toSave };
  }

  async delete(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM body_metrics WHERE id = ?;', id);
  }

  async count(): Promise<number> {
    const row = await this.db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM body_metrics;'
    );
    return row?.count ?? 0;
  }
}
