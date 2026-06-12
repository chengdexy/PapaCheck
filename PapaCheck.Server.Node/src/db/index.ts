import { SqliteAdapter } from './sqlite-adapter.js';
import type { IDatabase } from './types.js';

export type { IDatabase } from './types.js';
export * from './types.js';

export type DatabaseType = IDatabase;

export function createDatabase(options: { dbPath?: string; databaseUrl?: string }): IDatabase {
  const url = options.databaseUrl ?? process.env['DATABASE_URL'];
  if (url) {
    const { PostgresAdapter } = require('./postgres-adapter.js') as { PostgresAdapter: new (url: string) => IDatabase };
    return new PostgresAdapter(url);
  }
  return new SqliteAdapter(options.dbPath ?? 'data.db');
}

// 向后兼容 — 已有测试 import { Database } from '../src/db/index.js'
export { SqliteAdapter as PapaCheckDB, SqliteAdapter as Database, SqliteAdapter };
