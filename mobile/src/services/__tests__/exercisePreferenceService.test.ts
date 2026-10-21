import {
  ExercisePreferenceService,
  calculateAffinityScore,
} from '../exercisePreferenceService';
import { MockExercisePreferenceRepository } from '../../database/mocks/MockExercisePreferenceRepository';
import { ExercisePreference } from '../../core/types';

describe('ExercisePreferenceService', () => {
  let repo: MockExercisePreferenceRepository;
  let service: ExercisePreferenceService;

  beforeEach(() => {
    repo = new MockExercisePreferenceRepository();
    service = new ExercisePreferenceService(repo);
  });

  describe('calculateAffinityScore (pure function)', () => {
    it('returns +25.0 for liked sentiment regardless of swap counts', () => {
      expect(
        calculateAffinityScore({
          sentiment: 'liked',
          swap_in_count: 0,
          swap_out_count: 10,
        })
      ).toBe(25.0);

      expect(
        calculateAffinityScore({
          sentiment: 'liked',
          swap_in_count: 5,
          swap_out_count: 0,
        })
      ).toBe(25.0);
    });

    it('returns -60.0 for disliked sentiment regardless of swap counts', () => {
      expect(
        calculateAffinityScore({
          sentiment: 'disliked',
          swap_in_count: 10,
          swap_out_count: 0,
        })
      ).toBe(-60.0);
    });

    it('returns -999.0 for blacklisted sentiment regardless of swap counts', () => {
      expect(
        calculateAffinityScore({
          sentiment: 'blacklisted',
          swap_in_count: 10,
          swap_out_count: 0,
        })
      ).toBe(-999.0);
    });

    it('calculates clamped linear soft affinity for neutral sentiment', () => {
      // 0 in, 0 out => 0.0
      expect(
        calculateAffinityScore({
          sentiment: 'neutral',
          swap_in_count: 0,
          swap_out_count: 0,
        })
      ).toBe(0.0);

      // 1 in, 0 out => +5.0
      expect(
        calculateAffinityScore({
          sentiment: 'neutral',
          swap_in_count: 1,
          swap_out_count: 0,
        })
      ).toBe(5.0);

      // 3 in, 1 out => +10.0
      expect(
        calculateAffinityScore({
          sentiment: 'neutral',
          swap_in_count: 3,
          swap_out_count: 1,
        })
      ).toBe(10.0);

      // 5 in, 0 out => clamped at +20.0
      expect(
        calculateAffinityScore({
          sentiment: 'neutral',
          swap_in_count: 5,
          swap_out_count: 0,
        })
      ).toBe(20.0);

      // 0 in, 1 out => -5.0
      expect(
        calculateAffinityScore({
          sentiment: 'neutral',
          swap_in_count: 0,
          swap_out_count: 1,
        })
      ).toBe(-5.0);

      // 0 in, 6 out => clamped at -20.0
      expect(
        calculateAffinityScore({
          sentiment: 'neutral',
          swap_in_count: 0,
          swap_out_count: 6,
        })
      ).toBe(-20.0);
    });
  });

  describe('ExercisePreferenceService methods', () => {
    it('returns transient default neutral preference when record does not exist', async () => {
      const pref = await service.getPreference('barbell_bench_press');
      expect(pref.exercise_id).toBe('barbell_bench_press');
      expect(pref.sentiment).toBe('neutral');
      expect(pref.swap_in_count).toBe(0);
      expect(pref.swap_out_count).toBe(0);
      expect(pref.affinity_score).toBe(0.0);
      expect(pref.last_pain_reported_at).toBeNull();
      expect(pref.max_pain_severity).toBeNull();
      expect(pref.pain_joint).toBeNull();
      expect(pref.updated_at).toBeDefined();
    });

    it('sets explicit sentiment and updates affinity score in repository', async () => {
      const updated = await service.setSentiment('barbell_squat', 'liked');
      expect(updated.exercise_id).toBe('barbell_squat');
      expect(updated.sentiment).toBe('liked');
      expect(updated.affinity_score).toBe(25.0);

      const retrieved = await service.getPreference('barbell_squat');
      expect(retrieved.sentiment).toBe('liked');
      expect(retrieved.affinity_score).toBe(25.0);

      const blacklisted = await service.setSentiment('barbell_squat', 'blacklisted');
      expect(blacklisted.sentiment).toBe('blacklisted');
      expect(blacklisted.affinity_score).toBe(-999.0);
      expect(await service.isBlacklisted('barbell_squat')).toBe(true);
    });

    it('records manual swaps, incrementing in/out counters and updating soft affinity', async () => {
      // Trainee swaps out Barbell Squat for Hack Squat
      const result1 = await service.recordManualSwap('barbell_squat', 'hack_squat');
      expect(result1.swappedOut.exercise_id).toBe('barbell_squat');
      expect(result1.swappedOut.swap_out_count).toBe(1);
      expect(result1.swappedOut.swap_in_count).toBe(0);
      expect(result1.swappedOut.affinity_score).toBe(-5.0);

      expect(result1.swappedIn.exercise_id).toBe('hack_squat');
      expect(result1.swappedIn.swap_in_count).toBe(1);
      expect(result1.swappedIn.swap_out_count).toBe(0);
      expect(result1.swappedIn.affinity_score).toBe(5.0);

      // Repeat swap 3 more times for Hack Squat
      await service.recordManualSwap('leg_press', 'hack_squat');
      await service.recordManualSwap('smith_squat', 'hack_squat');
      const result4 = await service.recordManualSwap('front_squat', 'hack_squat');

      expect(result4.swappedIn.swap_in_count).toBe(4);
      expect(result4.swappedIn.affinity_score).toBe(20.0); // Clamped at +20.0

      expect(await service.getAffinityScore('hack_squat')).toBe(20.0);
      expect(await service.getAffinityScore('barbell_squat')).toBe(-5.0);
    });

    it('correlates pain reports with exercise preferences and updates max severity monotonically', async () => {
      const report1 = await service.correlatePainReport(
        'w_1',
        'barbell_bench_press',
        'shoulder',
        3
      );
      expect(report1.exercise_id).toBe('barbell_bench_press');
      expect(report1.pain_joint).toBe('shoulder');
      expect(report1.max_pain_severity).toBe(3);
      expect(report1.last_pain_reported_at).toBeDefined();

      // Lower severity report does not reduce max_pain_severity
      const report2 = await service.correlatePainReport(
        'w_2',
        'barbell_bench_press',
        'shoulder',
        2
      );
      expect(report2.max_pain_severity).toBe(3);

      // Higher severity report elevates max_pain_severity
      const report3 = await service.correlatePainReport(
        'w_3',
        'barbell_bench_press',
        'shoulder',
        6
      );
      expect(report3.max_pain_severity).toBe(6);
    });

    it('retrieves all customized preferences', async () => {
      await service.setSentiment('barbell_bench_press', 'liked');
      await service.setSentiment('conventional_deadlift', 'disliked');
      await service.recordManualSwap('cable_crossover', 'dumbbell_fly');

      const all = await service.getAllPreferences();
      expect(all.length).toBe(4);
      expect(all.map((p) => p.exercise_id).sort()).toEqual([
        'barbell_bench_press',
        'cable_crossover',
        'conventional_deadlift',
        'dumbbell_fly',
      ]);
    });
  });
});
