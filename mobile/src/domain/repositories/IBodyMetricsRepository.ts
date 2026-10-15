import { BodyMetric, Gender } from '../../core/types';

/**
 * Optional user context override passed during metric persistence.
 */
export interface BodyMetricProfileContext {
  gender?: Gender;
  height_cm?: number | null;
}

/**
 * Repository interface for anthropometry, body composition, and bodyweight tracking.
 */
export interface IBodyMetricsRepository {
  /**
   * Retrieves all logged body metrics, sorted chronologically ascending.
   */
  getAll(): Promise<BodyMetric[]>;

  /**
   * Retrieves a metric by its unique identifier.
   */
  getById(id: string): Promise<BodyMetric | null>;

  /**
   * Retrieves the metric logged for a specific ISO date (YYYY-MM-DD).
   */
  getByDate(date: string): Promise<BodyMetric | null>;

  /**
   * Retrieves the most recently logged metric.
   */
  getLatest(): Promise<BodyMetric | null>;

  /**
   * Retrieves metrics within an inclusive ISO date range (YYYY-MM-DD).
   */
  getByDateRange(startDate: string, endDate: string): Promise<BodyMetric[]>;

  /**
   * Saves (inserts or updates) a body metric.
   * If navy_body_fat is not provided, computes it automatically when
   * necessary circumference metrics and height/gender are available
   * (either from profileOverride or from the active user profile).
   */
  save(
    metric: BodyMetric,
    profileOverride?: BodyMetricProfileContext
  ): Promise<BodyMetric>;

  /**
   * Deletes a body metric by its ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Returns the total count of logged body metric records.
   */
  count(): Promise<number>;
}
