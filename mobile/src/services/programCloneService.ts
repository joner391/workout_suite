/**
 * Workout Suite — Program Clone Service
 *
 * Implements Section 1.1: Default Presets Protection & Deep Cloning
 * Prevents mutation of pre-built or synthesized programs by automatically cloning
 * into a custom program (`prog_custom_<timestamp>_<hash>`).
 */

import { IProgramRepository } from '../domain/repositories/IProgramRepository';
import { Program, WorkoutTemplate, TemplateExercise, ProgressionRule } from '../core/types';

export function isCustomProgram(programId: string): boolean {
  return programId.startsWith('prog_custom_');
}

export function generateCustomProgramId(): string {
  return `prog_custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

export async function cloneProgramAsCustom(
  programRepo: IProgramRepository,
  sourceProgramId: string,
  overrides?: { name?: string; notes?: string }
): Promise<string> {
  const details = await programRepo.getProgramWithDetails(sourceProgramId);
  if (!details) {
    throw new Error(`Source program "${sourceProgramId}" not found for cloning.`);
  }

  const newProgramId = generateCustomProgramId();
  const today = new Date().toISOString().split('T')[0];

  const clonedProgram: Program = {
    id: newProgramId,
    name: overrides?.name || `${details.program.name} (Custom)`,
    color_hex: details.program.color_hex,
    notes:
      overrides?.notes ||
      `Cloned from ${details.program.name} on ${today}${details.program.notes ? `\n\n${details.program.notes}` : ''}`,
    created_at: new Date().toISOString(),
  };

  await programRepo.create(clonedProgram);

  for (const tmpl of details.templates) {
    const newTemplateId = `tpl_custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const clonedTemplate: WorkoutTemplate = {
      id: newTemplateId,
      program_id: newProgramId,
      name: tmpl.name,
      notes: tmpl.notes,
      order_index: tmpl.order_index,
      created_at: new Date().toISOString(),
    };
    await programRepo.createTemplate(clonedTemplate);

    // Maintain superset grouping relationships within the cloned template
    const supersetMap = new Map<string, string>();

    for (const te of tmpl.exercises) {
      const newTeId = `te_custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      let newGroupId: string | null = null;
      if (te.exercise_group_id) {
        if (!supersetMap.has(te.exercise_group_id)) {
          supersetMap.set(
            te.exercise_group_id,
            `ss_${newTemplateId}_${Math.random().toString(36).substring(2, 6)}`
          );
        }
        newGroupId = supersetMap.get(te.exercise_group_id)!;
      }

      const clonedTe: TemplateExercise = {
        id: newTeId,
        template_id: newTemplateId,
        exercise_id: te.exercise_id,
        gear_id: te.gear_id,
        order_index: te.order_index,
        target_sets: te.target_sets,
        target_reps_min: te.target_reps_min,
        target_reps_max: te.target_reps_max,
        target_rpe: te.target_rpe,
        target_rir: te.target_rir,
        exercise_group_id: newGroupId,
        set_type: te.set_type ?? 'working',
      };
      await programRepo.createTemplateExercise(clonedTe);

      for (const rule of te.rules) {
        const newRuleId = `rule_custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const clonedRule: ProgressionRule = {
          id: newRuleId,
          template_exercise_id: newTeId,
          priority: rule.priority,
          rule_json: rule.rule_json,
        };
        await programRepo.createProgressionRule(clonedRule);
      }
    }
  }

  return newProgramId;
}
