/**
 * Feature: 多孩子 Schema 变更
 *   Scenario: children 表存在且结构正确
 *     Given 迁移脚本已执行
 *     When 查询 information_schema.columns
 *     Then children 表含 id, tenant_id, name, avatar, access_code_id, is_active, created_at 列
 *     And tenant_id 被 FK 约束到 users(id)
 *
 *   Scenario: 12 张 per-child 表含 child_id 列
 *     Given 迁移脚本已执行
 *     When 查询每张 per-child 表的列信息
 *     Then 每张表都有 child_id 列（UUID 类型，可空）
 *
 *   Scenario: partial unique index 存在
 *     Given 迁移脚本已执行
 *     When 查询 pg_indexes
 *     Then homeworks 表有 (tenant_id, date_key) 的唯一索引 WHERE child_id IS NULL
 *
 *   Scenario: access_codes 表结构正确
 *     Given 迁移脚本已执行
 *     When 查询 access_codes 表
 *     Then 含 tenant_id, code_hash, access_code, child_id, token_version, last_login, created_at
 *     And 不含 type, nickname 列
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const runPg = !!process.env['DATABASE_URL'];

describe.runIf(runPg)('Multi-Child Schema (多孩子 Schema 变更)', () => {
  let pool: Pool;
  const PER_CHILD_TABLES = [
    'homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks',
    'bounty_submissions', 'bounty_completions', 'points', 'points_history',
    'redemptions', 'reward_box', 'active_buffs', 'badges'
  ];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('children 表包含完整的列集合', async () => {
    const result = await pool.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'children'
       ORDER BY ordinal_position`
    );
    const columns = result.rows.map(r => r.column_name);
    expect(columns).toContain('id');
    expect(columns).toContain('tenant_id');
    expect(columns).toContain('name');
    expect(columns).toContain('avatar');
    expect(columns).toContain('access_code_id');
    expect(columns).toContain('is_active');
    expect(columns).toContain('created_at');
  });

  it('children.tenant_id 有 FK 约束到 users(id)', async () => {
    const result = await pool.query(
      `SELECT tc.constraint_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'children'
         AND tc.constraint_type = 'FOREIGN KEY'
         AND ccu.column_name = 'id'
         AND ccu.table_name = 'users'
         AND kcu.table_name = 'children'
         AND kcu.column_name = 'tenant_id'`
    );
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('12 张 per-child 表都有 child_id 列', async () => {
    for (const table of PER_CHILD_TABLES) {
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'child_id'`,
        [table]
      );
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].data_type).toMatch(/uuid|character/);
      expect(result.rows[0].is_nullable).toBe('YES');
    }
  });

  it('共享表没有 child_id 列', async () => {
    const sharedTables = ['shop_items', 'settings', 'bounty_tasks', 'email_config'];
    for (const table of sharedTables) {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'child_id'`,
        [table]
      );
      expect(result.rows.length).toBe(0);
    }
  });

  it('homeworks 表有 partial unique index (WHERE child_id IS NULL)', async () => {
    const result = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename = 'homeworks'
         AND indexdef LIKE '%child_id IS NULL%'`
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].indexdef).toContain('UNIQUE');
    expect(result.rows[0].indexdef).toContain('tenant_id');
    expect(result.rows[0].indexdef).toContain('date_key');
  });

  it('每个 per-child 表都有 child_id 的 partial unique index', async () => {
    for (const table of PER_CHILD_TABLES) {
      const result = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename = $1 AND indexdef LIKE '%child_id IS NULL%'`,
        [table]
      );
      expect(result.rows.length).toBe(1, `${table} 缺少 WHERE child_id IS NULL 索引`);
    }
  });

  it('access_codes 表结构正确（含必要列，不含已删除列）', async () => {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'access_codes'`
    );
    const columns = result.rows.map(r => r.column_name);
    // 应有的列
    expect(columns).toContain('id');
    expect(columns).toContain('tenant_id');
    expect(columns).toContain('code_hash');
    expect(columns).toContain('access_code');
    expect(columns).toContain('child_id');
    expect(columns).toContain('token_version');
    expect(columns).toContain('last_login');
    expect(columns).toContain('created_at');
    // 已删除的列不应存在
    expect(columns).not.toContain('type');
    expect(columns).not.toContain('nickname');
    expect(columns).not.toContain('user_id');
  });
});
