import { GearInventoryService } from '../gearInventoryService';
import { MockGearRepository } from '../../database/mocks/MockGearRepository';
import { GearInventory } from '../../core/types';

describe('GearInventoryService', () => {
  let gearRepo: MockGearRepository;
  let service: GearInventoryService;

  const mockGearList: GearInventory[] = [
    {
      id: 'gear_bar_olympic',
      name: 'Olympic Barbell (20 kg)',
      type: 'barbell',
      tare_weight_kg: 20.0,
      cable_ratio: 1.0,
      is_default: true,
      notes: 'Standard gym bar',
    },
    {
      id: 'gear_bar_technique',
      name: 'Technique Bar (15 kg)',
      type: 'barbell',
      tare_weight_kg: 15.0,
      cable_ratio: 1.0,
      is_default: false,
      notes: null,
    },
    {
      id: 'gear_cable_standard',
      name: 'Lat Pulldown Stack',
      type: 'cable_machine',
      tare_weight_kg: 0.0,
      cable_ratio: 1.0,
      is_default: true,
      notes: '1:1 ratio',
    },
    {
      id: 'gear_cable_functional',
      name: 'Functional Trainer',
      type: 'cable_machine',
      tare_weight_kg: 0.0,
      cable_ratio: 0.5,
      is_default: false,
      notes: '2:1 dual pulley',
    },
  ];

  beforeEach(() => {
    gearRepo = new MockGearRepository(mockGearList);
    service = new GearInventoryService(gearRepo);
  });

  describe('getAllGear and getGearByType', () => {
    it('retrieves all gear items', async () => {
      const all = await service.getAllGear();
      expect(all).toHaveLength(4);
    });

    it('filters gear by type', async () => {
      const barbells = await service.getGearByType('barbell');
      expect(barbells).toHaveLength(2);
      expect(barbells.every((g) => g.type === 'barbell')).toBe(true);
    });

    it('retrieves gear by id', async () => {
      const gear = await service.getGearById('gear_bar_olympic');
      expect(gear).not.toBeNull();
      expect(gear?.name).toBe('Olympic Barbell (20 kg)');
    });
  });

  describe('createGear', () => {
    it('creates a new gear item with trimmed name', async () => {
      const created = await service.createGear({
        name: '  Kabuki Transformer Bar  ',
        type: 'specialty_bar',
        tare_weight_kg: 25,
        cable_ratio: 1.0,
        is_default: false,
        notes: 'Padded multi-angle bar',
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('Kabuki Transformer Bar');
      expect(created.tare_weight_kg).toBe(25);
    });

    it('clears previous default of the same type when creating a new default item', async () => {
      const created = await service.createGear({
        name: 'New Default Barbell (20 kg)',
        type: 'barbell',
        tare_weight_kg: 20,
        cable_ratio: 1.0,
        is_default: true,
        notes: null,
      });

      expect(created.is_default).toBe(true);

      const oldDefault = await service.getGearById('gear_bar_olympic');
      expect(oldDefault?.is_default).toBe(false);
    });
  });

  describe('updateGear and setDefaultGear', () => {
    it('updates an existing gear item', async () => {
      const existing = await service.getGearById('gear_bar_technique');
      expect(existing).not.toBeNull();

      const updated = await service.updateGear({
        ...existing!,
        name: 'Women Olympic Barbell (15 kg)',
        notes: '25mm grip',
      });

      expect(updated.name).toBe('Women Olympic Barbell (15 kg)');
      expect(updated.notes).toBe('25mm grip');
    });

    it('sets a new default gear and demotes the old default', async () => {
      await service.setDefaultGear('gear_cable_functional');

      const newDefault = await service.getGearById('gear_cable_functional');
      expect(newDefault?.is_default).toBe(true);

      const oldDefault = await service.getGearById('gear_cable_standard');
      expect(oldDefault?.is_default).toBe(false);
    });

    it('throws error when setting default on non-existent item', async () => {
      await expect(service.setDefaultGear('non_existent')).rejects.toThrow(
        "Gear item with id 'non_existent' not found"
      );
    });
  });

  describe('deleteGear', () => {
    it('deletes a gear item by id', async () => {
      await service.deleteGear('gear_bar_technique');
      const item = await service.getGearById('gear_bar_technique');
      expect(item).toBeNull();
    });
  });

  describe('resolveMechanicalAdvantage', () => {
    it('returns specific gear cable ratio when gearId is provided', async () => {
      const ratio = await service.resolveMechanicalAdvantage('gear_cable_functional', 1.0);
      expect(ratio).toBe(0.5);
    });

    it('falls back to default cable machine ratio when gearId is null/undefined', async () => {
      const ratio = await service.resolveMechanicalAdvantage(null, 2.0);
      expect(ratio).toBe(1.0); // gear_cable_standard is default with ratio 1.0
    });

    it('falls back to provided fallbackRatio when no default cable machine exists', async () => {
      await gearRepo.clear();
      const ratio = await service.resolveMechanicalAdvantage(null, 0.75);
      expect(ratio).toBe(0.75);
    });
  });

  describe('resolveBarTareWeight', () => {
    it('returns specific bar tare weight when gearId is provided', async () => {
      const tare = await service.resolveBarTareWeight('gear_bar_technique', 20.0);
      expect(tare).toBe(15.0);
    });

    it('falls back to default barbell tare when gearId is null/undefined', async () => {
      const tare = await service.resolveBarTareWeight(null, 15.0);
      expect(tare).toBe(20.0); // gear_bar_olympic is default with 20.0 kg
    });

    it('falls back to provided fallbackTare when no default barbell exists', async () => {
      await gearRepo.clear();
      const tare = await service.resolveBarTareWeight(null, 29.0);
      expect(tare).toBe(29.0);
    });
  });
});
