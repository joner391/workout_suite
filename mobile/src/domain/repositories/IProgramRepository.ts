import {
  Program,
  WorkoutTemplate,
  TemplateExercise,
  ProgressionRule,
  ProgramBlock,
  SynthesizedProgram,
} from '../../core/types';

export interface TemplateExerciseDetail extends TemplateExercise {
  rules: ProgressionRule[];
}

export interface WorkoutTemplateDetail extends WorkoutTemplate {
  exercises: TemplateExerciseDetail[];
}

export interface ProgramWithDetails {
  program: Program;
  templates: WorkoutTemplateDetail[];
}

/**
 * Repository interface defining CRUD and aggregate querying for programs,
 * workout templates, template exercises, progression rules, and program blocks.
 */
export interface IProgramRepository {
  // Programs
  findById(id: string): Promise<Program | null>;
  findAll(): Promise<Program[]>;
  create(program: Program): Promise<Program>;
  update(program: Program): Promise<Program>;
  delete(id: string): Promise<void>;
  getProgramWithDetails(programId: string): Promise<ProgramWithDetails | null>;
  saveSynthesizedProgram(synthesized: SynthesizedProgram): Promise<void>;

  // Workout Templates
  findTemplateById(id: string): Promise<WorkoutTemplate | null>;
  findTemplatesByProgramId(programId: string): Promise<WorkoutTemplate[]>;
  findAllTemplates(): Promise<WorkoutTemplate[]>;
  createTemplate(template: WorkoutTemplate): Promise<WorkoutTemplate>;
  updateTemplate(template: WorkoutTemplate): Promise<WorkoutTemplate>;
  deleteTemplate(id: string): Promise<void>;
  getTemplateWithDetails(templateId: string): Promise<WorkoutTemplateDetail | null>;

  // Template Exercises
  findTemplateExercises(templateId: string): Promise<TemplateExercise[]>;
  findTemplateExerciseById(id: string): Promise<TemplateExercise | null>;
  createTemplateExercise(exercise: TemplateExercise): Promise<TemplateExercise>;
  updateTemplateExercise(exercise: TemplateExercise): Promise<TemplateExercise>;
  deleteTemplateExercise(id: string): Promise<void>;
  setTemplateExercises(templateId: string, exercises: TemplateExercise[]): Promise<void>;

  // Progression Rules
  findRulesByTemplateExerciseId(templateExerciseId: string): Promise<ProgressionRule[]>;
  findRulesByTemplateId(templateId: string): Promise<ProgressionRule[]>;
  createProgressionRule(rule: ProgressionRule): Promise<ProgressionRule>;
  updateProgressionRule(rule: ProgressionRule): Promise<ProgressionRule>;
  deleteProgressionRule(id: string): Promise<void>;
  setProgressionRules(templateExerciseId: string, rules: ProgressionRule[]): Promise<void>;

  // Program Blocks (Meso-Cycle Eras)
  getActiveProgramBlock(): Promise<ProgramBlock | null>;
  findAllProgramBlocks(): Promise<ProgramBlock[]>;
  findProgramBlocksByProgramId(programId: string): Promise<ProgramBlock[]>;
  findProgramBlockById(id: string): Promise<ProgramBlock | null>;
  createProgramBlock(block: ProgramBlock): Promise<ProgramBlock>;
  updateProgramBlock(block: ProgramBlock): Promise<ProgramBlock>;
  deleteProgramBlock(id: string): Promise<void>;
}
