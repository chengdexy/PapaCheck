# PapaCheck 变更日志

> 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)

---

## [Unreleased]

### Added
- **合并 CloudBase 迁移分支（代码级下线离线模式）**：将 `backup/pre-rewrite-2026-07-14`（2026-07-07~14 的 ECS→云函数迁移 + 全面下线离线任务线）经受控合并合入 `main`。Web 端 `connection.js`/`db.js`/`crdt-sync.js`/`sync.js`/`sw.js` 全部移除，`ConnectionManager` 引用降为 0，`RealtimeManager` 就位；Android 移除离线快照/写队列；Site/Release 改用 `tcb hosting deploy`/`tcb fn deploy`/CDN 302 绕过 ECS。后端 4 个冲突文件（`app.ts`/`admin/routes.ts`/`postgres-adapter.ts`/`types.ts`）保留 `main` 的数据按需后端。回退点：`git tag pre-merge-backup-20260719`。详见 `docs/merge-cloudbase-migration-2026-07-19.md`
- **版本全链路对齐 1.6.7**：Android `pubspec.yaml`、CloudFunc `package.json`（`/api/version` 来源）、`cloudbaserc.json`（`/api/download` CDN）统一为 1.6.7

### Changed
- **文档大范围修正与清理**：落地页 5 处"离线可用"改为"云端实时同步"，"AI 评优"改为"家长评优"，"拍照录入作业"改为"添加作业"。ECS 链接全部切换到 CloudBase 路径。Footer 版本号 v3.0→v1.6.6。HANDOVER 标记 CloudBase 迁移完成、ECS 已下线，删除 ECS 配置/切换流程/回滚预案 3 节。PROGRESS/PRD/README 同步更新。清理 10 份已完成功能的过期 spec/plan 文档
- **Release 控制台 Windows 兼容性修复**：`executor.ts` `executeSteps()` 在 Windows 上默认 `shell: true` 以正确解析 `.cmd` 包装脚本。`site-publish.ts`/`fn-deploy.ts` 改为 `exec()` 避免 `execFile + shell: true` 的 DEP0190 废弃警告。`console-server.ts` 将 site/web/fn 部署改为使用共享 `executor` 实例，SSE 进度正常展示。新增 `PapaCheck.Web/deploy.bat` 实现仅上传必要文件（跳过 node_modules/tts_cache/apk/__tests__），避免 7800+ 垃圾文件上传。`.gitignore` 添加 `_web_deploy/`

- **文档事实审计（第二轮）**：核对全部 Markdown 与代码事实，修正多处硬错误——① 表数量统一为 **27 张**（`PapaCheck.Server/scripts/init-pg-schema.sql` 实际建表数，此前误写 26 或 30；ARCHITECTURE 数据模型表移除不存在的 `tenant_members`/`sync_metadata`/`sessions`/`audit_log`）；② 现状文档（README/ARCHITECTURE/PRD/HANDOVER/PROGRESS）中"实时监听替代轮询"等表述修正为实际采用的轻量版本戳短轮询；③ 6 份 CloudBase 迁移子计划稿与 1 份设计稿顶部统一加「实施方式已变更」警示注记（实时监听/RLS 未落地、tts-svc 独立仓库维护、实际版本 Server 1.2.0 / Web 1.5.2 / Android 1.6.6）

### Fixed
- **修复 Android SetupPage 引导页每次启动都出现**：首次安装路径中 `ConfigService.setUrl()`/`setRole()` 缺失，URL 和角色未保存到 SharedPreferences；新增 2 行保存调用后下次启动直接跳过引导页
- **修复 RealtimeManager 启动失败：`@cloudbase/js-sdk` 裸模块标识符无法解析**：在 `admin.html`/`index.html` 中添加 `importmap`，将 `@cloudbase/js-sdk` 映射到 esm.sh CDN
- **修复 papacheck-api 云函数持续 `FUNCTION_INVOCATION_FAILED`**：根因为 `src/auth/jwt.ts` 在**模块加载期**向只读的 `/data/.jwt_secret` 写文件触发 `EROFS`，导致入口 `exports.main` 从未赋值；叠加部署入口漏写 `--dir dist`、CLI 环境变量推送不落盘。修复：JWT 密钥改为随包 `dist/jwt.secret` 文件（只读可读）、入口拆双文件（`index.js` wrapper 懒加载 `handler-body.js` 真实逻辑，异常以 500 JSON 返回真实栈）、构建改为自包含 bundle。方案A 轻量版本戳端点 `GET /papacheck/api/data-version` 已正式上线
- **修复孩子端 buff 道具严重超时仍显示在 buff 栏**：原逻辑 `renderBuffBar` 直接渲染全部 `cachedData.activeBuffs` 且不判断过期。新增 `buffExpiryTs`/`isBuffActive`（按 `unit` 区分分钟/天，含本地日期与时区容错），加载配置时 `loadConfig` 剔除已过期 buff 并回写清理后的列表（避免存储无限堆积），`renderBuffBar` 同时做防御性过滤。连带更新 `data-layer.test.js`（用含有效 startDate 的 buff 替代裸 mock，新增过期 buff 过滤专项测试）
- **修复孩子端积分不及时更新**：孩子端 `refreshCurrentView()`（child 分支）原实现只 `loadChildDay` 不重载积分，导致家长端审批赏金/改分（服务端积分变化经 RealtimeManager 版本戳触发本刷新）后孩子端积分余额长期不刷新。改为 `Promise.all([loadChildDay(_todayKey()), _reloadPoints()])` 同步重载积分。注：孩子端自行兑换道具 (`redeemItem`) 已通过 `Data.loadConfig()` 刷新积分，不在本 bug 范围。新增「child 端 refreshCurrentView 重载积分」单测

### Removed
- **移除 Flutter WebView 加载遮罩（15 秒转圈）**：`_waitForPageReady()` 定期检查已移除的离线模块 `connStatus` className，永远不满足条件，必须等 15 秒超时。移除 `_isPageReady`/`_readyCheckTimer`/`_waitForPageReady`/遮罩 Container，改为 WebView 加载完毕直接启动电池监控
- **移除 Web 端连接状态圆点 connStatus 及 CSS 样式**：离线模块移除后该元素无人维护状态，在 `admin.html`/`index.html`/`style.css`/`admin.css` 中删除

### Added
- **数据按需获取（Server + Web + CloudFunc）**：新增 `GET /api/stats` 服务端聚合统计端点（week/month/all 三种 range，13 字段 StatsResult），返回体积与孩子历史使用天数解耦（week 视图 1823B vs 旧 79806B，降为 1/44）。新增 `GET /api/points/balance`、`GET /api/bounty-completions/total`。前端新增 `window.Data` 模块化数据层（`PapaCheck.Web/js/data-layer.js`），admin/app/big-screen 三端迁移到按需拉取，版本戳变化后只刷新当前视图资源（FR-6/AC-4）。CloudFunc 生产同步部署完成。详见 `docs/design-data-on-demand.md`
- **真实 access_code 端到端验证**：用生产 access_code 经 `/api/auth/exchange` 换 JWT，验证全部按需端点 200 + 结构正确（13 字段 / balance / bounty-completions / /api/data 瘦身确认）
- **生产验证脚本**：`PapaCheck.CloudFunc/papacheck-api/scripts/verify-data-on-demand.mjs` 可独立运行验证按需端点
- **AI 作业 API 文档**：`docs/ai-homework-api.md`，供可信 AI 助手调用的 API 说明（认证 + 字段 + curl 示例）
- **实时刷新回归清单**：`docs/regression-realtime-checklist.md`

### Fixed
- **CloudFunc TZ 代码级固化**：`getWeekStart`/`formatWeekLabel` 改用 Date.UTC + getUTC* 显式按 Shanghai 日历日计算，结果与进程 TZ 环境变量无关。实际部署不再依赖 `cloudbaserc.json` 的 `TZ=Asia/Shanghai`
- **生产 Bug：创建孩子 500**：`POST /api/admin/members` 因生产库 `children`/`access_codes` 表 NOT NULL 无默认值列未填 + 外键插入顺序反转（child 先填了不存在的 access_code id）导致 500。两轮修复：防御性补全 INSERT 列（`created_at`/`is_active`/`token_version`）+ 改为 child-first → access_code → 回填的正确顺序。用户实机验证创建孩子成功
- **过期 Web 单测清理**：T01-T04 前端迁移遗留的 8 个过期测试文件已清理（删除 4 个整文件 + 修正 4 个文件），`js/__tests__/` 全量 31 文件 / 210 用例通过

### Changed
- **`/api/data` 瘦身并标 deprecated**：不再返回 `points.history` / `efficiencyHistory` / `badges` / `history` / `tasks` 5 个字段，保留 `bountyCompletions`。客户端后续应按新端点按需拉取，`/api/data` 暂时保留作回退

### Fixed
- **修复数据按需重构后家长端设置页积分不刷新、日历切过往日期空白**：根因为 `Data.refreshCurrentView()` 的 admin 分支对 settings 等 tab 直接 `return` 跳过刷新，作者假设写操作都做了本地乐观更新，但 `confirmAdjustPoints` 调 `API.updatePoints` 后未写回 `cachedData.points`，且从 settings tab 切到过往日期时 `loadAdminDay()` 永不执行。修复：`refreshCurrentView` 的 settings 分支改为重拉当日 + 积分余额（`_reloadPoints`）；`confirmAdjustPoints` 捕获返回余额做乐观写回。已部署 `papacheck/app/`

### Added
- **家长端日历月视图「有数据日期索引」端点**：新增 `GET /api/data-dates?month=YYYY-MM`，对该租户/孩子 5 张业务表（homeworks / daily_settlement / free_time_tasks / bounty_submissions / bounty_completions）按 `date_key` 区间查询，去重返回该月「有数据日期」升序键数组（homeworks 仅计未删除项）。前端 `API.getDataDates(year, month)` 按显示月拉取、切月再拉，日历网格用索引点亮 `has-data`，不再整片空白。按月按需，避免全量拉取日期索引

### Changed
- **日历假日状态改为独立叠加显示**：`buildMiniCalendar` 中 `holiday` 脱离互斥 `else if` 链、改为独立挂类；CSS `.mini-cal-day.holiday` 由「橙黄底 + 橙字」改为 `outline: 2px solid` 橙黄边框（`outline-offset: -2px` 内收、不占布局），使「假日 + 有数据」两者同时可见（假日橙框 + 数据态着色），不再互相吞没。已部署 `papacheck/app/`

### Changed
- **简化积分道具兑换流程（去掉申请与家长同意）**：孩子端奖励箱物品按钮由「兑换（提交申请）」改为「使用」，点击后直接进入待使用框——time 类生成 `freeTimeTask`、buff 类生成 `activeBuff`，不再创建 `pending` 兑换记录、不再等待家长端「确认兑现」；time 类使用后立即主动弹出开始计时确认界面（`confirmStartFreeTime`）。家长端「兑换管理」移除「待兑现」列表与「确认兑现」按钮，仅保留已兑现历史。后端无需改动（`/freetime/:id`、`/active-buffs/:id`、`/reward-box` 均 `requireChild`，孩子端 JWT 可直接调用）。已部署 `papacheck/app/`

### Changed
- **孩子端移动端显示增强（响应式缩放 + 屏保竖屏适配）**：
  - **积分道具「开始」确认框响应式**：`confirmStartFreeTime` 标题/正文改用 `clamp()` 随屏缩放（不再固定 32px/20px），两个按钮改为 `flex:1 1 0; min-width:0` 平分宽度，窄屏不再溢出/挤压。
  - **屏保竖屏适配**：`.saver-time/.saver-date/.saver-message` 字号由固定 200px/48px/32px 改为 `clamp()`（时间 `clamp(80px,22vw,200px)`），屏保容器加 `padding/box-sizing/overflow:hidden`，巨字不再越过右边界被切，竖屏手机完整显示。
  - **主界面溢出/错换行防御**：`.task-actions`、`.big-header-right` 按钮组加 `flex-wrap: wrap` 防窄屏越过右边界；`.current-task-name` 的 `word-break: break-all`（中文逐字断行）改为 `overflow-wrap: anywhere` 修「文字错误换行」；`.big-card-title`/`.homework-card-row`/`.homework-meta-row` 加 `min-width: 0` 防 flex 子项撑破容器。已部署 `papacheck/app/`
  - **补全主界面响应式（修复 `.big-stats` 越界真凶）**：`@media (max-width:480px)` 段原本把 `.big-stats` 强制 `flex-wrap: nowrap; overflow-x: auto`（2 个 stat + 2 个长文字按钮横向溢出右边界）。改为 `flex-wrap: wrap` + 子项 `flex: 1 1 calc(50% - 5px); min-width:0`，统计栏变 2×2 网格不再溢出；`.btn-shop-nav` 加 `white-space: normal` 允许文字换行。贯彻「缩放优先」：`.big-time/.big-date/.stat-value/.current-task-name` 大字号改 `clamp()` 随屏自适应（桌面取上限不变）。竖屏 `.big-header` 加 `flex-wrap: wrap` 保险。已部署 `papacheck/app/`

## [1.4.2] - 2026-06-25

### Changed
- **升级 using-superpowers skill 至 v6.0.3**：从 obra/superpowers 官方仓库同步更新。SKILL.md 全面重写：工具调用改为 action-oriented 语法、新增"Never read skill files manually"警告、流程图中 `EnterPlanMode` 简化为 `plan mode`、`debugging` 引用统一改为 `systematic-debugging`。新增 3 个参考文件（`claude-code-tools.md`、`pi-tools.md`、`antigravity-tools.md`），重写 `copilot-tools.md`/`codex-tools.md` 为 action-oriented 格式。"Skill Priority" 节新增 `mcp-builder` 实现技能示例
- **Android 包名 `com.example.papacheck_android` → `com.chengdexy.papacheck`**：同步更新 Kotlin 目录结构、Flutter 包引用、MethodChannel 名。生成 Release 签名证书（CN=chengdexy），build.gradle 配置 release 签名。密钥库 `release.keystore` 加入 `.gitignore`
- **IDatabase 接口拆分为 6 个子接口**：按职责拆分为 `IHomeworkStore` / `ISettlementStore` / `IShopStore` / `IAuthStore` / `IOpsStore` / `ISyncStore`，组合为 `IDatabase` 保持向后兼容。`DatabaseAdapter` 精简约 100 行 abstract 方法声明，工具方法和 Ops stubs 保留
- **全量 `any` 类型替换为具体 DTO 或 `unknown`**：定义 14 个 DTO 类型（`HomeworkDTO`/`SettlementDTO`/`ShopItemDTO` 等），替换 `FullDataSnapshot`、`postgres-adapter.ts` 方法签名、4 个接口文件及杂项文件中共约 190 处 `any`。`CRDTOperation.value` 改为 `unknown` 防止随意赋值。路由处理器 `request: any` 保留（Fastify 标准用法）
- **邮件模块 import 合并**：`email/index.ts` 4 行 import 合并为 2 行，消除冗余的类型导入
- **`PapaCheck.Server.Node` 重命名为 `PapaCheck.Server`**：消除历史遗留的 `.Node` 后缀（Python 服务端已删除）。涉及本地目录 git mv、12 个引用文件路径更新、云端目录 mv 及 papacheck.service WorkingDirectory 同步。云端已手动迁移完成，服务正常运行
- **替换硬编码服务器 IP 为域名**：`cloud-publish.ts` 和 `site-publish.ts` 默认服务器地址从 `123.57.129.243` 改为 `papacheck.chengdexy.cn`，IP 不再出现在 git 跟踪的代码中。`PAPACHECK_CLOUD_IP` 环境变量仍可覆盖

### Fixed
- **修复文档版本号与 pubspec.yaml 不同步**：README / PROGRESS / ARCHITECTURE / PRD / API 五份文档版本号从 `v1.4.0` 同步为 `v1.4.2`（事实来源为 `PapaCheck.Android/pubspec.yaml` 的 `1.4.2+0`）
- **修复 big-screen.js XSS 漏洞**：`hw.subject` 和 `hw.content`（用户输入的作业数据）在 8 处插入 `innerHTML` 未转义，攻击者可注入恶意脚本。全部包裹 `escapeHtml()` 转义。新增 4 个 XSS 防护测试
- **修复 admin.js setInterval 内存泄漏**：行 150 `setInterval(...)` 返回值未保存，无法清理，页面切换导致定时器堆积。引入 `_refreshInterval` 变量 + `startRefreshTimer()`/`stopRefreshTimer()` 配对函数 + `beforeunload` 事件清理。新增 4 个定时器生命周期测试
- **修复 6 处空 catch 块静默吞没错误**：api.js 行 47/121/212、app.js 行 1272/1294/1401 的 `catch (e) {}` 添加 `console.warn('[模块] 操作失败:', e)` 日志，便于调试。新增 2 个空 catch 日志测试

### Added
- **Release Console 发布控制台**：`PapaCheck.Release/` 子项目，Node.js/TypeScript 重写原 `release.py`。CLI 四子命令（serve/build-apk/cloud/site）+ Web 控制台（暗色主题、SSE 实时日志、步骤状态追踪、操作记录）。执行引擎 EventEmitter 驱动，支持超时保护、行缓冲日志。BDD/TDD 开发，15 个测试覆盖执行器/版本管理/发布流程/模块解析（[设计文档](docs/superpowers/specs/2026-06-22-release-console-design.md)）
- **云同步前自动重置 PG 测试库**：`lib/reset-test-db.ts` 删库重建 + 重跑 schema，确保集成测试通过
- **控制台顶部环境变量状态展示**：显示 PAPACHECK_CLOUD_IP 和 PAPACHECK_SSH_USER 配置状态，未设置红色警示
- **StepDef 新增 env 字段**：支持子进程环境变量覆盖
- **日志面板保存按钮**：保存日志到 `log/` 目录，文件名 `release-{type}-{timestamp}.txt`

### Fixed
- **修复构建 APK 时归档误用旧版 APK 导致文件名版本与实际不符**：`build-apk.ts` 中 `_archiveApk(newVer)` 在 `executor.runAndReport()` 前内联调用，此时 Flutter 构建尚未执行，归档的是上次构建残留的旧版 APK。改为将归档逻辑内联到 executor step 中（`['node', '-e', code]`），构建成功后才执行归档
- **修复构建 APK 递增版本时构建号被重置为 0**：`_updatePubspecVersion` 写入 `+0` 导致 `version: 1.4.0+59` 递增后变为 `1.4.1+0`。改为保留已有构建号。删除已废弃的 `_archiveApk` 函数及未使用的 fs/path 导入
- **修复 Windows Release 控制台 findstr 管道参数损坏**：`cloud-publish.ts` 中 vitest 输出过滤使用 `findstr /C:" FAIL "`，经 `cmd.exe /s /c` 执行时 `\"` 被 cmd.exe 当作字面字符而非转义序列，导致 findstr 把 `/C:` 参数当文件名报 `Cannot open`，阻塞整个云同步流程。改为直接运行 `npx vitest run 2>&1` 避免 cmd.exe 引号问题
- **修复 Windows Release 控制台 tar 命令路径引号问题**：`site-publish.ts` 中 `tar -czf "${landingTar}"` 经 `cmd.exe /s /c` 时 `\"` 被当作字面字符，tar 收到含字面双引号的文件路径。改为数组参数 (`shell: false`) 绕过 cmd.exe 引号处理
- **修复 Windows scp 使用 SFTP 协议导致上传文件路径丢失**：Windows OpenSSH 9.5 scp 默认走 SFTP 协议，目标路径 `user@host:/tmp/` 处理后文件未落到预期位置。改用 Node.js `createReadStream` + SSH `cat>` pipe 上传，完全绕过 scp 行为差异
- **修复 Release 控制台日志 ANSI 转义码导致复制时空格变方框**：`console.html` 的 `onLog` 直接显示终端原始输出（含 `ESC[36m` 等控制字符），复制时控制字符渲染为方框。添加 `stripAnsi()` 剔除 ANSI 转义码后显示
- **修复 Release 控制台清理步骤 node -e 引号冲突**：`site-publish.ts` 步骤 4 使用 `node -e "..."` 通过 `shell: true` 执行，同样被 cmd.exe 引号处理破坏。改为数组参数形式
- **修复测试数据库 schema 循环 FK 依赖导致建表失败**：`init-pg-schema.sql` 中 `access_codes` 和 `children` 互为外键，但 `access_codes` 在 `children` 之前创建导致失败。交换创建顺序，`children` 先建后建 `access_codes`，两个 FK 约束通过晚绑定 ALTER TABLE 添加
- **修复并发测试重复执行 DDL 引起 schema 损坏**：`PostgresAdapter._initSchema` 每次创建适配器都执行完整 DDL batch，并发测试下唯一索引创建因重复数据失败导致整批回滚。改为先检测 `tenants` 表是否存在，已存在则跳过 DDL
- **修复 _initSchema 插入默认租户时唯一键冲突**：`ON CONFLICT (id) DO NOTHING` 无法处理 `uq_tenants_name` 唯一约束，并发测试中多个适配器用同一名称创建租户导致失败。改为 `ON CONFLICT (name) DO NOTHING`
- **修复多孩子可回滚性测试重新执行 schema 时数据冲突**：`multi-child-reversibility.test.ts` 在已写入数据的表上重新执行 `init-pg-schema.sql`，现有数据导致部分唯一索引创建失败。重新执行前先清理 per-child 表数据
- **修复 SSE 连接客户端未清理内存泄漏**：`console-server.ts` 中 broadcast 遍历和 send 写入增加 try-catch，异常客户端立即自清理，防止单个异常阻断后续广播
- **修复 npx tsx -e 内联脚本 Windows 引号冲突**：版本号递增、APK 归档、清理步骤、schema 重置统一改为直接 fs 调用或独立脚本文件
- **修复控制台 CSS unicode 转义**：`\uXXXX` 改为 `\XXXX`（CSS 不支持 `\u` 前缀）
- **构建 APK 默认不递增版本号**：需用户显式选择 bump 或指定 --bump 参数
- **修复 `/parent` 路由错误重定向到管理面板**：`GET /parent` 应 301 到 `/app`（客户端家长界面），之前被错误改为 `/admin/`（React 管理面板），已改回（[app.ts](file:///E:/trae_projects/PapaCheck/PapaCheck.Server/src/app.ts)）
- **修复 CRDT 推送测试使用过时操作格式**：`api.test.ts` 中 CRDT 操作使用旧版 `field: 'status', value: 'completed'` 字符串格式，改为新版 `value: { ... }` 对象格式，消除 `Cannot create property 'lastModified' on string` 错误

### Removed
- **移除弃用的迁移验证测试（3 个文件）**：`multi-child-schema.test.ts`（schema 结构验证）、`access-code-model.test.ts`（access_codes 表结构验证）、`multi-tenant-schema.test.ts`（SQL 文件静态验证）。本地 schema 已与云端完全一致，无需重复验证。删除后解决并行测试竞态问题
- **移除弃用的 PapaCheck.Windows 桌面端**：删除整个 `PapaCheck.Windows/` 目录（8 个文件），包含 Tkinter GUI 主程序、PyInstaller 构建脚本、版本管理工具等。同时清理关联的 3 个测试文件
- **移除 Python 死代码**：删除 `release.py`、`pytest.ini` 及 `PapaCheck.Tests` 中的 3 个 Windows 测试文件，项目不再依赖 Python 运行时
- **清理过期 spec/plan 文档（68 个文件）**：删除 `.trae/specs/`（11 个已完成功能的 spec 目录，含 spec/tasks/checklist 共 31 个文件）、`docs/superpowers/`（14 个设计文档 + 16 个计划文档，共 30 个已实现功能的设计方案）、`.trae/documents/`（4 个已过期的方案文档）。同时清理 `PapaCheck.Memo/` 开发备忘目录（3 个文件）及 `docs/` 下旧版 HTML 周报文件（4 个文件）

## [1.4.0] - 2026-06-22

### Added
- **本地 Nginx 开发环境（镜像云端路由）**：新增 `nginx.dev.conf`（HTTP :8081，去 SSL），`scripts/start-dev.ps1` 一键启动脚本，`.vscode/launch.json + tasks.json` 支持 F5 一键拉起 Node.js + Nginx。Nginx 静态路由（`/` 落地页、`/admin/` 管理面板）验证通过，代理路由（`/app/`、`/login`、`/api/`）需 Node.js 后端配合（[#nginx.dev.conf](file:///e:/trae_projects/PapaCheck/nginx.dev.conf)）
- **多孩子迁移数据可靠性测试**：新增 4 个 TDD 测试文件（19 个测试），覆盖 schema 结构验证、12 张 per-child 表数据分配正确性、迁移幂等性、可回滚性。用于上线前验证多孩子架构变更的数据库迁移可靠性（[#multi-child-schema.test.ts](file:///e:/trae_projects/PapaCheck/PapaCheck.Server/test/migration/multi-child-schema.test.ts)）
- **生产环境多孩子数据迁移完成**：对线上 `papacheck` 数据库执行 `init-pg-schema.sql` + `migrate-access-code-model.sql`，创建 children 表、12 张表 child_id 列、12 个部分唯一索引、access_codes 模型迁移。备份 + 迁移 + 部署 + 重启 全流程完成
- **v1.4.0 APK 发布**：Android APK 版本 1.4.0+59，包含 WebView session 持久化修复。上传至云端 `/apk/PapaCheck-1.4.0.apk`

### Fixed
- **Android 家长端 WebView 冷启动后 sessionStorage 丢失导致跳转到登录页**：认证 token 存储在 WebView 的 `sessionStorage` 中，Android 系统回收 WebView 进程后 token 丢失，API 调用 401 跳转到登录页。Flutter 层新增 ConfigService 持久化 auth token 到 SharedPreferences，WebView 冷启动时通过中间 HTML 页将 token 注入 `sessionStorage` 后再重定向到目标 URL。Web 端代码不变，多标签隔离不受影响。新增 5 个 TDD 测试，全量 37 Flutter 测试通过 ([#config_service.dart](file:///e:/trae_projects/PapaCheck/PapaCheck.Android/lib/services/config_service.dart) [#main.dart](file:///e:/trae_projects/PapaCheck/PapaCheck.Android/lib/main.dart))
- **`migrate-access-code-model.sql` 不会自动创建 children 记录**：脚本 Step 2 先根据旧 `type='child'` 的 access_codes 创建 children 记录，再分配 child_id → 再 DROP type/nickname。新增 Step 3.5 DO 块自动分配 12 张 per-child 表的遗留数据
- **服务器 `api.js` 用 `localStorage` 导致 `/api/data` 返回 401 死循环**：`login.html` 将 token 存入 `sessionStorage`，但服务器 `api.js` 是旧版本（用 `localStorage`），`API.getData()` 读不到 token → 401 → 重定向登录 → 死循环。上传最新版 `api.js` 等 7 个 JS 文件
- **孩子端移动端三连修（拖动滚屏失效 + 列表换行难看 + 整体过大）**：①`@media(max-width:900px)` 下 `.big-screen-mode.active` 原为 `position:static; min-height:100dvh` 且 body `overflow:hidden`，整页无法滚动、下方内容被裁；改为 `position:fixed; inset:0; height:100dvh; overflow-y:auto` 成为真正全屏滚动视口，`overscroll-behavior:contain` 防链动，sticky 顶栏仍生效。②作业/赏金卡标题原内联 `font-size:18px` 写死无截断，窄屏长科目名折行难看；新增可缩放类 `hw-icon/hw-subject-row/hw-subject(flex:1 1 auto;min-width:0;省略号)/hw-mode(flex-shrink:0)/hw-content(2 行截断)/hw-sub/hw-count`，big-screen.js 作业卡 + 3 处赏金卡模板改用。③`@media(max-width:480px)` 整体缩放优先：padding/gap/字号/按钮全面下调（按钮保留 44px 触控高度），`reward-item-name` 单行省略。已部署 papacheck/app 并回源验证生效（[style.css](file:///e:/trae_projects/PapaCheck/PapaCheck.Web/css/style.css) [big-screen.js](file:///e:/trae_projects/PapaCheck/PapaCheck.Web/js/big-screen.js)）
