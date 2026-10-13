import { GearInventory, GearType } from '../../core/types';

/**
 * Repository interface for managing gear inventory (specialty barbells, cable ratios).
 */
export interface IGearRepository {
  /**
   * Retrieves a gear item by its unique ID.
   */
  findById(id: string): Promise<GearInventory | null>;

  /**
   * Retrieves all gear items in inventory.
   */
  findAll(): Promise<GearInventory[]>;

  /**
   * Retrieves gear items filtered by gear type.
   */
  findByType(type: GearType): Promise<GearInventory[]>;

  /**
   * Retrieves all default gear items (is_default === true).
   */
  getDefaultGear(): Promise<GearInventory[]>;

  /**
   * Persists a new gear inventory item.
   */
  create(gear: GearInventory): Promise<GearInventory>;

  /**
   * Updates an existing gear item.
   */
  update(gear: GearInventory): Promise<GearInventory>;

  /**
   * Deletes a gear inventory item by its unique ID.
   */
  delete(id: string): Promise<void>;
}
