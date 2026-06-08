# PapaCheck 变更日志

> 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)

---

## [Unreleased]

### Fixed
- 修复 Windows 端开机自启动配置未生效 + 注册表旧版本残留无清除机制的问题：
  - `_is_autostart()` 改为读取注册表值并用 `os.path.isfile()` 验证可执行文件是否存在，而非仅检查键名存在
  - 新增 `_cleanup_stale_autostart()` 启动时自动清理无效/旧版本注册表条目
  - `_set_autostart()` 写入前后自动清理残留条目并增加操作日志
  - 启动时（`__init__`）自动执行注册表残留清理
- 修复孩子端无限 PUT `/api/settlement/:date` 和 `/api/efficiency/:date` 的问题：`calculateSettlement()` 添加 re-entrant guard（`_calculatingSettlement` 防止并发重复执行）+ `_putSettlementIdempotent`/`_putEfficiencyIdempotent` 数据快照对比（相同数据跳过 PUT），消除轮询触发的无限 PUT 循环
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
