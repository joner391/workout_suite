import { MockGearRepository } from '../MockGearRepository';
import { GearInventory } from '../../../core/types';

describe('MockGearRepository', () => {
  let repo: MockGearRepository;

  const standardBar: GearInventory = {
    id: 'bar_standard_20kg',
    name: 'Standard Olympic Barbell',
    type: 'barbell',
    tare_weight_kg: 20.0,
    cable_ratio: 1.0,
    is_default: true,
    notes: '20kg Olympic standard barbell',
  };

  const ssbBar: GearInventory = {
    id: 'bar_ssb_29kg',
    name: 'Safety Squat Bar',
    type: 'specialty_bar',
    tare_weight_kg: 29.0,
    cable_ratio: 1.0,
    is_default: false,
    notes: '29kg heavy duty SSB',
  };

  const functionalTrainerCable: GearInventory = {
    id: 'cable_trainer_2to1',
    name: 'Dual Pulley Functional Trainer',
    type: 'cable_machine',
    tare_weight_kg: 0.0,
    cable_ratio: 0.5,
    is_default: true,
    notes: '2:1 mechanical ratio (actual load is 0.5x pin weight)',
  };

  beforeEach(() => {
    repo = new MockGearRepository([
      standardBar,
      ssbBar,
      functionalTrainerCable,
    ]);
  });

  it('retrieves gear by id', async () => {
    const gear = await repo.findById('bar_standard_20kg');
    expect(gear).not.toBeNull();
    expect(gear?.tare_weight_kg).toBe(20.0);
  });

  it('returns null when gear id is not found', async () => {
    const gear = await repo.findById('unknown_gear');
    expect(gear).toBeNull();
  });

  it('retrieves all gear items', async () => {
    const all = await repo.findAll();
    expect(all).toHaveLength(3);
  });

  it('filters gear by type', async () => {
    const barbells = await repo.findByType('barbell');
    expect(barbells).toHaveLength(1);
    expect(barbells[0].id).toBe('bar_standard_20kg');

    const specialty = await repo.findByType('specialty_bar');
    expect(specialty).toHaveLength(1);
    expect(specialty[0].id).toBe('bar_ssb_29kg');

    const cables = await repo.findByType('cable_machine');
    expect(cables).toHaveLength(1);
    expect(cables[0].cable_ratio).toBe(0.5);
  });

  it('retrieves default gear items', async () => {
    const defaults = await repo.getDefaultGear();
    expect(defaults).toHaveLength(2);
    expect(defaults.every((g) => g.is_default)).toBe(true);
  });

  it('creates and persists new gear', async () => {
    const trapBar: GearInventory = {
      id: 'bar_trap_25kg',
      name: 'Trap Bar (Hex Bar)',
      type: 'specialty_bar',
      tare_weight_kg: 25.0,
      cable_ratio: 1.0,
      is_default: false,
      notes: 'Open hex bar',
    };

    const created = await repo.create(trapBar);
    expect(created.id).toBe('bar_trap_25kg');

    const fetched = await repo.findById('bar_trap_25kg');
    expect(fetched?.tare_weight_kg).toBe(25.0);
  });

  it('updates existing gear', async () => {
    const updated = await repo.update({
      ...standardBar,
      tare_weight_kg: 20.4,
      notes: 'Calibrated competition bar',
    });
    expect(updated.tare_weight_kg).toBe(20.4);

    const fetched = await repo.findById('bar_standard_20kg');
    expect(fetched?.tare_weight_kg).toBe(20.4);
  });

  it('throws an error when updating non-existent gear', async () => {
    await expect(
      repo.update({
        ...standardBar,
        id: 'fake_bar',
      })
    ).rejects.toThrow("Gear item with id 'fake_bar' not found");
  });

  it('deletes gear by id', async () => {
    await repo.delete('bar_ssb_29kg');
    const fetched = await repo.findById('bar_ssb_29kg');
    expect(fetched).toBeNull();
    const all = await repo.findAll();
    expect(all).toHaveLength(2);
  });

  it('preserves immutability', async () => {
    const item = await repo.findById('bar_standard_20kg');
    if (item) {
      item.tare_weight_kg = 999;
    }
    const fresh = await repo.findById('bar_standard_20kg');
    expect(fresh?.tare_weight_kg).toBe(20.0);
  });

  it('clears state on clear()', async () => {
    repo.clear();
    const all = await repo.findAll();
    expect(all).toHaveLength(0);
  });
});
