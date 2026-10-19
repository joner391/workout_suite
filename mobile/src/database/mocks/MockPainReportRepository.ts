import { PainReport } from '../../core/types';
import {
  CreatePainReportInput,
  IPainReportRepository,
} from '../../domain/repositories/IPainReportRepository';

/**
 * In-memory mock implementation of IPainReportRepository for headless unit testing.
 */
export class MockPainReportRepository implements IPainReportRepository {
  public reports: Map<string, PainReport> = new Map();

  constructor(initialReports: PainReport[] = []) {
    for (const r of initialReports) {
      this.reports.set(r.id, { ...r });
    }
  }

  public clear(): void {
    this.reports.clear();
  }

  async create(input: CreatePainReportInput): Promise<PainReport> {
    const id = `pain_mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const createdAt = new Date().toISOString();
    const report: PainReport = {
      id,
      workout_id: input.workout_id,
      exercise_id: input.exercise_id,
      set_id: input.set_id ?? null,
      pain_type: input.pain_type,
      severity: input.severity,
      joint_location: input.joint_location ?? null,
      notes: input.notes ?? null,
      created_at: createdAt,
    };
    this.reports.set(id, report);
    return { ...report };
  }

  async getById(id: string): Promise<PainReport | null> {
    const r = this.reports.get(id);
    return r ? { ...r } : null;
  }

  async getByWorkoutId(workoutId: string): Promise<PainReport[]> {
    return Array.from(this.reports.values())
      .filter((r) => r.workout_id === workoutId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async getByExerciseId(exerciseId: string): Promise<PainReport[]> {
    return Array.from(this.reports.values())
      .filter((r) => r.exercise_id === exerciseId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getAll(): Promise<PainReport[]> {
    return Array.from(this.reports.values()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
  }

  async delete(id: string): Promise<void> {
    this.reports.delete(id);
  }

  async count(): Promise<number> {
    return this.reports.size;
  }
}
