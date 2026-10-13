import { IGearRepository } from '../../domain/repositories/IGearRepository';
import { GearInventory, GearType } from '../../core/types';

/**
 * In-memory mock implementation of IGearRepository for testing gear tare and cable ratios.
 */
export class MockGearRepository implements IGearRepository {
  private gear: Map<string, GearInventory> = new Map();

  constructor(initialGear?: GearInventory[]) {
    if (initialGear) {
      this.seed(initialGear);
    }
  }

  /**
   * Clears all in-memory gear items.
   */
  public clear(): void {
    this.gear.clear();
  }

  /**
   * Seeds gear items into memory.
   */
  public seed(items: GearInventory[]): void {
    for (const item of items) {
      this.gear.set(item.id, { ...item });
    }
  }

  async findById(id: string): Promise<GearInventory | null> {
    const item = this.gear.get(id);
    return item ? { ...item } : null;
  }

  async findAll(): Promise<GearInventory[]> {
    return Array.from(this.gear.values()).map((g) => ({ ...g }));
  }

  async findByType(type: GearType): Promise<GearInventory[]> {
    return Array.from(this.gear.values())
      .filter((g) => g.type === type)
      .map((g) => ({ ...g }));
  }

  async getDefaultGear(): Promise<GearInventory[]> {
    return Array.from(this.gear.values())
      .filter((g) => g.is_default)
      .map((g) => ({ ...g }));
  }

  async create(gear: GearInventory): Promise<GearInventory> {
    const cloned = { ...gear };
    this.gear.set(cloned.id, cloned);
    return { ...cloned };
  }

  async update(gear: GearInventory): Promise<GearInventory> {
    if (!this.gear.has(gear.id)) {
      throw new Error(`Gear item with id '${gear.id}' not found`);
    }
    const cloned = { ...gear };
    this.gear.set(cloned.id, cloned);
    return { ...cloned };
  }

  async delete(id: string): Promise<void> {
    this.gear.delete(id);
  }
}
