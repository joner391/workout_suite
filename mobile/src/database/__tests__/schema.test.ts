import { MockSQLiteDatabase } from './MockSQLiteDatabase';
import {
  migrateDatabase,
  resetDatabase,
  CURRENT_SCHEMA_VERSION,
} from '../schema';
import { DEFAULT_EXERCISES, DEFAULT_GEAR } from '../seeds/defaultExercises';

describe('Database Schema & Migrations', () => {
  let mockDb: MockSQLiteDatabase;

  beforeEach(() => {
    mockDb = new MockSQLiteDatabase();
  });

  it('runs initial migration when user_version is 0', async () => {
    // Simulate user_version = 0
    mockDb.mockData.set('PRAGMA user_version;', [{ user_version: 0 }]);

    await migrateDatabase(mockDb);

    // Verify WAL mode and foreign keys were enabled
    expect(mockDb.execQueries).toContain('PRAGMA journal_mode = WAL;');
    expect(mockDb.execQueries).toContain('PRAGMA foreign_keys = ON;');

    // Verify tables DDL executed
    const tableDdlQuery = mockDb.execQueries.find((q) =>
      q.includes('CREATE TABLE IF NOT EXISTS exercises')
    );
    expect(tableDdlQuery).toBeDefined();

    // Verify schema version update to CURRENT_SCHEMA_VERSION
    expect(mockDb.execQueries).toContain(
      `PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`
    );

    // Verify seeds were inserted (exercises, gear, settings)
    const exerciseInserts = mockDb.executedQueries.filter((q) =>
      q.sql.includes('INSERT OR IGNORE INTO exercises')
    );
    expect(exerciseInserts).toHaveLength(DEFAULT_EXERCISES.length);
    expect(exerciseInserts.length).toBeGreaterThanOrEqual(40);

    const gearInserts = mockDb.executedQueries.filter((q) =>
      q.sql.includes('INSERT OR IGNORE INTO gear_inventory')
    );
    expect(gearInserts).toHaveLength(DEFAULT_GEAR.length);
    expect(gearInserts.length).toBeGreaterThanOrEqual(6);

    const settingInserts = mockDb.executedQueries.filter((q) =>
      q.sql.includes('INSERT OR IGNORE INTO user_settings')
    );
    expect(settingInserts).toHaveLength(3);
  });

  it('bypasses migrations and seeding when user_version is already current', async () => {
    mockDb.mockData.set('PRAGMA user_version;', [
      { user_version: CURRENT_SCHEMA_VERSION },
    ]);

    await migrateDatabase(mockDb);

    // Pragmas still set
    expect(mockDb.execQueries).toContain('PRAGMA journal_mode = WAL;');
    expect(mockDb.execQueries).toContain('PRAGMA foreign_keys = ON;');

    // No DDL or seed queries run
    const tableDdlQuery = mockDb.execQueries.find((q) =>
      q.includes('CREATE TABLE IF NOT EXISTS exercises')
    );
    expect(tableDdlQuery).toBeUndefined();

    const inserts = mockDb.executedQueries.filter((q) =>
      q.sql.includes('INSERT OR IGNORE')
    );
    expect(inserts).toHaveLength(0);
  });

  it('chains migrations from version 1 through version 3 cleanly without restart', async () => {
    mockDb.mockData.set('PRAGMA user_version;', [{ user_version: 1 }]);

    await migrateDatabase(mockDb);

    // Should execute v1 -> v2 column addition
    expect(
      mockDb.execQueries.some((q) => q.includes('ALTER TABLE user_profiles ADD COLUMN training_mentality'))
    ).toBe(true);

    // Should immediately chain and execute v2 -> v3 migrations
    expect(
      mockDb.execQueries.some((q) => q.includes('ALTER TABLE calibrated_params ADD COLUMN cov_p00'))
    ).toBe(true);
    expect(
      mockDb.execQueries.some((q) => q.includes('ALTER TABLE body_metrics ADD COLUMN imported_from'))
    ).toBe(true);
    expect(
      mockDb.execQueries.some((q) => q.includes('CREATE INDEX IF NOT EXISTS idx_workout_sets_ex_created'))
    ).toBe(true);

    // Final version should be CURRENT_SCHEMA_VERSION (3)
    expect(mockDb.execQueries).toContain(
      `PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`
    );
  });

  it('runs v2 -> v3 migration when user_version is 2', async () => {
    mockDb.mockData.set('PRAGMA user_version;', [{ user_version: 2 }]);

    await migrateDatabase(mockDb);

    // Should NOT re-run v1 -> v2
    expect(
      mockDb.execQueries.some((q) => q.includes('ALTER TABLE user_profiles ADD COLUMN training_mentality'))
    ).toBe(false);

    // Should run v2 -> v3
    expect(
      mockDb.execQueries.some((q) => q.includes('ALTER TABLE calibrated_params ADD COLUMN cov_p00'))
    ).toBe(true);
    expect(
      mockDb.execQueries.some((q) => q.includes('ALTER TABLE body_metrics ADD COLUMN imported_from'))
    ).toBe(true);
    expect(
      mockDb.execQueries.some((q) => q.includes('CREATE INDEX IF NOT EXISTS idx_workout_sets_ex_created'))
    ).toBe(true);

    expect(mockDb.execQueries).toContain(
      `PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`
    );
  });

  it('resets the database by dropping tables and re-migrating', async () => {
    // Simulate current version = 1 initially, but resetDatabase will drop and re-seed
    mockDb.mockData.set('PRAGMA user_version;', [{ user_version: 0 }]);

    await resetDatabase(mockDb);

    expect(mockDb.execQueries).toContain('PRAGMA foreign_keys = OFF;');
    const dropQueries = mockDb.execQueries.filter((q) =>
      q.startsWith('DROP TABLE IF EXISTS')
    );
    expect(dropQueries.length).toBeGreaterThanOrEqual(10);
    expect(mockDb.execQueries).toContain('PRAGMA user_version = 0;');
  });
});
