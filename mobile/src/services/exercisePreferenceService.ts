import { ExercisePreference, ExerciseSentiment, JointLocation } from '../core/types';
import { IExercisePreferenceRepository } from '../domain/repositories/IExercisePreferenceRepository';

/**
 * Computes soft affinity score according to ADR-096 specification:
 * - 'liked'       => +25.0
 * - 'disliked'    => -60.0
 * - 'blacklisted' => -999.0
 * - 'neutral'     => clamp((swap_in_count - swap_out_count) * 5.0, -20.0, 20.0)
 */
export function calculateAffinityScore(preference: {
  sentiment: ExerciseSentiment;
  swap_in_count: number;
  swap_out_count: number;
}): number {
  switch (preference.sentiment) {
    case 'liked':
      return 25.0;
    case 'disliked':
      return -60.0;
    case 'blacklisted':
      return -999.0;
    case 'neutral':
    default: {
      const delta = (preference.swap_in_count - preference.swap_out_count) * 5.0;
      return Math.min(20.0, Math.max(-20.0, delta));
    }
  }
}

/**
 * Application service managing athlete exercise sentiment, in-gym swap counts,
 * dynamic soft affinity scoring, and pain report correlations.
 */
export class ExercisePreferenceService {
  constructor(private readonly preferenceRepo: IExercisePreferenceRepository) {}

  /**
   * Retrieves an existing exercise preference or returns a default neutral record.
   */
  public async getPreference(exerciseId: string): Promise<ExercisePreference> {
    const existing = await this.preferenceRepo.get(exerciseId);
    if (existing) {
      return existing;
    }
    return {
      exercise_id: exerciseId,
      sentiment: 'neutral',
      swap_in_count: 0,
      swap_out_count: 0,
      affinity_score: 0.0,
      last_pain_reported_at: null,
      max_pain_severity: null,
      pain_joint: null,
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Retrieves all customized exercise preferences.
   */
  public async getAllPreferences(): Promise<ExercisePreference[]> {
    return this.preferenceRepo.getAll();
  }

  /**
   * Sets explicit user sentiment for an exercise ('liked', 'neutral', 'disliked', 'blacklisted')
   * and immediately recalculates the affinity score.
   */
  public async setSentiment(
    exerciseId: string,
    sentiment: ExerciseSentiment
  ): Promise<ExercisePreference> {
    const current = await this.getPreference(exerciseId);
    const updated: ExercisePreference = {
      ...current,
      sentiment,
      affinity_score: calculateAffinityScore({
        sentiment,
        swap_in_count: current.swap_in_count,
        swap_out_count: current.swap_out_count,
      }),
      updated_at: new Date().toISOString(),
    };

    await this.preferenceRepo.save(updated);
    return updated;
  }

  /**
   * Records a manual exercise substitution event in the active logger.
   * Increments `swap_out_count` for the discarded exercise and `swap_in_count` for the chosen substitute,
   * adjusting their neutral affinity scores (+5.0 / -5.0 clamped between [-20.0, +20.0]).
   */
  public async recordManualSwap(
    swappedOutExerciseId: string,
    swappedInExerciseId: string
  ): Promise<{ swappedOut: ExercisePreference; swappedIn: ExercisePreference }> {
    const now = new Date().toISOString();

    // 1. Update swapped out (discarded) exercise
    const discarded = await this.getPreference(swappedOutExerciseId);
    const updatedDiscarded: ExercisePreference = {
      ...discarded,
      swap_out_count: discarded.swap_out_count + 1,
      affinity_score: calculateAffinityScore({
        sentiment: discarded.sentiment,
        swap_in_count: discarded.swap_in_count,
        swap_out_count: discarded.swap_out_count + 1,
      }),
      updated_at: now,
    };
    await this.preferenceRepo.save(updatedDiscarded);

    // 2. Update swapped in (chosen) substitute
    const chosen = await this.getPreference(swappedInExerciseId);
    const updatedChosen: ExercisePreference = {
      ...chosen,
      swap_in_count: chosen.swap_in_count + 1,
      affinity_score: calculateAffinityScore({
        sentiment: chosen.sentiment,
        swap_in_count: chosen.swap_in_count + 1,
        swap_out_count: chosen.swap_out_count,
      }),
      updated_at: now,
    };
    await this.preferenceRepo.save(updatedChosen);

    return {
      swappedOut: updatedDiscarded,
      swappedIn: updatedChosen,
    };
  }

  /**
   * Correlates an in-gym or post-workout pain report with the exercise preference record,
   * logging the joint location, highest pain severity, and last reported date.
   */
  public async correlatePainReport(
    workoutId: string,
    exerciseId: string,
    joint?: JointLocation | string | null,
    severity?: number
  ): Promise<ExercisePreference> {
    const current = await this.getPreference(exerciseId);
    const now = new Date().toISOString();

    const maxSeverity = Math.max(
      current.max_pain_severity ?? 0,
      severity != null ? Math.round(severity) : 0
    );

    const updated: ExercisePreference = {
      ...current,
      last_pain_reported_at: now,
      max_pain_severity: maxSeverity > 0 ? maxSeverity : current.max_pain_severity,
      pain_joint: joint ?? current.pain_joint ?? null,
      updated_at: now,
    };

    await this.preferenceRepo.save(updated);
    return updated;
  }

  /**
   * Checks whether an exercise is completely blacklisted by the athlete.
   */
  public async isBlacklisted(exerciseId: string): Promise<boolean> {
    const pref = await this.getPreference(exerciseId);
    return pref.sentiment === 'blacklisted';
  }

  /**
   * Returns current effective affinity score for an exercise.
   */
  public async getAffinityScore(exerciseId: string): Promise<number> {
    const pref = await this.getPreference(exerciseId);
    return pref.affinity_score;
  }
}
