import { SQLiteGearRepository } from '../SQLiteGearRepository';
import { MockSQLiteDatabase } from '../../__tests__/MockSQLiteDatabase';
import { GearInventory } from '../../../core/types';

describe('SQLiteGearRepository', () => {
  let mockDb: MockSQLiteDatabase;
  let repo: SQLiteGearRepository;

  const sampleGearRow = {
    id: 'bar_olympic_20kg',
    name: 'Olympic Barbell',
    type: 'barbell' as const,
    tare_weight_kg: 20.0,
    cable_ratio: 1.0,
    is_default: 1,
    notes: 'Competition spec',
  };

  const sampleGear: GearInventory = {
    id: 'bar_olympic_20kg',
    name: 'Olympic Barbell',
    type: 'barbell',
    tare_weight_kg: 20.0,
    cable_ratio: 1.0,
    is_default: true,
    notes: 'Competition spec',
  };

  beforeEach(() => {
    mockDb = new MockSQLiteDatabase();
    repo = new SQLiteGearRepository(mockDb);
  });

  it('retrieves gear by id with boolean mapping', async () => {
    mockDb.mockData.set('WHERE id = ?;', [sampleGearRow]);

    const result = await repo.findById('bar_olympic_20kg');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('bar_olympic_20kg');
    expect(result?.is_default).toBe(true);
    expect(result?.tare_weight_kg).toBe(20.0);
  });

  it('returns null if gear is not found', async () => {
    const result = await repo.findById('unknown');
    expect(result).toBeNull();
  });

  it('retrieves all gear items', async () => {
    mockDb.mockData.set('SELECT * FROM gear_inventory', [sampleGearRow]);

    const results = await repo.findAll();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Olympic Barbell');
  });

  it('filters gear by type', async () => {
    mockDb.mockData.set('WHERE type = ?', [sampleGearRow]);

    const results = await repo.findByType('barbell');
    expect(results).toHaveLength(1);
    expect(mockDb.executedQueries[0].params).toEqual(['barbell']);
  });

  it('retrieves default gear items where is_default = 1', async () => {
    mockDb.mockData.set('WHERE is_default = 1', [sampleGearRow]);

    const results = await repo.getDefaultGear();
    expect(results).toHaveLength(1);
    expect(mockDb.executedQueries[0].sql).toContain('WHERE is_default = 1');
  });

  it('creates and persists new gear item', async () => {
    await repo.create(sampleGear);

    expect(mockDb.executedQueries[0].sql).toContain('INSERT INTO gear_inventory');
    expect(mockDb.executedQueries[0].params).toContain('bar_olympic_20kg');
    expect(mockDb.executedQueries[0].params).toContain(1); // is_default boolean mapped to 1
  });

  it('updates an existing gear item', async () => {
    mockDb.defaultChanges = 1;
    const updated = await repo.update(sampleGear);
    expect(updated.id).toBe('bar_olympic_20kg');

    expect(mockDb.executedQueries[0].sql).toContain('UPDATE gear_inventory SET');
    expect(mockDb.executedQueries[0].params).toContain('bar_olympic_20kg');
  });

  it('throws error when updating non-existent gear item', async () => {
    mockDb.defaultChanges = 0;
    await expect(repo.update(sampleGear)).rejects.toThrow(
      "Gear item with id 'bar_olympic_20kg' not found"
    );
  });

  it('deletes gear by id', async () => {
    await repo.delete('bar_olympic_20kg');
    expect(mockDb.executedQueries[0].sql).toBe(
      'DELETE FROM gear_inventory WHERE id = ?;'
    );
    expect(mockDb.executedQueries[0].params).toEqual(['bar_olympic_20kg']);
  });
});
