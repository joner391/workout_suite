import { SQLiteProgramRepository } from '../SQLiteProgramRepository';
import { MockSQLiteDatabase } from '../../__tests__/MockSQLiteDatabase';
import {
  Program,
  WorkoutTemplate,
  TemplateExercise,
  ProgressionRule,
  ProgramBlock,
  SynthesizedProgram,
} from '../../../core/types';

describe('SQLiteProgramRepository', () => {
  let mockDb: MockSQLiteDatabase;
  let repo: SQLiteProgramRepository;

  const sampleProgramRow = {
    id: 'prog_1',
    name: 'Push Pull Legs',
    color_hex: '#EF4444',
    notes: 'Hypertrophy meso-cycle',
    created_at: '2026-10-01T10:00:00Z',
  };

  const sampleTemplateRow = {
    id: 'tmpl_push',
    program_id: 'prog_1',
    name: 'Push Day',
    notes: null,
    order_index: 0,
    created_at: '2026-10-01T10:05:00Z',
  };

  const sampleTemplateExerciseRow = {
    rest_seconds: 45,
    rest_pause_json: JSON.stringify({ mini_sets: 2, mini_reps_min: 3, mini_reps_max: 5, rest_seconds: 30 }),
    id: 'te_1',
    template_id: 'tmpl_push',
    exercise_id: 'barbell_bench_press',
    gear_id: 'bar_olympic',
    target_sets: 3,
    target_reps_min: 8,
    target_reps_max: 12,
    target_rpe: 8.5,
    target_rir: 1.5,
    order_index: 0,
    exercise_group_id: null,
  };

  const sampleRuleRow = {
    id: 'rule_1',
    template_exercise_id: 'te_1',
    priority: 1,
    rule_json: JSON.stringify({
      conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
      actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
    }),
  };

  const sampleBlockRow = {
    id: 'block_1',
    program_id: 'prog_1',
    start_date: '2026-10-01',
    end_date: null,
  };

  beforeEach(() => {
    mockDb = new MockSQLiteDatabase();
    repo = new SQLiteProgramRepository(mockDb);
  });

  describe('Programs', () => {
    it('retrieves program by id', async () => {
      mockDb.mockData.set('FROM programs WHERE id = ?;', [sampleProgramRow]);

      const result = await repo.findById('prog_1');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('prog_1');
      expect(result?.name).toBe('Push Pull Legs');
      expect(result?.color_hex).toBe('#EF4444');
    });

    it('returns null if program not found', async () => {
      const result = await repo.findById('missing');
      expect(result).toBeNull();
    });

    it('finds all programs', async () => {
      mockDb.mockData.set('FROM programs ORDER BY created_at DESC;', [
        sampleProgramRow,
      ]);

      const result = await repo.findAll();
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('prog_1');
    });

    it('creates a program with correct sql parameters', async () => {
      const newProgram: Program = {
        id: 'prog_2',
        name: 'Upper Lower',
        color_hex: '#3B82F6',
        notes: null,
        created_at: '2026-10-02T10:00:00Z',
      };

      await repo.create(newProgram);
      const insertQuery = mockDb.executedQueries.find((q) =>
        q.sql.includes('INSERT INTO programs')
      );
      expect(insertQuery).toBeDefined();
      expect(insertQuery?.params).toEqual([
        'prog_2',
        'Upper Lower',
        '#3B82F6',
        null,
        '2026-10-02T10:00:00Z',
      ]);
    });

    it('updates a program', async () => {
      const programToUpdate: Program = {
        id: 'prog_1',
        name: 'Push Pull Legs Advanced',
        color_hex: '#10B981',
        notes: 'Updated notes',
        created_at: '2026-10-01T10:00:00Z',
      };

      await repo.update(programToUpdate);
      const updateQuery = mockDb.executedQueries.find((q) =>
        q.sql.includes('UPDATE programs SET')
      );
      expect(updateQuery).toBeDefined();
      expect(updateQuery?.params).toEqual([
        'Push Pull Legs Advanced',
        '#10B981',
        'Updated notes',
        'prog_1',
      ]);
    });

    it('deletes a program by id and cleans up child entities and decouples historical workouts', async () => {
      await repo.delete('prog_1');
      const nullifyWorkoutsQuery = mockDb.executedQueries.find((q) =>
        q.sql.includes('UPDATE workouts SET template_id = NULL')
      );
      expect(nullifyWorkoutsQuery).toBeDefined();
      const deleteQuery = mockDb.executedQueries.find((q) =>
        q.sql.includes('DELETE FROM programs WHERE id = ?;')
      );
      expect(deleteQuery).toBeDefined();
      expect(deleteQuery?.params).toEqual(['prog_1']);
    });
  });

  describe('Workout Templates', () => {
    it('retrieves templates by program_id', async () => {
      mockDb.mockData.set('WHERE program_id = ? ORDER BY order_index ASC;', [
        sampleTemplateRow,
      ]);

      const templates = await repo.findTemplatesByProgramId('prog_1');
      expect(templates.length).toBe(1);
      expect(templates[0].id).toBe('tmpl_push');
      expect(templates[0].name).toBe('Push Day');
    });

    it('creates and updates workout templates', async () => {
      const template: WorkoutTemplate = {
        id: 'tmpl_push',
        program_id: 'prog_1',
        name: 'Push Day',
        notes: null,
        order_index: 0,
        created_at: '2026-10-01T10:05:00Z',
      };

      await repo.createTemplate(template);
      expect(
        mockDb.executedQueries.some((q) =>
          q.sql.includes('INSERT INTO workout_templates')
        )
      ).toBe(true);

      await repo.updateTemplate(template);
      expect(
        mockDb.executedQueries.some((q) =>
          q.sql.includes('UPDATE workout_templates SET')
        )
      ).toBe(true);

      await repo.deleteTemplate('tmpl_push');
      expect(
        mockDb.executedQueries.some((q) =>
          q.sql.includes('DELETE FROM workout_templates WHERE id = ?;')
        )
      ).toBe(true);
    });
  });

  describe('Template Exercises and Progression Rules', () => {
    it('retrieves template exercises and maps numeric fields', async () => {
      mockDb.mockData.set(
        'FROM template_exercises WHERE template_id = ? ORDER BY order_index ASC;',
        [sampleTemplateExerciseRow]
      );

      const exercises = await repo.findTemplateExercises('tmpl_push');
      expect(exercises.length).toBe(1);
      expect(exercises[0].exercise_id).toBe('barbell_bench_press');
      expect(exercises[0].target_sets).toBe(3);
      expect(exercises[0].target_rpe).toBe(8.5);
        expect(exercises[0].rest_seconds).toBe(45);
        expect(exercises[0].rest_pause?.rest_seconds).toBe(30);
    });

    it('retrieves and parses progression rules from JSON string', async () => {
      mockDb.mockData.set(
        'FROM progression_rules WHERE template_exercise_id = ? ORDER BY priority ASC;',
        [sampleRuleRow]
      );

      const rules = await repo.findRulesByTemplateExerciseId('te_1');
      expect(rules.length).toBe(1);
      expect(rules[0].id).toBe('rule_1');
      expect(typeof rules[0].rule_json).toBe('object');
      expect((rules[0].rule_json as any).conditions[0].type).toBe(
        'ALL_SETS_HIT_TARGET_REPS'
      );
    });

    it('sets template exercises by deleting and inserting', async () => {
      const exercise: TemplateExercise = {
        id: 'te_1',
        template_id: 'tmpl_push',
        exercise_id: 'barbell_bench_press',
        gear_id: null,
        target_sets: 3,
        target_reps_min: 8,
        target_reps_max: 12,
        target_rpe: 8,
        target_rir: 2,
        order_index: 0,
        exercise_group_id: null,
      };

      await repo.setTemplateExercises('tmpl_push', [exercise]);

      expect(
        mockDb.executedQueries.some((q) =>
          q.sql.includes('DELETE FROM template_exercises WHERE template_id = ?;')
        )
      ).toBe(true);
      expect(
        mockDb.executedQueries.some((q) =>
          q.sql.includes('INSERT INTO template_exercises')
        )
      ).toBe(true);
    });
  });

  describe('Program Blocks', () => {
    it('finds active program block', async () => {
      mockDb.mockData.set('WHERE end_date IS NULL ORDER BY start_date DESC LIMIT 1;', [
        sampleBlockRow,
      ]);

      const active = await repo.getActiveProgramBlock();
      expect(active).not.toBeNull();
      expect(active?.id).toBe('block_1');
      expect(active?.end_date).toBeNull();
    });

    it('creates, updates, and deletes program blocks', async () => {
      const block: ProgramBlock = {
        id: 'block_1',
        program_id: 'prog_1',
        start_date: '2026-10-01',
        end_date: null,
      };

      await repo.createProgramBlock(block);
      expect(
        mockDb.executedQueries.some((q) =>
          q.sql.includes('INSERT INTO program_blocks')
        )
      ).toBe(true);

      await repo.updateProgramBlock({
        ...block,
        end_date: '2026-10-31',
      });
      expect(
        mockDb.executedQueries.some((q) =>
          q.sql.includes('UPDATE program_blocks SET')
        )
      ).toBe(true);

      await repo.deleteProgramBlock('block_1');
      expect(
        mockDb.executedQueries.some((q) =>
          q.sql.includes('DELETE FROM program_blocks WHERE id = ?;')
        )
      ).toBe(true);
    });
  });

  describe('saveSynthesizedProgram', () => {
    it('executes INSERT OR REPLACE for all program, template, exercise, and rule entities', async () => {
      const synthesized: SynthesizedProgram = {
        program: {
          id: 'prog_synth',
          name: 'Full Body Minimalist',
          color_hex: '#10B981',
          notes: 'Synthesized split',
          created_at: '2026-10-01T10:00:00Z',
        },
        templates: [
          {
            id: 'tmpl_1',
            program_id: 'prog_synth',
            name: 'Day A',
            notes: null,
            order_index: 0,
            created_at: '2026-10-01T10:00:00Z',
          },
        ],
        templateExercises: [
          {
            id: 'te_1',
            template_id: 'tmpl_1',
            exercise_id: 'barbell_squat',
            gear_id: null,
            target_sets: 3,
            target_reps_min: 5,
            target_reps_max: 8,
            target_rpe: 8,
            target_rir: 2,
            order_index: 0,
            exercise_group_id: null,
          },
        ],
        progressionRules: [
          {
            id: 'rule_1',
            template_exercise_id: 'te_1',
            priority: 1,
            rule_json: {
              conditions: [{ type: 'ALL_SETS_HIT_TARGET_REPS' }],
              actions: [{ type: 'INCREASE_LOAD_FIXED', value: 2.5 }],
            },
          },
        ],
        summary: {
          splitType: 'full_body',
          daysPerWeek: 3,
          estimatedSessionDurationMins: 45,
          totalWeeklySets: 9,
          hasSupersets: false,
          progressionSchemeSummary: 'Linear Progression',
        },
      };

      await repo.saveSynthesizedProgram(synthesized);

      expect(
        mockDb.executedQueries.some((q) =>
          q.sql.includes('INSERT OR REPLACE INTO programs')
        )
      ).toBe(true);
      expect(
        mockDb.executedQueries.some((q) =>
          q.sql.includes('INSERT OR REPLACE INTO workout_templates')
        )
      ).toBe(true);
      expect(
        mockDb.executedQueries.some((q) =>
          q.sql.includes('INSERT OR REPLACE INTO template_exercises')
        )
      ).toBe(true);
      expect(
        mockDb.executedQueries.some((q) =>
          q.sql.includes('INSERT OR REPLACE INTO progression_rules')
        )
      ).toBe(true);
    });
  });
});
