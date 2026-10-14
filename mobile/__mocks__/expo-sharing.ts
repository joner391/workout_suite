/**
 * Jest mock for expo-sharing
 */

export const isAvailableAsync = jest.fn(async () => Promise.resolve(true));
export const shareAsync = jest.fn(async () => Promise.resolve());
