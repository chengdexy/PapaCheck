# Phase 5: 上云 + 多租户 SaaS 化 — 完整阶段规划

> 最后更新：2026-06-12
>
> 本文档为 Phase 5 全阶段主规划。各子阶段有独立交付物和验收标准。
> 当前正在进行 **Phase 5a + 5b**，其余阶段为后续规划。

---

## Why

PapaCheck 原为局域网单机应用，已部署到阿里云 ECS。当前面临：

| 问题 | 说明 |
|------|------|
| **数据库** | SQLite 不适合云上多并发，需 PostgreSQL |
| **部署方式** | Docker 对单服务应用过于复杂，运维门槛高 |
| **安全** | 端口 8080 公网暴露，域名公开，API 无任何保护 |
| **多租户** | 未来需要支持多家庭使用，数据隔离尚未设计 |
| **运维** | 无自动备份、无监控、无 CI/CD |
| **客户端** | Android/Windows 端尚不支持远程服务器配置 |

---

## 总体架构（最终目标）

```
阿里云 ECS (Ubuntu 24.04)
├── Nginx (apt) → 端口 443 (HTTPS)
│   ├── papacheck.chengdexy.cn/         → 产品落地页（公开）
│   ├── papacheck.chengdexy.cn/app/*    → 前端页面（需认证）
│   └── papacheck.chengdexy.cn/api/*    → API（需认证）
├── Node.js 22 (systemd: papacheck.service)
│   ├── Fastify + auth 中间件
│   │   └─ [当前] Cookie Session（临时）
│   │   └─ [未来] JWT 多租户（Phase 5c）
│   ├── IDatabase 接口
│   │   ├─ SqliteAdapter（本地开发）
│   │   └─ PostgresAdapter（云端生产）
│   └── TTS (Python + edge-tts)
├── PostgreSQL 16 (apt)
├── Python 3 + pip (edge-tts)
├── UFW: 22/80/443
└── 安全组: 22/80/443 (8080 已关闭)
```

---

## 阶段划分

### Phase 5a：PostgreSQL 适配 [进行中]

**目标**：数据库抽象层重构，支持 SQLite / PostgreSQL 双后端。

**交付物**：
- `IDatabase` 接口定义 + `DatabaseAdapter` 抽象基类
- `SqliteAdapter`（从原有 `PapaCheckDB` 迁移，保持 100% 兼容）
- `PostgresAdapter`（新实现，pg 库，JSON-in-column 模式）
- 工厂函数 `createDatabase()` 通过 `DATABASE_URL` 环境变量切换
- 数据迁移脚本 `migrate-to-pg.ts`（SQLite → PostgreSQL 逐表迁移 + 行数校验）
- SQLite + PostgreSQL 双模式全量测试通过

**不做的事**：
- 不改业务逻辑
- 不改任何 API 端点
- 不改前端代码

---

### Phase 5b：部署架构重构（去 Docker + Nginx + 临时安全防护）[进行中]

**目标**：去掉 Docker，改用 systemd 管理进程 + Nginx 反向代理 + 基础安全。

**为什么去 Docker**：
- 单服务轻量应用，Docker 带来复杂性大于收益
- 2核2G 服务器资源有限，去掉 Docker 层可节省资源
- 用户运维体验差（日志、调试、重启都多一层）

**交付物**：
- 服务器直接安装 Node.js 22 + PostgreSQL 16 + Nginx + Python3
- systemd service `papacheck.service`（开机自启 + 崩溃重启 + journald 日志）
- 本地部署脚本 `scripts/deploy.sh`（编译 → scp → restart）
- Nginx 反向代理（443 HTTPS → localhost:8080）
- **临时安全防护**：Cookie Session 密码认证
  - **⚠️ 这是临时方案，仅用于填补"上公网"到"多租户认证"之间的安全空白**
  - 一个共享密码，存储在 settings 中
  - 登录后设置 session cookie，浏览器自动记住
  - 所有客户端零代码改动（浏览器原生支持 Cookie）
  - **正式的多租户用户认证系统将在 Phase 5c 实现**
- 安全组关闭 8080 端口，UFW 仅放行 22/80/443
- Android 配置从 `http://ip:8080` 改为 `https://papacheck.chengdexy.cn/app/`

**不做的事**：
- 不做多租户用户系统（Phase 5c 做）
- 不改业务逻辑

---

### Phase 5c：用户认证系统（JWT + 多租户）[规划]

**目标**：构建真正的多租户用户认证系统，替换 Phase 5b 的临时 Cookie Session。

**交付物**：
- 用户注册/登录/注销 API
- JWT 令牌发行与验证中间件
- 数据库新增 `users` / `tenants` 表
- 租户 ID 行级数据隔离（所有查询自动过滤 tenant_id）
- 前端登录页面 + 路由守卫（未登录跳转登录页）
- 管理员邀请成员机制
- 移除 Phase 5b 的临时 Cookie Session

**前置依赖**：Phase 5a + 5b 完成

---

### Phase 5d：运维增强 [规划]

**目标**：CI/CD、数据库备份、监控告警。

**交付物**：
- CI 自动构建（网络条件就绪后启用）
- PostgreSQL 数据库定时自动备份到云端
- 服务健康监控 + 告警通知（磁盘/内存/进程）
- 日志管理（日志轮转、保留策略）

**前置依赖**：Phase 5a + 5b 完成

---

### Phase 5e：客户端适配 [规划]

**目标**：各端适配云服务模式。

**交付物**：
- Windows 端：支持远程服务器地址配置
- Android 端：更新 APK 默认服务器地址指向域名
- Web 端：登录状态持久化
- 离线模式兼容远程服务场景
- 平滑迁移指南

**前置依赖**：Phase 5c 用户认证就绪

---

## 分阶段路线图

```
Phase 5a (进行中) ─────────────────────────────────────────────┐
  PostgreSQL 适配 + 数据库抽象层                                 │
                                                                │
Phase 5b (进行中) ─────────────────────────────────────────────┤
  去 Docker + systemd + Nginx + 临时 Cookie Session              ├─ 本次实现
                                                                │
Phase 5c (规划) ───────────────────────────────────────────────┤
  JWT 多租户用户认证系统（替换临时 Cookie Session）                │
                                                                │
Phase 5d (规划) ───────────────────────────────────────────────┤
  CI/CD + 备份 + 监控                                           │
                                                                │
Phase 5e (规划) ────────────────────────────────────────────────┘
  Windows / Android / Web 客户端适配
```

---

## Impact

- Affected specs: 数据库层（5a）、部署架构（5b）、安全认证（5b 临时 / 5c 正式）
- Affected code:
  - `PapaCheck.Server.Node/src/db/` — 完全重构（5a）
  - `PapaCheck.Server.Node/src/app.ts` — 数据库工厂 + auth 插件（5a+5b）
  - `PapaCheck.Server.Node/src/auth-plugin.ts` — **新建** Cookie Session 临时认证（5b）
  - `PapaCheck.Web/js/api.js` — 适配 URL 路径变更（5b）
  - `scripts/deploy.sh` — **新建** 部署脚本（5b）
  - Nginx 配置 — 反向代理规则（5b）
  - 阿里云安全组 — 关闭 8080（5b）
  - `PapaCheck.Server.Node/src/db/postgres-adapter.ts` — **新建**（5a）
  - `PapaCheck.Server.Node/scripts/init-pg-schema.sql` — **新建**（5a）
  - `PapaCheck.Server.Node/scripts/migrate-to-pg.ts` — **新建**（5a）
