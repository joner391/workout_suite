import { RestTimerService } from '../restTimerService';

describe('RestTimerService', () => {
  let timer: RestTimerService;

  beforeEach(() => {
    jest.useFakeTimers();
    timer = new RestTimerService();
  });

  afterEach(() => {
    timer.destroy();
    jest.useRealTimers();
  });

  describe('Basic Lifecycle & Initialization', () => {
    it('initializes in idle state with 0 remaining seconds', () => {
      const state = timer.getState();
      expect(state.status).toBe('idle');
      expect(state.totalDurationSeconds).toBe(0);
      expect(state.remainingSeconds).toBe(0);
      expect(state.endTimeMs).toBeNull();
      expect(state.pausedRemainingMs).toBeNull();
    });

    it('starts running with the specified duration', () => {
      const state = timer.start(90);
      expect(state.status).toBe('running');
      expect(state.totalDurationSeconds).toBe(90);
      expect(state.remainingSeconds).toBe(90);
      expect(state.endTimeMs).not.toBeNull();
    });

    it('immediately completes if started with 0 duration', () => {
      const state = timer.start(0);
      expect(state.status).toBe('completed');
      expect(state.remainingSeconds).toBe(0);
    });
  });

  describe('Wall-Clock Drift Immunity & Ticking', () => {
    it('accurately counts down as time advances', () => {
      timer.start(60);
      expect(timer.getState().remainingSeconds).toBe(60);

      // Advance by 15 seconds
      jest.advanceTimersByTime(15000);
      expect(timer.getState().remainingSeconds).toBe(45);
      expect(timer.getState().status).toBe('running');

      // Advance by another 45 seconds to finish
      jest.advanceTimersByTime(45000);
      expect(timer.getState().remainingSeconds).toBe(0);
      expect(timer.getState().status).toBe('completed');
    });

    it('handles phone backgrounding / sleep without drift', () => {
      timer.start(120);

      // Simulate phone being locked for 100 seconds
      jest.advanceTimersByTime(100000);

      const state = timer.getState();
      expect(state.remainingSeconds).toBe(20);
      expect(state.status).toBe('running');

      // Simulate unlocking long after timer expired (e.g. 300 seconds later)
      jest.advanceTimersByTime(300000);
      const expiredState = timer.getState();
      expect(expiredState.remainingSeconds).toBe(0);
      expect(expiredState.status).toBe('completed');
    });
  });

  describe('Pause & Resume', () => {
    it('pauses and freezes remaining time', () => {
      timer.start(90);
      jest.advanceTimersByTime(30000); // 60s remaining

      const paused = timer.pause();
      expect(paused.status).toBe('paused');
      expect(paused.remainingSeconds).toBe(60);
      expect(paused.endTimeMs).toBeNull();

      // Advancing time while paused should NOT decrease remaining seconds
      jest.advanceTimersByTime(50000);
      expect(timer.getState().remainingSeconds).toBe(60);
      expect(timer.getState().status).toBe('paused');
    });

    it('resumes running from paused remaining time', () => {
      timer.start(90);
      jest.advanceTimersByTime(30000); // 60s remaining
      timer.pause();

      jest.advanceTimersByTime(20000); // Wait 20s while paused

      const resumed = timer.resume();
      expect(resumed.status).toBe('running');
      expect(resumed.remainingSeconds).toBe(60);

      // Advance 20 seconds after resume -> 40s remaining
      jest.advanceTimersByTime(20000);
      expect(timer.getState().remainingSeconds).toBe(40);
    });

    it('ignores pause when not running', () => {
      expect(timer.pause().status).toBe('idle');
    });

    it('ignores resume when not paused', () => {
      timer.start(60);
      expect(timer.resume().status).toBe('running');
    });
  });

  describe('Time Adjustments (+30s / -30s)', () => {
    it('adds 30 seconds to an active timer', () => {
      timer.start(60);
      jest.advanceTimersByTime(20000); // 40s remaining

      const state = timer.add30Seconds();
      expect(state.remainingSeconds).toBe(70);
      expect(state.status).toBe('running');
    });

    it('subtracts 30 seconds from an active timer', () => {
      timer.start(60);
      jest.advanceTimersByTime(10000); // 50s remaining

      const state = timer.subtract30Seconds();
      expect(state.remainingSeconds).toBe(20);
      expect(state.status).toBe('running');
    });

    it('completes timer if subtracting more than remaining time', () => {
      timer.start(30);
      jest.advanceTimersByTime(10000); // 20s remaining

      const state = timer.subtract30Seconds(); // -30s -> <= 0
      expect(state.remainingSeconds).toBe(0);
      expect(state.status).toBe('completed');
    });

    it('adjusts time when paused', () => {
      timer.start(60);
      jest.advanceTimersByTime(20000); // 40s remaining
      timer.pause();

      timer.add30Seconds(); // 40 + 30 = 70s
      expect(timer.getState().remainingSeconds).toBe(70);
      expect(timer.getState().status).toBe('paused');

      timer.resume();
      expect(timer.getState().remainingSeconds).toBe(70);
      expect(timer.getState().status).toBe('running');
    });
  });

  describe('Skip & Reset', () => {
    it('skips immediately to completed status', () => {
      timer.start(120);
      const state = timer.skip();
      expect(state.status).toBe('completed');
      expect(state.remainingSeconds).toBe(0);
    });

    it('resets to idle state', () => {
      timer.start(120);
      const state = timer.reset();
      expect(state.status).toBe('idle');
      expect(state.totalDurationSeconds).toBe(0);
      expect(state.remainingSeconds).toBe(0);
    });
  });

  describe('Superset Rest Suppression (ADR-009)', () => {
    it('triggers timer for standalone exercises (no group id)', () => {
      expect(RestTimerService.shouldTriggerForSet(null, false)).toBe(true);
      expect(RestTimerService.shouldTriggerForSet(undefined, true)).toBe(true);
      expect(RestTimerService.shouldTriggerForExerciseInGroup('ex1', [])).toBe(true);
      expect(RestTimerService.shouldTriggerForExerciseInGroup('ex1', ['ex1'])).toBe(true);
    });

    it('suppresses timer between exercises inside a superset bracket', () => {
      const groupId = 'superset_123';
      // First exercise in superset -> suppressed
      expect(RestTimerService.shouldTriggerForSet(groupId, false)).toBe(false);
      // Final exercise in superset -> triggered
      expect(RestTimerService.shouldTriggerForSet(groupId, true)).toBe(true);
    });

    it('evaluates whether exercise is the final one in superset rotation via shouldTriggerForExerciseInGroup', () => {
      const pair = ['bench', 'row'];
      // First exercise in pair suppresses timer
      expect(RestTimerService.shouldTriggerForExerciseInGroup('bench', pair)).toBe(false);
      // Final exercise in pair triggers timer
      expect(RestTimerService.shouldTriggerForExerciseInGroup('row', pair)).toBe(true);

      const giantSet = ['squat', 'leg_curl', 'calf_raise'];
      expect(RestTimerService.shouldTriggerForExerciseInGroup('squat', giantSet)).toBe(false);
      expect(RestTimerService.shouldTriggerForExerciseInGroup('leg_curl', giantSet)).toBe(false);
      expect(RestTimerService.shouldTriggerForExerciseInGroup('calf_raise', giantSet)).toBe(true);
    });

    it('returns the next exercise in group rotation or null if last', () => {
      const rotation = ['exA', 'exB', 'exC'];
      expect(RestTimerService.getNextExerciseInGroup('exA', rotation)).toBe('exB');
      expect(RestTimerService.getNextExerciseInGroup('exB', rotation)).toBe('exC');
      expect(RestTimerService.getNextExerciseInGroup('exC', rotation)).toBeNull();
      expect(RestTimerService.getNextExerciseInGroup('unknown', rotation)).toBeNull();
      expect(RestTimerService.getNextExerciseInGroup('exA', ['exA'])).toBeNull();
    });
  });

  describe('Subscribers & Notifications', () => {
    it('notifies subscribers on state changes', () => {
      const listener = jest.fn();
      const unsubscribe = timer.subscribe(listener);

      // Immediately called on subscribe
      expect(listener).toHaveBeenCalledTimes(1);

      timer.start(45);
      expect(listener).toHaveBeenCalledTimes(2);

      timer.pause();
      expect(listener).toHaveBeenCalledTimes(3);

      unsubscribe();
      timer.resume();
      // Should not be called after unsubscribing
      expect(listener).toHaveBeenCalledTimes(3);
    });
  });

  describe('Local Push Notifications & Native Haptics', () => {
    it('schedules notification on start and cancels on skip', async () => {
      const Notifications = require('expo-notifications');
      const Haptics = require('expo-haptics');
      Notifications.scheduleNotificationAsync.mockClear();
      Notifications.cancelScheduledNotificationAsync.mockClear();
      Haptics.notificationAsync.mockClear();

      timer.start(90);
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            title: 'Rest Completed',
            sound: true,
          }),
        })
      );

      await Promise.resolve();
      timer.skip();
      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalled();
      expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    });

    it('triggers haptics when timer expires', () => {
      const Haptics = require('expo-haptics');
      Haptics.notificationAsync.mockClear();

      timer.start(10);
      jest.advanceTimersByTime(11000);
      expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    });
  });
});

