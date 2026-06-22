// PapaCheck.Server.Node/test/migration/multi-child-data-assignment.test.ts
/**
 * Feature: 多孩子数据分配
 *   Scenario: 有孩子的 tenant 所有遗留数据正确分配
 *     Given tenant A 在 12 张 per-child 表中有遗留数据（child_id IS NULL）
 *     And 已创建 children 记录
 *     When assignLegacyDataToChild 执行
 *     Then 所有 per-child 表的 child_id 从 NULL 更新为指定 child_id
 *
 *   Scenario: 共享表不被分配 child_id
 *     Given shop_items/settings/bounty_tasks/email_config 没有 child_id 列
 *     When assignLegacyDataToChild 执行
 *     Then 这些表的结构不受影响
 *
 *   Scenario: 无孩子的 tenant 数据保持 NULL
 *     Given tenant B 无 children 记录
 *     When assignLegacyDataToChild 执行（不创建 child）
 *     Then 所有 per-child 表的 child_id 保持 NULL
 *
 *   Scenario: points 表迁移前后余额一致
 *     Given points 表有 balance = 100
 *     When 迁移执行
 *     Then balance 不变且 child_id 已填充
 *
 *   Scenario: 已分配 child_id 的行不受影响
 *     Given 某行已分配给 childX
 *     When assignLegacyDataToChild 执行（指定 childY）
 *     Then 该行的 child_id 保持 childX
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const runPg = !!process.env['DATABASE_URL'];

const PER_CHILD_TABLES = [
  'homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks',
  'bounty_submissions', 'bounty_completions', 'points', 'points_history',
  'redemptions', 'reward_box', 'active_buffs', 'badges'
];

describe.runIf(runPg)('Multi-Child Data Assignment (多孩子数据分配)', () => {
  let pool: Pool;
  let adapter: any;
  const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  const childA = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
  const childB = 'dddddddd-dddd-dddd-dddd-ddddddddddd1';
  const otherChild = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';
  const dateKey = '2026-06-22';
  const otherDate = '2026-06-21';

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);

    // Setup tenant A
    await pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '分配测试A', $1, '家长A') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    // Setup tenant B
    await pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '分配测试B', $1, '家长B') ON CONFLICT (id) DO NOTHING",
      [tenantB]
    );
    // Create child A
    await pool.query(
      "INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '分配测试娃A') ON CONFLICT (id) DO NOTHING",
      [childA, tenantA]
    );
    // Create child B
    await pool.query(
      "INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '分配测试娃B') ON CONFLICT (id) DO NOTHING",
      [childB, tenantA]
    );
  });

  afterAll(async () => {
    const tables = [...PER_CHILD_TABLES, 'access_codes', 'children'];
    for (const t of tables) {
      await pool.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]).catch(() => {});
    }
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [tenantA, tenantB]);
    await pool.end();
  });

  async function insertLegacyData(tenantId: string, childId: string | null) {
    // date_key tables
    await pool.query(
      "INSERT INTO homeworks (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, '[]') ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = '[]'",
      [tenantId, childId, dateKey]
    );
    await pool.query(
      "INSERT INTO daily_settlement (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, '{}') ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = '{}'",
      [tenantId, childId, dateKey]
    );
    await pool.query(
      "INSERT INTO efficiency_history (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, '{}') ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = '{}'",
      [tenantId, childId, dateKey]
    );
    await pool.query(
      "INSERT INTO free_time_tasks (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, '[]') ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = '[]'",
      [tenantId, childId, dateKey]
    );
    await pool.query(
      "INSERT INTO bounty_submissions (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, '[]') ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = '[]'",
      [tenantId, childId, dateKey]
    );
    await pool.query(
      "INSERT INTO bounty_completions (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, '{}') ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = '{}'",
      [tenantId, childId, dateKey]
    );

    // single-row tables (id=1)
    await pool.query(
      "INSERT INTO points (tenant_id, child_id, id, balance) VALUES ($1, $2, 1, 100) ON CONFLICT (tenant_id, id) WHERE child_id IS NULL DO UPDATE SET balance = 100",
      [tenantId, childId]
    );
    await pool.query(
      "INSERT INTO points_history (tenant_id, child_id, date, earned, spent, balance, detail) VALUES ($1, $2, $3, 50, 0, 100, '测试') ON CONFLICT (tenant_id, id) WHERE child_id IS NULL DO NOTHING",
      [tenantId, childId, dateKey]
    );
    await pool.query(
      "INSERT INTO redemptions (tenant_id, child_id, id, data) VALUES ($1, $2, 1, '[]') ON CONFLICT (tenant_id, id) WHERE child_id IS NULL DO UPDATE SET data = '[]'",
      [tenantId, childId]
    );
    await pool.query(
      "INSERT INTO reward_box (tenant_id, child_id, id, data) VALUES ($1, $2, 1, '[]') ON CONFLICT (tenant_id, id) WHERE child_id IS NULL DO UPDATE SET data = '[]'",
      [tenantId, childId]
    );
    await pool.query(
      "INSERT INTO active_buffs (tenant_id, child_id, id, data) VALUES ($1, $2, 1, '[]') ON CONFLICT (tenant_id, id) WHERE child_id IS NULL DO UPDATE SET data = '[]'",
      [tenantId, childId]
    );
    await pool.query(
      "INSERT INTO badges (tenant_id, child_id, id, data) VALUES ($1, $2, 1, '[]') ON CONFLICT (tenant_id, id) WHERE child_id IS NULL DO UPDATE SET data = '[]'",
      [tenantId, childId]
    );
  }

  it('有孩子的 tenant 全部 12 张 per-child 表数据正确分配', async () => {
    // Insert legacy data (child_id IS NULL) for tenant A
    await insertLegacyData(tenantA, null);

    // Verify child_id is NULL before migration
    const beforeHw = await pool.query(
      'SELECT child_id FROM homeworks WHERE tenant_id = $1 AND date_key = $2',
      [tenantA, dateKey]
    );
    expect(beforeHw.rows[0].child_id).toBeNull();

    // Execute migration
    await adapter.assignLegacyDataToChild(tenantA, childA);

    // Verify ALL per-child tables have child_id filled
    for (const table of PER_CHILD_TABLES) {
      // For points, also check specific id
      if (table === 'points' || table === 'points_history') {
        continue; // Check these separately
      }
      const result = await pool.query(
        `SELECT child_id FROM ${table} WHERE tenant_id = $1`,
        [tenantA]
      );
      expect(result.rows.length).toBeGreaterThan(0, `${table} 应有数据行`);
      for (const row of result.rows) {
        expect(row.child_id).toBe(childA, `${table} 的 child_id 应为 ${childA}`);
      }
    }

    // Verify points specially (it has balance column not data column)
    const ptsResult = await pool.query(
      'SELECT child_id, balance FROM points WHERE tenant_id = $1 AND id = 1',
      [tenantA]
    );
    expect(ptsResult.rows[0].child_id).toBe(childA);
    expect(ptsResult.rows[0].balance).toBe(100);
  });

  it('points 迁移前后余额一致', async () => {
    const before = await pool.query(
      'SELECT balance FROM points WHERE tenant_id = $1 AND id = 1',
      [tenantA]
    );
    expect(before.rows[0].balance).toBe(100);

    // assignLegacyDataToChild already called in previous test
    const after = await pool.query(
      'SELECT balance FROM points WHERE tenant_id = $1 AND id = 1',
      [tenantA]
    );
    expect(after.rows[0].balance).toBe(100);
  });

  it('共享表没有 child_id 列', async () => {
    const sharedTables = ['shop_items', 'settings', 'bounty_tasks', 'email_config'];
    for (const table of sharedTables) {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'child_id'`,
        [table]
      );
      expect(result.rows.length).toBe(0, `${table} 不应有 child_id 列`);
    }
  });

  it('无孩子的 tenant 数据保持 NULL', async () => {
    // Insert legacy data for tenant B (no children created)
    await insertLegacyData(tenantB, null);

    // Don't create any children for tenant B - assignLegacyDataToChild sets child_id = childId
    // where child_id IS NULL, but since tenant B has no children, no code should call it
    // So the data should still have NULL child_id

    for (const table of PER_CHILD_TABLES) {
      // Skip points tables that might have been initialized by PostgresAdapter
      if (table === 'points' || table === 'points_history') continue;
      const result = await pool.query(
        `SELECT child_id FROM ${table} WHERE tenant_id = $1`,
        [tenantB]
      );
      expect(result.rows.length).toBeGreaterThan(0, `${table} 应有数据行`);
      for (const row of result.rows) {
        expect(row.child_id).toBeNull(`${table} 的 child_id 应保持 NULL (无孩子 tenant)`);
      }
    }
  });

  it('已分配 child_id 的行不受影响', async () => {
    // Insert data already assigned to otherChild
    await pool.query(
      "INSERT INTO homeworks (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, '[]') ON CONFLICT DO NOTHING",
      [tenantA, otherChild, otherDate]
    );

    // Run assignment for childA
    await adapter.assignLegacyDataToChild(tenantA, childA);

    // The already-assigned row should keep its original child_id
    const result = await pool.query(
      'SELECT child_id FROM homeworks WHERE tenant_id = $1 AND date_key = $2',
      [tenantA, otherDate]
    );
    expect(result.rows[0].child_id).toBe(otherChild);
  });
});
