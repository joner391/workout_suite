import { AppIcon } from '../../ui/AppIcon';
import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
import { Badge } from '../../ui/Badge';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { commonStyles } from '../../ui/theme';
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
  KeyboardAvoidingView,
  Platform,
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
  onEditAccess?: () => void;
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
  onEditAccess,
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
      <ScreenHeader
        title="Gear & equipment"
        subtitle={`${gearList.length} items in your gym`}
        onClose={onClose}
        closeTestID="close-gear-screen-btn"
        actions={<TouchableOpacity testID="add-gear-btn" style={commonStyles.button} onPress={handleOpenCreateModal}><Text style={commonStyles.buttonText}>Add equipment</Text></TouchableOpacity>}
      />

      {onEditAccess && <TouchableOpacity
        testID="gear-edit-access-btn"
        accessibilityRole="button"
        onPress={onEditAccess}
        style={{ padding: 16 }}
      >
        <Text style={{ color: uiColors.accentText, fontWeight: '600' }}>Edit equipment access →</Text>
      </TouchableOpacity>}
      {/* Search Input */}
      <View style={styles.searchSection}>
        <TextInput
          testID="search-gear-input"
          style={styles.searchInput}
          placeholder="Search barbells, cable machines..."
          placeholderTextColor={uiColors.subtle}
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
          <ActivityIndicator size="large" color={uiColors.accent} />
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
                      <Text style={styles.gearNameText} numberOfLines={2} accessibilityLabel={item.name}>{item.name}</Text>
                      <View style={commonStyles.wrapRow}>
                        {isStandardFallback && <Badge label={`Standard ${item.type === 'barbell' ? 'bar' : 'pulley'}`} tone="accent" />}
                        <Badge label={GEAR_TYPES.find(g => g.type === item.type)?.label || item.type} />
                      </View>
                    </View>

                    {item.notes && (
                      <Text style={styles.gearNotesText}>{item.notes}</Text>
                    )}
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingGear ? 'Edit Equipment' : 'Add Equipment'}
              </Text>
              <TouchableOpacity
                testID="close-gear-modal-btn"
                onPress={() => setModalVisible(false)}
                style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Close"
              >
                <AppIcon name="close" size={20} color={uiColors.accentText} />
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
                  placeholderTextColor={uiColors.subtle}
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
                    trackColor={{ false: uiColors.border, true: uiColors.accent }}
                    thumbColor={isDefault ? uiColors.background : uiColors.muted}
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
                  placeholderTextColor={uiColors.subtle}
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
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: uiColors.background,
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    flexShrink: 0,
  },
  searchInput: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: uiColors.text,
    fontSize: 13,
  },
  filterBar: {
    height: 50,
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
    backgroundColor: uiColors.background,
    justifyContent: 'center',
  },
  filterChipsRow: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterChip: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterChipActive: {
    backgroundColor: '#0F291E',
    borderColor: uiColors.accent,
  },
  filterChipText: {
    fontSize: 12,
    color: uiColors.muted,
    fontWeight: '600',
    includeFontPadding: false,
  },
  filterChipTextActive: {
    color: uiColors.accentText,
    fontWeight: '600',
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
    color: uiColors.muted,
    fontSize: 13,
    marginTop: 10,
  },
  gearCard: {
    backgroundColor: uiColors.background,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    padding: 14,
    marginBottom: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitleCol: {
    minWidth: 0,
    flex: 1,
  },
  nameRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
    flexWrap: 'nowrap',
  },
  gearNameText: {
    minHeight: 44,
    lineHeight: 22,
    width: '100%',
    fontSize: 16,
    fontWeight: '600',
    color: uiColors.text,
  },
  specialtyBarNotice: {
    backgroundColor: uiColors.raised,
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: uiColors.border,
  },
  specialtyBarNoticeText: {
    color: uiColors.muted,
    fontSize: 11,
    lineHeight: 15,
  },
  gearNotesText: {
    fontSize: 11,
    color: uiColors.subtle,
    marginTop: 3,
  },
  specsRow: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
  },
  specItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  specLabel: {
    fontSize: 11,
    color: uiColors.subtle,
  },
  specValue: {
    fontSize: 12,
    fontWeight: '700',
    color: uiColors.accentText,
  },
  cardActions: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
  },
  defaultBtn: {
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: uiColors.raised,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  defaultBtnText: {
    fontSize: 11,
    color: uiColors.accentText,
    fontWeight: '700',
  },
  editBtn: {
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: uiColors.raised,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  editBtnText: {
    fontSize: 11,
    color: uiColors.secondaryText,
    fontWeight: '700',
  },
  deleteBtn: {
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: uiColors.raised,
    paddingVertical: 8,
    paddingHorizontal: 12,
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
    fontWeight: '700',
    color: uiColors.text,
  },
  emptySubtitle: {
    fontSize: 12,
    color: uiColors.subtle,
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
    backgroundColor: uiColors.background,
    borderRadius: uiRadius.card,
    borderWidth: 1,
    borderColor: uiColors.border,
    padding: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
  },
  modalTitle: {
    lineHeight: 28,
    flexShrink: 1,
    fontSize: 22,
    fontWeight: '700',
    color: uiColors.text,
  },
  modalCloseBtn: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: 10,
    backgroundColor: uiColors.raised,
    padding: 6,
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
    fontWeight: '700',
    color: uiColors.muted,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  helpText: {
    fontSize: 11,
    color: uiColors.subtle,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: uiColors.text,
    fontSize: 14,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  formChip: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  formChipActive: {
    backgroundColor: '#0F291E',
    borderColor: uiColors.accent,
  },
  formChipText: {
    fontSize: 11,
    color: uiColors.muted,
    fontWeight: '600',
  },
  formChipTextActive: {
    color: uiColors.accentText,
    fontWeight: '600',
  },
  numericRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  numericInput: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    width: 80,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: uiColors.text,
    fontSize: 14,
    textAlign: 'center',
  },
  quickPresetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  quickChip: {
    backgroundColor: uiColors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: uiRadius.control,
  },
  quickChipText: {
    color: uiColors.secondaryText,
    fontSize: 11,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
    marginBottom: 12,
  },
  toggleCol: {
    flex: 1,
    paddingRight: 10,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: uiColors.text,
  },
  toggleSubtitle: {
    fontSize: 11,
    color: uiColors.subtle,
    marginTop: 2,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCancelBtnText: {
    color: uiColors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  modalSaveBtn: {
    flex: 2,
    backgroundColor: uiColors.accent,
    borderRadius: uiRadius.control,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalSaveBtnText: {
    color: uiColors.background,
    fontSize: 13,
    fontWeight: '700',
  },
});
