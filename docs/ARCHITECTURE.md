# PapaCheck 技术架构文档

> 最后更新：2026-07-07 | 版本：2.0.0（CloudBase 迁移）

## 一、技术栈

| 模块 | 语言/框架 | 关键依赖 |
|------|-----------|----------|
| **云函数（生产）** | Node.js 20.19（CloudBase SCF） | Fastify 5.x、PostgreSQL（CloudBase PG）、TypeScript 5.x |
| **本地开发服务器** | Node.js 22+ | Fastify 5.x、PostgreSQL 16、TypeScript 5.x |
| **Web 前端** | 原生 HTML/CSS/JS | `@cloudbase/js-sdk`（importmap CDN）、30 秒轮询刷新 |
| **Site（落地页+管理面板）** | Vite 5, React 18, TypeScript 5, Tailwind CSS 3 | Lucide Icons、Tailwind preset、React Router（可选） |
| **Android 端** | Dart/Flutter | `webview_flutter`、`path_provider` |
| **测试** | Vitest, Flutter test | Vitest 3.x、Flutter test |
| **基础设施** | 腾讯云 CloudBase | SCF 云函数、PostgreSQL（`postgres-9pagpv9i`）、网关（`chengdexy.cn`）、静态托管、云存储 |
| **构建发布** | PapaCheck.Release（Node.js/TypeScript）| 版本管理、Flutter 构建、tcb CLI 部署（`fn`/`site`/`all`） |

---

## 二、系统架构

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
   落地页 + React 管理面板     孩子端 HTML/CSS/JS             → papacheck-api 云函数
                                                              (Nodejs20.19, 单函数处理所有 API)
            │                                                 │
            └─────────────────────────────────────────────────┤
                                                              │
            ┌─────────────────────────────────────────────────┤
            │                                                 │
            ▼                                                 ▼
   /papacheck/api/speak (SCF)                    CloudBase PostgreSQL
   → tts-svc 云函数 (Python3.10)                 postgres-9pagpv9i
                                                 26 张表 + RLS 行级安全策略

   ┌─────────────────────────────────────────────────────────┐
   │  前端 ←→ CloudBase REST API (fetch /pollServer 30s)     │
   │  前端每 30 秒拉取全量数据刷新                           │
   │  弃用: CloudBase watch() / SW / localforage / CRDT / 队列│
   └─────────────────────────────────────────────────────────┘
```

### 核心设计原则

1. **CloudBase 优先**：全部服务迁移到 CloudBase（SCF + PG + 静态托管 + 网关），ECS 已弃用
2. **轮询数据同步**：前端通过 RealtimeManager 每 30 秒触发一次全量数据刷新（替代 CloudBase watch()，因其 SDK v3 API 不兼容）
3. **RLS 行级安全**：14 张业务表配置 PostgreSQL Row Level Security，前端实时订阅只能看到自己 `tenant_id` + `child_id` 的数据
4. **多租户隔离**：JWT 认证 + tenant_id 层，孩子数据按租户/家长隔离

---

## 三、项目结构

```
PapaCheck/
├── PapaCheck.Server/          # Node.js 服务器（本地开发用，Fastify + PostgreSQL）
│   ├── src/
│   │   ├── app.ts             # Fastify 应用（55+ 个 API 端点）
│   │   ├── index.ts           # CLI 入口
│   │   ├── db/
│   │   │   ├── index.ts       # pg（PostgreSQL 16）数据库层
│   │   │   └── schema.ts      # 数据库模式定义（26 张表）
│   │   ├── auth/              # JWT 多租户认证
│   │   └── sync/              # （已移除，CRDT 离线同步已弃用）
│   ├── scripts/
│   │   └── build-sea.mjs      # SEA 单 EXE 构建脚本
│   ├── test/                  # Vitest 测试
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
│
├── PapaCheck.CloudFunc/       # CloudBase 云函数（生产部署）
│   └── papacheck-api/         # API 云函数（SCF + Fastify + PG，从 Server 迁移）
│       ├── index.ts           # 云函数入口
│       ├── scf-handler.ts     # SCF 事件适配层
│       ├── app.ts             # Fastify 应用与路由注册
│       ├── db.ts              # PostgreSQL 数据库连接
│       ├── src/               # 业务模块（auth、admin、crdt、db 等）
│       ├── test/              # 单元测试（含 RLS 测试）
│       └── scripts/           # 数据迁移脚本
│
├── PapaCheck.Web/             # Web 前端（孩子端 + 管理端）
│   ├── index.html             # 孩子端大屏界面
│   ├── admin.html             # 管理端界面
│   ├── css/                   # 样式
│   ├── js/                    # 逻辑（app/admin/api/cloudbase/realtime 轮询）
│   └── （sw.js/db.js/sync.js 已移除，CloudBase 实时监听替代）
│
├── PapaCheck.Site/            # [v1.4 整合] 落地页 + 管理面板（Vite 5 MPA）
│   ├── index.html             # 落地页入口
│   ├── admin/index.html       # 管理面板入口（Vite 第二入口）
│   ├── public/imgs/mascot/    # 5 张吉祥物 PNG（wave/point/ok/thumbs/bye）
│   ├── src/
│   │   ├── landing/           # 落地页 React 应用
│   │   └── admin/             # 管理面板 React 应用
│   └── vite.config.ts         # MPA 配置 + adminBaseRewrite/copyAdminAssets 自定义插件
│
├── PapaCheck.Android/         # Android 端（Flutter WebView）
│   ├── lib/                   # Dart 源码（配置引导页、APK 更新）
│   ├── test/                  # Flutter 测试
│   └── apk/                   # 预构建 APK 文件
│
├── PapaCheck.Release/         # [v1.4 新增] 发布控制台（Node.js/TypeScript）
│   ├── lib/
│   │   ├── build-apk.ts       # Flutter APK 构建
│   │   ├── fn-deploy.ts       # CloudBase 云函数部署（tcb fn deploy）
│   │   ├── cloud-publish.ts   # APK 发布到云存储（tcb storage upload）
│   │   ├── site-publish.ts    # 静态托管发布（tcb hosting deploy）
│   │   ├── executor.ts        # 步骤执行引擎
│   │   └── reset-test-db.ts   # 测试库重置
│   ├── console-server.ts      # Web 控制台 + SSE
│   ├── console.html           # 控制台前端
│   ├── release.ts             # CLI 入口（serve / build-apk / fn / site / all）
│   ├── package.json
│   └── tsconfig.json
│
├── docs/                      # 项目文档
└── package.json
```

---

## 四、数据模型

### 数据库：PostgreSQL 16

共 26 张表：

| 表名 | 用途 |
|------|------|
| `users` | 用户账户（家长/管理员） |
| `tenants` | 租户（家庭/班级） |
| `tenant_members` | 租户成员关系 |
| `access_codes` | 接入码（孩子端设备配对） |
| `children` | 孩子档案（关联租户） |
| `homeworks` | 作业记录（名称、科目、状态、计时、评级） |
| `daily_settlement` | 每日结算 |
| `points` | 积分余额 |
| `points_history` | 积分变动历史 |
| `shop_items` | 商店商品 |
| `redemptions` | 兑换记录 |
| `reward_box` | 奖励箱 |
| `bounty_tasks` | 赏金任务 |
| `bounty_submissions` | 赏金提交 |
| `bounty_completions` | 赏金完成 |
| `active_buffs` | 活跃 Buff |
| `badges` | 徽章 |
| `efficiency_history` | 效率历史 |
| `free_time_tasks` | 自由时间任务 |
| `notifications` | 通知消息（积分变化、任务提醒等） |
| `crdt_operations` | CRDT 离线操作日志（冲突合并） |
| `sync_metadata` | 设备同步元数据 |
| `sessions` | 用户会话（JWT 刷新令牌） |
| `audit_log` | 操作审计日志 |
| `settings` | 系统设置 |
| `meta` | 元数据 |

### 关键字段约定

- 时间字段：ISO 8601 字符串（`YYYY-MM-DDTHH:MM:SS`）
- 日期字段：`YYYY-MM-DD` 格式
- 状态字段：枚举字符串（如 `pending`/`in_progress`/`completed`/`paused`）
- 评级字段：`excellent`/`good`/`fair`/`poor`
- 多租户：所有业务表通过 `tenant_id`（UUID）关联到 `tenants` 表
- 多孩子隔离：通过 `child_id`（UUID）区分同一租户下不同孩子数据

### RLS 行级安全策略（v2.0.0 新增）

CloudBase 迁移后，14 张业务表配置 PostgreSQL Row Level Security（RLS）策略：

- **启用 RLS 的表**：`homeworks`、`daily_settlement`、`points`、`points_history`、`shop_items`、`redemptions`、`reward_box`、`bounty_tasks`、`bounty_submissions`、`bounty_completions`、`active_buffs`、`efficiency_history`、`free_time_tasks`、`notifications`
- **策略规则**：前端通过 CloudBase SDK 实时订阅时，只能 `SELECT` 到自己 `tenant_id` + `child_id` 匹配的行
- **后端绕过**：API 云函数 `papacheck-api` 使用 service role 连接 PG，绕过 RLS 执行全量 CRUD
- **目的**：前端实时同步每 30 秒轮询刷新数据，RLS 确保数据隔离安全

---

## 五、关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| HTTP 服务器 | Fastify 5.x（Node.js） | 高性能、TypeScript 原生支持、插件生态丰富 |
| 数据库 | CloudBase PostgreSQL（`postgres-9pagpv9i`） | 多租户支持、成熟 ACID、RLS 行级安全、CloudBase 托管免运维 |
| 认证方式 | JWT + 多租户（RBAC） | 跨平台无状态认证，tenant_id 层隔离数据 |
| 前端框架 | 原生 HTML/CSS/JS | 轻量、无构建步骤 |
| 管理面板 | React 18（Vite MPA） | 复杂状态管理需求，独立入口不干扰孩子端 |
| Android 方案 | Flutter WebView 混合 | 复用 Web 前端，原生提供 APK 更新 |
| 数据同步 | 30 秒轮询（RealtimeManager 触发 refreshAllData） | 替代 CloudBase watch() 实时监听，无需离线缓存 |
| 数据安全 | RLS 行级安全策略 | 14 张业务表 tenant/child 隔离，前端订阅只能看到自己的数据 |
| 多孩子隔离 | child_id 层 + RLS 策略 | 同一租户下每个孩子可见性隔离 |
| 接入码配对 | 一次性的 8 字符接入码 | 简化设备绑定流程，无账户注册 |
| TTS | tts-svc 云函数（Python3.10 + edge-tts） | CloudBase SCF，消费端无需 Python |
| 部署方式 | CloudBase（SCF + PG + 静态托管 + 网关） | Serverless 免运维，ECS 已弃用 |
| 路径前缀 | `/papacheck/` | CloudBase 网关子路径，与 `chengdexy.cn/dictations` 等其他项目共存 |
| 落地页图片资源 | `<picture>` + WebP 1x/2x + PNG 兜底 | 资源体积 -94%，LCP 图 preload + fetchpriority=high 抢首屏 |

---

## 六、构建与发布

```
PapaCheck.Release → 一站式发布编排（Node.js/TypeScript）
  ├── release.ts                # CLI 入口（serve / build-apk / fn / site / all 五子命令）
  ├── console-server.ts         # Web 控制台服务 + SSE 实时日志
  ├── console.html              # 控制台前端（暗色主题）
  └── lib/
      ├── executor.ts           # 步骤执行引擎（EventEmitter 驱动，超时保护）
      ├── build-apk.ts          # Flutter APK 构建 + 归档
      ├── fn-deploy.ts          # CloudBase 云函数部署（tcb fn deploy）
      ├── cloud-publish.ts      # APK 发布到云存储（tcb storage upload）
      ├── site-publish.ts       # 静态托管发布（tcb hosting deploy）
      └── reset-test-db.ts      # 测试库重置
```

- 统一版本号：`PapaCheck.Server/package.json`（主版本号来源）
- APK 版本号：`PapaCheck.Android/pubspec.yaml`
- 当前版本：Server `2.0.0`（开发中），APK `2.0.0`（开发中）
- 部署方式：`tcb fn deploy` / `tcb hosting deploy`（CloudBase CLI，无需 SSH）

---

## 七、服务器架构

### 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 框架 | Fastify 5.x | 高性能、TypeScript 原生支持、插件生态 |
| 数据库 | CloudBase PostgreSQL（pg） | 多租户支持、生产级 ACID、RLS 行级安全、CloudBase 托管 |
| 认证 | @fastify/jwt | 无状态 JWT，支持多租户 RBAC |
| 运行时 | CloudBase SCF（Nodejs20.19） | Serverless 免运维，自动扩缩容 |
| 测试 | Vitest 3.x | 与前端测试框架统一 |
| 部署 | CloudBase（SCF + PG + 静态托管 + 网关） | tcb CLI 一键部署，无需 SSH/Nginx/systemd |
| 运维 | CloudBase PG 自带备份 + 腾讯云监控 | 替代自研 OpsScheduler（已移除） |

### API 清单

服务器提供 55+ 个 API 端点，覆盖以下功能域：

| 功能域 | 端点数量 | 说明 |
|--------|---------|------|
| 认证 | 4 | 注册、登录、刷新令牌、登出 |
| 多租户管理 | 5 | 创建租户、邀请成员、管理接入码 |
| 孩子管理 | 3 | 创建、查询、更新孩子档案 |
| 作业管理 | 8 | CRUD、计时、评级、批量操作 |
| 积分与商店 | 8 | 积分查询/充值、商品管理、兑换 |
| 赏金任务 | 6 | 发布、提交、审核、完成 |
| 奖励箱/Buff | 4 | 开启奖励箱、激活/停用 Buff |
| 徽章系统 | 3 | 颁发、查询、统计 |
| 同步 | 4 | CRDT 操作推送/拉取、冲突合并 |
| 通知 | 4 | 推送、查询、标记已读 |
| 审计 | 3 | 操作日志查询、导出 |
| 系统 | 3 | 健康检查、设置、统计
