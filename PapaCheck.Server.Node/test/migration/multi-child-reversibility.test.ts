// PapaCheck.Server.Node/test/migration/multi-child-reversibility.test.ts
/**
 * Feature: 多孩子迁移可回滚性
 *   Scenario: DROP IF EXISTS child_id 列不报错
 *     Given 迁移脚本已执行
 *     When 执行 DROP COLUMN IF EXISTS child_id
 *     Then 12 张 per-child 表全部不报错
 *
 *   Scenario: DROP IF EXISTS partial unique index 不报错
 *     Given 迁移脚本已执行
 *     When 执行 DROP INDEX IF EXISTS
 *     Then 12 个 partial unique index 全部不报错
 *
 *   Scenario: 重新执行 migratory schema 恢复结构
 *     Given child_id 列和索引已被删除
 *     When 重新执行 init-pg-schema.sql
 *     Then child_id 列重新存在
 *
 *   Scenario: 重新迁移后 partial unique index 恢复
 *     Given schema 已重新执行
 *     When 查询 pg_indexes
 *     Then partial unique index 恢复
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const runPg = !!process.env['DATABASE_URL'];

const PER_CHILD_TABLES = [
  'homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks',
  'bounty_submissions', 'bounty_completions', 'points', 'points_history',
  'redemptions', 'reward_box', 'active_buffs', 'badges'
];

const NULL_IDX_NAMES = [
  'homeworks_tenant_null_date_idx', 'daily_settlement_tenant_null_date_idx',
  'efficiency_history_tenant_null_date_idx', 'free_time_tasks_tenant_null_date_idx',
  'bounty_submissions_tenant_null_date_idx', 'bounty_completions_tenant_null_date_idx',
  'points_tenant_null_idx', 'points_history_tenant_null_idx',
  'redemptions_tenant_null_idx', 'reward_box_tenant_null_idx',
  'active_buffs_tenant_null_idx', 'badges_tenant_null_idx'
];

describe.runIf(runPg)('Multi-Child Reversibility (多孩子迁移可回滚性)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL']! });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('DROP IF EXISTS child_id 列不报错', async () => {
    for (const table of PER_CHILD_TABLES) {
      await expect(
        pool.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS child_id`)
      ).resolves.not.toThrow();
    }

    // Verify columns are gone
    for (const table of PER_CHILD_TABLES) {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'child_id'`,
        [table]
      );
      expect(result.rows.length).toBe(0, `${table} 的 child_id 列应已被删除`);
    }
  });

  it('DROP IF EXISTS partial unique index 不报错', async () => {
    for (const idx of NULL_IDX_NAMES) {
      await expect(
        pool.query(`DROP INDEX IF EXISTS ${idx}`)
      ).resolves.not.toThrow();
    }
  });

  it('重新执行 init-pg-schema.sql 恢复 child_id 列', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schemaPath = resolve(__dirname, '../../scripts/init-pg-schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    await pool.query(schema);

    // Verify child_id columns are back
    for (const table of PER_CHILD_TABLES) {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'child_id'`,
        [table]
      );
      expect(result.rows.length).toBe(1, `${table} 的 child_id 列恢复`);
    }
  });

  it('重新迁移后 partial unique index 恢复', async () => {
    for (const table of PER_CHILD_TABLES) {
      const result = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename = $1 AND indexdef LIKE '%child_id IS NULL%'`,
        [table]
      );
      expect(result.rows.length).toBe(1, `${table} 的 partial unique index 应已恢复`);
      expect(result.rows[0].indexdef).toContain('UNIQUE');
    }
  });
});
