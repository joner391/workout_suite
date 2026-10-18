export const NotificationFeedbackType = {
  Success: 'success',
  Warning: 'warning',
  Error: 'error',
};

export const ImpactFeedbackStyle = {
  Light: 'light',
  Medium: 'medium',
  Heavy: 'heavy',
};

export const notificationAsync = jest.fn(async (type) => {});
export const impactAsync = jest.fn(async (style) => {});
export const selectionAsync = jest.fn(async () => {});
