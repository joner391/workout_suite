import { AppIcon } from '../../ui/AppIcon';
import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
/**
 * Workout Suite — ExerciseSubstitutionModal
 *
 * Implements ADR-012: Exercise Variant Hierarchy with parent_exercise_id
 * Implements ADR-023: 1-Tap In-Session Exercise Substitution
 *
 * Features:
 * - Prioritizes compatible movements via variant hierarchy & muscle groups
 * - Visual match badge (Direct Variant, Family, Same Muscle)
 * - Indicates presence of historical ghost logs
 * - Search bar for catalog lookup
 * - Swap Scope prompt: "Swap for this session only" (default) vs "Update template permanently"
 * - High-contrast OLED dark styling
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Exercise } from '../../core/types';
import {
  ExerciseSubstitutionService,
  ExerciseSubstitutionOption,
  SubstitutionMatchReason,
} from '../../services/exerciseSubstitutionService';
import { IExerciseRepository } from '../../domain/repositories/IExerciseRepository';

export interface ExerciseSubstitutionModalProps {
  visible: boolean;
  currentExercise: Exercise;
  workoutId: string;
  templateId?: string | null;
  substitutionService: ExerciseSubstitutionService;
  exerciseRepo?: IExerciseRepository;
  onApplySubstitution: (
    newExercise: Exercise,
    swapScope: 'session_only' | 'permanent_template'
  ) => Promise<void>;
  onClose: () => void;
}

const MATCH_REASON_LABELS: Record<SubstitutionMatchReason, { label: string; bg: string; text: string }> = {
  direct_variant: { label: 'Direct Variant', bg: '#581C87', text: '#E9D5FF' }, // Purple
  variant_family: { label: 'Variant Family', bg: '#312E81', text: '#C7D2FE' }, // Indigo
  parent_root: { label: 'Parent Movement', bg: '#1E3A8A', text: '#BFDBFE' }, // Blue
  same_muscle_compound: { label: 'Same Muscle & Profile', bg: '#064E3B', text: '#A7F3D0' }, // Emerald
  same_muscle_group: { label: 'Same Muscle', bg: uiColors.border, text: uiColors.secondaryText }, // Zinc
};

export const ExerciseSubstitutionModal: React.FC<ExerciseSubstitutionModalProps> = ({
  visible,
  currentExercise,
  workoutId,
  templateId,
  substitutionService,
  exerciseRepo,
  onApplySubstitution,
  onClose,
}) => {
  const [substitutes, setSubstitutes] = useState<ExerciseSubstitutionOption[]>([]);
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [swapScope, setSwapScope] = useState<'session_only' | 'permanent_template'>('session_only');
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (!visible) return;

    let isMounted = true;
    setLoading(true);
    setSelectedExercise(null);
    setSearchQuery('');
    setSwapScope('session_only');

    async function loadData() {
      try {
        const subs = await substitutionService.findSubstitutes(currentExercise.id);
        if (isMounted) {
          setSubstitutes(subs);
        }

        if (exerciseRepo) {
          const catalog = await exerciseRepo.findAll();
          if (isMounted) {
            setAllExercises(catalog.filter((e) => e.id !== currentExercise.id));
          }
        }
      } catch (err) {
        console.error('Failed to load exercise substitutes:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [visible, currentExercise.id, substitutionService, exerciseRepo]);

  // Filtered recommendations or catalog search results
  const displayedItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return substitutes;
    }

    // Search query matches within substitutes first, then falls back to catalog
    const matchingSubs = substitutes.filter(
      (s) =>
        s.exercise.name.toLowerCase().includes(q) ||
        s.exercise.muscle_group.toLowerCase().includes(q) ||
        s.exercise.category.toLowerCase().includes(q)
    );

    const subIds = new Set(substitutes.map((s) => s.exercise.id));
    const extraMatches = allExercises
      .filter(
        (e) =>
          !subIds.has(e.id) &&
          (e.name.toLowerCase().includes(q) ||
            e.muscle_group.toLowerCase().includes(q) ||
            e.category.toLowerCase().includes(q))
      )
      .map(
        (e): ExerciseSubstitutionOption => ({
          exercise: e,
          matchReason: 'same_muscle_group',
          relevanceScore: 10,
          ghostSets: [],
          hasGhostData: false,
        })
      );

    return [...matchingSubs, ...extraMatches];
  }, [searchQuery, substitutes, allExercises]);

  const handleConfirmSwap = async () => {
    if (!selectedExercise) return;
    setSubmitting(true);
    try {
      await onApplySubstitution(selectedExercise, swapScope);
      onClose();
    } catch (err) {
      console.error('Error applying exercise substitution:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      testID="exercise-substitution-modal"
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.modalTitle}>Substitute Exercise</Text>
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                Replacing: <Text style={styles.currentExerciseHighlight}>{currentExercise.name}</Text>
              </Text>
            </View>
            <TouchableOpacity
              testID="substitution-close-button"
              style={styles.closeButton}
              onPress={onClose}
              accessibilityLabel="Close substitution modal" accessibilityRole="button"
            >
              <AppIcon name="close" size={20} color={uiColors.accentText} />
            </TouchableOpacity>
          </View>

          {/* Search Input */}
          <View style={styles.searchContainer}>
            <TextInput
              testID="substitution-search-input"
              style={styles.searchInput}
              placeholder="Search substitutes or equipment..."
              placeholderTextColor={uiColors.subtle}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
            />
          </View>

          {/* Substitutes List */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={uiColors.accent} />
              <Text style={styles.loadingText}>Finding compatible movements...</Text>
            </View>
          ) : (
            <FlatList
              testID="substitution-list"
              data={displayedItems}
              keyExtractor={(item) => item.exercise.id}
              showsVerticalScrollIndicator={false}
              style={styles.list}
              renderItem={({ item }) => {
                const isSelected = selectedExercise?.id === item.exercise.id;
                const matchStyle = MATCH_REASON_LABELS[item.matchReason] || {
                  label: 'Alternative',
                  bg: uiColors.border,
                  text: uiColors.secondaryText,
                };
                const hasGhost = item.hasGhostData || item.ghostSets.length > 0;

                return (
                  <TouchableOpacity
                    testID={`substitute-item-${item.exercise.id}`}
                    style={[styles.itemCard, isSelected && styles.itemCardSelected]}
                    onPress={() => setSelectedExercise(item.exercise)}
                  >
                    <View style={styles.itemHeaderRow}>
                      <Text style={[styles.itemName, isSelected && styles.itemNameSelected]}>
                        {item.exercise.name}
                      </Text>
                      <View style={[styles.badge, { backgroundColor: matchStyle.bg }]}>
                        <Text style={[styles.badgeText, { color: matchStyle.text }]}>
                          {matchStyle.label}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.itemMetaRow}>
                      <Text style={styles.itemMetaText}>
                        {item.exercise.muscle_group} • {item.exercise.category}
                      </Text>
                      {hasGhost && (
                        <View style={styles.ghostPill}>
                          <Text style={styles.ghostPillText}>✓ Ghost data available</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No matching exercises found.</Text>
                </View>
              }
            />
          )}

          {/* Swap Scope Selection (ADR-023) */}
          {selectedExercise && (
            <View style={styles.scopeSection}>
              <Text style={styles.scopeTitle}>SWAP SCOPE</Text>
              <View style={styles.scopeOptions}>
                {/* Session Only */}
                <TouchableOpacity
                  testID="scope-session-only"
                  style={[styles.scopeOption, swapScope === 'session_only' && styles.scopeOptionActive]}
                  onPress={() => setSwapScope('session_only')}
                >
                  <View style={[styles.radioDot, swapScope === 'session_only' && styles.radioDotActive]} />
                  <View style={styles.scopeTextWrapper}>
                    <Text style={styles.scopeLabel}>Swap for this session only</Text>
                    <Text style={styles.scopeSublabel}>Keep original template untouched (default)</Text>
                  </View>
                </TouchableOpacity>

                {/* Permanent Template */}
                {templateId && (
                  <TouchableOpacity
                    testID="scope-permanent-template"
                    style={[
                      styles.scopeOption,
                      swapScope === 'permanent_template' && styles.scopeOptionActive,
                    ]}
                    onPress={() => setSwapScope('permanent_template')}
                  >
                    <View
                      style={[
                        styles.radioDot,
                        swapScope === 'permanent_template' && styles.radioDotActive,
                      ]}
                    />
                    <View style={styles.scopeTextWrapper}>
                      <Text style={styles.scopeLabel}>Update template permanently</Text>
                      <Text style={styles.scopeSublabel}>Replaces exercise in program routine</Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* Footer Actions */}
          <View style={styles.footer}>
            <TouchableOpacity
              testID="confirm-substitution-button"
              style={[
                styles.confirmButton,
                (!selectedExercise || submitting) && styles.confirmButtonDisabled,
              ]}
              onPress={handleConfirmSwap}
              disabled={!selectedExercise || submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={uiColors.background} />
              ) : (
                <Text style={styles.confirmButtonText}>
                  {selectedExercise
                    ? `Swap with ${selectedExercise.name}`
                    : 'Select an Exercise to Swap'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxHeight: '92%',
    backgroundColor: uiColors.background,
    borderRadius: uiRadius.card,
    borderWidth: 1,
    borderColor: uiColors.border,
    padding: 18,
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
    paddingBottom: 12,
  },
  modalTitle: {
    lineHeight: 28,
    flexShrink: 1,
    fontSize: 22,
    fontWeight: '700',
    color: uiColors.text,
  },
  modalSubtitle: {
    fontSize: 12,
    color: uiColors.muted,
    marginTop: 2,
  },
  currentExerciseHighlight: {
    color: '#38BDF8',
    fontWeight: '700',
  },
  closeButton: {
    flexShrink: 0,
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: uiColors.raised,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    marginVertical: 12,
  },
  searchInput: {
    backgroundColor: uiColors.raised,
    borderRadius: uiRadius.control,
    borderWidth: 1,
    borderColor: uiColors.border,
    color: uiColors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  loadingContainer: {
    padding: 30,
    alignItems: 'center',
  },
  loadingText: {
    color: uiColors.muted,
    fontSize: 13,
    marginTop: 10,
  },
  list: {
    maxHeight: 280,
  },
  itemCard: {
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    padding: 12,
    marginBottom: 8,
  },
  itemCardSelected: {
    borderColor: uiColors.accent,
    backgroundColor: '#0F2618',
  },
  itemHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemName: {
    fontSize: 15,
    fontWeight: '700',
    color: uiColors.text,
    flex: 1,
  },
  itemNameSelected: {
    color: uiColors.accentText,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: uiRadius.badge,
    marginLeft: 8,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  itemMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  itemMetaText: {
    fontSize: 12,
    color: uiColors.subtle,
  },
  ghostPill: {
    minHeight: 26,
    justifyContent: 'center',
    backgroundColor: '#1C1917',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: uiRadius.badge,
  },
  ghostPillText: {
    lineHeight: 16,
    fontSize: 11,
    color: '#A8A29E',
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
  scopeSection: {
    marginVertical: 10,
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
    paddingTop: 10,
  },
  scopeTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: uiColors.subtle,
    letterSpacing: 1,
    marginBottom: 8,
  },
  scopeOptions: {
    gap: 8,
  },
  scopeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    padding: 10,
    borderRadius: 8,
  },
  scopeOptionActive: {
    borderColor: uiColors.accent,
    backgroundColor: '#092113',
  },
  radioDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#52525B',
    marginRight: 10,
  },
  radioDotActive: {
    borderColor: uiColors.accent,
    backgroundColor: uiColors.accent,
  },
  scopeTextWrapper: {
    flex: 1,
  },
  scopeLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: uiColors.text,
  },
  scopeSublabel: {
    fontSize: 11,
    color: uiColors.subtle,
    marginTop: 1,
  },
  footer: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
    paddingTop: 12,
  },
  confirmButton: {
    backgroundColor: uiColors.accent,
    borderRadius: uiRadius.control,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: uiColors.border,
  },
  confirmButtonText: {
    color: uiColors.background,
    fontSize: 14,
    fontWeight: '700',
  },
});
