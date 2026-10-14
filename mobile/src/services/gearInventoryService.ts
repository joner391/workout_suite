/**
 * Workout Suite — Gear Inventory Application Service
 *
 * Implements Step 2.2: Gear & Equipment Inventory Management
 * Implements ADR-025: Equipment Mechanical Advantage Profiles
 * Implements ADR-026: Mechanical Load Normalization and Persistence Contract
 *
 * Responsibilities:
 * - CRUD orchestration for gear inventory items.
 * - Mechanical ratio resolution for cable stacks (1:1, 2:1, etc.).
 * - Barbell tare weight resolution (standard 20kg, technique 15kg, SSB 29kg, trap 25kg).
 * - Enforcing single-default-per-type constraint when setting default gear.
 */

import { IGearRepository } from '../domain/repositories/IGearRepository';
import { GearInventory, GearType } from '../core/types';

export class GearInventoryService {
  constructor(private readonly gearRepo: IGearRepository) {}

  /**
   * Retrieves all gear items in inventory, sorted alphabetically.
   */
  async getAllGear(): Promise<GearInventory[]> {
    return this.gearRepo.findAll();
  }

  /**
   * Retrieves gear items filtered by gear type.
   */
  async getGearByType(type: GearType): Promise<GearInventory[]> {
    return this.gearRepo.findByType(type);
  }

  /**
   * Retrieves a specific gear item by its ID.
   */
  async getGearById(id: string): Promise<GearInventory | null> {
    return this.gearRepo.findById(id);
  }

  /**
   * Creates a new gear inventory item.
   * If marked as default, clears default status from other items of the same type.
   */
  async createGear(
    item: Omit<GearInventory, 'id'> & { id?: string }
  ): Promise<GearInventory> {
    const id = item.id || `gear_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newGear: GearInventory = {
      id,
      name: item.name.trim(),
      type: item.type,
      tare_weight_kg: Math.max(0, item.tare_weight_kg ?? 0),
      cable_ratio: item.cable_ratio > 0 ? item.cable_ratio : 1.0,
      is_default: Boolean(item.is_default),
      notes: item.notes ? item.notes.trim() : null,
    };

    if (newGear.is_default) {
      await this.clearDefaultsForType(newGear.type);
    }

    return this.gearRepo.create(newGear);
  }

  /**
   * Updates an existing gear inventory item.
   * If marked as default, clears default status from other items of the same type.
   */
  async updateGear(item: GearInventory): Promise<GearInventory> {
    const updated: GearInventory = {
      ...item,
      name: item.name.trim(),
      tare_weight_kg: Math.max(0, item.tare_weight_kg ?? 0),
      cable_ratio: item.cable_ratio > 0 ? item.cable_ratio : 1.0,
      is_default: Boolean(item.is_default),
      notes: item.notes ? item.notes.trim() : null,
    };

    if (updated.is_default) {
      await this.clearDefaultsForType(updated.type, updated.id);
    }

    return this.gearRepo.update(updated);
  }

  /**
   * Deletes a gear inventory item by ID.
   */
  async deleteGear(id: string): Promise<void> {
    await this.gearRepo.delete(id);
  }

  /**
   * Designates a gear item as the default for its equipment type,
   * unsetting previous defaults of that type.
   */
  async setDefaultGear(id: string): Promise<GearInventory> {
    const target = await this.gearRepo.findById(id);
    if (!target) {
      throw new Error(`Gear item with id '${id}' not found`);
    }

    await this.clearDefaultsForType(target.type, target.id);
    target.is_default = true;
    return this.gearRepo.update(target);
  }

  /**
   * Resolves the mechanical advantage ratio for a cable exercise.
   * Priority:
   * 1. Gear-specific cable_ratio from inventory if gearId is provided.
   * 2. Default cable gear ratio for type 'cable_machine' if available.
   * 3. Fallback ratio passed in (e.g., exercise.default_cable_ratio or 1.0).
   */
  async resolveMechanicalAdvantage(
    gearId?: string | null,
    fallbackRatio: number = 1.0
  ): Promise<number> {
    if (gearId) {
      const gear = await this.gearRepo.findById(gearId);
      if (gear && gear.cable_ratio > 0) {
        return gear.cable_ratio;
      }
    }

    const defaultCables = await this.gearRepo.findByType('cable_machine');
    const defaultCable = defaultCables.find((g) => g.is_default);
    if (defaultCable && defaultCable.cable_ratio > 0) {
      return defaultCable.cable_ratio;
    }

    return fallbackRatio > 0 ? fallbackRatio : 1.0;
  }

  /**
   * Resolves barbell tare weight in kilograms.
   * Priority:
   * 1. Gear-specific tare_weight_kg if gearId is provided.
   * 2. Default barbell gear tare if available.
   * 3. Fallback tare passed in (e.g., exercise.default_bar_weight_kg or 20.0).
   */
  async resolveBarTareWeight(
    gearId?: string | null,
    fallbackTare: number = 20.0
  ): Promise<number> {
    if (gearId) {
      const gear = await this.gearRepo.findById(gearId);
      if (gear && gear.tare_weight_kg >= 0) {
        return gear.tare_weight_kg;
      }
    }

    const defaultBarbells = await this.gearRepo.findByType('barbell');
    const defaultBarbell = defaultBarbells.find((g) => g.is_default);
    if (defaultBarbell && defaultBarbell.tare_weight_kg >= 0) {
      return defaultBarbell.tare_weight_kg;
    }

    return fallbackTare >= 0 ? fallbackTare : 20.0;
  }

  /**
   * Clears default status on all items of a given type, optionally excluding one ID.
   */
  private async clearDefaultsForType(
    type: GearType,
    excludeId?: string
  ): Promise<void> {
    const existing = await this.gearRepo.findByType(type);
    for (const item of existing) {
      if (item.is_default && item.id !== excludeId) {
        await this.gearRepo.update({ ...item, is_default: false });
      }
    }
  }
}
