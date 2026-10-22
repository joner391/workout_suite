import { colors as uiColors } from '../../ui/theme';
import { AppIcon } from '../../ui/AppIcon';
/**
 * Workout Suite — MentalityTransitionBanner
 *
 * Implements Phase 8 Step 8.4: Active Logger Transition Banner
 * Renders a diagnostic and motivational banner in ActiveLoggerScreen during transition weeks
 * (e.g., "Mentality Transition: Week 1 of 3 (Precision → Fury) — RPE ramping (+0.5) while 1 set is trimmed to maintain 32 weekly eReps").
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  TransitionWaveStep,
  getMentalityDisplayName,
} from '../../core/generator/transitionWave';

export interface MentalityTransitionBannerProps {
  transitionWave: TransitionWaveStep | null | undefined;
  onDismiss?: () => void;
}

export const MentalityTransitionBanner: React.FC<MentalityTransitionBannerProps> = ({
  transitionWave,
  onDismiss,
}) => {
  if (!transitionWave || !transitionWave.isTransitionActive) {
    return null;
  }

  const fromName = getMentalityDisplayName(transitionWave.fromMentality);
  const toName = getMentalityDisplayName(transitionWave.toMentality);
  const progressPct = Math.round(transitionWave.progressFraction * 100);

  return (
    <View
      testID="mentality-transition-banner"
      style={styles.bannerContainer}
      accessibilityRole="summary"
      accessibilityLabel={transitionWave.bannerMessage}
    >
      <View style={styles.contentRow}>
        <AppIcon name="bolt" size={20} color={uiColors.accentText} />
        <View style={styles.textContainer}>
          <View style={styles.titleRow}>
            <Text style={styles.categoryBadge}>MENTALITY TRANSITION</Text>
            <Text style={styles.weekBadge}>
              Week {transitionWave.currentWeek}/{transitionWave.totalWeeks} ({fromName} → {toName})
            </Text>
          </View>
          <Text testID="mentality-transition-text" style={styles.explanationText}>
            {transitionWave.bannerMessage}
          </Text>

          {/* Linear Progress Track */}
          <View style={styles.progressTrackContainer}>
            <View
              testID="transition-progress-bar"
              style={[styles.progressBar, { width: `${progressPct}%` }]}
            />
          </View>
        </View>

        {onDismiss && (
          <TouchableOpacity
            testID="mentality-transition-dismiss-button"
            style={styles.dismissButton}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss mentality transition banner"
          >
            <AppIcon name="close" size={20} color={uiColors.accentText} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bannerContainer: {
    backgroundColor: '#1E1B4B', // Deep indigo / violet OLED container
    borderColor: '#6366F1',
    borderWidth: 1,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 10,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  textContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 4,
    gap: 6,
  },
  categoryBadge: {
    color: '#A5B4FC',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  weekBadge: {
    color: '#C7D2FE',
    fontSize: 11,
    fontWeight: '600',
  },
  explanationText: {
    color: '#F8FAFC',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  progressTrackContainer: {
    height: 4,
    backgroundColor: '#312E81',
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  progressBar: {
    height: 4,
    backgroundColor: '#818CF8',
    borderRadius: 2,
  },
  dismissButton: {
    paddingLeft: 8,
    paddingTop: 2,
  },
});
