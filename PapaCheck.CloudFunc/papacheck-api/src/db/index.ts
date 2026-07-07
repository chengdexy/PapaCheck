import type { IDatabase } from './types.js';

export type { IDatabase } from './types.js';

export type DatabaseType = IDatabase;

export async function createDatabase(options: {
  databaseUrl?: string;
  max?: number;
  idleTimeoutMillis?: number;
}): Promise<IDatabase> {
  const url = options.databaseUrl ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL environment variable or databaseUrl option is required');
  }
  const { PostgresAdapter } = await import('./postgres-adapter.js');
  return await PostgresAdapter.create(url, {
    max: options.max,
    idleTimeoutMillis: options.idleTimeoutMillis,
  });
}
