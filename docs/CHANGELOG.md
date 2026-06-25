# PapaCheck 变更日志

> 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)

---

## [Unreleased]

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
