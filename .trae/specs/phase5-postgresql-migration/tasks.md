# Tasks — Phase 5: 上云 + 多租户 SaaS 化

> 当前实施 **Phase 5a + 5b**，其余为后续规划。

---

## Phase 5a：PostgreSQL 适配 [进行中]

- [ ] Task 5a-1: 重构数据库抽象层 — 接口定义 + SqliteAdapter
  - [ ] Step 1: 安装 `pg` + `@types/pg` 依赖
  - [ ] Step 2 (TDD RED): 写 `abstract-adapter.test.ts` 验证 IDatabase 接口
  - [ ] Step 3 (GREEN): 创建 `db/types.ts` — IDatabase 接口 + 所有类型定义
  - [ ] Step 4 (GREEN): 创建 `db/adapter.ts` — DatabaseAdapter 抽象基类（工具方法）
  - [ ] Step 5 (GREEN): 创建 `db/sqlite-adapter.ts` — 从原有 `PapaCheckDB` 迁移代码
  - [ ] Step 6 (GREEN): 重写 `db/index.ts` — 工厂函数 `createDatabase()` + 向后兼容
  - [ ] Step 7 (GREEN): 更新 `app.ts` — 使用 `createDatabase()` 工厂函数
  - [ ] Step 8 (VERIFY): RED 变 GREEN + 全量回归测试通过

- [ ] Task 5a-2: 实现 PostgresAdapter（TDD 全覆盖）
  - [ ] Step 1 (TDD RED): 写 `postgres-adapter.test.ts`
  - [ ] Step 2 (GREEN): 创建 `db/postgres-adapter.ts` 骨架 + Schema 初始化
  - [ ] Step 3 (GREEN): 逐方法实现 IDatabase 全部 ~40 个方法（按依赖分组）
  - [ ] Step 4 (GREEN): 更新工厂函数支持 `DATABASE_URL` 环境变量
  - [ ] Step 5 (VERIFY): Docker PostgreSQL 运行 TDD 测试全部通过
  - [ ] Step 6 (VERIFY): SQLite 全量回归不受影响

- [ ] Task 5a-3: 数据迁移脚本
  - [ ] Step 1 (TDD RED): 写 migration 测试（验证 schema SQL 文件完整性）
  - [ ] Step 2 (GREEN): 创建 `scripts/init-pg-schema.sql` — PostgreSQL 全部表定义
  - [ ] Step 3 (GREEN): 创建 `scripts/migrate-to-pg.ts` — 逐表迁移 + 行数校验
  - [ ] Step 4 (GREEN): package.json 添加 `migrate:pg` script
  - [ ] Step 5 (VERIFY): RED 变 GREEN + 全量回归测试通过

## Phase 5b：部署架构重构（去 Docker + Nginx + 临时安全）[进行中]

- [ ] Task 5b-1: Cookie Session 临时认证中间件
  - [ ] Step 1 (TDD RED): 写 auth 测试（未登录返回 401、登录后正常访问）
  - [ ] Step 2 (GREEN): 创建 `src/auth-plugin.ts` — Fastify 插件
  - [ ] Step 3 (GREEN): 密码管理（settings 中存储 / 部署时自动生成打印到日志）
  - [ ] Step 4 (GREEN): 登录页面（极简 HTML，输入密码 → 设置 cookie）
  - [ ] Step 5 (GREEN): 前端 API 调用适配 cookie 认证
  - [ ] Step 6 (VERIFY): RED 变 GREEN + 全量回归测试通过

- [ ] Task 5b-2: 本地部署脚本 + systemd service
  - [ ] Step 1: 创建部署脚本 `scripts/deploy.sh`（本地编译 → scp → systemctl restart）
  - [ ] Step 2: 创建 systemd service 模板 `papacheck.service`
  - [ ] Step 3 (VERIFY): 本地编译 + SCP → 服务器能启动成功

- [ ] Task 5b-3: 服务器环境配置 + Nginx 反向代理
  - [ ] Step 1: 服务器安装 Node.js 22 + PostgreSQL 16 + Nginx + Python3 + edge-tts
  - [ ] Step 2: 从 Docker 迁移数据（暂停 Docker 容器 → 迁移 SQLite → 启动 systemd）
  - [ ] Step 3: 配置 systemd service + 启动 Node.js 应用
  - [ ] Step 4: 配置 Nginx 反向代理（路径路由 + HTTPS）
  - [ ] Step 5: 验证前端 URL 从 `/` 改为 `/app/` 路径
  - [ ] Step 6: 阿里云安全组关闭 8080 + UFW 仅放行 22/80/443
  - [ ] Step 7: 端到端验证（浏览器访问 `https://papacheck.chengdexy.cn/app/`）

- [ ] Task 5b-4: 全量测试验证
  - [ ] Step 1: PostgreSQL 模式下运行全量测试（Docker PG 容器）
  - [ ] Step 2: SQLite 模式全量回归
  - [ ] Step 3: 前端 Vitest 回归
  - [ ] Step 4: 服务器端到端冒烟测试

## Phase 5c：用户认证系统（JWT + 多租户）[规划]

> 以下为后续阶段任务大纲，待 Phase 5a+5b 完成后创建独立 spec。

- [ ] Task 5c-1: 数据库新增 users / tenants 表及数据模型
- [ ] Task 5c-2: JWT 令牌发行与验证中间件
- [ ] Task 5c-3: 用户注册 / 登录 / 注销 API
- [ ] Task 5c-4: 租户 ID 行级数据隔离（所有查询自动过滤 tenant_id）
- [ ] Task 5c-5: 前端登录页面 + 路由守卫
- [ ] Task 5c-6: 管理员邀请成员机制
- [ ] Task 5c-7: 移除 Phase 5b 的临时 Cookie Session，迁移到 JWT

## Phase 5d：运维增强 [规划]

- [ ] Task 5d-1: CI 自动构建（网络条件就绪后）
- [ ] Task 5d-2: PostgreSQL 数据库定时自动备份
- [ ] Task 5d-3: 服务健康监控 + 告警通知
- [ ] Task 5d-4: 日志管理（轮转、保留策略）

## Phase 5e：客户端适配 [规划]

- [ ] Task 5e-1: Windows 端支持远程服务器地址配置
- [ ] Task 5e-2: Android 端更新 APK 默认服务器地址
- [ ] Task 5e-3: Web 端登录状态持久化
- [ ] Task 5e-4: 离线模式兼容远程服务场景
- [ ] Task 5e-5: 平滑迁移指南

## Task Dependencies

- 5a-2（PostgresAdapter）依赖 5a-1（接口 + SqliteAdapter）
- 5a-3（迁移脚本）依赖 5a-2（PostgreSQL Schema 一致）
- 5b-1（临时认证）依赖 5a-1（数据库就绪），可与 5a-2/3 并行
- 5b-2（部署脚本）独立，可与 5a 并行
- 5b-3（服务器环境）依赖 5b-2（部署脚本）+ 5b-1（认证）
- 5b-4（全量测试）依赖 5a-1/2/3 + 5b-1
- 5c（用户认证）依赖 5a + 5b
- 5d（运维）依赖 5a + 5b
- 5e（客户端）依赖 5c（用户认证就绪）
