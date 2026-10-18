export const SchedulableTriggerInputTypes = {
  DATE: 'date',
  TIME_INTERVAL: 'timeInterval',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  CALENDAR: 'calendar',
};

export const scheduleNotificationAsync = jest.fn(async (request) => {
  return 'mock-notification-id-' + Math.random().toString(36).substring(7);
});

export const cancelScheduledNotificationAsync = jest.fn(async (id) => {});
export const cancelAllScheduledNotificationsAsync = jest.fn(async () => {});
export const setNotificationHandler = jest.fn((handler) => {});
export const requestPermissionsAsync = jest.fn(async () => ({ status: 'granted' }));
