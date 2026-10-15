/**
 * Workout Suite — GearInventoryScreen
 *
 * Implements Step 2.2: Gear & Equipment Inventory Management UI
 * Implements ADR-008: Canonical Kilogram Storage with Display-Layer Unit Conversion
 * Implements ADR-024: Pure Utility Mode (OLED-friendly high-contrast styling)
 * Implements ADR-025: Equipment Mechanical Advantage Profiles
 *
 * Features:
 * - CRUD interface for gear_inventory (specialty barbells, custom cable ratios).
 * - Filter by gear category (barbells, specialty bars, cable machines, plate-loaded machines).
 * - Tare weight editing with automatic kg ↔ lbs conversion.
 * - Cable mechanical advantage configuration (1:1 direct, 2:1 functional trainer).
 * - 1-tap "Make Default" designation per equipment category.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Switch,
  ScrollView,
} from 'react-native';
import {
  GearInventory,
  GearType,
  WeightUnit,
} from '../../core/types';
import { IGearRepository } from '../../domain/repositories/IGearRepository';
import { IUserSettingsRepository } from '../../domain/repositories/IUserSettingsRepository';
import { GearInventoryService } from '../../services/gearInventoryService';
import { kgToLbs, lbsToKg } from '../../core/math/unitConversion';

export interface GearInventoryScreenProps {
  gearRepo: IGearRepository;
  userSettingsRepo?: IUserSettingsRepository;
  onSelectGear?: (gear: GearInventory) => void;
  onClose?: () => void;
}

const GEAR_TYPES: { type: GearType; label: string }[] = [
  { type: 'barbell', label: 'Barbell' },
  { type: 'specialty_bar', label: 'Specialty Bar' },
  { type: 'cable_machine', label: 'Cable Machine' },
  { type: 'plate_loaded_machine', label: 'Plate Machine' },
  { type: 'accessory', label: 'Accessory' },
];

const FILTER_TYPES: (GearType | 'all')[] = [
  'all',
  'barbell',
  'specialty_bar',
  'cable_machine',
  'plate_loaded_machine',
  'accessory',
];

export const GearInventoryScreen: React.FC<GearInventoryScreenProps> = ({
  gearRepo,
  userSettingsRepo,
  onSelectGear,
  onClose,
}) => {
  const service = useMemo(() => new GearInventoryService(gearRepo), [gearRepo]);

  const [loading, setLoading] = useState<boolean>(true);
  const [gearList, setGearList] = useState<GearInventory[]>([]);
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');

  // Filter
  const [selectedFilter, setSelectedFilter] = useState<GearType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Form Modal
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [editingGear, setEditingGear] = useState<GearInventory | null>(null);

  // Form Fields
  const [name, setName] = useState<string>('');
  const [type, setType] = useState<GearType>('barbell');
  const [tareWeightInput, setTareWeightInput] = useState<string>('20');
  const [cableRatioInput, setCableRatioInput] = useState<string>('1.0');
  const [isDefault, setIsDefault] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  // Refresh items from repo
  const refreshGear = useCallback(async () => {
    try {
      setLoading(true);
      const [items, unit] = await Promise.all([
        service.getAllGear(),
        userSettingsRepo ? userSettingsRepo.getUnitSystem() : Promise.resolve('kg' as WeightUnit),
      ]);
      setGearList(items);
      setUnitSystem(unit);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, [service, userSettingsRepo]);

  useEffect(() => {
    refreshGear();
  }, [refreshGear]);

  // Open Create Modal
  const handleOpenCreateModal = () => {
    setEditingGear(null);
    setName('');
    setType('barbell');
    setTareWeightInput(unitSystem === 'lbs' ? '45' : '20');
    setCableRatioInput('1.0');
    setIsDefault(false);
    setNotes('');
    setFormError(null);
    setModalVisible(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (gear: GearInventory) => {
    setEditingGear(gear);
    setName(gear.name);
    setType(gear.type);

    const displayTare = unitSystem === 'lbs' ? kgToLbs(gear.tare_weight_kg) : gear.tare_weight_kg;
    setTareWeightInput(String(Math.round(displayTare * 10) / 10));

    setCableRatioInput(String(gear.cable_ratio || 1.0));
    setIsDefault(gear.is_default);
    setNotes(gear.notes || '');
    setFormError(null);
    setModalVisible(true);
  };

  // Save (Create or Update)
  const handleSaveGear = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Gear name is required.');
      return;
    }

    const rawTare = parseFloat(tareWeightInput);
    const validTare = !isNaN(rawTare) && rawTare >= 0 ? rawTare : 0;
    const tareKg = unitSystem === 'lbs' ? lbsToKg(validTare) : validTare;

    const rawRatio = parseFloat(cableRatioInput);
    const validRatio = !isNaN(rawRatio) && rawRatio > 0 ? rawRatio : 1.0;

    try {
      if (editingGear) {
        await service.updateGear({
          ...editingGear,
          name: trimmedName,
          type,
          tare_weight_kg: Math.round(tareKg * 10) / 10,
          cable_ratio: validRatio,
          is_default: isDefault,
          notes: notes.trim() || null,
        });
      } else {
        await service.createGear({
          name: trimmedName,
          type,
          tare_weight_kg: Math.round(tareKg * 10) / 10,
          cable_ratio: validRatio,
          is_default: isDefault,
          notes: notes.trim() || null,
        });
      }
      setModalVisible(false);
      await refreshGear();
    } catch (err) {
      setFormError((err as Error).message || 'Failed to save gear.');
    }
  };

  // Set Default
  const handleMakeDefault = async (gear: GearInventory) => {
    try {
      await service.setDefaultGear(gear.id);
      await refreshGear();
    } catch (err) {
      Alert.alert('Error', (err as Error).message || 'Failed to set default.');
    }
  };

  // Delete
  const handleDeleteGear = (gear: GearInventory) => {
    Alert.alert(
      'Delete Equipment',
      `Are you sure you want to delete "${gear.name}" from your inventory?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await service.deleteGear(gear.id);
              await refreshGear();
            } catch (err) {
              Alert.alert('Error', (err as Error).message || 'Failed to delete gear.');
            }
          },
        },
      ]
    );
  };

  // Filtered gear items
  const filteredGear = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return gearList.filter((g) => {
      if (selectedFilter !== 'all' && g.type !== selectedFilter) {
        return false;
      }
      if (q && !g.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [gearList, selectedFilter, searchQuery]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Equipment & Gear Inventory</Text>
          <Text style={styles.headerSubtitle}>
            {gearList.length} items • Available equipment in your gym
          </Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            testID="add-gear-btn"
            style={styles.addBtn}
            onPress={handleOpenCreateModal}
          >
            <Text style={styles.addBtnText}>+ Add Gear</Text>
          </TouchableOpacity>

          {onClose && (
            <TouchableOpacity
              testID="close-gear-screen-btn"
              style={styles.closeHeaderBtn}
              onPress={onClose}
            >
              <Text style={styles.closeHeaderBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Search Input */}
      <View style={styles.searchSection}>
        <TextInput
          testID="search-gear-input"
          style={styles.searchInput}
          placeholder="Search barbells, cable machines..."
          placeholderTextColor="#71717A"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Type Filter Chips */}
      <View style={styles.filterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterChipsRow}
        >
          {FILTER_TYPES.map((filter) => {
            const isSelected = selectedFilter === filter;
            const label =
              filter === 'all'
                ? 'All Equipment'
                : GEAR_TYPES.find((gt) => gt.type === filter)?.label || filter;

            return (
              <TouchableOpacity
                key={filter}
                testID={`gear-filter-${filter}`}
                style={[styles.filterChip, isSelected && styles.filterChipActive]}
                onPress={() => setSelectedFilter(filter)}
              >
                <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Main List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00E676" />
          <Text style={styles.loadingText}>Loading equipment inventory...</Text>
        </View>
      ) : (
        <FlatList
          style={styles.flatList}
          data={filteredGear}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const displayTare =
              unitSystem === 'lbs'
                ? `${Math.round(kgToLbs(item.tare_weight_kg) * 10) / 10} lbs`
                : `${Math.round(item.tare_weight_kg * 10) / 10} kg`;

            const isBarbell = item.type === 'barbell' || item.type === 'specialty_bar';
            const isCable = item.type === 'cable_machine';
            const isStandardFallback = item.is_default && item.type !== 'specialty_bar';

            return (
              <View
                testID={`gear-card-${item.id}`}
                style={styles.gearCard}
              >
                <TouchableOpacity
                  style={styles.cardHeader}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (onSelectGear) {
                      onSelectGear(item);
                    } else {
                      handleOpenEditModal(item);
                    }
                  }}
                >
                  <View style={styles.cardTitleCol}>
                    <View style={styles.nameRow}>
                      <Text style={styles.gearNameText}>{item.name}</Text>
                      {isStandardFallback && (
                        <View style={styles.defaultBadge}>
                          <Text style={styles.defaultBadgeText}>
                            STANDARD {item.type === 'barbell' ? 'BAR' : 'PULLEY'}
                          </Text>
                        </View>
                      )}
                    </View>

                    {item.notes && (
                      <Text style={styles.gearNotesText}>{item.notes}</Text>
                    )}
                  </View>

                  <View style={styles.typeTag}>
                    <Text style={styles.typeTagText}>
                      {GEAR_TYPES.find((gt) => gt.type === item.type)?.label || item.type}
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* Specs Row */}
                <View style={styles.specsRow}>
                  {isBarbell && (
                    <View style={styles.specItem}>
                      <Text style={styles.specLabel}>Tare Weight:</Text>
                      <Text style={styles.specValue}>{displayTare}</Text>
                    </View>
                  )}

                  {isCable && (
                    <View style={styles.specItem}>
                      <Text style={styles.specLabel}>Pulley Ratio:</Text>
                      <Text style={styles.specValue}>
                        {item.cable_ratio === 0.5 ? '2:1 (0.5x)' : `${item.cable_ratio}:1`}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Card Actions */}
                <View style={styles.cardActions}>
                  {!item.is_default && item.type !== 'specialty_bar' && (
                    <TouchableOpacity
                      testID={`make-default-${item.id}`}
                      style={styles.defaultBtn}
                      onPress={() => handleMakeDefault(item)}
                    >
                      <Text style={styles.defaultBtnText}>★ Set Standard</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    testID={`edit-gear-${item.id}`}
                    style={styles.editBtn}
                    onPress={() => handleOpenEditModal(item)}
                  >
                    <Text style={styles.editBtnText}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID={`delete-gear-${item.id}`}
                    style={styles.deleteBtn}
                    onPress={() => handleDeleteGear(item)}
                  >
                    <Text style={styles.deleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No equipment found</Text>
              <Text style={styles.emptySubtitle}>Tap "+ Add Gear" to configure custom equipment.</Text>
            </View>
          }
        />
      )}

      {/* Add / Edit Gear Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingGear ? 'Edit Equipment' : 'Add Equipment'}
              </Text>
              <TouchableOpacity
                testID="close-gear-modal-btn"
                onPress={() => setModalVisible(false)}
                style={styles.modalCloseBtn}
              >
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {formError && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{formError}</Text>
              </View>
            )}

            <ScrollView style={styles.formScroll} showsVerticalScrollIndicator={false}>
              {/* Gear Name */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>EQUIPMENT NAME *</Text>
                <TextInput
                  testID="gear-name-input"
                  style={styles.textInput}
                  placeholder="e.g. Rogue Ohio Power Bar, Lat Pulldown"
                  placeholderTextColor="#71717A"
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    if (formError) setFormError(null);
                  }}
                />
              </View>

              {/* Equipment Type */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>EQUIPMENT CATEGORY</Text>
                <View style={styles.chipsRow}>
                  {GEAR_TYPES.map((gt) => {
                    const isSelected = type === gt.type;
                    return (
                      <TouchableOpacity
                        key={gt.type}
                        testID={`gear-type-chip-${gt.type}`}
                        style={[styles.formChip, isSelected && styles.formChipActive]}
                        onPress={() => setType(gt.type)}
                      >
                        <Text style={[styles.formChipText, isSelected && styles.formChipTextActive]}>
                          {gt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Barbell Tare Weight */}
              {(type === 'barbell' || type === 'specialty_bar') && (
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>BAR TARE WEIGHT ({unitSystem.toUpperCase()})</Text>
                  <View style={styles.numericRow}>
                    <TextInput
                      testID="gear-tare-input"
                      style={styles.numericInput}
                      keyboardType="numeric"
                      value={tareWeightInput}
                      onChangeText={setTareWeightInput}
                    />
                    <View style={styles.quickPresetsRow}>
                      {(unitSystem === 'lbs' ? [45, 35, 55, 65] : [20, 15, 25, 29]).map((val) => (
                        <TouchableOpacity
                          key={val}
                          style={styles.quickChip}
                          onPress={() => setTareWeightInput(String(val))}
                        >
                          <Text style={styles.quickChipText}>{val}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>
              )}

              {/* Cable Pulley Ratio */}
              {type === 'cable_machine' && (
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>MECHANICAL ADVANTAGE RATIO</Text>
                  <Text style={styles.helpText}>
                    1.0 = Direct 1:1 stack weight. 0.5 = 2:1 Functional Trainer (weight felt is half the pin load).
                  </Text>
                  <View style={styles.numericRow}>
                    <TextInput
                      testID="gear-ratio-input"
                      style={styles.numericInput}
                      keyboardType="numeric"
                      value={cableRatioInput}
                      onChangeText={setCableRatioInput}
                    />
                    <View style={styles.quickPresetsRow}>
                      <TouchableOpacity
                        style={styles.quickChip}
                        onPress={() => setCableRatioInput('1.0')}
                      >
                        <Text style={styles.quickChipText}>1:1 (Direct)</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.quickChip}
                        onPress={() => setCableRatioInput('0.5')}
                      >
                        <Text style={styles.quickChipText}>2:1 (FT Pulley)</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}

              {/* Default Toggle - only show for standard barbell or cable, not specialty bars */}
              {type !== 'specialty_bar' ? (
                <View style={styles.toggleRow}>
                  <View style={styles.toggleCol}>
                    <Text style={styles.toggleTitle}>Set as Default for {type}</Text>
                    <Text style={styles.toggleSubtitle}>
                      Fallback implement applied when no specific gear is selected
                    </Text>
                  </View>
                  <Switch
                    testID="gear-default-switch"
                    value={isDefault}
                    onValueChange={setIsDefault}
                    trackColor={{ false: '#27272A', true: '#00E676' }}
                    thumbColor={isDefault ? '#000000' : '#A1A1AA'}
                  />
                </View>
              ) : (
                <View style={styles.specialtyBarNotice}>
                  <Text style={styles.specialtyBarNoticeText}>
                    ℹ Specialty bars (like Safety Squat Bar and Trap Bar) are exercise-specific implements. They are selected directly for appropriate exercises (e.g. Squats) rather than replacing standard barbells across the board.
                  </Text>
                </View>
              )}

              {/* Notes */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>NOTES (OPTIONAL)</Text>
                <TextInput
                  testID="gear-notes-input"
                  style={styles.textInput}
                  placeholder="e.g. Rack #2, 28mm grip, knurl markings"
                  placeholderTextColor="#71717A"
                  value={notes}
                  onChangeText={setNotes}
                />
              </View>
            </ScrollView>

            {/* Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                testID="cancel-gear-modal-btn"
                style={styles.modalCancelBtn}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="save-gear-modal-btn"
                style={styles.modalSaveBtn}
                onPress={handleSaveGear}
              >
                <Text style={styles.modalSaveBtnText}>
                  {editingGear ? 'Save Changes' : 'Add Gear'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
    flexShrink: 0,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FAFAFA',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#A1A1AA',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addBtn: {
    backgroundColor: '#00E676',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  closeHeaderBtn: {
    padding: 8,
  },
  closeHeaderBtnText: {
    color: '#A1A1AA',
    fontSize: 16,
    fontWeight: '700',
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    flexShrink: 0,
  },
  searchInput: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FAFAFA',
    fontSize: 13,
  },
  filterBar: {
    height: 50,
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
    backgroundColor: '#000000',
    justifyContent: 'center',
  },
  filterChipsRow: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterChip: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterChipActive: {
    backgroundColor: '#0F291E',
    borderColor: '#00E676',
  },
  filterChipText: {
    fontSize: 12,
    color: '#A1A1AA',
    fontWeight: '600',
    includeFontPadding: false,
  },
  filterChipTextActive: {
    color: '#00E676',
    fontWeight: '800',
  },
  flatList: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    color: '#A1A1AA',
    fontSize: 13,
    marginTop: 10,
  },
  gearCard: {
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
  },
  gearCardDefault: {
    borderColor: '#14532D',
    backgroundColor: '#0A140D',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitleCol: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  gearNameText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  defaultBadge: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#38BDF8',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  defaultBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#38BDF8',
    letterSpacing: 0.5,
  },
  specialtyBarNotice: {
    backgroundColor: '#18181B',
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  specialtyBarNoticeText: {
    color: '#A1A1AA',
    fontSize: 11,
    lineHeight: 15,
  },
  gearNotesText: {
    fontSize: 11,
    color: '#71717A',
    marginTop: 3,
  },
  typeTag: {
    backgroundColor: '#18181B',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  typeTagText: {
    fontSize: 10,
    color: '#A1A1AA',
    fontWeight: '700',
  },
  specsRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#18181B',
  },
  specItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  specLabel: {
    fontSize: 11,
    color: '#71717A',
  },
  specValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#00E676',
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#18181B',
  },
  defaultBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  defaultBtnText: {
    fontSize: 11,
    color: '#00E676',
    fontWeight: '700',
  },
  editBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  editBtnText: {
    fontSize: 11,
    color: '#D4D4D8',
    fontWeight: '700',
  },
  deleteBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  deleteBtnText: {
    fontSize: 11,
    color: '#F87171',
    fontWeight: '700',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#71717A',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: '#09090B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalCloseBtnText: {
    fontSize: 16,
    color: '#A1A1AA',
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: '#3F1212',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    borderRadius: 6,
    padding: 8,
    marginBottom: 10,
  },
  errorBannerText: {
    color: '#F87171',
    fontSize: 12,
    fontWeight: '600',
  },
  formScroll: {
    maxHeight: 400,
  },
  formGroup: {
    marginBottom: 14,
  },
  formLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#A1A1AA',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  helpText: {
    fontSize: 11,
    color: '#71717A',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FAFAFA',
    fontSize: 14,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  formChip: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  formChipActive: {
    backgroundColor: '#0F291E',
    borderColor: '#00E676',
  },
  formChipText: {
    fontSize: 11,
    color: '#A1A1AA',
    fontWeight: '600',
  },
  formChipTextActive: {
    color: '#00E676',
    fontWeight: '800',
  },
  numericRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  numericInput: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    width: 80,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#FAFAFA',
    fontSize: 14,
    textAlign: 'center',
  },
  quickPresetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  quickChip: {
    backgroundColor: '#27272A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  },
  quickChipText: {
    color: '#D4D4D8',
    fontSize: 11,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
    marginBottom: 12,
  },
  toggleCol: {
    flex: 1,
    paddingRight: 10,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  toggleSubtitle: {
    fontSize: 11,
    color: '#71717A',
    marginTop: 2,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#18181B',
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCancelBtnText: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '700',
  },
  modalSaveBtn: {
    flex: 2,
    backgroundColor: '#00E676',
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalSaveBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
  },
});
