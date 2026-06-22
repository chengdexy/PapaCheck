# PapaCheck 变更日志

> 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)

---

## [Unreleased]

### Changed
- **`PapaCheck.Server.Node` 重命名为 `PapaCheck.Server`**：消除历史遗留的 `.Node` 后缀（Python 服务端已删除）。涉及本地目录 git mv、12 个引用文件路径更新、云端目录 mv 及 papacheck.service WorkingDirectory 同步。云端已手动迁移完成，服务正常运行
- **替换硬编码服务器 IP 为域名**：`cloud-publish.ts` 和 `site-publish.ts` 默认服务器地址从 `123.57.129.243` 改为 `papacheck.chengdexy.cn`，IP 不再出现在 git 跟踪的代码中。`PAPACHECK_CLOUD_IP` 环境变量仍可覆盖

### Added
- **Release Console 发布控制台**：`PapaCheck.Release/` 子项目，Node.js/TypeScript 重写原 `release.py`。CLI 四子命令（serve/build-apk/cloud/site）+ Web 控制台（暗色主题、SSE 实时日志、步骤状态追踪、操作记录）。执行引擎 EventEmitter 驱动，支持超时保护、行缓冲日志。BDD/TDD 开发，15 个测试覆盖执行器/版本管理/发布流程/模块解析（[设计文档](docs/superpowers/specs/2026-06-22-release-console-design.md)）
- **云同步前自动重置 PG 测试库**：`lib/reset-test-db.ts` 删库重建 + 重跑 schema，确保集成测试通过
- **控制台顶部环境变量状态展示**：显示 PAPACHECK_CLOUD_IP 和 PAPACHECK_SSH_USER 配置状态，未设置红色警示
- **StepDef 新增 env 字段**：支持子进程环境变量覆盖
- **日志面板保存按钮**：保存日志到 `log/` 目录，文件名 `release-{type}-{timestamp}.txt`

### Fixed
- **修复 SSE 连接客户端未清理内存泄漏**：`console-server.ts` 中 broadcast 遍历和 send 写入增加 try-catch，异常客户端立即自清理，防止单个异常阻断后续广播
- **修复 npx tsx -e 内联脚本 Windows 引号冲突**：版本号递增、APK 归档、清理步骤、schema 重置统一改为直接 fs 调用或独立脚本文件
- **修复控制台 CSS unicode 转义**：`\uXXXX` 改为 `\XXXX`（CSS 不支持 `\u` 前缀）
- **构建 APK 默认不递增版本号**：需用户显式选择 bump 或指定 --bump 参数
- **修复 `/parent` 路由错误重定向到管理面板**：`GET /parent` 应 301 到 `/app`（客户端家长界面），之前被错误改为 `/admin/`（React 管理面板），已改回（[app.ts](file:///E:/trae_projects/PapaCheck/PapaCheck.Server/src/app.ts)）
- **修复 CRDT 推送测试使用过时操作格式**：`api.test.ts` 中 CRDT 操作使用旧版 `field: 'status', value: 'completed'` 字符串格式，改为新版 `value: { ... }` 对象格式，消除 `Cannot create property 'lastModified' on string` 错误

### Removed
- **移除弃用的 PapaCheck.Windows 桌面端**：删除整个 `PapaCheck.Windows/` 目录（8 个文件），包含 Tkinter GUI 主程序、PyInstaller 构建脚本、版本管理工具等。同时清理关联的 3 个测试文件
- **移除 Python 死代码**：删除 `release.py`、`pytest.ini` 及 `PapaCheck.Tests` 中的 3 个 Windows 测试文件，项目不再依赖 Python 运行时

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
