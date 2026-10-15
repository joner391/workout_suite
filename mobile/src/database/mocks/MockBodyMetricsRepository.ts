import {
  IBodyMetricsRepository,
  BodyMetricProfileContext,
} from '../../domain/repositories/IBodyMetricsRepository';
import { IUserProfileRepository } from '../../domain/repositories/IUserProfileRepository';
import { BodyMetric, Gender } from '../../core/types';
import { calculateNavyBodyFat } from '../../core/math/navyBodyFat';

/**
 * In-memory mock implementation of IBodyMetricsRepository for headless testing.
 */
export class MockBodyMetricsRepository implements IBodyMetricsRepository {
  public metrics: Map<string, BodyMetric> = new Map();

  constructor(
    initialMetrics: BodyMetric[] = [],
    private userProfileRepo?: IUserProfileRepository
  ) {
    for (const m of initialMetrics) {
      this.metrics.set(m.id, { ...m });
    }
  }

  public setUserProfileRepository(repo: IUserProfileRepository): void {
    this.userProfileRepo = repo;
  }

  public clear(): void {
    this.metrics.clear();
  }

  async getAll(): Promise<BodyMetric[]> {
    return Array.from(this.metrics.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }

  async getById(id: string): Promise<BodyMetric | null> {
    const item = this.metrics.get(id);
    return item ? { ...item } : null;
  }

  async getByDate(date: string): Promise<BodyMetric | null> {
    const matches = Array.from(this.metrics.values()).filter(
      (m) => m.date === date
    );
    if (matches.length === 0) return null;
    return { ...matches[matches.length - 1] };
  }

  async getLatest(): Promise<BodyMetric | null> {
    const list = Array.from(this.metrics.values()).sort((a, b) =>
      b.date.localeCompare(a.date)
    );
    return list.length > 0 ? { ...list[0] } : null;
  }

  async getByDateRange(
    startDate: string,
    endDate: string
  ): Promise<BodyMetric[]> {
    return Array.from(this.metrics.values())
      .filter((m) => m.date >= startDate && m.date <= endDate)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async save(
    metric: BodyMetric,
    profileOverride?: BodyMetricProfileContext
  ): Promise<BodyMetric> {
    const toSave: BodyMetric = { ...metric };

    if (toSave.navy_body_fat == null && toSave.waist_cm != null && toSave.neck_cm != null) {
      let gender: Gender | undefined = profileOverride?.gender;
      let heightCm: number | null | undefined = profileOverride?.height_cm;

      if ((!gender || heightCm == null) && this.userProfileRepo) {
        const profile = await this.userProfileRepo.getProfile();
        if (profile) {
          gender = gender ?? profile.gender;
          heightCm = heightCm ?? profile.height_cm;
        }
      }

      if (gender && heightCm != null && heightCm > 0) {
        const computed = calculateNavyBodyFat({
          gender,
          heightCm,
          waistCm: toSave.waist_cm,
          neckCm: toSave.neck_cm,
          hipCm: toSave.hip_cm,
        });

        if (computed != null) {
          toSave.navy_body_fat = computed;
        }
      }
    }

    this.metrics.set(toSave.id, { ...toSave });
    return { ...toSave };
  }

  async delete(id: string): Promise<void> {
    this.metrics.delete(id);
  }

  async count(): Promise<number> {
    return this.metrics.size;
  }
}
