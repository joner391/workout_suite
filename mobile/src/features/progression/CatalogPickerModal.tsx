import { AppIcon } from '../../ui/AppIcon';
import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
/**
 * Workout Suite — Catalog Picker Modal
 *
 * Implements Section 1.3: Exercise Catalog Picker with Real-Time Search & Filtering
 * Supports both "+ Add Exercise" and "1-Tap Exercise Swap" flows.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from 'react-native';
import { Exercise } from '../../core/types';

export interface CatalogPickerModalProps {
  visible: boolean;
  title?: string;
  exercises: Exercise[];
  onSelect: (exercise: Exercise) => void;
  onClose: () => void;
}

const MUSCLE_GROUPS = ['All', 'Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core'];
const EQUIPMENT_TYPES = ['All', 'Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight'];

export const CatalogPickerModal: React.FC<CatalogPickerModalProps> = ({
  visible,
  title = 'Select Exercise',
  exercises,
  onSelect,
  onClose,
}) => {
  const [search, setSearch] = useState<string>('');
  const [selectedMuscle, setSelectedMuscle] = useState<string>('All');
  const [selectedEquipment, setSelectedEquipment] = useState<string>('All');

  const filteredExercises = useMemo(() => {
    return exercises.filter((ex) => {
      // 1. Text search
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = ex.name.toLowerCase().includes(q);
        const matchMuscle = ex.muscle_group.toLowerCase().includes(q);
        if (!matchName && !matchMuscle) return false;
      }

      // 2. Muscle group filter
      if (selectedMuscle !== 'All') {
        const mg = ex.muscle_group.toLowerCase();
        const target = selectedMuscle.toLowerCase();
        if (target === 'legs' && !mg.includes('leg') && !mg.includes('quad') && !mg.includes('hamstring') && !mg.includes('glute') && !mg.includes('calves')) {
          return false;
        } else if (target === 'arms' && !mg.includes('bicep') && !mg.includes('tricep') && !mg.includes('forearm')) {
          return false;
        } else if (target === 'shoulders' && !mg.includes('shoulder') && !mg.includes('delt')) {
          return false;
        } else if (target === 'core' && !mg.includes('abs') && !mg.includes('core')) {
          return false;
        } else if (!mg.includes(target)) {
          return false;
        }
      }

      // 3. Equipment filter
      if (selectedEquipment !== 'All') {
        const cat = (ex.category || '').toLowerCase();
        const target = selectedEquipment.toLowerCase();
        if (target === 'bodyweight') {
          if (!ex.is_bodyweight && !cat.includes('calisthenic') && !cat.includes('bodyweight')) return false;
        } else if (!cat.includes(target)) {
          return false;
        }
      }

      return true;
    });
  }, [exercises, search, selectedMuscle, selectedEquipment]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View testID="catalog-picker-modal" style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{title}</Text>
          <TouchableOpacity
            testID="close-catalog-picker-btn"
            style={styles.closeBtn}
            onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"
          >
            <AppIcon name="close" size={20} color={uiColors.accentText} />
          </TouchableOpacity>
        </View>

        {/* Search Input */}
        <View style={styles.searchBox}>
          <TextInput
            testID="catalog-search-input"
            style={styles.searchInput}
            placeholder="Search exercises by name or muscle..."
            placeholderTextColor={uiColors.subtle}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Muscle Filter Row */}
        <View style={styles.filterSection}>
          <Text style={styles.filterLabel}>Muscle Group:</Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={MUSCLE_GROUPS}
            keyExtractor={(item) => item}
            contentContainerStyle={styles.filterPills}
            renderItem={({ item }) => (
              <TouchableOpacity
                testID={`filter-muscle-${item}`}
                style={[
                  styles.filterPill,
                  selectedMuscle === item && styles.filterPillActive,
                ]}
                onPress={() => setSelectedMuscle(item)}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    selectedMuscle === item && styles.filterPillTextActive,
                  ]}
                >
                  {item}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>

        {/* Equipment Filter Row */}
        <View style={styles.filterSection}>
          <Text style={styles.filterLabel}>Equipment:</Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={EQUIPMENT_TYPES}
            keyExtractor={(item) => item}
            contentContainerStyle={styles.filterPills}
            renderItem={({ item }) => (
              <TouchableOpacity
                testID={`filter-equipment-${item}`}
                style={[
                  styles.filterPill,
                  selectedEquipment === item && styles.filterPillActive,
                ]}
                onPress={() => setSelectedEquipment(item)}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    selectedEquipment === item && styles.filterPillTextActive,
                  ]}
                >
                  {item}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>

        {/* Exercise List */}
        <FlatList
          data={filteredExercises}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No exercises match the criteria.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              testID={`catalog-exercise-item-${item.id}`}
              style={styles.exerciseItem}
              onPress={() => {
                onSelect(item);
                onClose();
              }}
            >
              <View style={styles.exerciseItemLeft}>
                <Text style={styles.exerciseItemName}>{item.name}</Text>
                <Text style={styles.exerciseItemMeta}>
                  {item.muscle_group} • {item.category || 'Compound'}
                </Text>
              </View>
              <View style={styles.selectPill}>
                <Text style={styles.selectPillText}>Select +</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: uiColors.background,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
  },
  headerTitle: {
    lineHeight: 28,
    flexShrink: 1,
    color: uiColors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  closeBtn: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: 10,
    backgroundColor: uiColors.raised,
    padding: 6,
  },
  searchBox: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchInput: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    color: uiColors.text,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterSection: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  filterLabel: {
    color: uiColors.subtle,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  filterPills: {
    gap: 6,
  },
  filterPill: {
    minHeight: 26,
    justifyContent: 'center',
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: uiRadius.badge,
  },
  filterPillActive: {
    backgroundColor: uiColors.accent,
    borderColor: uiColors.accent,
  },
  filterPillText: {
    lineHeight: 16,
    color: uiColors.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: uiColors.background,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    marginTop: 8,
  },
  exerciseItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  exerciseItemLeft: {
    flex: 1,
  },
  exerciseItemName: {
    color: uiColors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  exerciseItemMeta: {
    color: uiColors.subtle,
    fontSize: 11,
    marginTop: 2,
  },
  selectPill: {
    minHeight: 26,
    justifyContent: 'center',
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.accent,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: uiRadius.badge,
  },
  selectPillText: {
    lineHeight: 16,
    color: uiColors.accentText,
    fontSize: 11,
    fontWeight: '600',
  },
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: uiColors.subtle,
    fontSize: 13,
  },
});
