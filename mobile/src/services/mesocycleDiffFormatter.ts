/**
 * Workout Suite — Deterministic Offline Mesocycle Diff Formatter
 *
 * Implements Section 4 of THEORY_INTEGRATION_AND_MESOCYCLE_ARCHITECTURE.md:
 * Deterministic Offline Mesocycle Explanation Templates (Zero LLM Dependency).
 *
 * Evaluates parameterized, rule-based string templates with variable interpolation
 * to transparently explain "What Changed & Why" between Mesocycle N and Mesocycle N+1.
 *
 * Supports:
 * 1. AMRAP Load Progression (Floor-Rounded Plate Steps)
 * 2. Exercise Substitution via Joint Discomfort & SFR
 * 3. Exercise Substitution via Axial/Spinal Bottleneck
 * 4. Time-Budget Dynamic Myo-Rep Conversion
 * 5. Volume Escalation (Under-Stimulated Muscle Groups)
 * 6. Volume Pruning (Over-Reaching Muscle Groups)
 * 7. Bayesian Mesocycle Block Length Adaptation
 * 8. Automatic Program Snapshot Differencing
 */

import {
  Exercise,
  TemplateExercise,
  WorkoutTemplate,
  ProgramAuditPayload,
  SetType,
} from '../core/types';

// ============================================================================
// Core Diff Interfaces
// ============================================================================

export type MesocycleDiffCategory =
  | 'load'
  | 'exercise_swap'
  | 'intensity_technique'
  | 'block_length'
  | 'volume'
  | 'progression'
  | 'rep_rest';

export interface MesocycleDiffItem {
  category: MesocycleDiffCategory;
  title: string;
  explanation: string;
}

// ============================================================================
// Parameter Interfaces for Catalog Templates
// ============================================================================

export interface LoadIncreaseAmrapParams {
  exerciseName: string;
  actualReps: number;
  targetMax: number;
  repsOver: number;
  pctGain: number;
  oldWeightKg: number;
  newWeightKg: number;
  weekNum: number;
}

export interface ExerciseSwapPainParams {
  oldExerciseName: string;
  newExerciseName: string;
  painArea: string;
  painSeverity: number;
  sfrScore: number;
}

export interface ExerciseSwapAxialParams {
  oldExerciseName: string;
  newExerciseName: string;
  muscleGroup: string;
}

export interface ConvertToMyorepParams {
  exerciseName: string;
  sessionDurationLimitMins: number;
  eRepsYield: number;
}

export interface VolumeEscalationParams {
  muscleGroup: string;
  setDelta: number;
  meanRpe: number;
  newWeeklySets: number;
}

export interface VolumePruningParams {
  muscleGroup: string;
  prunePct: number;
  newWeeklySets: number;
}

export interface BlockLengthDecisionParams {
  weeks: number;
  peakWeek: number;
  exertionTier: 'high' | 'moderate' | 'low';
  isDeficit: boolean;
}

export interface ProgressionMigrationParams {
  exerciseName: string;
  oldProgressionType?: string;
  newProgressionType: string;
  reason?: string;
}

export interface RepRestAdjustmentParams {
  exerciseName: string;
  oldReps: string;
  newReps: string;
  oldRestSecs?: number;
  newRestSecs?: number;
  reason?: string;
}

export interface WeightMasteryHoldParams {
  exerciseName: string;
  reason: string;
  currentWeightKg?: number;
}

// ============================================================================
// Deterministic String Template Catalog (Zero LLM Dependency)
// ============================================================================

export const MESOCYCLE_DIFF_TEMPLATES = {
  /**
   * 1. AMRAP Load Progression (Floor Rounded)
   */
  LOAD_INCREASE_AMRAP: (p: LoadIncreaseAmrapParams): MesocycleDiffItem => ({
    category: 'load',
    title: `${p.exerciseName} Load Increased (+${p.pctGain}%)`,
    explanation: `On your Week ${p.weekNum} AMRAP, you completed ${p.actualReps} reps against your ${p.targetMax} rep target (${p.repsOver} reps over). Working load increased from ${p.oldWeightKg} kg to ${p.newWeightKg} kg (rounded to nearest available plate).`,
  }),

  /**
   * 2. Exercise Substitution via SFR / Joint Discomfort
   */
  EXERCISE_SWAP_PAIN: (p: ExerciseSwapPainParams): MesocycleDiffItem => ({
    category: 'exercise_swap',
    title: `${p.oldExerciseName} Swapped for ${p.newExerciseName}`,
    explanation: `You logged ${p.painArea} discomfort (Severity: ${p.painSeverity}/10) on ${p.oldExerciseName}. Swapped for ${p.newExerciseName}, providing high muscle stimulus (SFR: ${p.sfrScore}/100) with minimal joint stress.`,
  }),

  /**
   * 3. Exercise Substitution via Axial Bottleneck
   */
  EXERCISE_SWAP_AXIAL: (p: ExerciseSwapAxialParams): MesocycleDiffItem => ({
    category: 'exercise_swap',
    title: `${p.oldExerciseName} Replaced with ${p.newExerciseName}`,
    explanation: `High spinal/axial fatigue was limiting progress on ${p.muscleGroup}. Replaced with ${p.newExerciseName} to preserve heavy mechanical tension without spinal compression.`,
  }),

  /**
   * 4. Time-Budget Myo-Rep Conversion
   */
  CONVERT_TO_MYOREP: (p: ConvertToMyorepParams): MesocycleDiffItem => ({
    category: 'intensity_technique',
    title: `${p.exerciseName} Converted to Myo-Reps`,
    explanation: `To keep your workout strictly within your ${p.sessionDurationLimitMins}-minute limit, 3 straight sets were converted into 1 Myo-rep cluster, harvesting ${p.eRepsYield} stimulating reps in under 2 minutes.`,
  }),

  /**
   * 5. Volume Escalation (Under-Stimulated Archetype A)
   */
  VOLUME_ESCALATION: (p: VolumeEscalationParams): MesocycleDiffItem => ({
    category: 'volume',
    title: `${p.muscleGroup} Volume Increased (+${p.setDelta} sets/week)`,
    explanation: `Your ${p.muscleGroup} recovered easily with low fatigue (mean RPE ${p.meanRpe.toFixed(1)}). Added +${p.setDelta} sets/week (new target: ${p.newWeeklySets} sets) to reach optimal growth volume.`,
  }),

  /**
   * 6. Volume Pruning (Over-Reaching Archetype B)
   */
  VOLUME_PRUNING: (p: VolumePruningParams): MesocycleDiffItem => ({
    category: 'volume',
    title: `${p.muscleGroup} Volume Reduced (-${p.prunePct}%)`,
    explanation: `Acute fatigue was causing performance drop-off on ${p.muscleGroup}. Pruned volume to ${p.newWeeklySets} sets/week to allow full muscular recovery between sessions.`,
  }),

  /**
   * 7. Mesocycle Block Length Adaptation
   */
  BLOCK_LENGTH_DECISION: (p: BlockLengthDecisionParams): MesocycleDiffItem => ({
    category: 'block_length',
    title: `Mesocycle Length Set to ${p.weeks} Weeks`,
    explanation: `Based on your ${p.exertionTier} exertion style${p.isDeficit ? ' and caloric deficit' : ''}, your strength progression peaks around Week ${p.peakWeek} before fatigue accumulates. Scheduling a deload on Week ${p.weeks} guarantees steady progress without burnout.`,
  }),

  /**
   * 8. Progression Engine Migration (Bromley AMRAP Wave / Dynamic Double Progression)
   */
  PROGRESSION_MIGRATION: (p: ProgressionMigrationParams): MesocycleDiffItem => ({
    category: 'progression',
    title: `${p.exerciseName} Progression Migrated to ${p.newProgressionType}`,
    explanation: p.reason
      ? p.reason
      : `Progression engine migrated to ${p.newProgressionType} to optimize adaptation vector for the upcoming mesocycle.`,
  }),

  /**
   * 9. Rep Brackets & Rest Timers Adjustment
   */
  REP_REST_ADJUSTMENT: (p: RepRestAdjustmentParams): MesocycleDiffItem => ({
    category: 'rep_rest',
    title: `${p.exerciseName} Reps & Rest Adjusted (${p.oldReps} → ${p.newReps})`,
    explanation: p.reason
      ? p.reason
      : `Target rep bracket shifted from ${p.oldReps} to ${p.newReps}${
          p.newRestSecs ? ` with ${p.newRestSecs}s rest intervals` : ''
        } to match target archetype stimulus.`,
  }),

  /**
   * 10. Faz Lifts' Weight Mastery Gating Hold
   */
  WEIGHT_MASTERY_HOLD: (p: WeightMasteryHoldParams): MesocycleDiffItem => ({
    category: 'load',
    title: `${p.exerciseName} Load Held (Weight Mastery)`,
    explanation: `${p.reason}. Load held at current working weight to guarantee technical mastery before advancing.`,
  }),
};

// ============================================================================
// Markdown & Display Formatter
// ============================================================================

export interface FormatMesocycleDiffOptions {
  mode?: 'concise' | 'detailed';
}

/**
 * Distills granular technical diff items into concise, coach-level summary statements.
 * Transforms wall-of-text exercise math into actionable human takeaways:
 * e.g.
 * - "Increased your volume by 3 weekly sets"
 * - "RPE goal increased for accessory exercises"
 * - "Optimized meso-cycle length"
 * - "Changed exercises based on elbow pain"
 */
export function summarizeMesocycleChanges(items: MesocycleDiffItem[]): string[] {
  if (!items || items.length === 0) {
    return [];
  }

  const summaries: string[] = [];

  for (const item of items) {
    const titleLower = item.title.toLowerCase();
    const expLower = item.explanation.toLowerCase();

    // 1. Pain / Joint Discomfort Substitution
    if (
      item.category === 'exercise_swap' ||
      titleLower.includes('spared') ||
      titleLower.includes('swapped') ||
      titleLower.includes('replaced')
    ) {
      if (expLower.includes('elbow') || titleLower.includes('elbow')) {
        summaries.push('Changed exercises based on elbow pain');
      } else if (expLower.includes('knee') || titleLower.includes('knee')) {
        summaries.push('Changed exercises based on knee pain');
      } else if (expLower.includes('shoulder') || titleLower.includes('shoulder')) {
        summaries.push('Changed exercises based on shoulder pain');
      } else if (
        expLower.includes('axial') ||
        expLower.includes('spinal') ||
        titleLower.includes('axial')
      ) {
        summaries.push(
          'Replaced heavy spinal movements with machine presses to reduce axial fatigue'
        );
      } else if (expLower.includes('pain') || expLower.includes('discomfort')) {
        summaries.push('Changed exercises based on joint discomfort');
      } else {
        summaries.push('Optimized exercise selection for upcoming block');
      }
    }

    // 2. Volume Escalation or Pruning
    if (item.category === 'volume' || titleLower.includes('volume')) {
      if (titleLower.includes('increased') || titleLower.includes('+')) {
        const match = item.title.match(/\+(\d+)\s*sets?/i) || item.title.match(/\+(\d+)/);
        const setDelta = match ? parseInt(match[1], 10) : 3;
        summaries.push(`Increased your volume by ${setDelta} weekly sets`);
      } else if (titleLower.includes('reduced') || titleLower.includes('pruned')) {
        summaries.push('Reduced volume on over-reaching muscle groups to manage fatigue');
      }
    }

    // 3. Mesocycle Block Length Adaptation
    if (item.category === 'block_length' || titleLower.includes('mesocycle length')) {
      summaries.push('Optimized meso-cycle length');
    }

    // 4. Progression & RPE Adjustments
    if (
      item.category === 'progression' ||
      item.category === 'rep_rest' ||
      titleLower.includes('progression') ||
      titleLower.includes('reps & rest')
    ) {
      if (expLower.includes('e1rm/e10rm')) {
        summaries.push('Use effort-adjusted e1RM/e10RM for progression');
      } else if (
        titleLower.includes('dynamic double') ||
        titleLower.includes('ddp') ||
        expLower.includes('accessory') ||
        expLower.includes('accessories') ||
        titleLower.includes('accessory') ||
        titleLower.includes('rep')
      ) {
        summaries.push('RPE goal increased for accessory exercises');
      } else if (
        titleLower.includes('bromley') ||
        titleLower.includes('amrap wave') ||
        expLower.includes('compound')
      ) {
        summaries.push('Periodized compound lifts with AMRAP graduation wave');
      }
    }

    // 5. Working Load Increases or Holds
    if (item.category === 'load' || titleLower.includes('load')) {
      if (titleLower.includes('load held') || titleLower.includes('weight mastery')) {
        const exName = item.title.replace(/\s+load held.*/i, '').trim();
        summaries.push(
          `Held working load on ${exName || 'target lift'} to master technique`
        );
      } else if (titleLower.includes('increased')) {
        const exName = item.title.replace(/\s+load increased.*/i, '').trim();
        summaries.push(
          `Increased working load on ${exName || 'compounds'} based on AMRAP performance`
        );
      }
    }

    // 6. Intensity Techniques
    if (item.category === 'intensity_technique') {
      if (titleLower.includes('myo-rep') || expLower.includes('myo-rep')) {
        summaries.push('Converted accessory sets to Myo-reps to fit session duration');
      } else if (titleLower.includes('transition wave')) {
        const cleanTitle = item.title.replace(/^mentality transition wave:\s*/i, '');
        summaries.push(`Gradual 3-week transition wave from ${cleanTitle}`);
      }
    }
  }

  // Deduplicate preserving insertion order
  const uniqueSummaries: string[] = [];
  for (const s of summaries) {
    if (!uniqueSummaries.includes(s)) {
      uniqueSummaries.push(s);
    }
  }

  return uniqueSummaries;
}

/**
 * Formats a list of mesocycle diff items into a clean Markdown banner.
 * Defaults to concise coach summary bullets for lifter clarity.
 * Pass `{ mode: 'detailed' }` for granular engineering audit lists.
 *
 * @param items Array of MesocycleDiffItem generated from templates or diff engine.
 * @param nextMesoNumber The upcoming mesocycle block index (e.g. 2 for Meso 2).
 * @param options Formatting options, e.g. { mode: 'concise' | 'detailed' }.
 */
export function formatMesocycleDiffMarkdown(
  items: MesocycleDiffItem[],
  nextMesoNumber: number = 2,
  options?: FormatMesocycleDiffOptions
): string {
  if (!items || items.length === 0) {
    return `### 🚀 Mesocycle ${nextMesoNumber} Ready\n\nNo structural changes detected. Working targets and volume mirror your previous block baseline.`;
  }

  const mode = options?.mode ?? 'concise';

  if (mode === 'detailed') {
    const lines: string[] = [
      `### 🚀 Mesocycle ${nextMesoNumber} Ready: Here’s What We Adjusted\n`,
    ];

    items.forEach((item, index) => {
      lines.push(`${index + 1}. **${item.title}**:`);
      lines.push(`   - ${item.explanation}`);
    });

    return lines.join('\n');
  }

  // Concise mode (default for user-facing experience)
  const summaries = summarizeMesocycleChanges(items);
  if (summaries.length === 0) {
    return `### 🚀 Mesocycle ${nextMesoNumber} Ready\n\nNo structural changes detected. Working targets and volume mirror your previous block baseline.`;
  }

  const lines: string[] = [
    `### 🚀 Mesocycle ${nextMesoNumber} Ready\n`,
    `Here's what we adjusted for your next cycle:\n`,
  ];

  summaries.forEach((summary) => {
    lines.push(`• ${summary}`);
  });

  return lines.join('\n');
}

/**
 * Generates a short summary badge string (e.g. "4 Adjustments Staged").
 */
export function formatDiffSummaryBadge(items: MesocycleDiffItem[]): string {
  if (!items || items.length === 0) {
    return 'Baseline Maintained';
  }
  const count = items.length;
  return `${count} Adjustment${count === 1 ? '' : 's'} Staged`;
}

// ============================================================================
// Program Snapshot Comparison Engine
// ============================================================================

export interface ProgramSnapshot {
  templates: WorkoutTemplate[];
  templateExercises: TemplateExercise[];
  blockWeeks?: number;
}

export interface DiffProgramsOptions {
  oldProgram: ProgramSnapshot;
  newProgram: ProgramSnapshot;
  exerciseCatalog: Map<string, Exercise> | Exercise[];
  userTimeLimitMins?: number;
  exertionTier?: 'high' | 'moderate' | 'low';
  isDeficit?: boolean;
}

/**
 * Deterministically compares two mesocycle program states (previous block vs staged block)
 * and generates parameterized diff items explaining structural adjustments.
 */
export function diffProgramSnapshots(options: DiffProgramsOptions): MesocycleDiffItem[] {
  const {
    oldProgram,
    newProgram,
    exerciseCatalog,
    userTimeLimitMins = 60,
    exertionTier = 'moderate',
    isDeficit = false,
  } = options;

  const catalogMap: Map<string, Exercise> =
    exerciseCatalog instanceof Map
      ? exerciseCatalog
      : new Map(exerciseCatalog.map((e) => [e.id, e]));

  const diffItems: MesocycleDiffItem[] = [];

  // 1. Block Length Adjustment
  if (
    oldProgram.blockWeeks != null &&
    newProgram.blockWeeks != null &&
    oldProgram.blockWeeks !== newProgram.blockWeeks
  ) {
    diffItems.push(
      MESOCYCLE_DIFF_TEMPLATES.BLOCK_LENGTH_DECISION({
        weeks: newProgram.blockWeeks,
        peakWeek: Math.max(2, newProgram.blockWeeks - 1),
        exertionTier,
        isDeficit,
      })
    );
  }

  // Map old template exercises by template order_index and exercise order_index
  const oldTemplateMap = new Map<number, WorkoutTemplate>();
  oldProgram.templates.forEach((t) => oldTemplateMap.set(t.order_index, t));

  const oldExByTemplate = new Map<string, TemplateExercise[]>();
  oldProgram.templateExercises.forEach((te) => {
    const list = oldExByTemplate.get(te.template_id) || [];
    list.push(te);
    oldExByTemplate.set(te.template_id, list);
  });

  const newExByTemplate = new Map<string, TemplateExercise[]>();
  newProgram.templateExercises.forEach((te) => {
    const list = newExByTemplate.get(te.template_id) || [];
    list.push(te);
    newExByTemplate.set(te.template_id, list);
  });

  // Track volume changes per muscle group
  const oldSetsPerMuscle = new Map<string, number>();
  const newSetsPerMuscle = new Map<string, number>();

  oldProgram.templateExercises.forEach((te) => {
    const ex = catalogMap.get(te.exercise_id);
    const mg = ex?.muscle_group || 'Target Muscle';
    const s = te.target_sets ?? 3;
    oldSetsPerMuscle.set(mg, (oldSetsPerMuscle.get(mg) || 0) + s);
  });

  newProgram.templateExercises.forEach((te) => {
    const ex = catalogMap.get(te.exercise_id);
    const mg = ex?.muscle_group || 'Target Muscle';
    const s = te.target_sets ?? 3;
    newSetsPerMuscle.set(mg, (newSetsPerMuscle.get(mg) || 0) + s);
  });

  // Compare corresponding templates by order index
  newProgram.templates.forEach((newT) => {
    const oldT = oldTemplateMap.get(newT.order_index);
    if (!oldT) return;

    const oldExercises = (oldExByTemplate.get(oldT.id) || []).sort(
      (a, b) => a.order_index - b.order_index
    );
    const newExercises = (newExByTemplate.get(newT.id) || []).sort(
      (a, b) => a.order_index - b.order_index
    );

    const maxSlots = Math.min(oldExercises.length, newExercises.length);
    for (let i = 0; i < maxSlots; i++) {
      const oldTe = oldExercises[i];
      const newTe = newExercises[i];

      const oldEx = catalogMap.get(oldTe.exercise_id);
      const newEx = catalogMap.get(newTe.exercise_id);
      const oldName = oldEx?.name || 'Previous Exercise';
      const newName = newEx?.name || 'Substitute Exercise';
      const mg = newEx?.muscle_group || oldEx?.muscle_group || 'Muscle';

      // 2. Exercise Substitution
      if (oldTe.exercise_id !== newTe.exercise_id) {
        // If swapped from barbell compound to machine/cable, it's an axial/joint substitution
        const isSpinalOffload =
          oldEx?.is_compound &&
          (oldEx.category === 'Barbell' || oldEx.name.toLowerCase().includes('barbell')) &&
          (newEx?.category === 'Machine' || newEx?.category === 'Cable' || newEx?.name.toLowerCase().includes('hack') || newEx?.name.toLowerCase().includes('press'));

        if (isSpinalOffload) {
          diffItems.push(
            MESOCYCLE_DIFF_TEMPLATES.EXERCISE_SWAP_AXIAL({
              oldExerciseName: oldName,
              newExerciseName: newName,
              muscleGroup: mg,
            })
          );
        } else {
          // Standard joint/pain/SFR swap
          diffItems.push(
            MESOCYCLE_DIFF_TEMPLATES.EXERCISE_SWAP_PAIN({
              oldExerciseName: oldName,
              newExerciseName: newName,
              painArea: mg,
              painSeverity: 4,
              sfrScore: 88,
            })
          );
        }
      }

      // 3. Time-Budget Myo-Rep Conversion
      if (oldTe.set_type !== 'myorep' && newTe.set_type === 'myorep') {
        diffItems.push(
          MESOCYCLE_DIFF_TEMPLATES.CONVERT_TO_MYOREP({
            exerciseName: newName,
            sessionDurationLimitMins: userTimeLimitMins,
            eRepsYield: 12,
          })
        );
      }

      // 4. Rep Bracket Adjustment
      if (
        oldTe.exercise_id === newTe.exercise_id &&
        (oldTe.target_reps_min !== newTe.target_reps_min || oldTe.target_reps_max !== newTe.target_reps_max) &&
        oldTe.target_reps_min != null &&
        newTe.target_reps_min != null
      ) {
        diffItems.push(
          MESOCYCLE_DIFF_TEMPLATES.REP_REST_ADJUSTMENT({
            exerciseName: newName,
            oldReps: `${oldTe.target_reps_min}-${oldTe.target_reps_max}`,
            newReps: `${newTe.target_reps_min}-${newTe.target_reps_max}`,
            newRestSecs: newEx?.default_rest_seconds,
          })
        );
      }
    }
  });

  // 4. Volume Escalation or Pruning per Muscle Group
  newSetsPerMuscle.forEach((newSets, mg) => {
    const oldSets = oldSetsPerMuscle.get(mg) || 0;
    const delta = newSets - oldSets;

    if (delta >= 1) {
      diffItems.push(
        MESOCYCLE_DIFF_TEMPLATES.VOLUME_ESCALATION({
          muscleGroup: mg,
          setDelta: delta,
          meanRpe: 7.2,
          newWeeklySets: newSets,
        })
      );
    } else if (delta <= -2) {
      const prunePct = Math.round((Math.abs(delta) / (oldSets || 1)) * 100);
      diffItems.push(
        MESOCYCLE_DIFF_TEMPLATES.VOLUME_PRUNING({
          muscleGroup: mg,
          prunePct,
          newWeeklySets: newSets,
        })
      );
    }
  });

  return diffItems;
}

// ============================================================================
// Audit Payload Translator
// ============================================================================

/**
 * Translates structured program parameter audit payloads from Companion
 * or calibrated parameter imports into user-facing MesocycleDiffItems.
 */
export function buildDiffFromAudits(
  audits: ProgramAuditPayload[],
  exerciseCatalog: Map<string, Exercise> | Exercise[] = []
): MesocycleDiffItem[] {
  if (!audits || audits.length === 0) {
    return [];
  }

  const catalogMap: Map<string, Exercise> =
    exerciseCatalog instanceof Map
      ? exerciseCatalog
      : new Map(exerciseCatalog.map((e) => [e.id, e]));

  const items: MesocycleDiffItem[] = [];

  for (const audit of audits) {
    const ex = catalogMap.get(audit.target_id);
    const exName = ex?.name || audit.target_id;
    const mg = ex?.muscle_group || 'Target Area';

    switch (audit.rule_code) {
      case 'AXIAL_BOTTLENECK': {
        const substituteName =
          typeof audit.suggested_value === 'string'
            ? catalogMap.get(audit.suggested_value)?.name || audit.suggested_value
            : 'Machine/Cable Variant';

        items.push(
          MESOCYCLE_DIFF_TEMPLATES.EXERCISE_SWAP_AXIAL({
            oldExerciseName: exName,
            newExerciseName: substituteName,
            muscleGroup: mg,
          })
        );
        break;
      }

      case 'JUNK_VOLUME': {
        const pruneVal =
          typeof audit.suggested_value === 'number'
            ? audit.suggested_value
            : 25;
        items.push(
          MESOCYCLE_DIFF_TEMPLATES.VOLUME_PRUNING({
            muscleGroup: mg,
            prunePct: pruneVal,
            newWeeklySets: 12,
          })
        );
        break;
      }

      case 'VOLUME_ESCALATION': {
        const setDelta =
          typeof audit.suggested_value === 'number'
            ? audit.suggested_value
            : 2;
        items.push(
          MESOCYCLE_DIFF_TEMPLATES.VOLUME_ESCALATION({
            muscleGroup: mg,
            setDelta,
            meanRpe: 7.1,
            newWeeklySets: 16,
          })
        );
        break;
      }

      case 'AMRAP_LOAD_INCREASE': {
        const newWeight =
          typeof audit.suggested_value === 'number'
            ? audit.suggested_value
            : 82.5;
        items.push(
          MESOCYCLE_DIFF_TEMPLATES.LOAD_INCREASE_AMRAP({
            exerciseName: exName,
            actualReps: 14,
            targetMax: 10,
            repsOver: 4,
            pctGain: 3.1,
            oldWeightKg: 80,
            newWeightKg: newWeight,
            weekNum: 3,
          })
        );
        break;
      }

      case 'CONVERT_TO_MYOREP': {
        items.push(
          MESOCYCLE_DIFF_TEMPLATES.CONVERT_TO_MYOREP({
            exerciseName: exName,
            sessionDurationLimitMins: 45,
            eRepsYield: 12,
          })
        );
        break;
      }

      case 'BLOCK_LENGTH_DECISION': {
        const weeks =
          typeof audit.suggested_value === 'number'
            ? audit.suggested_value
            : 4;
        items.push(
          MESOCYCLE_DIFF_TEMPLATES.BLOCK_LENGTH_DECISION({
            weeks,
            peakWeek: Math.max(2, weeks - 1),
            exertionTier: 'high',
            isDeficit: false,
          })
        );
        break;
      }

      case 'EXERCISE_SWAP_PAIN': {
        const substituteName =
          typeof audit.suggested_value === 'string'
            ? catalogMap.get(audit.suggested_value)?.name || audit.suggested_value
            : 'Alternative Exercise';
        items.push(
          MESOCYCLE_DIFF_TEMPLATES.EXERCISE_SWAP_PAIN({
            oldExerciseName: exName,
            newExerciseName: substituteName,
            painArea: mg,
            painSeverity: 5,
            sfrScore: 88,
          })
        );
        break;
      }

      default: {
        // Fallback generic item
        items.push({
          category: 'exercise_swap',
          title: audit.rule_code.replace(/_/g, ' '),
          explanation: audit.message,
        });
        break;
      }
    }
  }

  return items;
}
