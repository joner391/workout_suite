import { PainReport, PainType, JointLocation } from '../../core/types';

export interface CreatePainReportInput {
  workout_id: string;
  exercise_id: string;
  set_id?: string | null;
  pain_type: PainType;
  severity: number; // 1 to 10
  joint_location?: JointLocation | null;
  notes?: string | null;
}

/**
 * Repository interface for in-gym pain and discomfort reports.
 */
export interface IPainReportRepository {
  /**
   * Records a new pain report.
   */
  create(input: CreatePainReportInput): Promise<PainReport>;

  /**
   * Retrieves a pain report by its unique identifier.
   */
  getById(id: string): Promise<PainReport | null>;

  /**
   * Retrieves all pain reports recorded during a specific workout session.
   */
  getByWorkoutId(workoutId: string): Promise<PainReport[]>;

  /**
   * Retrieves all pain reports associated with a specific exercise.
   */
  getByExerciseId(exerciseId: string): Promise<PainReport[]>;

  /**
   * Retrieves all pain reports sorted chronologically descending.
   */
  getAll(): Promise<PainReport[]>;

  /**
   * Deletes a pain report by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Returns total count of recorded pain reports.
   */
  count(): Promise<number>;
}
