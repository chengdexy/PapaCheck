# Checklist — Phase 5: 上云 + 多租户 SaaS 化

> 逐项检查通过后对应阶段才算完成。

---

## Phase 5a：PostgreSQL 适配

### 数据库抽象层
- [x] `IDatabase` 接口定义完整（~40 个方法），类型定义完备
- [x] `DatabaseAdapter` 抽象基类提取了通用工具方法（`_safeJsonParse`、`_findByUuid`、`_classifyChange`、`_filterDeleted`）
- [x] `SqliteAdapter extends DatabaseAdapter` 包含原 `PapaCheckDB` 全部逻辑
- [x] 工厂函数 `createDatabase()` 根据配置返回正确实例
- [x] `app.ts` 使用 `createDatabase()` 代替 `new PapaCheckDB()`
- [x] `PapaCheckDB` 作为别名保留向后兼容
- [x] SQLite 模式全量回归测试通过（515 tests）

### PostgresAdapter
- [x] `PostgresAdapter` 实现 `IDatabase` 全部方法
- [ ] Docker PostgreSQL 容器运行 TDD 测试全部通过（需手动运行：需 DATABASE_URL 环境变量）
- [x] JSON-in-column 模式，数据格式与 SQLite 一致
- [x] SQLite 模式回归不受影响

### 数据迁移
- [x] `init-pg-schema.sql` 包含全部 20 张表
- [x] `migrate-to-pg.ts` 可逐表迁移 SQLite → PostgreSQL
- [ ] 迁移后行数校验通过（SQLite = PostgreSQL）（需手动验证：需要运行中 PostgreSQL）
- [x] 迁移脚本幂等（使用 `ON CONFLICT DO NOTHING/UPSERT`）

---

## Phase 5b：部署架构重构

### 临时安全防护（Cookie Session）
- [x] 未登录访问 `/api/*` 返回 401（auth-plugin.test.ts 验证）
- [x] 登录后可正常访问
- [x] Cookie session 持久化（`@fastify/cookie`，30 天有效期）
- [x] 部署密码自动生成并打印到日志
- [x] 登录页面极简可用（`login.html`）
- [x] 全量回归测试通过

### 部署脚本 + systemd
- [x] 部署脚本 `scripts/deploy.sh` 可用（编译 → scp → restart）
- [x] systemd service `papacheck.service` 正确配置

### 服务器环境
- [ ] Node.js 22 正确安装
- [ ] PostgreSQL 16 正确安装并运行
- [ ] Nginx 正确安装并配置反向代理
- [ ] Python 3 + edge-tts 正确安装（TTS 可用）
- [ ] systemd `papacheck.service` 开机自启 + 崩溃重启正常
- [ ] 旧 Docker 容器已停止并清理
- [ ] 安全组 8080 已关闭
- [ ] UFW 只放行 22/80/443
- [ ] 浏览器访问 `https://papacheck.chengdexy.cn/app/` 显示登录页
- [ ] 输入密码后可正常使用所有功能
- [ ] Android 端修改配置后可用

### 全量测试
- [ ] PostgreSQL 模式全量测试通过
- [ ] SQLite 模式全量回归通过
- [ ] 前端 Vitest 测试通过
- [ ] 服务器端到端冒烟测试通过（ping → data → CRUD 流程）

---

## Phase 5c：用户认证系统（JWT + 多租户）[后续]

- [ ] *待 Phase 5a+5b 完成后创建独立 spec*

## Phase 5d：运维增强 [后续]

- [ ] *待 Phase 5a+5b 完成后创建独立 spec*

## Phase 5e：客户端适配 [后续]

- [ ] *待 Phase 5c 完成后创建独立 spec*
