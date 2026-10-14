/**
 * Workout Suite — ExerciseLibraryScreen
 *
 * Implements Step 2.2: Exercise Catalog Manager & Variant Tree UI
 * Implements ADR-012: Exercise Variant Hierarchy with parent_exercise_id
 * Implements ADR-021: Dumbbell Per-Hand Input & Unilateral Limb Data Modeling
 * Implements ADR-024: Pure Utility Mode (OLED-friendly high-contrast styling)
 *
 * Features:
 * - Search by exercise name and target muscle group.
 * - Multi-criteria filtering: Muscle Group, Equipment/Category, Custom only.
 * - Dual visualization: Flat Catalog vs. Hierarchical Variant Tree.
 * - In-place CRUD for custom exercises with ExerciseFormModal.
 * - Variant linking to root movements (parent_exercise_id).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  Exercise,
  ExerciseCategory,
  MuscleGroup,
  WeightUnit,
} from '../../core/types';
import { IExerciseRepository } from '../../domain/repositories/IExerciseRepository';
import { IUserSettingsRepository } from '../../domain/repositories/IUserSettingsRepository';
import { ExerciseFormModal } from './ExerciseFormModal';

export interface ExerciseLibraryScreenProps {
  exerciseRepo: IExerciseRepository;
  userSettingsRepo?: IUserSettingsRepository;
  onSelectExercise?: (exercise: Exercise) => void;
  onClose?: () => void;
}

const MUSCLE_FILTER_CHIPS: (MuscleGroup | 'All')[] = [
  'All',
  'Chest',
  'Back',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Forearms',
  'Calves',
  'Abs',
  'Traps',
];

const CATEGORY_FILTER_CHIPS: (ExerciseCategory | 'All')[] = [
  'All',
  'Barbell',
  'Dumbbell',
  'Cable',
  'Machine',
  'Bodyweight',
  'Other',
];

export const ExerciseLibraryScreen: React.FC<ExerciseLibraryScreenProps> = ({
  exerciseRepo,
  userSettingsRepo,
  onSelectExercise,
  onClose,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');

  // Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup | 'All'>('All');
  const [selectedCategory, setSelectedCategory] = useState<ExerciseCategory | 'All'>('All');
  const [customOnly, setCustomOnly] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'flat' | 'tree'>('flat');

  // Tree expansion state
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());

  // Modal states
  const [formModalVisible, setFormModalVisible] = useState<boolean>(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);

  // Load all exercises & unit system
  const refreshCatalog = useCallback(async () => {
    try {
      setLoading(true);
      const [allExercises, unit] = await Promise.all([
        exerciseRepo.findAll(),
        userSettingsRepo ? userSettingsRepo.getUnitSystem() : Promise.resolve('kg' as WeightUnit),
      ]);
      setExercises(allExercises);
      setUnitSystem(unit);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, [exerciseRepo, userSettingsRepo]);

  useEffect(() => {
    refreshCatalog();
  }, [refreshCatalog]);

  // Root movements for variant picker
  const rootExercises = useMemo(() => {
    return exercises.filter((e) => e.parent_exercise_id === null);
  }, [exercises]);

  // Map of exercise ID -> Exercise object for quick lookup
  const exerciseMap = useMemo(() => {
    const map = new Map<string, Exercise>();
    for (const ex of exercises) {
      map.set(ex.id, ex);
    }
    return map;
  }, [exercises]);

  // Variant map: parent_id -> list of child exercises
  const variantChildrenMap = useMemo(() => {
    const map = new Map<string, Exercise[]>();
    for (const ex of exercises) {
      if (ex.parent_exercise_id) {
        const list = map.get(ex.parent_exercise_id) || [];
        list.push(ex);
        map.set(ex.parent_exercise_id, list);
      }
    }
    return map;
  }, [exercises]);

  // Filter exercises
  const filteredExercises = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return exercises.filter((ex) => {
      // Search query
      if (q) {
        const nameMatch = ex.name.toLowerCase().includes(q);
        const muscleMatch = ex.muscle_group.toLowerCase().includes(q);
        if (!nameMatch && !muscleMatch) return false;
      }

      // Muscle group filter
      if (selectedMuscle !== 'All') {
        if (ex.muscle_group.toLowerCase() !== selectedMuscle.toLowerCase()) return false;
      }

      // Category filter
      if (selectedCategory !== 'All') {
        if (ex.category !== selectedCategory) return false;
      }

      // Custom filter
      if (customOnly && !ex.is_custom) {
        return false;
      }

      return true;
    });
  }, [exercises, searchQuery, selectedMuscle, selectedCategory, customOnly]);

  // Flat vs Tree view items
  // In tree view, we display root movements, and children can be expanded
  const treeRoots = useMemo(() => {
    if (viewMode !== 'tree') return [];
    // If filtering is active, include roots that match OR roots whose variants match
    const filteredSet = new Set(filteredExercises.map((e) => e.id));
    return rootExercises.filter((root) => {
      if (filteredSet.has(root.id)) return true;
      const variants = variantChildrenMap.get(root.id) || [];
      return variants.some((v) => filteredSet.has(v.id));
    });
  }, [viewMode, rootExercises, filteredExercises, variantChildrenMap]);

  const toggleExpandRoot = (rootId: string) => {
    setExpandedRoots((prev) => {
      const next = new Set(prev);
      if (next.has(rootId)) {
        next.delete(rootId);
      } else {
        next.add(rootId);
      }
      return next;
    });
  };

  const handleOpenCreateModal = () => {
    setEditingExercise(null);
    setFormModalVisible(true);
  };

  const handleOpenEditModal = (exercise: Exercise) => {
    setEditingExercise(exercise);
    setFormModalVisible(true);
  };

  const handleSaveExercise = async (exerciseToSave: Exercise) => {
    if (editingExercise) {
      await exerciseRepo.update(exerciseToSave);
    } else {
      await exerciseRepo.create(exerciseToSave);
    }
    await refreshCatalog();
  };

  const handleDeleteExercise = (exercise: Exercise) => {
    Alert.alert(
      'Delete Exercise',
      `Are you sure you want to delete "${exercise.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await exerciseRepo.delete(exercise.id);
              await refreshCatalog();
            } catch (err) {
              Alert.alert('Error', (err as Error).message || 'Failed to delete exercise.');
            }
          },
        },
      ]
    );
  };

  // Render individual exercise row item
  const renderExerciseItem = (item: Exercise, isChild = false) => {
    const parentName = item.parent_exercise_id
      ? exerciseMap.get(item.parent_exercise_id)?.name
      : null;
    const variants = variantChildrenMap.get(item.id) || [];
    const hasVariants = variants.length > 0;
    const isExpanded = expandedRoots.has(item.id);

    return (
      <View
        key={item.id}
        testID={`exercise-card-${item.id}`}
        style={[
          styles.exerciseCard,
          isChild && styles.exerciseCardChild,
          item.is_custom && styles.exerciseCardCustom,
        ]}
      >
        <TouchableOpacity
          style={styles.cardMainAction}
          activeOpacity={0.7}
          onPress={() => {
            if (onSelectExercise) {
              onSelectExercise(item);
            } else if (viewMode === 'tree' && hasVariants) {
              toggleExpandRoot(item.id);
            } else if (item.is_custom) {
              handleOpenEditModal(item);
            }
          }}
        >
          {/* Header Row */}
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardTitleCol}>
              <View style={styles.titleRow}>
                {isChild && <Text style={styles.childIndicator}>↳ </Text>}
                <Text style={styles.exerciseNameText}>{item.name}</Text>
                {item.is_custom && (
                  <View style={styles.customBadge}>
                    <Text style={styles.customBadgeText}>CUSTOM</Text>
                  </View>
                )}
              </View>

              {parentName && !isChild && (
                <Text style={styles.parentSubtitle}>
                  ↳ Variant of {parentName}
                </Text>
              )}
            </View>

            {/* Tree expansion trigger or action icon */}
            {viewMode === 'tree' && hasVariants && !isChild && (
              <TouchableOpacity
                testID={`expand-variants-${item.id}`}
                style={styles.treeExpandBtn}
                onPress={() => toggleExpandRoot(item.id)}
              >
                <Text style={styles.treeExpandBtnText}>
                  {variants.length} {variants.length === 1 ? 'variant' : 'variants'}{' '}
                  {isExpanded ? '▲' : '▼'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Badges Row */}
          <View style={styles.badgesRow}>
            {/* Muscle Group */}
            <View style={styles.tagBadge}>
              <Text style={styles.tagBadgeText}>{item.muscle_group}</Text>
            </View>

            {/* Equipment */}
            <View style={styles.tagBadgeAccent}>
              <Text style={styles.tagBadgeAccentText}>{item.category}</Text>
            </View>

            {/* Unilateral */}
            {item.is_unilateral && (
              <View style={styles.tagBadge}>
                <Text style={styles.tagBadgeText}>L/R Limb</Text>
              </View>
            )}

            {/* Bodyweight */}
            {item.is_bodyweight && (
              <View style={styles.tagBadge}>
                <Text style={styles.tagBadgeText}>Bodyweight</Text>
              </View>
            )}

            {/* Rest Timer */}
            {item.default_rest_seconds > 0 && (
              <View style={styles.tagBadgeMuted}>
                <Text style={styles.tagBadgeMutedText}>{item.default_rest_seconds}s rest</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        {/* Custom exercise action buttons */}
        {item.is_custom && (
          <View style={styles.cardActionsRow}>
            <TouchableOpacity
              testID={`edit-exercise-${item.id}`}
              style={styles.cardActionBtn}
              onPress={() => handleOpenEditModal(item)}
            >
              <Text style={styles.cardActionBtnText}>Edit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID={`delete-exercise-${item.id}`}
              style={styles.cardDeleteBtn}
              onPress={() => handleDeleteExercise(item)}
            >
              <Text style={styles.cardDeleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* If in tree view and expanded, render nested children */}
        {viewMode === 'tree' && isExpanded && hasVariants && (
          <View style={styles.treeChildrenContainer}>
            {variants.map((v) => renderExerciseItem(v, true))}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Exercise Library</Text>
          <Text style={styles.headerSubtitle}>
            {exercises.length} exercises • {rootExercises.length} root movements
          </Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            testID="add-new-exercise-btn"
            style={styles.addBtn}
            onPress={handleOpenCreateModal}
          >
            <Text style={styles.addBtnText}>+ New</Text>
          </TouchableOpacity>

          {onClose && (
            <TouchableOpacity
              testID="close-library-btn"
              style={styles.closeHeaderBtn}
              onPress={onClose}
            >
              <Text style={styles.closeHeaderBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Search Bar */}
      <View style={styles.searchSection}>
        <TextInput
          testID="search-library-input"
          style={styles.searchInput}
          placeholder="Search by exercise name or muscle..."
          placeholderTextColor="#71717A"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            style={styles.clearSearchBtn}
            onPress={() => setSearchQuery('')}
          >
            <Text style={styles.clearSearchBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter and Mode Controls */}
      <View style={styles.filterControlsContainer}>
        {/* View Mode Toggle: Catalog vs Variant Tree */}
        <View style={styles.viewModeRow}>
          <View style={styles.viewModeToggle}>
            <TouchableOpacity
              testID="view-mode-flat"
              style={[styles.modeBtn, viewMode === 'flat' && styles.modeBtnActive]}
              onPress={() => setViewMode('flat')}
            >
              <Text style={[styles.modeBtnText, viewMode === 'flat' && styles.modeBtnTextActive]}>
                Catalog List
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="view-mode-tree"
              style={[styles.modeBtn, viewMode === 'tree' && styles.modeBtnActive]}
              onPress={() => setViewMode('tree')}
            >
              <Text style={[styles.modeBtnText, viewMode === 'tree' && styles.modeBtnTextActive]}>
                Variant Tree (ADR-012)
              </Text>
            </TouchableOpacity>
          </View>

          {/* Custom Only filter */}
          <TouchableOpacity
            testID="toggle-custom-filter"
            style={[styles.customToggleBtn, customOnly && styles.customToggleBtnActive]}
            onPress={() => setCustomOnly(!customOnly)}
          >
            <Text style={[styles.customToggleBtnText, customOnly && styles.customToggleBtnTextActive]}>
              {customOnly ? '★ Custom Only' : '☆ All Movements'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Muscle Filter Chips */}
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={MUSCLE_FILTER_CHIPS}
          keyExtractor={(item) => `muscle-${item}`}
          style={styles.chipsFilterList}
          renderItem={({ item }) => {
            const isSelected = selectedMuscle === item;
            return (
              <TouchableOpacity
                testID={`filter-muscle-${item}`}
                style={[styles.filterChip, isSelected && styles.filterChipActive]}
                onPress={() => setSelectedMuscle(item)}
              >
                <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                  {item}
                </Text>
              </TouchableOpacity>
            );
          }}
        />

        {/* Category Filter Chips */}
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={CATEGORY_FILTER_CHIPS}
          keyExtractor={(item) => `cat-${item}`}
          style={styles.chipsFilterList}
          renderItem={({ item }) => {
            const isSelected = selectedCategory === item;
            return (
              <TouchableOpacity
                testID={`filter-cat-${item}`}
                style={[styles.filterChip, isSelected && styles.filterChipActive]}
                onPress={() => setSelectedCategory(item)}
              >
                <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                  {item}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Main List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00E676" />
          <Text style={styles.loadingText}>Loading catalog...</Text>
        </View>
      ) : viewMode === 'flat' ? (
        <FlatList
          data={filteredExercises}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => renderExerciseItem(item, false)}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No exercises found</Text>
              <Text style={styles.emptySubtitle}>Try adjusting your search or filters.</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={treeRoots}
          keyExtractor={(item) => `root-${item.id}`}
          renderItem={({ item }) => renderExerciseItem(item, false)}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No movements in variant tree</Text>
              <Text style={styles.emptySubtitle}>Try adjusting your search or filters.</Text>
            </View>
          }
        />
      )}

      {/* Exercise Create / Edit Modal */}
      <ExerciseFormModal
        visible={formModalVisible}
        initialExercise={editingExercise}
        availableRootExercises={rootExercises}
        unitSystem={unitSystem}
        onClose={() => {
          setFormModalVisible(false);
          setEditingExercise(null);
        }}
        onSave={handleSaveExercise}
      />
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
    position: 'relative',
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
  clearSearchBtn: {
    position: 'absolute',
    right: 28,
    top: 18,
    padding: 4,
  },
  clearSearchBtnText: {
    color: '#71717A',
    fontSize: 14,
  },
  filterControlsContainer: {
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  viewModeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  viewModeToggle: {
    flexDirection: 'row',
    backgroundColor: '#18181B',
    borderRadius: 6,
    padding: 2,
  },
  modeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  },
  modeBtnActive: {
    backgroundColor: '#27272A',
  },
  modeBtnText: {
    fontSize: 11,
    color: '#71717A',
    fontWeight: '600',
  },
  modeBtnTextActive: {
    color: '#FAFAFA',
    fontWeight: '700',
  },
  customToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  customToggleBtnActive: {
    backgroundColor: '#0F291E',
    borderColor: '#00E676',
  },
  customToggleBtnText: {
    fontSize: 11,
    color: '#A1A1AA',
    fontWeight: '600',
  },
  customToggleBtnTextActive: {
    color: '#00E676',
    fontWeight: '800',
  },
  chipsFilterList: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  filterChip: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 6,
  },
  filterChipActive: {
    backgroundColor: '#0F291E',
    borderColor: '#00E676',
  },
  filterChipText: {
    fontSize: 11,
    color: '#A1A1AA',
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#00E676',
    fontWeight: '800',
  },
  listContent: {
    padding: 16,
    gap: 8,
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
  exerciseCard: {
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  exerciseCardChild: {
    backgroundColor: '#121215',
    marginLeft: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#00E676',
    marginTop: 6,
  },
  exerciseCardCustom: {
    borderColor: '#3F3F46',
  },
  cardMainAction: {
    flex: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitleCol: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  childIndicator: {
    color: '#00E676',
    fontSize: 14,
    fontWeight: '900',
  },
  exerciseNameText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  customBadge: {
    backgroundColor: '#27272A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  customBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#00E676',
    letterSpacing: 0.5,
  },
  parentSubtitle: {
    fontSize: 11,
    color: '#71717A',
    marginTop: 3,
  },
  treeExpandBtn: {
    backgroundColor: '#18181B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  treeExpandBtnText: {
    fontSize: 10,
    color: '#00E676',
    fontWeight: '700',
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  tagBadge: {
    backgroundColor: '#18181B',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  tagBadgeText: {
    fontSize: 10,
    color: '#A1A1AA',
    fontWeight: '700',
  },
  tagBadgeAccent: {
    backgroundColor: '#1A2E20',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  tagBadgeAccentText: {
    fontSize: 10,
    color: '#00E676',
    fontWeight: '700',
  },
  tagBadgeMuted: {
    backgroundColor: '#18181B',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  tagBadgeMutedText: {
    fontSize: 10,
    color: '#71717A',
  },
  cardActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#18181B',
  },
  cardActionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  cardActionBtnText: {
    fontSize: 12,
    color: '#00E676',
    fontWeight: '700',
  },
  cardDeleteBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  cardDeleteBtnText: {
    fontSize: 12,
    color: '#F87171',
    fontWeight: '700',
  },
  treeChildrenContainer: {
    marginTop: 4,
  },
});
