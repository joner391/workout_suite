import { AppIcon } from '../../ui/AppIcon';
import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
import { Badge } from '../../ui/Badge';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { commonStyles } from '../../ui/theme';
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
  Modal,
} from 'react-native';
import {
  Exercise,
  ExerciseCategory,
  ExercisePreference,
  ExerciseSentiment,
  MuscleGroup,
  WeightUnit,
} from '../../core/types';
import { IExerciseRepository } from '../../domain/repositories/IExerciseRepository';
import { IWorkoutRepository } from '../../domain/repositories/IWorkoutRepository';
import { IGearRepository } from '../../domain/repositories/IGearRepository';
import { IUserSettingsRepository } from '../../domain/repositories/IUserSettingsRepository';
import { IExercisePreferenceRepository } from '../../domain/repositories/IExercisePreferenceRepository';
import {
  ExercisePreferenceService,
  calculateAffinityScore,
} from '../../services/exercisePreferenceService';
import { useOptionalRepositories } from '../../context/RepositoryContext';
import {
  formatRomTier,
  getRomTierBadgeStyle,
  formatAxialLoading,
  getAxialLoadingBadgeStyle,
  formatMuscleBias,
  uniqueMuscleBiases,
  getSentimentPillStyle,
} from './biomechanicalFormatters';
import { ExerciseFormModal } from './ExerciseFormModal';
import { ExerciseDetailScreen } from './ExerciseDetailScreen';

export interface ExerciseLibraryScreenProps {
  exerciseRepo: IExerciseRepository;
  workoutRepo?: IWorkoutRepository;
  gearRepo?: IGearRepository;
  userSettingsRepo?: IUserSettingsRepository;
  preferenceRepo?: IExercisePreferenceRepository;
  preferenceService?: ExercisePreferenceService;
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
  workoutRepo,
  gearRepo,
  userSettingsRepo,
  preferenceRepo: propPreferenceRepo,
  preferenceService: propPreferenceService,
  onSelectExercise,
  onClose,
}) => {
  const optionalRepos = useOptionalRepositories();

  const prefService = useMemo(() => {
    if (propPreferenceService) return propPreferenceService;
    const repo = propPreferenceRepo ?? optionalRepos?.exercisePreferenceRepo;
    if (repo) return new ExercisePreferenceService(repo);
    return null;
  }, [propPreferenceService, propPreferenceRepo, optionalRepos?.exercisePreferenceRepo]);

  const [loading, setLoading] = useState<boolean>(true);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');
  const [preferences, setPreferences] = useState<Map<string, ExercisePreference>>(new Map());

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
  const [inspectingExerciseId, setInspectingExerciseId] = useState<string | null>(null);

  // Load all exercises & unit system & preferences
  const refreshCatalog = useCallback(async () => {
    try {
      setLoading(true);
      const [allExercises, unit, allPrefs] = await Promise.all([
        exerciseRepo.findAll(),
        userSettingsRepo ? userSettingsRepo.getUnitSystem() : Promise.resolve('kg' as WeightUnit),
        prefService ? prefService.getAllPreferences() : Promise.resolve([]),
      ]);
      setExercises(allExercises);
      setUnitSystem(unit);
      const prefMap = new Map<string, ExercisePreference>();
      for (const p of allPrefs) {
        prefMap.set(p.exercise_id, p);
      }
      setPreferences(prefMap);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, [exerciseRepo, userSettingsRepo, prefService]);

  const handleToggleSentiment = async (exerciseId: string, sentiment: ExerciseSentiment) => {
    setPreferences((prev) => {
      const next = new Map(prev);
      const existing = next.get(exerciseId);
      const swapIn = existing?.swap_in_count ?? 0;
      const swapOut = existing?.swap_out_count ?? 0;
      next.set(exerciseId, {
        exercise_id: exerciseId,
        sentiment,
        swap_in_count: swapIn,
        swap_out_count: swapOut,
        affinity_score: calculateAffinityScore({
          sentiment,
          swap_in_count: swapIn,
          swap_out_count: swapOut,
        }),
        last_pain_reported_at: existing?.last_pain_reported_at ?? null,
        max_pain_severity: existing?.max_pain_severity ?? null,
        pain_joint: existing?.pain_joint ?? null,
        updated_at: new Date().toISOString(),
      });
      return next;
    });

    if (prefService) {
      try {
        await prefService.setSentiment(exerciseId, sentiment);
      } catch {
        await refreshCatalog();
      }
    }
  };

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
  const renderExerciseItem = useCallback(
    (item: Exercise, isChild = false) => {
    const parentName = item.parent_exercise_id
      ? exerciseMap.get(item.parent_exercise_id)?.name
      : null;
    const variants = variantChildrenMap.get(item.id) || [];
    const hasVariants = variants.length > 0;
    const isExpanded = expandedRoots.has(item.id);
    const pref = preferences.get(item.id);
    const currentSentiment: ExerciseSentiment = pref?.sentiment ?? 'neutral';

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
            } else if (workoutRepo) {
              setInspectingExerciseId(item.id);
            } else if (item.is_custom) {
              handleOpenEditModal(item);
            }
          }}
        >
          {/* Header Row */}
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardTitleCol}>
              <View style={styles.titleRow}><Text style={styles.exerciseNameText} numberOfLines={2} accessibilityLabel={item.name}>{isChild ? '↳ ' : ''}{item.name}</Text></View>

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
            {item.is_custom && <Badge label="Custom" tone="accent" />}
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

            {/* Biomechanical Badges: ROM Tier */}
            {(() => {
              const romStyle = getRomTierBadgeStyle(item.rom_tier);
              return (
                <View
                  testID={`badge-rom-tier-${item.id}`}
                  style={[
                    styles.tagBadge,
                    { backgroundColor: romStyle.bg, borderColor: romStyle.border, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.tagBadgeText, { color: romStyle.text }]}>
                    {formatRomTier(item.rom_tier)}
                  </Text>
                </View>
              );
            })()}

            {/* Biomechanical Badges: Axial Loading */}
            {(() => {
              const axialStyle = getAxialLoadingBadgeStyle(item.axial_loading);
              return (
                <View
                  testID={`badge-axial-${item.id}`}
                  style={[
                    styles.tagBadge,
                    { backgroundColor: axialStyle.bg, borderColor: axialStyle.border, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.tagBadgeText, { color: axialStyle.text }]}>
                    {formatAxialLoading(item.axial_loading)}
                  </Text>
                </View>
              );
            })()}
          </View>

          {/* Regional Bias Chips */}
          {item.muscle_biases && item.muscle_biases.length > 0 && (
            <View style={styles.cardBiasesRow}>
              {uniqueMuscleBiases(item.muscle_biases).map((bias) => (
                <View
                  key={bias}
                  testID={`chip-bias-${item.id}-${bias}`}
                  style={styles.cardBiasChip}
                >
                  <Text style={styles.cardBiasChipText}>{formatMuscleBias(bias)}</Text>
                </View>
              ))}
            </View>
          )}
        </TouchableOpacity>

        {/* Sentiment Action Pill Row */}
        <View style={styles.cardSentimentRow} testID={`sentiment-pill-row-${item.id}`}>
          {/* Liked (Heart) */}
          {(() => {
            const isLiked = currentSentiment === 'liked';
            const pillStyle = getSentimentPillStyle('liked', isLiked);
            return (
              <TouchableOpacity
                testID={`sentiment-liked-btn-${item.id}`}
                style={[
                  styles.cardSentimentPill,
                  { backgroundColor: pillStyle.bg, borderColor: pillStyle.border },
                ]}
                onPress={() => handleToggleSentiment(item.id, 'liked')}
                activeOpacity={0.7}
              >
                <Text style={[styles.cardSentimentPillText, { color: pillStyle.text }]}>♥ Liked</Text>
              </TouchableOpacity>
            );
          })()}

          {/* Neutral */}
          {(() => {
            const isNeutral = currentSentiment === 'neutral';
            const pillStyle = getSentimentPillStyle('neutral', isNeutral);
            return (
              <TouchableOpacity
                testID={`sentiment-neutral-btn-${item.id}`}
                style={[
                  styles.cardSentimentPill,
                  { backgroundColor: pillStyle.bg, borderColor: pillStyle.border },
                ]}
                onPress={() => handleToggleSentiment(item.id, 'neutral')}
                activeOpacity={0.7}
              >
                <Text style={[styles.cardSentimentPillText, { color: pillStyle.text }]}>— Neutral</Text>
              </TouchableOpacity>
            );
          })()}

          {/* Dislike */}
          {(() => {
            const isDisliked = currentSentiment === 'disliked';
            const pillStyle = getSentimentPillStyle('disliked', isDisliked);
            return (
              <TouchableOpacity
                testID={`sentiment-disliked-btn-${item.id}`}
                style={[
                  styles.cardSentimentPill,
                  { backgroundColor: pillStyle.bg, borderColor: pillStyle.border },
                ]}
                onPress={() => handleToggleSentiment(item.id, 'disliked')}
                activeOpacity={0.7}
              >
                <Text style={[styles.cardSentimentPillText, { color: pillStyle.text }]}>✕ Dislike</Text>
              </TouchableOpacity>
            );
          })()}

          {/* Blacklist */}
          {(() => {
            const isBlacklisted = currentSentiment === 'blacklisted';
            const pillStyle = getSentimentPillStyle('blacklisted', isBlacklisted);
            return (
              <TouchableOpacity
                testID={`sentiment-blacklisted-btn-${item.id}`}
                style={[
                  styles.cardSentimentPill,
                  { backgroundColor: pillStyle.bg, borderColor: pillStyle.border },
                ]}
                onPress={() => handleToggleSentiment(item.id, 'blacklisted')}
                activeOpacity={0.7}
              >
                <Text style={[styles.cardSentimentPillText, { color: pillStyle.text }]}>⊘ Blacklist</Text>
              </TouchableOpacity>
            );
          })()}
        </View>

        {/* Exercise action buttons */}
        {(workoutRepo || item.is_custom) && (
          <View style={styles.cardActionsRow}>
            {workoutRepo && (
              <TouchableOpacity
                testID={`inspect-exercise-${item.id}`}
                style={styles.cardInspectBtn}
                onPress={() => setInspectingExerciseId(item.id)}
              >
                <Text style={styles.cardInspectBtnText}>Inspect PRs ➔</Text>
              </TouchableOpacity>
            )}

            {item.is_custom && (
              <>
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
              </>
            )}
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
  }, [
    exerciseMap,
    variantChildrenMap,
    expandedRoots,
    onSelectExercise,
    viewMode,
    workoutRepo,
    preferences,
    handleToggleSentiment,
  ]);

  const renderFlatItem = useCallback(
    ({ item }: { item: Exercise }) => renderExerciseItem(item, false),
    [renderExerciseItem]
  );

  const renderTreeItem = useCallback(
    ({ item }: { item: Exercise }) => renderExerciseItem(item, false),
    [renderExerciseItem]
  );

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <ScreenHeader
        title="Exercise library"
        subtitle={`${exercises.length} exercises · ${rootExercises.length} root movements`}
        onClose={onClose}
        closeTestID="close-library-btn"
        actions={<TouchableOpacity testID="add-new-exercise-btn" style={commonStyles.button} onPress={handleOpenCreateModal}>
          <Text style={commonStyles.buttonText}>New exercise</Text>
        </TouchableOpacity>}
      />

      {/* Search Bar */}
      <View style={styles.searchSection}>
        <TextInput
          testID="search-library-input"
          style={styles.searchInput}
          placeholder="Search by exercise name or muscle..."
          placeholderTextColor={uiColors.subtle}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            style={styles.clearSearchBtn}
            onPress={() => setSearchQuery('')} accessibilityRole="button" accessibilityLabel="Clear search"
          >
            <AppIcon name="close" size={20} color={uiColors.accentText} />
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
                Variant Tree
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
          <ActivityIndicator size="large" color={uiColors.accent} />
          <Text style={styles.loadingText}>Loading catalog...</Text>
        </View>
      ) : viewMode === 'flat' ? (
        <FlatList
          data={filteredExercises}
          keyExtractor={(item) => item.id}
          renderItem={renderFlatItem}
          contentContainerStyle={styles.listContent}
          initialNumToRender={15}
          maxToRenderPerBatch={15}
          windowSize={7}
          removeClippedSubviews={true}
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
          renderItem={renderTreeItem}
          contentContainerStyle={styles.listContent}
          initialNumToRender={15}
          maxToRenderPerBatch={15}
          windowSize={7}
          removeClippedSubviews={true}
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

      {/* Full-Screen Exercise Detail Modal */}
      {inspectingExerciseId && workoutRepo && (
        <Modal
          visible={!!inspectingExerciseId}
          animationType="slide"
          onRequestClose={() => {
            setInspectingExerciseId(null);
            refreshCatalog();
          }}
        >
          <ExerciseDetailScreen
            exerciseId={inspectingExerciseId}
            exerciseRepo={exerciseRepo}
            workoutRepo={workoutRepo}
            gearRepo={gearRepo}
            userSettingsRepo={userSettingsRepo}
            preferenceRepo={propPreferenceRepo}
            preferenceService={prefService ?? undefined}
            onClose={() => {
              setInspectingExerciseId(null);
              refreshCatalog();
            }}
          />
        </Modal>
      )}
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
    position: 'relative',
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
  clearSearchBtn: {
    position: 'absolute',
    right: 28,
    top: 18,
    padding: 4,
  },
  filterControlsContainer: {
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
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
    backgroundColor: uiColors.raised,
    borderRadius: uiRadius.control,
    padding: 2,
  },
  modeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: uiRadius.control,
  },
  modeBtnActive: {
    backgroundColor: uiColors.border,
  },
  modeBtnText: {
    fontSize: 11,
    color: uiColors.subtle,
    fontWeight: '600',
  },
  modeBtnTextActive: {
    color: uiColors.text,
    fontWeight: '600',
  },
  customToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: uiRadius.control,
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
  },
  customToggleBtnActive: {
    backgroundColor: '#0F291E',
    borderColor: uiColors.accent,
  },
  customToggleBtnText: {
    fontSize: 11,
    color: uiColors.muted,
    fontWeight: '600',
  },
  customToggleBtnTextActive: {
    color: uiColors.accentText,
    fontWeight: '600',
  },
  chipsFilterList: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  filterChip: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 6,
  },
  filterChipActive: {
    backgroundColor: '#0F291E',
    borderColor: uiColors.accent,
  },
  filterChipText: {
    fontSize: 11,
    color: uiColors.muted,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: uiColors.accentText,
    fontWeight: '600',
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
    color: uiColors.muted,
    fontSize: 13,
    marginTop: 10,
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
  exerciseCard: {
    backgroundColor: uiColors.background,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    padding: 12,
    marginBottom: 8,
  },
  exerciseCardChild: {
    backgroundColor: uiColors.surface,
    marginLeft: 14,
    borderLeftWidth: 3,
    borderLeftColor: uiColors.accent,
    marginTop: 6,
  },
  exerciseCardCustom: {
    borderColor: '#3F3F46',
  },
  cardMainAction: {
    flex: 1,
  },
  cardHeaderRow: {
    gap: 8,
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'stretch',
  },
  cardTitleCol: {
    width: '100%',
    minWidth: 0,
    flex: 0,
  },
  titleRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    flexWrap: 'nowrap',
    gap: 8,
  },
  exerciseNameText: {
    minHeight: 44,
    lineHeight: 22,
    width: '100%',
    fontSize: 16,
    fontWeight: '600',
    color: uiColors.text,
  },
  parentSubtitle: {
    fontSize: 11,
    color: uiColors.subtle,
    marginTop: 3,
  },
  treeExpandBtn: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
    backgroundColor: uiColors.raised,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: uiRadius.control,
    borderWidth: 1,
    borderColor: uiColors.border,
  },
  treeExpandBtnText: {
    fontSize: 10,
    color: uiColors.accentText,
    fontWeight: '700',
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  tagBadge: {
    minHeight: 26,
    justifyContent: 'center',
    backgroundColor: uiColors.raised,
    borderRadius: uiRadius.badge,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tagBadgeText: {
    lineHeight: 16,
    fontSize: 11,
    color: uiColors.muted,
    fontWeight: '600',
  },
  tagBadgeAccent: {
    backgroundColor: '#1A2E20',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  tagBadgeAccentText: {
    fontSize: 10,
    color: uiColors.accentText,
    fontWeight: '700',
  },
  tagBadgeMuted: {
    backgroundColor: uiColors.raised,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  tagBadgeMutedText: {
    fontSize: 10,
    color: uiColors.subtle,
  },
  cardActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
  },
  cardActionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  cardActionBtnText: {
    fontSize: 12,
    color: uiColors.accentText,
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
  cardInspectBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: uiRadius.control,
    backgroundColor: 'rgba(0, 230, 118, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.3)',
    marginRight: 6,
  },
  cardInspectBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: uiColors.accentText,
  },
  treeChildrenContainer: {
    marginTop: 4,
  },
  cardBiasesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  cardBiasChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: uiRadius.control,
    backgroundColor: '#181820',
    borderWidth: 1,
    borderColor: '#2D2D38',
  },
  cardBiasChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: uiColors.secondaryText,
  },
  cardSentimentRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
  },
  cardSentimentPill: {
    minHeight: 36,
    flex: 1,
    paddingVertical: 6,
    borderRadius: uiRadius.badge,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSentimentPillText: {
    lineHeight: 16,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
  },
});
