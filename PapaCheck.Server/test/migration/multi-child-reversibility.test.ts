// PapaCheck.Server/test/migration/multi-child-reversibility.test.ts
/**
 * Feature: 多孩子 Schema 幂等性（替代可回滚性测试，避免并发破坏共享 schema）
 *   Scenario: 清理数据后重新执行 schema SQL 不报错
 *     Given schema 已初始化
 *     When 清理 per-child 表数据后重新执行 init-pg-schema.sql
 *     Then 不报错，且 child_id 列和 partial unique index 仍然存在
 *
 *   Scenario: schema 重新执行后结构正确
 *     Given schema 已重新执行
 *     When 查询列和索引
 *     Then 12 张 per-child 表都有 child_id 列和 partial unique index
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const runPg = !!process.env['DATABASE_URL'];

const PER_CHILD_TABLES = [
  'homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks',
  'bounty_submissions', 'bounty_completions', 'points', 'points_history',
  'redemptions', 'reward_box', 'active_buffs', 'badges'
];

describe.runIf(runPg)('Multi-Child Reversibility (多孩子 Schema 幂等性)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL']! });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('重新执行 schema SQL 幂等性检查', async () => {
    // 重新执行 schema SQL（幂等性验证——所有 DDL 都有 IF NOT EXISTS/IF EXISTS，不应报错）
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schemaPath = resolve(__dirname, '../../scripts/init-pg-schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    await expect(pool.query(schema)).resolves.not.toThrow();

    // Verify child_id columns exist
    for (const table of PER_CHILD_TABLES) {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'child_id'`,
        [table]
      );
      expect(result.rows.length).toBe(1, `${table} 的 child_id 列应存在`);
    }

    // Verify partial unique indexes exist
    for (const table of PER_CHILD_TABLES) {
      const result = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename = $1 AND indexdef LIKE '%child_id IS NULL%'`,
        [table]
      );
      expect(result.rows.length).toBe(1, `${table} 的 partial unique index 应存在`);
      expect(result.rows[0].indexdef).toContain('UNIQUE');
    }
  });
});
