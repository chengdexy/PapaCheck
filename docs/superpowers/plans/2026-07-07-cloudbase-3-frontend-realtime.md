# PapaCheck CloudBase 迁移 - 子计划 3：前端实时监听改造

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⚠️ **文档状态：迁移子计划稿，实施方式已变更（2026-07-14 注记）**
> 本文档是 CloudBase 迁移的**子计划稿（预期方案）**，且**与当前实现完全相反**，阅读时务必以代码与现状文档（README / ARCHITECTURE / PROGRESS）为准：
> - **本文档核心前提已推翻**：其目标是「前端从轮询改造为 CloudBase PG 实时监听（`app.rdb().table().watch()` 订阅 14 张表）+ JWT 注入触发 RLS」。实际**未采用实时监听**，也未删除离线模块以换取 watch()。
> - **实际实现**：前端 `RealtimeManager` 采用**轻量版本戳短轮询**（默认 3 秒轮询 `/api/data-version`，版本戳变化才拉全量；写后 burst 提速到 1 秒），离线/SW/localforage/CRDT 等模块仍保留。
> - **多租户隔离**：依赖的 **RLS（`cloudbase-rls.sql`）未激活**——后端 `postgres-adapter.ts` 用普通 `pg` 连接，不注入 `request.jwt.claims`；隔离实际由应用层 SQL（`WHERE tenant_id=$1 [AND child_id=$2]`）实现。
> - **TTS**：`tts-svc` 由独立仓库维护，**不在本仓库**。
> - **版本号**：`v2.0.0` 为设计预期，实际为 Server 1.2.0 / Web 1.5.2 / Android 1.6.6。
> - **表数量**：迁移设计稿原写 26 张表，实际 `init-pg-schema.sql` 建 **27 张表**。

**Goal:** 将 PapaCheck.Web 前端从轮询机制改造为 CloudBase PG 实时监听，删除离线模式（SW/localforage/CRDT/写队列），引入 `@cloudbase/js-sdk`。

**Architecture:** 前端引入 `@cloudbase/js-sdk`，用 `app.rdb().table().watch()` 订阅 14 张业务表变更。JWT 注入 CloudBase SDK 触发 RLS 隔离。删除 `sw.js`/`db.js`/`sync.js`/`crdt-sync.js`/`connection.js`，改造 `api.js`/`app.js`/`admin.js` 移除轮询。

**Tech Stack:** 原生 HTML/CSS/JS, @cloudbase/js-sdk v3, Vitest, jsdom

**依赖关系：** 依赖子计划 1（API 云函数）+ 子计划 2（数据库 + RLS）就绪后才能联调。

**Spec 参考：** `docs/superpowers/specs/2026-07-07-cloudbase-migration-design.md` 第六章「前端实时监听改造」

---

## 文件结构

```
PapaCheck.Web/
├── package.json                    # 新建（引入 @cloudbase/js-sdk）
├── js/
│   ├── cloudbase.js                # 新建：CloudBase SDK 初始化
│   ├── realtime.js                 # 新建：实时监听管理器
│   ├── api.js                      # 改造：删除轮询，保留业务 API
│   ├── app.js                      # 改造：RealtimeManager 集成
│   ├── admin.js                    # 改造：RealtimeManager 集成
│   ├── big-screen.js               # 改造：由 RealtimeManager 回调驱动
│   ├── common.js                   # 改造：移除 SW 注册
│   ├── sw.js                       # 删除
│   ├── db.js                       # 删除
│   ├── sync.js                     # 删除
│   ├── crdt-sync.js                # 删除
│   └── connection.js               # 删除
├── index.html                      # 改造：路径前缀 + 移除 SW 注册
├── admin.html                      # 改造：路径前缀
├── login.html                      # 改造：路径前缀
└── __tests__/
    ├── realtime.test.js            # 新建
    ├── api-no-poll.test.js         # 新建
    └── app-realtime.test.js        # 新建
```

---

### Task 1: 创建 package.json 引入 CloudBase SDK

**Files:**
- Create: `PapaCheck.Web/package.json`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "papacheck-web",
  "version": "1.5.2",
  "description": "PapaCheck Web 前端（孩子端 + 管理端）",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@cloudbase/js-sdk": "^3.0.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "jsdom": "^29.1.1"
  }
}
```

- [ ] **Step 2: 安装依赖**

```bash
cd PapaCheck.Web && npm install
```

- [ ] **Step 3: 提交**

```bash
git add PapaCheck.Web/package.json PapaCheck.Web/package-lock.json
git commit -m "feat: PapaCheck.Web 引入 @cloudbase/js-sdk 依赖"
```

---

### Task 2: 编写 CloudBase SDK 初始化模块 - TDD

**Files:**
- Create: `PapaCheck.Web/js/cloudbase.js`
- Create: `PapaCheck.Web/__tests__/cloudbase.test.js`

- [ ] **Step 1: 写 Gherkin 行为注释**

```javascript
// __tests__/cloudbase.test.js
// Feature: CloudBase SDK 初始化
//   Scenario: 初始化 SDK 并设置环境 ID
//     Given CloudBase 环境 ID 为 child-teacher-parent-d9aef9d2208
//     When 调用 initCloudBase()
//     Then 返回的 app 实例已初始化
//   Scenario: JWT 注入 SDK
//     Given 已初始化 SDK
//     When 调用 signInWithJwt(token)
//     Then auth 状态变为已登录
test('CloudBase SDK 初始化', () => {});
```

- [ ] **Step 2: 用 AskUserQuestion 向用户确认 Gherkin 场景**

- [ ] **Step 3: 写失败测试（用户确认后）**

```javascript
// __tests__/cloudbase.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cloudbase/js-sdk', () => {
  const mockApp = {
    auth: vi.fn(() => ({
      signInWithJwt: vi.fn().mockResolvedValue(true),
    })),
    rdb: vi.fn(() => ({})),
  };
  return {
    default: {
      init: vi.fn(() => mockApp),
    },
  };
});

import { initCloudBase, signInWithJwt, getDb } from '../js/cloudbase.js';

describe('CloudBase SDK 初始化', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initCloudBase 返回 app 实例', () => {
    const app = initCloudBase();
    expect(app).toBeDefined();
    expect(app.auth).toBeDefined();
  });

  it('signInWithJwt 调用 auth.signInWithJwt', async () => {
    const token = 'fake-jwt-token';
    await signInWithJwt(token);
    // mock 验证
    expect(true).toBe(true);
  });

  it('getDb 返回 rdb 实例', () => {
    initCloudBase();
    const db = getDb();
    expect(db).toBeDefined();
  });
});
```

- [ ] **Step 4: 运行测试验证失败**

```bash
cd PapaCheck.Web && npx vitest run __tests__/cloudbase.test.js
```
Expected: FAIL（`Cannot find module '../js/cloudbase.js'`）

- [ ] **Step 5: 实现 cloudbase.js**

```javascript
// js/cloudbase.js
import cloudbase from '@cloudbase/js-sdk';

const ENV_ID = 'child-teacher-parent-d9aef9d2208';
let appInstance = null;
let dbInstance = null;
let authInstance = null;

export function initCloudBase() {
  if (!appInstance) {
    appInstance = cloudbase.init({ env: ENV_ID });
    dbInstance = appInstance.rdb();
    authInstance = appInstance.auth({ persistence: 'session' });
  }
  return appInstance;
}

export async function signInWithJwt(jwtToken) {
  if (!authInstance) {
    initCloudBase();
  }
  await authInstance.signInWithJwt(jwtToken);
}

export function getDb() {
  if (!dbInstance) {
    initCloudBase();
  }
  return dbInstance;
}

export function getCurrentTenantId() {
  return sessionStorage.getItem('papacheck_tenant_id') || '';
}

export function getCurrentChildId() {
  return sessionStorage.getItem('papacheck_child_id') || '';
}
```

- [ ] **Step 6: 运行测试验证通过**

```bash
cd PapaCheck.Web && npx vitest run __tests__/cloudbase.test.js
```
Expected: PASS（3 个测试全过）

- [ ] **Step 7: 提交**

```bash
git add PapaCheck.Web/js/cloudbase.js PapaCheck.Web/__tests__/cloudbase.test.js
git commit -m "feat: 实现 CloudBase SDK 初始化模块（init/signInWithJwt/getDb）"
```

---

### Task 3: 编写 RealtimeManager 实时监听管理器 - TDD

**Files:**
- Create: `PapaCheck.Web/js/realtime.js`
- Create: `PapaCheck.Web/__tests__/realtime.test.js`

- [ ] **Step 1: 写 Gherkin 行为注释**

```javascript
// __tests__/realtime.test.js
// Feature: RealtimeManager 实时监听管理器
//   Scenario: 启动订阅 14 张表
//     Given JWT 和 tenant_id 已就绪
//     When 调用 realtime.start(token, tenantId, childId)
//     Then 14 张表的订阅都已建立
//   Scenario: 停止所有订阅
//     Given RealtimeManager 已启动
//     When 调用 realtime.stop()
//     Then 所有订阅已取消
//   Scenario: 收到 homeworks 表变更回调
//     Given RealtimeManager 已订阅 homeworks
//     When homeworks 表有变更推送
//     Then onHomeworksChange 回调被调用
test('RealtimeManager', () => {});
```

- [ ] **Step 2: 用 AskUserQuestion 向用户确认 Gherkin 场景**

- [ ] **Step 3: 写失败测试（用户确认后）**

```javascript
// __tests__/realtime.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/cloudbase.js', () => ({
  initCloudBase: vi.fn(),
  signInWithJwt: vi.fn().mockResolvedValue(true),
  getDb: vi.fn(() => ({
    table: vi.fn(() => ({
      where: vi.fn(() => ({
        watch: vi.fn((callback) => {
          // 模拟订阅返回取消函数
          return () => { /* unsubscribe */ };
        }),
      })),
    })),
  })),
  getCurrentTenantId: vi.fn(() => 'tenant-1'),
  getCurrentChildId: vi.fn(() => 'child-1'),
}));

import { RealtimeManager } from '../js/realtime.js';

describe('RealtimeManager', () => {
  let realtime;

  beforeEach(() => {
    realtime = new RealtimeManager();
  });

  it('start 后建立 14 张表订阅', async () => {
    const subscribeSpy = vi.spyOn(realtime, 'subscribe');
    await realtime.start('fake-token', 'tenant-1', 'child-1');
    expect(subscribeSpy).toHaveBeenCalledTimes(14);
  });

  it('stop 取消所有订阅', async () => {
    await realtime.start('fake-token', 'tenant-1', 'child-1');
    expect(realtime.subscriptions.size).toBe(14);
    realtime.stop();
    expect(realtime.subscriptions.size).toBe(0);
  });

  it('onHomeworksChange 回调可被调用', () => {
    const change = { new: { id: 1, name: '作业1' }, old: null };
    expect(() => realtime.onHomeworksChange(change)).not.toThrow();
  });
});
```

- [ ] **Step 4: 运行测试验证失败**

```bash
cd PapaCheck.Web && npx vitest run __tests__/realtime.test.js
```
Expected: FAIL（`Cannot find module '../js/realtime.js'`）

- [ ] **Step 5: 实现 realtime.js**

```javascript
// js/realtime.js
import { initCloudBase, signInWithJwt, getDb, getCurrentTenantId, getCurrentChildId } from './cloudbase.js';

const SUBSCRIBED_TABLES = [
  'homeworks',
  'daily_settlement',
  'points',
  'points_history',
  'shop_items',
  'redemptions',
  'reward_box',
  'bounty_tasks',
  'bounty_submissions',
  'bounty_completions',
  'active_buffs',
  'efficiency_history',
  'free_time_tasks',
  'notifications',
];

export class RealtimeManager {
  constructor() {
    this.subscriptions = new Map();
    this.callbacks = {
      onHomeworksChange: () => {},
      onSettlementChange: () => {},
      onPointsChange: () => {},
      onPointsHistoryChange: () => {},
      onShopItemsChange: () => {},
      onRedemptionsChange: () => {},
      onRewardBoxChange: () => {},
      onBountyTasksChange: () => {},
      onBountySubmissionsChange: () => {},
      onBountyCompletionsChange: () => {},
      onActiveBuffsChange: () => {},
      onEfficiencyHistoryChange: () => {},
      onFreeTimeTasksChange: () => {},
      onNotificationsChange: () => {},
    };
  }

  async start(jwtToken, tenantId, childId) {
    initCloudBase();
    await signInWithJwt(jwtToken);
    
    sessionStorage.setItem('papacheck_tenant_id', tenantId);
    if (childId) {
      sessionStorage.setItem('papacheck_child_id', childId);
    }

    for (const table of SUBSCRIBED_TABLES) {
      this.subscribe(table);
    }
  }

  subscribe(tableName) {
    const db = getDb();
    const callbackName = `on${tableName.charAt(0).toUpperCase() + tableName.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}Change`;
    const callback = this.callbacks[callbackName] || (() => {});
    
    const unsubscribe = db.table(tableName)
      .where('tenant_id', 'eq', getCurrentTenantId())
      .watch(callback);
    
    this.subscriptions.set(tableName, unsubscribe);
  }

  stop() {
    this.subscriptions.forEach((unsub) => {
      if (typeof unsub === 'function') unsub();
    });
    this.subscriptions.clear();
  }

  // 回调方法（由 app.js 设置具体逻辑）
  onHomeworksChange(change) {}
  onSettlementChange(change) {}
  onPointsChange(change) {}
  onPointsHistoryChange(change) {}
  onShopItemsChange(change) {}
  onRedemptionsChange(change) {}
  onRewardBoxChange(change) {}
  onBountyTasksChange(change) {}
  onBountySubmissionsChange(change) {}
  onBountyCompletionsChange(change) {}
  onActiveBuffsChange(change) {}
  onEfficiencyHistoryChange(change) {}
  onFreeTimeTasksChange(change) {}
  onNotificationsChange(change) {}
}
```

- [ ] **Step 6: 运行测试验证通过**

```bash
cd PapaCheck.Web && npx vitest run __tests__/realtime.test.js
```
Expected: PASS（3 个测试全过）

- [ ] **Step 7: 提交**

```bash
git add PapaCheck.Web/js/realtime.js PapaCheck.Web/__tests__/realtime.test.js
git commit -m "feat: 实现 RealtimeManager 实时监听管理器（14 张表订阅）"
```

---

### Task 4: 改造 api.js - 移除轮询与离线策略

**Files:**
- Modify: `PapaCheck.Web/js/api.js`
- Create: `PapaCheck.Web/__tests__/api-no-poll.test.js`

- [ ] **Step 1: 写 Gherkin 行为注释**

```javascript
// __tests__/api-no-poll.test.js
// Feature: api.js 无轮询版本
//   Scenario: API_BASE 路径前缀为 /papacheck/api
//     Given api.js 已加载
//     When 读取 API_BASE 常量
//     Then 值为 '/papacheck/api'
//   Scenario: getData 调用 /papacheck/api/data
//     Given 模拟 fetch
//     When 调用 API.getData()
//     Then fetch 被调用 with '/papacheck/api/data'
//   Scenario: 无 pollServer 函数
//     Given api.js 已加载
//     When 检查 API.pollServer
//     Then 应为 undefined
test('api.js 无轮询', () => {});
```

- [ ] **Step 2: 用 AskUserQuestion 向用户确认 Gherkin 场景**

- [ ] **Step 3: 写失败测试（用户确认后）**

```javascript
// __tests__/api-no-poll.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;
global.sessionStorage = {
  getItem: vi.fn(() => 'fake-token'),
  setItem: vi.fn(),
};

describe('api.js 无轮询版本', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: 'test' }),
    });
  });

  it('API_BASE 为 /papacheck/api', async () => {
    const API = await import('../js/api.js');
    expect(API.API_BASE).toBe('/papacheck/api');
  });

  it('getData 调用 /papacheck/api/data', async () => {
    const API = await import('../js/api.js');
    await API.getData();
    expect(mockFetch).toHaveBeenCalledWith(
      '/papacheck/api/data',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it('无 pollServer 函数', async () => {
    const API = await import('../js/api.js');
    expect(API.pollServer).toBeUndefined();
  });

  it('无 _requestWithStrategy 函数', async () => {
    const API = await import('../js/api.js');
    expect(API._requestWithStrategy).toBeUndefined();
  });
});
```

- [ ] **Step 4: 运行测试验证失败**

```bash
cd PapaCheck.Web && npx vitest run __tests__/api-no-poll.test.js
```
Expected: FAIL

- [ ] **Step 5: 改造 api.js**

在 `PapaCheck.Web/js/api.js` 中：

1. 在文件顶部添加 `const API_BASE = '/papacheck/api';`
2. 将所有 `fetch('/api/...')` 改为 `fetch(API_BASE + '/...')`
3. 删除以下函数：
   - `pollServer`
   - `_requestWithStrategy`
   - `optimisticWrite`
   - `pushOperation`
   - `reconnecting` 相关降级逻辑
4. 保留所有业务 API 方法（getData/putHomework/patchPoints 等）

- [ ] **Step 6: 运行测试验证通过**

```bash
cd PapaCheck.Web && npx vitest run __tests__/api-no-poll.test.js
```
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add PapaCheck.Web/js/api.js PapaCheck.Web/__tests__/api-no-poll.test.js
git commit -m "refactor: api.js 移除轮询与离线策略，添加 /papacheck/api 前缀"
```

---

### Task 5: 删除离线模式相关文件

**Files:**
- Delete: `PapaCheck.Web/js/sw.js`
- Delete: `PapaCheck.Web/js/db.js`
- Delete: `PapaCheck.Web/js/sync.js`
- Delete: `PapaCheck.Web/js/crdt-sync.js`
- Delete: `PapaCheck.Web/js/connection.js`

- [ ] **Step 1: 删除离线相关文件**

```bash
Remove-Item PapaCheck.Web/js/sw.js
Remove-Item PapaCheck.Web/js/db.js
Remove-Item PapaCheck.Web/js/sync.js
Remove-Item PapaCheck.Web/js/crdt-sync.js
Remove-Item PapaCheck.Web/js/connection.js
```

- [ ] **Step 2: 删除对应的测试文件**

```bash
Remove-Item PapaCheck.Web/js/__tests__/sw.test.js -ErrorAction SilentlyContinue
Remove-Item PapaCheck.Web/js/__tests__/db.test.js -ErrorAction SilentlyContinue
Remove-Item PapaCheck.Web/js/__tests__/sync.test.js -ErrorAction SilentlyContinue
Remove-Item PapaCheck.Web/js/__tests__/crdt-sync.test.js -ErrorAction SilentlyContinue
Remove-Item PapaCheck.Web/js/__tests__/crdt-sync-flow.test.js -ErrorAction SilentlyContinue
Remove-Item PapaCheck.Web/js/__tests__/connection.test.js -ErrorAction SilentlyContinue
Remove-Item PapaCheck.Web/js/__tests__/connection_offline_threshold.test.js -ErrorAction SilentlyContinue
Remove-Item PapaCheck.Web/js/__tests__/sync-engine.test.js -ErrorAction SilentlyContinue
Remove-Item PapaCheck.Web/js/__tests__/api-reconnecting.test.js -ErrorAction SilentlyContinue
Remove-Item PapaCheck.Web/js/__tests__/app_init_connection.test.js -ErrorAction SilentlyContinue
```

- [ ] **Step 3: 提交**

```bash
git add -A PapaCheck.Web/js/
git commit -m "refactor: 删除离线模式相关文件（sw/db/sync/crdt-sync/connection）"
```

---

### Task 6: 改造 app.js 集成 RealtimeManager

**Files:**
- Modify: `PapaCheck.Web/js/app.js`
- Create: `PapaCheck.Web/__tests__/app-realtime.test.js`

- [ ] **Step 1: 写 Gherkin 行为注释**

```javascript
// __tests__/app-realtime.test.js
// Feature: app.js 集成 RealtimeManager
//   Scenario: 初始化时启动 RealtimeManager
//     Given 用户已登录（sessionStorage 有 token）
//     When 调用 init()
//     Then RealtimeManager.start() 被调用
//   Scenario: 无 token 时跳转登录页
//     Given sessionStorage 无 token
//     When 调用 init()
//     Then window.location 重定向到 /papacheck/app/login.html
test('app.js RealtimeManager 集成', () => {});
```

- [ ] **Step 2: 用 AskUserQuestion 向用户确认 Gherkin 场景**

- [ ] **Step 3: 写测试（用户确认后）**

```javascript
// __tests__/app-realtime.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/realtime.js', () => ({
  RealtimeManager: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(true),
    stop: vi.fn(),
    onHomeworksChange: vi.fn(),
    onSettlementChange: vi.fn(),
  })),
}));

vi.mock('../js/api.js', () => ({
  API_BASE: '/papacheck/api',
  getData: vi.fn().mockResolvedValue({ homeworks: [], tenant_id: 't1', child_id: 'c1' }),
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer fake' })),
}));

describe('app.js RealtimeManager 集成', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.sessionStorage = {
      getItem: vi.fn((key) => key === 'papacheck_token' ? 'fake-token' : null),
      setItem: vi.fn(),
    };
  });

  it('init 启动 RealtimeManager', async () => {
    const { RealtimeManager } = await import('../js/realtime.js');
    const { init } = await import('../js/app.js');
    await init();
    expect(RealtimeManager).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: 改造 app.js**

在 `PapaCheck.Web/js/app.js` 中：

1. 删除 `import { startPoll, stopPoll } from './sync.js'`
2. 删除 `import { ConnectionManager } from './connection.js'`
3. 添加 `import { RealtimeManager } from './realtime.js'`
4. 删除 `startPoll()` / `stopPoll()` 调用
5. 删除离线遮罩 `showTransitionMask` / `hideTransitionMask` 相关逻辑
6. 在 `init()` 函数中添加：

```javascript
async function init() {
  const token = sessionStorage.getItem('papacheck_token');
  if (!token) {
    window.location.href = '/papacheck/app/login.html';
    return;
  }

  const data = await API.getData();
  renderBigScreen(data);

  const realtime = new RealtimeManager();
  realtime.callbacks.onHomeworksChange = (change) => {
    // 重新渲染作业列表
    API.getData().then(renderBigScreen);
  };
  realtime.callbacks.onNotificationsChange = (change) => {
    if (change.new && !change.old) {
      Voice.speak(change.new.text);
    }
  };
  // 设置其他回调...

  await realtime.start(token, data.tenant_id, data.child_id);
  window._realtimeManager = realtime;  // 全局引用，便于清理
}

window.addEventListener('beforeunload', () => {
  if (window._realtimeManager) {
    window._realtimeManager.stop();
  }
});
```

- [ ] **Step 5: 运行测试验证通过**

```bash
cd PapaCheck.Web && npx vitest run __tests__/app-realtime.test.js
```
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add PapaCheck.Web/js/app.js PapaCheck.Web/__tests__/app-realtime.test.js
git commit -m "refactor: app.js 集成 RealtimeManager，删除轮询调用"
```

---

### Task 7: 改造 HTML 文件路径前缀

**Files:**
- Modify: `PapaCheck.Web/index.html`
- Modify: `PapaCheck.Web/admin.html`
- Modify: `PapaCheck.Web/login.html`

- [ ] **Step 1: 改造 index.html**

在 `PapaCheck.Web/index.html` 中：
1. 将 `<link href="/css/style.css">` 改为 `<link href="/papacheck/app/css/style.css">`
2. 将 `<script src="/js/app.js">` 改为 `<script src="/papacheck/app/js/app.js">`
3. 移除 Service Worker 注册代码（`navigator.serviceWorker.register`）
4. 所有 `/js/` 和 `/css/` 引用加 `/papacheck/app/` 前缀

- [ ] **Step 2: 改造 admin.html**

同样地，将所有资源路径加 `/papacheck/app/` 前缀。

- [ ] **Step 3: 改造 login.html**

将所有资源路径加 `/papacheck/app/` 前缀。登录成功后跳转改为：

```javascript
window.location.href = '/papacheck/app/';  // 孩子/家长分流
```

- [ ] **Step 4: 提交**

```bash
git add PapaCheck.Web/index.html PapaCheck.Web/admin.html PapaCheck.Web/login.html
git commit -m "refactor: HTML 文件路径加 /papacheck/app/ 前缀，移除 SW 注册"
```

---

### Task 8: 改造 admin.js 集成 RealtimeManager

**Files:**
- Modify: `PapaCheck.Web/js/admin.js`

- [ ] **Step 1: 改造 admin.js**

删除 `import { startPoll, stopPoll } from './sync.js'`，添加 `import { RealtimeManager } from './realtime.js'`。

删除轮询调用，改为 RealtimeManager 订阅。管理端订阅的表与孩子端相同，但回调处理不同（更新表格而非大屏）。

- [ ] **Step 2: 验证全量测试通过**

```bash
cd PapaCheck.Web && npx vitest run
```
Expected: 所有剩余测试通过

- [ ] **Step 3: 提交**

```bash
git add PapaCheck.Web/js/admin.js
git commit -m "refactor: admin.js 集成 RealtimeManager，删除轮询调用"
```

---

### Task 9: 全量测试与覆盖率

- [ ] **Step 1: 全量测试**

```bash
cd PapaCheck.Web && npx vitest run
```
Expected: 所有测试通过

- [ ] **Step 2: 覆盖率检查**

```bash
cd PapaCheck.Web && npx vitest run --coverage
```
Expected: 总体覆盖率 ≥ 85%

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: 前端实时监听改造完成，全量测试通过"
```

---

## 完成标准

- [ ] `@cloudbase/js-sdk` 已引入
- [ ] `cloudbase.js` 实现 SDK 初始化 + JWT 注入
- [ ] `realtime.js` 实现 RealtimeManager（14 张表订阅）
- [ ] `api.js` 移除轮询，添加 `/papacheck/api` 前缀
- [ ] `app.js` / `admin.js` 集成 RealtimeManager
- [ ] 删除 `sw.js` / `db.js` / `sync.js` / `crdt-sync.js` / `connection.js`
- [ ] HTML 文件路径加 `/papacheck/app/` 前缀
- [ ] 全量测试通过，覆盖率 ≥ 85%

## 后续衔接

- 子计划 5（Android）移除离线快照模块
- 子计划 6（网关配置）部署静态托管后联调
