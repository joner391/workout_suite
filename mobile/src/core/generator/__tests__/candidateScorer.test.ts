import { computeCandidateScore, CandidateScoringContext } from '../candidateScorer';
import { Exercise, ExercisePreference } from '../../types';

describe('Candidate Exercise Scorer & Joint-ROM Protection Router (Step 9.3)', () => {
  const baseExercise: Exercise = {
    id: 'test_bench_press',
    name: 'Test Bench Press',
    muscle_group: 'Chest',
    category: 'Barbell',
    is_compound: true,
    is_bodyweight: false,
    is_unilateral: false,
    load_mode: 'total',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 20.0,
    is_custom: false,
    parent_exercise_id: null,
    standard_lift_type: 'bench',
    default_rest_seconds: 180,
    axial_loading: 'none',
    rom_tier: 'standard_full',
    baseline_sfr: 80,
    primary_joints: ['shoulder', 'elbow'],
    secondary_joints: ['wrist'],
    muscle_biases: ['mid_sternal'],
  };

  describe('1. Baseline SFR Scoring', () => {
    it('uses baseline_sfr when present, defaulting to 50 if missing', () => {
      const resultWithSfr = computeCandidateScore({ ...baseExercise, baseline_sfr: 75 });
      expect(resultWithSfr.baselineSfr).toBe(75);
      expect(resultWithSfr.score).toBe(75);

      const resultDefault = computeCandidateScore({ ...baseExercise, baseline_sfr: undefined });
      expect(resultDefault.baselineSfr).toBe(50);
      expect(resultDefault.score).toBe(50);
    });

    it('clamps baseline_sfr between 0 and 100', () => {
      const resultHigh = computeCandidateScore({ ...baseExercise, baseline_sfr: 120 });
      expect(resultHigh.baselineSfr).toBe(100);

      const resultLow = computeCandidateScore({ ...baseExercise, baseline_sfr: -20 });
      expect(resultLow.baselineSfr).toBe(0);
    });
  });

  describe('2. Sentiment Affinity & Hard Blacklist Exclusion', () => {
    it('awards +25 affinity bonus for liked exercises', () => {
      const pref: ExercisePreference = {
        exercise_id: baseExercise.id,
        sentiment: 'liked',
        swap_in_count: 0,
        swap_out_count: 0,
        affinity_score: 25.0,
        updated_at: new Date().toISOString(),
      };

      const result = computeCandidateScore(baseExercise, { preference: pref });
      expect(result.affinityBonus).toBe(25.0);
      expect(result.score).toBe(baseExercise.baseline_sfr! + 25.0);
      expect(result.isExcluded).toBe(false);
    });

    it('penalizes disliked exercises by -60 points', () => {
      const pref: ExercisePreference = {
        exercise_id: baseExercise.id,
        sentiment: 'disliked',
        swap_in_count: 0,
        swap_out_count: 0,
        affinity_score: -60.0,
        updated_at: new Date().toISOString(),
      };

      const result = computeCandidateScore(baseExercise, { preference: pref });
      expect(result.affinityBonus).toBe(-60.0);
      expect(result.score).toBe(baseExercise.baseline_sfr! - 60.0);
      expect(result.isExcluded).toBe(false);
    });

    it('completely excludes blacklisted exercises (-Infinity / isExcluded = true)', () => {
      const pref: ExercisePreference = {
        exercise_id: baseExercise.id,
        sentiment: 'blacklisted',
        swap_in_count: 0,
        swap_out_count: 0,
        affinity_score: -999.0,
        updated_at: new Date().toISOString(),
      };

      const result = computeCandidateScore(baseExercise, { preference: pref });
      expect(result.isExcluded).toBe(true);
      expect(result.score).toBe(-Infinity);
    });
  });

  describe('3. Axial Fatigue & Caloric Deficit Penalties', () => {
    const highAxialExercise: Exercise = {
      ...baseExercise,
      id: 'barbell_squat',
      name: 'Back Squat',
      axial_loading: 'high',
      baseline_sfr: 75,
    };

    it('applies -30 AxialPenalty when axial_loading is high and user has caloric deficit flag', () => {
      const resultDeficit = computeCandidateScore(highAxialExercise, { isCaloricDeficit: true });
      expect(resultDeficit.axialPenalty).toBe(30);
      expect(resultDeficit.score).toBe(75 - 30);
    });

    it('applies -30 AxialPenalty when user secondary_goals contains cutting/deficit keywords', () => {
      const resultKeywords = computeCandidateScore(highAxialExercise, {
        secondaryGoals: ['cutting', 'fat_loss'],
      });
      expect(resultKeywords.axialPenalty).toBe(30);
      expect(resultKeywords.score).toBe(75 - 30);
    });

    it('applies -30 AxialPenalty when user has axial fatigue sensitivity flag or secondary goal', () => {
      const resultSensitivity = computeCandidateScore(highAxialExercise, {
        hasAxialFatigueSensitivity: true,
      });
      expect(resultSensitivity.axialPenalty).toBe(30);
      expect(resultSensitivity.score).toBe(75 - 30);

      const resultGoal = computeCandidateScore(highAxialExercise, {
        secondaryGoals: ['axial_fatigue_sensitive'],
      });
      expect(resultGoal.axialPenalty).toBe(30);
    });

    it('does NOT apply AxialPenalty if axial_loading is moderate or low', () => {
      const modAxialExercise: Exercise = {
        ...baseExercise,
        axial_loading: 'moderate',
        baseline_sfr: 75,
      };
      const result = computeCandidateScore(modAxialExercise, { isCaloricDeficit: true });
      expect(result.axialPenalty).toBe(0);
      expect(result.score).toBe(75);
    });
  });

  describe('4. Pain Penalty & Joint-ROM Protection Router', () => {
    const deepStretchChest: Exercise = {
      ...baseExercise,
      id: 'db_fly',
      name: 'Dumbbell Chest Fly',
      rom_tier: 'deep_stretch',
      baseline_sfr: 85,
      primary_joints: ['shoulder'],
    };

    const shortenedChest: Exercise = {
      ...baseExercise,
      id: 'cable_pressdown',
      name: 'Cable Chest Press (Partial/Lockout)',
      rom_tier: 'shortened_restricted',
      baseline_sfr: 90,
      primary_joints: ['shoulder', 'elbow'],
    };

    const standardChest: Exercise = {
      ...baseExercise,
      id: 'standard_bench',
      name: 'Standard Barbell Bench',
      rom_tier: 'standard_full',
      baseline_sfr: 75,
      primary_joints: ['shoulder', 'elbow'],
    };

    it('applies -60 PainPenalty when candidate loads a painful joint (severity >= 3)', () => {
      const result = computeCandidateScore(standardChest, {
        painfulJoint: 'shoulder',
        painSeverity: 4,
      });

      expect(result.painPenalty).toBe(60);
      expect(result.hasPainCollision).toBe(true);
    });

    it('does NOT apply PainPenalty when exercise does not load the painful joint', () => {
      const legCurl: Exercise = {
        ...baseExercise,
        id: 'machine_leg_curl',
        primary_joints: ['knee'],
        baseline_sfr: 90,
      };

      const result = computeCandidateScore(legCurl, {
        painfulJoint: 'shoulder',
        painSeverity: 4,
      });

      expect(result.painPenalty).toBe(0);
      expect(result.hasPainCollision).toBe(false);
      expect(result.score).toBe(90);
    });

    it('penalizes deep_stretch exercises loading an injured joint by an additional -80 points', () => {
      // db_fly: baseline 85, pain -60, deep_stretch romMismatch -80 => 85 - 60 - 80 = -55
      const result = computeCandidateScore(deepStretchChest, {
        painfulJoint: 'shoulder',
        painSeverity: 3,
      });

      expect(result.painPenalty).toBe(60);
      expect(result.romMismatchPenalty).toBe(80);
      expect(result.score).toBe(85 - 60 - 80);
    });

    it('elevates shortened_restricted exercises (+20 bonus) when loading an injured joint', () => {
      // cable_pressdown: baseline 90, pain -60, shortened_restricted elevation (-(-20)) => 90 - 60 + 20 = 50
      const result = computeCandidateScore(shortenedChest, {
        painfulJoint: 'shoulder',
        painSeverity: 3,
      });

      expect(result.painPenalty).toBe(60);
      expect(result.romMismatchPenalty).toBe(-20);
      expect(result.score).toBe(90 - 60 - (-20));
    });

    it('elevates standard_full exercises (+10 bonus) when loading an injured joint', () => {
      // standardChest: baseline 75, pain -60, standard_full elevation (-(-10)) => 75 - 60 + 10 = 25
      const result = computeCandidateScore(standardChest, {
        painfulJoint: 'shoulder',
        painSeverity: 3,
      });

      expect(result.painPenalty).toBe(60);
      expect(result.romMismatchPenalty).toBe(-10);
      expect(result.score).toBe(75 - 60 - (-10));
    });

    it('ignores pain reports older than 28 days', () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const result = computeCandidateScore(deepStretchChest, {
        painfulJoints: [{ joint: 'shoulder', severity: 4, reportedAt: thirtyDaysAgo }],
      });

      expect(result.painPenalty).toBe(0);
      expect(result.romMismatchPenalty).toBe(0);
      expect(result.score).toBe(85);
    });
  });

  describe('5. Complete Integrated CandidateScore Formula', () => {
    it('evaluates: CandidateScore = BaselineSFR + AffinityBonus - AxialPenalty - PainPenalty - ROMMismatchPenalty', () => {
      const exercise: Exercise = {
        ...baseExercise,
        baseline_sfr: 80,
        axial_loading: 'high',
        rom_tier: 'deep_stretch',
        primary_joints: ['lower_back', 'hip'],
      };

      const pref: ExercisePreference = {
        exercise_id: exercise.id,
        sentiment: 'liked',
        swap_in_count: 2,
        swap_out_count: 0,
        affinity_score: 25,
        updated_at: new Date().toISOString(),
      };

      const context: CandidateScoringContext = {
        preference: pref,
        isCaloricDeficit: true, // triggers axial penalty = 30
        painfulJoint: 'lower_back',
        painSeverity: 4, // triggers pain penalty = 60, and deep_stretch ROM penalty = 80
      };

      const result = computeCandidateScore(exercise, context);
      // Expected = 80 + 25 - 30 - 60 - 80 = -65
      expect(result.score).toBe(-65);
      expect(result.baselineSfr).toBe(80);
      expect(result.affinityBonus).toBe(25);
      expect(result.axialPenalty).toBe(30);
      expect(result.painPenalty).toBe(60);
      expect(result.romMismatchPenalty).toBe(80);
    });
  });
});
