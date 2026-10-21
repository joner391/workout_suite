/**
 * Workout Suite — Mesocycle Diff Formatter Unit Tests
 *
 * Implements verification for Section 4 of THEORY_INTEGRATION_AND_MESOCYCLE_ARCHITECTURE.md:
 * Deterministic Offline Mesocycle Explanation Templates (Zero LLM Dependency).
 */

import {
  MESOCYCLE_DIFF_TEMPLATES,
  formatMesocycleDiffMarkdown,
  formatDiffSummaryBadge,
  summarizeMesocycleChanges,
  diffProgramSnapshots,
  buildDiffFromAudits,
  MesocycleDiffItem,
  ProgramSnapshot,
} from '../mesocycleDiffFormatter';
import { Exercise, TemplateExercise, WorkoutTemplate, ProgramAuditPayload } from '../../core/types';

describe('Mesocycle Diff Formatter (Step 3)', () => {
  const mockExercises: Exercise[] = [
    {
      id: 'ex-squat',
      name: 'Barbell Back Squat',
      muscle_group: 'Quads',
      category: 'Barbell',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 20.0,
      is_custom: false,
      parent_exercise_id: null,
      standard_lift_type: 'squat',
      default_rest_seconds: 180,
    },
    {
      id: 'ex-hack-squat',
      name: 'Hack Squat',
      muscle_group: 'Quads',
      category: 'Machine',
      is_compound: true,
      is_bodyweight: false,
      is_unilateral: false,
      load_mode: 'total',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 0.0,
      is_custom: false,
      parent_exercise_id: null,
      standard_lift_type: null,
      default_rest_seconds: 120,
    },
    {
      id: 'ex-bench',
      name: 'Barbell Bench Press',
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
    },
    {
      id: 'ex-lat-raise',
      name: 'Lateral Raises',
      muscle_group: 'Shoulders',
      category: 'Dumbbell',
      is_compound: false,
      is_bodyweight: false,
      is_unilateral: true,
      load_mode: 'per_hand',
      default_cable_ratio: 1.0,
      default_bar_weight_kg: 0.0,
      is_custom: false,
      parent_exercise_id: null,
      standard_lift_type: null,
      default_rest_seconds: 60,
    },
  ];

  const exerciseMap = new Map<string, Exercise>(mockExercises.map((e) => [e.id, e]));

  // ==========================================================================
  // Deterministic String Template Catalog (Section 4.2)
  // ==========================================================================

  describe('MESOCYCLE_DIFF_TEMPLATES', () => {
    it('generates LOAD_INCREASE_AMRAP template item with correct interpolation', () => {
      const item = MESOCYCLE_DIFF_TEMPLATES.LOAD_INCREASE_AMRAP({
        exerciseName: 'Bench Press',
        actualReps: 14,
        targetMax: 10,
        repsOver: 4,
        pctGain: 3.1,
        oldWeightKg: 80,
        newWeightKg: 82.5,
        weekNum: 3,
      });

      expect(item.category).toBe('load');
      expect(item.title).toBe('Bench Press Load Increased (+3.1%)');
      expect(item.explanation).toBe(
        'On your Week 3 AMRAP, you completed 14 reps against your 10 rep target (4 reps over). Working load increased from 80 kg to 82.5 kg (rounded to nearest available plate).'
      );
    });

    it('generates EXERCISE_SWAP_PAIN template item with SFR and severity', () => {
      const item = MESOCYCLE_DIFF_TEMPLATES.EXERCISE_SWAP_PAIN({
        oldExerciseName: 'Barbell Back Squat',
        newExerciseName: 'Leg Press',
        painArea: 'lower back',
        painSeverity: 6,
        sfrScore: 92,
      });

      expect(item.category).toBe('exercise_swap');
      expect(item.title).toBe('Barbell Back Squat Swapped for Leg Press');
      expect(item.explanation).toBe(
        'You logged lower back discomfort (Severity: 6/10) on Barbell Back Squat. Swapped for Leg Press, providing high muscle stimulus (SFR: 92/100) with minimal joint stress.'
      );
    });

    it('generates EXERCISE_SWAP_AXIAL template item with muscle group context', () => {
      const item = MESOCYCLE_DIFF_TEMPLATES.EXERCISE_SWAP_AXIAL({
        oldExerciseName: 'Barbell Back Squat',
        newExerciseName: 'Hack Squat',
        muscleGroup: 'Quads',
      });

      expect(item.category).toBe('exercise_swap');
      expect(item.title).toBe('Barbell Back Squat Replaced with Hack Squat');
      expect(item.explanation).toBe(
        'High spinal/axial fatigue was limiting progress on Quads. Replaced with Hack Squat to preserve heavy mechanical tension without spinal compression.'
      );
    });

    it('generates CONVERT_TO_MYOREP template item with time limits and eReps yield', () => {
      const item = MESOCYCLE_DIFF_TEMPLATES.CONVERT_TO_MYOREP({
        exerciseName: 'Lateral Raises',
        sessionDurationLimitMins: 45,
        eRepsYield: 12,
      });

      expect(item.category).toBe('intensity_technique');
      expect(item.title).toBe('Lateral Raises Converted to Myo-Reps');
      expect(item.explanation).toBe(
        'To keep your workout strictly within your 45-minute limit, 3 straight sets were converted into 1 Myo-rep cluster, harvesting 12 stimulating reps in under 2 minutes.'
      );
    });

    it('generates VOLUME_ESCALATION template item for under-stimulated muscles', () => {
      const item = MESOCYCLE_DIFF_TEMPLATES.VOLUME_ESCALATION({
        muscleGroup: 'Side Delts',
        setDelta: 3,
        meanRpe: 7.2,
        newWeeklySets: 14,
      });

      expect(item.category).toBe('volume');
      expect(item.title).toBe('Side Delts Volume Increased (+3 sets/week)');
      expect(item.explanation).toBe(
        'Your Side Delts recovered easily with low fatigue (mean RPE 7.2). Added +3 sets/week (new target: 14 sets) to reach optimal growth volume.'
      );
    });

    it('generates VOLUME_PRUNING template item for over-reached muscles', () => {
      const item = MESOCYCLE_DIFF_TEMPLATES.VOLUME_PRUNING({
        muscleGroup: 'Hamstrings',
        prunePct: 20,
        newWeeklySets: 10,
      });

      expect(item.category).toBe('volume');
      expect(item.title).toBe('Hamstrings Volume Reduced (-20%)');
      expect(item.explanation).toBe(
        'Acute fatigue was causing performance drop-off on Hamstrings. Pruned volume to 10 sets/week to allow full muscular recovery between sessions.'
      );
    });

    it('generates BLOCK_LENGTH_DECISION template item with deficit and exertion style', () => {
      const item = MESOCYCLE_DIFF_TEMPLATES.BLOCK_LENGTH_DECISION({
        weeks: 4,
        peakWeek: 3,
        exertionTier: 'high',
        isDeficit: false,
      });

      expect(item.category).toBe('block_length');
      expect(item.title).toBe('Mesocycle Length Set to 4 Weeks');
      expect(item.explanation).toBe(
        'Based on your high exertion style, your strength progression peaks around Week 3 before fatigue accumulates. Scheduling a deload on Week 4 guarantees steady progress without burnout.'
      );

      const itemDeficit = MESOCYCLE_DIFF_TEMPLATES.BLOCK_LENGTH_DECISION({
        weeks: 3,
        peakWeek: 2,
        exertionTier: 'high',
        isDeficit: true,
      });
      expect(itemDeficit.explanation).toContain('and caloric deficit');
    });
  });

  // ==========================================================================
  // Markdown Output Formatting (Section 4.2 Example Output)
  // ==========================================================================

  describe('formatMesocycleDiffMarkdown & formatDiffSummaryBadge', () => {
    it('formats multiple items into the exact architecture example output in detailed mode', () => {
      const items: MesocycleDiffItem[] = [
        MESOCYCLE_DIFF_TEMPLATES.LOAD_INCREASE_AMRAP({
          exerciseName: 'Bench Press',
          actualReps: 14,
          targetMax: 10,
          repsOver: 4,
          pctGain: 3.1,
          oldWeightKg: 80,
          newWeightKg: 82.5,
          weekNum: 3,
        }),
        MESOCYCLE_DIFF_TEMPLATES.EXERCISE_SWAP_AXIAL({
          oldExerciseName: 'Barbell Back Squat',
          newExerciseName: 'Hack Squat',
          muscleGroup: 'Quads',
        }),
        MESOCYCLE_DIFF_TEMPLATES.CONVERT_TO_MYOREP({
          exerciseName: 'Lateral Raises',
          sessionDurationLimitMins: 45,
          eRepsYield: 12,
        }),
        MESOCYCLE_DIFF_TEMPLATES.BLOCK_LENGTH_DECISION({
          weeks: 4,
          peakWeek: 3,
          exertionTier: 'high',
          isDeficit: false,
        }),
      ];

      const markdown = formatMesocycleDiffMarkdown(items, 2, { mode: 'detailed' });

      expect(markdown).toContain('### 🚀 Mesocycle 2 Ready: Here’s What We Adjusted');
      expect(markdown).toContain('1. **Bench Press Load Increased (+3.1%)**:');
      expect(markdown).toContain('2. **Barbell Back Squat Replaced with Hack Squat**:');
      expect(markdown).toContain('3. **Lateral Raises Converted to Myo-Reps**:');
      expect(markdown).toContain('4. **Mesocycle Length Set to 4 Weeks**:');
      expect(markdown).toContain('rounded to nearest available plate');

      expect(formatDiffSummaryBadge(items)).toBe('4 Adjustments Staged');
    });

    it('formats concise coach-level summary bullets matching lifter expectations', () => {
      const items: MesocycleDiffItem[] = [
        MESOCYCLE_DIFF_TEMPLATES.VOLUME_ESCALATION({
          muscleGroup: 'Chest',
          setDelta: 3,
          meanRpe: 7.5,
          newWeeklySets: 15,
        }),
        {
          category: 'progression',
          title: 'Triceps Pushdown Progression Migrated to Dynamic Double Progression (DDP)',
          explanation: 'Independent per-set rep ceiling progression for accessory exercises.',
        },
        MESOCYCLE_DIFF_TEMPLATES.BLOCK_LENGTH_DECISION({
          weeks: 4,
          peakWeek: 3,
          exertionTier: 'moderate',
          isDeficit: false,
        }),
        {
          category: 'exercise_swap',
          title: 'Barbell Skull Crusher Spared via Joint-ROM Protection (Cable Tricep Pushdown)',
          explanation: 'elbow discomfort (severity 4/5) reported. Replaced with Cable Tricep Pushdown.',
        },
      ];

      const summaries = summarizeMesocycleChanges(items);
      expect(summaries).toContain('Increased your volume by 3 weekly sets');
      expect(summaries).toContain('RPE goal increased for accessory exercises');
      expect(summaries).toContain('Optimized meso-cycle length');
      expect(summaries).toContain('Changed exercises based on elbow pain');

      const markdown = formatMesocycleDiffMarkdown(items, 2); // Default is concise
      expect(markdown).toContain('### 🚀 Mesocycle 2 Ready');
      expect(markdown).toContain('• Increased your volume by 3 weekly sets');
      expect(markdown).toContain('• RPE goal increased for accessory exercises');
      expect(markdown).toContain('• Optimized meso-cycle length');
      expect(markdown).toContain('• Changed exercises based on elbow pain');
    });

    it('handles empty diff list with clean baseline fallback', () => {
      const emptyMarkdown = formatMesocycleDiffMarkdown([], 3);
      expect(emptyMarkdown).toContain('### 🚀 Mesocycle 3 Ready');
      expect(emptyMarkdown).toContain('No structural changes detected');
      expect(formatDiffSummaryBadge([])).toBe('Baseline Maintained');
    });
  });

  // ==========================================================================
  // Program Snapshot Differencing
  // ==========================================================================

  describe('diffProgramSnapshots', () => {
    it('detects exercise substitutions, myo-rep conversions, volume changes, and block length changes', () => {
      const oldTemplate: WorkoutTemplate = {
        id: 'tmpl-1',
        program_id: 'prog-1',
        name: 'Lower Day',
        notes: null,
        order_index: 0,
        created_at: '2026-10-01T00:00:00Z',
      };

      const newTemplate: WorkoutTemplate = {
        id: 'tmpl-2',
        program_id: 'prog-2',
        name: 'Lower Day',
        notes: null,
        order_index: 0,
        created_at: '2026-10-15T00:00:00Z',
      };

      const oldExercises: TemplateExercise[] = [
        {
          id: 'te-1',
          template_id: 'tmpl-1',
          exercise_id: 'ex-squat',
          gear_id: null,
          target_sets: 4,
          target_reps_min: 5,
          target_reps_max: 5,
          target_rpe: 8,
          target_rir: 2,
          order_index: 0,
          exercise_group_id: null,
          set_type: 'working',
        },
        {
          id: 'te-2',
          template_id: 'tmpl-1',
          exercise_id: 'ex-lat-raise',
          gear_id: null,
          target_sets: 3,
          target_reps_min: 12,
          target_reps_max: 15,
          target_rpe: 8.5,
          target_rir: 1.5,
          order_index: 1,
          exercise_group_id: null,
          set_type: 'working',
        },
      ];

      const newExercises: TemplateExercise[] = [
        {
          id: 'te-3',
          template_id: 'tmpl-2',
          exercise_id: 'ex-hack-squat', // Axial swap!
          gear_id: null,
          target_sets: 4,
          target_reps_min: 8,
          target_reps_max: 10,
          target_rpe: 9,
          target_rir: 1,
          order_index: 0,
          exercise_group_id: null,
          set_type: 'working',
        },
        {
          id: 'te-4',
          template_id: 'tmpl-2',
          exercise_id: 'ex-lat-raise',
          gear_id: null,
          target_sets: 1,
          target_reps_min: 12,
          target_reps_max: 15,
          target_rpe: 10,
          target_rir: 0,
          order_index: 1,
          exercise_group_id: null,
          set_type: 'myorep', // Myo-rep conversion!
        },
      ];

      const oldSnapshot: ProgramSnapshot = {
        templates: [oldTemplate],
        templateExercises: oldExercises,
        blockWeeks: 6,
      };

      const newSnapshot: ProgramSnapshot = {
        templates: [newTemplate],
        templateExercises: newExercises,
        blockWeeks: 4, // Block length shortened!
      };

      const diffs = diffProgramSnapshots({
        oldProgram: oldSnapshot,
        newProgram: newSnapshot,
        exerciseCatalog: exerciseMap,
        userTimeLimitMins: 45,
        exertionTier: 'high',
      });

      expect(diffs.length).toBeGreaterThanOrEqual(3);

      const blockDiff = diffs.find((d) => d.category === 'block_length');
      expect(blockDiff).toBeDefined();
      expect(blockDiff?.title).toBe('Mesocycle Length Set to 4 Weeks');

      const swapDiff = diffs.find((d) => d.category === 'exercise_swap');
      expect(swapDiff).toBeDefined();
      expect(swapDiff?.title).toContain('Barbell Back Squat Replaced with Hack Squat');

      const myoDiff = diffs.find((d) => d.category === 'intensity_technique');
      expect(myoDiff).toBeDefined();
      expect(myoDiff?.title).toContain('Lateral Raises Converted to Myo-Reps');
    });
  });

  // ==========================================================================
  // Audit Payload Translator
  // ==========================================================================

  describe('buildDiffFromAudits', () => {
    it('translates structured program parameter audit codes into diff items', () => {
      const audits: ProgramAuditPayload[] = [
        {
          rule_code: 'AXIAL_BOTTLENECK',
          target_id: 'ex-squat',
          message: 'High axial fatigue limiting lower body progress',
          suggested_parameter: 'substitute_exercise_id',
          suggested_value: 'ex-hack-squat',
        },
        {
          rule_code: 'JUNK_VOLUME',
          target_id: 'ex-bench',
          message: 'Volume exceeding MAV with low RPE and stagnating e10RM',
          suggested_parameter: 'prune_percent',
          suggested_value: 25,
        },
        {
          rule_code: 'VOLUME_ESCALATION',
          target_id: 'ex-lat-raise',
          message: 'Muscle recovering easily with low fatigue',
          suggested_parameter: 'add_sets',
          suggested_value: 3,
        },
        {
          rule_code: 'AMRAP_LOAD_INCREASE',
          target_id: 'ex-bench',
          message: 'AMRAP exceeded bracket ceiling',
          suggested_parameter: 'new_weight_kg',
          suggested_value: 82.5,
        },
        {
          rule_code: 'CONVERT_TO_MYOREP',
          target_id: 'ex-lat-raise',
          message: 'Time budget compression',
          suggested_parameter: 'set_type',
          suggested_value: 'myorep',
        },
        {
          rule_code: 'BLOCK_LENGTH_DECISION',
          target_id: 'systemic',
          message: 'Branching to short mesocycle due to high exertion',
          suggested_parameter: 'recommended_block_weeks',
          suggested_value: 4,
        },
        {
          rule_code: 'EXERCISE_SWAP_PAIN',
          target_id: 'ex-squat',
          message: 'Knee discomfort detected',
          suggested_parameter: 'substitute_exercise_id',
          suggested_value: 'ex-hack-squat',
        },
      ];

      const diffs = buildDiffFromAudits(audits, exerciseMap);

      expect(diffs).toHaveLength(7);
      expect(diffs[0].title).toBe('Barbell Back Squat Replaced with Hack Squat');
      expect(diffs[1].title).toBe('Chest Volume Reduced (-25%)');
      expect(diffs[2].title).toBe('Shoulders Volume Increased (+3 sets/week)');
      expect(diffs[3].title).toBe('Barbell Bench Press Load Increased (+3.1%)');
      expect(diffs[4].title).toBe('Lateral Raises Converted to Myo-Reps');
      expect(diffs[5].title).toBe('Mesocycle Length Set to 4 Weeks');
      expect(diffs[6].title).toBe('Barbell Back Squat Swapped for Hack Squat');
    });
  });
});
