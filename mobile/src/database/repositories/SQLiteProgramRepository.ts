import {
  IProgramRepository,
  ProgramWithDetails,
  WorkoutTemplateDetail,
  TemplateExerciseDetail,
} from '../../domain/repositories/IProgramRepository';
import {
  Program,
  WorkoutTemplate,
  TemplateExercise,
  ProgressionRule,
  ProgramBlock,
  SynthesizedProgram,
} from '../../core/types';
import { ISQLiteDatabase } from '../schema';

interface ProgramRow {
  id: string;
  name: string;
  color_hex: string;
  notes: string | null;
  created_at: string;
}

interface WorkoutTemplateRow {
  id: string;
  program_id: string | null;
  name: string;
  notes: string | null;
  order_index: number;
  created_at: string;
}

interface TemplateExerciseRow {
  id: string;
  template_id: string;
  exercise_id: string;
  gear_id: string | null;
  target_sets: number | null;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_rpe: number | null;
  target_rir: number | null;
  order_index: number;
  exercise_group_id: string | null;
  set_type?: string | null;
}

interface ProgressionRuleRow {
  id: string;
  template_exercise_id: string;
  priority: number;
  rule_json: string;
}

interface ProgramBlockRow {
  id: string;
  program_id: string;
  start_date: string;
  end_date: string | null;
}

function mapRowToProgram(row: ProgramRow): Program {
  return {
    id: row.id,
    name: row.name,
    color_hex: row.color_hex,
    notes: row.notes,
    created_at: row.created_at,
  };
}

function mapRowToTemplate(row: WorkoutTemplateRow): WorkoutTemplate {
  return {
    id: row.id,
    program_id: row.program_id,
    name: row.name,
    notes: row.notes,
    order_index: Number(row.order_index ?? 0),
    created_at: row.created_at,
  };
}

function mapRowToTemplateExercise(row: TemplateExerciseRow): TemplateExercise {
  return {
    id: row.id,
    template_id: row.template_id,
    exercise_id: row.exercise_id,
    gear_id: row.gear_id,
    target_sets: row.target_sets != null ? Number(row.target_sets) : null,
    target_reps_min: row.target_reps_min != null ? Number(row.target_reps_min) : null,
    target_reps_max: row.target_reps_max != null ? Number(row.target_reps_max) : null,
    target_rpe: row.target_rpe != null ? Number(row.target_rpe) : null,
    target_rir: row.target_rir != null ? Number(row.target_rir) : null,
    order_index: Number(row.order_index ?? 0),
    exercise_group_id: row.exercise_group_id,
    set_type: (row.set_type as any) ?? 'working',
  };
}

function mapRowToProgressionRule(row: ProgressionRuleRow): ProgressionRule {
  let ruleJson: any = row.rule_json;
  if (typeof row.rule_json === 'string') {
    try {
      ruleJson = JSON.parse(row.rule_json);
    } catch {
      ruleJson = row.rule_json;
    }
  }
  return {
    id: row.id,
    template_exercise_id: row.template_exercise_id,
    priority: Number(row.priority ?? 0),
    rule_json: ruleJson,
  };
}

function mapRowToProgramBlock(row: ProgramBlockRow): ProgramBlock {
  return {
    id: row.id,
    program_id: row.program_id,
    start_date: row.start_date,
    end_date: row.end_date,
  };
}

/**
 * Concrete SQLite implementation of IProgramRepository using expo-sqlite.
 */
export class SQLiteProgramRepository implements IProgramRepository {
  constructor(private readonly db: ISQLiteDatabase) {}

  // ==========================================================================
  // Programs
  // ==========================================================================

  async findById(id: string): Promise<Program | null> {
    const row = await this.db.getFirstAsync<ProgramRow>(
      'SELECT * FROM programs WHERE id = ?;',
      id
    );
    return row ? mapRowToProgram(row) : null;
  }

  async findAll(): Promise<Program[]> {
    const rows = await this.db.getAllAsync<ProgramRow>(
      'SELECT * FROM programs ORDER BY created_at DESC;'
    );
    return rows.map(mapRowToProgram);
  }

  async create(program: Program): Promise<Program> {
    await this.db.runAsync(
      `INSERT INTO programs (id, name, color_hex, notes, created_at)
       VALUES (?, ?, ?, ?, ?);`,
      program.id,
      program.name,
      program.color_hex,
      program.notes,
      program.created_at
    );
    return { ...program };
  }

  async update(program: Program): Promise<Program> {
    await this.db.runAsync(
      `UPDATE programs SET
         name = ?, color_hex = ?, notes = ?
       WHERE id = ?;`,
      program.name,
      program.color_hex,
      program.notes,
      program.id
    );
    return { ...program };
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.execAsync('BEGIN TRANSACTION;');

      // 1. Decouple any historical workouts so deleting templates does not violate FK
      await this.db.runAsync(
        `UPDATE workouts SET template_id = NULL WHERE template_id IN (
          SELECT id FROM workout_templates WHERE program_id = ?
        );`,
        id
      );

      // 2. Cascade delete progression rules
      await this.db.runAsync(
        `DELETE FROM progression_rules WHERE template_exercise_id IN (
          SELECT te.id FROM template_exercises te
          JOIN workout_templates wt ON te.template_id = wt.id
          WHERE wt.program_id = ?
        );`,
        id
      );

      // 3. Cascade delete template exercises
      await this.db.runAsync(
        `DELETE FROM template_exercises WHERE template_id IN (
          SELECT id FROM workout_templates WHERE program_id = ?
        );`,
        id
      );

      // 4. Cascade delete workout templates
      await this.db.runAsync('DELETE FROM workout_templates WHERE program_id = ?;', id);

      // 5. Cascade delete program blocks
      await this.db.runAsync('DELETE FROM program_blocks WHERE program_id = ?;', id);

      // 6. Delete program record
      await this.db.runAsync('DELETE FROM programs WHERE id = ?;', id);

      await this.db.execAsync('COMMIT;');
    } catch (err) {
      await this.db.execAsync('ROLLBACK;').catch(() => {});
      throw err;
    }
  }

  async getProgramWithDetails(programId: string): Promise<ProgramWithDetails | null> {
    const program = await this.findById(programId);
    if (!program) {
      return null;
    }

    const templates = await this.findTemplatesByProgramId(programId);
    const templateDetails: WorkoutTemplateDetail[] = [];

    for (const template of templates) {
      const templateDetail = await this.getTemplateWithDetails(template.id);
      if (templateDetail) {
        templateDetails.push(templateDetail);
      }
    }

    return {
      program,
      templates: templateDetails,
    };
  }

  async saveSynthesizedProgram(synthesized: SynthesizedProgram): Promise<void> {
    // 1. Insert or replace program
    await this.db.runAsync(
      `INSERT OR REPLACE INTO programs (id, name, color_hex, notes, created_at)
       VALUES (?, ?, ?, ?, ?);`,
      synthesized.program.id,
      synthesized.program.name,
      synthesized.program.color_hex,
      synthesized.program.notes,
      synthesized.program.created_at
    );

    // 2. Insert or replace templates
    for (const tmpl of synthesized.templates) {
      await this.db.runAsync(
        `INSERT OR REPLACE INTO workout_templates (id, program_id, name, notes, order_index, created_at)
         VALUES (?, ?, ?, ?, ?, ?);`,
        tmpl.id,
        tmpl.program_id,
        tmpl.name,
        tmpl.notes,
        tmpl.order_index,
        tmpl.created_at
      );
    }

    // 3. Insert or replace template exercises
    for (const te of synthesized.templateExercises) {
      await this.db.runAsync(
        `INSERT OR REPLACE INTO template_exercises (
           id, template_id, exercise_id, gear_id, target_sets, target_reps_min,
           target_reps_max, target_rpe, target_rir, order_index, exercise_group_id, set_type
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        te.id,
        te.template_id,
        te.exercise_id,
        te.gear_id,
        te.target_sets,
        te.target_reps_min,
        te.target_reps_max,
        te.target_rpe,
        te.target_rir,
        te.order_index,
        te.exercise_group_id,
        te.set_type ?? 'working'
      );
    }

    // 4. Insert or replace progression rules
    for (const rule of synthesized.progressionRules) {
      const serializedJson =
        typeof rule.rule_json === 'string'
          ? rule.rule_json
          : JSON.stringify(rule.rule_json);

      await this.db.runAsync(
        `INSERT OR REPLACE INTO progression_rules (id, template_exercise_id, priority, rule_json)
         VALUES (?, ?, ?, ?);`,
        rule.id,
        rule.template_exercise_id,
        rule.priority,
        serializedJson
      );
    }
  }

  // ==========================================================================
  // Workout Templates
  // ==========================================================================

  async findTemplateById(id: string): Promise<WorkoutTemplate | null> {
    const row = await this.db.getFirstAsync<WorkoutTemplateRow>(
      'SELECT * FROM workout_templates WHERE id = ?;',
      id
    );
    return row ? mapRowToTemplate(row) : null;
  }

  async findTemplatesByProgramId(programId: string): Promise<WorkoutTemplate[]> {
    const rows = await this.db.getAllAsync<WorkoutTemplateRow>(
      'SELECT * FROM workout_templates WHERE program_id = ? ORDER BY order_index ASC;',
      programId
    );
    return rows.map(mapRowToTemplate);
  }

  async findAllTemplates(): Promise<WorkoutTemplate[]> {
    const rows = await this.db.getAllAsync<WorkoutTemplateRow>(
      'SELECT * FROM workout_templates ORDER BY order_index ASC;'
    );
    return rows.map(mapRowToTemplate);
  }

  async createTemplate(template: WorkoutTemplate): Promise<WorkoutTemplate> {
    await this.db.runAsync(
      `INSERT INTO workout_templates (id, program_id, name, notes, order_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?);`,
      template.id,
      template.program_id,
      template.name,
      template.notes,
      template.order_index,
      template.created_at
    );
    return { ...template };
  }

  async updateTemplate(template: WorkoutTemplate): Promise<WorkoutTemplate> {
    await this.db.runAsync(
      `UPDATE workout_templates SET
         program_id = ?, name = ?, notes = ?, order_index = ?
       WHERE id = ?;`,
      template.program_id,
      template.name,
      template.notes,
      template.order_index,
      template.id
    );
    return { ...template };
  }

  async deleteTemplate(id: string): Promise<void> {
    try {
      await this.db.execAsync('BEGIN TRANSACTION;');

      // 1. Decouple any historical workouts referencing this template
      await this.db.runAsync('UPDATE workouts SET template_id = NULL WHERE template_id = ?;', id);

      // 2. Cascade delete progression rules
      await this.db.runAsync(
        `DELETE FROM progression_rules WHERE template_exercise_id IN (
          SELECT id FROM template_exercises WHERE template_id = ?
        );`,
        id
      );

      // 3. Cascade delete template exercises
      await this.db.runAsync('DELETE FROM template_exercises WHERE template_id = ?;', id);

      // 4. Delete the workout template
      await this.db.runAsync('DELETE FROM workout_templates WHERE id = ?;', id);

      await this.db.execAsync('COMMIT;');
    } catch (err) {
      await this.db.execAsync('ROLLBACK;').catch(() => {});
      throw err;
    }
  }

  async getTemplateWithDetails(templateId: string): Promise<WorkoutTemplateDetail | null> {
    const template = await this.findTemplateById(templateId);
    if (!template) {
      return null;
    }

    const templateExercises = await this.findTemplateExercises(templateId);
    const exerciseDetails: TemplateExerciseDetail[] = [];

    for (const te of templateExercises) {
      const rules = await this.findRulesByTemplateExerciseId(te.id);
      exerciseDetails.push({
        ...te,
        rules,
      });
    }

    return {
      ...template,
      exercises: exerciseDetails,
    };
  }

  // ==========================================================================
  // Template Exercises
  // ==========================================================================

  async findTemplateExercises(templateId: string): Promise<TemplateExercise[]> {
    const rows = await this.db.getAllAsync<TemplateExerciseRow>(
      'SELECT * FROM template_exercises WHERE template_id = ? ORDER BY order_index ASC;',
      templateId
    );
    return rows.map(mapRowToTemplateExercise);
  }

  async findTemplateExerciseById(id: string): Promise<TemplateExercise | null> {
    const row = await this.db.getFirstAsync<TemplateExerciseRow>(
      'SELECT * FROM template_exercises WHERE id = ?;',
      id
    );
    return row ? mapRowToTemplateExercise(row) : null;
  }

  async createTemplateExercise(exercise: TemplateExercise): Promise<TemplateExercise> {
    await this.db.runAsync(
      `INSERT INTO template_exercises (
         id, template_id, exercise_id, gear_id, target_sets, target_reps_min,
         target_reps_max, target_rpe, target_rir, order_index, exercise_group_id, set_type
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      exercise.id,
      exercise.template_id,
      exercise.exercise_id,
      exercise.gear_id,
      exercise.target_sets,
      exercise.target_reps_min,
      exercise.target_reps_max,
      exercise.target_rpe,
      exercise.target_rir,
      exercise.order_index,
      exercise.exercise_group_id,
      exercise.set_type ?? 'working'
    );
    return { ...exercise };
  }

  async updateTemplateExercise(exercise: TemplateExercise): Promise<TemplateExercise> {
    await this.db.runAsync(
      `UPDATE template_exercises SET
         exercise_id = ?, gear_id = ?, target_sets = ?, target_reps_min = ?,
         target_reps_max = ?, target_rpe = ?, target_rir = ?, order_index = ?,
         exercise_group_id = ?, set_type = ?
       WHERE id = ?;`,
      exercise.exercise_id,
      exercise.gear_id,
      exercise.target_sets,
      exercise.target_reps_min,
      exercise.target_reps_max,
      exercise.target_rpe,
      exercise.target_rir,
      exercise.order_index,
      exercise.exercise_group_id,
      exercise.set_type ?? 'working',
      exercise.id
    );
    return { ...exercise };
  }

  async deleteTemplateExercise(id: string): Promise<void> {
    try {
      await this.db.execAsync('BEGIN TRANSACTION;');
      await this.db.runAsync('DELETE FROM progression_rules WHERE template_exercise_id = ?;', id);
      await this.db.runAsync('DELETE FROM template_exercises WHERE id = ?;', id);
      await this.db.execAsync('COMMIT;');
    } catch (err) {
      await this.db.execAsync('ROLLBACK;').catch(() => {});
      throw err;
    }
  }

  async setTemplateExercises(
    templateId: string,
    exercises: TemplateExercise[]
  ): Promise<void> {
    // Delete existing exercises for this template
    await this.db.runAsync(
      'DELETE FROM template_exercises WHERE template_id = ?;',
      templateId
    );

    // Re-insert new exercises
    for (const te of exercises) {
      await this.createTemplateExercise(te);
    }
  }

  // ==========================================================================
  // Progression Rules
  // ==========================================================================

  async findRulesByTemplateExerciseId(
    templateExerciseId: string
  ): Promise<ProgressionRule[]> {
    const rows = await this.db.getAllAsync<ProgressionRuleRow>(
      'SELECT * FROM progression_rules WHERE template_exercise_id = ? ORDER BY priority ASC;',
      templateExerciseId
    );
    return rows.map(mapRowToProgressionRule);
  }

  async findRulesByTemplateId(templateId: string): Promise<ProgressionRule[]> {
    const rows = await this.db.getAllAsync<ProgressionRuleRow>(
      `SELECT r.* FROM progression_rules r
       INNER JOIN template_exercises te ON r.template_exercise_id = te.id
       WHERE te.template_id = ?
       ORDER BY r.priority ASC;`,
      templateId
    );
    return rows.map(mapRowToProgressionRule);
  }

  async createProgressionRule(rule: ProgressionRule): Promise<ProgressionRule> {
    const serializedJson =
      typeof rule.rule_json === 'string'
        ? rule.rule_json
        : JSON.stringify(rule.rule_json);

    await this.db.runAsync(
      `INSERT INTO progression_rules (id, template_exercise_id, priority, rule_json)
       VALUES (?, ?, ?, ?);`,
      rule.id,
      rule.template_exercise_id,
      rule.priority,
      serializedJson
    );
    return { ...rule };
  }

  async updateProgressionRule(rule: ProgressionRule): Promise<ProgressionRule> {
    const serializedJson =
      typeof rule.rule_json === 'string'
        ? rule.rule_json
        : JSON.stringify(rule.rule_json);

    await this.db.runAsync(
      `UPDATE progression_rules SET
         template_exercise_id = ?, priority = ?, rule_json = ?
       WHERE id = ?;`,
      rule.template_exercise_id,
      rule.priority,
      serializedJson,
      rule.id
    );
    return { ...rule };
  }

  async deleteProgressionRule(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM progression_rules WHERE id = ?;', id);
  }

  async setProgressionRules(
    templateExerciseId: string,
    rules: ProgressionRule[]
  ): Promise<void> {
    await this.db.runAsync(
      'DELETE FROM progression_rules WHERE template_exercise_id = ?;',
      templateExerciseId
    );

    for (const rule of rules) {
      await this.createProgressionRule(rule);
    }
  }

  // ==========================================================================
  // Program Blocks (Meso-Cycle Eras)
  // ==========================================================================

  async getActiveProgramBlock(): Promise<ProgramBlock | null> {
    const row = await this.db.getFirstAsync<ProgramBlockRow>(
      'SELECT * FROM program_blocks WHERE end_date IS NULL ORDER BY start_date DESC LIMIT 1;'
    );
    return row ? mapRowToProgramBlock(row) : null;
  }

  async findAllProgramBlocks(): Promise<ProgramBlock[]> {
    const rows = await this.db.getAllAsync<ProgramBlockRow>(
      'SELECT * FROM program_blocks ORDER BY start_date DESC;'
    );
    return rows.map(mapRowToProgramBlock);
  }

  async findProgramBlocksByProgramId(programId: string): Promise<ProgramBlock[]> {
    const rows = await this.db.getAllAsync<ProgramBlockRow>(
      'SELECT * FROM program_blocks WHERE program_id = ? ORDER BY start_date DESC;',
      programId
    );
    return rows.map(mapRowToProgramBlock);
  }

  async findProgramBlockById(id: string): Promise<ProgramBlock | null> {
    const row = await this.db.getFirstAsync<ProgramBlockRow>(
      'SELECT * FROM program_blocks WHERE id = ?;',
      id
    );
    return row ? mapRowToProgramBlock(row) : null;
  }

  async createProgramBlock(block: ProgramBlock): Promise<ProgramBlock> {
    await this.db.runAsync(
      `INSERT INTO program_blocks (id, program_id, start_date, end_date)
       VALUES (?, ?, ?, ?);`,
      block.id,
      block.program_id,
      block.start_date,
      block.end_date
    );
    return { ...block };
  }

  async updateProgramBlock(block: ProgramBlock): Promise<ProgramBlock> {
    await this.db.runAsync(
      `UPDATE program_blocks SET
         program_id = ?, start_date = ?, end_date = ?
       WHERE id = ?;`,
      block.program_id,
      block.start_date,
      block.end_date,
      block.id
    );
    return { ...block };
  }

  async deleteProgramBlock(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM program_blocks WHERE id = ?;', id);
  }
}
