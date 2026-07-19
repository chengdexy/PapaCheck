# PapaCheck CloudBase 迁移 - 子计划 6：网关配置与切换回滚

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⚠️ **文档状态：迁移子计划稿，实施方式已变更（2026-07-14 注记）**
> 本文档是 CloudBase 迁移的**子计划稿（预期方案）**，实际落地已与本文多处不符，阅读时以代码与现状文档（README / ARCHITECTURE / PROGRESS）为准：
> - **实时同步**：本文档描述的 CloudBase PG 实时监听（`watch()`）/ RLS 订阅**未落地**；生产实际为前端 `RealtimeManager` 轻量版本戳短轮询（默认 3 秒轮询 `/api/data-version`，变更才拉全量；写后 burst 提速到 1 秒）。
> - **多租户隔离**：本文档依赖的 **RLS（`cloudbase-rls.sql`）未激活**——后端 `postgres-adapter.ts` 用普通 `pg` 连接，不注入 `request.jwt.claims`；隔离实际由应用层 SQL（`WHERE tenant_id=$1 [AND child_id=$2]`）实现。
> - **TTS**：`tts-svc` 由独立仓库维护，**不在本仓库**（仅 `/api/speak`、`/api/pregen-speech` 经网关转发）；本文档「任务 1 配置 tts-svc 路由」指的是已部署的独立云函数，并非仓库内源码。
> - **版本号**：本文档出现的 `v2.0.0` 为设计预期，实际为 Server 1.2.0 / Web 1.5.2 / Android 1.6.6。
> - **表数量**：迁移设计稿原写 26 张表，实际 `init-pg-schema.sql` 建 **27 张表**。

**Goal:** 配置 CloudBase 网关路由（`/papacheck/*` → SCF + 静态托管），执行最终数据迁移与切换，提供回滚预案。

**Architecture:** 通过 CloudBase MCP `manageGateway` 配置路由规则。5 阶段切换：准备 → 验证 → 切换 → 观察 → ECS 下线。回滚通过删除网关路由 + 恢复 ECS 服务实现（< 5 分钟）。

**Tech Stack:** CloudBase Gateway, tcb CLI, pg_dump/restore, MCP

**依赖关系：** 依赖子计划 1-5 全部完成。

**Spec 参考：** `docs/superpowers/specs/2026-07-07-cloudbase-migration-design.md` 第三章「网关路由」+ 第九章「切换方案与回滚预案」

---

## 路由配置清单

| 路径 | 上游类型 | 上游资源 | Path Rewrite |
|------|---------|---------|--------------|
| `/papacheck/api/speak` | SCF | `tts-svc` | - |
| `/papacheck/api/pregen-speech` | SCF | `tts-svc` | - |
| `/papacheck/api/` | SCF | `papacheck-api` | `/api/` |
| `/papacheck/admin/` | STATIC_STORE | - | - |
| `/papacheck/app/` | STATIC_STORE | - | - |
| `/papacheck/` | STATIC_STORE | - | - |

---

### Task 1: 配置 TTS 云函数路由

- [ ] **Step 1: 配置 /papacheck/api/speak 路由**

调用 `manageGateway(action=createRoute, ...)`:
- Path: `/papacheck/api/speak`
- UpstreamResourceType: `SCF`
- UpstreamResourceName: `tts-svc`
- EnablePathTransmission: `true`

- [ ] **Step 2: 配置 /papacheck/api/pregen-speech 路由**

调用 `manageGateway(action=createRoute, ...)`:
- Path: `/papacheck/api/pregen-speech`
- UpstreamResourceType: `SCF`
- UpstreamResourceName: `tts-svc`
- EnablePathTransmission: `true`

- [ ] **Step 3: 验证 TTS 路由可访问**

```bash
curl https://child-teacher-parent-d9aef9d2208-1253991009.ap-shanghai.app.tcloudbase.com/papacheck/api/speak?text=测试
```
Expected: 返回 MP3 音频

---

### Task 2: 配置 papacheck-api 云函数路由

- [ ] **Step 1: 配置 /papacheck/api/ 路由**

调用 `manageGateway(action=createRoute, ...)`:
- Path: `/papacheck/api/`
- UpstreamResourceType: `SCF`
- UpstreamResourceName: `papacheck-api`
- PathRewrite: `{ "Prefix": "/api/" }`
- EnablePathTransmission: `true`

- [ ] **Step 2: 验证 API 路由可访问**

```bash
curl https://child-teacher-parent-d9aef9d2208-1253991009.ap-shanghai.app.tcloudbase.com/papacheck/api/ping
```
Expected: 返回 `{ok: true, serverTime: ...}`

- [ ] **Step 3: 验证认证端点**

```bash
# 无 token 应返回 401
curl https://child-teacher-parent-d9aef9d2208-1253991009.ap-shanghai.app.tcloudbase.com/papacheck/api/data
```
Expected: 401

---

### Task 3: 配置静态托管路由

- [ ] **Step 1: 配置 /papacheck/ 路由**

调用 `manageGateway(action=createRoute, ...)`:
- Path: `/papacheck/`
- UpstreamResourceType: `STATIC_STORE`

- [ ] **Step 2: 验证落地页可访问**

```bash
curl https://child-teacher-parent-d9aef9d2208-1253991009.ap-shanghai.app.tcloudbase.com/papacheck/
```
Expected: 返回 HTML

- [ ] **Step 3: 验证孩子端可访问**

```bash
curl https://child-teacher-parent-d9aef9d2208-1253991009.ap-shanghai.app.tcloudbase.com/papacheck/app/
```
Expected: 返回 HTML

- [ ] **Step 4: 验证管理面板可访问**

```bash
curl https://child-teacher-parent-d9aef9d2208-1253991009.ap-shanghai.app.tcloudbase.com/papacheck/admin/
```
Expected: 返回 HTML

---

### Task 4: 端到端验证（阶段2）

- [ ] **Step 1: 验证完整流程**

使用 CloudBase 默认域名（非 `chengdexy.cn`）进行端到端测试：

```bash
BASE=https://child-teacher-parent-d9aef9d2208-1253991009.ap-shanghai.app.tcloudbase.com/papacheck

# 1. ping
curl $BASE/api/ping

# 2. 登录
TOKEN=$(curl -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"email":"test","password":"test"}' | jq -r '.token')

# 3. 获取数据
curl $BASE/api/data -H "Authorization: Bearer $TOKEN"

# 4. 写入作业
curl -X PUT $BASE/api/homeworks -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"date":"2026-07-07","data":"[]"}'

# 5. APK 下载
curl -I $BASE/api/download
# Expected: 302 redirect

# 6. TTS
curl $BASE/api/speak?text=测试 -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 2: 验证 RLS 隔离**

用 child A 的 JWT 订阅 homeworks，确认看不到 child B 的数据（通过前端实时监听测试）。

- [ ] **Step 3: Android 联调**

构建测试 APK（默认 URL 为 CloudBase 默认域名），安装到设备验证：
- [ ] WebView 加载孩子端
- [ ] 登录 + 数据显示正常
- [ ] 实时监听生效
- [ ] APK 更新检测正常

---

### Task 5: 最终数据迁移（阶段3 - 切换日）

- [ ] **Step 1: 设置 ECS 维护页（停写窗口）**

```bash
ssh root@123.57.129.243 "echo 'maintenance' > /opt/papacheck/maintenance.html"
```

选择凌晨低峰期（02:00-02:30）执行。

- [ ] **Step 2: 全量数据导出**

```bash
ssh root@123.57.129.243 "sudo -u papacheck pg_dump -Fc -d papacheck -f /tmp/papacheck-final.dump"
scp root@123.57.129.243:/tmp/papacheck-final.dump /tmp/
```

- [ ] **Step 3: 恢复到 CloudBase PG**

```bash
$cloudUrl = "postgresql://<user>:<pass>@<cloudbase-pg-host>:<port>/postgres"
pg_restore -d $cloudUrl --no-owner --no-acl --clean --if-exists /tmp/papacheck-final.dump
```

- [ ] **Step 4: 行数校验**

```sql
-- 在 CloudBase PG 上执行
SELECT 'users' as t, COUNT(*) FROM users
UNION ALL SELECT 'children', COUNT(*) FROM children
UNION ALL SELECT 'homeworks', COUNT(*) FROM homeworks
UNION ALL SELECT 'access_codes', COUNT(*) FROM access_codes;
```

调用 `queryPgDatabase(action=sql, sql=...)` 对比 ECS 行数。

---

### Task 6: 配置 chengdexy.cn 路由（切换）

- [ ] **Step 1: 配置 chengdexy.cn 上的 /papacheck/* 路由**

`chengdexy.cn` 已绑定到 CloudBase 网关。通过 MCP `manageGateway(action=createRoute)` 在 `chengdexy.cn` 域名下创建上述所有路由（Task 1-3 的路由配置到 `chengdexy.cn` 而非默认域名）。

- [ ] **Step 2: 验证生产路径**

```bash
curl https://chengdexy.cn/papacheck/api/ping
curl https://chengdexy.cn/papacheck/
curl https://chengdexy.cn/papacheck/app/
curl https://chengdexy.cn/papacheck/admin/
```
Expected: 全部返回正确响应

- [ ] **Step 3: 推送新版 Android APK**

```bash
# 构建正式 APK（默认 URL 改为 chengdexy.cn/papacheck/app/）
cd PapaCheck.Android
flutter build apk --release --build-name=1.6.0

# 上传到云存储
tcb storage objects upload build/app/outputs/apk/release/PapaCheck-1.6.0.apk --dist/ --envId child-teacher-parent-d9aef9d2208

# 更新云函数环境变量
tcb fn update papacheck-api --env APK_VERSION=1.6.0 --envId child-teacher-parent-d9aef9d2208
```

- [ ] **Step 4: 移除 ECS 维护页**

```bash
ssh root@123.57.129.243 "rm -f /opt/papacheck/maintenance.html"
```

注意：ECS 服务不立即停止，作为回滚备份保留 1 周。

---

### Task 7: 观察期监控（阶段4）

- [ ] **Step 1: 监控 API 错误率**

通过 CloudBase 控制台 → 云函数 → `papacheck-api` → 监控，检查 24-48 小时内：
- 错误率 < 5%
- 平均响应时间 < 500ms
- 冷启动次数可接受

- [ ] **Step 2: 监控 PG 连接数**

```sql
SELECT count(*) AS current, count(*) FILTER (WHERE state = 'active') AS active
FROM pg_stat_activity;
```
Expected: < 80% of 2048

- [ ] **Step 3: 监控实时监听延迟**

在前端 console 日志检查实时推送延迟 < 2s。

- [ ] **Step 4: 收集用户反馈**

确认无 P0 问题（无法登录、数据丢失、实时监听失效等）。

---

### Task 8: ECS 下线（阶段5 - 切换后 1 周）

- [ ] **Step 1: 确认无需回滚**

观察期 1 周后，确认：
- 无 P0 问题
- 用户反馈正常
- 数据一致

- [ ] **Step 2: 备份 ECS 最终数据**

```bash
ssh root@123.57.129.243 "sudo -u papacheck pg_dump -Fc -d papacheck -f /tmp/papacheck-final-backup.dump"
scp root@123.57.129.243:/tmp/papacheck-final-backup.dump /tmp/
```

- [ ] **Step 3: 停止 ECS 服务**

```bash
ssh root@123.57.129.243 "systemctl stop papacheck && systemctl disable papacheck"
```

- [ ] **Step 4: 释放 ECS 资源**

通过阿里云控制台释放 ECS 实例。

- [ ] **Step 5: 清理 DNS（可选）**

如不再需要 `papacheck.chengdexy.cn` 子域名，删除 DNS A 记录。

---

### Task 9: 更新项目文档

**Files:**
- Modify: `README.md`
- Modify: `docs/PRD.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/API.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/HANDOVER.md`

- [ ] **Step 1: 更新 README.md**

- 版本号更新为 v2.0.0（重大架构变更）
- 技术栈表格：移除 ECS/Nginx/systemd，新增 CloudBase SCF/PG/网关/静态托管
- 快速开始：移除 ECS 访问地址，改为 `chengdexy.cn/papacheck/`
- 项目结构：新增 `PapaCheck.CloudFunc/` 目录
- 核心特性：移除"离线可用"，新增"实时数据同步"

- [ ] **Step 2: 更新 docs/PRD.md**

- 移除邮件同步功能
- 移除离线模式
- 新增实时数据同步功能
- 更新部署架构描述

- [ ] **Step 3: 更新 docs/ARCHITECTURE.md**

- 系统架构图：替换为 CloudBase 架构
- 技术栈表：CloudBase PG/SCF/网关/静态托管
- 部署方式：移除 systemd + Nginx，改为 CloudBase
- 数据模型：新增 RLS 策略说明
- 关键设计决策：更新为实时监听替代轮询

- [ ] **Step 4: 更新 docs/API.md**

- 所有 API 路径前缀从 `/api/*` 改为 `/papacheck/api/*`
- 移除邮件同步 API（`/api/email/*`）
- 移除运维 API（`/api/ops/*`）

- [ ] **Step 5: 更新 docs/CHANGELOG.md**

```markdown
## [Unreleased]

### Added
- 迁移到腾讯云 CloudBase（云函数 + PG + 静态托管 + 网关）
- 前端实时数据同步（CloudBase PG 实时监听，替代 5s 轮询）
- RLS 行级安全策略（14 张业务表 tenant/child 隔离）
- Release 控制台新增 `fn` 和 `all` 子命令（tcb CLI 部署）

### Changed
- API 路径前缀从 `/api/*` 改为 `/papacheck/api/*`
- 前端路径前缀从 `/app/` 改为 `/papacheck/app/`
- Android 默认地址改为 `chengdexy.cn/papacheck/app/`
- 部署方式从 ECS + systemd + Nginx 改为 CloudBase

### Removed
- 离线模式（Service Worker / localforage / CRDT / Android 写队列）
- 邮件同步功能（IMAP + AI 解析 + 附件下载）
- 运维调度器（OpsScheduler / 备份 / 监控 / 告警）
- Swagger API 文档
- ECS 服务器（阿里云释放）
```

- [ ] **Step 6: 更新 docs/PROGRESS.md**

- 当前版本改为 v2.0.0
- 部署状态：移除 ECS 相关，新增 CloudBase 部署状态
- 已完成功能：新增 CloudBase 迁移、实时监听；移除离线模式、邮件同步
- 最近变更表添加 CloudBase 迁移记录

- [ ] **Step 7: 更新 docs/HANDOVER.md**

- 服务器信息：移除 ECS，新增 CloudBase 环境信息
- 域名与端点：更新为 `chengdexy.cn/papacheck/*`
- 部署流程：更新为 Release 控制台 `all` 命令
- 回滚预案：更新为删除网关路由 + 恢复 ECS（1 周内）
- 移除 PostgreSQL 配置（改由 CloudBase 托管）
- 移除 systemd 服务配置
- 移除 Nginx 配置

- [ ] **Step 8: 提交**

```bash
git add README.md docs/
git commit -m "docs: 更新全部项目文档反映 CloudBase 迁移"
```

---

### Task 10: 回滚预案（如需）

**触发条件**：API 错误率 > 10% / 数据丢失 / 实时监听失效 / 用户大面积反馈

- [ ] **Step 1: 删除 CloudBase 网关路由（< 1 分钟）**

```bash
tcb gateway delete-route --path /papacheck/api/ --envId child-teacher-parent-d9aef9d2208
tcb gateway delete-route --path /papacheck/ --envId child-teacher-parent-d9aef9d2208
```

- [ ] **Step 2: 恢复 ECS 服务（< 2 分钟）**

```bash
ssh root@123.57.129.243 "rm -f /opt/papacheck/maintenance.html && systemctl restart papacheck"
```

- [ ] **Step 3: 回滚 Android APK（< 2 分钟）**

```bash
tcb storage objects upload PapaCheck-1.5.2.apk --dist/ --envId child-teacher-parent-d9aef9d2208
tcb fn update papacheck-api --env APK_VERSION=1.5.2 --envId child-teacher-parent-d9aef9d2208
```

- [ ] **Step 4: 通知用户重新打开 APP**

用户打开 APP 后自动检测降级到 1.5.2，连接 ECS。

---

## 完成标准

- [ ] CloudBase 网关路由全部配置完成（6 条路由）
- [ ] `chengdexy.cn/papacheck/*` 全部可访问
- [ ] 端到端验证通过（API + 前端 + Android）
- [ ] 数据迁移完成，行数校验通过
- [ ] 切换后 48 小时无 P0 问题
- [ ] ECS 资源释放
- [ ] 回滚预案已验证
- [ ] 项目文档全部更新

## 后续衔接

- 迁移完成后实施微信扫码登录（独立项目）
