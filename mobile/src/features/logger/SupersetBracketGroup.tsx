import { radius as uiRadius } from '../../ui/theme';
/**
 * Workout Suite — SupersetBracketGroup Component
 *
 * Implements Step 2.1: Superset Grouping & Unilateral Limb Mechanics
 * Implements ADR-009: Superset & Giant Set Exercise Grouping
 *
 * Features:
 * - High-contrast visual bracket grouping multi-exercise circuits and antagonist pairs
 * - Distinct left connector accent bar (#3B82F6) establishing visual continuity
 * - Header displaying circuit classification (SUPERSET vs. GIANT SET), participant exercise names,
 *   and rest timer behavior indicator
 * - 1-tap "Ungroup" action to dissolve the superset bracket back into standalone movements
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Exercise } from '../../core/types';

export interface SupersetBracketGroupProps {
  groupId: string;
  exercises: Exercise[];
  onUngroup: (groupId: string) => void;
  children: React.ReactNode;
}

export const SupersetBracketGroup: React.FC<SupersetBracketGroupProps> = React.memo(({
  groupId,
  exercises,
  onUngroup,
  children,
}) => {
  const isGiantSet = exercises.length > 2;
  const badgeLabel = isGiantSet ? 'GIANT SET' : 'SUPERSET';
  const exerciseNamesSummary = exercises.map((e) => e.name).join(' ⇄ ');
  const finalExerciseName = exercises.length > 0 ? exercises[exercises.length - 1].name : 'final exercise';

  return (
    <View
      testID={`superset-bracket-${groupId}`}
      style={styles.bracketContainer}
      accessibilityLabel={`${badgeLabel} bracket containing ${exercises.length} exercises`}
    >
      {/* Superset Bracket Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View style={[styles.badge, isGiantSet ? styles.giantSetBadge : styles.supersetBadge]}>
            <Text style={[styles.badgeText, isGiantSet ? styles.giantSetBadgeText : styles.supersetBadgeText]}>
              {badgeLabel}
            </Text>
          </View>
          <Text testID="superset-exercise-count" style={styles.exerciseCountText}>
            ({exercises.length} Exercises)
          </Text>
        </View>

        {/* Ungroup Button */}
        <TouchableOpacity
          testID={`ungroup-superset-button-${groupId}`}
          style={styles.ungroupButton}
          onPress={() => onUngroup(groupId)}
          accessibilityLabel={`Ungroup ${badgeLabel}`}
        >
          <Text style={styles.ungroupButtonText}>✕ Ungroup</Text>
        </TouchableOpacity>
      </View>

      {/* Exercise Names & Circuit Indicator */}
      <Text style={styles.summaryText} numberOfLines={1}>
        {exerciseNamesSummary}
      </Text>

      {/* Rest Timer Behavior Subtext Indicator (ADR-009) */}
      <View style={styles.restIndicatorRow}>
        <Text style={styles.restIndicatorText}>
          ⏱ Rest timer triggers after {finalExerciseName}
        </Text>
      </View>

      {/* Grouped Exercise Cards (Children) */}
      <View style={styles.bracketBody}>{children}</View>
    </View>
  );
});

const styles = StyleSheet.create({
  bracketContainer: {
    backgroundColor: '#0E131F',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    borderLeftWidth: 4,
    borderLeftColor: '#3B82F6',
    marginVertical: 8,
    padding: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: uiRadius.badge,
  },
  supersetBadge: {
    backgroundColor: '#1E3A8A',
  },
  giantSetBadge: {
    backgroundColor: '#4C1D95',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  supersetBadgeText: {
    color: '#93C5FD',
  },
  giantSetBadgeText: {
    color: '#DDD6FE',
  },
  exerciseCountText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  ungroupButton: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#1E293B',
    borderRadius: uiRadius.control,
    borderWidth: 1,
    borderColor: '#334155',
  },
  ungroupButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F87171',
  },
  summaryText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
    marginBottom: 4,
  },
  restIndicatorRow: {
    backgroundColor: '#141D2E',
    borderRadius: 4,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  restIndicatorText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#38BDF8',
  },
  bracketBody: {
    gap: 8,
  },
});
