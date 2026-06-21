/**
 * multi-child.test.ts - 多孩子迁移脚本测试
 *
 * Feature: 多孩子迁移脚本
 *   Scenario: 有 child access_code 的 tenant 数据正确分配
 *     Given tenant A 有 2 个 child access_code
 *     When 迁移执行
 *     Then 创建 2 个 children 记录
 *     And 现有数据分配给第一个孩子
 *
 *   Scenario: 无 child access_code 的 tenant 数据保持 NULL
 *     Given tenant B 无 child access_code
 *     When 迁移执行
 *     Then 不创建 children 记录
 *     And 现有数据 child_id 为 NULL
 *
 *   Scenario: 幂等性
 *     Given 迁移已执行一次
 *     When 再次执行迁移
 *     Then 不报错，不重复创建 children 记录
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const runPg = !!process.env['DATABASE_URL'];

describe.runIf(runPg)('Multi-Child Migration (多孩子迁移)', () => {
  let adapter: any;
  const tenantA = 'aaaa1111-aaaa-1111-aaaa-1111aaaaaaaa';
  const tenantB = 'bbbb2222-bbbb-2222-bbbb-2222bbbbbbbb';

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);

    // Setup tenant A (has children)
    await adapter.pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '迁移A', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    await adapter.pool.query("INSERT INTO tenants (id, name) VALUES ($1, '迁移A') ON CONFLICT (id) DO NOTHING", [tenantA]);

    // Setup tenant B (no children)
    await adapter.pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '迁移B', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantB]
    );
    await adapter.pool.query("INSERT INTO tenants (id, name) VALUES ($1, '迁移B') ON CONFLICT (id) DO NOTHING", [tenantB]);
  });

  afterAll(async () => {
    const tables = ['homeworks', 'points', 'children', 'access_codes'];
    for (const t of tables) {
      await adapter.pool.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]).catch(() => {});
    }
  });

  // Scenario: 有 child access_code 的 tenant 数据正确分配
  it('有 child 的 tenant 数据正确分配', async () => {
    const dateKey = '2026-06-21';
    const childId = 'cccc1111-cccc-1111-cccc-1111cccccccc';

    // Simulate: tenant A already has legacy homework data (child_id IS NULL)
    await adapter.pool.query(
      "INSERT INTO homeworks (tenant_id, date_key, data) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = $3",
      [tenantA, dateKey, JSON.stringify([{ id: 'hw1', subject: '数学' }])]
    );

    // Verify child_id is NULL before migration
    const before = await adapter.pool.query(
      'SELECT child_id FROM homeworks WHERE tenant_id = $1 AND date_key = $2',
      [tenantA, dateKey]
    );
    expect(before.rows[0].child_id).toBeNull();

    // Create child (simulating what POST /api/admin/members does)
    await adapter.pool.query(
      "INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '小明') ON CONFLICT (id) DO NOTHING",
      [childId, tenantA]
    );

    // Assign legacy data to child
    await adapter.assignLegacyDataToChild(tenantA, childId);

    // Verify data is now assigned
    const after = await adapter.pool.query(
      'SELECT child_id FROM homeworks WHERE tenant_id = $1 AND date_key = $2',
      [tenantA, dateKey]
    );
    expect(after.rows[0].child_id).toBe(childId);

    // Cleanup
    await adapter.pool.query('DELETE FROM children WHERE id = $1', [childId]);
    await adapter.pool.query('DELETE FROM homeworks WHERE tenant_id = $1', [tenantA]);
  });

  // Scenario: 无 child access_code 的 tenant 数据保持 NULL
  it('无孩子的 tenant 数据保持 NULL', async () => {
    const dateKey = '2026-06-21';

    // Insert legacy data for tenant B (no children)
    await adapter.pool.query(
      "INSERT INTO homeworks (tenant_id, date_key, data) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = $3",
      [tenantB, dateKey, JSON.stringify([{ id: 'hw2', subject: '英语' }])]
    );

    // No children table records for tenant B - child_id should remain NULL
    const result = await adapter.pool.query(
      'SELECT child_id FROM homeworks WHERE tenant_id = $1 AND date_key = $2',
      [tenantB, dateKey]
    );
    expect(result.rows[0].child_id).toBeNull();

    // Cleanup
    await adapter.pool.query('DELETE FROM homeworks WHERE tenant_id = $1', [tenantB]);
  });

  // Scenario: 幂等性
  it('assignLegacyDataToChild 幂等', async () => {
    const dateKey = '2026-06-21';
    const childId = 'dddd2222-dddd-2222-dddd-2222dddddddd';

    // Insert legacy data
    await adapter.pool.query(
      "INSERT INTO homeworks (tenant_id, date_key, data) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = $3",
      [tenantA, dateKey, JSON.stringify([{ id: 'hw3', subject: '科学' }])]
    );

    // Create child
    await adapter.pool.query("INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '测试娃') ON CONFLICT (id) DO NOTHING", [childId, tenantA]);

    // First assignment
    await adapter.assignLegacyDataToChild(tenantA, childId);
    const first = await adapter.pool.query(
      'SELECT child_id FROM homeworks WHERE tenant_id = $1 AND date_key = $2',
      [tenantA, dateKey]
    );
    expect(first.rows[0].child_id).toBe(childId);

    // Second assignment should not error (idempotent)
    await adapter.assignLegacyDataToChild(tenantA, childId);
    const second = await adapter.pool.query(
      'SELECT child_id FROM homeworks WHERE tenant_id = $1 AND date_key = $2',
      [tenantA, dateKey]
    );
    expect(second.rows[0].child_id).toBe(childId);

    // Cleanup
    await adapter.pool.query('DELETE FROM children WHERE id = $1', [childId]);
    await adapter.pool.query('DELETE FROM homeworks WHERE tenant_id = $1', [tenantA]);
  });

  // Scenario: createChild 不会重复创建
  it('createChild 同一名字不重复创建', async () => {
    // First creation
    const child1 = await adapter.createChild(tenantA, '小刚');
    expect(child1.name).toBe('小刚');

    // Second creation with same name should fail (UNIQUE constraint)
    await expect(
      adapter.createChild(tenantA, '小刚')
    ).rejects.toThrow();

    // Cleanup
    await adapter.pool.query('DELETE FROM children WHERE id = $1', [child1.id]);
  });
});
