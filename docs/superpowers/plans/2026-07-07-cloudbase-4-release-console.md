# PapaCheck CloudBase 迁移 - 子计划 4：Release 控制台改造

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⚠️ **文档状态：迁移子计划稿，实施方式已变更（2026-07-14 注记）**
> 本文档是 CloudBase 迁移的**子计划稿（预期方案）**，实际落地已与本文多处不符，阅读时以代码与现状文档（README / ARCHITECTURE / PROGRESS）为准：
> - **实时同步**：本文档描述的 CloudBase PG 实时监听（`watch()`）/ RLS 订阅**未落地**；生产实际为前端 `RealtimeManager` 轻量版本戳短轮询（默认 3 秒轮询 `/api/data-version`，变更才拉全量；写后 burst 提速到 1 秒）。
> - **多租户隔离**：本文档依赖的 **RLS（`cloudbase-rls.sql`）未激活**——后端 `postgres-adapter.ts` 用普通 `pg` 连接，不注入 `request.jwt.claims`；隔离实际由应用层 SQL（`WHERE tenant_id=$1 [AND child_id=$2]`）实现。
> - **TTS**：`tts-svc` 由独立仓库维护，**不在本仓库**（仅 `/api/speak`、`/api/pregen-speech` 经网关转发）。
> - **版本号**：本文档出现的 `v2.0.0` 为设计预期，实际为 Server 1.2.0 / Web 1.5.2 / Android 1.6.6。
> - **表数量**：迁移设计稿原写 26 张表，实际 `init-pg-schema.sql` 建 **27 张表**。

**Goal:** 将 PapaCheck.Release 从 SSH 部署 ECS 改造为 `tcb` CLI 部署 CloudBase（云函数 + 静态托管 + 云存储）。

**Architecture:** 弃用 `cloud-publish.ts` 的 SSH 逻辑，改为 `tcb fn deploy` + `tcb hosting deploy`。新增 `fn` 子命令部署云函数。`build-apk --publish` 改用 `tcb fn update` 更新环境变量。`site` 改用 `tcb hosting deploy`。

**Tech Stack:** Node.js 20, TypeScript, tcb CLI, Vitest

**依赖关系：** 无前置依赖，可与子计划 1/2/5 并行开发。

**Spec 参考：** `docs/superpowers/specs/2026-07-07-cloudbase-migration-design.md` 第七章「Release 控制台迁移」

---

## 文件结构

```
PapaCheck.Release/
├── lib/
│   ├── cloud-publish.ts      # 改造：SSH → tcb fn deploy
│   ├── site-publish.ts       # 改造：tar+SSH → tcb hosting deploy
│   ├── build-apk.ts          # 改造：--publish 用 tcb fn update
│   ├── fn-deploy.ts          # 新建：云函数部署逻辑
│   ├── executor.ts           # 复用
│   └── reset-test-db.ts      # 复用
├── __tests__/
│   ├── cloud-publish.test.ts # 改造
│   ├── site-publish.test.ts  # 改造
│   ├── fn-deploy.test.ts     # 新建
│   └── build-apk.test.ts     # 改造
├── release.ts                # 改造：新增 fn 子命令
└── console.html              # 改造：UI 按钮
```

---

### Task 1: 编写 fn-deploy.ts 云函数部署模块 - TDD

**Files:**
- Create: `PapaCheck.Release/lib/fn-deploy.ts`
- Create: `PapaCheck.Release/__tests__/fn-deploy.test.ts`

- [ ] **Step 1: 写 Gherkin 行为注释**

```typescript
// __tests__/fn-deploy.test.ts
// Feature: 云函数部署
//   Scenario: 部署 papacheck-api 云函数
//     Given 云函数代码已编译（dist/ 存在）
//     When 调用 deployFunction('papacheck-api')
//     Then tcb fn deploy 命令被执行
//   Scenario: 更新云函数环境变量
//     Given 云函数已部署
//     When 调用 updateFunctionEnv('papacheck-api', { APK_VERSION: '1.6.0' })
//     Then tcb fn update 命令被执行
test('云函数部署', () => {});
```

- [ ] **Step 2: 用 AskUserQuestion 向用户确认 Gherkin 场景**

- [ ] **Step 3: 写失败测试（用户确认后）**

```typescript
// __tests__/fn-deploy.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, callback) => callback(null, { stdout: '', stderr: '' })),
}));

import { deployFunction, updateFunctionEnv } from '../lib/fn-deploy.js';

describe('云函数部署', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deployFunction 调用 tcb fn deploy', async () => {
    await deployFunction('papacheck-api', {
      envId: 'child-teacher-parent-d9aef9d2208',
    });
    const { execFile } = await import('child_process');
    expect(execFile).toHaveBeenCalledWith(
      'tcb',
      expect.arrayContaining(['fn', 'deploy', 'papacheck-api']),
      expect.any(Function)
    );
  });

  it('updateFunctionEnv 调用 tcb fn update', async () => {
    await updateFunctionEnv('papacheck-api', { APK_VERSION: '1.6.0' }, {
      envId: 'child-teacher-parent-d9aef9d2208',
    });
    const { execFile } = await import('child_process');
    expect(execFile).toHaveBeenCalledWith(
      'tcb',
      expect.arrayContaining(['fn', 'update', 'papacheck-api']),
      expect.any(Function)
    );
  });
});
```

- [ ] **Step 4: 运行测试验证失败**

```bash
cd PapaCheck.Release && npx vitest run __tests__/fn-deploy.test.ts
```
Expected: FAIL

- [ ] **Step 5: 实现 fn-deploy.ts**

```typescript
// lib/fn-deploy.ts
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DeployOptions {
  envId: string;
  cwd?: string;
}

export async function deployFunction(
  functionName: string,
  options: DeployOptions
): Promise<void> {
  const args = ['fn', 'deploy', functionName, '--envId', options.envId];
  await execFileAsync('tcb', args, { cwd: options.cwd });
}

export async function updateFunctionEnv(
  functionName: string,
  envVars: Record<string, string>,
  options: DeployOptions
): Promise<void> {
  const envArgs = Object.entries(envVars).map(([k, v]) => `--env ${k}=${v}`);
  const args = ['fn', 'update', functionName, '--envId', options.envId, ...envArgs];
  await execFileAsync('tcb', args, { cwd: options.cwd });
}
```

- [ ] **Step 6: 运行测试验证通过**

```bash
cd PapaCheck.Release && npx vitest run __tests__/fn-deploy.test.ts
```
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add PapaCheck.Release/lib/fn-deploy.ts PapaCheck.Release/__tests__/fn-deploy.test.ts
git commit -m "feat: 新增 fn-deploy.ts 云函数部署模块（tcb fn deploy/update）"
```

---

### Task 2: 改造 cloud-publish.ts - SSH → tcb

**Files:**
- Modify: `PapaCheck.Release/lib/cloud-publish.ts`
- Modify: `PapaCheck.Release/__tests__/cloud-publish.test.ts`

- [ ] **Step 1: 改造 cloud-publish.ts**

删除所有 SSH 相关代码（ssh2 依赖、scp、远程命令执行），替换为：

```typescript
// lib/cloud-publish.ts (改造后)
import { deployFunction, updateFunctionEnv } from './fn-deploy.js';
import { executeSteps, type Step } from './executor.js';

const ENV_ID = 'child-teacher-parent-d9aef9d2208';

export async function deployCloudFunction(): Promise<void> {
  const steps: Step[] = [
    {
      name: '编译云函数',
      cmd: 'npm',
      args: ['run', 'build'],
      cwd: 'PapaCheck.CloudFunc/papacheck-api',
    },
    {
      name: '部署云函数',
      cmd: 'tcb',
      args: ['fn', 'deploy', 'papacheck-api', '--envId', ENV_ID],
      cwd: 'PapaCheck.CloudFunc/papacheck-api',
    },
  ];
  await executeSteps(steps);
}

export async function updateApkVersion(version: string): Promise<void> {
  await updateFunctionEnv('papacheck-api', { APK_VERSION: version }, { envId: ENV_ID });
}
```

- [ ] **Step 2: 改造测试**

```typescript
// __tests__/cloud-publish.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/fn-deploy.js', () => ({
  deployFunction: vi.fn().mockResolvedValue(undefined),
  updateFunctionEnv: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/executor.js', () => ({
  executeSteps: vi.fn().mockResolvedValue(undefined),
}));

import { deployCloudFunction, updateApkVersion } from '../lib/cloud-publish.js';

describe('cloud-publish', () => {
  it('deployCloudFunction 调用 executeSteps', async () => {
    await deployCloudFunction();
    const { executeSteps } = await import('../lib/executor.js');
    expect(executeSteps).toHaveBeenCalled();
  });

  it('updateApkVersion 调用 updateFunctionEnv', async () => {
    await updateApkVersion('1.6.0');
    const { updateFunctionEnv } = await import('../lib/fn-deploy.js');
    expect(updateFunctionEnv).toHaveBeenCalledWith(
      'papacheck-api',
      { APK_VERSION: '1.6.0' },
      expect.any(Object)
    );
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
cd PapaCheck.Release && npx vitest run __tests__/cloud-publish.test.ts
```
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add PapaCheck.Release/lib/cloud-publish.ts PapaCheck.Release/__tests__/cloud-publish.test.ts
git commit -m "refactor: cloud-publish.ts 从 SSH 改为 tcb fn deploy"
```

---

### Task 3: 改造 site-publish.ts - tar+SSH → tcb hosting deploy

**Files:**
- Modify: `PapaCheck.Release/lib/site-publish.ts`
- Modify: `PapaCheck.Release/__tests__/site-publish.test.ts`

- [ ] **Step 1: 改造 site-publish.ts**

```typescript
// lib/site-publish.ts (改造后)
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';

const execFileAsync = promisify(execFile);
const ENV_ID = 'child-teacher-parent-d9aef9d2208';

export async function publishSite(): Promise<void> {
  // 1. Vite 构建（base=/papacheck/）
  await execFileAsync('npm', ['run', 'build'], { cwd: 'PapaCheck.Site' });

  // 2. 上传落地页到静态托管 /papacheck/
  await execFileAsync('tcb', [
    'hosting', 'deploy', 'dist/', '--path', '/papacheck/',
    '--envId', ENV_ID,
  ], { cwd: 'PapaCheck.Site' });
}

export async function publishWebApp(): Promise<void> {
  // 上传孩子端到静态托管 /papacheck/app/
  await execFileAsync('tcb', [
    'hosting', 'deploy', '.', '--path', '/papacheck/app/',
    '--envId', ENV_ID,
  ], { cwd: 'PapaCheck.Web' });
}
```

- [ ] **Step 2: 改造测试**

```typescript
// __tests__/site-publish.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, opts, callback) => callback(null, { stdout: '', stderr: '' })),
}));

import { publishSite, publishWebApp } from '../lib/site-publish.js';

describe('site-publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishSite 调用 npm run build 和 tcb hosting deploy', async () => {
    await publishSite();
    const { execFile } = await import('child_process');
    expect(execFile).toHaveBeenCalledWith(
      'npm',
      ['run', 'build'],
      expect.any(Object),
      expect.any(Function)
    );
    expect(execFile).toHaveBeenCalledWith(
      'tcb',
      expect.arrayContaining(['hosting', 'deploy']),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('publishWebApp 调用 tcb hosting deploy', async () => {
    await publishWebApp();
    const { execFile } = await import('child_process');
    expect(execFile).toHaveBeenCalledWith(
      'tcb',
      expect.arrayContaining(['hosting', 'deploy', '.', '--path', '/papacheck/app/']),
      expect.any(Object),
      expect.any(Function)
    );
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
cd PapaCheck.Release && npx vitest run __tests__/site-publish.test.ts
```
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add PapaCheck.Release/lib/site-publish.ts PapaCheck.Release/__tests__/site-publish.test.ts
git commit -m "refactor: site-publish.ts 从 tar+SSH 改为 tcb hosting deploy"
```

---

### Task 4: 改造 release.ts 新增 fn 子命令

**Files:**
- Modify: `PapaCheck.Release/release.ts`

- [ ] **Step 1: 改造 release.ts**

添加 `fn` 子命令：

```typescript
// release.ts (在现有子命令后添加)
import { deployCloudFunction } from './lib/cloud-publish.js';

// ... 现有 serve / build-apk / cloud / site 子命令

// 新增 fn 子命令
program
  .command('fn')
  .description('部署云函数到 CloudBase')
  .option('--env <env>', '环境（prod/preview）', 'prod')
  .action(async (options) => {
    console.log('=== 部署云函数 ===');
    await deployCloudFunction();
    console.log('✓ 云函数部署完成');
  });

// 新增 all 子命令（一键完整发布）
program
  .command('all')
  .description('一键完整发布（静态托管 + 云函数 + APK）')
  .option('--env <env>', '环境', 'prod')
  .option('--no-apk', '跳过 APK 构建')
  .action(async (options) => {
    console.log('=== 一键完整发布 ===');
    await publishSite();
    await publishWebApp();
    await deployCloudFunction();
    if (!options.noApk) {
      await buildApk({ publish: true });
    }
    console.log('✓ 完整发布完成');
  });
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd PapaCheck.Release && npx tsc --noEmit
```
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add PapaCheck.Release/release.ts
git commit -m "feat: release.ts 新增 fn 和 all 子命令"
```

---

### Task 5: 改造 console.html UI

**Files:**
- Modify: `PapaCheck.Release/console.html`

- [ ] **Step 1: 更新按钮**

将"部署到 ECS（SSH）"按钮替换为"部署云函数"按钮：

```html
<!-- 替换原 cloud 按钮 -->
<button id="btn-fn" class="btn btn-primary">部署云函数 (tcb fn deploy)</button>
<button id="btn-site" class="btn btn-secondary">部署静态托管 (tcb hosting)</button>
<button id="btn-all" class="btn btn-success">一键完整发布</button>
```

- [ ] **Step 2: 更新 JavaScript 事件处理**

```javascript
document.getElementById('btn-fn').addEventListener('click', () => {
  startTask('fn');
});
document.getElementById('btn-all').addEventListener('click', () => {
  startTask('all');
});
```

- [ ] **Step 3: 提交**

```bash
git add PapaCheck.Release/console.html
git commit -m "refactor: console.html 更新按钮为 tcb 部署命令"
```

---

### Task 6: 全量测试

- [ ] **Step 1: 全量测试**

```bash
cd PapaCheck.Release && npx vitest run
```
Expected: 所有测试通过

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "chore: Release 控制台改造完成，全量测试通过"
```

---

## 完成标准

- [ ] `fn-deploy.ts` 实现 `deployFunction` 和 `updateFunctionEnv`
- [ ] `cloud-publish.ts` 从 SSH 改为 `tcb fn deploy`
- [ ] `site-publish.ts` 从 tar+SSH 改为 `tcb hosting deploy`
- [ ] `release.ts` 新增 `fn` 和 `all` 子命令
- [ ] `console.html` UI 更新
- [ ] 全量测试通过

## 后续衔接

- 子计划 6（网关配置）使用 Release 控制台部署云函数和静态托管
