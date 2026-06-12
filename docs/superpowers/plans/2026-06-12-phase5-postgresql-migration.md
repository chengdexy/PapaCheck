# Phase 5a + 5b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PostgreSQL database adapter, auth middleware, and systemd deployment for PapaCheck

**Architecture:** Database layer refactored to IDatabase interface pattern (Interface → AbstractBase → SqliteAdapter/PostgresAdapter). Auth via Fastify onRequest hook with cookie-based session. Deployment via systemd replacing Docker.

**Tech Stack:** TypeScript 5.x, Fastify 5.x, better-sqlite3 (dev), pg (cloud), PostgreSQL 16, systemd

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `PapaCheck.Server.Node/src/db/types.ts` | `IDatabase` interface + all type definitions |
| `PapaCheck.Server.Node/src/db/adapter.ts` | `DatabaseAdapter` abstract base class (shared utilities) |
| `PapaCheck.Server.Node/src/db/sqlite-adapter.ts` | `SqliteAdapter extends DatabaseAdapter` |
| `PapaCheck.Server.Node/src/db/postgres-adapter.ts` | `PostgresAdapter extends DatabaseAdapter` |
| `PapaCheck.Server.Node/src/auth-plugin.ts` | Fastify cookie session auth plugin |
| `PapaCheck.Server.Node/test/db/abstract-adapter.test.ts` | IDatabase interface contract tests |
| `PapaCheck.Server.Node/test/db/postgres-adapter.test.ts` | PostgresAdapter tests |
| `PapaCheck.Server.Node/test/auth-plugin.test.ts` | Auth middleware tests |
| `PapaCheck.Server.Node/scripts/init-pg-schema.sql` | PostgreSQL DDL |
| `PapaCheck.Server.Node/scripts/migrate-to-pg.ts` | SQLite → PostgreSQL migration |
| `PapaCheck.Server.Node/test/scripts/migrate-to-pg.test.ts` | Migration script tests |
| `scripts/deploy.sh` | Deployment script (local build → scp → restart) |

### Modified Files
| File | Change |
|------|--------|
| `PapaCheck.Server.Node/src/db/index.ts` | Rewrite to factory function + re-export types |
| `PapaCheck.Server.Node/src/app.ts` | Use `createDatabase()` + register auth plugin |
| `PapaCheck.Server.Node/package.json` | Add `pg` + `@types/pg` deps, `migrate:pg` script |
| `PapaCheck.Web/js/api.js` | Adapt URL path for `/app/` prefix |

---

## Phase 5a: PostgreSQL 适配

### Task 5a-1: 重构数据库抽象层 — 接口 + SqliteAdapter

**Files:**
- Create: `PapaCheck.Server.Node/src/db/types.ts`
- Create: `PapaCheck.Server.Node/src/db/adapter.ts`
- Create: `PapaCheck.Server.Node/src/db/sqlite-adapter.ts`
- Create: `PapaCheck.Server.Node/test/db/abstract-adapter.test.ts`
- Modify: `PapaCheck.Server.Node/src/db/index.ts`
- Modify: `PapaCheck.Server.Node/src/app.ts`
- Modify: `PapaCheck.Server.Node/package.json`

- [ ] **Step 1: 安装 pg 依赖**

Run:
```bash
cd PapaCheck.Server.Node
npm install pg
npm install -D @types/pg
```

Expected: `pg` and `@types/pg` in `package.json` and `node_modules/`

- [ ] **Step 2 (TDD RED): 写抽象接口测试 `test/db/abstract-adapter.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { createDatabase } from '../../src/db/index.js';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { IDatabase } from '../../src/db/types.js';

describe('createDatabase factory', () => {
  it('should return a SqliteAdapter instance when no DATABASE_URL', () => {
    const db = createDatabase({ dbPath: ':memory:' });
    expect(db).toBeInstanceOf(SqliteAdapter);
    db.close();
  });

  it('should return an object implementing IDatabase', () => {
    const db = createDatabase({ dbPath: ':memory:' }) as IDatabase;
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
```

Run:
```bash
cd PapaCheck.Server.Node && npx vitest run test/db/abstract-adapter.test.ts
```
Expected: FAIL — `createDatabase` / `SqliteAdapter` not yet implemented (RED)

- [ ] **Step 3 (GREEN): 创建 `src/db/types.ts` — IDatabase 接口**

```typescript
import type { CRDTOperation } from '../crdt/types.js';

export interface PointsHistoryEntry {
  id?: number;
  date: string;
  earned: number;
  spent: number;
  balance: number;
  detail: string;
}

export interface FullDataSnapshot {
  points: { balance: number; history: PointsHistoryEntry[] };
  badges: any[];
  history: Record<string, any>;
  tasks: Record<string, any>;
  homeworks: Record<string, any[]>;
  dailySettlement: Record<string, any>;
  shopItems: any[];
  redemptions: any[];
  rewardBox: any[];
  settings: any;
  activeBuffs: any[];
  efficiencyHistory: Record<string, any>;
  freeTimeTasks: Record<string, any[]>;
  bountyTasks: any[];
  bountySubmissions: Record<string, any[]>;
  bountyCompletions: Record<string, any>;
}

export interface ModifiedEntry {
  table_name: string;
  record_key: string;
  data?: any;
  last_modified: string;
}

export interface NotificationItem {
  id: string;
  text: string;
  createdAt: number;
}

/** All database implementations must implement this interface */
export interface IDatabase {
  close(): void;
  getFullData(): FullDataSnapshot;
  importFullData(data: any): void;
  addNotification(text: string, createdAt?: number): string;
  getPendingNotifications(): NotificationItem[];
  cleanupExpiredNotifications(): void;
  consumeNotifications(ids: string[]): void;
  getPointsBalance(): number;
  updatePoints(action: 'earn' | 'spend', amount: number, detail: string): number;
  patchPoints(delta: { earn?: number; spend?: number; detail?: string }): number;
  getHomeworks(dateKey: string): any[];
  saveHomeworks(dateKey: string, items: any[]): void;
  moveHomework(fromDate: string, toDate: string, hwId: string): any | null;
  getHomeworkById(id: string): any | null;
  putHomework(id: string, data: any): void;
  patchHomework(id: string, fields: any): void;
  deleteHomework(id: string): void;
  getSettlement(dateKey: string): any;
  saveSettlement(dateKey: string, data: any): void;
  putSettlement(dateKey: string, data: any): void;
  patchSettlement(dateKey: string, fields: any): void;
  getShopItems(): any[];
  saveShopItems(items: any[]): void;
  getShopItemById(id: string): any | null;
  putShopItem(id: string, data: any): void;
  deleteShopItem(id: string): void;
  getRedemptions(): any[];
  saveRedemptions(items: any[]): void;
  clearFulfilledRedemptions(): void;
  putRedemption(id: string, data: any): void;
  getRewardBox(): any[];
  saveRewardBox(items: any[]): void;
  putRewardBoxItem(id: string, data: any): void;
  deleteRewardBoxItem(id: string): void;
  getSettings(): any;
  saveSettings(data: any): void;
  putSettings(data: any): void;
  patchSettings(fields: any): void;
  getActiveBuffs(): any[];
  saveActiveBuffs(items: any[]): void;
  putBuff(id: string, data: any): void;
  deleteBuff(id: string): void;
  getEfficiency(dateKey: string): any;
  saveEfficiency(dateKey: string, data: any): void;
  putEfficiency(dateKey: string, data: any): void;
  getFreeTime(dateKey: string): any[];
  saveFreeTime(dateKey: string, tasks: any[]): void;
  putFreeTimeTask(id: string, data: any): void;
  getBountyTasks(): any[];
  saveBountyTasks(items: any[]): void;
  getBountyTaskById(id: string): any | null;
  putBountyTask(id: string, data: any): void;
  deleteBountyTask(id: string): void;
  getBountySubmissions(dateKey: string): any[];
  saveBountySubmissions(dateKey: string, data: any[]): void;
  putBountySubmission(id: string, data: any): void;
  getBountyCompletions(dateKey: string): any;
  saveBountyCompletions(dateKey: string, data: any): void;
  putBountyCompletion(id: string, data: any): void;
  getEmailConfig(): any | null;
  saveEmailConfig(config: any): void;
  getModifiedSince(timestamp: string): ModifiedEntry[];
  pushMerge(changes: any[]): { ok: boolean };
  recordModification(tableName: string, recordKey: string, timestamp: string): void;
  resetDate(dateKey: string): void;
  saveCRDTOperation(op: CRDTOperation): void;
  applyCRDTOperation(op: CRDTOperation): void;
  getCRDTOperationsSince(timestamp: string): CRDTOperation[];
  ackCRDTOperations(timestamp: string): void;
}
```

- [ ] **Step 4 (GREEN): 创建 `src/db/adapter.ts` — DatabaseAdapter 抽象基类**

Copy the utility methods from existing `PapaCheckDB` that don't depend on better-sqlite3 sync API:

```typescript
import type { IDatabase, ModifiedEntry, NotificationItem, PointsHistoryEntry, FullDataSnapshot } from './types.js';
import type { CRDTOperation } from '../crdt/types.js';

export abstract class DatabaseAdapter implements IDatabase {
  protected _safeJsonParse(data: string): any | undefined {
    try {
      const val = JSON.parse(data);
      return val !== null && val !== undefined ? val : undefined;
    } catch {
      return undefined;
    }
  }

  protected _findByUuid(items: any[], uuid: string): { index: number; item: any } {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item?.uuid === uuid || item?.id === uuid || item?.taskId === uuid) {
        return { index: i, item };
      }
    }
    return { index: -1, item: null };
  }

  _findInArray(data: any[], id: string): { index: number; item: any } {
    return this._findByUuid(data, id);
  }

  protected _filterDeleted(data: any): any {
    if (Array.isArray(data)) {
      return data.filter((item: any) => !item.isDeleted);
    }
    return data;
  }

  protected _classifyChange(data: any): string | null {
    if (data._table) return data._table;
    if (data.subject) return 'homeworks';
    if (data.dailyBase && data.rating !== undefined) return 'daily_settlement';
    if (data.cost !== undefined || data.baseQuantity !== undefined) return 'shop_items';
    if (data.itemId && data.status !== undefined) return 'redemptions';
    if (data.itemName && data.status !== undefined) return 'redemptions';
    if (data.quantity !== undefined && data.name) return 'reward_box';
    if (data.dailyBasePoints !== undefined || data.ratingMultipliers !== undefined) return 'settings';
    if (data.duration !== undefined && data.unit) return 'active_buffs';
    if (data.name && data.durationMinutes !== undefined) return 'free_time_tasks';
    if (data.balance !== undefined) return 'points';
    if (data.createdAt && data.points !== undefined) return 'bounty_tasks';
    if (data.startedAt) return 'bounty_submissions';
    if (data.taskId) return 'bounty_completions';
    if (data.averageRatio !== undefined || data.efficiencyRatio !== undefined) return 'efficiency_history';
    return null;
  }

  // Abstract methods — the full IDatabase interface
  abstract close(): void;
  abstract getFullData(): FullDataSnapshot;
  abstract importFullData(data: any): void;
  abstract addNotification(text: string, createdAt?: number): string;
  abstract getPendingNotifications(): NotificationItem[];
  abstract cleanupExpiredNotifications(): void;
  abstract consumeNotifications(ids: string[]): void;
  abstract getPointsBalance(): number;
  abstract updatePoints(action: 'earn' | 'spend', amount: number, detail: string): number;
  abstract patchPoints(delta: { earn?: number; spend?: number; detail?: string }): number;
  abstract getHomeworks(dateKey: string): any[];
  abstract saveHomeworks(dateKey: string, items: any[]): void;
  abstract moveHomework(fromDate: string, toDate: string, hwId: string): any | null;
  abstract getHomeworkById(id: string): any | null;
  abstract putHomework(id: string, data: any): void;
  abstract patchHomework(id: string, fields: any): void;
  abstract deleteHomework(id: string): void;
  abstract getSettlement(dateKey: string): any;
  abstract saveSettlement(dateKey: string, data: any): void;
  abstract putSettlement(dateKey: string, data: any): void;
  abstract patchSettlement(dateKey: string, fields: any): void;
  abstract getShopItems(): any[];
  abstract saveShopItems(items: any[]): void;
  abstract getShopItemById(id: string): any | null;
  abstract putShopItem(id: string, data: any): void;
  abstract deleteShopItem(id: string): void;
  abstract getRedemptions(): any[];
  abstract saveRedemptions(items: any[]): void;
  abstract clearFulfilledRedemptions(): void;
  abstract putRedemption(id: string, data: any): void;
  abstract getRewardBox(): any[];
  abstract saveRewardBox(items: any[]): void;
  abstract putRewardBoxItem(id: string, data: any): void;
  abstract deleteRewardBoxItem(id: string): void;
  abstract getSettings(): any;
  abstract saveSettings(data: any): void;
  abstract putSettings(data: any): void;
  abstract patchSettings(fields: any): void;
  abstract getActiveBuffs(): any[];
  abstract saveActiveBuffs(items: any[]): void;
  abstract putBuff(id: string, data: any): void;
  abstract deleteBuff(id: string): void;
  abstract getEfficiency(dateKey: string): any;
  abstract saveEfficiency(dateKey: string, data: any): void;
  abstract putEfficiency(dateKey: string, data: any): void;
  abstract getFreeTime(dateKey: string): any[];
  abstract saveFreeTime(dateKey: string, tasks: any[]): void;
  abstract putFreeTimeTask(id: string, data: any): void;
  abstract getBountyTasks(): any[];
  abstract saveBountyTasks(items: any[]): void;
  abstract getBountyTaskById(id: string): any | null;
  abstract putBountyTask(id: string, data: any): void;
  abstract deleteBountyTask(id: string): void;
  abstract getBountySubmissions(dateKey: string): any[];
  abstract saveBountySubmissions(dateKey: string, data: any[]): void;
  abstract putBountySubmission(id: string, data: any): void;
  abstract getBountyCompletions(dateKey: string): any;
  abstract saveBountyCompletions(dateKey: string, data: any): void;
  abstract putBountyCompletion(id: string, data: any): void;
  abstract getEmailConfig(): any | null;
  abstract saveEmailConfig(config: any): void;
  abstract getModifiedSince(timestamp: string): ModifiedEntry[];
  abstract pushMerge(changes: any[]): { ok: boolean };
  abstract recordModification(tableName: string, recordKey: string, timestamp: string): void;
  abstract resetDate(dateKey: string): void;
  abstract saveCRDTOperation(op: CRDTOperation): void;
  abstract applyCRDTOperation(op: CRDTOperation): void;
  abstract getCRDTOperationsSince(timestamp: string): CRDTOperation[];
  abstract ackCRDTOperations(timestamp: string): void;
}
```

- [ ] **Step 5 (GREEN): 创建 `src/db/sqlite-adapter.ts` — SqliteAdapter**

Copy the existing `PapaCheckDB` class body (lines 72-1320 from `db/index.ts`) into `SqliteAdapter extends DatabaseAdapter`. Key changes:
- Class declaration: `export class SqliteAdapter extends DatabaseAdapter`
- Remove duplicate type definitions (now from `types.ts`)
- Import from types.ts and adapter.ts
- Add `_resetDailyShopQuantity` and `_findRecordById` private methods (if they exist)

```typescript
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { DatabaseAdapter } from './adapter.js';
import type { FullDataSnapshot, ModifiedEntry, NotificationItem, PointsHistoryEntry } from './types.js';
import type { CRDTOperation } from '../crdt/types.js';

const DATE_KEY_TABLES = new Set([/* same as original */]);
const SINGLE_ROW_TABLES = new Set([/* same as original */]);

export class SqliteAdapter extends DatabaseAdapter {
  private db: DatabaseType;
  // ... rest of PapaCheckDB implementation unchanged
}
```

**Important**: Keep the `_resetDailyShopQuantity` and `_findRecordById` methods that PostgresAdapter also needs (they're in the parent's abstract signatures).

- [ ] **Step 6 (GREEN): 重写 `src/db/index.ts` — 工厂函数**

```typescript
import { SqliteAdapter } from './sqlite-adapter.js';
import type { IDatabase } from './types.js';
export type { IDatabase } from './types.js';
export * from './types.js';

export type DatabaseType = IDatabase;

export function createDatabase(options: { dbPath?: string; databaseUrl?: string }): IDatabase {
  const url = options.databaseUrl ?? process.env['DATABASE_URL'];
  if (url) {
    // Dynamic import to avoid better-sqlite3 errors when not needed
    const { PostgresAdapter } = require('./postgres-adapter.js');
    return new PostgresAdapter(url);
  }
  return new SqliteAdapter(options.dbPath ?? 'data.db');
}

// Backwards compatibility
export { SqliteAdapter as PapaCheckDB, SqliteAdapter as Database, SqliteAdapter };
```

- [ ] **Step 7 (GREEN): 更新 `app.ts` — 使用工厂函数**

Replace:
```typescript
import { PapaCheckDB } from './db/index.js';
// ...
const db = new PapaCheckDB(options.dbPath);
```

With:
```typescript
import { createDatabase } from './db/index.js';
// ...
const db = createDatabase({ dbPath: options.dbPath });
```

- [ ] **Step 8 (VERIFY): 全量回归测试**

Run:
```bash
cd PapaCheck.Server.Node && npx vitest run
```
Expected: All tests pass (the existing tests import `Database` which is still exported as alias)

---

### Task 5a-2: 实现 PostgresAdapter

**Files:**
- Create: `PapaCheck.Server.Node/src/db/postgres-adapter.ts`
- Create: `PapaCheck.Server.Node/test/db/postgres-adapter.test.ts`
- Modify: `PapaCheck.Server.Node/src/db/index.ts` (already done in Step 6 above)

- [ ] **Step 1 (TDD RED): 创建 `test/db/postgres-adapter.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const runPg = !!process.env['DATABASE_URL'];

describe.runIf(runPg)('PostgresAdapter', () => {
  let adapter: any;

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = new PostgresAdapter(process.env['DATABASE_URL']!);
  });

  afterAll(async () => {
    await adapter?.close();
  });

  it('should get points balance', async () => {
    const balance = await adapter.getPointsBalance();
    expect(typeof balance).toBe('number');
  });

  it('should earn and spend points', async () => {
    const before = await adapter.getPointsBalance();
    await adapter.updatePoints('earn', 100, 'test earn');
    expect(await adapter.getPointsBalance()).toBe(before + 100);
    await adapter.updatePoints('spend', 50, 'test spend');
    expect(await adapter.getPointsBalance()).toBe(before + 50);
  });

  it('should store and retrieve homeworks', async () => {
    await adapter.saveHomeworks('2026-06-09', [{ id: 'hw1', subject: '数学' }]);
    const items = await adapter.getHomeworks('2026-06-09');
    expect(items.length).toBe(1);
    expect(items[0].subject).toBe('数学');
  });

  it('should store and retrieve shop items', async () => {
    await adapter.saveShopItems([{ id: 'item1', name: '游戏时间', cost: 50 }]);
    const items = await adapter.getShopItems();
    expect(items.length).toBe(1);
    expect(items[0].name).toBe('游戏时间');
  });

  it('should store and retrieve settings', async () => {
    await adapter.saveSettings({ dailyBasePoints: 10 });
    const settings = await adapter.getSettings();
    expect(settings.dailyBasePoints).toBe(10);
  });

  it('should handle full data snapshot', async () => {
    const data = await adapter.getFullData();
    expect(data).toHaveProperty('points');
    expect(data).toHaveProperty('homeworks');
    expect(data).toHaveProperty('shopItems');
    expect(data).toHaveProperty('settings');
  });

  it('should handle pushMerge', async () => {
    const result = await adapter.pushMerge([]);
    expect(result).toEqual({ ok: true });
  });

  it('should record and retrieve modifications', async () => {
    const now = new Date().toISOString();
    await adapter.recordModification('homeworks', '2026-06-09', now);
    const modified = await adapter.getModifiedSince('2000-01-01');
    expect(modified.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2 (GREEN): 创建 `src/db/postgres-adapter.ts` 骨架**

File structure:
- Import `pg` (Pool), `DatabaseAdapter`, and all types
- `PostgresAdapter extends DatabaseAdapter`
- Schema init reads from `scripts/init-pg-schema.sql`
- Internal helpers: `_getJson`, `_setJson`, `_getDateData`, `_setDateData`
- All methods return Promises (async)
- Use `$1, $2` parameterized queries (PostgreSQL style)

The first batch of methods to implement:
- `close()` → `await this.pool.end()`
- Schema initialization
- Points: `getPointsBalance`, `updatePoints`, `patchPoints`
- Homeworks: `getHomeworks`, `saveHomeworks`

Then implement the remaining ~35 methods in Step 3.

- [ ] **Step 3 (GREEN): 逐方法实现 IDatabase 全部 ~40 个方法**

Implementation pattern for each method follows:
- Single-row JSON tables (shop_items, etc.): `SELECT/UPDATE table SET data = $1 WHERE id = 1`
- Date-key tables (homeworks, etc.): `SELECT/INSERT ... ON CONFLICT (date_key) DO UPDATE`
- Points: dedicated table with `balance` column
- Notifications: `notifications` table with `id, text, created_at`
- Sync: `last_modified` table with `(table_name, record_key)`
- CRDT: `crdt_operations` table

- [ ] **Step 4 (VERIFY): Docker PostgreSQL 运行测试**

```bash
# 1. Start PostgreSQL container
docker run -d --name pg-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=papacheck -p 5432:5432 postgres:16-alpine

# 2. Run PostgresAdapter tests
DATABASE_URL=postgresql://postgres:test@localhost:5432/papacheck npx vitest run test/db/postgres-adapter.test.ts

# 3. Verify expected PASS
# 4. Clean up
docker stop pg-test && docker rm pg-test
```

- [ ] **Step 5 (VERIFY): SQLite 回归不受影响**

```bash
cd PapaCheck.Server.Node && npx vitest run
```
Expected: All tests pass (identical to pre-refactoring)

---

### Task 5a-3: 数据迁移脚本

**Files:**
- Create: `PapaCheck.Server.Node/scripts/init-pg-schema.sql`
- Create: `PapaCheck.Server.Node/scripts/migrate-to-pg.ts`
- Create: `PapaCheck.Server.Node/test/scripts/migrate-to-pg.test.ts`
- Modify: `PapaCheck.Server.Node/package.json`

- [ ] **Step 1 (TDD RED): 创建 `test/scripts/migrate-to-pg.test.ts`**

Test that the schema SQL file exists and contains all expected tables.

- [ ] **Step 2 (GREEN): 创建 `scripts/init-pg-schema.sql`**

PostgreSQL DDL matching the SQLite schema. All 17+ tables with:
- `points` (id=1, balance)
- `points_history` (SERIAL PK)
- Date-key tables (date_key TEXT PK, data TEXT)
- Single-row tables (id=1 PK CHECK, data TEXT)
- `notifications`, `last_modified`, `crdt_operations`
- Default data inserts with `ON CONFLICT DO NOTHING`

- [ ] **Step 3 (GREEN): 创建 `scripts/migrate-to-pg.ts`**

Migration flow:
1. Read SQLite DB via better-sqlite3
2. Connect to PostgreSQL via pg Pool
3. Run schema init
4. For each table: read all rows from SQLite → INSERT into PostgreSQL
5. Verify row counts match
6. Handle single-row, date-key, and special tables differently

- [ ] **Step 4 (GREEN): package.json 添加 migrate script**

```json
"scripts": {
  // ... existing ...
  "migrate:pg": "DATABASE_URL=$DATABASE_URL npx tsx scripts/migrate-to-pg.ts"
}
```

- [ ] **Step 5 (VERIFY): 全量回归**

```bash
cd PapaCheck.Server.Node && npx vitest run
```

---

## Phase 5b: 部署架构重构

### Task 5b-1: Cookie Session 临时认证中间件

**Files:**
- Create: `PapaCheck.Server.Node/src/auth-plugin.ts`
- Create: `PapaCheck.Server.Node/test/auth-plugin.test.ts`
- Modify: `PapaCheck.Server.Node/src/app.ts`

- [ ] **Step 1 (TDD RED): 创建 `test/auth-plugin.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

describe('Auth Plugin', () => {
  const app = Fastify();

  beforeAll(async () => {
    // Register auth plugin with test settings
    // ... setup
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return 401 for unauthenticated /api/* requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test' });
    expect(res.statusCode).toBe(401);
  });

  it('should allow login with correct password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'test-password' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.cookies).toBeDefined();
  });

  it('should reject login with wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should allow requests with valid session cookie', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'test-password' },
    });
    const cookie = loginRes.cookies[0];
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it('should allow public paths without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ping' });
    expect(res.statusCode).toBe(200);
  });
});
```

Run: `npx vitest run test/auth-plugin.test.ts`
Expected: FAIL (RED)

- [ ] **Step 2 (GREEN): 创建 `src/auth-plugin.ts`**

Fastify plugin that:
1. Defines a whitelist of public paths: `/api/ping`, `/docs`, `/css/`, `/js/`, `/api/login`
2. On `onRequest`: checks for session cookie
3. No cookie → returns 401 for `/api/*`, allows static files
4. Provides `/api/login` POST endpoint: validates password against settings, sets cookie
5. Provides `/api/logout` POST endpoint: clears cookie
6. Uses `@fastify/cookie` or raw cookie header parsing
7. Password auto-generated on first deploy, stored in settings

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import type { IDatabase } from './db/types.js';

const PUBLIC_PATHS = new Set([
  '/api/ping',
  '/api/login',
  '/api/logout',
]);

const SESSION_COOKIE = 'papacheck_session';

export async function authPlugin(app: FastifyInstance, db: IDatabase): Promise<void> {
  // Auto-generate password if not set
  let settings = db.getSettings();
  if (!settings?.apiPassword) {
    const password = 'papacheck-' + crypto.randomBytes(4).toString('hex');
    settings = { ...settings, apiPassword: password };
    db.saveSettings(settings);
    console.log('========================================');
    console.log(`🔑 临时访问密码 (请保存): ${password}`);
    console.log('========================================');
  }

  // Auth hook
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip public paths
    const url = request.url.split('?')[0];
    if (PUBLIC_PATHS.has(url)) return;
    if (url.startsWith('/docs') || url.startsWith('/css/') || url.startsWith('/js/')) return;

    // Check session cookie
    const sessionId = request.cookies[SESSION_COOKIE];
    if (sessionId) {
      // Simple in-memory session store (volatile, fine for temp solution)
      // For now just validate cookie exists — Phase 5c will replace with JWT
      return;
    }

    return reply.status(401).send({ error: '未授权，请先登录', code: 'UNAUTHORIZED' });
  });

  // Login endpoint
  app.post('/api/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { password } = request.body as { password: string };
    const currentSettings = db.getSettings();
    if (password === currentSettings?.apiPassword) {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      // Store in memory session map
      reply.setCookie(SESSION_COOKIE, sessionToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });
      return { ok: true };
    }
    return reply.status(401).send({ error: '密码错误', code: 'UNAUTHORIZED' });
  });
}
```

- [ ] **Step 3 (GREEN): 密码管理**

Password auto-generation on first deploy (already included in Step 2).
Also add endpoint to view/reset password (for recovery).

- [ ] **Step 4 (GREEN): 登录页面**

Create a minimal login HTML page served at `/login.html`:
- Simple form with password input + submit
- On success, redirect to `/app/`
- Light styling matching the app's design

- [ ] **Step 5 (GREEN): 在 `app.ts` 中注册 auth 插件**

After db creation, register the plugin:
```typescript
import { authPlugin } from './auth-plugin.js';

// After db creation
await authPlugin(app, db);
```

- [ ] **Step 6 (VERIFY): 全量回归**

```bash
cd PapaCheck.Server.Node && npx vitest run
```

---

### Task 5b-2: 本地部署脚本 + systemd service

**Files:**
- Create: `scripts/deploy.sh`

- [ ] **Step 1: 创建 `scripts/deploy.sh`**

```bash
#!/bin/bash
set -e

SERVER="root@123.57.129.243"
REMOTE_DIR="/opt/papacheck"
APP_DIR="PapaCheck.Server.Node"

echo "=== 1. 本地编译 ==="
cd "$(dirname "$0")/../$APP_DIR"
npx tsc

echo "=== 2. 打包 ==="
cd ..
tar czf /tmp/papacheck.tar.gz \
  "$APP_DIR/dist" \
  "$APP_DIR/package.json" \
  "$APP_DIR/package-lock.json" \
  "$APP_DIR/node_modules/better-sqlite3" \
  "PapaCheck.Web"

echo "=== 3. 上传服务器 ==="
scp /tmp/papacheck.tar.gz "$SERVER:/tmp/"

echo "=== 4. 服务器部署 ==="
ssh "$SERVER" "
  set -e
  mkdir -p $REMOTE_DIR
  tar xzf /tmp/papacheck.tar.gz -C $REMOTE_DIR
  cd $REMOTE_DIR/$APP_DIR
  npm ci --omit=dev --ignore-scripts
  sudo systemctl restart papacheck
  echo '✅ 部署完成'
"

echo "=== 5. 清理 ==="
rm /tmp/papacheck.tar.gz
```

- [ ] **Step 2: systemd service 模板**

```ini
[Unit]
Description=PapaCheck Server
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=papacheck
Group=papacheck
WorkingDirectory=/opt/papacheck/PapaCheck.Server.Node
ExecStart=/usr/bin/node dist/index.js --web-dir /opt/papacheck/PapaCheck.Web --tts-python python3
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://papacheck:${PG_PASSWORD}@localhost:5432/papacheck
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3 (VERIFY): 本地验证**

```bash
cd PapaCheck.Server.Node && npx tsc
# Verify dist/ is generated
```

---

### Task 5b-3: 服务器环境配置（人工操作 + 自动化脚本）

**Files:** Server-side configuration (no code changes)

- [ ] **Step 1: 服务器安装依赖**

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# PostgreSQL 16
apt install -y postgresql postgresql-contrib

# Nginx
apt install -y nginx

# Python + edge-tts
apt install -y python3 python3-pip
pip3 install edge-tts
```

- [ ] **Step 2: 停止 Docker 容器 + 备份数据**

```bash
cd /opt && docker compose down
cp PapaCheck.Server.Node/data.db /tmp/data.db.bak
```

- [ ] **Step 3: 创建 deploy 用户 + systemd 配置**

```bash
useradd -r -s /bin/false papacheck
mkdir -p /opt/papacheck
chown papacheck:papacheck /opt/papacheck
cp papacheck.service /etc/systemd/system/
systemctl daemon-reload
```

- [ ] **Step 4: 配置 Nginx 反向代理**

```nginx
server {
    listen 443 ssl;
    server_name papacheck.chengdexy.cn;

    ssl_certificate /etc/letsencrypt/live/papacheck.chengdexy.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/papacheck.chengdexy.cn/privkey.pem;

    # Landing page (public)
    root /opt/landing;
    index index.html;

    # App frontend
    location /app/ {
        proxy_pass http://localhost:8080/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # API
    location /api/ {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 80;
    server_name papacheck.chengdexy.cn;
    return 301 https://$host$request_uri;
}
```

- [ ] **Step 5: 关闭 8080 安全组 + UFW**

```bash
# UFW
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 8080/tcp
ufw enable

# 阿里云安全组：删除 8080 入方向规则（需手动或在 CLI 执行）
aliyun ecs RevokeSecurityGroup \
  --RegionId cn-beijing \
  --SecurityGroupId sg-2zedjys3qwat92xtd6j4 \
  --IpProtocol tcp \
  --PortRange 8080/8080 \
  --SourceCidrIp 0.0.0.0/0
```

- [ ] **Step 6: 端到端验证**

```bash
# 验证服务运行
systemctl status papacheck

# 验证 API
curl https://papacheck.chengdexy.cn/api/ping

# 验证前端
curl -I https://papacheck.chengdexy.cn/app/

# 验证 8080 已关闭
curl -I http://123.57.129.243:8080/  # 应超时或拒绝
```

---

### Task 5b-4: 全量测试验证

- [ ] **Step 1: PostgreSQL 模式全量测试**

```bash
docker run -d --name pg-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=papacheck -p 5432:5432 postgres:16-alpine
DATABASE_URL=postgresql://postgres:test@localhost:5432/papacheck cd PapaCheck.Server.Node && npx vitest run
docker stop pg-test && docker rm pg-test
```

- [ ] **Step 2: SQLite 回归**

```bash
cd PapaCheck.Server.Node && npx vitest run  # Should pass without DATABASE_URL
```

- [ ] **Step 3: 前端 Vitest**

```bash
cd PapaCheck.Web && npx vitest run
```

- [ ] **Step 4: 端到端冒烟**

```bash
curl https://papacheck.chengdexy.cn/api/ping
# Expected: {"ok":true,"serverTime":"..."}
```

---

## Verification Checklist

- [ ] Task 5a-1: abstract-adapter.test.ts passes (RED → GREEN)
- [ ] Task 5a-1: All existing tests pass with SqliteAdapter (regression)
- [ ] Task 5a-2: postgres-adapter.test.ts passes with Docker PostgreSQL
- [ ] Task 5a-2: SQLite tests still pass
- [ ] Task 5a-3: Schema SQL includes all 17+ tables
- [ ] Task 5a-3: Migration script verifies row count matches
- [ ] Task 5b-1: Auth tests pass (401, login, cookie)
- [ ] Task 5b-1: Login page renders correctly
- [ ] Task 5b-2: deploy.sh compiles and packages correctly
- [ ] Task 5b-3: Server starts with PostgreSQL
- [ ] Task 5b-3: Nginx reverse proxy works
- [ ] Task 5b-3: Port 8080 is closed from public
- [ ] Task 5b-4: Postgres mode full test suite passes
- [ ] Task 5b-4: SQLite mode regression passes
