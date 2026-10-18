/**
 * Workout Suite — Rest Timer Service
 *
 * Implements a drift-free rest timer state machine.
 * Uses wall-clock timestamp calculations (`endTimeMs - Date.now()`) so device lock,
 * background sleep, and OS throttling never cause timer drift.
 *
 * Implements ADR-009: Suppresses timer triggers within superset/giant set groups
 * until the final exercise in the group completes its set.
 */

import * as Haptics from 'expo-haptics';

// Safe lazy loading of expo-notifications to prevent runtime crashes in Expo Go on Android
// where FCM/topic subscription native modules (ExpoTopicSubscriptionModule) are omitted.
let Notifications: any = null;
try {
  // First attempt subpath loading which bypasses topicSubscription.js
  const { scheduleNotificationAsync } = require('expo-notifications/build/scheduleNotificationAsync');
  const { cancelScheduledNotificationAsync } = require('expo-notifications/build/cancelScheduledNotificationAsync');
  const { setNotificationHandler } = require('expo-notifications/build/NotificationsHandler');
  const { SchedulableTriggerInputTypes } = require('expo-notifications/build/Notifications.types');
  Notifications = {
    scheduleNotificationAsync,
    cancelScheduledNotificationAsync,
    setNotificationHandler,
    SchedulableTriggerInputTypes,
  };
} catch {
  try {
    // Fallback: standard package import (for Jest mocks and standalone production builds)
    Notifications = require('expo-notifications');
  } catch {
    // Graceful fallback for sandboxed runtimes (e.g. Expo Go on Android)
    Notifications = null;
  }
}

export type RestTimerStatus = 'idle' | 'running' | 'paused' | 'completed';

export interface RestTimerState {
  status: RestTimerStatus;
  totalDurationSeconds: number;
  remainingSeconds: number;
  endTimeMs: number | null; // Wall-clock timestamp in ms when timer reaches 0
  pausedRemainingMs: number | null; // Milliseconds remaining when paused
  exerciseId: string | null;
  exerciseGroupId: string | null;
  lastUpdatedMs: number;
}

export type RestTimerListener = (state: RestTimerState) => void;

// Safe global initialization of notification behavior
try {
  if (Notifications?.setNotificationHandler) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }
} catch {
  // Graceful fallback for non-native environments or Jest
}

export class RestTimerService {
  private status: RestTimerStatus = 'idle';
  private totalDurationSeconds: number = 0;
  private endTimeMs: number | null = null;
  private pausedRemainingMs: number | null = null;
  private exerciseId: string | null = null;
  private exerciseGroupId: string | null = null;
  private listeners: Set<RestTimerListener> = new Set();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private scheduledNotificationId: string | null = null;

  constructor() {}

  /**
   * Returns a snapshot of the current timer state, re-evaluating remaining time
   * against the system wall clock.
   */
  public getState(): RestTimerState {
    this.evaluateStatus();

    let remainingSeconds = 0;
    if (this.status === 'running' && this.endTimeMs !== null) {
      const remainingMs = Math.max(0, this.endTimeMs - Date.now());
      remainingSeconds = Math.ceil(remainingMs / 1000);
    } else if (this.status === 'paused' && this.pausedRemainingMs !== null) {
      remainingSeconds = Math.ceil(Math.max(0, this.pausedRemainingMs) / 1000);
    } else if (this.status === 'completed' || this.status === 'idle') {
      remainingSeconds = 0;
    }

    return {
      status: this.status,
      totalDurationSeconds: this.totalDurationSeconds,
      remainingSeconds,
      endTimeMs: this.endTimeMs,
      pausedRemainingMs: this.pausedRemainingMs,
      exerciseId: this.exerciseId,
      exerciseGroupId: this.exerciseGroupId,
      lastUpdatedMs: Date.now(),
    };
  }

  /**
   * Starts or restarts the rest timer for the specified duration in seconds.
   *
   * @param durationSeconds Total timer duration in seconds.
   * @param context Optional metadata linking the timer to an exercise or superset group.
   */
  public start(
    durationSeconds: number,
    context?: { exerciseId?: string | null; exerciseGroupId?: string | null }
  ): RestTimerState {
    const clampedDuration = Math.max(0, Math.round(durationSeconds));
    const now = Date.now();

    this.totalDurationSeconds = clampedDuration;
    this.exerciseId = context?.exerciseId ?? null;
    this.exerciseGroupId = context?.exerciseGroupId ?? null;
    this.pausedRemainingMs = null;

    if (clampedDuration === 0) {
      this.status = 'completed';
      this.endTimeMs = now;
      this.cancelScheduledNotification();
      this.triggerCompletionHaptics();
      this.stopTicker();
    } else {
      this.status = 'running';
      this.endTimeMs = now + clampedDuration * 1000;
      this.scheduleLocalNotification(clampedDuration);
      this.startTicker();
    }

    const state = this.getState();
    this.notifyListeners(state);
    return state;
  }

  /**
   * Pauses an actively running timer.
   */
  public pause(): RestTimerState {
    this.evaluateStatus();

    if (this.status !== 'running' || this.endTimeMs === null) {
      return this.getState();
    }

    const now = Date.now();
    this.pausedRemainingMs = Math.max(0, this.endTimeMs - now);
    this.endTimeMs = null;
    this.status = 'paused';
    this.cancelScheduledNotification();
    this.stopTicker();

    const state = this.getState();
    this.notifyListeners(state);
    return state;
  }

  /**
   * Resumes a paused timer using wall-clock time from current instant.
   */
  public resume(): RestTimerState {
    if (this.status !== 'paused' || this.pausedRemainingMs === null) {
      return this.getState();
    }

    const now = Date.now();
    if (this.pausedRemainingMs <= 0) {
      this.status = 'completed';
      this.endTimeMs = now;
      this.pausedRemainingMs = null;
      this.cancelScheduledNotification();
      this.triggerCompletionHaptics();
      this.stopTicker();
    } else {
      this.status = 'running';
      this.endTimeMs = now + this.pausedRemainingMs;
      this.scheduleLocalNotification(this.pausedRemainingMs / 1000);
      this.pausedRemainingMs = null;
      this.startTicker();
    }

    const state = this.getState();
    this.notifyListeners(state);
    return state;
  }

  /**
   * Adjusts the timer duration by adding (or subtracting) seconds.
   * If running, extends/shortens `endTimeMs`. If paused, updates `pausedRemainingMs`.
   *
   * @param deltaSeconds Positive or negative seconds to add (e.g. +30, -30).
   */
  public adjustTime(deltaSeconds: number): RestTimerState {
    this.evaluateStatus();

    if (this.status !== 'running' && this.status !== 'paused') {
      return this.getState();
    }

    const deltaMs = deltaSeconds * 1000;
    const now = Date.now();

    if (this.status === 'running' && this.endTimeMs !== null) {
      const newEndTime = this.endTimeMs + deltaMs;
      if (newEndTime <= now) {
        this.status = 'completed';
        this.endTimeMs = now;
        this.cancelScheduledNotification();
        this.triggerCompletionHaptics();
        this.stopTicker();
      } else {
        this.endTimeMs = newEndTime;
        this.totalDurationSeconds = Math.max(
          1,
          Math.ceil((this.endTimeMs - (now - (this.totalDurationSeconds * 1000 - Math.max(0, this.endTimeMs - now)))) / 1000)
        );
        const remSec = Math.max(1, Math.ceil((newEndTime - now) / 1000));
        this.scheduleLocalNotification(remSec);
      }
    } else if (this.status === 'paused' && this.pausedRemainingMs !== null) {
      const newRemaining = this.pausedRemainingMs + deltaMs;
      if (newRemaining <= 0) {
        this.status = 'completed';
        this.pausedRemainingMs = 0;
        this.cancelScheduledNotification();
        this.triggerCompletionHaptics();
      } else {
        this.pausedRemainingMs = newRemaining;
      }
    }

    const state = this.getState();
    this.notifyListeners(state);
    return state;
  }

  /**
   * Convenience method to add 30 seconds to the timer.
   */
  public add30Seconds(): RestTimerState {
    return this.adjustTime(30);
  }

  /**
   * Convenience method to subtract 30 seconds from the timer.
   */
  public subtract30Seconds(): RestTimerState {
    return this.adjustTime(-30);
  }

  /**
   * Immediately skips and completes the rest timer.
   */
  public skip(): RestTimerState {
    this.status = 'completed';
    this.endTimeMs = Date.now();
    this.pausedRemainingMs = null;
    this.cancelScheduledNotification();
    this.triggerCompletionHaptics();
    this.stopTicker();

    const state = this.getState();
    this.notifyListeners(state);
    return state;
  }

  /**
   * Resets the timer back to idle state with zero duration.
   */
  public reset(): RestTimerState {
    this.status = 'idle';
    this.totalDurationSeconds = 0;
    this.endTimeMs = null;
    this.pausedRemainingMs = null;
    this.exerciseId = null;
    this.exerciseGroupId = null;
    this.cancelScheduledNotification();
    this.stopTicker();

    const state = this.getState();
    this.notifyListeners(state);
    return state;
  }

  /**
   * Determines whether the rest timer should trigger upon set completion (ADR-009).
   * In a superset/giant set group, rest is suppressed between exercises and triggers
   * only after the final exercise in the bracket finishes.
   *
   * @param exerciseGroupId Optional superset group identifier.
   * @param isLastInGroup True if the completed exercise is the last in its bracket.
   */
  public static shouldTriggerForSet(
    exerciseGroupId: string | null | undefined,
    isLastInGroup: boolean = true
  ): boolean {
    if (!exerciseGroupId) {
      return true; // Individual exercise: always trigger
    }
    return isLastInGroup; // Superset group: trigger only on the final exercise
  }

  /**
   * Evaluates whether a set completion should trigger the rest timer given the ordered
   * list of exercise IDs comprising the superset bracket (ADR-009).
   *
   * @param exerciseId The exercise whose set was just completed.
   * @param groupExerciseOrder Ordered list of exercise IDs in the superset bracket.
   */
  public static shouldTriggerForExerciseInGroup(
    exerciseId: string,
    groupExerciseOrder: string[]
  ): boolean {
    if (!groupExerciseOrder || groupExerciseOrder.length <= 1) {
      return true;
    }
    return exerciseId === groupExerciseOrder[groupExerciseOrder.length - 1];
  }

  /**
   * Returns the next exercise ID in the superset rotation, or null if the current
   * exercise is the final one in the bracket.
   */
  public static getNextExerciseInGroup(
    currentExerciseId: string,
    groupExerciseOrder: string[]
  ): string | null {
    if (!groupExerciseOrder || groupExerciseOrder.length <= 1) {
      return null;
    }
    const idx = groupExerciseOrder.indexOf(currentExerciseId);
    if (idx >= 0 && idx < groupExerciseOrder.length - 1) {
      return groupExerciseOrder[idx + 1];
    }
    return null;
  }

  /**
   * Subscribes a listener to receive state updates whenever timer status or remaining seconds change.
   * Returns an unsubscribe function.
   */
  public subscribe(listener: RestTimerListener): () => void {
    this.listeners.add(listener);
    // Emit current state immediately to the new subscriber
    listener(this.getState());

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Re-evaluates timer state against system wall clock and notifies listeners immediately.
   * Useful when resuming from background or re-focusing screens to eliminate lag.
   */
  public syncWithWallClock(): RestTimerState {
    this.evaluateStatus();
    const state = this.getState();
    this.notifyListeners(state);
    return state;
  }

  /**
   * Cleans up intervals and clears all listeners.
   */
  public destroy(): void {
    this.cancelScheduledNotification();
    this.stopTicker();
    this.listeners.clear();
  }

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  private evaluateStatus(): void {
    if (this.status === 'running' && this.endTimeMs !== null) {
      if (Date.now() >= this.endTimeMs) {
        this.status = 'completed';
        this.cancelScheduledNotification();
        this.triggerCompletionHaptics();
        this.stopTicker();
      }
    }
  }

  private scheduleLocalNotification(seconds: number): void {
    try {
      this.cancelScheduledNotification();
      if (seconds > 0 && Notifications?.scheduleNotificationAsync) {
        const triggerType =
          Notifications.SchedulableTriggerInputTypes?.TIME_INTERVAL ?? 'timeInterval';
        Notifications.scheduleNotificationAsync({
          content: {
            title: 'Rest Completed',
            body: 'Time for your next set!',
            sound: true,
          },
          trigger: {
            type: triggerType,
            seconds: Math.max(1, Math.round(seconds)),
          },
        })
          .then((id: string) => {
            this.scheduledNotificationId = id;
          })
          .catch(() => {});
      }
    } catch {
      // Safe fallback if notifications are unpermitted, running in background without permission, or test
    }
  }

  private cancelScheduledNotification(): void {
    if (this.scheduledNotificationId) {
      const id = this.scheduledNotificationId;
      this.scheduledNotificationId = null;
      try {
        if (Notifications?.cancelScheduledNotificationAsync) {
          Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
        }
      } catch {
        // Safe fallback
      }
    }
  }

  private triggerCompletionHaptics(): void {
    try {
      if (Haptics?.notificationAsync && Haptics?.NotificationFeedbackType) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      // Safe fallback
    }
  }

  private startTicker(): void {
    if (this.intervalId !== null) return;
    this.intervalId = setInterval(() => {
      const prevStatus = this.status;
      this.evaluateStatus();
      const state = this.getState();
      this.notifyListeners(state);

      if (prevStatus === 'running' && this.status === 'completed') {
        this.stopTicker();
      }
    }, 500);
  }

  private stopTicker(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private notifyListeners(state: RestTimerState): void {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('Error in RestTimerService listener:', err);
      }
    }
  }
}
