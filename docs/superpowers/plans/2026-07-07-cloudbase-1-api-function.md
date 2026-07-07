# PapaCheck CloudBase 迁移 - 子计划 1：API 云函数 `papacheck-api`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 PapaCheck.Server (Fastify + 68 端点) 改造为 CloudBase 云函数 `papacheck-api`，移除静态服务/邮件/运维/Swagger，保留业务 API + 认证。

**Architecture:** 保留现有 Fastify app 和所有业务路由，通过 `app.inject()` 将 CloudBase SCF event 转换为 Fastify 调用。新建 `PapaCheck.CloudFunc/papacheck-api/` 目录存放云函数源码，复用 `PapaCheck.Server/src/` 的业务代码。

**Tech Stack:** Node.js 20.19, Fastify 5.x, TypeScript 5.x, CloudBase SCF, pg (PostgreSQL)

**依赖关系：** 无前置依赖，可与子计划 2/4/5 并行开发。

**Spec 参考：** `docs/superpowers/specs/2026-07-07-cloudbase-migration-design.md` 第四章「API 云函数架构」

---

## 文件结构

```
PapaCheck.CloudFunc/                    # 新建目录
├── papacheck-api/
│   ├── index.ts                        # SCF 入口（main 函数）
│   ├── scf-handler.ts                  # event 解析 + Fastify.inject 适配
│   ├── db.ts                           # PG 连接池全局复用
│   ├── app.ts                          # 改造自 PapaCheck.Server/src/app.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/                            # 复用 PapaCheck.Server/src/ 业务代码
│   │   ├── admin/                      # 复用
│   │   ├── auth/                       # 复用
│   │   ├── crdt/                       # 复用（前端不再调用，保留兜底）
│   │   ├── db/                         # 复用（IDatabase + PostgresAdapter）
│   │   ├── errors.ts                   # 复用
│   │   └── routes/                     # 改造（移除 ops-routes）
│   └── test/
│       ├── scf-handler.test.ts         # 新增
│       └── rls.test.ts                 # 新增
└── README.md
```

---

### Task 1: 创建云函数目录结构与配置文件

**Files:**
- Create: `PapaCheck.CloudFunc/papacheck-api/package.json`
- Create: `PapaCheck.CloudFunc/papacheck-api/tsconfig.json`
- Create: `PapaCheck.CloudFunc/papacheck-api/vitest.config.ts`
- Create: `PapaCheck.CloudFunc/papacheck-api/README.md`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "papacheck-api",
  "version": "1.5.2",
  "description": "PapaCheck API 云函数（CloudBase SCF）",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@fastify/cookie": "^9.4.0",
    "@fastify/rate-limit": "^9.1.0",
    "bcryptjs": "^3.0.3",
    "fastify": "^4.28.0",
    "jsonwebtoken": "^9.0.3",
    "minimist": "^1.2.8",
    "pg": "^8.21.0"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/minimist": "^1.2.5",
    "@types/node": "^22.13.0",
    "@types/pg": "^8.20.0",
    "@vitest/coverage-v8": "^3.2.6",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

注意：移除了 `@fastify/static`、`@fastify/swagger`、`@fastify/swagger-ui`、`imap`、`mailparser`、`node-cron`、`nodemailer`（弃用功能不再需要）。

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./",
    "declaration": false,
    "sourceMap": false,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["index.ts", "scf-handler.ts", "db.ts", "app.ts", "src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'test/'],
    },
  },
});
```

- [ ] **Step 4: 创建 README.md**

```markdown
# papacheck-api 云函数

PapaCheck API 云函数，部署到腾讯云 CloudBase SCF。

## 开发

\`\`\`bash
npm install
npm run build
npm test
\`\`\`

## 部署

\`\`\`bash
tcb fn deploy papacheck-api --envId child-teacher-parent-d9aef9d2208
\`\`\`

## 环境变量

- `DATABASE_URL`: CloudBase PG 连接串
- `JWT_SECRET`: JWT 签名密钥
- `JWT_EXPIRES_IN`: JWT 有效期（默认 30d）
- `ENCRYPTION_KEY`: access_code 哈希密钥
- `APK_VERSION`: 当前 APK 版本号
- `APK_CDN_URL`: APK 下载 CDN 地址
- `TTS_PUBLISHABLE_KEY`: 前端实时监听用 publishable key
```

- [ ] **Step 5: 提交**

```bash
git add PapaCheck.CloudFunc/
git commit -m "新建 papacheck-api 云函数目录结构与配置文件"
```

---

### Task 2: 复用 Server 业务代码

**Files:**
- Create: `PapaCheck.CloudFunc/papacheck-api/src/` (复制自 `PapaCheck.Server/src/`)

- [ ] **Step 1: 复制业务代码到云函数目录**

```bash
# PowerShell
Copy-Item -Path PapaCheck.Server/src/admin -Destination PapaCheck.CloudFunc/papacheck-api/src/admin -Recurse
Copy-Item -Path PapaCheck.Server/src/auth -Destination PapaCheck.CloudFunc/papacheck-api/src/auth -Recurse
Copy-Item -Path PapaCheck.Server/src/crdt -Destination PapaCheck.CloudFunc/papacheck-api/src/crdt -Recurse
Copy-Item -Path PapaCheck.Server/src/db -Destination PapaCheck.CloudFunc/papacheck-api/src/db -Recurse
Copy-Item -Path PapaCheck.Server/src/errors.ts -Destination PapaCheck.CloudFunc/papacheck-api/src/errors.ts
```

注意：**不复制** `email/`、`ops/`、`routes/ops-routes.ts`（弃用功能）。

- [ ] **Step 2: 验证复制的文件结构**

```bash
# 应包含：admin/ auth/ crdt/ db/ errors.ts
Get-ChildItem PapaCheck.CloudFunc/papacheck-api/src -Recurse -Name | Select-Object -First 30
```

- [ ] **Step 3: 提交**

```bash
git add PapaCheck.CloudFunc/papacheck-api/src/
git commit -m "复用 Server 业务代码到云函数目录（admin/auth/crdt/db/errors）"
```

---

### Task 3: 编写 SCF handler 适配层 - 先写测试

**Files:**
- Create: `PapaCheck.CloudFunc/papacheck-api/scf-handler.ts`
- Create: `PapaCheck.CloudFunc/papacheck-api/test/scf-handler.test.ts`

- [ ] **Step 1: 写 Gherkin 行为注释**

```typescript
// test/scf-handler.test.ts
// Feature: SCF Handler 适配层
//   Scenario: 解析网关 GET 请求
//     Given 网关传入 event 包含 method=GET, path=/api/ping
//     When parseGatewayEvent 解析 event
//     Then 返回 { method: 'GET', path: '/api/ping', headers: {}, query: {}, body: null }
//   Scenario: 解析网关 POST 请求带 body
//     Given 网关传入 event 包含 method=POST, path=/api/auth/login, body=JSON 字符串
//     When parseGatewayEvent 解析 event
//     Then 返回 body 已解析为对象
//   Scenario: 解析网关请求带 query 参数
//     Given 网关传入 event 包含 queryStringParameters
//     When parseGatewayEvent 解析 event
//     Then 返回 query 对象
//   Scenario: 解析网关请求带 headers
//     Given 网关传入 event 包含 headers
//     When parseGatewayEvent 解析 event
//     Then 返回 headers 对象（小写键名）
test('SCF handler 解析', () => {});
```

- [ ] **Step 2: 用 AskUserQuestion 向用户确认 Gherkin 场景**

执行：使用 AskUserQuestion 工具展示上述 Gherkin 场景，询问是否继续实现。

- [ ] **Step 3: 写失败测试（用户确认后）**

```typescript
// test/scf-handler.test.ts
import { describe, it, expect } from 'vitest';
import { parseGatewayEvent } from '../scf-handler.js';

describe('parseGatewayEvent', () => {
  it('解析 GET 请求', () => {
    const event = {
      httpMethod: 'GET',
      path: '/api/ping',
      headers: { 'Content-Type': 'application/json' },
      queryStringParameters: null,
      body: null,
    };
    const result = parseGatewayEvent(event);
    expect(result.method).toBe('GET');
    expect(result.path).toBe('/api/ping');
    expect(result.body).toBeNull();
  });

  it('解析 POST 请求带 JSON body', () => {
    const event = {
      httpMethod: 'POST',
      path: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      queryStringParameters: null,
      body: JSON.stringify({ email: 'test@example.com', password: '123' }),
    };
    const result = parseGatewayEvent(event);
    expect(result.method).toBe('POST');
    expect(result.body).toEqual({ email: 'test@example.com', password: '123' });
  });

  it('解析 query 参数', () => {
    const event = {
      httpMethod: 'GET',
      path: '/api/homeworks',
      headers: {},
      queryStringParameters: { date: '2026-07-07', child_id: 'abc' },
      body: null,
    };
    const result = parseGatewayEvent(event);
    expect(result.query).toEqual({ date: '2026-07-07', child_id: 'abc' });
  });

  it('headers 键名转小写', () => {
    const event = {
      httpMethod: 'GET',
      path: '/api/data',
      headers: { 'Authorization': 'Bearer xxx', 'Content-Type': 'application/json' },
      queryStringParameters: null,
      body: null,
    };
    const result = parseGatewayEvent(event);
    expect(result.headers['authorization']).toBe('Bearer xxx');
    expect(result.headers['content-type']).toBe('application/json');
  });

  it('无 headers 时返回空对象', () => {
    const event = {
      httpMethod: 'GET',
      path: '/api/ping',
      headers: null,
      queryStringParameters: null,
      body: null,
    };
    const result = parseGatewayEvent(event);
    expect(result.headers).toEqual({});
  });
});
```

- [ ] **Step 4: 运行测试验证失败**

```bash
cd PapaCheck.CloudFunc/papacheck-api && npx vitest run test/scf-handler.test.ts
```
Expected: FAIL（`Cannot find module '../scf-handler.js'`）

- [ ] **Step 5: 实现 parseGatewayEvent**

```typescript
// scf-handler.ts
export interface ScfEvent {
  httpMethod: string;
  path: string;
  headers: Record<string, string> | null;
  queryStringParameters: Record<string, string> | null;
  body: string | null;
  isBase64Encoded?: boolean;
}

export interface ParsedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: any;
}

export function parseGatewayEvent(event: ScfEvent): ParsedRequest {
  const headers: Record<string, string> = {};
  if (event.headers) {
    for (const [key, value] of Object.entries(event.headers)) {
      headers[key.toLowerCase()] = value;
    }
  }

  let body: any = null;
  if (event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    const contentType = headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    } else {
      body = raw;
    }
  }

  return {
    method: event.httpMethod,
    path: event.path,
    headers,
    query: event.queryStringParameters || {},
    body,
  };
}
```

- [ ] **Step 6: 运行测试验证通过**

```bash
cd PapaCheck.CloudFunc/papacheck-api && npx vitest run test/scf-handler.test.ts
```
Expected: PASS（5 个测试全过）

- [ ] **Step 7: 提交**

```bash
git add PapaCheck.CloudFunc/papacheck-api/scf-handler.ts PapaCheck.CloudFunc/papacheck-api/test/scf-handler.test.ts
git commit -m "feat: 实现 SCF handler 适配层 parseGatewayEvent"
```

---

### Task 4: 编写 PG 连接池全局复用模块

**Files:**
- Create: `PapaCheck.CloudFunc/papacheck-api/db.ts`

- [ ] **Step 1: 实现 PG 连接池全局复用**

```typescript
// db.ts
import { createDatabase } from './src/db/index.js';
import type { IDatabase } from './src/db/interfaces/index.js';

let dbInstance: IDatabase | null = null;

export async function getDb(): Promise<IDatabase> {
  if (!dbInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL 环境变量未设置');
    }
    dbInstance = await createDatabase({
      connectionString,
      max: 2,
      idleTimeoutMillis: 30000,
    });
  }
  return dbInstance;
}

/** 测试用：重置 db 实例 */
export function resetDbForTest(): void {
  dbInstance = null;
}
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
cd PapaCheck.CloudFunc/papacheck-api && npx tsc --noEmit
```
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add PapaCheck.CloudFunc/papacheck-api/db.ts
git commit -m "feat: 实现 PG 连接池全局复用（max:2, idle:30s）"
```

---

### Task 5: 改造 app.ts - 移除静态服务/邮件/运维/Swagger

**Files:**
- Create: `PapaCheck.CloudFunc/papacheck-api/app.ts` (改造自 `PapaCheck.Server/src/app.ts`)

- [ ] **Step 1: 复制 app.ts 到云函数目录**

```bash
Copy-Item PapaCheck.Server/src/app.ts PapaCheck.CloudFunc/papacheck-api/app.ts
```

- [ ] **Step 2: 移除 imports**

在 `PapaCheck.CloudFunc/papacheck-api/app.ts` 中删除以下 imports：

```typescript
// 删除这些 imports：
import { createReadStream } from 'fs';        // 静态文件服务用
import { readdir, stat, readFile } from 'fs/promises';  // 静态文件服务用
import { join } from 'path';                  // 静态文件服务用
import fastifyStatic from '@fastify/static';  // 静态文件服务
import swagger from '@fastify/swagger';       // Swagger 文档
import swaggerUi from '@fastify/swagger-ui';  // Swagger UI
import { EmailSync } from './email/index.js'; // 邮件同步
import type { HomeworkItem } from './email/ai.js';  // 邮件 AI 解析
import { OpsScheduler } from './ops/ops-scheduler.js';  // 运维调度器
import { opsRoutes } from './routes/ops-routes.js';     // 运维路由
```

- [ ] **Step 3: 改造 AppOptions 接口**

```typescript
export interface AppOptions {
  /** 启用 JWT Bearer 认证（生产环境设为 true） */
  enableAuth?: boolean;
  /** 速率限制配置，设为 false 可禁用 */
  rateLimit?: false | { max?: number; timeWindow?: string };
}
```

移除 `port` 和 `webDir` 字段（云函数不需要）。

- [ ] **Step 4: 改造 buildApp 函数签名**

```typescript
export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 10 * 1024 * 1024,  // 10MB
  });

  // ... 保留 rateLimit、cookie、auth middleware 注册

  // 删除：webDir 相关逻辑、OpsScheduler 启动、ensureSuperAdmin 启动调用
  // 改为：ensureSuperAdmin 在首次 API 调用时幂等执行（或建表时初始化）

  // ... 保留所有业务路由

  // 删除：/child /parent /login /app 重定向路由（静态托管处理）
  // 删除：fastifyStatic 注册块
  // 删除：Swagger 注册块
  // 删除：/api/email/* 路由
  // 删除：opsRoutes 注册

  return app;
}
```

- [ ] **Step 5: 移除静态文件相关路由**

删除以下路由块：
- `app.get('/child', ...)`
- `app.get('/parent', ...)`
- `app.get('/login', ...)`
- `app.get('/app', ...)`
- `app.register(fastifyStatic, ...)` 整块

- [ ] **Step 6: 移除邮件同步路由**

删除以下路由：
- `app.post('/api/email/config', ...)`
- `app.post('/api/email/sync', ...)`

以及相关的 `EmailSync` 实例化代码。

- [ ] **Step 7: 移除运维相关代码**

删除：
- `OpsScheduler` 实例化和启动
- `opsRoutes` 注册
- `/api/ops/*` 相关路由（如有）

- [ ] **Step 8: 移除 Swagger 注册**

删除：
- `await app.register(swagger, ...)`
- `await app.register(swaggerUi, ...)`

- [ ] **Step 9: 保留 `/api/download` 和 `/api/version` 路由**

这两个路由保留，仅改造实现：

```typescript
app.get('/api/version', { schema: versionSchema }, async (_request, reply) => {
  return sendJson(reply, { clientVersion: process.env.APK_VERSION || '1.5.2' });
});

app.get('/api/download', async (_request, reply) => {
  const version = process.env.APK_VERSION || '1.5.2';
  const cdnUrl = process.env.APK_CDN_URL
    || `https://6368-child-teacher-parent-d9aef9d2208-1253991009.tcb.qcloud.la/dist/PapaCheck-${version}.apk`;
  reply.redirect(302, cdnUrl);
});
```

- [ ] **Step 10: 验证 TypeScript 编译**

```bash
cd PapaCheck.CloudFunc/papacheck-api && npx tsc --noEmit
```
Expected: 无错误（如有 import 残留报错，清理对应 import）

- [ ] **Step 11: 提交**

```bash
git add PapaCheck.CloudFunc/papacheck-api/app.ts
git commit -m "refactor: 改造 app.ts 移除静态服务/邮件/运维/Swagger"
```

---

### Task 6: 编写云函数入口 index.ts

**Files:**
- Create: `PapaCheck.CloudFunc/papacheck-api/index.ts`

- [ ] **Step 1: 实现 main 函数**

```typescript
// index.ts
import { buildApp } from './app.js';
import { parseGatewayEvent, type ScfEvent } from './scf-handler.js';
import type { FastifyInstance } from 'fastify';

let appInstance: FastifyInstance | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (!appInstance) {
    appInstance = await buildApp({
      enableAuth: true,
      rateLimit: { max: 100, timeWindow: '1 minute' },
    });
    await appInstance.ready();
  }
  return appInstance;
}

export async function main(event: ScfEvent, context: any): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> {
  const app = await getApp();
  const { method, path, headers, query, body } = parseGatewayEvent(event);

  const response = await app.inject({
    method,
    url: path,
    headers,
    query,
    payload: body !== null ? JSON.stringify(body) : undefined,
  });

  return {
    statusCode: response.statusCode,
    headers: Object.fromEntries(
      Object.entries(response.headers).map(([k, v]) => [k, String(v)])
    ),
    body: response.payload,
  };
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd PapaCheck.CloudFunc/papacheck-api && npx tsc --noEmit
```
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add PapaCheck.CloudFunc/papacheck-api/index.ts
git commit -m "feat: 实现云函数入口 main（Fastify.inject 适配）"
```

---

### Task 7: 编写端到端集成测试

**Files:**
- Create: `PapaCheck.CloudFunc/papacheck-api/test/integration.test.ts`

- [ ] **Step 1: 写 Gherkin 行为注释**

```typescript
// test/integration.test.ts
// Feature: 云函数端到端集成
//   Scenario: GET /api/ping 通过 SCF handler
//     Given 云函数已初始化
//     When 调用 main({ httpMethod: 'GET', path: '/api/ping', ... })
//     Then 返回 statusCode=200, body 包含 {ok: true}
//   Scenario: POST /api/auth/login 无凭据返回 401
//     Given 云函数已初始化且 enableAuth=true
//     When 调用 main POST /api/data 无 Authorization header
//     Then 返回 statusCode=401
test('云函数端到端集成', () => {});
```

- [ ] **Step 2: 用 AskUserQuestion 向用户确认 Gherkin 场景**

- [ ] **Step 3: 写集成测试（用户确认后）**

```typescript
// test/integration.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { main } from '../index.js';
import type { ScfEvent } from '../scf-handler.js';

function makeEvent(overrides: Partial<ScfEvent> = {}): ScfEvent {
  return {
    httpMethod: 'GET',
    path: '/api/ping',
    headers: {},
    queryStringParameters: null,
    body: null,
    ...overrides,
  };
}

describe('云函数端到端集成', () => {
  it('GET /api/ping 返回 200', async () => {
    const result = await main(makeEvent({ path: '/api/ping' }));
    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.serverTime).toBeDefined();
  });

  it('GET /api/version 返回 clientVersion', async () => {
    process.env.APK_VERSION = '1.5.2';
    const result = await main(makeEvent({ path: '/api/version' }));
    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.clientVersion).toBe('1.5.2');
  });

  it('GET /api/download 返回 302 重定向', async () => {
    process.env.APK_VERSION = '1.5.2';
    const result = await main(makeEvent({ path: '/api/download' }));
    expect(result.statusCode).toBe(302);
    expect(result.headers.location).toContain('tcb.qcloud.la');
  });

  it('GET /api/data 无 Authorization 返回 401', async () => {
    const result = await main(makeEvent({ path: '/api/data' }));
    expect(result.statusCode).toBe(401);
  });

  it('未知路由返回 404', async () => {
    const result = await main(makeEvent({ path: '/api/nonexistent' }));
    expect(result.statusCode).toBe(404);
  });
});
```

注意：此测试需要 `DATABASE_URL` 环境变量指向测试数据库。在 CI 中需先运行 `setup-test-db.ps1`。

- [ ] **Step 4: 运行测试验证**

```bash
$env:DATABASE_URL="postgresql://papacheck***REDACTED***@localhost:5432/papacheck_test"
cd PapaCheck.CloudFunc/papacheck-api && npx vitest run test/integration.test.ts
```
Expected: 5 个测试通过（或因 DB 未就绪跳过，标记为 integration 测试）

- [ ] **Step 5: 提交**

```bash
git add PapaCheck.CloudFunc/papacheck-api/test/integration.test.ts
git commit -m "test: 新增云函数端到端集成测试（ping/version/download/auth）"
```

---

### Task 8: 删除弃用的测试文件

**Files:**
- Delete: 复制过来的 `test/email.test.ts`、`test/ai.test.ts`、`test/ops/` 目录

- [ ] **Step 1: 删除弃用功能的测试**

```bash
# 如果在 Task 2 中复制了测试目录，删除弃用功能的测试
Remove-Item PapaCheck.CloudFunc/papacheck-api/test/email.test.ts -ErrorAction SilentlyContinue
Remove-Item PapaCheck.CloudFunc/papacheck-api/test/ai.test.ts -ErrorAction SilentlyContinue
Remove-Item PapaCheck.CloudFunc/papacheck-api/test/ops -Recurse -ErrorAction SilentlyContinue
```

- [ ] **Step 2: 验证剩余测试通过**

```bash
cd PapaCheck.CloudFunc/papacheck-api && npx vitest run
```
Expected: 所有剩余测试通过

- [ ] **Step 3: 提交**

```bash
git add -A PapaCheck.CloudFunc/papacheck-api/test/
git commit -m "chore: 删除弃用功能的测试（email/ai/ops）"
```

---

### Task 9: 编译验证与最终全量测试

- [ ] **Step 1: TypeScript 编译**

```bash
cd PapaCheck.CloudFunc/papacheck-api && npm run build
```
Expected: 编译成功，`dist/` 目录生成

- [ ] **Step 2: 全量测试**

```bash
$env:DATABASE_URL="postgresql://papacheck***REDACTED***@localhost:5432/papacheck_test"
cd PapaCheck.CloudFunc/papacheck-api && npx vitest run
```
Expected: 所有测试通过

- [ ] **Step 3: 覆盖率检查**

```bash
cd PapaCheck.CloudFunc/papacheck-api && npx vitest run --coverage
```
Expected: 总体覆盖率 ≥ 85%

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: 云函数编译验证与全量测试通过"
```

---

## 完成标准

- [ ] `PapaCheck.CloudFunc/papacheck-api/` 目录结构完整
- [ ] `index.ts` 实现 `main` 函数（SCF handler）
- [ ] `scf-handler.ts` 实现 `parseGatewayEvent`，5 个单元测试通过
- [ ] `db.ts` 实现 PG 连接池全局复用
- [ ] `app.ts` 移除静态服务/邮件/运维/Swagger，保留 68 个业务 API
- [ ] 集成测试通过（ping/version/download/auth/404）
- [ ] TypeScript 编译无错误
- [ ] 全量测试通过，覆盖率 ≥ 85%

## 后续衔接

- 子计划 2（数据库迁移）配置 RLS 策略后，本云函数可连接 CloudBase PG
- 子计划 3（前端实时监听）依赖本云函数的 API 端点
- 子计划 6（网关配置）将本云函数暴露到 `chengdexy.cn/papacheck/api/`
