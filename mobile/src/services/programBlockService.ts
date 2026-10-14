import { IProgramRepository, ProgramWithDetails } from '../domain/repositories/IProgramRepository';
import { Program, ProgramBlock, WorkoutTemplate } from '../core/types';

export interface ActiveProgramInfo {
  block: ProgramBlock;
  program: Program;
}

export interface ProgramBlockWithProgram extends ProgramBlock {
  program_name: string;
  color_hex: string;
}

/**
 * Service orchestrating meso-cycle training eras, 1-tap active program swapping,
 * and date-based program era lookups for synchronized chart shading and calendar badges.
 *
 * Implements ADR-006 (Meso-Cycle Program Era Tracking) and ADR-017 (Multi-Day Program Hierarchy).
 */
export class ProgramBlockService {
  constructor(private readonly programRepo: IProgramRepository) {}

  /**
   * Retrieves the currently active program block along with its parent program entity.
   * Returns null if no program block is currently active (end_date IS NULL).
   */
  async getActiveProgram(): Promise<ActiveProgramInfo | null> {
    const activeBlock = await this.programRepo.getActiveProgramBlock();
    if (!activeBlock) {
      return null;
    }

    const program = await this.programRepo.findById(activeBlock.program_id);
    if (!program) {
      return null;
    }

    return {
      block: activeBlock,
      program,
    };
  }

  /**
   * Performs 1-tap program swapping.
   * Closes any currently active program block by setting its end_date to the new block's start_date,
   * and opens a new program block with end_date = null.
   *
   * @param programId ID of the program to activate
   * @param startDate Optional ISO8601 YYYY-MM-DD start date. Defaults to current date.
   * @returns The newly created active ProgramBlock.
   */
  async swapActiveProgram(
    programId: string,
    startDate?: string
  ): Promise<ProgramBlock> {
    const program = await this.programRepo.findById(programId);
    if (!program) {
      throw new Error(`Program not found with id: ${programId}`);
    }

    const effectiveStartDate =
      startDate ?? new Date().toISOString().slice(0, 10);

    // Check if there is an active block
    const activeBlock = await this.programRepo.getActiveProgramBlock();
    if (activeBlock) {
      // If already active for the same program, no-op and return current block
      if (activeBlock.program_id === programId) {
        return activeBlock;
      }

      // Close the previous block on the start date of the new block
      activeBlock.end_date = effectiveStartDate;
      await this.programRepo.updateProgramBlock(activeBlock);
    }

    // Open a new program block
    const newBlockId = `block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newBlock: ProgramBlock = {
      id: newBlockId,
      program_id: programId,
      start_date: effectiveStartDate,
      end_date: null,
    };

    return await this.programRepo.createProgramBlock(newBlock);
  }

  /**
   * Closes the currently active program block without activating a new one.
   *
   * @param endDate Optional ISO8601 YYYY-MM-DD end date. Defaults to current date.
   * @returns The updated closed ProgramBlock or null if none was active.
   */
  async closeActiveProgram(endDate?: string): Promise<ProgramBlock | null> {
    const activeBlock = await this.programRepo.getActiveProgramBlock();
    if (!activeBlock) {
      return null;
    }

    const effectiveEndDate =
      endDate ?? new Date().toISOString().slice(0, 10);
    activeBlock.end_date = effectiveEndDate;
    return await this.programRepo.updateProgramBlock(activeBlock);
  }

  /**
   * Retrieves all historical and current program blocks enriched with the program's
   * display name and accent color_hex.
   */
  async getAllProgramBlocks(): Promise<ProgramBlockWithProgram[]> {
    const blocks = await this.programRepo.findAllProgramBlocks();
    const programs = await this.programRepo.findAll();
    const programMap = new Map(programs.map((p) => [p.id, p]));

    return blocks.map((b) => {
      const p = programMap.get(b.program_id);
      return {
        ...b,
        program_name: p?.name ?? 'Unknown Program',
        color_hex: p?.color_hex ?? '#3B82F6',
      };
    });
  }

  /**
   * Finds the program block that was active on a given date (YYYY-MM-DD).
   * Used by calendar session badges and longitudinal charts to resolve the active meso-cycle.
   */
  async getBlockForDate(date: string): Promise<ProgramBlockWithProgram | null> {
    const allBlocks = await this.getAllProgramBlocks();

    // Filter blocks where start_date <= date and (end_date is null or end_date >= date)
    const matching = allBlocks.filter((b) => {
      const startsBeforeOrOn = b.start_date <= date;
      const endsAfterOrOn = b.end_date === null || b.end_date >= date;
      return startsBeforeOrOn && endsAfterOrOn;
    });

    if (matching.length === 0) {
      return null;
    }

    // Sort by start_date DESC to return the most recently initiated block
    matching.sort((a, b) => b.start_date.localeCompare(a.start_date));
    return matching[0];
  }

  /**
   * Convenience helper to retrieve all workout templates associated with the active program.
   */
  async getActiveTemplates(): Promise<WorkoutTemplate[]> {
    const active = await this.getActiveProgram();
    if (!active) {
      return [];
    }
    return await this.programRepo.findTemplatesByProgramId(active.program.id);
  }

  /**
   * Retrieves full details (templates, exercises, progression rules) of the currently active program.
   */
  async getActiveProgramDetail(): Promise<ProgramWithDetails | null> {
    const active = await this.getActiveProgram();
    if (!active) {
      return null;
    }
    return await this.programRepo.getProgramWithDetails(active.program.id);
  }
}
