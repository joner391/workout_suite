import { ISQLiteDatabase } from '../schema';

export interface ExecutedQuery {
  sql: string;
  params: any[];
}

/**
 * Headless test harness simulating an expo-sqlite SQLiteDatabase driver in Jest.
 */
export class MockSQLiteDatabase implements ISQLiteDatabase {
  public executedQueries: ExecutedQuery[] = [];
  public execQueries: string[] = [];
  public mockData: Map<string, any[]> = new Map();
  public defaultChanges: number = 1;

  public clear(): void {
    this.executedQueries = [];
    this.execQueries = [];
    this.mockData.clear();
    this.defaultChanges = 1;
  }

  async execAsync(source: string): Promise<void> {
    this.execQueries.push(source);
  }

  async runAsync(
    source: string,
    ...params: any[]
  ): Promise<{ lastInsertRowId: number; changes: number }> {
    this.executedQueries.push({ sql: source, params });
    return { lastInsertRowId: 1, changes: this.defaultChanges };
  }

  async getAllAsync<T>(source: string, ...params: any[]): Promise<T[]> {
    this.executedQueries.push({ sql: source, params });
    for (const [pattern, data] of this.mockData.entries()) {
      if (source.includes(pattern)) {
        return (data as T[]) || [];
      }
    }
    return [];
  }

  async getFirstAsync<T>(source: string, ...params: any[]): Promise<T | null> {
    this.executedQueries.push({ sql: source, params });
    for (const [pattern, data] of this.mockData.entries()) {
      if (source.includes(pattern)) {
        return (data[0] as T) ?? null;
      }
    }
    return null;
  }
}
