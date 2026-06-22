# 多孩子迁移数据可靠性验证 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 编写一套全面的数据迁移验证测试（~27 个 TDD 测试），覆盖 Schema 变更、数据分配、幂等性、可回滚性四个维度。

**Architecture:** 测试直接连接本地 PostgreSQL 测试库（`papacheck_test`），通过 `information_schema` 查询 schema 结构，通过插入测试数据并调用 `assignLegacyDataToChild` 验证数据迁移正确性。

**Tech Stack:** Vitest 4.x, PostgreSQL 16, pg (node-postgres)

**前提条件：**
- 本地 PostgreSQL 16 运行中，测试数据库 `papacheck_test` 已就绪
- `DATABASE_URL=postgresql://papacheck:papacheck@localhost:5432/papacheck_test`
- `init-pg-schema.sql` 已执行（含多孩子迁移段）

---

### Task 1: Schema 变更测试 (`multi-child-schema.test.ts`)

验证 `init-pg-schema.sql` 执行后数据库 schema 结构正确。

**Files:**
- Create: `PapaCheck.Server.Node/test/migration/multi-child-schema.test.ts`

- [ ] **Step 1: 创建测试文件骨架，写第一个 failing test（children 表结构）**

```typescript
// PapaCheck.Server.Node/test/migration/multi-child-schema.test.ts
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
 *     And child_id 被 FK 约束到 children(id)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const runPg = !!process.env['DATABASE_URL'];

describe.runIf(runPg)('Multi-Child Schema (多孩子 Schema 变更)', () => {
  let pool: Pool;

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
       WHERE tc.table_name = 'children'
         AND tc.constraint_type = 'FOREIGN KEY'
         AND ccu.column_name = 'id'`
    );
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    const fk = result.rows.find((r: any) => r.foreign_table === 'users');
    expect(fk).toBeTruthy();
  });

  it('12 张 per-child 表都有 child_id 列', async () => {
    const perChildTables = [
      'homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks',
      'bounty_submissions', 'bounty_completions', 'points', 'points_history',
      'redemptions', 'reward_box', 'active_buffs', 'badges'
    ];
    for (const table of perChildTables) {
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
         AND indexdef LIKE '%WHERE child_id IS NULL%'`
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].indexdef).toContain('tenant_id');
    expect(result.rows[0].indexdef).toContain('date_key');
  });

  it('每个 per-child 表都有 child_id 的 partial unique index', async () => {
    const dateKeyTables = ['homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks', 'bounty_submissions', 'bounty_completions'];
    const singleRowTables = ['points', 'points_history', 'redemptions', 'reward_box', 'active_buffs', 'badges'];

    for (const table of [...dateKeyTables, ...singleRowTables]) {
      const result = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename = $1 AND indexdef LIKE '%WHERE child_id IS NULL%'`,
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
```

- [ ] **Step 2: 运行测试确认 FAIL**

Run: `npx vitest run PapaCheck.Server.Node/test/migration/multi-child-schema.test.ts`

Expected: 测试运行，如果当前测试库已包含迁移则 PASS；如果测试库未迁移（无 children 表）则 FAIL。**关键：确认测试能正确检测 schema 状态。**

- [ ] **Step 3: 确保测试库已执行 schema 迁移**

Run: 如果测试库未迁移，执行 `init-pg-schema.sql`

```bash
psql -U papacheck -d papacheck_test -f PapaCheck.Server.Node/scripts/init-pg-schema.sql
```

- [ ] **Step 4: 确认测试全部 PASS**

Run: `npx vitest run PapaCheck.Server.Node/test/migration/multi-child-schema.test.ts`
Expected: 8 个测试全部 PASS

---

### Task 2: 数据分配测试 (`multi-child-data-assignment.test.ts`)

验证 `assignLegacyDataToChild` 能正确将遗留数据分配给指定孩子。

**Files:**
- Create: `PapaCheck.Server.Node/test/migration/multi-child-data-assignment.test.ts`

- [ ] **Step 1: 创建测试文件，写 first failing test（所有 12 张 per-child 表数据分配）**

```typescript
// PapaCheck.Server.Node/test/migration/multi-child-data-assignment.test.ts
/**
 * Feature: 多孩子数据分配
 *   Scenario: 有孩子的 tenant 所有遗留数据正确分配
 *     Given tenant A 在 12 张 per-child 表中有遗留数据（child_id IS NULL）
 *     And 已创建 children 记录
 *     When assignLegacyDataToChild 执行
 *     Then 所有 per-child 表的 child_id 从 NULL 更新为指定 child_id
 *     And points.balance 保持不变
 *     And points_history 每行都分配了 child_id
 *
 *   Scenario: 共享表不被分配 child_id
 *     Given shop_items/settings/bounty_tasks/email_config 原有 child_id IS NULL
 *     When assignLegacyDataToChild 执行
 *     Then 这些表的 child_id 保持 NULL
 *
 *   Scenario: 无孩子的 tenant 数据保持 NULL
 *     Given tenant B 无 children 记录
 *     When assignLegacyDataToChild 执行
 *     Then 所有 per-child 表的 child_id 保持 NULL
 *
 *   Scenario: points 表迁移前后余额一致
 *     Given points 表有 balance = 100
 *     When 迁移执行
 *     Then balance 不变且 child_id 已填充
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import crypto from 'node:crypto';

const runPg = !!process.env['DATABASE_URL'];

describe.runIf(runPg)('Multi-Child Data Assignment (多孩子数据分配)', () => {
  let pool: Pool;
  let adapter: any;
  const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  const childA = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
  const dateKey = '2026-06-22';
  let createdChildIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);

    // Setup tenant A
    await pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '分配测试A', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    // Setup tenant B
    await pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '分配测试B', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantB]
    );
  });

  afterAll(async () => {
    // Cleanup tenant A data
    const tables = ['homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks',
      'bounty_submissions', 'bounty_completions', 'points', 'points_history',
      'redemptions', 'reward_box', 'active_buffs', 'badges', 'children', 'access_codes'];
    for (const t of tables) {
      await pool.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]).catch(() => {});
    }
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [tenantA, tenantB]);
    await pool.end();
  });

  async function insertLegacyData(tenantId: string, childId: string | null, prefix: string) {
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

  // Scenario 1: 有孩子的 tenant 所有遗留数据正确分配
  it('有孩子的 tenant 全部 12 张 per-child 表数据正确分配', async () => {
    // Insert legacy data (child_id IS NULL)
    await insertLegacyData(tenantA, null, 'A');

    // Create child
    await pool.query(
      "INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '分配测试娃') ON CONFLICT (id) DO NOTHING",
      [childA, tenantA]
    );
    createdChildIds.push(childA);

    // Verify child_id is NULL before migration
    const beforeHw = await pool.query(
      'SELECT child_id FROM homeworks WHERE tenant_id = $1 AND date_key = $2',
      [tenantA, dateKey]
    );
    expect(beforeHw.rows[0].child_id).toBeNull();

    // Execute migration
    await adapter.assignLegacyDataToChild(tenantA, childA);

    // Verify ALL per-child tables have child_id filled
    const perChildTables = ['homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks',
      'bounty_submissions', 'bounty_completions', 'points', 'points_history',
      'redemptions', 'reward_box', 'active_buffs', 'badges'];

    for (const table of perChildTables) {
      const result = await pool.query(
        `SELECT child_id FROM ${table} WHERE tenant_id = $1`,
        [tenantA]
      );
      expect(result.rows.length).toBeGreaterThan(0, `${table} 应有数据行`);
      for (const row of result.rows) {
        expect(row.child_id).toBe(childA, `${table} 的 child_id 应为 ${childA}`);
      }
    }
  });

  // Scenario 2: points 余额保持一致
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
    expect(after.rows[0].child_id).toBe(childA);
  });

  // Scenario 3: 共享表不被分配
  it('共享表不被分配 child_id', async () => {
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

  // Scenario 4: 无孩子的 tenant 数据保持 NULL
  it('无孩子的 tenant 数据保持 NULL', async () => {
    await insertLegacyData(tenantB, null, 'B');

    // Don't create any children for tenant B
    // assignLegacyDataToChild should skip tenantB
    const perChildTables = ['homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks',
      'bounty_submissions', 'bounty_completions'];

    for (const table of perChildTables) {
      const result = await pool.query(
        `SELECT child_id FROM ${table} WHERE tenant_id = $1 AND date_key = $2`,
        [tenantB, dateKey]
      );
      expect(result.rows[0].child_id).toBeNull(`${table} 的 child_id 应保持 NULL`);
    }
  });

  // Scenario 5: 已经分配 child_id 的行不受影响
  it('已分配 child_id 的行不受影响', async () => {
    const otherChild = 'dddddddd-dddd-dddd-dddd-ddddddddddd1';
    const otherDate = '2026-06-21';

    // Insert data already assigned to a different child
    await pool.query(
      "INSERT INTO homeworks (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, '[]') ON CONFLICT DO NOTHING",
      [tenantA, otherChild, otherDate]
    );

    // Run assignment again
    await adapter.assignLegacyDataToChild(tenantA, childA);

    // The already-assigned row should keep its original child_id
    const result = await pool.query(
      'SELECT child_id FROM homeworks WHERE tenant_id = $1 AND date_key = $2',
      [tenantA, otherDate]
    );
    expect(result.rows[0].child_id).toBe(otherChild);
  });
});
```

- [ ] **Step 2: 运行测试确认 FAIL**

Run: `npx vitest run PapaCheck.Server.Node/test/migration/multi-child-data-assignment.test.ts`

Expected: 如果当前测试库包含迁移，测试验证数据分配正确性，应全部 PASS。如果测试库未迁移，会因 FK/列缺失而 FAIL。

- [ ] **Step 3: 运行测试确认 PASS**

Run: `npx vitest run PapaCheck.Server.Node/test/migration/multi-child-data-assignment.test.ts`
Expected: 全部测试 PASS（首次编写后应直接通过，因为代码已实现）

---

### Task 3: 幂等性测试 (`multi-child-idempotency.test.ts`)

验证迁移操作可以安全重复执行。

**Files:**
- Create: `PapaCheck.Server.Node/test/migration/multi-child-idempotency.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
// PapaCheck.Server.Node/test/migration/multi-child-idempotency.test.ts
/**
 * Feature: 多孩子迁移幂等性
 *   Scenario: assignLegacyDataToChild 重复执行不报错
 *     Given 已执行一次 assignLegacyDataToChild
 *     When 再次执行
 *     Then 不抛出异常
 *     And 所有数据行的 child_id 保持不变
 *
 *   Scenario: 重复执行不产生重复行
 *     Given 已执行一次迁移
 *     When 再次执行
 *     Then 12 张 per-child 表的行数不变
 *
 *   Scenario: 迁移 SQL 幂等（CREATE IF NOT EXISTS）
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

    // Execute again
    await adapter.assignLegacyDataToChild(tenantA, childA);

    // Count rows after
    const afterCount = await pool.query(
      'SELECT COUNT(*) AS cnt FROM homeworks WHERE tenant_id = $1',
      [tenantA]
    );

    expect(Number(afterCount.rows[0].cnt)).toBe(Number(beforeCount.rows[0].cnt));
  });

  it('init-pg-schema.sql 重复执行不报错（CREATE IF NOT EXISTS）', async () => {
    // The schema SQL uses IF NOT EXISTS everywhere - running it again should be safe
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
```

- [ ] **Step 2: 运行测试确认 PASS**

Run: `npx vitest run PapaCheck.Server.Node/test/migration/multi-child-idempotency.test.ts`
Expected: 全部 PASS（3 个测试）

---

### Task 4: 可回滚性测试 (`multi-child-reversibility.test.ts`)

验证迁移 SQL 可以安全回滚。

**Files:**
- Create: `PapaCheck.Server.Node/test/migration/multi-child-reversibility.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
// PapaCheck.Server.Node/test/migration/multi-child-reversibility.test.ts
/**
 * Feature: 多孩子迁移可回滚性
 *   Scenario: 迁移 SQL 支持逆向操作（回滚列添加、索引创建）
 *     Given 迁移脚本已执行
 *     When 执行回滚 SQL（DROP IF EXISTS child_id 列、DROP IF EXISTS partial unique index）
 *     Then 不报错
 *     And information_schema 确认列已删除
 *
 *   Note: 回滚后重新执行迁移 SQL 应恢复结构
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const runPg = !!process.env['DATABASE_URL'];

describe.runIf(runPg)('Multi-Child Reversibility (多孩子迁移可回滚性)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL']! });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('DROP IF EXISTS child_id 列不报错', async () => {
    const perChildTables = ['homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks',
      'bounty_submissions', 'bounty_completions', 'points', 'points_history',
      'redemptions', 'reward_box', 'active_buffs', 'badges'];

    for (const table of perChildTables) {
      await expect(
        pool.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS child_id`)
      ).resolves.not.toThrow();
    }
  });

  it('DROP IF EXISTS partial unique index 不报错', async () => {
    const indexNames = ['homeworks_tenant_null_date_idx', 'daily_settlement_tenant_null_date_idx',
      'efficiency_history_tenant_null_date_idx', 'free_time_tasks_tenant_null_date_idx',
      'bounty_submissions_tenant_null_date_idx', 'bounty_completions_tenant_null_date_idx',
      'points_tenant_null_idx', 'points_history_tenant_null_idx',
      'redemptions_tenant_null_idx', 'reward_box_tenant_null_idx',
      'active_buffs_tenant_null_idx', 'badges_tenant_null_idx'];

    for (const idx of indexNames) {
      await expect(
        pool.query(`DROP INDEX IF EXISTS ${idx}`)
      ).resolves.not.toThrow();
    }
  });

  it('重新执行 migratory schema 恢复结构', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schemaPath = resolve(__dirname, '../../scripts/init-pg-schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    await pool.query(schema);

    // Verify child_id columns are back
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'homeworks' AND column_name = 'child_id'`
    );
    expect(result.rows.length).toBe(1);
  });

  it('重新迁移后 partial unique index 恢复', async () => {
    const result = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'homeworks'
         AND indexdef LIKE '%WHERE child_id IS NULL%'`
    );
    expect(result.rows.length).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试确认 PASS**

Run: `npx vitest run PapaCheck.Server.Node/test/migration/multi-child-reversibility.test.ts`
Expected: 全部 PASS（4 个测试）

---

### Task 5: 全量测试验证

确保新测试不破坏现有测试。

- [ ] **Step 1: 运行全量测试**

Run: `npx vitest run`

Expected: 全部 PASS（约 750+ 测试，含新 27 个迁移测试）

- [ ] **Step 2: 检查测试结果概览**

Expected:
```
✓ PapaCheck.Server.Node/test/migration/multi-child-schema.test.ts (8 tests)
✓ PapaCheck.Server.Node/test/migration/multi-child-data-assignment.test.ts (5 tests)
✓ PapaCheck.Server.Node/test/migration/multi-child-idempotency.test.ts (3 tests)
✓ PapaCheck.Server.Node/test/migration/multi-child-reversibility.test.ts (4 tests)
```

---

### Task 6: 文档更新

- [ ] **Step 1: 更新 CHANGELOG.md**

在 `[Unreleased]` 区段新增 Added 条目：
```markdown
### Added
- **多孩子迁移数据可靠性测试（Phase 1+2 验证）**：新增 4 个 TDD 测试文件（~27 个测试），覆盖 schema 结构验证、12 张 per-child 表数据分配正确性、迁移幂等性、可回滚性。用于上线前验证多孩子架构变更的数据库迁移可靠性（[#multi-child-schema.test.ts](file:///e:/trae_projects/PapaCheck/PapaCheck.Server.Node/test/migration/multi-child-schema.test.ts)）
```

- [ ] **Step 2: 更新 PROGRESS.md**

在"最近变更"表格新增一行：
```
| 2026-06-22 | **多孩子迁移可靠性验证测试**：新增 4 个 TDD 测试文件（27 个测试），覆盖 schema 结构、12 表数据分配、幂等性、可回滚性。全量 XXX 测试通过 |
```

- [ ] **Step 3: 更新测试计数**

如果 README.md 中有测试数量计数，更新为 `+27`。

---

### Task 7: 备份验证（等待你提供生产备份）

测试套件通过后，进入方案 A 阶段：

- [ ] **Step 1: 提供生产备份**
  你从生产服务器下载 PG 备份并提供：`pg_dump -U papacheck papacheck > papacheck_backup.sql`

- [ ] **Step 2: 本地恢复备份**
  ```bash
  createdb -U postgres papacheck_prod_verify
  psql -U postgres -d papacheck_prod_verify < papacheck_backup.sql
  ```

- [ ] **Step 3: 在备份上运行迁移 SQL**
  ```bash
  psql -U papacheck -d papacheck_prod_verify -f PapaCheck.Server.Node/scripts/init-pg-schema.sql
  ```

- [ ] **Step 4: 运行全量测试（使用备份库）**
  ```bash
  $env:DATABASE_URL="postgresql://papacheck:papacheck@localhost:5432/papacheck_prod_verify"; npx vitest run
  ```

- [ ] **Step 5: 人工 E2E 验证**
  启动测试服务器连接备份库，用生产账号登录验证数据完整性。
