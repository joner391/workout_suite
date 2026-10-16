/**
 * Workout Suite — SessionDetailModal
 *
 * Implements Step 1.6: Past Session Drill-Down Inspection Modal
 *
 * Features:
 * - Aggregated session metrics: Total volume (tonnage), duration, total sets, best e1RM.
 * - Exercise-by-exercise breakdown with set types, load, reps, RPE/RIR, calculated e1RM, and notes.
 * - Supports display unit conversion (kg/lbs) per ADR-008.
 * - High-contrast OLED dark styling matching ActiveLoggerScreen (ADR-024).
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  Workout,
  WorkoutSet,
  WorkoutWithSets,
  Exercise,
  WeightUnit,
  IntensityMetric,
} from '../../core/types';
import { IWorkoutRepository } from '../../domain/repositories/IWorkoutRepository';
import { IExerciseRepository } from '../../domain/repositories/IExerciseRepository';
import { IUserSettingsRepository } from '../../domain/repositories/IUserSettingsRepository';
import { calculateHeuristic1RM } from '../../core/math/heuristic1rm';
import { formatWeight, kgToLbs } from '../../core/math/unitConversion';

export interface SessionDetailModalProps {
  visible: boolean;
  workoutId: string | null;
  workoutRepo: IWorkoutRepository;
  exerciseRepo: IExerciseRepository;
  userSettingsRepo?: IUserSettingsRepository;
  unitSystem?: WeightUnit;
  intensityMetric?: IntensityMetric;
  isImmediateSummary?: boolean;
  onClose: () => void;
  onDeleteSession?: (workoutId: string) => void;
}

export interface SupersetInfo {
  groupLetter: string;
  exerciseIndex: number;
  badgeLabel: string;
  groupLabel: string;
}

/**
 * Computes deterministic superset identification labels from workout sets.
 * Maps each unique exercise_group_id to an alphabetical letter (A, B, C...)
 * and each exercise within that group to an index (1, 2, 3...),
 * generating badge labels like "SS A1", "SS A2".
 */
export function computeSupersetInfo(sets: WorkoutSet[]): {
  exerciseMap: Map<string, SupersetInfo>;
  setMap: Map<string, SupersetInfo>;
} {
  const groupOrder: string[] = [];
  const groupExercises = new Map<string, string[]>();

  for (const set of sets) {
    if (set.exercise_group_id) {
      if (!groupOrder.includes(set.exercise_group_id)) {
        groupOrder.push(set.exercise_group_id);
        groupExercises.set(set.exercise_group_id, []);
      }
      const exList = groupExercises.get(set.exercise_group_id)!;
      if (!exList.includes(set.exercise_id)) {
        exList.push(set.exercise_id);
      }
    }
  }

  const exerciseMap = new Map<string, SupersetInfo>();
  const setMap = new Map<string, SupersetInfo>();

  groupOrder.forEach((groupId, groupIdx) => {
    const letter = String.fromCharCode(65 + (groupIdx % 26));
    const groupLetter =
      groupIdx < 26
        ? letter
        : `${String.fromCharCode(65 + Math.floor(groupIdx / 26) - 1)}${letter}`;
    const groupLabel = `Superset ${groupLetter}`;
    const exList = groupExercises.get(groupId) || [];

    exList.forEach((exId, exIdx) => {
      const exerciseIndex = exIdx + 1;
      const info: SupersetInfo = {
        groupLetter,
        exerciseIndex,
        badgeLabel: `SS ${groupLetter}${exerciseIndex}`,
        groupLabel,
      };
      exerciseMap.set(exId, info);
    });
  });

  for (const set of sets) {
    if (set.exercise_group_id) {
      const exInfo = exerciseMap.get(set.exercise_id);
      if (exInfo) {
        setMap.set(set.id, exInfo);
      }
    }
  }

  return { exerciseMap, setMap };
}

export function formatIntensityValue(
  set: WorkoutSet,
  metric: IntensityMetric
): string {
  if (metric === 'RPE') {
    if (set.rpe != null) return `@${set.rpe}`;
    if (set.rir != null) return `@${10 - set.rir}`;
    return '—';
  } else {
    if (set.rir != null) return `${set.rir} RIR`;
    if (set.rpe != null) return `${Math.max(0, 10 - set.rpe)} RIR`;
    return '—';
  }
}

interface ExerciseGroupedSets {
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string;
  category: string;
  sets: WorkoutSet[];
  totalVolumeKg: number;
  bestSetE1rmKg: number;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs > 0 ? `${secs}s` : ''}`.trim();
  }
  return `${secs}s`;
}

export function formatDateTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

export const SessionDetailModal: React.FC<SessionDetailModalProps> = ({
  visible,
  workoutId,
  workoutRepo,
  exerciseRepo,
  userSettingsRepo,
  unitSystem: propUnitSystem,
  intensityMetric: propIntensityMetric,
  isImmediateSummary = false,
  onClose,
  onDeleteSession,
}) => {
  const [loading, setLoading] = useState(false);
  const [workoutData, setWorkoutData] = useState<WorkoutWithSets | null>(null);
  const [exerciseMap, setExerciseMap] = useState<Record<string, Exercise>>({});
  const [unitSystem, setUnitSystem] = useState<WeightUnit>(propUnitSystem ?? 'kg');
  const [intensityMetric, setIntensityMetric] = useState<IntensityMetric>(propIntensityMetric ?? 'RPE');

  // Superset identification mapping
  const supersetInfo = useMemo(() => {
    if (!workoutData || !workoutData.sets.length) {
      return {
        exerciseMap: new Map<string, SupersetInfo>(),
        setMap: new Map<string, SupersetInfo>(),
      };
    }
    return computeSupersetInfo(workoutData.sets);
  }, [workoutData]);

  // Load unit and intensity preferences if not supplied directly
  useEffect(() => {
    if (propUnitSystem) {
      setUnitSystem(propUnitSystem);
    }
    if (propIntensityMetric) {
      setIntensityMetric(propIntensityMetric);
    }
    if (userSettingsRepo) {
      Promise.all([
        userSettingsRepo.getUnitSystem(),
        userSettingsRepo.getIntensityMetric(),
      ])
        .then(([u, i]) => {
          if (u && !propUnitSystem) setUnitSystem(u);
          if (i && !propIntensityMetric) setIntensityMetric(i);
        })
        .catch(() => {});
    }
  }, [propUnitSystem, propIntensityMetric, userSettingsRepo, visible]);

  // Load workout details and exercises
  useEffect(() => {
    if (!visible || !workoutId) {
      setWorkoutData(null);
      return;
    }

    let isMounted = true;
    setLoading(true);

    (async () => {
      try {
        const fullWorkout = await workoutRepo.getWorkoutWithSets(workoutId);
        if (!isMounted) return;

        if (!fullWorkout) {
          setWorkoutData(null);
          setLoading(false);
          return;
        }

        setWorkoutData(fullWorkout);

        // Fetch distinct exercise definitions
        const distinctExIds = Array.from(
          new Set(fullWorkout.sets.map((s) => s.exercise_id))
        );
        const map: Record<string, Exercise> = {};

        await Promise.all(
          distinctExIds.map(async (id) => {
            const ex = await exerciseRepo.findById(id);
            if (ex) map[id] = ex;
          })
        );

        if (isMounted) {
          setExerciseMap(map);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [visible, workoutId, workoutRepo, exerciseRepo]);

  // Group sets by exercise
  const groupedExercises: ExerciseGroupedSets[] = useMemo(() => {
    if (!workoutData || !workoutData.sets.length) return [];

    const groups: ExerciseGroupedSets[] = [];
    const seenOrder: string[] = [];

    workoutData.sets.forEach((set) => {
      if (!seenOrder.includes(set.exercise_id)) {
        seenOrder.push(set.exercise_id);
        const ex = exerciseMap[set.exercise_id];
        groups.push({
          exerciseId: set.exercise_id,
          exerciseName: ex ? ex.name : `Exercise ${set.exercise_id.slice(0, 6)}`,
          muscleGroup: ex ? ex.muscle_group : '',
          category: ex ? ex.category : '',
          sets: [],
          totalVolumeKg: 0,
          bestSetE1rmKg: 0,
        });
      }

      const group = groups.find((g) => g.exerciseId === set.exercise_id)!;
      group.sets.push(set);

      const vol = (set.weight || 0) * (set.reps || 0);
      group.totalVolumeKg += vol;

      const setE1rm = set.set_type === 'warmup'
        ? 0
        : calculateHeuristic1RM(set.weight, set.reps, {
            rir: set.rir,
            rpe: set.rpe,
          });
      if (setE1rm > group.bestSetE1rmKg) {
        group.bestSetE1rmKg = setE1rm;
      }
    });

    return groups;
  }, [workoutData, exerciseMap]);

  // Aggregate statistics
  const stats = useMemo(() => {
    if (!workoutData) {
      return {
        totalVolumeKg: 0,
        totalSets: 0,
        bestE1rmKg: 0,
        bestE1rmExerciseName: '',
      };
    }

    let totalVolume = 0;
    let totalSets = 0;
    let maxE1rm = 0;
    let topExName = '';

    groupedExercises.forEach((group) => {
      totalVolume += group.totalVolumeKg;
      totalSets += group.sets.length;
      if (group.bestSetE1rmKg > maxE1rm) {
        maxE1rm = group.bestSetE1rmKg;
        topExName = group.exerciseName;
      }
    });

    return {
      totalVolumeKg: totalVolume,
      totalSets,
      bestE1rmKg: maxE1rm,
      bestE1rmExerciseName: topExName,
    };
  }, [workoutData, groupedExercises]);

  const handleDelete = () => {
    if (!workoutId) return;
    Alert.alert(
      'Delete Workout',
      'Are you sure you want to delete this workout? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (onDeleteSession) {
              onDeleteSession(workoutId);
            } else {
              await workoutRepo.delete(workoutId);
            }
            onClose();
          },
        },
      ]
    );
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.titleContainer}>
              {isImmediateSummary && (
                <View testID="immediate-summary-banner" style={styles.completionBanner}>
                  <Text style={styles.completionBannerText}>WORKOUT COMPLETED! 🎉</Text>
                </View>
              )}
              <Text style={styles.modalTitle} numberOfLines={1}>
                {workoutData ? workoutData.workout.name : 'Workout Details'}
              </Text>
              {workoutData && (
                <Text style={styles.modalSubtitle}>
                  {formatDateTime(workoutData.workout.date)} •{' '}
                  {formatDuration(workoutData.workout.duration_seconds)}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              accessibilityLabel="Close Details Modal"
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#00E676" />
              <Text style={styles.loadingText}>Loading session details...</Text>
            </View>
          ) : !workoutData ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>Workout session not found.</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scrollContent}
              contentContainerStyle={styles.scrollContentContainer}
              showsVerticalScrollIndicator={false}
            >
              {/* Summary Metrics Cards */}
              <View style={styles.summaryGrid}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryCardLabel}>TOTAL VOLUME</Text>
                  <Text style={styles.summaryCardValue}>
                    {formatWeight(stats.totalVolumeKg, unitSystem, { precision: 0 })}
                  </Text>
                </View>

                <View style={styles.summaryCard}>
                  <Text style={styles.summaryCardLabel}>TOTAL SETS</Text>
                  <Text style={styles.summaryCardValue}>{stats.totalSets}</Text>
                </View>

                <View style={styles.summaryCard}>
                  <Text style={styles.summaryCardLabel}>DURATION</Text>
                  <Text style={styles.summaryCardValue}>
                    {formatDuration(workoutData.workout.duration_seconds)}
                  </Text>
                </View>

                <View style={styles.summaryCard}>
                  <Text style={styles.summaryCardLabel}>TOP e1RM</Text>
                  <Text style={styles.summaryCardValue}>
                    {stats.bestE1rmKg > 0
                      ? formatWeight(stats.bestE1rmKg, unitSystem, { precision: 1 })
                      : '—'}
                  </Text>
                  {stats.bestE1rmExerciseName ? (
                    <Text style={styles.summaryCardSubtext} numberOfLines={1}>
                      {stats.bestE1rmExerciseName}
                    </Text>
                  ) : null}
                </View>
              </View>

              {/* Session Notes if any */}
              {workoutData.workout.notes ? (
                <View style={styles.notesCard}>
                  <Text style={styles.notesLabel}>SESSION NOTES</Text>
                  <Text style={styles.notesText}>{workoutData.workout.notes}</Text>
                </View>
              ) : null}

              {/* Status Badge */}
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusBadge,
                    workoutData.workout.status === 'completed'
                      ? styles.statusCompleted
                      : styles.statusInProgress,
                  ]}
                >
                  <Text style={styles.statusBadgeText}>
                    {workoutData.workout.status.toUpperCase()}
                  </Text>
                </View>
                {workoutData.workout.imported_from && (
                  <View style={styles.importBadge}>
                    <Text style={styles.importBadgeText}>
                      Imported from {workoutData.workout.imported_from}
                    </Text>
                  </View>
                )}
              </View>

              {/* Exercise Breakdown */}
              <Text style={styles.sectionHeading}>EXERCISES PERFORMED</Text>

              {groupedExercises.map((group, exIdx) => {
                const groupSuperset = supersetInfo.exerciseMap.get(group.exerciseId);

                return (
                  <View key={group.exerciseId} style={styles.exerciseCard}>
                    <View style={styles.exerciseCardHeader}>
                      <View style={styles.exerciseInfoLeft}>
                        <Text style={styles.exerciseIndex}>{exIdx + 1}.</Text>
                        <View style={styles.exerciseNameContainer}>
                          <View style={styles.exerciseNameRow}>
                            <Text style={styles.exerciseNameText}>
                              {group.exerciseName}
                            </Text>
                            {groupSuperset && (
                              <View
                                testID={`superset-header-badge-${group.exerciseId}`}
                                style={styles.supersetHeaderBadge}
                              >
                                <Text style={styles.supersetHeaderBadgeText}>
                                  {groupSuperset.badgeLabel}
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.exerciseMetaText}>
                            {group.muscleGroup} • {group.category}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.exerciseSummaryRight}>
                        <Text style={styles.exerciseTonnageText}>
                          {formatWeight(group.totalVolumeKg, unitSystem, {
                            precision: 0,
                          })}
                        </Text>
                        {group.bestSetE1rmKg > 0 && (
                          <Text style={styles.exerciseBestE1rmText}>
                            e1RM: {formatWeight(group.bestSetE1rmKg, unitSystem)}
                          </Text>
                        )}
                      </View>
                    </View>

                    {/* Sets Table Header */}
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.thCell, styles.cellSetNum]}>SET</Text>
                      <Text style={[styles.thCell, styles.cellType]}>TYPE</Text>
                      <Text style={[styles.thCell, styles.cellLoad]}>
                        LOAD ({unitSystem.toUpperCase()})
                      </Text>
                      <Text style={[styles.thCell, styles.cellReps]}>REPS</Text>
                      <Text style={[styles.thCell, styles.cellIntensity]}>
                        {intensityMetric}
                      </Text>
                      <Text style={[styles.thCell, styles.cellE1rm]}>e1RM</Text>
                    </View>

                    {/* Sets Rows */}
                    {group.sets.map((s) => {
                      const setE1rm = s.set_type === 'warmup'
                        ? 0
                        : calculateHeuristic1RM(s.weight, s.reps, {
                            rir: s.rir,
                            rpe: s.rpe,
                          });
                      const setSuperset =
                        supersetInfo.setMap.get(s.id) ??
                        (s.exercise_group_id ? groupSuperset : undefined);

                      return (
                        <View key={s.id} style={styles.tableDataRow}>
                          <Text style={[styles.tdCell, styles.cellSetNum]}>
                            {s.set_number}
                          </Text>

                          <View style={styles.cellType}>
                            {setSuperset && (
                              <View
                                testID={`superset-set-badge-${s.id}`}
                                style={styles.supersetSetBadge}
                              >
                                <Text style={styles.supersetSetBadgeText}>
                                  {setSuperset.badgeLabel}
                                </Text>
                              </View>
                            )}
                            {s.set_type !== 'working' && (
                              <View
                                style={[
                                  styles.setTypeBadge,
                                  s.set_type === 'warmup' && styles.typeWarmup,
                                  s.set_type === 'drop' && styles.typeDrop,
                                  s.set_type === 'dc' && styles.typeDc,
                                  s.set_type === 'myorep' && styles.typeMyorep,
                                  s.set_type === 'amrap' && styles.typeAmrap,
                                ]}
                              >
                                <Text style={styles.setTypeBadgeText}>
                                  {s.set_type === 'dc'
                                    ? 'DC'
                                    : s.set_type === 'myorep'
                                    ? 'Myo'
                                    : s.set_type === 'drop'
                                    ? 'Drop'
                                    : s.set_type === 'amrap'
                                    ? 'AMRAP'
                                    : 'Warm'}
                                </Text>
                              </View>
                            )}
                          </View>

                          <Text style={[styles.tdCell, styles.cellLoad, styles.boldCell]}>
                            {formatWeight(s.weight, unitSystem, { showUnit: false })}
                          </Text>

                          <Text style={[styles.tdCell, styles.cellReps, styles.boldCell]}>
                            {s.reps_right != null
                              ? `${s.reps} / ${s.reps_right}`
                              : `${s.reps}`}
                          </Text>

                          <Text style={[styles.tdCell, styles.cellIntensity]}>
                            {formatIntensityValue(s, intensityMetric)}
                          </Text>

                          <Text style={[styles.tdCell, styles.cellE1rm, styles.accentCell]}>
                            {setE1rm > 0
                              ? formatWeight(setE1rm, unitSystem, { showUnit: false })
                              : '—'}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })}

              {/* Delete / Actions Footer */}
              <View style={styles.footerActions}>
                {isImmediateSummary ? (
                  <TouchableOpacity
                    testID="done-summary-button"
                    style={styles.doneSummaryButton}
                    onPress={onClose}
                    accessibilityLabel="Done and View in Calendar"
                  >
                    <Text style={styles.doneSummaryButtonText}>
                      Done — View in Calendar
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={handleDelete}
                    accessibilityLabel="Delete Workout Button"
                  >
                    <Text style={styles.deleteButtonText}>Delete Workout</Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    height: '92%',
    backgroundColor: '#09090B',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#27272A',
    paddingTop: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  titleContainer: {
    flex: 1,
    marginRight: 12,
  },
  completionBanner: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderWidth: 1,
    borderColor: '#00E676',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  completionBannerText: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FAFAFA',
    letterSpacing: 0.3,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#A1A1AA',
    marginTop: 3,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#A1A1AA',
    fontSize: 14,
    marginTop: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    color: '#A1A1AA',
    fontSize: 15,
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 10,
    padding: 12,
  },
  summaryCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#71717A',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  summaryCardValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  summaryCardSubtext: {
    fontSize: 11,
    color: '#00E676',
    marginTop: 2,
    fontWeight: '600',
  },
  notesCard: {
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  notesLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#71717A',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  notesText: {
    fontSize: 14,
    color: '#D4D4D8',
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusCompleted: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderWidth: 1,
    borderColor: '#00E676',
  },
  statusInProgress: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#00E676',
    letterSpacing: 0.5,
  },
  importBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  importBadgeText: {
    fontSize: 11,
    color: '#A1A1AA',
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '800',
    color: '#A1A1AA',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },
  exerciseCard: {
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
    paddingBottom: 10,
  },
  exerciseInfoLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    flex: 1,
  },
  exerciseIndex: {
    fontSize: 15,
    fontWeight: '800',
    color: '#00E676',
  },
  exerciseNameContainer: {
    flex: 1,
  },
  exerciseNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  supersetHeaderBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(6, 182, 212, 0.18)',
    borderWidth: 1,
    borderColor: '#06B6D4',
  },
  supersetHeaderBadgeText: {
    color: '#22D3EE',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  exerciseNameText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  exerciseMetaText: {
    fontSize: 12,
    color: '#71717A',
    marginTop: 2,
  },
  exerciseSummaryRight: {
    alignItems: 'flex-end',
  },
  exerciseTonnageText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#D4D4D8',
  },
  exerciseBestE1rmText: {
    fontSize: 11,
    color: '#00E676',
    marginTop: 2,
    fontWeight: '600',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
    marginBottom: 4,
  },
  thCell: {
    fontSize: 10,
    fontWeight: '700',
    color: '#71717A',
    letterSpacing: 0.5,
  },
  tableDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(39, 39, 42, 0.4)',
  },
  tdCell: {
    fontSize: 13,
    color: '#D4D4D8',
  },
  boldCell: {
    fontWeight: '700',
    color: '#FAFAFA',
  },
  accentCell: {
    fontWeight: '700',
    color: '#00E676',
  },
  cellSetNum: {
    width: 32,
    textAlign: 'center',
  },
  cellType: {
    minWidth: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  supersetSetBadge: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    borderWidth: 1,
    borderColor: '#06B6D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  supersetSetBadgeText: {
    color: '#22D3EE',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  cellLoad: {
    flex: 1.2,
    textAlign: 'right',
    paddingRight: 8,
  },
  cellReps: {
    flex: 1,
    textAlign: 'center',
  },
  cellIntensity: {
    flex: 1.1,
    textAlign: 'center',
    fontSize: 11,
  },
  cellE1rm: {
    flex: 1.1,
    textAlign: 'right',
    paddingRight: 4,
  },
  setTypeBadge: {
    minWidth: 28,
    height: 18,
    paddingHorizontal: 3,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeWarmup: {
    backgroundColor: '#F59E0B',
  },
  typeWorking: {
    backgroundColor: '#3B82F6',
  },
  typeDrop: {
    backgroundColor: '#EC4899',
  },
  typeDc: {
    backgroundColor: '#1E3A8A',
  },
  typeMyorep: {
    backgroundColor: '#8B5CF6',
  },
  typeAmrap: {
    backgroundColor: '#7F1D1D',
  },
  setTypeBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  footerActions: {
    marginTop: 16,
    alignItems: 'center',
  },
  doneSummaryButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#00E676',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneSummaryButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  deleteButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  deleteButtonText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '700',
  },
});
