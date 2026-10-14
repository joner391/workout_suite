import { ProgramBlockService } from '../programBlockService';
import { MockProgramRepository } from '../../database/mocks/MockProgramRepository';
import { Program, WorkoutTemplate } from '../../core/types';

describe('ProgramBlockService', () => {
  let mockRepo: MockProgramRepository;
  let service: ProgramBlockService;

  const progA: Program = {
    id: 'prog_ppl',
    name: 'Push Pull Legs',
    color_hex: '#EF4444',
    notes: 'Hypertrophy Meso 1',
    created_at: '2026-10-01T10:00:00Z',
  };

  const progB: Program = {
    id: 'prog_upper_lower',
    name: 'Upper Lower Split',
    color_hex: '#3B82F6',
    notes: 'Strength Meso 2',
    created_at: '2026-10-15T10:00:00Z',
  };

  const tmplA1: WorkoutTemplate = {
    id: 'tmpl_push',
    program_id: 'prog_ppl',
    name: 'Push Day',
    notes: null,
    order_index: 0,
    created_at: '2026-10-01T10:00:00Z',
  };

  const tmplA2: WorkoutTemplate = {
    id: 'tmpl_pull',
    program_id: 'prog_ppl',
    name: 'Pull Day',
    notes: null,
    order_index: 1,
    created_at: '2026-10-01T10:00:00Z',
  };

  beforeEach(async () => {
    mockRepo = new MockProgramRepository();
    service = new ProgramBlockService(mockRepo);

    await mockRepo.create(progA);
    await mockRepo.create(progB);
    await mockRepo.createTemplate(tmplA1);
    await mockRepo.createTemplate(tmplA2);
  });

  describe('getActiveProgram', () => {
    it('returns null when no program block has been initiated', async () => {
      const active = await service.getActiveProgram();
      expect(active).toBeNull();
    });

    it('returns active block and parent program details', async () => {
      await service.swapActiveProgram('prog_ppl', '2026-10-01');

      const active = await service.getActiveProgram();
      expect(active).not.toBeNull();
      expect(active?.program.id).toBe('prog_ppl');
      expect(active?.program.name).toBe('Push Pull Legs');
      expect(active?.program.color_hex).toBe('#EF4444');
      expect(active?.block.start_date).toBe('2026-10-01');
      expect(active?.block.end_date).toBeNull();
    });
  });

  describe('swapActiveProgram (1-tap program swapping)', () => {
    it('throws error when activating non-existent program', async () => {
      await expect(
        service.swapActiveProgram('non_existent', '2026-10-01')
      ).rejects.toThrow('Program not found with id: non_existent');
    });

    it('creates first active block when no prior block existed', async () => {
      const block = await service.swapActiveProgram('prog_ppl', '2026-10-01');

      expect(block.program_id).toBe('prog_ppl');
      expect(block.start_date).toBe('2026-10-01');
      expect(block.end_date).toBeNull();

      const active = await service.getActiveProgram();
      expect(active?.block.id).toBe(block.id);
    });

    it('closes previous block and opens new block upon swapping programs', async () => {
      // 1. Activate Program A
      const blockA = await service.swapActiveProgram('prog_ppl', '2026-10-01');
      expect(blockA.end_date).toBeNull();

      // 2. 1-Tap Swap to Program B on 2026-10-15
      const blockB = await service.swapActiveProgram('prog_upper_lower', '2026-10-15');

      expect(blockB.program_id).toBe('prog_upper_lower');
      expect(blockB.start_date).toBe('2026-10-15');
      expect(blockB.end_date).toBeNull();

      // Verify Program A block was closed on 2026-10-15
      const closedBlockA = await mockRepo.findProgramBlockById(blockA.id);
      expect(closedBlockA?.end_date).toBe('2026-10-15');

      // Verify active program is now Program B
      const currentActive = await service.getActiveProgram();
      expect(currentActive?.program.id).toBe('prog_upper_lower');
    });

    it('is idempotent when activating the program that is already active', async () => {
      const blockA = await service.swapActiveProgram('prog_ppl', '2026-10-01');

      const reBlockA = await service.swapActiveProgram('prog_ppl', '2026-10-05');
      expect(reBlockA.id).toBe(blockA.id);
      expect(reBlockA.end_date).toBeNull();

      const allBlocks = await mockRepo.findAllProgramBlocks();
      expect(allBlocks.length).toBe(1);
    });

    it('defaults startDate to today (ISO YYYY-MM-DD) if omitted', async () => {
      const block = await service.swapActiveProgram('prog_ppl');
      const today = new Date().toISOString().slice(0, 10);
      expect(block.start_date).toBe(today);
    });
  });

  describe('closeActiveProgram', () => {
    it('returns null if no program is currently active', async () => {
      const result = await service.closeActiveProgram();
      expect(result).toBeNull();
    });

    it('closes the active program block with effective end date', async () => {
      await service.swapActiveProgram('prog_ppl', '2026-10-01');

      const closed = await service.closeActiveProgram('2026-10-20');
      expect(closed).not.toBeNull();
      expect(closed?.end_date).toBe('2026-10-20');

      const activeAfterClose = await service.getActiveProgram();
      expect(activeAfterClose).toBeNull();
    });
  });

  describe('getAllProgramBlocks & getBlockForDate', () => {
    it('enriches program blocks with program name and color_hex', async () => {
      await service.swapActiveProgram('prog_ppl', '2026-10-01');
      await service.swapActiveProgram('prog_upper_lower', '2026-10-15');

      const allBlocks = await service.getAllProgramBlocks();
      expect(allBlocks.length).toBe(2);

      const blockUpper = allBlocks.find((b) => b.program_id === 'prog_upper_lower');
      expect(blockUpper?.program_name).toBe('Upper Lower Split');
      expect(blockUpper?.color_hex).toBe('#3B82F6');

      const blockPpl = allBlocks.find((b) => b.program_id === 'prog_ppl');
      expect(blockPpl?.program_name).toBe('Push Pull Legs');
      expect(blockPpl?.color_hex).toBe('#EF4444');
    });

    it('finds the active block covering a specific date', async () => {
      await service.swapActiveProgram('prog_ppl', '2026-10-01');
      await service.swapActiveProgram('prog_upper_lower', '2026-10-15');

      // Date before any block
      const beforeAll = await service.getBlockForDate('2026-09-25');
      expect(beforeAll).toBeNull();

      // Date during Program A era
      const duringA = await service.getBlockForDate('2026-10-08');
      expect(duringA?.program_id).toBe('prog_ppl');
      expect(duringA?.color_hex).toBe('#EF4444');

      // Date during Program B era (transition date 2026-10-15)
      const transitionDay = await service.getBlockForDate('2026-10-15');
      expect(transitionDay?.program_id).toBe('prog_upper_lower');

      // Future/ongoing date during open-ended Program B
      const ongoing = await service.getBlockForDate('2026-11-01');
      expect(ongoing?.program_id).toBe('prog_upper_lower');
    });
  });

  describe('getActiveTemplates & getActiveProgramDetail', () => {
    it('returns empty array for getActiveTemplates if no active program', async () => {
      const templates = await service.getActiveTemplates();
      expect(templates).toEqual([]);
    });

    it('returns templates ordered by order_index for active program', async () => {
      await service.swapActiveProgram('prog_ppl', '2026-10-01');

      const templates = await service.getActiveTemplates();
      expect(templates.length).toBe(2);
      expect(templates[0].id).toBe('tmpl_push');
      expect(templates[1].id).toBe('tmpl_pull');
    });

    it('returns full program details for active program', async () => {
      await service.swapActiveProgram('prog_ppl', '2026-10-01');

      const detail = await service.getActiveProgramDetail();
      expect(detail).not.toBeNull();
      expect(detail?.program.id).toBe('prog_ppl');
      expect(detail?.templates.length).toBe(2);
    });
  });
});
