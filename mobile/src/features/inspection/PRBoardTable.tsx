import { AppIcon } from '../../ui/AppIcon';
import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
/**
 * Workout Suite — PRBoardTable
 *
 * Implements Step 3.3: Rep-Max PR Board Table UI
 * Implements ADR-012: Cross-Variant Aggregation for Movement Families
 * Implements ADR-024: Pure Utility Mode (OLED-friendly high-contrast styling)
 *
 * Features:
 * - Tabular display of heaviest load lifted per unique repetition count (1RM, 2RM, 3RM, etc.)
 * - Set e1RM benchmark display (w * r_eff^k) computed with Lombardi power-law
 * - Highlight badge for the all-time PEAK e1RM performance
 * - Scope toggle: All-Time records vs Program Block date range
 * - Variant aggregation toggle: Include child/parent variant lifts
 * - Tap-to-view historical session integration (invoking onSelectWorkout)
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {
  RepMaxRecord,
  WeightUnit,
  IntensityMetric,
} from '../../core/types';
import { formatWeight } from '../../core/math/unitConversion';

export interface PRBoardTableProps {
  records: RepMaxRecord[];
  peakRecord: RepMaxRecord | null;
  scope: 'all_time' | 'program_block';
  onScopeChange?: (scope: 'all_time' | 'program_block') => void;
  includeVariants: boolean;
  onIncludeVariantsChange?: (include: boolean) => void;
  hasVariants?: boolean;
  unitSystem: WeightUnit;
  intensityMetric?: IntensityMetric;
  onSelectWorkout?: (workoutId: string) => void;
  loading?: boolean;
}

export const PRBoardTable: React.FC<PRBoardTableProps> = ({
  records,
  peakRecord,
  scope,
  onScopeChange,
  includeVariants,
  onIncludeVariantsChange,
  hasVariants = false,
  unitSystem,
  intensityMetric = 'RPE',
  onSelectWorkout,
  loading = false,
}) => {
  const displayLoad = (weightKg: number) => {
    return formatWeight(weightKg, unitSystem);
  };

  const displayEffort = (rec: RepMaxRecord) => {
    if (intensityMetric === 'RIR') {
      if (rec.rir !== null && rec.rir !== undefined) {
        return `${rec.rir} RIR`;
      }
      if (rec.rpe !== null && rec.rpe !== undefined) {
        return `${Math.max(0, 10 - rec.rpe)} RIR`;
      }
    } else {
      if (rec.rpe !== null && rec.rpe !== undefined) {
        return `@${rec.rpe}`;
      }
      if (rec.rir !== null && rec.rir !== undefined) {
        return `@${10 - rec.rir}`;
      }
    }
    return '—';
  };

  return (
    <View style={styles.container} testID="pr-board-table">
      {/* Top Filter Controls Bar */}
      <View style={styles.controlsRow}>
        <View style={styles.scopeToggleContainer}>
          <TouchableOpacity
            testID="pr-scope-all-time"
            style={[
              styles.scopeBtn,
              scope === 'all_time' && styles.scopeBtnActive,
            ]}
            onPress={() => onScopeChange && onScopeChange('all_time')}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.scopeBtnText,
                scope === 'all_time' && styles.scopeBtnTextActive,
              ]}
            >
              All-Time
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="pr-scope-program-block"
            style={[
              styles.scopeBtn,
              scope === 'program_block' && styles.scopeBtnActive,
            ]}
            onPress={() => onScopeChange && onScopeChange('program_block')}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.scopeBtnText,
                scope === 'program_block' && styles.scopeBtnTextActive,
              ]}
            >
              Block
            </Text>
          </TouchableOpacity>
        </View>

        {hasVariants && onIncludeVariantsChange && (
          <TouchableOpacity
            testID="pr-toggle-variants"
            style={[
              styles.variantsToggleBtn,
              includeVariants && styles.variantsToggleBtnActive,
            ]}
            onPress={() => onIncludeVariantsChange(!includeVariants)}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.variantsToggleText,
                includeVariants && styles.variantsToggleTextActive,
              ]}
            >
              {includeVariants ? '✓ Variants Included' : '+ Include Variants'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Loading Indicator */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={uiColors.accent} />
          <Text style={styles.loadingText}>Updating PR records...</Text>
        </View>
      ) : records.length === 0 ? (
        /* Empty State */
        <View style={styles.emptyContainer} testID="pr-board-empty">
            <AppIcon name="chart" size={32} color={uiColors.accentText} />
          <Text style={styles.emptyTitle}>No Rep-Max Records Yet</Text>
          <Text style={styles.emptySubtitle}>
            Log completed sets for this exercise to establish your Rep-Max PR Board.
          </Text>
        </View>
      ) : (
        /* PR Table */
        <View style={styles.tableCard}>
          {/* Table Header Row */}
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.columnHeader, styles.colRep]}>REP MAX</Text>
            <Text style={[styles.columnHeader, styles.colWeight]}>LOAD</Text>
            <Text style={[styles.columnHeader, styles.colE1rm]}>SET e1RM</Text>
            <Text style={[styles.columnHeader, styles.colEffort]}>EFFORT</Text>
            <Text style={[styles.columnHeader, styles.colDate]}>DATE</Text>
          </View>

          {/* Table Data Rows */}
          {records.map((rec) => {
            const isPeak =
              !rec.isEnveloped &&
              peakRecord != null &&
              peakRecord.reps === rec.reps &&
              (!peakRecord.setId || peakRecord.setId === rec.setId);
            const isOneRepMax = rec.reps === 1;

            return (
              <TouchableOpacity
                key={`pr-row-${rec.reps}-${rec.setId}`}
                testID={`pr-row-${rec.reps}rm`}
                style={[styles.tableRow, isPeak && styles.tableRowPeak]}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${rec.reps}RM, ${displayLoad(rec.weightKg)}${rec.isEnveloped ? `, proven by a ${rec.derivedFromReps}-rep set` : ''}. ${rec.setDate}. View original workout.`}
                onPress={() => onSelectWorkout && rec.workoutId && onSelectWorkout(rec.workoutId)}
              >
                {/* Rep Max Badge */}
                <View style={styles.colRep}>
                  <View
                    style={[
                      styles.repBadge,
                      isOneRepMax && styles.repBadge1RM,
                      isPeak && !isOneRepMax && styles.repBadgePeak,
                    ]}
                  >
                    <Text
                      style={[
                        styles.repBadgeText,
                        (isOneRepMax || isPeak) && styles.repBadgeTextHighlighted,
                      ]}
                    >
                      {rec.reps}RM
                    </Text>
                  </View>
                </View>

                {/* Weight Column */}
                <View style={styles.colWeight}>
                  <Text style={styles.weightValueText} numberOfLines={1}>
                    {`${displayLoad(rec.weightKg)}${rec.isEnveloped ? '*' : ''}`}
                  </Text>
                </View>

                {/* Set e1RM Column */}
                <View style={styles.colE1rm}>
                  <Text
                    style={[
                      styles.e1rmValueText,
                      isPeak && styles.e1rmValuePeakText,
                    ]}
                  >
                    {displayLoad(rec.e1rmKg)}
                  </Text>
                </View>

                {/* Effort (RPE / RIR) */}
                <View style={styles.colEffort}>
                  <Text style={styles.effortText}>{displayEffort(rec)}</Text>
                </View>

                {/* Date & Tap Indicator */}
                <View style={styles.colDate}>
                  <Text style={styles.dateText}>{rec.setDate}</Text>
                  <Text style={styles.tapArrowText}>›</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Subtext info */}
      {records.length > 0 && (
        <View style={styles.footerContainer}>
          <Text style={styles.footerInfoText}>
            💡 Tap any row to inspect the full historical workout session.
          </Text>
          {records.some((r) => r.isEnveloped) && (
            <Text style={styles.envelopeInfoText}>
              * Proven by a higher-rep set. Tap the row to see the original workout and rep count.
            </Text>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    flexWrap: 'wrap',
    gap: 8,
  },
  scopeToggleContainer: {
    flexDirection: 'row',
    backgroundColor: uiColors.raised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.border,
    padding: 3,
  },
  scopeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: uiRadius.control,
  },
  scopeBtnActive: {
    backgroundColor: uiColors.border,
  },
  scopeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: uiColors.subtle,
  },
  scopeBtnTextActive: {
    color: uiColors.accentText,
  },
  variantsToggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: uiRadius.control,
    borderWidth: 1,
    borderColor: uiColors.border,
    backgroundColor: uiColors.surface,
  },
  variantsToggleBtnActive: {
    borderColor: uiColors.accent,
    backgroundColor: 'rgba(0, 230, 118, 0.1)',
  },
  variantsToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: uiColors.muted,
  },
  variantsToggleTextActive: {
    color: uiColors.accentText,
  },
  loadingContainer: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: uiColors.muted,
    fontSize: 13,
    marginTop: 8,
  },
  emptyContainer: {
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: 12,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: uiColors.text,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: uiColors.subtle,
    textAlign: 'center',
    lineHeight: 18,
  },
  tableCard: {
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: uiColors.raised,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
  },
  columnHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: uiColors.subtle,
    letterSpacing: 0.5,
  },
  colRep: {
    width: 60,
  },
  colWeight: {
    flex: 1.2,
  },
  colE1rm: {
    flex: 1.3,
  },
  colEffort: {
    width: 55,
    alignItems: 'center',
  },
  colDate: {
    width: 85,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
  },
  tableRowPeak: {
    backgroundColor: 'rgba(255, 215, 0, 0.05)',
  },
  repBadge: {
    minHeight: 26,
    justifyContent: 'center',
    backgroundColor: uiColors.raised,
    borderRadius: uiRadius.badge,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: uiColors.border,
  },
  repBadge1RM: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderColor: uiColors.accent,
  },
  repBadgePeak: {
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    borderColor: '#FFD700',
  },
  repBadgeText: {
    lineHeight: 16,
    fontSize: 11,
    fontWeight: '600',
    color: uiColors.text,
  },
  repBadgeTextHighlighted: {
    color: uiColors.accentText,
  },
  weightValueText: {
    fontSize: 14,
    fontWeight: '700',
    color: uiColors.text,
  },
  e1rmValueText: {
    fontSize: 13,
    fontWeight: '600',
    color: uiColors.muted,
  },
  e1rmValuePeakText: {
    color: '#FFD700',
    fontWeight: '700',
  },
  effortText: {
    fontSize: 12,
    color: uiColors.muted,
    fontWeight: '600',
  },
  dateText: {
    fontSize: 11,
    color: uiColors.subtle,
    fontWeight: '500',
  },
  tapArrowText: {
    fontSize: 14,
    color: uiColors.subtle,
    marginLeft: 4,
    fontWeight: '700',
  },
  footerInfoText: {
    fontSize: 11,
    color: uiColors.subtle,
  },
  footerContainer: {
    marginTop: 6,
    paddingHorizontal: 4,
    gap: 4,
  },
  envelopeInfoText: {
    fontSize: 11,
    color: '#38BDF8',
    lineHeight: 15,
  },
});
