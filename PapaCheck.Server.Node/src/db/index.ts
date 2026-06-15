import { SqliteAdapter } from './sqlite-adapter.js';
import type { IDatabase } from './types.js';

export type { IDatabase } from './types.js';
export * from './types.js';

export type DatabaseType = IDatabase;

export async function createDatabase(options: { dbPath?: string; databaseUrl?: string }): Promise<IDatabase> {
  const url = options.databaseUrl ?? process.env['DATABASE_URL'];
  if (url) {
    const { PostgresAdapter } = await import('./postgres-adapter.js');
    return await PostgresAdapter.create(url);
  }
  return new SqliteAdapter(options.dbPath ?? 'data.db');
}

// 向后兼容 — 已有测试 import { Database } from '../src/db/index.js'
export { SqliteAdapter as PapaCheckDB, SqliteAdapter as Database, SqliteAdapter };
