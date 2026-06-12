import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Migration Script', () => {
  it('should have schema SQL file', () => {
    const schemaPath = resolve(__dirname, '../../scripts/init-pg-schema.sql');
    expect(existsSync(schemaPath)).toBe(true);
  });

  it('should contain all 17+ tables in schema', () => {
    const schemaPath = resolve(__dirname, '../../scripts/init-pg-schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    const tableNames = [
      'points', 'points_history', 'homeworks', 'daily_settlement',
      'shop_items', 'redemptions', 'efficiency_history', 'free_time_tasks',
      'meta', 'badges', 'reward_box', 'settings', 'active_buffs',
      'bounty_tasks', 'email_config', 'bounty_submissions',
      'bounty_completions', 'notifications', 'last_modified', 'crdt_operations',
    ];
    for (const name of tableNames) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${name}`);
    }
  });

  it('should have default data inserts with ON CONFLICT DO NOTHING', () => {
    const schemaPath = resolve(__dirname, '../../scripts/init-pg-schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    expect(schema).toContain('ON CONFLICT DO NOTHING');
  });

  it('should have migration script', () => {
    const scriptPath = resolve(__dirname, '../../scripts/migrate-to-pg.ts');
    expect(existsSync(scriptPath)).toBe(true);
  });
});
