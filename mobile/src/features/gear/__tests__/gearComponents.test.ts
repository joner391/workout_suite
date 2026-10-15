/**
 * Workout Suite — Gear & Equipment Inventory Test Suite
 *
 * Implements Step 2.2 Verification Gate
 * Validates:
 * - Gear CRUD operations (barbells, specialty bars, cable machines)
 * - Equipment filtering by category
 * - Default designation and demotion of prior default
 * - Tare weight conversion (ADR-008: canonical kg storage)
 * - Cable mechanical advantage ratios (ADR-025: 1:1 direct vs 2:1 functional trainer)
 */

import { MockGearRepository } from '../../../database/mocks/MockGearRepository';
import { GearInventoryService } from '../../../services/gearInventoryService';
import { GearInventory } from '../../../core/types';
import { lbsToKg, kgToLbs } from '../../../core/math/unitConversion';

describe('Gear & Equipment Inventory Management (Step 2.2)', () => {
  let gearRepo: MockGearRepository;
  let service: GearInventoryService;

  const sampleGear: GearInventory[] = [
    {
      id: 'bar_olympic_20',
      name: 'Olympic Barbell (20 kg)',
      type: 'barbell',
      tare_weight_kg: 20.0,
      cable_ratio: 1.0,
      is_default: true,
      notes: 'Standard 20kg bar',
    },
    {
      id: 'bar_tech_15',
      name: 'Technique Bar (15 kg)',
      type: 'barbell',
      tare_weight_kg: 15.0,
      cable_ratio: 1.0,
      is_default: false,
      notes: null,
    },
    {
      id: 'bar_ssb_29',
      name: 'Safety Squat Bar (29 kg)',
      type: 'specialty_bar',
      tare_weight_kg: 29.0,
      cable_ratio: 1.0,
      is_default: true,
      notes: 'Yoke padded bar',
    },
    {
      id: 'cable_lat_1to1',
      name: 'Lat Pulldown Station',
      type: 'cable_machine',
      tare_weight_kg: 0.0,
      cable_ratio: 1.0,
      is_default: true,
      notes: 'Direct 1:1 stack',
    },
    {
      id: 'cable_ft_2to1',
      name: 'Functional Trainer',
      type: 'cable_machine',
      tare_weight_kg: 0.0,
      cable_ratio: 0.5,
      is_default: false,
      notes: '2:1 dual pulley',
    },
  ];

  beforeEach(() => {
    gearRepo = new MockGearRepository(sampleGear);
    service = new GearInventoryService(gearRepo);
  });

  describe('Inventory Listing and Type Filtering', () => {
    it('retrieves full inventory', async () => {
      const items = await service.getAllGear();
      expect(items).toHaveLength(5);
    });

    it('filters inventory by barbells', async () => {
      const barbells = await service.getGearByType('barbell');
      expect(barbells).toHaveLength(2);
      expect(barbells.map((b) => b.id)).toEqual(['bar_olympic_20', 'bar_tech_15']);
    });

    it('filters inventory by specialty bars', async () => {
      const specialty = await service.getGearByType('specialty_bar');
      expect(specialty).toHaveLength(1);
      expect(specialty[0].name).toBe('Safety Squat Bar (29 kg)');
    });

    it('filters inventory by cable machines', async () => {
      const cables = await service.getGearByType('cable_machine');
      expect(cables).toHaveLength(2);
    });
  });

  describe('Tare Weight Unit Handling (ADR-008)', () => {
    it('stores tare weight canonically in kg when input in lbs', () => {
      const userLbsInput = 55; // e.g. 55 lb trap bar
      const canonicalKg = lbsToKg(userLbsInput);
      expect(Math.round(canonicalKg * 10) / 10).toBe(24.9);

      const displayLbs = kgToLbs(canonicalKg);
      expect(Math.round(displayLbs)).toBe(55);
    });
  });

  describe('Cable Mechanical Advantage (ADR-025)', () => {
    it('correctly models 1:1 direct resistance and 2:1 halved resistance', async () => {
      const latPulldown = await service.getGearById('cable_lat_1to1');
      expect(latPulldown?.cable_ratio).toBe(1.0);

      const functionalTrainer = await service.getGearById('cable_ft_2to1');
      expect(functionalTrainer?.cable_ratio).toBe(0.5);
    });
  });

  describe('Default Equipment Designation', () => {
    it('updates default gear item and demotes previously designated default', async () => {
      // Initially, bar_olympic_20 is default
      const initialDefault = await service.getGearById('bar_olympic_20');
      expect(initialDefault?.is_default).toBe(true);

      // Make bar_tech_15 default
      await service.setDefaultGear('bar_tech_15');

      const newDefault = await service.getGearById('bar_tech_15');
      expect(newDefault?.is_default).toBe(true);

      const demoted = await service.getGearById('bar_olympic_20');
      expect(demoted?.is_default).toBe(false);
    });
  });

  describe('Equipment CRUD', () => {
    it('creates a custom specialty barbell', async () => {
      const created = await service.createGear({
        name: 'Kabuki Trap Bar HD',
        type: 'specialty_bar',
        tare_weight_kg: 25.0,
        cable_ratio: 1.0,
        is_default: false,
        notes: 'Open trap bar with built-in jack',
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('Kabuki Trap Bar HD');
      expect(created.tare_weight_kg).toBe(25.0);

      const inRepo = await service.getGearById(created.id);
      expect(inRepo).not.toBeNull();
    });

    it('updates gear notes and tare weight', async () => {
      const item = await service.getGearById('bar_ssb_29');
      expect(item).not.toBeNull();

      const updated = await service.updateGear({
        ...item!,
        tare_weight_kg: 30.0,
        notes: 'Heavy commercial SSB with thicker pad',
      });

      expect(updated.tare_weight_kg).toBe(30.0);
      expect(updated.notes).toBe('Heavy commercial SSB with thicker pad');
    });

    it('deletes equipment from inventory', async () => {
      await service.deleteGear('bar_tech_15');
      const item = await service.getGearById('bar_tech_15');
      expect(item).toBeNull();
    });
  });

  describe('Bar Tare Isolation & Exercise Applicability Confirmation', () => {
    it('confirms having or setting SSB as default specialty bar does NOT swap bar for non-applicable lifts (Bench Press, Deadlift)', async () => {
      // In sampleGear, bar_ssb_29 has is_default: true for type 'specialty_bar'
      const ssb = await service.getGearById('bar_ssb_29');
      expect(ssb).not.toBeNull();
      expect(ssb?.type).toBe('specialty_bar');
      expect(ssb?.tare_weight_kg).toBe(29.0);

      // 1. Generic Barbell Bench Press (no gearId specified) must resolve to standard 20 kg, NOT 29 kg SSB!
      const benchTare = await service.resolveBarTareWeight(null, 20.0);
      expect(benchTare).toBe(20.0);
      expect(benchTare).not.toBe(29.0);

      // 2. Generic Deadlift (no gearId specified) must resolve to standard 20 kg, NOT 29 kg SSB!
      const deadliftTare = await service.resolveBarTareWeight(null, 20.0);
      expect(deadliftTare).toBe(20.0);
      expect(deadliftTare).not.toBe(29.0);

      // 3. Squat specifically selecting the Safety Squat Bar must resolve to 29.0 kg!
      const ssbSquatTare = await service.resolveBarTareWeight('bar_ssb_29', 20.0);
      expect(ssbSquatTare).toBe(29.0);
    });

    it('resolves explicit gear tare weight when selected without requiring it to be default', async () => {
      // Create non-default trap bar (25 kg)
      const trapBar = await service.createGear({
        name: 'Open Hex / Trap Bar (25 kg)',
        type: 'specialty_bar',
        tare_weight_kg: 25.0,
        cable_ratio: 1.0,
        is_default: false,
        notes: 'For trap bar deadlifts and shrugs',
      });

      expect(trapBar.is_default).toBe(false);

      // Exercise without gearId still resolves to 20 kg standard
      const normalBar = await service.resolveBarTareWeight(null, 20.0);
      expect(normalBar).toBe(20.0);

      // Exercise explicitly selecting trap bar resolves to 25 kg
      const trapBarTare = await service.resolveBarTareWeight(trapBar.id, 20.0);
      expect(trapBarTare).toBe(25.0);
    });
  });
});
