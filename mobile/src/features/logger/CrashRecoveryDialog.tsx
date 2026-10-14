/**
 * Workout Suite — CrashRecoveryDialog
 *
 * Implements ADR-010: Write-Through Crash Recovery for Active Sessions
 *
 * Prompts the user upon application or logger launch when an uncompleted
 * 'in_progress' session is detected in SQLite.
 *
 * Displays:
 * - Session name, date, elapsed duration, and set progress
 * - "Resume Workout" (loads session back into active logger)
 * - "Discard Workout" (marks workout as discarded)
 * - "Later" (dismisses dialog without altering session state)
 */

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { CrashRecoveryPromptData } from '../../services/crashRecoveryService';

export interface CrashRecoveryDialogProps {
  visible: boolean;
  recoveryData: CrashRecoveryPromptData | null;
  onResume: (workoutId: string) => Promise<void>;
  onDiscard: (workoutId: string) => Promise<void>;
  onDismiss: () => void;
}

export const CrashRecoveryDialog: React.FC<CrashRecoveryDialogProps> = ({
  visible,
  recoveryData,
  onResume,
  onDiscard,
  onDismiss,
}) => {
  const [loadingAction, setLoadingAction] = useState<'resume' | 'discard' | null>(null);

  if (!visible || !recoveryData) {
    return null;
  }

  const { workout, summary } = recoveryData;

  const handleResume = async () => {
    setLoadingAction('resume');
    try {
      await onResume(workout.id);
    } catch (err) {
      console.error('Failed to resume session:', err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDiscard = async () => {
    setLoadingAction('discard');
    try {
      await onDiscard(workout.id);
    } catch (err) {
      console.error('Failed to discard session:', err);
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <Modal
      testID="crash-recovery-dialog"
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.dialogCard}>
          {/* Top Alert Accent Banner */}
          <View style={styles.alertHeader}>
            <View style={styles.warningIconWrapper}>
              <Text style={styles.warningIconText}>⚡</Text>
            </View>
            <View style={styles.titleWrapper}>
              <Text style={styles.dialogTitle}>Interrupted Workout Detected</Text>
              <Text style={styles.dialogSubtitle}>
                You have an active session that was not completed.
              </Text>
            </View>
          </View>

          {/* Session Overview Box */}
          <View style={styles.summaryContainer}>
            <Text testID="recovery-workout-name" style={styles.workoutName}>
              {workout.name}
            </Text>
            <Text style={styles.workoutDate}>Started on {workout.date}</Text>

            {/* Stat Badges Grid */}
            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>ELAPSED</Text>
                <Text testID="recovery-elapsed-time" style={styles.statValue}>
                  {summary.formattedElapsedTime}
                </Text>
              </View>

              <View style={styles.statBox}>
                <Text style={styles.statLabel}>SETS LOGGED</Text>
                <Text testID="recovery-completed-sets" style={styles.statValue}>
                  {summary.completedSets} / {summary.totalSets}
                </Text>
              </View>

              <View style={styles.statBox}>
                <Text style={styles.statLabel}>EXERCISES</Text>
                <Text testID="recovery-exercises-count" style={styles.statValue}>
                  {summary.uniqueExercises}
                </Text>
              </View>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionsContainer}>
            {/* Resume Button */}
            <TouchableOpacity
              testID="recovery-resume-button"
              style={styles.resumeButton}
              onPress={handleResume}
              disabled={loadingAction !== null}
            >
              {loadingAction === 'resume' ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <Text style={styles.resumeButtonText}>Resume Workout</Text>
              )}
            </TouchableOpacity>

            {/* Discard Button */}
            <TouchableOpacity
              testID="recovery-discard-button"
              style={styles.discardButton}
              onPress={handleDiscard}
              disabled={loadingAction !== null}
            >
              {loadingAction === 'discard' ? (
                <ActivityIndicator size="small" color="#EF4444" />
              ) : (
                <Text style={styles.discardButtonText}>Discard Session</Text>
              )}
            </TouchableOpacity>

            {/* Later / Dismiss */}
            <TouchableOpacity
              testID="recovery-dismiss-button"
              style={styles.dismissButton}
              onPress={onDismiss}
              disabled={loadingAction !== null}
            >
              <Text style={styles.dismissButtonText}>Decide Later</Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialogCard: {
    width: '100%',
    backgroundColor: '#09090B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 20,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  warningIconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#78350F',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  warningIconText: {
    fontSize: 18,
  },
  titleWrapper: {
    flex: 1,
  },
  dialogTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  dialogSubtitle: {
    fontSize: 12,
    color: '#A1A1AA',
    marginTop: 2,
  },
  summaryContainer: {
    backgroundColor: '#121215',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E1E24',
    padding: 14,
    marginBottom: 16,
  },
  workoutName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  workoutDate: {
    fontSize: 12,
    color: '#71717A',
    marginTop: 2,
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#18181B',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#71717A',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#00E676',
  },
  actionsContainer: {
    gap: 10,
  },
  resumeButton: {
    backgroundColor: '#00E676',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  resumeButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
  discardButton: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  discardButtonText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '700',
  },
  dismissButton: {
    paddingVertical: 6,
    alignItems: 'center',
  },
  dismissButtonText: {
    color: '#71717A',
    fontSize: 13,
    fontWeight: '600',
  },
});
