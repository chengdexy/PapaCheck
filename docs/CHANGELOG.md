# PapaCheck 变更日志

> 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)

---

## [Unreleased]

### Added
- **统一登录页重写**：`login.html` 完全重写，新增渐变背景、白底圆角卡片、最近使用列表（localStorage 持久化，最多 5 条）、家长/孩子角色选择按钮。新码登录后自动保存到最近使用。新增 15 个 TDD 测试。全量 627 测试通过
- **管理面板适配新模型**：`AddMemberForm` 删除角色选择，只接收孩子姓名；`MemberTable` 删除角色列，按孩子展示；`BrandHeader` 合并为孩子端/家长端为"客户端"链接；后端 `admin/routes.ts` 适配新 access_codes 结构
- **管理员页面头部显示孩子名**：`admin.html` header 新增 `#childNameDisplay`，显示 `👤 孩子名`
- **登录流程优化**：点击角色按钮时若已输入访问码直接触发登录，不再需要额外点击"进入"

### Fixed
- **`/app` 路由无法判断角色导致死循环**：服务端 `/app` 无法读取浏览器页面导航的 Authorization header，导致家长登录后被跳转到 `/login.html` → `/app` 死循环。改为前端按 sessionStorage role 分流：家长→`/admin.html`，孩子→`/`
- **管理面板孩子名不显示**：`GET /api/admin/members` 数据源从 access_codes 改为 children 表后，现有数据的 `child_id` 为 null 导致关联不上。执行数据迁移填充 `child_id`，更新迁移脚本 Step 2 为自动执行
- **`login.html` 角色按钮无反应**：角色按钮只切换选中态，没有触发登录入口。改为选择角色时若已有访问码直接调用 exchange API

### Fixed
- **`_setJson` 只做 UPDATE 不处理行不存在的情况**：新租户的 `bounty_tasks`/`shop_items` 等表无初始行时，UPDATE 影响 0 行导致数据静默丢弃。改为 UPDATE + INSERT（`ON CONFLICT DO NOTHING`）模式，兼容多孩子迁移引入的部分唯一索引（`WHERE child_id IS NULL`）
- **`refreshAllData()` 结算数据跨孩子泄露**：合并循环未追踪 `cachedData` 来自哪个孩子，切换孩子时将前一个孩子的已评级结算合并到新孩子数据中。新增 `_loadedChildId` 守卫，仅当未切换孩子时才执行合并
- **`_doReconnect()` 清除 `window._currentChildId` 导致父端 child_id 隔离丢失**：重连时 `API.getData()` 不带参数将 `window._currentChildId` 设为 `undefined`，后续父端 API 调用丢失 query param 隔离。在 `_doReconnect()` 前后保存/恢复 `window._currentChildId`
- **家长端离线→在线后孩子选择器不恢复**：`loadChildren()` 在初始离线加载失败后不再重试，孩子列表永久为空。`refreshAllData()` 检测到在线但孩子未加载时自动重试（权限不足的 parent 角色通过 `_childrenLoadFailed` 标志排除）
- **同一浏览器内家长端和孩子端 token 碰撞**：`login.html` 对两种角色使用同一 `localStorage` 键 `papacheck_token`，孩子登录后覆盖家长 JWT，导致家长端 API 调用携带孩子 token。孩子端改用独立键 `papacheck_child_token`，`getAuthHeaders()` 通过 `window._authTokenKey` 选择正确键

### Added
- **多孩子支持（Phase 1+2）**：每个家庭支持多个孩子，数据按 child_id 隔离
  - `children` 表：id、tenant_id、name、avatar、access_code_id、is_active
  - 12 张 per-child 表添加 `child_id` 列 + partial unique index
  - `DatabaseAdapter` / `PostgresAdapter` 所有 per-child 方法新增 `childId` 参数
  - `POST /api/auth/exchange`：child 角色自动查/建 children 记录，JWT 含 child_id
  - `POST /api/admin/members`：child 角色自动创建 children 记录 + 遗留数据分配
  - `DELETE /api/admin/members/:id`：清理 children.access_code_id 但不删 children
  - `GET /api/admin/members`：响应含 child_id
  - 家长端：孩子选择栏 + localStorage 持久化 + 按 child_id 拉数据
  - 孩子端：后端 JWT.child_id 自动过滤，前端无改动
  - `init-pg-schema.sql` 含迁移段（ALTER ADD COLUMN + DROP PK + UNIQUE INDEX）
- **本地测试数据库搭建脚本**：`scripts/setup-test-db.ps1` 一键完成 PG 检测→建测试库→建表→生成 `.env.test`（[#setup-test-db.ps1](file:///e:/trae_projects/PapaCheck/PapaCheck.Server.Node/scripts/setup-test-db.ps1)）
- **`vitest.config.js` 自动加载 `.env.test`**：自动读取 `PapaCheck.Server.Node/.env.test`，不覆盖已存在的 `DATABASE_URL` 环境变量（[#vitest.config.js](file:///e:/trae_projects/PapaCheck/vitest.config.js)）
- **调试配置 launch.json**：3 个调试配置（全功能调试 F5 + 当前文件测试 + 全量测试）+ 复合任务"启动 + 测试"

### Fixed
- **postgres-adapter.test.ts 6 个测试修复**：添加测试租户上下文，适配 PostgreSQL 的 `tenant_id` NOT NULL 约束（[#postgres-adapter.test.ts](file:///e:/trae_projects/PapaCheck/PapaCheck.Server.Node/test/db/postgres-adapter.test.ts)）
- **api.test.ts 44 个测试修复**：注入 `onRequest` hook 提供 JWT payload，解决无认证环境下 `tenant_id` 为空导致的 500 错误；通知测试 SQLite `(db as any).db.prepare` 改为 `pool.query`（[#api.test.ts](file:///e:/trae_projects/PapaCheck/PapaCheck.Server.Node/test/api.test.ts)）
- **email.test.ts 3 个测试修复**：注入 `onRequest` hook 提供 JWT payload + 初始化默认行（[#email.test.ts](file:///e:/trae_projects/PapaCheck/PapaCheck.Server.Node/test/email.test.ts)）
- **`src/index.ts` 清理废弃 `--db-path` 参数**：SQLite 退役后残留的命令行参数（[#index.ts](file:///e:/trae_projects/PapaCheck/PapaCheck.Server.Node/src/index.ts)）

### Removed
- **删除 3 个 SQLite 专属死测试**：`redemption_dup_check.test.ts`、`shop_daily_reset.test.ts`、`reward_box_delete.test.ts`（硬编码 `describe.runIf(false)`，业务逻辑已被 `api.test.ts` 覆盖）

## [1.3.8] - 2026-06-21

### Added
- **Android 原生写队列（Phase 3）**：新增 Kotlin 桥接层（Room 本地队列持久化 + WorkManager 指数退避重试 + OkHttp 原生 HTTP 直连），绕过 WebView 锁屏 fetch 冻结问题；Flutter Dart 层新增 `PapaCheckBridge` JavaScriptChannel + MethodChannel 三层桥接（H5→Dart→Kotlin→Server）；`MainActivity` 注册 `QueueBridge`；新增 `POST /api/sync/write` 统一写端点（复用 Phase 0.2 幂等保证）；`AndroidManifest` 新增 `FOREGROUND_SERVICE`、`ACCESS_NETWORK_STATE`；`build.gradle` 新增 Room/WorkManager/OkHttp 依赖（[#QueueBridge.kt](file:///e:/trae_projects/PapaCheck/PapaCheck.Android/android/app/src/main/kotlin/com/example/papacheck_android/queue/QueueBridge.kt)）
- **`hasCRDTOperation` 数据库方法**：新增 `IDatabase` 接口方法，4 个文件同步新增（types.ts、adapter.ts、postgres-adapter.ts、sqlite-adapter.ts），用于检查 CRDT 操作是否已存在（[#types.ts](file:///e:/trae_projects/PapaCheck/PapaCheck.Server.Node/src/db/types.ts)）
- **`API.optimisticWrite` + `API.pushOperation`**：新增乐观写入统一入口，立即更新内存 UI → 异步 fetch 上报 → 失败回滚 + toast；支持 `window.PapaCheckBridge.enqueue` 原生桥接检测（[#api.js](file:///e:/trae_projects/PapaCheck/PapaCheck.Web/js/api.js)）
- **`DB.getCachedData`**：新增同步方法返回内存 `this._data`，用于跨模块数据访问（[#db.js](file:///e:/trae_projects/PapaCheck/PapaCheck.Web/js/db.js)）

### Changed
- **SQLite 完全退役（Phase 2）**：删除 `SqliteAdapter`（1606 行）及 6 个关联文件；`db/index.ts` 仅支持 `PostgresAdapter`；`app.ts`/`index.ts` 移除 `dbPath` 参数；`package.json` 移除 `better-sqlite3`/`@types/better-sqlite3` 依赖及 `migrate:pg`/`build:sea` 脚本（[#sqlite-adapter.ts](file:///e:/trae_projects/PapaCheck/PapaCheck.Server.Node/src/db/sqlite-adapter.ts)）
- **db.js 改为只读缓存模式（Phase 1）**：13 个 `saveXxx` 方法移除 `this._save()`（IndexedDB 写入）和 `ChangeLog.add()` 调用，仅更新内存 `this._data`；`cacheFullData` 保持不变（仍写 IndexedDB 作为只读缓存）（[#db.js](file:///e:/trae_projects/PapaCheck/PapaCheck.Web/js/db.js)）
- **crdtPull 简化为纯全量拉取（Phase 1）**：删除前端 CRDT 合并空壳代码，`crdtPull` 仅调用 `_refreshFromServer()` 全量覆盖（[#sync.js](file:///e:/trae_projects/PapaCheck/PapaCheck.Web/js/sync.js)）
- **服务端 CRDT 合并引擎简化（Phase 1）**：删除 `mergePNCounter`、`mergeORSet`、`isPNCounterState`、`isORSetState` 及对应类型定义；`applyOperation` 仅保留 LWW（[#merge.ts](file:///e:/trae_projects/PapaCheck/PapaCheck.Server.Node/src/crdt/merge.ts)）

### Fixed
- **`_syncInProgress` 锁卡死修复（Phase 0.1）**：`crdtFullSync` 新增 15s 超时强制释放 + `forceReleaseLock()` 外部释放入口；`finally` 块通过 `_syncStartedAt` 比较防止锁误释放（[#sync.js](file:///e:/trae_projects/PapaCheck/PapaCheck.Web/js/sync.js)）
- **`connection.js` timeout 分支修复（Phase 0.1）**：超时后调用 `SyncEngine.forceReleaseLock()` + 保持 `offline` + 提前 `return`（[#connection.js](file:///e:/trae_projects/PapaCheck/PapaCheck.Web/js/connection.js)）
- **`crdt-push` 假幂等修复（Phase 0.2）**：`POST /api/sync/crdt-push` 先 `hasCRDTOperation` 查重，重复 op 跳过 `applyCRDTOperation`（[#app.ts](file:///e:/trae_projects/PapaCheck/PapaCheck.Server.Node/src/app.ts)）
- **移除废弃的 `CRDTLog.migrateFromChangeLog`**：删除方法及 `app.js`/`admin.js` 调用（[#crdt-sync.js](file:///e:/trae_projects/PapaCheck/PapaCheck.Web/js/crdt-sync.js)）
- **sync.js 清理旧合并函数（Phase 4）**：删除 8 个废弃函数，sync.js 从 345 行精简至 144 行（[#sync.js](file:///e:/trae_projects/PapaCheck/PapaCheck.Web/js/sync.js)）
- **`change-log.js` 完全删除（Phase 4）**：删除整文件及 3 处引用 + 遗留测试（[#change-log.js](file:///e:/trae_projects/PapaCheck/PapaCheck.Web/js/change-log.js)）
- **MainActivity 协程泄漏**：`MainScope()` 在 `onDestroy` 中未 `cancel()`，添加 `scope.cancel()` + `import kotlinx.coroutines.cancel`
- **失败操作清除后未重新入队**：`getFailedOperations` 从 `clearFailed` 改为 `resetFailedToPending` + `WriteQueueWorker.enqueue` 重试
- **APK 构建失败**：`build.gradle` JVM 目标从 1.8 升到 17（kapt 兼容）；`ApiClient.kt` 使用 `resumeWith(Result.failure(e))`（kotlinx-coroutines 1.7.3 API 兼容）

### Security
- **PG 数据库密码加固**：线上 `DATABASE_URL` 密码从占位符 `changeme` 改为强密码 `DaRkMoOn`
- **Android `AndroidManifest.xml`**：新增 `FOREGROUND_SERVICE`、`ACCESS_NETWORK_STATE` 权限

## [Unreleased]

### Fixed
- **Voice.speak 在 localStorage 不可用时崩溃**：隐私模式（Safari/Firefox）或第三方 cookie 禁用时 `localStorage.getItem` 抛 `SecurityError`，导致 TTS 语音完全不可用。改为复用 `PapaCheck.Web/js/api.js` 的 `getAuthHeaders()`（自带 try-catch 保护），与项目其他 API 请求保持一致。**全量 666 测试通过**（+1 新 vm 沙箱真实代码片段测试覆盖回归）

### Added
- **/api/speak 鉴权改造（安全加固）**：将 TTS 语音合成端点从 `PUBLIC_PATHS` 白名单移除，改为需 JWT 鉴权；`PapaCheck.Web/js/app.js` 的 `Voice.speak` fetch 增加 `Authorization: Bearer <token>` 头（已登录时携带，未登录时降级处理）；新增 6 个 TDD 测试覆盖服务端 401/有效 token 200、中间件拦载、编译产物一致、前端携带 auth 头等场景。消除匿名滥用 TTS 上游、磁盘缓存无界增长、Python 服务端 CORS `*` 等 7 项隐患

### Changed
- **Web 通用代码重构**：提取 app.js 和 admin.js 中重复的通用代码（`showTransitionMask`、`hideTransitionMask`、`escapeHtml`、Service Worker 注册、页面刷新检测）到共享模块 `common.js`，消除约 100 行重复代码。更新 HTML 加载顺序在依赖脚本前引入 common.js。适配 4 个测试文件的 VM 上下文和提取源路径。全量 657 测试通过
- **路由优化**：孩子端路径从 `/{admin.html}` 改为语义化路径 `/child`、`/parent`、`/login`。官网落地页导航栏、家庭管理面板、超管面板新增图标式角色入口按钮。Android 端同步更新 URL 拼接逻辑。全量 660 测试通过

### Fixed
- **落地页吉祥物方向错误**：`mascot-ok.png`（OK 手势）和 `mascot-point.png`（指向右侧）的角色朝向与设计意图相反，水平翻转纠正
- **preload `imagesrcset` 兼容性**：`index.html` 的 `<link rel="preload" as="image">` 上的 `imagesrcset` 仅在 Chrome 121+ / Firefox 128+ / Safari 17.4+（2024 年起）才生效，对老浏览器是无效配置；移除该属性，统一回退到 `href`（1x 兜底），由组件内 `srcset` 负责 2x 选择
- **落地页 footer 大屏留白不足（二次修复）**：`Footer.tsx` 垂直内边距 `py-10`（40px）相比其他 section 的 `py-20 md:py-28`（80/112px）缩水一半，在 1920px+ 大屏下显得被"压扁"在页面底部。初次修复将 `py-16 md:py-20 lg:py-24` 加在 `hero-container` div 上，但被该 CSS 类的 `padding: 0 1.5rem` 覆盖（`.hero-container` 定义在 Tailwind utilities 之后，同级选择器源顺序优先），实际渲染 padding=0。二次修复将 padding 搬到 `<footer>` 元素上，避开 CSS 冲突。
- **nginx `index.html` cache header 缺失**：`location /` 之前无 `Cache-Control`，依赖浏览器启发式缓存，导致 `release.py --site` 部署新代码后用户必须硬刷新（Ctrl+Shift+R）才能看到新内容；改为 `no-cache, must-revalidate` 强制每次 revalidate（开销几乎为 0），配合现有 ETag 机制，deploy 后下次访问即生效；同时将 `/assets/*` 的 cache 设为 1 年 `immutable`（Vite 输出全部带 content-hash，URL 变了就是新文件，缓存 1 年绝对安全）。**坑点**：用 `expires 1y` 会被 nginx 自动生成 `Cache-Control: max-age=31536000` 并**抑制**同位置的 `add_header Cache-Control`，最终响应会同时出现两条 `cache-control` 头，浏览器行为不可预测；正确做法是只用 `add_header`，不要 `expires`。
- **Let's Encrypt 证书续期路径被 301 阻断 + authenticator 误用 standalone**：HTTP server block 中 `return 301` 在 server 级别直接拦截所有请求（包括 `/.well-known/acme-challenge/`），nginx 不会为其匹配 location 块；修复为将 301 移入 `location /`，让 `location /.well-known/acme-challenge/` 以更高优先级匹配。同时 certbot renewal config 的 `authenticator = standalone` 与 nginx 占用的 80 端口冲突（standalone 模式需要临时启动自己的 HTTP 服务器），改为 `webroot`（`/var/www/certbot`），certbot renew --dry-run 验证通过。**坑点**：PowerShell 5 下 `$()`、`&&` 等符号会被本地解析而非透传 SSH，后续运维脚本统一用 bash 脚本文件 scp + SSH 执行避免转义混乱。

  - **孩子端离线/在线同步系统 11 个问题修复（基于代码审查报告 `docs/offline-sync-audit.md`）**：
  - **P0（数据丢失）**：`CRDTLog.append()` 加 `await` 和 `console.error`（22 处）；离线降级函数空 catch 改 `console.error` + `return false`（18 处）
  - **P1（同步失败）**：`pollServer` 空 catch 加 `console.error`；`_doReconnect` 中 CRDT 同步失败后抛异常阻止切 `online`；`_refreshFromServer` 静默失败加 `console.warn`
  - **P2（体验降级）**：`wakeUp` 添加 CM 模式等待重试机制；`init` 离线恢复用 `API.getData()` 替换 `location.reload()`
  - **P3（架构隐患）**：CRDTLog `nodeId` 改为 session 级别持久 ID，避免每次操作随机生成
  - **审查自修复**：`_doReconnect` 增加 `crdtAttempted` 标记区分"跳过 CRDT"与"CRDT 失败"（SyncEngine 不可用时不再错误阻止上线）；`wakeUp` 重试前清理旧 interval 防止泄漏
  - 全量 **657 测试**通过

### Added
- **Phase 5d 运维增强**：PostgreSQL 自动备份（每日 03:00，保留 3 份）+ 健康监控（磁盘/PG/备份状态，每 5 分钟）+ 邮件告警（状态机去重 30 分钟抑制窗口，SMTP 配置）。新增 13 个 TDD 测试，全量 657 测试通过
- **超管面板系统健康页面**：磁盘/内存/Swap 使用率卡片、PostgreSQL 状态、备份管理（列表/下载/手动触发）、告警历史、运维配置编辑 Modal（阈值/SMTP）
- **SMTP 密码 AES-256-GCM 加密**：通过 `ENCRYPTION_KEY` 环境变量加密存储，面板返回时自动掩码为 `***`
- **7 个运维 API 端点**：`/api/ops/health`、`/api/ops/backups`、`/api/ops/backups/:id/download`、`/api/ops/backups/trigger`、`/api/ops/config`（GET/PUT）、`/api/ops/config/smtp/test`

### Changed
- **部署脚本更新**：`deploy.sh` 新增备份目录创建步骤，`release.py` 新增备份目录存在性检查
- **systemd service**：新增 `ENCRYPTION_KEY` 环境变量

### Fixed
- **修复孩子端评级后"回到首页"按钮无效**：`updateBigScreen()` 防御块在 `forceMainPage = true` 时仍强制显示结算页，导致孩子点击"回到首页"后立即被拉回评级页。修复为已查看过评级的结算（`viewedAt` 已设置）不再强制显示
- **修复家长/孩子访问码登录无限循环 Bug**：`auth/middleware.ts` 对所有角色统一用 `users.token_version` 验证 JWT，但 parent/child 的 JWT `token_version` 来自 `access_codes` 表。当用户账号改过密码（`users.token_version` 递增）后，parent/child 的 JWT `token_version < users.token_version` 被错误拒绝（401），导致 `/app/admin.html` 无限重定向到登录页。修复为按角色区分验证：parent/child 查 `access_codes.token_version`（通过 `member_id`），admin/user 查 `users.token_version`。新增 5 个 TDD 测试
- **删除废弃的 `regenerateMemberHash` 和 `deactivateMember` 方法**：两个方法已无调用方，参数名沿用旧模型语义（`userId` 实为 access_code_id、`tenantId` 实为 user_id），SQL 绑定易误解。直接从 PG 和 SQLite 适配器中删除
- **修复 `deactivateMember` 和 `regenerateMemberHash` 引用已删除的列**：两个方法引用了 `users.tenant_id`/`access_hash`（已删除），PG 和 SQLite 中均会报 column-not-found 错误。且 `deactivateMember` 参数顺序颠倒、SQLite 版误改为 `DELETE FROM access_codes`。已统一修复为正确的 `UPDATE users` 或指向 `access_codes` 表，标注废弃
- **移除测试文件中的调试 `console.log`**
- **修复 SQLite 适配器表结构与 PG 不一致**：`users` 表仍含已删除的 `tenant_id`/`access_hash` 列，`access_codes` 表缺少 `last_login`/`access_code` 列，导致 SQLite 模式下测试和服务均失败（`NOT NULL constraint failed`）。已对齐 PG 表结构并修复 8 个查询方法
- **修复速率限制返回 500 而非 429**：`errorResponseBuilder` 返回对象缺少 `statusCode` 字段，错误处理器取 `undefined || 500` 返回 500。已补上 `statusCode: 429`
- **修复测试 mock DB 缺少 `updateAccessCodeLastLogin` 方法**：4 个测试文件的 mockDb 未实现新接口，调用时抛 TypeError，exchange 端点返回 500
- **修复 release.py site_publish 第 2 步卡死**：`site_publish` 的 SSH `mkdir` 和 `scp -r dist/*` 缺少超时保护，且 `dist/*` glob 在 Windows PowerShell 下不展开导致永久卡住；改为 tar 打包+SSH 管道解压替代 SCP glob，所有命令加超时和 `UserKnownHostsFile=NUL`
- **代码审查修复 4 个 Issue**：备份下载 `getBackupFilePath` 硬编码路径改为从配置读取（修复非默认备份目录下载失败）；告警恢复检测 `allStateKeys` 硬编码改为共享常量 `ALL_ALERT_KEYS`（消除新增告警类型时 drift 风险）；`sendAlertEmail`/`sendDailyReport` 添加 `transport.close()`（修复 SMTP 连接泄漏）；`pruneOldBackups` 将 `getOpsConfig()` 提升到循环外（消除 N 次冗余查询）
- **pruneOldBackups 路径遍历防护**：改用 `getBackupFilePath()` 替代裸 `join()`，增加文件名格式校验和路径遍历防护
- **runBackup 路径遍历防护**：抽取 `resolveBackupPath()`（不含 existsSync），`runBackup` 改用该校验生成 filePath，统一防护

### Added
- **访问码最后登录时间**：`access_codes` 表新增 `last_login` 列，`POST /api/auth/exchange` 时自动记录；管理面板成员列表"最后登录"列显示实际时间，不再始终显示"从未"
- **Member ID 字段**：JWT Payload 新增 `member_id`，子端访问码交换时 `sub` 指向 user 账号（避免依赖已删除的 parent/child 行），`member_id` 指向 `access_codes.id` 用于区分家庭成员

### Changed
- **数据库模型清理**：删除 `users` 表废弃列 `access_hash`、`access_code_plaintext`、`access_code`、`last_login`、`tenant_id`（`tenant_id` 已迁移为 `users.id` 自引用）
- **`tenant_id` 值迁移**：21 张数据表的 `tenant_id` 值从旧 tenant UUID 更新为对应的 user 账号 id，修复迁移后数据查询不到的问题
- **`getUserById` 返回字段补全**：补充 `email`、`password_hash`、`family_name`、`first_login` 字段
- **全局速率限制从 1000/min 放宽到 10000/min**：缓解 Nginx 反代后共享限流桶问题
- **错误处理器默认状态码从 429 改为 500**：避免 PostgreSQL 错误对象无 `statusCode` 属性时误导为"请求过于频繁"

### Fixed
- **修复重新生成访问码返回 429 问题**：根因为 `access_codes` 表缺失 `token_version` 列，UPDATE 时 PostgreSQL 报错 `42703`（undefined_column），错误处理器无 `statusCode` 时默认 429 误导。已补加 `token_version` 列并修正错误处理器默认状态码
- **修复管理面板成员列表访问码显示为"需重新生成"**：`GET /api/admin/members` 未返回 `access_code` 字段，现已返回；同时新增 `access_code` 明文列存储新生成的访问码，复制功能正常可用
- **修复孩子端全部作业完成后不弹出结算界面**：`getSettlementData()` 对缺少 `dailyBase` 字段的异常结算数据（例如 pollServer 同步过程中可能出现的空对象或格式不符的数据）增加防御性跳过，不再受理并回退到 `window._settlement`；`updateBigScreen()` 在检测到全部作业已完成但结算未显示时，触发诊断日志和强制重算兜底

### Added
- **认证体系重构**：分离账号与访问码概念。新增 `access_codes` 表，`users` 表合并 `tenants` 表。角色简化为 `admin`/`user`（账号）和 `parent`/`child`（访问码）
- **统一登录入口**：超级管理员和用户账号均通过 `POST /api/auth/login` 邮箱+密码登录，移除独立超级管理员登录按钮
- **超级管理员首次登录强制修改凭证**：首次登录时返回 `needs_password_change: true`，前端自动跳转修改凭证页
- **pgweb 数据库管理工具**：新增 systemd 服务文件，通过 SSH 隧道 + 只读模式安全访问 PostgreSQL
- **访问码快速查找**：新增 `findUserByAccessCode()` 数据库方法，支持直接匹配 `access_code` 列快速查找，仅在无匹配时回退到 bcrypt 扫描兼容旧格式数据；减少每次 exchange 的 bcrypt 计算开销
- **第 4 期开发周报**：基于 CHANGELOG + git log 生成 `weekly-2026-06-w3.html`，涵盖 Phase 5c JWT 认证、管理面板翻新、安全加固等更新，面向普通读者的公众号风格
- **PapaCheck.Site 管理面板 React 子项目**：新建 `PapaCheck.Site/admin/` 独立 React + Vite + TypeScript 子项目，使用 Tailwind CSS 4 + Vitest 测试框架；新增 30 个 TDD 测试覆盖所有组件
- **认证端点添加速率限制**：安装 `@fastify/rate-limit`，全局 60 次/分钟兜底；`POST /api/auth/login` 和 `POST /api/auth/exchange` 各 10 次/分钟，`POST /api/admin/super/login` 5 次/分钟；新增 429 限流测试；`AppOptions.rateLimit` 支持测试中禁用
- **JSON Schema 请求体验证**：为 10 个认证/管理路由添加 JSON Schema 定义（auth 2 个、admin 5 个、super-admin 3 个），移除 handler 内重复的手动字段校验；添加 4xx 错误响应 schema 完善 Swagger 文档
- **PapaCheck.Site 官网子项目**：新建 `PapaCheck.Site/` 子项目，将官网从 `docs/` 搬出；管理面板从落地页底部内嵌改为独立 `admin.html` 页面；docs/index.html 移除管理面板代码；更新 release.py 排除项
- **作业 CRUD 流程测试**：新增 `homework-flow.test.ts`（5 测试），验证新增/更新/删除/租户隔离
- **赏金任务放弃/提交反馈测试**：新增 `bounty_abandon_feedback.test.js`（4 测试），验证找不到任务记录时 toast 提示用户
- **编译产物验证测试**：新增 `compiled-middleware.test.ts`（3 测试），验证 `dist/auth/middleware.js` 中 `PUBLIC_PATHS` 与源码一致，防止部署时 dist/ 过旧
- **测试覆盖补齐**：新增 29 个测试（Super Admin Routes 16 个、Admin Routes 成员管理 11 个、Middleware PUBLIC_PATHS 2 个），全量 631 测试通过

### Changed
- **访问码 schema 验证长度更新**：`exchangeSchema` 中 `access_code` 最小长度从 8 改为 6，与 6 位短码一致
- **release.py cloud_publish 超时保护**：所有 `subprocess.run()` 调用增加 timeout 参数（SSH 30s、SCP 120s、本地构建 180s、远程安装 300s），超时时打印明确错误信息并中止，防止网络问题导致进程永久阻塞
- **PapaCheck.Site 重构**：管理面板从纯 HTML/CSS/JS 重构为 React + Vite + TypeScript；交互逻辑全面修复（消除 `alert()`、函数自我替换 hack、重复事件绑定、无加载/空/错误状态）；视觉升级为现代克制风格（Zinc 中性底 + 橘色强调色、系统字体栈、零 emoji）；落地页与管理面板完全隔离独立维护；`release.py` 新增 `--site` 部署选项（含引导模式）

### Fixed
- **修复新建家庭时超管用户被误拉入家庭**：`POST /api/auth/register` 注册新家庭时，租户复用逻辑将超管的 `'系统管理'` 租户也纳入搜索范围，导致超管用户 `'超级管理员'`（无访问码）被并入新家庭，与注册家长形成"两个家长"。修复为仅复用 `'默认租户'`（旧版本遗留），不触碰超管租户。新增 TDD 测试 2 个，全量 631 测试通过
- **修复 rate-limit 错误处理器分支无效**：`!(error instanceof Error)` 将 `@fastify/rate-limit` 抛出的 Error 实例排除在外，导致 429 错误落入 500 兜底；移除该条件使 rate-limit 正确返回 429
- **修复放弃的常驻型赏金任务孩子端不再可见**：`availableBounty` 过滤条件增加了 abandoned 状态排除；`startBountyTask` 守卫允许放弃的任务重新开始并复用已放弃的提交记录。新增 1 个 TDD 测试，全量 628 测试通过
- **修复评级后新增作业完成不加分**：`calculateSettlement()` 中 `submittedAt` 和 `rating` 共用同一分支导致 multiplier=null 时无法加分且 `homeworkBonus` 未更新；分离为独立分支，已提交状态正确更新 `homeworkBonus`/`totalBeforeRating`，已评级状态正常追加积分。同时修复 pollServer 在 `!allDone` 时错误删除已提交 settlement 的问题。**[后续修复]** 外层条件误改为 `if (existingSettlement)` 导致既无 `rating` 也无 `submittedAt` 的 settlement 跳过"未评级"逻辑，已恢复为 `(rating || submittedAt)`
- **修复新增作业不显示在列表中**：生产数据库中所有 19 张业务表的 PRIMARY KEY 缺少 `tenant_id` 列，导致 `ON CONFLICT (tenant_id, date_key)` UPSERT 失败 → 服务器返回 500 错误 → 前端静默回退到离线存储 → 作业不显示。已手动执行数据库迁移修复所有 PK
- **修复赏金任务放弃/提交按钮无反应**：`abandonBountyTask` 和 `submitBountyTask` 中当 `API.getBountySubmissions` 返回空数组时静默返回，用户无任何反馈；新增 `console.warn` + `showToast` 提示用户刷新重试
- **修复 `release.py` 部署缺失 TypeScript 编译**：打包时 `--exclude=dist` 排除了编译产物，远程命令未执行 `npm run build`，服务器一直运行旧版 JS；修复为打包前本地编译 + 打包 dist/
- **修复 Super Admin Routes 测试 TypeScript 类型错误**：`storedSuperAdmin` 使用了 `AdminUser` 接口不存在的 `username`/`is_active` 字段，改用 `email`
- **修复孩子端语音播报 401 问题**：`/api/speak` 未加入 JWT 中间件的 `PUBLIC_PATHS` 白名单，孩子端语音请求被拦截返回 401，表现为 toast "语音异常: speak fail"
- **修复 `getTenantMembers` 残留已删除字段**：postgres-adapter 和 sqlite-adapter 的 `getTenantMembers` 仍使用 `SELECT *` 并映射已删除的 `access_code_plaintext` 列
- **修复成员列表 `access_hash` 返回占位符**：admin/routes.ts 中成员列表返回 `'已生成'` 固定值，改为返回实际的 bcrypt hash
- **修复 postgres-adapter.ts SQL 语法错误**：`WHE RE` 拼写错误 → `WHERE`；`pushMerge` 中 `SINGLE_ROW_TABLES` 路径缺少 `_setJson` + `recordModification` 持久化调用，导致多端同步时单行表数据丢失
- **修复 `_initSchema` 构造函数未 await 竞态条件**：构造函数改为 `private`，新增静态异步工厂方法 `PostgresAdapter.create()`
- **修复 `addNotification` 无 tenantId 违反 NOT NULL 约束**：PG 模式下补充默认 UUID 占位
- **补全 `findUserByAccessHash`/`getUserById` 返回字段**：补充 `is_super_admin` 和 `needs_password_change` 字段（postgres-adapter + sqlite-adapter）
- **修复 app.ts 约 70 处多重 await 代码异味**：`await await await await` → 单次 `await`
- **修复测试状态污染**：`super-admin-routes.test.ts` 和 `admin/routes.test.ts` 添加 `beforeEach(resetState)`，消除测试间状态依赖
- **修复 PapaCheck.Site 前端 fetch 缺少错误处理**：所有 10 处 `fetch` 调用增加 try-catch；`alert()` 展示关键凭据改为 `showModal()` 页面内模态框；登录失败显示服务端具体错误信息
- **修复管理面板事件委托重复绑定**：`loadMembers` 和 `loadSuperTenants` 每次调用都向 tbody 添加新的 click 监听器，多次刷新后按钮点击会触发多次；移出到文件末尾单次绑定
- **修复事件委托绑定时机脆弱**：绑定到 `document.getElementById()` 依赖 DOM 元素已存在，改为绑定到 `document`，通过 CSS 选择器 `#member-tbody [data-action]` 自动限定作用域，不受 DOM 加载时机影响

### Changed
- **PostgresAdapter 初始化重构**：构造函数私有化，使用 `PostgresAdapter.create()` 静态工厂方法确保 `_initSchema` 在实例可用前完成
- **`admin/routes.ts` bcrypt 操作异步化**：`hashSync`/`compareSync` → `await hash`/`await compare`，消除事件循环阻塞

### Security
- **修复管理面板 XSS 漏洞**：成员列表和租户列表中的 `id` 字段直接拼接进 `onclick` 属性，攻击者可注入恶意 JS；改用 `data-*` 属性 + 事件委托模式，所有用户输入经 `escapeHtml()` 过滤
- **JWT 有效期从 365 天缩短至 30 天**：降低令牌泄露风险
- **修改超级管理员凭证需验证当前密码**：`PUT /api/admin/super/credentials` 新增必填字段 `current_password`
- **`auth/types.ts` JWTPayload 补充 `nickname` 字段**：与 `db/types.ts` 类型定义对齐，消除类型不一致
- **超管创建操作包裹事务**：Postgres 路径下租户+用户插入使用 `BEGIN`/`COMMIT`/`ROLLBACK` 保证原子性
- **中间件异常处理增强**：`queryUserTokenVersion` 失败的 catch 块从静默吞异常改为 `console.warn` 记录

### Security
- **安全加固**：不再明文存储访问码，仅创建/重新生成时 API 返回一次，成员列表显示"已生成"占位符
- **删除成员时 token 作废**：`deactivateMember` 增加 `token_version + 1`，已删除成员的 JWT 即时失效
- **孩子端认证增强**：`app.js` 加载时调用 `/api/auth/me` 验证 token 有效性，被吊销/删除后自动跳转登录页
- **SQLite 适配**：`getTenantMembers` 补上 `access_code_plaintext` 字段
- **Phase 5c: JWT 多租户认证系统** — 替换临时 Cookie Session，实现完整的多租户数据隔离
  - **认证方式**：预授权 Hash 码（类似 API Key），管理员在官网注册后为每个家庭成员生成唯一 hash 码，成员凭 hash 码换取 JWT
  - **token_version 吊销机制**：重新生成 hash 码时版本号 +1，旧 JWT 立即失效，无需黑名单
  - **租户隔离**：共享 PostgreSQL 库 + `tenant_id` 行级隔离，所有业务表增加 `tenant_id` 复合主键
  - **JWT 中间件**：Fastify onRequest hook，Bearer token 验证 + token_version 校验 + 公开路径白名单
  - **认证 API**：`POST /api/auth/exchange`（hash → JWT）、`GET /api/auth/me`（用户信息）
  - **管理员 API**：注册/登录/添加成员/重新生成 hash/移除成员（6 个端点）
  - **超级管理员**：首次部署自动创建超管账号（控制台打印），强制首次登录修改凭证，可查看/启用/禁用所有租户（4 个端点）
  - **官网管理面板**：落地页增量添加家庭管理面板（注册/登录/成员管理）
  - **登录页改造**：从密码登录改为 hash 码输入，JWT 持久化到 localStorage
- **修复发布部署问题**：meta 表 PK 迁移、19 张业务表加 `tenant_id`、删除旧 Cookie Session 认证插件（`auth-plugin.ts`）、修复 `super-admin.ts` 非法 UUID、修复 `_initSchema` 重复租户、修复旧数据 `tenant_id='default'` 不匹配、修复 `access_hash` 显示为 bcrypt 哈希、官网登录页修复、Nginx `try_files` 配置解决根目录静态资源冲突
- 新增 70+ 测试，全量 588 测试通过

### Changed
- **app.ts 认证从 Cookie Session 替换为 JWT**：移除 `authPlugin` + `@fastify/cookie`，注册 `authMiddleware` + `authRoutes` + `adminRoutes` + `superAdminRoutes`；所有约 60 个 API handler 增加 `tenantId` 透传
- **`PapaCheck.Web/js/api.js`**：所有 fetch 调用自动注入 `Authorization: Bearer` 头
- **`PapaCheck.Web/login.html`**：从 `/api/login` 密码登录改为 `/api/auth/exchange` hash 码登录

### Fixed
- **修复 postgres-adapter.ts 多处代码损坏**：`n e wLastModified` 变量名空格 → `newLastModified`；`turn` → `return`；`ync` → `async`；`W HERE` SQL 语法错误 → `WHERE`；括号/缩进不匹配修复
- **修复 schema 问题**：tenant_id 从 TEXT 改为 UUID 类型保持一致性；`_initSchema` 移除硬编码 `'default'` 租户 ID，改用 UUID 动态创建；meta 表增加 `tenant_id` 列和复合主键；`_resetDailyShopQuantity` 中 meta INSERT 增加 `tenant_id` 条件
- **修复 JWT_SECRET 重启后令牌失效**：`jwt.ts` 新增 `loadOrCreateSecret()`，将随机生成的密钥持久化到 `data/.jwt_secret` 文件
- **修复 meta 表 `tenant_id` 查询条件缺失**：SELECT/INSERT/DELETE 中 meta 表的 `last_shop_reset` 操作全部补全 `tenant_id = $1` 或 `tenant_id IS NULL` 条件，修复 PK 变更后 `ON CONFLICT (key)` 不匹配的问题；`resetDate` 中 meta DELETE 改为按 tenant_id 精确删除

### Changed（历史）
- **LICENSE 填写版权信息**：模板占位符替换为 `PapaCheck / Copyright (C) 2026 chengdexy`
- **移除 CNAME 文件**：停止 GitHub Pages 服务，删除 `docs/CNAME`

### Fixed（历史）
- **修复孩子端奖励兑换/撤回在离线→在线转换期间的竞态条件 Bug**：新增 `guardOnline()` 守卫 + reconnecting API 降级 + 服务端 409 兜底 + 19 个 TDD 测试；全量 554 测试通过
- **修复管理端删光作业后孩子端评级界面不关闭 Bug**：独立结算清理检查 + `submitForRating()` 防御性守卫 + 9 个 TDD 测试；全量 535 测试通过
- **修复孩子端暂停作业后计时器仍在计时的竞态条件 Bug**：pollServer 替换数组时恢复 in-memory pause 状态 + 5 个 TDD 测试；全量 526 测试通过
- **修复 Node.js 关闭时 WAL 未合并 Bug**：`SqliteAdapter.close()` 加 WAL checkpoint + 1 个 TDD 测试；全量 521 测试通过

### Changed
- **release.py 云端部署从 Docker Compose 迁移到 systemd**：tar 包直接解压到 `/opt/papacheck/`，远程命令改为 `npm ci + systemctl restart papacheck`
- **`npx node-gyp` → `npx --yes node-gyp`**：修复首次构建时因 npx 确认提示导致卡住的问题
- **EXE 版本 1.2.22→1.3.1，APK 版本 1.3.0→1.3.1**

### Fixed
- **修复管理端确认兑现时全量 PUT 所有兑换记录导致的两个 Bug**（520 测试通过）
  - Bug 1：孩子端撤回的兑现自由时间，管理端没有消失 — 根因：`fulfillRedemption` 循环 PUT 所有 `adminRedemptions`，覆盖了孩子端的撤销操作（cancelled → pending）
  - Bug 2：偶发管理端审核通过的自由时间在管理端没有消失 — 根因：循环中某个 PUT 网络失败只更新了部分记录，`refreshAllData` 后已兑现记录回退到 pending
  - 修复：只 PUT 当前正在兑现的那条记录（`await API.putRedemption(redemption.id, redemption)`），与孩子端 `cancelRedemption` 保持一致
  - 新增 TDD 测试 5 个（`fulfill_redemption_only_put_target.test.js`）

### Added
- **Phase 5a: PostgreSQL 适配 — 数据库抽象层重构**（v1.3.0 规划）
  - `IDatabase` 接口定义完整（~60 个方法），`DatabaseAdapter` 抽象基类提取通用工具方法
  - `SqliteAdapter extends DatabaseAdapter` 保留原 `PapaCheckDB` 全部逻辑，向后兼容
  - `PostgresAdapter extends DatabaseAdapter` 使用 `pg` 库完整实现全部方法，JSON-in-column 模式
  - 工厂函数 `createDatabase()` 通过 `DATABASE_URL` 环境变量自动切换 SQLite/PostgreSQL
  - 数据迁移脚本 `migrate-to-pg.ts`：逐表迁移 + 行数校验，幂等运行
  - 新增 8 个测试（507 → 515 passing）
- **Phase 5b: 部署架构重构 + 临时安全认证**
  - Cookie Session 临时认证中间件（`auth-plugin.ts`）：自动生成部署密码，未登录 API 返回 401
  - 登录页面 `login.html`，`@fastify/cookie` 持久化 session（30 天）
  - 生产入口（index.ts）`enableAuth: true`，测试环境默认关闭
  - 部署脚本 `scripts/deploy.sh`：本地编译 → scp → systemctl restart
  - systemd service 模板：`papacheck.service`，开机自启 + 崩溃重启
- **Phase 5 完整阶段规划**：5a（PostgreSQL 适配）→ 5b（去 Docker + systemd + Nginx）→ 5c（JWT 多租户认证）→ 5d（运维增强）→ 5e（客户端适配）
      - spec/tasks/checklist 已创建于 `.trae/specs/phase5-postgresql-migration/`
      - 实施计划已创建于 `docs/superpowers/plans/2026-06-12-phase5-postgresql-migration.md`

### Changed
- 数据库层从同步 API 重构为 async/await：`SqliteAdapter`、`app.ts`、所有 DB 测试适配异步调用
- `auth-plugin.ts` 按 `enableAuth` 选项开关，不影响已有 500+ 测试
- 项目版本规划调整为 v1.3.0（Phase 5a+5b），新增测试 8 个，总测试数 515
- **TTS 预生成防 OOM**：`pregenAllFixed()` 从 45 条并发改为逐条生成 + 300ms 间隔，避免同时 spawn 多个 Python 子进程打爆 2G 内存
- **Auth 插件改为仅保护 API**：不再拦截静态页面，前端能正常加载 `index.html` / `admin.html`
- **前端 401 处理**：`connection.js` ping 检测到 401 时跳转登录页；`api.js` 所有 API 请求 401 时跳转登录页

### Security
- **公网 API 防护**：Cookie Session 认证，未登录用户访问 API 返回 401
- 部署密码自动生成并打印到启动日志，settings 中持久化存储
- **Nginx HTTPS + 域名**：配置 Let's Encrypt SSL 证书，HTTP 自动 301 重定向到 HTTPS
- **8080 端口关闭**：安全组 + UFW 双重关闭公网 8080 端口，所有流量经 Nginx 443

### Removed
- Docker 容器已从服务器停止并移除，改用 systemd + Nginx + PostgreSQL 直接部署

### Added
- 新增回顾页（review.html）：孩子端滚动叙事战绩回顾，从生产数据库提取数据，以 15 屏全屏滚动展示 22 天的完整学习历程，包含坚持天数、时间投入、效率分析、评级荣耀、积分经济、兑换榜、赏金任务等维度，每屏配数字 count-up 动画和意义解读
- 新增微信公众号周报 Skill（PapaCheck.WeChat）：AI 根据 CHANGELOG + git log 自动生成亲子风开发周报，包含 wechat-api（草稿 API 封装）、gen-weekly（Markdown→微信 HTML 转换）、skill.md（Skill 定义）；补齐历史三期周报并上线 GitHub Pages

### Changed
- 离线遮罩显示时机优化：第一次 ping 失败时不显示遮罩，第二次 ping 失败时才显示，降低偶发网络抖动的无用遮罩闪烁；全量 362 测试通过
- TTS 错误日志简化：`spawnPython` 非零退出时只显示 stderr 最后一行实际错误信息，省略 Python 完整堆栈；`.gitignore` 补充 `PapaCheck.Web/tts_cache/` 并清理遗留的 MP3 缓存文件

### Fixed
- 修复管理端点击赏金任务"通过"按钮后，词条赏金任务审核状态未切换的问题：`approveBountySubmission()` 中 `splice` 移除提交后未在数据库中标记删除，导致 `refreshAllData()` 后已通过提交重新出现；添加 `isDeleted: true` 标记并保存到数据库；全量 362 测试通过
- 修复点击菜单栏"退出"阻塞 Windows 主界面的问题：`_quit_app()` 改为后台线程执行停止服务器，停止完成后再销毁窗口；退出时按钮显示"⏹ 正在关闭..."状态；全量 362 测试通过
- 修复点击"停止服务器"阻塞 Windows 主界面的问题：`_stop_server()` 改为后台线程执行（`_stop_server_worker`），停止完成后通过 `self.root.after(0, _on_server_stopped)` 回调更新 UI，避免 tkinter 因 `process.wait()` 卡死；全量 362 测试通过
- 修复 Windows 调试模式点击"停止服务器"再点"启动服务器"提示端口 8081 已被占用的问题：`_stop_node_server_process()` 在 Windows 上先尝试优雅退出（`taskkill /T` 发送关闭信号，Node.js 端 `SIGTERM` 处理器调用 `app.close()` 释放端口），优雅退出超时后兜底强制杀进程树（`taskkill /F /T`），确保 debug 模式下 `tsx.cmd` 的子进程 `node.exe` 也被正确终止；全量 362 测试通过
- Node.js 端（index.ts）添加优雅关闭处理器：`SIGTERM`/`SIGINT` 时调用 `app.close()` 后退出
- 修复初始 ping 失败时（如应用启动时已离线），`_mode` 未过渡到 `reconnecting`，导致离线遮罩和 toast 均不显示、用户收不到任何反馈的问题；全量 362 测试通过
- 修复 Windows 端开机自启动配置未生效 + 注册表旧版本残留无清除机制的问题：
  - `_is_autostart()` 改为读取注册表值并用 `os.path.isfile()` 验证可执行文件是否存在，而非仅检查键名存在
  - 新增 `_cleanup_stale_autostart()` 启动时自动清理无效/旧版本注册表条目
  - `_set_autostart()` 写入前后自动清理残留条目并增加操作日志
  - 启动时（`__init__`）自动执行注册表残留清理
- 修复孩子端无限 PUT `/api/settlement/:date` 和 `/api/efficiency/:date` 的问题：`calculateSettlement()` 添加 re-entrant guard（`_calculatingSettlement` 防止并发重复执行）+ `_putSettlementIdempotent`/`_putEfficiencyIdempotent` 数据快照对比（相同数据跳过 PUT），消除轮询触发的无限 PUT 循环
- 修复上一轮修复遗漏的根因：`api.js` 中 `DB.cacheFullData(result)` 原地修改 `cachedData` 对象，`db.js` 的 `ensureSyncFields()` 每次覆盖 `lastModified`/生成新 `uuid`，导致 `pollServer` 的作业列表 JSON 比较始终认为有变化 → 每轮 poll 都触发 `calculateSettlement()` → 即使幂等性检查也因 `lastModified` 每轮不同而失效。修复：`getData()` 和 `init()` 中均使用深拷贝后传给 `cacheFullData`，防止污染运行时 `cachedData`
- 修复奖励箱新增奖励未播报的问题：`pollServer` 检测到奖励箱物品新增或数量增加时调用 `Voice.speak('奖励箱有新奖励，快去看看吧')`
  - 新增 TDD 测试 6 个（362 全量测试通过）

### Added
- Android 端更新版本后自动清空本地缓存（WebView 缓存 + 离线快照），保留服务器 URL 和角色配置，确保每次更新后从服务端下载最新资源
  - 新增 `ConfigService.setLastVersion()` / `getLastVersion()` 版本号存储
  - 新增 `OfflineSnapshotService.clearAll()` 离线快照清理
  - 新增 `shouldClearCache()` 版本变更检测决策函数
  - `_startup()` 启动流程集成：版本变更 → 清 WebView 缓存 → 删除离线快照 → 记录新版本 → 加载最新页面
  - TDD 驱动：新增 7 个 Flutter 测试，全量 30 测试通过

### Fixed
- 修复 `_talkToDaemon` 缺少 `proc.removeListener('close', onClose)` 导致内存泄漏：超时/空响应/正常收完/异常四路提前退出路径均添加移除监听器
- 修复提交评级后 pollServer 覆写 `submittedAt` 导致页面卡在提交界面：`calculateSettlement()` 判断条件增加 `submittedAt` 检查，已提交未评级的 settlement 不会被重置
- 修复通知延迟消费导致重复播放：只在通知首次出现时播报，延迟消费轮次跳过已见过的通知；消费后从 `_lastNotifIds` 移除已删 ID 防止重复 DELETE
- 修复 TTS 预生成文件写入 SEA 虚拟目录不持久的问题：`cacheDir` 跟随 `dbPath` 到 `%LOCALAPPDATA%/PapaCheck/Server/tts_cache`
- 修复 SEA 环境下 daemon stdin pipe 不可用导致崩溃：放弃 daemon，回退到经检验的 `spawnPython`（argv 传参）; 添加 stdin error 处理器和 close 退化逻辑防止 Node.js 崩溃
- 修复语音自动播放解锁锁死：删除 `setTimeout(unlockAudio, 100)` 页面加载 100ms 后的假解锁尝试（`silent.play()` 被浏览器拦截后设 `_unlockDone = true` 导致真实用户交互无法再解锁），解锁完全依赖 click/touchstart/visibilitychange 用户事件
- 修复 `NotAllowedError` 时用 `unshift` 插回队首导致过时语音插队的问题：改为 `push` 放回队尾
- 修复通知在语音播报前被消费的问题：pollServer 通知消费改为"延迟一轮"策略（首轮只播不删，第二轮确认持久后再删），给 Voice 至少 5 秒时间完成播报
- 修复 `updateMainClock` 中 `saverDate` 潜在空指针异常：`document.getElementById('saverDate')` 添加空检查，与 `saverTimeEl` 保持一致
- 修复离线模式客户端时钟停止：`tickInterval`（同时负责时钟+任务计时器）在离线模式下因 `pollServer()` 提前返回无法恢复，导致时钟冻结。将时钟更新拆分为独立 `clockInterval`（30 秒间隔，永不停止），屏保时钟合并到 `updateMainClock` 统一更新，消除 `updateSaverTime` 独立定时器
  - 新增 TDD 测试 7 个（356 全量测试通过）
- 修复 Windows log 框显示 Node.js 弃用警告：`package.json` overrides 锁定 `glob@8.1.0`（npm 标记为 deprecated），移除 overrides 后升级到 glob@10.x 非弃用版本；添加 `_write_log()` 对 `(node:` / `(Use \`` 开头的防御性过滤
- 修复 TTS 常驻进程在 Windows 下启动崩溃：`asyncio.connect_read_pipe` + `StreamReader` 在 Python 3.14 ProactorEventLoop 中因 IOCP pipe 句柄无效而报 `WinError 6`，改用 `loop.run_in_executor(None, sys.stdin.buffer.readline)` 在线程池中读取 stdin
- 修复 `startPoll` 使用 `setInterval` 导致 poll 函数重叠触发的问题：改为 `setTimeout` 递归链 + `finally` 块确保前一次执行完成后才调度下一轮，消除异步竞态；`stopPoll` 同步改为 `clearTimeout`
  - 新增 TDD 测试 3 个（349 全量测试通过）
- 修复兑换成功时重复播报："奖励箱有新奖励，快去看看吧" 与 "兑换成功！" 连续播报导致语音重叠
- 修复自由时间起始播报重复时长：`Voice.speak('开始' + ft.name + '，' + ft.durationMinutes + '分钟')` 中 `durationMinutes` 冗余（家长已在商品名称中写明了时长），改为 `Voice.speak('开始' + ft.name)`
- 修复孩子端轮询同步时最后一项作业被延后到明天后不自动弹出评级界面的问题：作业列表变化后全部为 done 时自动调用 `calculateSettlement()`，不再依赖触发变化的具体原因
  - 新增 TDD 测试 3 个（341 全量测试通过）
- 修复积分商店商品每日数量在次日不再重置的问题：`_resetDailyShopQuantity()` 检查 `dailyLimit`/`dailySold` 字段名与前端使用的 `baseQuantity`/`remainingQuantity` 模型不匹配，导致重置逻辑实际未执行；新增 `baseQuantity → remainingQuantity` 重置逻辑，同时保留旧字段兼容
  - 新增 TDD 测试 3 个（327 全量测试通过）
- 修复孩子端作业操作（开始/暂停/继续/完成）后轮询可能回退状态的问题：将 `saveHomeworksSilent()`（全量 PUT 所有作业）改为 `API.patchHomework()`（只 PATCH 变更字段到被操作的作业），消除 TOCTOU 竞态条件并减少请求开销
  - 开始作业：PATCH 仅含 `status`/`startedAt`/`mode`
  - 暂停作业：PATCH 仅含 `paused`/`wasPaused`/`_pausedElapsed`
  - 继续作业：PATCH 仅含 `paused`/`startedAt`
  - 完成作业：PATCH 仅含 `status`/`completedAt`/`actualDuration`/`mode`/`_animClass`
  - 在校完成：PATCH 仅含 `status`/`mode`/`completedInSchool`/`actualDuration`/`startedAt`/`completedAt`
  - 服务器 `patchHomework` 自动更新 `lastModified` 为当前时间（PUT 用的是客户端旧值）
  - 新增 TDD 测试 5 个（324 全量测试通过）
- 修复自由时间操作（开始/暂停/继续/完成）后轮询可能回退状态的问题：将 `saveFreeTimeSilent()`（全量 PUT 所有自由时间）改为 `API.putFreeTimeTask()`（只 PUT 当前操作的任务），消除 TOCTOU 竞态；同时 pollServer 增加 `freeTimeTasks` 状态等级保护（pending<doing<done）；修复 `startFreeTime` 缺少 `await` 导致异步竞态
  - 新增 TDD 测试 5 个（349 全量测试通过）

### Added
- TTS 常驻 Python 子进程：`tts_bridge.py --daemon` 通过 stdin/stdout 长连接通信，消除每次 TTS 播报的 Python 冷启动开销（~1-3s）
  - `TTSBridge._ensureDaemon()` + `_talkToDaemon()` 管理常驻进程生命周期
  - 长度前缀协议（4 字节 LE + MP3 数据），30s 超时自动退化到 `spawnPython()`
- Node.js 端启动时自动预生成 45 条固定短语的 TTS MP3 缓存（含清理陈旧缓存），消除首次播报时调用 edge-tts 的卡顿
  - `TTSBridge.FIXED_TEXTS` 静态常量（21 条常用短语 + 24 条整点报时）
  - `TTSBridge.pregenAllFixed()` 方法：后台异步生成 + MD5 hash 校验 + 陈旧缓存清理
  - `buildApp()` 启动时调用 `tts.pregenAllFixed()`，不阻塞服务器启动
  - `pregenSpeech()` 支持无参调用，默认使用 `FIXED_TEXTS`

### Fixed
- 修复 TTS 预生成使用 monkey patching 修改全局 `console.log` 的不安全做法：改为由 Windows 客户端 `_write_log()` 直接过滤 `[TTS] spawning` 前缀的日志，服务器端保持正常日志输出
- 修复管理端无法删除奖励箱物品：添加 Node.js/Python 服务端 `DELETE /api/reward-box/:id` 端点，前端 `api.js` 添加 `deleteRewardBoxItem` 方法，`admin.js` `deleteRewardBoxItem` 改为调用 HTTP API（之前仅本地删除+CRDT 日志，`refreshAllData()` 从服务端重新拉取后未删除物品"复活"）
- 修复 Windows 端每次启动弹出防火墙提示：将 `papacheck-server.exe` 从临时目录复制到 `%LOCALAPPDATA%/PapaCheck/` 固定路径后启动，首次运行通过 `PowerShell Start-Process -Verb RunAs -Wait` 提权添加防火墙规则（UAC 弹一次，后续跳过）

### Changed
- 清理项目根目录：删除已废弃的 `release.bat`、`RELEASE_USAGE.md`、`sync-mask-not-showing.env`、覆盖率缓存等文件
- 清理 `.trae/`：删除已完成的 18 个 spec 方案文件夹和 60+ 个过期方案文档
- 将 `PapaCheck_ban.jpg`、`papacheck_wordcloud.png`、`docs/favicon.png` 移至 `docs/imgs/` 并统一命名，更新 README / docs/index.html / package.json 中的引用路径
- `release.py` 输出美化：去除原始命令日志（子进程输出重定向 DEVNULL），改用 `▶ [n/total] 步骤名 ... ✓` 行内动画；输出按阶段分区（清理/构建/归档/后置处理），尾部总结改用双线框；移除未使用的辅助函数

### Fixed
- 修复 pkg EXE 中 TTS 语音不播报：build-sea.mjs 的 assets 路径 `'dist/scripts/**/*'` 相对于 dist/package.json 解析为 `dist/dist/scripts/`，导致 tts_bridge.py 未打包进 EXE，改为 `'scripts/**/*'`
- 修复 `resolveScriptPath()` 的 `existsSync` 在 pkg 快照虚拟文件系统中失效：改用 `process.pkg` 检测 + `readFileSync` 从快照读取脚本后写入临时目录，再传给 Python 子进程
- 修复 `spawnPython()` 静默吞掉 Python stderr/退出码：添加 stderr 收集和 `[TTS]` 日志输出
- 修复 `GET /api/speak` 返回空数据时仍返回 200 状态码：改为返回 500 + TTS 错误信息，前端 toast 显示具体原因
- 修复 Voice.speak 在 Chromium 内核浏览器中因 blob URL Range 请求失败而无法播放：恢复原始 blob URL + HTMLAudioElement 方案；修复 `unlockAudio()` 只解锁 AudioContext 未解锁 HTMLAudioElement，添加 silent Audio.play() 解锁 HTMLAudioElement 自动播放
- 修复静态文件无反缓存头导致 WebView 使用旧版 JS：添加 `Cache-Control: no-cache, no-store, must-revalidate`
- 修复 `db/index.ts` 中 `crypto` 全局变量在 pkg 快照中未定义：添加 `import crypto from 'node:crypto'`

### Added
- `spawnPython()` 添加 stderr 收集和 `[TTS]` 诊断日志：输出脚本路径、Python 退出码和错误信息

### Changed
- `build_exe.py` 重构：模块级代码移至 `main()` 函数，添加 `if __name__ == '__main__':` 保护，方便测试导入

### Fixed
- 修复 `build_exe.py` 中 `restore_better_sqlite3()` 未使用 `shell=True` 导致 Windows 下找不到 npm 命令的问题

### Added
- 专用通知接口（notify-api）：`notifications` SQLite 表、POST /api/notify（创建通知）、GET /api/notify/pending（拉取待消费通知，自动 1 分钟过期清理）、DELETE /api/notify/consumed（批量消费通知）
- 前端 api.js 新增 `announce(text)`（带 CRDT 日志 + online-first 策略）、`getPendingNotifications()`、`consumeNotifications(ids)` 方法
- CRDT 同步支持 `notifications` 表：`_classifyChange` 识别、`applyCRDTOperation` 分支、`announce` CRDT 日志合并
- 邮件同步完成后调用 `db.addNotification('收到云端作业，请查看')`
- 服务端 7 个通知数据库测试 + 7 个 API 端点测试

### Changed
- 日志染色重构：`_log_tag` 替换为 `_classify_line` 逐行独立染色；API 日志按状态码+方法类型染色（5xx→红、4xx→黄、写操作2xx→绿、读操作2xx→灰），中文日志按关键字匹配染色（错误/失败→红、未找到→黄、成功/完成→绿、系统事件→青、服务器启动成功→亮蓝）
- 日志排版优化：6 级 tag 增加 `spacing1=2` 行间距，日志框添加垂直滚动条
- 日志框 URL 编码日志自动解码为中文显示
- `_load_config` 添加模块级缓存，`_write_log` 不再每次读磁盘；`_save_config` 同步更新缓存
- 管理端 admin.js 所有播报操作点（调分/评级/商品/奖励箱/延后/驳回/赏金/新增作业）改为直接调用 `API.announce()`，移除 `_pointsAdjustmentNote` hack
- 孩子端 app.js pollServer 重构：移除 8 处 diff 检测 `Voice.speak()`，改为轮询末尾统一调用 `API.getPendingNotifications()` 拉取并播报通知，保留 `needsFullRender` 和 UI 刷新逻辑
- 通知过期时间从 1 分钟延长至 1 小时：解决桌面浏览器 Autoplay Policy 导致语音延迟播报时通知已被清理的问题
- 移除 `Voice._unlocked` 检查：Android WebView 已设置 `setMediaPlaybackRequiresUserGesture(false)`，无需 JS 层拦截音频播放；`_playNext()` 直接调用 `audio.play()`，桌面浏览器走 `NotAllowedError` 兜底

### Removed
- `_pointsAdjustmentNote` 跨设备通知 hack（settings 污染），替换为专用通知接口
- app.js `_lastPointsNote` 变量、`_pointsAdjustmentNote` 检测/播报/清理代码块
- `_rewardBoxVoiceHandled` 死代码标志

### Fixed
- 修复 `@fastify/static` 默认开启 ETag/Last-Modified 导致开发模式下静态文件全部返回 304，浏览器使用旧版缓存代码；在 `fastifyStatic` 注册选项中添加 `cacheControl: false`, `etag: false`, `lastModified: false`
- 修复通知 CRDT 同步后丢失原始时间戳：`addNotification` 新增可选 `createdAt` 参数，CRDT 同步时传入 `op.value.createdAt`
- 修复孩子端打开页面后通知语音不播报直到点击屏幕：`_playNext()` 移除 `Voice._unlocked` 提前返回
- Code review 修复 6 个 minor 问题：移除 `GET /api/notify/pending` 中冗余的 `cleanupExpiredNotifications()` 调用（`getPendingNotifications()` 内部已清理）；移除 app.js 作业 diff 中的死代码空条件注释；清理 `_rewardBoxVoiceHandled` 死标志；移除 `getPendingNotifications()` 返回中多余的 `created_at` 蛇形字段；移除未使用的 `emailNew`/`manualNew` 变量

### Changed
- 重写 AI 邮件解析 system prompt，仿照 email_client.py 的结构化格式（输出格式含示例、3 条规则、约束），输出改为严格按照 JSON 数组格式

### Fixed
- 修复 Windows 端 log 框轮询日志不受"显示轮询日志"配置控制：`_write_log` 方法改为根据本地 `config.json` 的 `show_polling_log` 值过滤轮询端点日志（`/api/ping`、`/api/data`、`/api/notify/pending`），配置生效不再依赖服务端；移除之前错误的服务端过滤方案（`onResponse` 钩子读 DB + `POST /api/settings` 同步配置到服务端）
- 修复邮件解析添加的作业在管理端显示"实际undefined分钟"：Node.js 邮件同步创建作业时补充 `actualDuration: null` 字段，admin.js 渲染判空改用 `!= null` 防御 `undefined`
- 修复 Android APK 更新后提示"安装包损坏"：`_downloadAndInstall` 使用 `Directory.systemTemp`（系统临时目录）保存 APK，Android 10+ 下 FileProvider 的 `<cache-path>` 无法覆盖该目录，安装器读取文件失败。改为 `getTemporaryDirectory()`（应用缓存目录），提取 `UpdateService` 方便测试
- 修复孩子端积分商店和奖励箱的滚动条回弹问题：轮询触发 `updateBigScreen()` 时 `innerHTML` 重建 DOM 导致 `scrollTop` 重置为 0，通过保存/恢复 `scrollTop` 解决
- 恢复 parseHomework markdown 代码块回退解析逻辑，防止 AI 模型返回代码块包裹 JSON 时解析失败丢失作业数据
- 修复 `updateSettlementPage()` 中引用未定义变量 `savedScrollTop`（滚动恢复代码误放入结算页），并补上 `updateShopPage()` 缺失的滚动恢复代码
- 修复孩子端屏保模式轮询间隔被设为 60s 的 Bug：`showScreenSaver()` 中 `startPoll(60000)` 改为 `startPoll(5000)`，与正常模式保持一致

### Added
- CRDT 同步引擎（src/crdt/）：字段级 LWW-Register、PN-Counter、OR-Set 合并函数
- crdt_operations 数据库表存储操作日志
- POST /api/sync/crdt-push — 批量接收并持久化 CRDT 操作
- GET /api/sync/crdt-pull?since= — 增量拉取 CRDT 操作
- DELETE /api/sync/crdt-pull?ack= — 确认已消费的 CRDT 操作
- 前端 CRDTLog 操作日志模块（js/crdt-sync.js）：append / getPending / ack / migrateFromChangeLog
- api.js 所有 PUT/PATCH/DELETE 方法调用时自动生成 CRDT 操作日志
- sync.js 新增 crdtPush / crdtPull / crdtFullSync CRDT 同步方法
- connection.js _doReconnect() 重连时优先走 CRDT 同步，失败降级到 LWW
- app.js/admin.js 初始化时自动迁移旧 ChangeLog 到 CRDTLog
- 7 个 CRDT 合并引擎单元测试 + 8 个前端 CRDT 同步测试
- Windows 端通过子进程启动 Node.js 服务器（替换内嵌 Python 服务器）
- Node.js 邮件同步模块（IMAP 连接 + AI 解析 + HTTP 同步端点）
- POST /api/email/config — 保存邮箱和 AI 配置到数据库
- POST /api/email/sync — 触发邮件同步，IMAP 获取 → AI 解析 → 作业入库
- Windows 端构建流程更新：先构建 Node.js EXE 再打包进 PyInstaller
- 10 个 Windows 端 Node.js 启动/停止测试 + 6 个邮件模块测试
- **覆盖率提升**：JS/TS 代码覆盖率从 79.39% 提升至 85.12%（Stmts），新增 24 个 Vitest 测试覆盖 db/index.ts、email/ai.ts 等模块的未覆盖分支
- **Python 覆盖率提升**：release.py 从 16% 提升至 32%，新增 10 个 pytest 测试覆盖 archive_apk、create_zips、parse_args
- **Flutter 测试修复**：connect_failed_dialog_test 中 2 个测试因界面移除"离线运行"按钮而出错，已同步更新测试逻辑
- **IDE 测试发现修复**：12 个前端测试文件从 `test_*.js` 重命名为 `*.test.js`（标准格式），确保 IDE 测试面板正确识别全部 297 个 Vitest 测试

### Changed
- 12 个前端测试文件重命名：`test_xxx.js` → `xxx.test.js`
- vitest.config.js 移除 `test_*.js` 包含模式（已被 `*.test.js` 模式覆盖）

### Fixed
- 修复数据同步时消耗的时间类道具被恢复的 Bug：`fullSync()` 中 `ChangeLog.clear()` 全量清空变更日志，会清除 `pushChanges()` 推送到服务器期间新产生的条目，导致这些变更丢失、服务器旧数据覆盖本地。改为 `clearUpTo(maxId)` 只清除已推送的条目（ID ≤ maxId），保留推送期间新增的条目等待下次同步
- `ChangeLog` 新增 `clearUpTo(maxId)` 方法，按 ID 范围精确清除已推送的变更日志条目
- `pushChanges()` 返回已推送条目的最大 ID，供 `fullSync()` 精确清除
- 新增 5 个 ChangeLog.clearUpTo 单元测试
- 修复 Flutter connect_failed_dialog_test 中 2 个测试因引用已移除的"离线运行"按钮而失败的问题

### Added
- Node.js 服务器 PUT/PATCH/DELETE/HEAD 路由：12 个 PUT、4 个 PATCH、4 个 DELETE、3 个 HEAD 端点，使用 `sendJson()` 统一响应格式
- CORS 头新增 PUT、PATCH、DELETE、HEAD 方法支持
- 23 个新测试覆盖所有新增路由

## [Unreleased - PapaCheck.Site 整合]

### Added
- **PapaCheck.Site 整合**：将落地页（landing）和管理面板（admin）合并到统一项目 `PapaCheck.Site`，使用 Vite 5 + React 18 + TypeScript 5 + Tailwind CSS 3 同一技术栈
- **Vite 多页面（MPA）配置**：通过 `PapaCheck.Site/vite.config.ts` 的自定义插件 `adminBaseRewrite` + `copyAdminAssets`，实现落地页 `index.html` 和管理面板 `admin/index.html` 的统一构建
- **落地页五大区块**：导航栏（TopNav）、Hero、Story 时间线、Features 功能区、Platforms 多端区、CTA 收尾、Footer
- **吉祥物五态插画**：`mascot-wave`（Hero 招呼）、`mascot-point`（Story 17:30 指向作业）、`mascot-ok`（Story 19:00 评优）、`mascot-thumbs`（Story 20:00 收尾点赞）、`mascot-bye`（CTA 收尾挥手）
- **吉祥物悬浮动画**：`mascot-float`（Hero 区，4s）和 `mascot-float-slow`（Story 区，6s）
- **`site_publish` 部署脚本**：新增 `release.site_publish()` 函数，适配 Vite 合并构建后的 `dist/` 目录结构（landing 与 admin 同包），自动过滤 `admin-` 前缀的 admin 端资源
- **`site_publish` TDD 测试**：在 `PapaCheck.Tests/test_release.py` 新增 `TestSitePublish` 测试类，覆盖构建流程、资源过滤、远程目录创建等场景（5 个新测试）
- **辅助函数 `_tar_dir_to_bytes`**：用于将本地目录打包为 gzip tar 字节流，支持目录递归 + 排除规则

### Changed
- **`release.py` 重构**：调整 `site_publish` 实现，移除对旧 `landing/` + `admin/` 分离项目结构的依赖
- **PapaCheck.Site 项目结构清理**：删除老 `admin.html` / `css/style.css` / `js/main.js` / `imgs/check_icon_512.jpg` / `imgs/favicon.png` 等静态资源残留
- **Story 区吉祥物展示优化**：去除时间线节点的边框和渐变背景容器，让吉祥物以裸插画形式自然悬浮

### Removed
- **PapaCheck.Site 静态资源**：删除原 HTML/CSS/JS 实现的旧落地页和管理面板
- **PapaCheck.Site/admin 子项目**：删除原独立的 Vite + React 管理面板项目（已整合到根 `src/admin/`）

## [1.2.0] - 2026-06-06

### Added
- Node.js 服务器骨架（PapaCheck.Server.Node/）：Fastify + better-sqlite3 + TypeScript
- 35 个 API 端点（17 GET + 18 POST），与 Python 服务器完全兼容
- SQLite 数据库层（better-sqlite3），兼容现有 data.db 的 17 张表
- TTS 语音桥接：Python 子进程（edge-tts）+ 内存/磁盘双层缓存
- 静态文件服务（@fastify/static）
- OpenAPI 自动文档（@fastify/swagger + swagger-ui），访问 /docs 查看
- CLI 参数解析（--port, --web-dir, --db-path, --tts-python）
- 单 EXE 构建脚本（Node.js SEA --build-sea）
- 83 个 Vitest 集成测试覆盖所有端点
- pkg 单 EXE 构建脚本（兼容 node18-win-x64，61 MB 输出）

### Added
- PUT 端点 12 个：homeworks, settlement, shop, redemptions, reward-box, settings, active-buffs, efficiency, freetime, bounty-tasks, bounty-submissions, bounty-completions
- PATCH 端点 4 个：homeworks（部分更新字段）, settlement, points（增量积分）, settings
- DELETE 端点 4 个：homeworks, shop, active-buffs, bounty-tasks（软删 isDeleted）
- HEAD 端点 2 个：shop, bounty-tasks（资源存在检查）
- 统一错误格式：AppError 类 + 全局 setErrorHandler（`{ error, code, details? }`）
- api.js 新增 30 个方法：put/patch/delete/head 覆盖所有数据类型
- 更新 CORS 头支持 PUT/PATCH/DELETE/HEAD 预检请求
- 所有 PUT/PATCH/DELETE/HEAD 端点添加 JSON Schema 参数校验

### Fixed
- 离线→在线切换的竞态窗口：ping 恢复后立即切换 `reconnecting` 状态，阻止 `pollServer`/`refreshAllData` 在 sync 完成前获取旧数据
- 消除 `_doReconnect()` 中 `/api/data` 双重冗余调用，改用 `DB.getFullData()` 读取 fullSync 已缓存的数据
- 统一 `connection.js` 中 `_wasOnline` 两个分支的重连路径为单一 `_doReconnect()` 调用
- `admin.js` 的 `refreshAllData` 在 `reconnecting` 模式下跳过执行
- `_doReconnect()` 函数内部恢复状态设置和遮罩显示，确保从任意入口调用时行为正确

### 修复（Fixed）
- 推迟到明天做的作业，离线转在线模式同步后回到今天的作业列表：修改 `db.py` 的 `push_merge()` 在指定 `date_key` 找不到 UUID 时跨所有 `date_key` 搜索，防止因 `move_homework` 造成的跨天重复追加；`move_homework()` 补充调用 `record_modification()` 更新 `last_modified` 表
- 孩子端赏金任务列表过多时超出框架且无滚动条：移除 `updateHomeworkGrid()` 中错误的 `card.style.display = 'block'`，恢复 CSS `display: flex` 弹性布局，使 `.homework-grid` 的 `overflow-y: auto` 正常生效
- 孩子端/管理端静置后误切离线模式：ConnectionManager 引入 ping 失败阈值（连续 3 次失败才切换离线），利用已有 `_failCount` 变量，防止设备休眠/浏览器后台节流导致的偶发 ping 超时误判
- Windows 端退出时重复日志 + 偶发卡死：删除 `_quit_app()` 中重复的"正在停止服务器..."日志；`_check_still_running()` 检查 `_quitting` 标志位防止退出期间重复调用 `_handle_server_exit()`；`_quit_app()` 添加防重入守卫

---

## [1.1.6] - 2026-06-04

### 新增（Added）
- 作业「在校提前完成」属性：孩子端在开始确认弹框中可一键标记作业为已在学校提前完成，`actualDuration = ceil(suggestedDuration × 90%)`，直接入库
- 管理端统计新增「在校提前完成比例」饼图（本周/本月/全部历史可切换），放在评级饼图前
- 管理端作业列表为 `completedInSchool` 作业显示「🏫在校完成」标签
- 独立数据库迁移脚本 `migrate_efficiency_all_modes.py`：重新计算历史效率数据（用后即删）

### 变更（Changed）
- 效率统计范围从仅挑战模式扩展为所有非驳回已完成作业（计时模式、在校提前完成等均计入）
- 邮件导入作业默认包含 `completedInSchool: false` 字段
- 管理端驳回作业时同步清除 `completedInSchool` 标记

### 修复（Fixed）
- 当天已评级后新增作业不再弹出评级框：`calculateSettlement()` 检测到当天已有评级时直接按已有倍率计算追加积分，不含每日基础分，并自动调用 `updatePoints` 增加积分
- 管理端新增作业时不再无条件清空 settlement：`saveAdminHw()` 仅在 settlement 无评级时才调用 `API.saveSettlement({})` 清空，保护已有评级不被覆盖

---

## [1.1.5] - 2026-06-03

### 已知功能（当前版本快照）

本条目记录文档创建时项目已有的全部功能，作为变更日志的基线。

#### 新增

- 作业管理：添加/开始/暂停/完成作业，挑战模式（限时）和自由模式（计时器）
- 语音提醒（TTS）：edge-tts 引擎（zh-CN-XiaoxiaoNeural），覆盖超时提醒、评级播报、商店上新
- 积分与评级：四级评级（优/良/可/差），效率加成积分计算，积分历史追踪
- 积分商店：商品管理、积分兑换、Buff 系统、兑换记录
- 奖励箱：家长发放奖励，孩子自主兑换
- 赏金任务：发布/提交/审核/完成，积分发放
- 数据统计：管理端折线图/饼图（作业用时、效率比、评级分布）
- 邮件同步：IMAP 收取 + DeepSeek AI 解析作业 + 附件下载
- 离线支持：Service Worker + localforage 缓存 + 增量同步（pull/push）
- Android APP：Flutter WebView 混合应用，离线快照，APK 自动更新
- Windows 桌面端：系统托盘、开机自启、配置管理、凭据安全存储
- 一站式发布脚本（release.py）：EXE + APK + ZIP 打包

---

## 变更日志模板

后续版本请按以下格式记录变更：

```
## [版本号] - YYYY-MM-DD

### 新增（Added）
- 新功能

### 变更（Changed）
- 已有功能的变更

### 弃用（Deprecated）
- 即将移除的功能

### 移除（Removed）
- 已移除的功能

### 修复（Fixed）
- Bug 修复

### 安全（Security）
- 安全相关修复
```
