// PapaCheck.Server/test/migration/multi-child-idempotency.test.ts
/**
 * Feature: 多孩子迁移幂等性
 *   Scenario: assignLegacyDataToChild 重复执行不报错
 *     Given 已执行一次 assignLegacyDataToChild
 *     When 再次执行
 *     Then 不抛出异常
 *     And child_id 保持不变
 *
 *   Scenario: 重复执行不产生重复行
 *     Given 已执行一次迁移
 *     When 再次执行
 *     Then 行数不变
 *
 *   Scenario: 迁移 SQL 幂等（CREATE/ALTER IF NOT EXISTS）
 *     Given 迁移 SQL 已执行一次
 *     When 再次执行完整 init-pg-schema.sql
 *     Then 不报错
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const runPg = !!process.env['DATABASE_URL'];

describe.runIf(runPg)('Multi-Child Idempotency (多孩子迁移幂等性)', () => {
  let pool: Pool;
  let adapter: any;
  const tenantA = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';
  const childA = 'ffffffff-ffff-ffff-ffff-fffffffffff1';
  const dateKey = '2026-06-22';

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);

    await pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '幂等测试', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    await pool.query(
      "INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '幂等娃') ON CONFLICT (id) DO NOTHING",
      [childA, tenantA]
    );
  });

  afterAll(async () => {
    const tables = ['homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks',
      'bounty_submissions', 'bounty_completions', 'points', 'points_history',
      'redemptions', 'reward_box', 'active_buffs', 'badges', 'children'];
    for (const t of tables) {
      await pool.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantA]).catch(() => {});
    }
    await pool.query('DELETE FROM users WHERE id = $1', [tenantA]);
    await pool.end();
  });

  it('assignLegacyDataToChild 重复执行不报错', async () => {
    // Insert legacy data
    await pool.query(
      "INSERT INTO homeworks (tenant_id, child_id, date_key, data) VALUES ($1, NULL, $2, '[]') ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = '[]'",
      [tenantA, dateKey]
    );

    // First execution
    await adapter.assignLegacyDataToChild(tenantA, childA);
    const first = await pool.query(
      'SELECT child_id FROM homeworks WHERE tenant_id = $1 AND date_key = $2',
      [tenantA, dateKey]
    );
    expect(first.rows[0].child_id).toBe(childA);

    // Second execution - should not throw
    await expect(
      adapter.assignLegacyDataToChild(tenantA, childA)
    ).resolves.not.toThrow();

    const second = await pool.query(
      'SELECT child_id FROM homeworks WHERE tenant_id = $1 AND date_key = $2',
      [tenantA, dateKey]
    );
    expect(second.rows[0].child_id).toBe(childA);
  });

  it('重复执行行数不变', async () => {
    // Count rows before
    const beforeCount = await pool.query(
      'SELECT COUNT(*) AS cnt FROM homeworks WHERE tenant_id = $1',
      [tenantA]
    );
    const beforeNum = Number(beforeCount.rows[0].cnt);

    // Execute again
    await adapter.assignLegacyDataToChild(tenantA, childA);

    // Count rows after
    const afterCount = await pool.query(
      'SELECT COUNT(*) AS cnt FROM homeworks WHERE tenant_id = $1',
      [tenantA]
    );
    const afterNum = Number(afterCount.rows[0].cnt);

    expect(afterNum).toBe(beforeNum);
  });

  it('init-pg-schema.sql 重复执行不报错（IF NOT EXISTS）', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schemaPath = resolve(__dirname, '../../scripts/init-pg-schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    await expect(
      pool.query(schema)
    ).resolves.not.toThrow();
  });
});
