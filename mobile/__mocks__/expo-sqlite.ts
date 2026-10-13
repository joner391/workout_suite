/**
 * Jest mock for expo-sqlite native module during headless Node unit testing.
 */
export const openDatabaseAsync = jest.fn(async (_dbName: string) => ({
  execAsync: jest.fn(async () => {}),
  runAsync: jest.fn(async () => ({ lastInsertRowId: 1, changes: 1 })),
  getAllAsync: jest.fn(async () => []),
  getFirstAsync: jest.fn(async () => null),
  closeAsync: jest.fn(async () => {}),
}));

export class SQLiteDatabase {}
