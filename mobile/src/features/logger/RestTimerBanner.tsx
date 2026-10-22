import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
/**
 * Workout Suite — RestTimerBanner
 *
 * Implements a sticky / embedded in-gym rest timer component.
 * Subscribes directly to RestTimerService for drift-free wall-clock updates.
 *
 * Controls:
 * - 1-tap +30s / -30s time adjustment
 * - Pause / Resume toggle
 * - Skip rest timer
 * - Visual progress bar and time remaining in MM:SS
 * - High-contrast OLED dark theme (#000000 / #18181B)
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { RestTimerService, RestTimerState } from '../../services/restTimerService';

export interface RestTimerBannerProps {
  timerService: RestTimerService;
  onTimerComplete?: () => void;
  activeExerciseName?: string | null;
}

/**
 * Formats seconds into MM:SS format.
 */
export function formatTimeRemaining(seconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const RestTimerBanner: React.FC<RestTimerBannerProps> = ({
  timerService,
  onTimerComplete,
  activeExerciseName,
}) => {
  const [timerState, setTimerState] = useState<RestTimerState>(timerService.getState());

  useEffect(() => {
    // Initial fetch
    setTimerState(timerService.getState());

    // Subscribe to timer state updates
    const unsubscribe = timerService.subscribe((newState) => {
      setTimerState(newState);
      if (newState.status === 'completed' && onTimerComplete) {
        onTimerComplete();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [timerService, onTimerComplete]);

  // If idle, do not render banner
  if (timerState.status === 'idle') {
    return null;
  }

  const { status, remainingSeconds, totalDurationSeconds } = timerState;
  const isPaused = status === 'paused';
  const isCompleted = status === 'completed';

  // Progress percentage (0% to 100%)
  const progressPercent = totalDurationSeconds > 0
    ? Math.max(0, Math.min(100, ((totalDurationSeconds - remainingSeconds) / totalDurationSeconds) * 100))
    : 100;

  return (
    <View
      testID="rest-timer-banner"
      style={[
        styles.container,
        isCompleted ? styles.completedContainer : isPaused ? styles.pausedContainer : styles.runningContainer,
      ]}
    >
      {/* Top progress bar */}
      <View style={styles.progressBarBackground}>
        <View
          testID="rest-timer-progress-bar"
          style={[
            styles.progressBarFill,
            { width: `${progressPercent}%` },
            isCompleted && styles.completedProgressFill,
            isPaused && styles.pausedProgressFill,
          ]}
        />
      </View>

      <View style={styles.contentRow}>
        {/* Left: Time and Status Label */}
        <View style={styles.timeSection}>
          <Text testID="rest-timer-countdown" style={styles.timeText}>
            {isCompleted ? 'REST OVER' : formatTimeRemaining(remainingSeconds)}
          </Text>
          <View style={styles.statusBadge}>
            <View
              style={[
                styles.statusDot,
                isCompleted
                  ? styles.statusDotCompleted
                  : isPaused
                  ? styles.statusDotPaused
                  : styles.statusDotRunning,
              ]}
            />
            <Text style={styles.statusLabel}>
              {isCompleted
                ? 'READY'
                : isPaused
                ? 'PAUSED'
                : activeExerciseName
                ? `REST: ${activeExerciseName}`
                : 'RESTING'}
            </Text>
          </View>
        </View>

        {/* Right: Quick Action Controls */}
        <View style={styles.controlsSection}>
          {!isCompleted ? (
            <>
              {/* -30s Button */}
              <TouchableOpacity
                testID="rest-timer-minus-30"
                style={styles.adjustButton}
                onPress={() => timerService.subtract30Seconds()}
                accessibilityLabel="Subtract 30 seconds"
              >
                <Text style={styles.adjustButtonText}>-30s</Text>
              </TouchableOpacity>

              {/* +30s Button */}
              <TouchableOpacity
                testID="rest-timer-plus-30"
                style={styles.adjustButton}
                onPress={() => timerService.add30Seconds()}
                accessibilityLabel="Add 30 seconds"
              >
                <Text style={styles.adjustButtonText}>+30s</Text>
              </TouchableOpacity>

              {/* Pause / Resume Button */}
              <TouchableOpacity
                testID="rest-timer-pause-resume"
                style={styles.actionButton}
                onPress={() => (isPaused ? timerService.resume() : timerService.pause())}
                accessibilityLabel={isPaused ? 'Resume rest timer' : 'Pause rest timer'}
              >
                <Text style={styles.actionButtonText}>{isPaused ? '▶' : '⏸'}</Text>
              </TouchableOpacity>

              {/* Skip Button */}
              <TouchableOpacity
                testID="rest-timer-skip"
                style={styles.skipButton}
                onPress={() => timerService.skip()}
                accessibilityLabel="Skip rest timer"
              >
                <Text style={styles.skipButtonText}>SKIP</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              testID="rest-timer-dismiss"
              style={styles.dismissButton}
              onPress={() => timerService.skip()}
              accessibilityLabel="Dismiss completed timer"
            >
              <Text style={styles.dismissButtonText}>DISMISS</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: uiColors.raised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.border,
    marginHorizontal: 12,
    marginVertical: 6,
    overflow: 'hidden',
  },
  runningContainer: {
    borderColor: '#15803D', // Dark green border
  },
  pausedContainer: {
    borderColor: '#B45309', // Dark amber border
  },
  completedContainer: {
    borderColor: uiColors.accent, // Vivid green glow
    backgroundColor: uiColors.onAccent,
  },
  progressBarBackground: {
    height: 4,
    width: '100%',
    backgroundColor: uiColors.border,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#22C55E',
  },
  pausedProgressFill: {
    backgroundColor: '#F59E0B',
  },
  completedProgressFill: {
    backgroundColor: uiColors.accent,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  timeSection: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  timeText: {
    fontSize: 24,
    fontWeight: '700',
    color: uiColors.text,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusDotRunning: {
    backgroundColor: '#22C55E',
  },
  statusDotPaused: {
    backgroundColor: '#F59E0B',
  },
  statusDotCompleted: {
    backgroundColor: uiColors.accent,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: uiColors.muted,
    textTransform: 'uppercase',
  },
  controlsSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  adjustButton: {
    backgroundColor: uiColors.border,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: uiRadius.control,
    borderWidth: 1,
    borderColor: '#3F3F46',
  },
  adjustButtonText: {
    color: '#E4E4E7',
    fontSize: 11,
    fontWeight: '700',
  },
  actionButton: {
    backgroundColor: '#3F3F46',
    width: 32,
    height: 32,
    borderRadius: uiRadius.control,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonText: {
    color: uiColors.text,
    fontSize: 13,
  },
  skipButton: {
    backgroundColor: '#3F3F46',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: uiRadius.control,
  },
  skipButtonText: {
    color: uiColors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  dismissButton: {
    backgroundColor: uiColors.accent,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: uiRadius.control,
  },
  dismissButtonText: {
    color: uiColors.background,
    fontSize: 12,
    fontWeight: '700',
  },
});
