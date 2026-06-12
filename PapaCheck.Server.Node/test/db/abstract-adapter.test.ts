import { describe, it, expect } from 'vitest';
import { createDatabase } from '../../src/db/index.js';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { IDatabase } from '../../src/db/types.js';

describe('createDatabase factory', () => {
  it('should return a SqliteAdapter instance when no DATABASE_URL', async () => {
    const db = await createDatabase({ dbPath: ':memory:' });
    expect(db).toBeInstanceOf(SqliteAdapter);
    db.close();
  });

  it('should return an object implementing IDatabase', async () => {
    const db = (await createDatabase({ dbPath: ':memory:' })) as IDatabase;
    expect(typeof db.getFullData).toBe('function');
    expect(typeof db.getPointsBalance).toBe('function');
    expect(typeof db.getHomeworks).toBe('function');
    expect(typeof db.getShopItems).toBe('function');
    expect(typeof db.getSettings).toBe('function');
    expect(typeof db.getBountyTasks).toBe('function');
    expect(typeof db.pushMerge).toBe('function');
    expect(typeof db.close).toBe('function');
    db.close();
  });
});
