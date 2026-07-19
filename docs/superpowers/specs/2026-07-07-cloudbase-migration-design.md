# PapaCheck 迁移到腾讯云 CloudBase 设计文档

> **创建日期**：2026-07-07
> **状态**：设计已确认，待编写实施计划
> **决策来源**：brainstorming 会话（用户与 AI 共同确认）

> ⚠️ **实施方式已变更（2026-07-14 注记）**：本文档中的部分设计在实施阶段被推翻——实际落地为：① 数据同步采用**轻量版本戳短轮询**（默认 3 秒，变更才拉全量），而非 CloudBase PG 实时监听（watch() SDK v3 不兼容）；② 多租户隔离由**应用层 SQL**（WHERE tenant_id/child_id）实现，`cloudbase-rls.sql` 的 RLS 策略未在生产代码路径激活；③ tts-svc 为独立仓库维护的云函数，不在本仓库。以下正文保留原始设计意图，仅供历史参考。

---

---

## 一、迁移目标与动机

### 主要动机

**弃用阿里云 ECS 服务器**。所有当前在 ECS 上常驻运行的服务（Node.js 服务器、PostgreSQL、TTS Python 服务、Nginx）必须迁移或替换到 CloudBase。

### CloudBase 环境现状

| 项 | 值 |
|---|---|
| 环境 ID | `child-teacher-parent-d9aef9d2208` |
| 别名 | `child-teacher-parent` |
| Region | `ap-shanghai` |
| 套餐 | 个人版（`baas_personal`），已付费至 2027-07-03 |
| PostgreSQL | 已开通（实例 `postgres-9pagpv9i`，`max_connections=2048`） |
| 静态托管 | 已就绪（CDN 域名 `...tcloudbaseapp.com`） |
| 云存储 | 已就绪（CDN 域名 `6368-...tcb.qcloud.la`，APK 已用） |
| 网关自定义域名 | `chengdexy.cn`（certId `YvG6ZmNq`，HTTP+HTTPS） |
| 已有云函数 | `tts-svc`（Python3.10，TTS 已迁移）、`dictations-api`（另一个项目） |
| 已有路由 | `chengdexy.cn/dictations`（另一个项目，与 PapaCheck 共存） |

### 迁移决策汇总

| 项 | 决策 |
|----|------|
| 迁移策略 | ECS 彻底弃用，所有功能迁移或弃用 |
| 数据库 | CloudBase PG（保留 27 张表结构不变，以 init-pg-schema.sql 为准） |
| API | 单一 `papacheck-api` 云函数（Nodejs20.19）处理所有 `/papacheck/api/*` |
| 前端路径 | `chengdexy.cn/papacheck/` 子路径 |
| 认证 | 保留现有 JWT，spec 注明后续微信扫码登录（迁移后做） |
| 离线模式 | 迁移时同步弃用 |
| 数据推送 | CloudBase PG 实时监听（弃用轮询） |
| 邮件同步 | 弃用 |
| 运维调度器（备份/监控/告警） | 弃用（CloudBase PG 自带备份 + 腾讯云监控） |
| 超管 | 迁移家庭账号管理，弃用系统监控面板 |
| Swagger | 弃用 |
| Release 控制台 | 迁移（去 SSH，改 `tcb` CLI） |
| 数据 | 迁移现有生产数据 |
| TTS | 已迁移（`tts-svc` 云函数） |
| APK 下载 | 已用云存储，沿用 302 重定向方案 |

---

## 二、目标架构

### 架构图

```
                        ┌─────────────────────────────────┐
                        │     chengdexy.cn (CloudBase 网关) │
                        │     SSL 证书: YvG6ZmNq (已绑定)   │
                        └───────────────┬─────────────────┘
                                        │
            ┌───────────────────────────┼───────────────────────┐
            │                           │                       │
            ▼                           ▼                       ▼
   /papacheck/ (静态托管)      /papacheck/app/ (静态托管)   /papacheck/api/ (SCF)
   /papacheck/admin/ (静态)    /papacheck/login.html         → papacheck-api 云函数
   落地页 + React 管理面板     孩子端 HTML/CSS/JS             (Nodejs20.19, 单函数处理所有 API)
                                                              │
            ┌─────────────────────────────────────────────────┤
            │                                                 │
            ▼                                                 ▼
   /papacheck/api/speak (SCF)                    CloudBase PostgreSQL
   /papacheck/api/pregen-speech                  postgres-9pagpv9i
   → tts-svc 云函数 (Python3.10)                 27 张表 (迁移自 ECS PG)
                                                 + RLS 行级安全策略
            │
            ▼
   云存储 (6368-...tcb.qcloud.la)
   /dist/PapaCheck-x.y.z.apk
   (APK 下载, 已就绪)

   ┌─────────────────────────────────────────────────────────┐
   │  前端 ←→ CloudBase PG 实时监听 (app.rdb() / LISTEN)      │
   │  前端订阅 homeworks/settlement/points/notifications 变更  │
   │  弃用: pollServer 轮询 / SW / localforage / CRDT / 写队列 │
   └─────────────────────────────────────────────────────────┘
```

### 核心架构决策

1. **单一 API 云函数** `papacheck-api`：将现有 68 端点的 Fastify app 改造为 CloudBase 云函数。网关路由 `/papacheck/api/` → SCF，函数内部分发。保留现有 `app.ts` 的路由结构和 `IDatabase` 抽象，仅替换 HTTP 层（Fastify → CloudBase SCF handler）和移除静态文件服务。

2. **CloudBase PG + RLS**：执行现有 `init-pg-schema.sql` 建表，迁移生产数据。配置行级安全（RLS）策略，让前端实时订阅只能看到自己 `tenant_id` + `child_id` 的数据。后端云函数用 service role 绕过 RLS。

3. **实时监听替代轮询**：前端引入 `@cloudbase/js-sdk`，用 `app.rdb()` 订阅 PG 表变更。删除 `pollServer`/`sw.js`/`db.js`/`sync.js`/`crdt-sync.js`/`connection.js` 降级逻辑。写操作直接调云函数 API。

4. **路径前缀 `/papacheck/`**：所有路由统一加 `/papacheck` 前缀。前端 HTML 资源引用、API base URL、Android 默认地址全部更新。

5. **TTS 网关路由**：`tts-svc` 云函数已存在但无触发器。配置网关路由 `/papacheck/api/speak` 和 `/papacheck/api/pregen-speech` → `tts-svc` SCF。

6. **弃用项**：邮件同步、OpsScheduler、Swagger、CRDT 操作日志（保留表 schema 但停写）。CloudBase PG 自带备份，腾讯云控制台提供监控。

### 不变的部分

- 数据库 schema：27 张表结构完全不变
- 业务逻辑：作业/积分/商店/赏金/奖励箱/Buff/通知的所有业务规则不变
- 认证模型：JWT + access_codes + token_version + 超管，代码基本平移
- Android Flutter 主体：仅改默认连接地址和移除离线快照/写队列

---

## 三、网关路由与域名配置

### 域名现状

| 域名 | 类型 | 当前用途 |
|------|------|----------|
| `chengdexy.cn` | 自定义域名（已绑定，certId: YvG6ZmNq，HTTP+HTTPS） | 主域名，已用于 dictations 项目 |
| `child-teacher-parent-d9aef9d2208-1253991009.tcloudbaseapp.com` | 静态托管默认 CDN | 静态资源默认入口 |
| `child-teacher-parent-d9aef9d2208-1253991009.ap-shanghai.app.tcloudbase.com` | 网关默认 CDN | 网关默认入口 |

`chengdexy.cn` 已被 dictations 项目占用 `/dictations` 路径。PapaCheck 使用 `/papacheck` 前缀，两者共存于同一域名，互不冲突。

### 网关路由表（chengdexy.cn）

按最长前缀优先匹配：

| 路径 | 上游类型 | 上游资源 | 说明 |
|------|---------|---------|------|
| `/papacheck/api/speak` | SCF | `tts-svc` | TTS 语音合成 |
| `/papacheck/api/pregen-speech` | SCF | `tts-svc` | TTS 预生成 |
| `/papacheck/api/` | SCF | `papacheck-api` | 所有其他 API（含认证/作业/积分/商店/赏金/同步/通知等 60+ 端点） |
| `/papacheck/download/` | STATIC_STORE 或云存储 CDN 代理 | `/dist/` | APK 下载（302 重定向到云存储 CDN） |
| `/papacheck/admin/` | STATIC_STORE | `staticstore/papacheck/admin/` | React 管理面板 |
| `/papacheck/app/` | STATIC_STORE | `staticstore/papacheck/app/` | 孩子端（index.html + css + js） |
| `/papacheck/login.html` | STATIC_STORE | `staticstore/papacheck/login.html` | 登录页 |
| `/papacheck/` | STATIC_STORE | `staticstore/papacheck/` | 落地页（Vite 构建产物） |

### 静态托管文件结构

```
staticstore/papacheck/
├── index.html                    # 落地页入口（引用 /papacheck/assets/）
├── assets/                       # 落地页共享资源
│   ├── landing-xxxxxx.js
│   ├── landing-xxxxxx.css
│   ├── admin-xxxxxx.js           # 管理面板 bundle
│   └── admin-xxxxxx.css
├── imgs/mascot/                  # 落地页吉祥物图片
├── favicon.png
├── admin/
│   ├── index.html                # 管理面板入口（引用 /papacheck/admin/assets/）
│   └── assets/
│       ├── admin-xxxxxx.js
│       └── admin-xxxxxx.css
├── app/
│   ├── index.html                # 孩子端
│   ├── admin.html                # 管理端（旧版）
│   ├── login.html                # 登录页
│   ├── css/
│   │   ├── style.css
│   │   └── admin.css
│   ├── js/
│   │   ├── app.js
│   │   ├── admin.js
│   │   ├── api.js
│   │   ├── common.js
│   │   ├── cloudbase.js           # 新增：CloudBase SDK 初始化
│   │   ├── realtime.js            # 新增：实时监听管理器
│   │   └── big-screen.js
│   └── favicon.png
└── download/
    └── (APK 通过 302 重定向到云存储 CDN，不实际存放在静态托管)
```

### 前端资源路径适配

| 模块 | 当前路径 | 迁移后路径 |
|------|---------|-----------|
| PapaCheck.Web `index.html` | `/css/style.css` | `/papacheck/app/css/style.css` |
| PapaCheck.Web `admin.html` | `/css/admin.css` | `/papacheck/app/css/admin.css` |
| PapaCheck.Site `index.html` | `/assets/main-xxx.js` | `/papacheck/assets/main-xxx.js` |
| PapaCheck.Site `admin/index.html` | `/admin/assets/admin-xxx.js` | `/papacheck/admin/assets/admin-xxx.js` |
| API 调用（api.js） | `fetch('/api/data')` | `fetch('/papacheck/api/data')` |

**实现方式**：
- PapaCheck.Web：直接修改 HTML 中的路径引用（原生 HTML/CSS/JS，无构建工具）
- PapaCheck.Site：修改 Vite 配置 `base: '/papacheck/'`（落地页）和 `base: '/papacheck/admin/'`（管理面板）
- API base URL：`api.js` 中定义 `const API_BASE = '/papacheck/api'`

### CloudBase 网关 path rewrite

```json
{
  "Path": "/papacheck/api/",
  "UpstreamResourceType": "SCF",
  "UpstreamResourceName": "papacheck-api",
  "PathRewrite": { "Prefix": "/api/" },
  "EnablePathTransmission": true
}
```

- 请求 `chengdexy.cn/papacheck/api/data` → 云函数收到 `/api/data`
- 请求 `chengdexy.cn/papacheck/api/speak` → tts-svc 收到 `/api/speak`

### APK 下载路由

**方案 A（采用）**：云函数返回 302 重定向
- 路由 `/papacheck/api/download` → `papacheck-api` 云函数
- 云函数读环境变量 `APK_CDN_URL`，返回 302 重定向到 `https://6368-child-teacher-parent-d9aef9d2208-1253991009.tcb.qcloud.la/dist/PapaCheck-x.y.z.apk`
- 与现有 ECS 实现一致，与 Android `UpdateService` 现有逻辑兼容

### 路由与现有 dictations 的共存

```
chengdexy.cn/
├── /dictations              ← 已有，dictations 静态托管
├── /dictations/api/         ← 已有，dictations-api 云函数
├── /papacheck/              ← 新增，PapaCheck 落地页
├── /papacheck/admin/        ← 新增，React 管理面板
├── /papacheck/app/          ← 新增，孩子端 + 旧管理端
├── /papacheck/api/          ← 新增，papacheck-api 云函数
├── /papacheck/api/speak     ← 新增，tts-svc 云函数
└── /papacheck/api/pregen-speech ← 新增，tts-svc 云函数
```

---

## 四、API 云函数架构

### 云函数基本信息

| 项 | 值 |
|---|---|
| 函数名 | `papacheck-api` |
| Runtime | `Nodejs20.19` |
| 内存 | 512 MB |
| 超时 | 30s |
| 初始化超时 | 65s |
| Handler | `index.main` |
| 角色 | `TCB_QcsRole` |
| 触发器 | 网关触发（无 timer） |
| 环境变量 | `DATABASE_URL`、`JWT_SECRET`、`JWT_EXPIRES_IN`、`APK_CDN_URL`、`APK_VERSION`、`ENCRYPTION_KEY`、`TTS_PUBLISHABLE_KEY` |

### 入口适配：Fastify → CloudBase SCF Handler

保留现有 Fastify app（路由、Schema、业务逻辑全不动），注入"伪请求"将其转换为 Fastify 调用。

```typescript
// papacheck-api/index.ts (新增，云函数入口)
import Fastify from 'fastify';
import { buildApp } from './app.js';

const app = buildApp({
  enableAuth: true,
  rateLimit: { max: 100, timeWindow: '1 minute' }
});

export async function main(event: ScfEvent, context: ScfContext) {
  const { method, path, headers, query, body } = parseGatewayEvent(event);
  const response = await app.inject({
    method, url: path, headers, query, payload: body,
  });
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.payload,
  };
}
```

**关键点**：
- 使用 `app.inject()`（Fastify 内置测试工具）在云函数内调用 Fastify，**零修改**保留所有路由、Schema、中间件、错误处理
- 网关已做 path rewrite，`/papacheck/api/data` → 云函数收到 `/api/data`，Fastify 路由原样匹配
- 静态文件服务（`@fastify/static`）移除——前端走静态托管

### 需要从 app.ts 移除的部分

| 移除项 | 原因 |
|--------|------|
| `@fastify/static` + `webDir` 配置 | 前端走静态托管 |
| `/child` `/parent` `/login` `/app` 重定向路由 | 路径变更，由静态托管处理 |
| `OpsScheduler` 启动 | 运维调度器弃用 |
| `ensureSuperAdmin()` 启动时调用 | 改为云函数冷启动时幂等检查 |
| Swagger `/docs` 路由 + `@fastify/swagger` + `@fastify/swagger-ui` | 弃用 |
| 邮件同步相关路由 `/api/email/*` | 弃用 |
| 附件下载相关逻辑 | 随邮件同步一并弃用 |

### 保留的部分

| 保留项 | 说明 |
|--------|------|
| 68 个业务 API 端点 | 全保留，仅路径前缀由网关处理 |
| `IDatabase` 接口 + `PostgresAdapter` | 数据库层完全不变，仅 `DATABASE_URL` 指向 CloudBase PG |
| JWT 认证中间件 + access_codes + token_version | 完全保留 |
| `authRoutes` / `adminRoutes` / `superAdminRoutes` | 完全保留 |
| `rateLimit` 配置 | 保留，与 CloudBase 网关 QPS（500）协同 |
| `/api/sync/*` 端点 | **代码保留但前端不再调用**（弃用离线后无意义）。可作为兼容兜底 |

### 数据库连接管理

云函数是无状态的，每次调用可能新建 PG 连接。解决方案：

1. **全局变量复用**：在云函数入口外声明 `let dbInstance: IDatabase | null = null`，首次调用初始化，后续调用复用
2. **连接池配置**：`pg.Pool` 配置 `max: 2`，`idleTimeoutMillis: 30000`
3. **冷启动成本**：首次调用约 200-500ms（PG 连接建立）

```typescript
let dbInstance: IDatabase | null = null;

export async function getDb(): Promise<IDatabase> {
  if (!dbInstance) {
    dbInstance = await createDatabase({
      connectionString: process.env.DATABASE_URL!,
      max: 2,
      idleTimeoutMillis: 30000,
    });
  }
  return dbInstance;
}
```

### 文件结构

```
PapaCheck.CloudFunc/        ← 新目录（云函数源码）
├── papacheck-api/
│   ├── index.ts            # SCF 入口
│   ├── app.ts              # 从 PapaCheck.Server/src/app.ts 改造
│   ├── db.ts               # PG 连接池全局复用
│   ├── scf-handler.ts      # event 解析 + Fastify.inject 适配层
│   ├── package.json
│   ├── tsconfig.json
│   └── src/                # 直接复用 PapaCheck.Server/src/ 的业务代码
│       ├── admin/
│       ├── auth/
│       ├── crdt/           # 保留代码（前端不再调用，但保留兜底）
│       ├── db/             # IDatabase + PostgresAdapter 完全复用
│       ├── errors.ts
│       └── routes/         # ops-routes 移除（运维弃用）
├── tts-svc/                # 已存在，不改动
└── README.md
```

### 测试策略

| 层级 | 方法 |
|------|------|
| 单元测试 | 复用现有 `PapaCheck.Server/test/` 的测试（业务逻辑不变） |
| 集成测试 | 新增 `papacheck-api/test/scf-handler.test.ts`：mock `ScfEvent`，验证 Fastify.inject 适配 |

---

## 五、数据库与数据迁移

### 数据库选型

| 项 | 值 |
|---|---|
| 实例 | `postgres-9pagpv9i`（CloudBase 内置 PG） |
| Region | `ap-shanghai` |
| Schema | `public`（默认） |
| `max_connections` | 2048（实测） |
| 连接串来源 | CloudBase PG 控制台 → 写入云函数环境变量 `DATABASE_URL` |

### Schema 迁移策略

**完全复用现有 `init-pg-schema.sql`**：27 张表结构不变，包括多租户、业务表、CRDT 表、审计表。

**执行步骤**：
1. 初始化 CloudBase PG 上下文（`managePgDatabase(action=init)`）
2. 通过 `managePgDatabase(action=execute, confirm=true)` 执行 `init-pg-schema.sql`
3. 执行 `migrate-access-code-model.sql` 和 `migrate-auth-v2.sql`
4. 验证：`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'`（应为 26）

### 数据迁移方案

**pg_dump + pg_restore 离线迁移**：

```bash
# 步骤1: ECS 上导出
ssh root@123.57.129.243 "sudo -u papacheck pg_dump -Fc -d papacheck -f /tmp/papacheck.dump"
scp root@123.57.129.243:/tmp/papacheck.dump /tmp/

# 步骤2: 恢复到 CloudBase PG
pg_restore -d "postgresql://<user>:<pass>@<cloudbase-pg-host>:<port>/postgres" \
  --no-owner --no-acl --clean --if-exists \
  /tmp/papacheck.dump

# 步骤3: 行数校验
psql -d "postgresql://..." -c "SELECT 'homeworks' as t, COUNT(*) FROM homeworks UNION ALL ..."
```

**注意事项**：
- `--no-owner --no-acl` 跳过角色/权限冲突
- `--clean --if-exists` 兜底重复执行
- UUID 主键、partial unique index、FK 约束随 dump 一并迁移

### 行级安全（RLS）策略

**目的**：前端通过 CloudBase SDK 实时订阅 PG 表时，只能看到自己 `tenant_id` + `child_id` 的数据。

**启用 RLS 的表**（14 张前端订阅表）：

```sql
ALTER TABLE homeworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_settlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE points ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_box ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounty_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounty_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounty_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_buffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE efficiency_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE free_time_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
```

**策略示例**：

```sql
-- RLS 从 JWT payload 读取 tenant_id/child_id
CREATE POLICY tenant_isolation ON homeworks
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');

CREATE POLICY child_isolation ON homeworks
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');
```

**双角色模型**：

| 角色 | 用途 | RLS 行为 |
|------|------|----------|
| `anon` / `authenticated`（前端 SDK 用 publishable key） | 前端实时订阅 | RLS 强制隔离 |
| `service_role`（云函数用 secret key） | 云函数 API 读写 | 绕过 RLS，全表访问 |

### crdt_operations 表处理

保留 schema，停止写入。表结构保留（兼容历史数据查询），云函数 `/api/sync/*` 端点代码保留作为兜底，前端弃用 CRDT 后不再写入此表。

### 连接数消耗模型

**实时监听方案**（每个前端客户端 1 个长连接）：

| 家庭规模 | 同时在线端数 | 实时连接数 | 占用率 |
|----------|------------|-----------|--------|
| 1 家庭 | 2 端 | 2 | 0.1% |
| 50 家庭 | 100 端 | 100 | 4.9% |
| 500 家庭 | 1000 端 | 1000 | 48.8% |
| 1000 家庭 | 2000 端 | 2000 | 97.7% ⚠️ |

**云函数 API 调用**（连接池 max:2 per 实例）：

| 并发场景 | 云函数实例数 | 数据库连接数 |
|---------|------------|------------|
| 日常低并发 | 1-2 | 2-4 |
| 高峰期 | 5-10 | 10-20 |

**结论**：实时监听方案在 CloudBase PG `max_connections=2048` 的实际配置下完全可行。500 家庭（1000 用户）以内，连接数完全无压力。

---

## 六、前端实时监听改造

### 现状：轮询机制

```
前端 pollServer (5s 递归 setTimeout)
  ├─ GET /api/data (全量拉取)
  ├─ 更新 UI (innerHTML 重建)
  └─ 离线降级 → localforage 缓存 + Android 写队列重放
```

涉及文件：`api.js`、`app.js`、`admin.js`、`sync.js`、`crdt-sync.js`、`connection.js`、`db.js`、`sw.js`、Android `offline_snapshot_service.dart` + Kotlin 写队列桥接。

### 目标：CloudBase PG 实时监听

```
前端订阅 (app.rdb() 长连接)
  ├─ homeworks 表变更 → 自动推送 delta
  ├─ daily_settlement 表变更 → 自动推送
  ├─ ... 共 14 张业务表订阅

写操作：
  └─ 直接调云函数 API (PUT/PATCH/DELETE) → 服务端写入 PG → 实时推送给所有订阅者
```

### CloudBase JS SDK 集成

**新增文件** `PapaCheck.Web/js/cloudbase.js`：

```javascript
import cloudbase from '@cloudbase/js-sdk';

const app = cloudbase.init({
  env: 'child-teacher-parent-d9aef9d2208',
});

const db = app.rdb();

export async function signInWithJwt(jwtToken) {
  await app.auth({ persistence: 'session' }).signInWithJwt(jwtToken);
}

export function subscribeTable(tableName, callback) {
  return db.table(tableName)
    .where('tenant_id', 'eq', getCurrentTenantId())
    .watch(callback, { onChange: callback, onError: console.error });
}
```

**新增 `PapaCheck.Web/package.json`**（原项目无）：

```json
{
  "dependencies": {
    "@cloudbase/js-sdk": "^3.0.0"
  }
}
```

### 订阅清单

| 表名 | 触发场景 | 前端处理 |
|------|---------|---------|
| `homeworks` | 作业增删改 | 重新渲染孩子端作业列表 + 管理端作业表格 |
| `daily_settlement` | 评级/结算 | 弹出结算页 + 管理端统计更新 |
| `points` | 积分变动 | 更新积分显示 |
| `points_history` | 积分历史 | 追加历史记录 |
| `shop_items` | 商品变动 | 刷新商店页 |
| `redemptions` | 兑换记录 | 刷新兑换列表 |
| `reward_box` | 奖励变动 | 刷新奖励箱 |
| `bounty_tasks` | 赏金任务 | 刷新赏金列表 |
| `bounty_submissions` | 提交记录 | 管理端审核刷新 |
| `bounty_completions` | 完成记录 | 刷新完成列表 |
| `active_buffs` | Buff 变动 | 更新 Buff 状态 |
| `efficiency_history` | 效率记录 | 管理端图表更新 |
| `free_time_tasks` | 自由时间 | 刷新自由时间页 |
| `notifications` | 通知推送 | 弹出通知 + TTS 播报 |

**封装订阅管理器** `js/realtime.js`（新增）：

```javascript
export class RealtimeManager {
  constructor() {
    this.subscriptions = new Map();
  }

  async start(jwtToken, tenantId, childId) {
    await signInWithJwt(jwtToken);
    this.subscribe('homeworks', this.onHomeworksChange);
    this.subscribe('daily_settlement', this.onSettlementChange);
    // ... 14 张表
  }

  async loadInitialData() {
    return await fetch('/papacheck/api/data', { headers: getAuthHeaders() });
  }

  stop() {
    this.subscriptions.forEach(unsub => unsub());
    this.subscriptions.clear();
  }
}
```

### 需要删除的文件/逻辑

| 文件 | 删除内容 | 原因 |
|------|---------|------|
| `sw.js` | **整个文件删除** | 弃用 Service Worker |
| `db.js` | **整个文件删除** | localforage 缓存不再需要 |
| `sync.js` | **整个文件删除** | 离线同步合并逻辑不再需要 |
| `crdt-sync.js` | **整个文件删除** | CRDT 客户端不再需要 |
| `connection.js` | **整个文件删除** | 在线/离线状态机不再需要 |
| `api.js` | 删除 `pollServer` / `_requestWithStrategy` / `optimisticWrite` / `pushOperation` / `reconnecting` 降级 | 实时监听替代轮询 |
| `app.js` | 删除 `startPoll` / `stopPoll` / 轮询调度；删除离线遮罩 | 改为 `RealtimeManager.start()` |
| `admin.js` | 删除管理端轮询逻辑 | 改为 `RealtimeManager` 订阅 |
| `big-screen.js` | 删除轮询触发 | 由 `RealtimeManager` 回调驱动 |
| Android `offline_snapshot_service.dart` | **整个文件删除** | 离线快照不再需要 |
| Android `cache_clear_helper.dart` | **整个文件删除** | 缓存清理逻辑简化 |
| Android Kotlin 写队列桥接（Room + WorkManager + OkHttp） | **整个文件删除** | 原生写队列不再需要 |
| Android `main.dart` | 删除离线快照加载 + 写队列注入逻辑 | WebView 直接加载在线页面 |

### 保留并改造的核心模块

| 文件 | 改造内容 |
|------|---------|
| `api.js` | 保留 `fetch` 封装 + `getAuthHeaders` + 业务 API 方法；删除轮询和离线策略 |
| `app.js` | 保留 UI 渲染 + 事件处理；初始化时 `loadInitialData()` + `RealtimeManager.start()` |
| `admin.js` | 同 app.js，管理端 UI + 实时订阅 |
| `big-screen.js` | 保留所有 UI 渲染函数，由 RealtimeManager 回调触发 |
| `common.js` | 保留共享工具（escapeHtml / SW 注册移除） |
| Android `main.dart` | 保留 WebView 容器 + 版本检测 + APK 更新；默认地址改为 `chengdexy.cn/papacheck/app/` |
| Android `update_service.dart` | 保留 APK 下载 + 安装；URL 改为 `/papacheck/api/download` |
| Android `config_service.dart` | 保留 URL 配置；默认值更新 |

### 数据流对比

**改造前**（轮询）：
```
用户操作 → PUT /api → 服务端写入 PG → 5s 后 pollServer 拉取 → UI 更新
离线 → 写入 Android 队列 → 联网重放 → 服务端合并
```

**改造后**（实时监听）：
```
用户操作 → PUT /api → 服务端写入 PG → CloudBase 推送 delta → UI 增量更新
永远在线（无离线降级）
```

### 首次加载策略

实时订阅只推送**变更**，首次进入页面仍需全量快照：

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
  await realtime.start(token, data.tenant_id, data.child_id);
}
```

### TTS 通知触发

原 `pollServer` 中检测新通知并 TTS 播报。改造后由 `notifications` 表订阅回调触发：

```javascript
onNotificationsChange(change) {
  const newNotif = change.new;
  if (newNotif && !change.old) {
    Voice.speak(newNotif.text);
  }
}
```

### Android 端改造

| 文件 | 改造 |
|------|------|
| `lib/main.dart` | 默认 URL 改为 `https://chengdexy.cn/papacheck/app/`；删除离线快照加载；删除 JavaScriptChannel 写队列桥接 |
| `lib/services/update_service.dart` | APK 下载 URL 改为 `/papacheck/api/download`；版本检测 URL 改为 `/papacheck/api/version` |
| `lib/services/config_service.dart` | 默认配置更新；删除离线快照存储相关方法 |
| `lib/services/offline_snapshot_service.dart` | **删除** |
| `lib/services/cache_clear_helper.dart` | **删除** |
| `android/app/src/main/kotlin/.../MainActivity.kt` | 删除 Room 数据库 + WorkManager + OkHttp 写队列桥接代码 |
| `lib/widgets/connect_failed_dialog.dart` | 保留 |
| `lib/widgets/setup_page.dart` | 保留 |

### CloudBase PG 实时监听限制

| 限制 | 值 | 影响 |
|------|---|------|
| 并发连接数 | 2048 | 500 家庭（1000 用户）以内无压力 |
| 推送延迟 | <1s（PG LISTEN/NOTIFY） | 远优于 5s 轮询 |
| 成本 | 长连接不计入云函数调用 | 远优于轮询方案的 103 万次/月调用 |

---

## 七、认证、APK 下载与 Release 控制台

### 一、JWT 认证系统迁移

#### 保留现状

现有 JWT 认证体系完全平移到 CloudBase 云函数，代码基本不变：

| 组件 | 当前位置 | 迁移后位置 | 改动 |
|------|---------|-----------|------|
| `auth/middleware.ts` | PapaCheck.Server/src/auth/ | papacheck-api/src/auth/ | 无 |
| `auth/jwt.ts` | 同上 | 同上 | 无 |
| `auth/routes.ts` | 同上 | 同上 | 无 |
| `auth/super-admin.ts` | 同上 | 同上 | 无 |
| `auth/super-admin-routes.ts` | 同上 | 同上 | 无 |
| `auth/types.ts` | 同上 | 同上 | 无 |
| `access_codes` 表 + `users` 表 + `children` 表 | PostgreSQL | CloudBase PG | schema 不变 |

#### 关键配置项

| 项 | 值 | 来源 |
|---|---|---|
| `JWT_SECRET` | 加密随机串 | 写入云函数环境变量（与 ECS 不同） |
| `JWT_EXPIRES_IN` | `30d` | 沿用现有 |
| `DATABASE_URL` | CloudBase PG 连接串 | CloudBase 控制台 |
| `ENCRYPTION_KEY` | access_code 哈希密钥 | 写入云函数环境变量 |
| `TTS_PUBLISHABLE_KEY` | 前端实时监听 + SDK 认证用 | 已在 tts-svc 云函数 |

#### CloudBase SDK 认证对齐（实时监听用）

**方案 A（采用）：JWT 直通 + 自定义 RLS**

```javascript
const { token, tenant_id, child_id, role } = await login(email, password);
await app.auth({ persistence: 'session' }).signInWithJwt(token);

-- RLS 策略从 JWT payload 读取
CREATE POLICY tenant_isolation ON homeworks
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
```

保留现有 JWT 不变，CloudBase SDK 用 `signInWithJwt` 接受业务 JWT，RLS 策略从 `request.jwt.claims` 读取 tenant_id/child_id。

**CloudBase JWT 配置**：在 CloudBase 控制台「环境设置 → 数据库 → JWT 配置」中，将 JWT 算法（HS256）和密钥（与云函数环境变量 `JWT_SECRET` 相同的值）配置到 CloudBase PG。这样 CloudBase PG 在收到前端实时订阅请求时，会自动验证 JWT 签名，并将 payload 注入到 `request.jwt.claims` 会话变量，RLS 策略即可读取。

**JWT Payload 必须包含的字段**：
- `tenant_id`（UUID 字符串）
- `child_id`（UUID 字符串，可为空）
- `role`（`parent`/`child`/`admin`/`user`）

现有 JWT 已包含这些字段（见 `auth/jwt.ts`），无需修改。

#### 后续改进计划：微信扫码登录

> **微信扫码登录**（迁移之后做）：
> 1. 在 CloudBase 控制台配置微信开放平台 AppID/Secret
> 2. 前端引入 CloudBase 微信扫码登录组件
> 3. 微信登录成功后获取 CloudBase JWT
> 4. 云函数新增 `/api/auth/wechat-exchange` 端点：用 CloudBase JWT 换取业务 JWT（关联现有 users 表）
> 5. 前端用业务 JWT 调 API + 注入 CloudBase SDK
> 6. access_codes 登录方式保留作为备选

### 二、APK 下载迁移

#### 现状（已部分迁移）

当前 ECS 上：
- `/api/version` 读环境变量 `PAPACHECK_CLIENT_VERSION` 返回版本号
- `/api/download` 302 重定向到 CloudBase CDN

#### 迁移后实现

**完全沿用现有机制**，仅改路径前缀：

```typescript
app.get('/api/version', async (_request, reply) => {
  return { clientVersion: process.env.APK_VERSION || '1.5.2' };
});

app.get('/api/download', async (_request, reply) => {
  const version = process.env.APK_VERSION || '1.5.2';
  const cdnUrl = process.env.APK_CDN_URL
    || `https://6368-child-teacher-parent-d9aef9d2208-1253991009.tcb.qcloud.la/dist/PapaCheck-${version}.apk`;
  reply.redirect(302, cdnUrl);
});
```

**云函数环境变量**：

| 变量 | 值 |
|------|---|
| `APK_VERSION` | `1.5.2`（或最新版本号） |
| `APK_CDN_URL` | `https://6368-child-teacher-parent-d9aef9d2208-1253991009.tcb.qcloud.la/dist/PapaCheck-1.5.2.apk` |

#### Android 端改造

```dart
// lib/services/update_service.dart
static const String _versionUrl = 'https://chengdexy.cn/papacheck/api/version';
static const String _downloadUrl = 'https://chengdexy.cn/papacheck/api/download';
```

仅改 URL 前缀，逻辑完全不变。

### 三、Release 控制台迁移

#### 现状

`PapaCheck.Release/` 提供四子命令：`build-apk`、`cloud`、`site`、`serve`。

#### 弃用 ECS 后的改造

| 子命令 | 当前 | 改造后 |
|--------|------|--------|
| `build-apk --publish` | Flutter 构建 + 上传 CloudBase 存储 + SSH 更新 ECS + 重启 systemd | Flutter 构建 + 上传 CloudBase 存储 + `tcb fn update` 更新云函数环境变量 |
| `cloud` | SSH 上传 dist/ 到 ECS + 重启 | **删除**（改为 `tcb fn deploy papacheck-api`） |
| `site` | Vite 构建 + tar + SSH 上传 ECS | Vite 构建 + `tcb hosting deploy` 上传到 `/papacheck/` |
| `serve` | Web 控制台 + SSE | 保留（仅改后端调用） |

#### 新增子命令

| 子命令 | 用途 |
|--------|------|
| `fn` | 部署 `papacheck-api` 云函数：`tcb fn deploy papacheck-api --envId child-teacher-parent-d9aef9d2208` |

#### 改造后的发布流程

```bash
# 一键完整发布
npx tsx release.ts all --env prod

# 执行步骤：
# 1. cd PapaCheck.Site && npm run build  (Vite 构建，base=/papacheck/)
# 2. tcb hosting deploy dist/ --papacheck  (上传静态托管)
# 3. cd PapaCheck.Web && 打包到 dist/  (原生 HTML/CSS/JS，无构建)
# 4. tcb hosting deploy dist/ --papacheck/app/  (上传孩子端)
# 5. cd PapaCheck.CloudFunc/papacheck-api && npm run build  (tsc 编译)
# 6. tcb fn deploy papacheck-api  (部署云函数)
# 7. cd PapaCheck.Android && flutter build apk  (构建 APK)
# 8. tcb storage objects upload ...PapaCheck-x.y.z.apk --dist/  (上传云存储)
# 9. tcb fn update papacheck-api --env APK_VERSION=x.y.z  (更新版本号)
```

#### `cloud-publish.ts` 改造

```typescript
export async function deployCloudFunction(env: 'prod' | 'preview'): Promise<void> {
  const steps = [
    { name: '编译云函数', cmd: 'npm run build', cwd: 'PapaCheck.CloudFunc/papacheck-api' },
    { name: '部署云函数', cmd: `tcb fn deploy papacheck-api --envId ${ENV_ID}` },
    { name: '更新版本号', cmd: `tcb fn update papacheck-api --env APK_VERSION=${getVersion()}` },
  ];
  await executeSteps(steps);
}

export async function deployStaticHosting(env: 'prod' | 'preview'): Promise<void> {
  const steps = [
    { name: '构建落地页', cmd: 'npm run build', cwd: 'PapaCheck.Site' },
    { name: '上传落地页', cmd: `tcb hosting deploy dist/ --path /papacheck/` },
    { name: '构建孩子端', cmd: 'node scripts/build-web.js', cwd: '.' },
    { name: '上传孩子端', cmd: `tcb hosting deploy dist/ --path /papacheck/app/` },
  ];
  await executeSteps(steps);
}
```

#### `site-publish.ts` 改造

```typescript
export async function publishSite(): Promise<void> {
  await runCommand('npm', ['run', 'build'], { cwd: 'PapaCheck.Site' });
  await runCommand('tcb', ['hosting', 'deploy', 'dist/', '--path', '/papacheck/']);
}
```

#### PapaCheck.Site Vite 配置改造

```typescript
// PapaCheck.Site/vite.config.ts
export default defineConfig({
  base: '/papacheck/',
  build: { outDir: 'dist' },
  plugins: [
    adminBaseRewrite({ base: '/papacheck/admin/' }),
  ],
});
```

#### 测试改造

| 测试文件 | 改造 |
|---------|------|
| `build-apk.test.ts` | 保留；`--publish` 部分改为 mock `tcb` 命令 |
| `cloud-publish.test.ts` | 改造：mock `tcb fn deploy` 替代 SSH |
| `site-publish.test.ts` | 改造：mock `tcb hosting deploy` 替代 tar + SSH |
| `executor.test.ts` | 保留 |
| `reset-test-db.test.ts` | 保留 |

### 四、超管管理面板改造

#### 迁移范围

| 现有页面 | 是否迁移 | 说明 |
|---------|---------|------|
| `AuthView`（登录/注册） | ✅ 迁移 | 完整保留 |
| `LoginForm` / `RegisterForm` / `SuperLoginForm` | ✅ 迁移 | 完整保留 |
| `Dashboard`（家庭管理） | ✅ 迁移 | 完整保留 |
| `MemberTable` / `AddMemberForm` / `TenantTable` | ✅ 迁移 | 完整保留 |
| `SystemHealth`（系统健康监控） | ❌ 不迁移 | 弃用（CloudBase 控制台接管） |
| `BrandHeader` | ✅ 迁移 | 完整保留 |
| `Toast` / `Modal` / `LoadingSpinner` | ✅ 迁移 | 完整保留 |

#### 改造点

1. **API base URL**：`useApi` hook 中的 `fetch('/api/...')` 改为 `fetch('/papacheck/api/...')`
2. **资源路径**：Vite `base: '/papacheck/admin/'`
3. **删除 SystemHealth 页面**：从 `App.tsx` 路由中移除
4. **超管 API 端点**：`/api/super-admin/*` 保留，云函数 `papacheck-api` 完整实现

---

## 八、测试策略

### 测试分层

| 层级 | 范围 | 工具 | 目标 |
|------|------|------|------|
| **单元测试** | 云函数业务逻辑、SCF handler 适配、前端工具函数 | Vitest | 复用现有 609 测试 + 新增适配层测试 |
| **集成测试** | 云函数 ↔ CloudBase PG、RLS 策略、实时监听 | Vitest + MSW | 验证数据流端到端正确 |
| **前端测试** | RealtimeManager、api.js、app.js/admin.js 改造 | Vitest + jsdom | 覆盖实时订阅 + UI 渲染 |
| **Android 测试** | Flutter 单元、Widget 测试 | flutter test | 验证 URL 改造 + 离线模块删除 |
| **端到端** | 完整流程验证 | 手动 + Playwright（可选） | 部署后冒烟测试 |

### 复用现有测试

| 测试类别 | 现有数量 | 复用情况 |
|---------|---------|---------|
| 业务逻辑（api/auth/admin/crdt 等） | ~580 | ✅ 直接复用 |
| 数据库层（postgres-adapter 等） | ~20 | ✅ 复用，仅改 `DATABASE_URL` |
| 邮件同步 | ~9 | ❌ 删除 |
| 运维调度（ops-scheduler） | ~5 | ❌ 删除 |

### 新增测试

| 测试文件 | 内容 | 数量 |
|---------|------|------|
| `papacheck-api/test/scf-handler.test.ts` | SCF event 解析 + Fastify.inject 适配 | ~10 |
| `papacheck-api/test/rls.test.ts` | RLS 策略验证 | ~8 |
| `PapaCheck.Web/js/__tests__/realtime.test.js` | RealtimeManager 订阅/回调 | ~12 |
| `PapaCheck.Web/js/__tests__/api-no-poll.test.js` | api.js 移除轮询后的请求封装 | ~8 |
| `PapaCheck.Web/js/__tests__/app-realtime.test.js` | app.js RealtimeManager 集成 | ~6 |
| Android `test/services/config_service_test.dart` | URL 默认值更新 | +2 |
| Android `test/main_no_offline_test.dart` | 离线快照/写队列已删除 | +4 |
| Release `__tests__/fn-deploy.test.ts` | tcb fn deploy 流程 | ~5 |
| Release `__tests__/hosting-deploy.test.ts` | tcb hosting deploy 流程 | ~5 |

### 测试数据库

| 环境 | 数据库 | 用途 |
|------|--------|------|
| 本地开发 | 本地 PostgreSQL 16（`papacheck_test`） | 单元测试 + 集成测试 |
| 云函数测试 | CloudBase PG（独立 schema `test`） | RLS 策略验证 + 实时监听测试 |
| 生产 | CloudBase PG（`public` schema） | 生产数据 |

### 覆盖率目标

- 总体 ≥ 85%
- services/ 层 ≥ 90%
- state/ 层 ≥ 85%

---

## 九、切换方案与回滚预案

### 阶段划分

```
阶段1: 准备 (1-2 天)
  ├─ 建表 + RLS 策略
  ├─ 数据预迁移
  └─ 云函数部署 (不暴露)

阶段2: 验证 (1-2 天)
  ├─ 端到端测试 (CloudBase 内部 URL)
  ├─ Android 联调
  └─ 修复问题

阶段3: 切换 (< 30 分钟)
  ├─ 增量同步数据
  ├─ 配置网关路由
  └─ Android APK 推送

阶段4: 观察 (24-48 小时)
  ├─ 监控错误日志
  └─ 用户反馈

阶段5: ECS 下线 (切换后 1 周)
  ├─ 确认无回滚需求
  ├─ 停止 ECS systemd 服务
  └─ 释放 ECS 资源
```

### 阶段1：准备

**步骤1.1：CloudBase PG 建表**

```bash
managePgDatabase(action=execute, sql=<init-pg-schema.sql 内容>, confirm=true)
managePgDatabase(action=execute, sql=<migrate-access-code-model.sql 内容>, confirm=true)
managePgDatabase(action=execute, sql=<migrate-auth-v2.sql 内容>, confirm=true)
```

验证：`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'` → 应为 26

**步骤1.2：RLS 策略配置**

启用 RLS（14 张业务表）+ 创建策略（每张表 2 条：tenant 隔离 + child 隔离）。

**步骤1.3：数据预迁移**

```bash
ssh root@123.57.129.243 "sudo -u papacheck pg_dump -Fc -d papacheck -f /tmp/papacheck.dump"
scp root@123.57.129.243:/tmp/papacheck.dump /tmp/
pg_restore -d "<CloudBase PG 连接串>" --no-owner --no-acl --clean --if-exists /tmp/papacheck.dump
```

**步骤1.4：云函数部署**

```bash
cd PapaCheck.CloudFunc/papacheck-api
node build.mjs
# ⚠️ 必须 --dir dist（编译产物目录），不是 --dir .（函数根目录），否则入口找不到
tcb fn deploy papacheck-api --dir dist --force --env-id child-teacher-parent-d9aef9d2208
```

> **⚠️ 实际部署注意事项（2026-07-14 验证，原命令有坑）**
> - 部署命令必须带 `--dir dist`：CloudBase 在指定目录根找 `index.js` 入口，编译产物在 `dist/index.js`，用 `--dir .` 会持续 `FUNCTION_INVOCATION_FAILED`。
> - **JWT 密钥不要依赖 CLI 注入**：`tcb fn deploy` 只首次创建时应用 envVariables，`tcb config update fn` 报成功但 `JWT_SECRET` 等不落盘。生产改用随包 `dist/jwt.secret` 文件（`build.mjs` 生成，`jwt.ts` 优先读取），密钥跨冷启动稳定。
> - **SCF 的 `/data` 为只读文件系统**：模块加载期禁止 `writeFileSync('/data/...')`，否则 `EROFS` 使入口 `exports.main` 未赋值而崩溃。

**步骤1.5：静态托管部署**

```bash
cd PapaCheck.Site && npm run build  # base=/papacheck/
tcb hosting deploy dist/ --path /papacheck/

cd PapaCheck.Web
tcb hosting deploy . --path /papacheck/app/
```

### 阶段2：验证

**步骤2.1：内部 URL 端到端测试**

使用 CloudBase 默认域名测试：
```
https://child-teacher-parent-d9aef9d2208-1253991009.ap-shanghai.app.tcloudbase.com/papacheck/api/ping
```

验证清单：
- [ ] `GET /papacheck/api/ping` 返回 `{ok: true, serverTime: ...}`
- [ ] `POST /papacheck/api/auth/login` 登录成功
- [ ] `GET /papacheck/api/data` 返回完整数据
- [ ] `PUT /papacheck/api/homeworks` 写入成功
- [ ] 实时监听：前端订阅收到变更推送
- [ ] TTS：`GET /papacheck/api/speak` 返回 MP3
- [ ] APK 下载：`GET /papacheck/api/download` 302 重定向
- [ ] RLS：用 child A 的 JWT 订阅，看不到 child B 的数据

**步骤2.2：Android 联调**

构建测试 APK，默认 URL 改为 CloudBase 内部域名，安装到测试设备验证。

**步骤2.3：问题修复**

如发现 bug，在云函数代码中修复后重新部署：
```bash
cd PapaCheck.CloudFunc/papacheck-api
npm run build && tcb fn deploy papacheck-api
```

### 阶段3：切换（< 30 分钟）

**步骤3.1：增量数据同步（停写窗口）**

选择凌晨低峰期（02:00-02:30）：

```bash
# 1. ECS 设置维护页
ssh root@123.57.129.243 "echo 'maintenance' > /opt/papacheck/maintenance.html"

# 2. 全量重导（数据量小，简化处理）
ssh root@123.57.129.243 "sudo -u papacheck pg_dump -Fc -d papacheck -f /tmp/papacheck-final.dump"
scp root@123.57.129.243:/tmp/papacheck-final.dump /tmp/
pg_restore -d "<CloudBase PG>" --clean --if-exists /tmp/papacheck-final.dump
```

**步骤3.2：配置网关路由**

```bash
tcb gateway create-route --path /papacheck/api/speak --upstream-type SCF --upstream-name tts-svc
tcb gateway create-route --path /papacheck/api/pregen-speech --upstream-type SCF --upstream-name tts-svc
tcb gateway create-route --path /papacheck/api/ --upstream-type SCF --upstream-name papacheck-api --path-rewrite /api/
tcb gateway create-route --path /papacheck/ --upstream-type STATIC_STORE
```

**步骤3.3：Android APK 推送**

```bash
cd PapaCheck.Android
flutter build apk --release --build-name=1.6.0
tcb storage objects upload ...PapaCheck-1.6.0.apk --dist/
tcb fn update papacheck-api --env APK_VERSION=1.6.0
```

**步骤3.4：验证切换**

```bash
curl https://chengdexy.cn/papacheck/api/ping
curl https://chengdexy.cn/papacheck/
curl https://chengdexy.cn/papacheck/app/
curl https://chengdexy.cn/papacheck/admin/
```

### 阶段4：观察

切换后 24-48 小时观察：

| 指标 | 检查方式 | 异常处理 |
|------|---------|---------|
| API 错误率 | CloudBase 控制台 → 云函数监控 | > 5% 则回滚 |
| 云函数冷启动 | 控制台 → 调用日志 | 优化依赖加载 |
| PG 连接数 | `SELECT count(*) FROM pg_stat_activity` | > 80% 则优化订阅 |
| 实时监听延迟 | 前端 console 日志 | > 2s 则排查 |
| 用户反馈 | 用户反馈渠道 | P0 问题立即回滚 |

### 阶段5：ECS 下线

切换 1 周后，确认无需回滚：

```bash
ssh root@123.57.129.243 "systemctl stop papacheck && systemctl disable papacheck"
ssh root@123.57.129.243 "sudo -u papacheck pg_dump -Fc -d papacheck -f /tmp/papacheck-final-backup.dump"
scp root@123.57.129.243:/tmp/papacheck-final-backup.dump /tmp/
# 阿里云控制台释放 ECS 资源
```

### 回滚预案

#### 回滚触发条件

| 条件 | 立即回滚 |
|------|---------|
| API 错误率 > 10% | ✅ |
| 数据丢失或损坏 | ✅ |
| 实时监听完全失效 | ✅ |
| 用户大面积反馈无法使用 | ✅ |
| PG 连接数耗尽 | ✅ |

#### 回滚步骤（< 5 分钟）

ECS 在阶段5前未下线，可快速回滚：

```bash
# 1. 删除 CloudBase 网关路由
tcb gateway delete-route --path /papacheck/api/
tcb gateway delete-route --path /papacheck/

# 2. 恢复 ECS 服务
ssh root@123.57.129.243 "rm -f /opt/papacheck/maintenance.html && systemctl restart papacheck"

# 3. 回滚 Android APK（推送旧版到云存储，更新云函数环境变量）
tcb storage objects upload PapaCheck-1.5.2.apk --dist/
tcb fn update papacheck-api --env APK_VERSION=1.5.2
# 注意：此时网关路由已删除，APK_VERSION 更新仅影响 ECS 恢复后的 /api/version 端点
# 实际 APK 下载在 ECS 恢复后由 ECS 的 /api/download 处理
```

#### 数据回滚策略

| 场景 | 策略 |
|------|------|
| 切换后 1 小时内回滚 | 接受少量数据丢失（用户重新操作） |
| 切换后 1-24 小时回滚 | 反向同步：从 CloudBase PG 导出 → 恢复到 ECS PG |
| 切换后 24+ 小时回滚 | 几乎不会发生（已过观察期） |

### 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| CloudBase PG 连接数耗尽 | 低 | 实时监听失败 | 监控 + 合并订阅 + 升级套餐 |
| 云函数冷启动延迟 | 中 | 首次请求慢（1-3s） | 预热（定时 ping）+ 提升内存 |
| RLS 策略配置错误 | 中 | 数据泄露 | 严格测试 + 上线前验证 |
| 实时监听 SDK 兼容性 | 低 | 前端订阅失败 | 充分测试 + 降级到轮询方案 |
| 网关路由配置错误 | 低 | 路由不通 | 阶段2充分验证 |
| 数据迁移不完整 | 低 | 数据丢失 | 行数校验 + 关键字段校验 |
| Android WebView 缓存旧 URL | 中 | 用户无法连接 | APK 强制更新 + 清缓存 |

---

## 十、成功标准

迁移完成的标志：

- [ ] 所有 API 端点在 `chengdexy.cn/papacheck/api/*` 可访问
- [ ] 实时监听生效，前端无需轮询
- [ ] Android APK 通过 CloudBase 下载更新
- [ ] CloudBase PG 数据完整（27 张表行数与 ECS 一致）
- [ ] RLS 策略生效（用户隔离正确）
- [ ] 测试覆盖率达标（总体 ≥ 85%）
- [ ] 全量测试通过（Vitest + Flutter test）
- [ ] 切换后 48 小时无 P0 问题
- [ ] ECS 资源释放

---

## 附录：项目文档影响

迁移完成后需更新的项目文档：

| 文档 | 更新内容 |
|------|---------|
| `README.md` | 版本号、技术栈、快速开始、项目结构 |
| `docs/PRD.md` | 移除邮件同步、离线模式；新增实时监听 |
| `docs/ARCHITECTURE.md` | 系统架构图、技术栈表、部署方式 |
| `docs/API.md` | API 路径前缀更新（所有 `/api/*` → `/papacheck/api/*`） |
| `docs/CHANGELOG.md` | `[Unreleased]` 段记录迁移变更 |
| `docs/PROGRESS.md` | 已完成功能、部署状态、最近变更 |
| `docs/HANDOVER.md` | 服务器信息（CloudBase 环境）、部署流程、回滚预案 |
