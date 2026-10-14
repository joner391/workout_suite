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

/**
 * In-memory mock implementation of IProgramRepository for testing.
 */
export class MockProgramRepository implements IProgramRepository {
  public programs: Map<string, Program> = new Map();
  public templates: Map<string, WorkoutTemplate> = new Map();
  public templateExercises: Map<string, TemplateExercise> = new Map();
  public progressionRules: Map<string, ProgressionRule> = new Map();
  public programBlocks: Map<string, ProgramBlock> = new Map();

  public clear(): void {
    this.programs.clear();
    this.templates.clear();
    this.templateExercises.clear();
    this.progressionRules.clear();
    this.programBlocks.clear();
  }

  // ==========================================================================
  // Programs
  // ==========================================================================

  async findById(id: string): Promise<Program | null> {
    const program = this.programs.get(id);
    return program ? { ...program } : null;
  }

  async findAll(): Promise<Program[]> {
    return Array.from(this.programs.values())
      .map((p) => ({ ...p }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async create(program: Program): Promise<Program> {
    this.programs.set(program.id, { ...program });
    return { ...program };
  }

  async update(program: Program): Promise<Program> {
    this.programs.set(program.id, { ...program });
    return { ...program };
  }

  async delete(id: string): Promise<void> {
    this.programs.delete(id);

    // Cascade delete templates
    const templatesToDelete: string[] = [];
    for (const tmpl of this.templates.values()) {
      if (tmpl.program_id === id) {
        templatesToDelete.push(tmpl.id);
      }
    }
    for (const tmplId of templatesToDelete) {
      await this.deleteTemplate(tmplId);
    }

    // Cascade delete program blocks
    const blocksToDelete: string[] = [];
    for (const block of this.programBlocks.values()) {
      if (block.program_id === id) {
        blocksToDelete.push(block.id);
      }
    }
    for (const blockId of blocksToDelete) {
      this.programBlocks.delete(blockId);
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
    await this.create(synthesized.program);

    for (const tmpl of synthesized.templates) {
      await this.createTemplate(tmpl);
    }

    for (const te of synthesized.templateExercises) {
      await this.createTemplateExercise(te);
    }

    for (const rule of synthesized.progressionRules) {
      await this.createProgressionRule(rule);
    }
  }

  // ==========================================================================
  // Workout Templates
  // ==========================================================================

  async findTemplateById(id: string): Promise<WorkoutTemplate | null> {
    const tmpl = this.templates.get(id);
    return tmpl ? { ...tmpl } : null;
  }

  async findTemplatesByProgramId(programId: string): Promise<WorkoutTemplate[]> {
    return Array.from(this.templates.values())
      .filter((t) => t.program_id === programId)
      .map((t) => ({ ...t }))
      .sort((a, b) => a.order_index - b.order_index);
  }

  async findAllTemplates(): Promise<WorkoutTemplate[]> {
    return Array.from(this.templates.values())
      .map((t) => ({ ...t }))
      .sort((a, b) => a.order_index - b.order_index);
  }

  async createTemplate(template: WorkoutTemplate): Promise<WorkoutTemplate> {
    this.templates.set(template.id, { ...template });
    return { ...template };
  }

  async updateTemplate(template: WorkoutTemplate): Promise<WorkoutTemplate> {
    this.templates.set(template.id, { ...template });
    return { ...template };
  }

  async deleteTemplate(id: string): Promise<void> {
    this.templates.delete(id);

    // Cascade delete template exercises
    const teToDelete: string[] = [];
    for (const te of this.templateExercises.values()) {
      if (te.template_id === id) {
        teToDelete.push(te.id);
      }
    }
    for (const teId of teToDelete) {
      await this.deleteTemplateExercise(teId);
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
    return Array.from(this.templateExercises.values())
      .filter((te) => te.template_id === templateId)
      .map((te) => ({ ...te }))
      .sort((a, b) => a.order_index - b.order_index);
  }

  async findTemplateExerciseById(id: string): Promise<TemplateExercise | null> {
    const te = this.templateExercises.get(id);
    return te ? { ...te } : null;
  }

  async createTemplateExercise(exercise: TemplateExercise): Promise<TemplateExercise> {
    this.templateExercises.set(exercise.id, { ...exercise });
    return { ...exercise };
  }

  async updateTemplateExercise(exercise: TemplateExercise): Promise<TemplateExercise> {
    this.templateExercises.set(exercise.id, { ...exercise });
    return { ...exercise };
  }

  async deleteTemplateExercise(id: string): Promise<void> {
    this.templateExercises.delete(id);

    // Cascade delete progression rules
    const rulesToDelete: string[] = [];
    for (const rule of this.progressionRules.values()) {
      if (rule.template_exercise_id === id) {
        rulesToDelete.push(rule.id);
      }
    }
    for (const ruleId of rulesToDelete) {
      this.progressionRules.delete(ruleId);
    }
  }

  async setTemplateExercises(
    templateId: string,
    exercises: TemplateExercise[]
  ): Promise<void> {
    // Delete existing
    const existing = await this.findTemplateExercises(templateId);
    for (const te of existing) {
      await this.deleteTemplateExercise(te.id);
    }
    // Create new
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
    return Array.from(this.progressionRules.values())
      .filter((r) => r.template_exercise_id === templateExerciseId)
      .map((r) => ({ ...r }))
      .sort((a, b) => a.priority - b.priority);
  }

  async findRulesByTemplateId(templateId: string): Promise<ProgressionRule[]> {
    const templateExercises = await this.findTemplateExercises(templateId);
    const teIds = new Set(templateExercises.map((te) => te.id));

    return Array.from(this.progressionRules.values())
      .filter((r) => teIds.has(r.template_exercise_id))
      .map((r) => ({ ...r }))
      .sort((a, b) => a.priority - b.priority);
  }

  async createProgressionRule(rule: ProgressionRule): Promise<ProgressionRule> {
    this.progressionRules.set(rule.id, { ...rule });
    return { ...rule };
  }

  async updateProgressionRule(rule: ProgressionRule): Promise<ProgressionRule> {
    this.progressionRules.set(rule.id, { ...rule });
    return { ...rule };
  }

  async deleteProgressionRule(id: string): Promise<void> {
    this.progressionRules.delete(id);
  }

  async setProgressionRules(
    templateExerciseId: string,
    rules: ProgressionRule[]
  ): Promise<void> {
    const existing = await this.findRulesByTemplateExerciseId(templateExerciseId);
    for (const r of existing) {
      await this.deleteProgressionRule(r.id);
    }
    for (const r of rules) {
      await this.createProgressionRule(r);
    }
  }

  // ==========================================================================
  // Program Blocks (Meso-Cycle Eras)
  // ==========================================================================

  async getActiveProgramBlock(): Promise<ProgramBlock | null> {
    const activeBlocks = Array.from(this.programBlocks.values())
      .filter((b) => b.end_date === null)
      .sort((a, b) => b.start_date.localeCompare(a.start_date));

    return activeBlocks.length > 0 ? { ...activeBlocks[0] } : null;
  }

  async findAllProgramBlocks(): Promise<ProgramBlock[]> {
    return Array.from(this.programBlocks.values())
      .map((b) => ({ ...b }))
      .sort((a, b) => b.start_date.localeCompare(a.start_date));
  }

  async findProgramBlocksByProgramId(programId: string): Promise<ProgramBlock[]> {
    return Array.from(this.programBlocks.values())
      .filter((b) => b.program_id === programId)
      .map((b) => ({ ...b }))
      .sort((a, b) => b.start_date.localeCompare(a.start_date));
  }

  async findProgramBlockById(id: string): Promise<ProgramBlock | null> {
    const b = this.programBlocks.get(id);
    return b ? { ...b } : null;
  }

  async createProgramBlock(block: ProgramBlock): Promise<ProgramBlock> {
    this.programBlocks.set(block.id, { ...block });
    return { ...block };
  }

  async updateProgramBlock(block: ProgramBlock): Promise<ProgramBlock> {
    this.programBlocks.set(block.id, { ...block });
    return { ...block };
  }

  async deleteProgramBlock(id: string): Promise<void> {
    this.programBlocks.delete(id);
  }
}
