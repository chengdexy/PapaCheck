# PapaCheck 技术架构文档

> 最后更新：2026-06-25 | 版本：1.4.2

## 一、技术栈

| 模块 | 语言/框架 | 关键依赖 |
|------|-----------|----------|
| **Server (Node.js)** | Node.js 22+ | Fastify 5.x、PostgreSQL 16、TypeScript 5.x |
| **Web 前端** | 原生 HTML/CSS/JS | `localforage`（本地存储）、Service Worker |
| **Site（落地页+管理面板）** | Vite 5, React 18, TypeScript 5, Tailwind CSS 3 | Lucide Icons、Tailwind preset、React Router（可选） |
| **Android 端** | Dart/Flutter | `webview_flutter`、`path_provider` |
| **测试** | Vitest, Flutter test | Vitest 3.x、Flutter test |
| **构建发布** | PapaCheck.Release（Node.js/TypeScript）| 版本管理、SEA 打包、Flutter 构建、systemd 部署 |

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────────┐
│                   云部署 / 家庭局域网                      │
│                                                         │
│  ┌──────────┐    HTTPS/JSON     ┌────────────────────┐  │
│  │  孩子端   │ ◄──────────────► │                    │  │
│  │  (Web)   │                   │   PapaCheck        │  │
│  └──────────┘                   │   Server           │  │
│                                 │  (Node.js+Fastify  │  │
│  ┌──────────┐    HTTPS/JSON     │   +PostgreSQL)     │  │
│  │  管理面板  │ ◄──────────────► │                    │  │
│  │  (React)  │                   └────────┬───────────┘  │
│  └──────────┘                              │             │
│                                            │             │
│  ┌──────────┐    HTTPS/JSON               │             │
│  │ Android  │ ◄────────────────────────────┘             │
│  │ (Flutter)│                                           │
│  └──────────┘                                           │
│                                                         │
│  ┌──────────────────┐     ┌────────────────────────┐    │
│  │  云部署模式       │     │   systemd + Nginx 部署   │    │
│  │  ├── 阿里云 ECS  │     │   ├── Server (Node.js) │    │
│  │  ├── 域名 + SSL  │     │   ├── PostgreSQL 16     │    │
│  │  └── Let's Enc.  │     │   └── Nginx 反代        │    │
│  └──────────────────┘     └────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 核心设计原则

1. **云部署优先**：systemd + Nginx 直接部署，支持阿里云 ECS 与家庭局域网双模式（Docker 已于 Phase 5b 退役）
2. **离线优先**：前端 Service Worker + localforage 缓存，Android 离线快照
3. **增量同步 + CRDT**：基于 `last_modified` 时间戳的 pull/push 机制，`crdt_operations` 表记录离线冲突
4. **多租户隔离**：JWT 认证 + tenant_id 层，孩子数据按租户/家长隔离

---

## 三、项目结构

```
PapaCheck/
├── PapaCheck.Server/          # Node.js 服务器（Fastify + PostgreSQL）
│   ├── src/
│   │   ├── app.ts             # Fastify 应用（55+ 个 API 端点）
│   │   ├── index.ts           # CLI 入口
│   │   ├── db/
│   │   │   ├── index.ts       # pg（PostgreSQL 16）数据库层
│   │   │   └── schema.ts      # 数据库模式定义（26 张表）
│   │   ├── tts/index.ts       # Python 子进程 TTS 桥接
│   │   ├── auth/              # JWT 多租户认证
│   │   └── sync/              # 离线同步（CRDT 操作日志）
│   ├── scripts/
│   │   ├── tts_bridge.py      # TTS Python 子进程脚本
│   │   └── build-sea.mjs      # SEA 单 EXE 构建脚本
│   ├── test/                  # Vitest 测试
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
│
├── PapaCheck.Web/             # Web 前端（孩子端 + 管理端）
│   ├── index.html             # 孩子端大屏界面
│   ├── admin.html             # 管理端界面
│   ├── css/                   # 样式
│   ├── js/                    # 逻辑（app/admin/api/db/sync/connection）
│   └── sw.js                  # Service Worker
│
├── PapaCheck.Site/            # [v1.4 整合] 落地页 + 管理面板（Vite 5 MPA）
│   ├── index.html             # 落地页入口
│   ├── admin/index.html       # 管理面板入口（Vite 第二入口）
│   ├── public/imgs/mascot/    # 5 张吉祥物 PNG（wave/point/ok/thumbs/bye）
│   ├── src/
│   │   ├── landing/           # 落地页 React 应用（TopNav/Hero/Story/Features/Platforms/CtaFinal/Footer）
│   │   └── admin/             # 管理面板 React 应用（AuthView/Dashboard/MemberTable/TenantTable/SystemHealth 等）
│   └── vite.config.ts         # MPA 配置 + adminBaseRewrite/copyAdminAssets 自定义插件
│
├── PapaCheck.Android/         # Android 端（Flutter WebView）
│   ├── lib/                   # Dart 源码（首次连通引导页、离线快照）
│   ├── test/                  # Flutter 测试
│   └── apk/                   # 预构建 APK 文件
│
├── PapaCheck.Release/         # [v1.4 新增] 发布控制台（Node.js/TypeScript）
│   ├── lib/
│   │   ├── build-apk.ts       # Flutter APK 构建
│   │   ├── cloud-publish.ts   # 云端 SSH 发布
│   │   ├── site-publish.ts    # Site 静态资源发布
│   │   ├── executor.ts        # 步骤执行引擎
│   │   └── reset-test-db.ts   # 测试库重置
│   ├── console-server.ts      # Web 控制台 + SSE
│   ├── console.html           # 控制台前端
│   ├── release.ts             # CLI 入口
│   ├── package.json
│   └── tsconfig.json
│
├── docs/                      # 项目文档
├── nginx.conf                 # 生产 Nginx 配置（镜像到云端 sites-available/default）
├── nginx.dev.conf             # 本地开发 Nginx 配置（HTTP :8081）
├── papacheck.service          # systemd 单元文件
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

---

## 五、关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| HTTP 服务器 | Fastify 5.x（Node.js） | 高性能、TypeScript 原生支持、插件生态丰富 |
| 数据库 | PostgreSQL 16 | 多租户支持、成熟 ACID、可扩展至 100+ 家庭同时使用 |
| 认证方式 | JWT + 多租户（RBAC） | 跨平台无状态认证，tenant_id 层隔离数据 |
| 前端框架 | 原生 HTML/CSS/JS | 轻量、离线友好、无构建步骤 |
| 管理面板 | React 18（Vite MPA） | 复杂状态管理需求，独立入口不干扰孩子端 |
| Android 方案 | Flutter WebView 混合 | 复用 Web 前端，原生提供离线快照和 APK 更新 |
| 离线存储 | localforage (IndexedDB) | 浏览器端结构化存储，容量大 |
| 离线同步 | 增量同步 + CRDT 操作日志 | `crdt_operations` 表记录冲突，设备重连后自动合并 |
| 多孩子隔离 | child_id 层 + 数据范围查询 | 同一租户下每个孩子可见性隔离 |
| 接入码配对 | 一次性的 8 字符接入码 | 简化设备绑定流程，无账户注册 |
| TTS | edge-tts（微软） | 免费高质量中文语音 |
| AI 解析 | LLM API（如 DeepSeek 等） | 任意支持中文的 LLM 均可，默认使用 DeepSeek |
| 部署方式 | systemd + Nginx + PostgreSQL 直接部署 | Docker 已于 Phase 5b 退役，资源占用更低 |
| 落地页图片资源 | `<picture>` + WebP 1x/2x + PNG 兜底 | 资源体积 -94%，LCP 图 preload + fetchpriority=high 抢首屏 |

---

## 六、构建与发布

```
PapaCheck.Release → 一站式发布编排（Node.js/TypeScript）
  ├── release.ts                # CLI 入口（serve / build-apk / cloud / site 四子命令）
  ├── console-server.ts         # Web 控制台服务 + SSE 实时日志
  ├── console.html              # 控制台前端（暗色主题）
  └── lib/
      ├── executor.ts           # 步骤执行引擎（EventEmitter 驱动，超时保护）
      ├── build-apk.ts          # Flutter APK 构建 + 归档
      ├── cloud-publish.ts      # 云端 SSH 发布（Node.js 服务端 dist）
      ├── site-publish.ts       # Site 静态资源发布（Vite 构建 + tar + SSH 上传）
      └── reset-test-db.ts      # 云同步前自动重置 PG 测试库
```

- 统一版本号：`PapaCheck.Server/package.json`（主版本号来源）
- APK 版本号：`PapaCheck.Android/pubspec.yaml`
- 当前版本：Server `1.4.2`，APK `1.4.2+0`（pubspec.yaml）
- 部署方式：`systemctl restart papacheck`（Nginx 反代，无需容器）

---

## 七、服务器架构

### 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 框架 | Fastify 5.x | 高性能、TypeScript 原生支持、插件生态 |
| 数据库 | pg（PostgreSQL 16） | 多租户支持、生产级 ACID、systemd 直接运行 |
| 认证 | @fastify/jwt | 无状态 JWT，支持多租户 RBAC |
| 构建 | esbuild + SEA | Node.js 22 原生单 EXE 支持 |
| 测试 | Vitest 3.x | 与前端测试框架统一 |
| 部署 | systemd + Nginx | Server + PostgreSQL 16 直接运行，Nginx 反代 + Let's Encrypt HTTPS |
| 运维 | 自研 ops 模块 | Phase 5d：自动备份（每日 03:00 保留 3 份）+ 健康监控（5 分钟轮询）+ SMTP 告警 + 每日运维报告 |

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
