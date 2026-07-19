import { createDatabase } from './src/db/index.js';
import type { IDatabase } from './src/db/index.js';

let dbInstance: IDatabase | null = null;

export async function getDb(): Promise<IDatabase> {
  if (!dbInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL 环境变量未设置');
    }
    dbInstance = await createDatabase({
      databaseUrl: connectionString,
      max: 2,
      idleTimeoutMillis: 30000,
    });
  }
  return dbInstance;
}

/** 测试用：重置 db 实例 */
export function resetDbForTest(): void {
  dbInstance = null;
}
