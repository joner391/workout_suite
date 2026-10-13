import { IGearRepository } from '../../domain/repositories/IGearRepository';
import { GearInventory, GearType } from '../../core/types';
import { ISQLiteDatabase } from '../schema';

interface GearRow {
  id: string;
  name: string;
  type: GearType;
  tare_weight_kg: number;
  cable_ratio: number;
  is_default: number;
  notes: string | null;
}

function mapRowToGear(row: GearRow): GearInventory {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    tare_weight_kg: row.tare_weight_kg,
    cable_ratio: row.cable_ratio,
    is_default: row.is_default === 1,
    notes: row.notes,
  };
}

/**
 * Concrete SQLite implementation of IGearRepository for equipment inventory management.
 */
export class SQLiteGearRepository implements IGearRepository {
  constructor(private readonly db: ISQLiteDatabase) {}

  async findById(id: string): Promise<GearInventory | null> {
    const row = await this.db.getFirstAsync<GearRow>(
      'SELECT * FROM gear_inventory WHERE id = ?;',
      id
    );
    return row ? mapRowToGear(row) : null;
  }

  async findAll(): Promise<GearInventory[]> {
    const rows = await this.db.getAllAsync<GearRow>(
      'SELECT * FROM gear_inventory ORDER BY name ASC;'
    );
    return rows.map(mapRowToGear);
  }

  async findByType(type: GearType): Promise<GearInventory[]> {
    const rows = await this.db.getAllAsync<GearRow>(
      'SELECT * FROM gear_inventory WHERE type = ? ORDER BY name ASC;',
      type
    );
    return rows.map(mapRowToGear);
  }

  async getDefaultGear(): Promise<GearInventory[]> {
    const rows = await this.db.getAllAsync<GearRow>(
      'SELECT * FROM gear_inventory WHERE is_default = 1 ORDER BY name ASC;'
    );
    return rows.map(mapRowToGear);
  }

  async create(gear: GearInventory): Promise<GearInventory> {
    await this.db.runAsync(
      `INSERT INTO gear_inventory (
        id, name, type, tare_weight_kg, cable_ratio, is_default, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      gear.id,
      gear.name,
      gear.type,
      gear.tare_weight_kg,
      gear.cable_ratio,
      gear.is_default ? 1 : 0,
      gear.notes
    );
    return { ...gear };
  }

  async update(gear: GearInventory): Promise<GearInventory> {
    const res = await this.db.runAsync(
      `UPDATE gear_inventory SET
        name = ?, type = ?, tare_weight_kg = ?, cable_ratio = ?,
        is_default = ?, notes = ?
      WHERE id = ?;`,
      gear.name,
      gear.type,
      gear.tare_weight_kg,
      gear.cable_ratio,
      gear.is_default ? 1 : 0,
      gear.notes,
      gear.id
    );

    if (res.changes === 0) {
      throw new Error(`Gear item with id '${gear.id}' not found`);
    }
    return { ...gear };
  }

  async delete(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM gear_inventory WHERE id = ?;', id);
  }
}
