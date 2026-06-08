# PapaCheck 进度记录

> 最后更新：2026-06-08 18:18

## 当前版本

**v1.2.10**（Android 更新后自动清空缓存）

---

## 已完成功能

### 核心功能

- [x] 作业管理（添加/开始/暂停/完成）
- [x] 在校提前完成（孩子端一键标记，用时按建议时长90%记录）
- [x] 挑战模式（限时）和自由模式（计时器）
- [x] 家长评级（优/良/可/差）+ 积分计算
- [x] 积分历史追踪
- [x] 积分商店（商品管理、积分兑换、Buff 系统）
- [x] 奖励箱
- [x] 赏金任务（发布/提交/审核/完成）
- [x] 作业延后申请（request/approve/reject）

### 多端支持

- [x] Web 孩子端（大屏界面）
- [x] Web 管理端（管理界面 + 数据统计图表）
- [x] Android APP（Flutter WebView + 离线快照 + APK 自动更新 + 更新后自动清缓存）
- [x] Windows 桌面端（系统托盘 + 开机自启 + 凭据安全存储）

### 基础设施

- [x] Python HTTP 服务器 + SQLite 数据库
- [x] Node.js HTTP 服务器（Fastify + better-sqlite3 + TypeScript）
- [x] TTS 语音提醒（edge-tts，Python 子进程桥接）
- [x] 邮件同步（IMAP + AI 解析）
- [x] 附件下载
- [x] 离线支持（Service Worker + localforage）
- [x] 增量同步（pull/push）
- [x] 一站式发布脚本（release.py）
- [x] OpenAPI 自动文档（Swagger UI）
- [x] 单 EXE 构建（Node.js SEA）
- [x] 测试框架（pytest + Vitest 4.x + Flutter test）
- [x] JS/TS 代码覆盖率 85.12%（Stmts）
- [x] Python 代码覆盖率 18%（release.py 32%）

---

## 待开发功能

- [ ] 云 SaaS 多租户架构
- [ ] iOS 端
- [ ] 多孩子支持（数据模型已有，UI 未实现）
- [ ] 更丰富的数据分析与报告
- [ ] 离线模式重构（spec 已有）
- [ ] 离线优先同步优化（spec 已有）
- [ ] 离线功能差距填补与前端测试（spec 已有）
- [ ] 简化 Flutter 启动流程（spec 已有）
- [ ] Windows 端合并到服务端（spec 已有）

---

## 已知问题

- `GET /api/tasks/{date_key}` 和 `POST /api/tasks/{date_key}` 为预留接口，未实现实际逻辑
- `bounty_completions` 表使用 `_total` 作为特殊 date_key 存储全局计数器，设计不够清晰

---

## 最近变更

| 日期 | 变更 |
|------|------|
| 2026-06-08 | 修复 Windows 端开机自启动未生效 + 注册表旧版本残留无清除机制；`_is_autostart()` 路径有效性校验；新增 `_cleanup_stale_autostart()`；启动时自动清理；全量 372 测试通过 |
| 2026-06-08 | 修复孩子端无限 PUT settlement/efficiency + 奖励箱新奖励未播报 + efficiency 幂等性补全；新增 TDD 测试 6 个；全量 362 测试通过 |
| 2026-06-08 | 修复提交评级后 pollServer 覆写 `submittedAt` 卡在提交界面 + 通知重复播放 + TTS cache 持久化 + SEA daemon 回退到 spawnPython；全量 356 测试通过 |
| 2026-06-08 | 修复语音自动播放三连 Bug（假解锁锁死 / NotAllowedError 插队 / 通知提前消费）；全量 356 测试通过 |
| 2026-06-08 | Android 端更新版本后自动清空本地缓存（WebView 缓存 + 离线快照），保留 URL 和角色配置，确保从服务端下载最新资源；TDD 新增 7 个 Flutter 测试 |
| 2026-06-08 | 修复 `updateMainClock` 中 `saverDate` 潜在空指针异常：添加空检查 |
| 2026-06-08 | 修复离线模式客户端时钟停止：`tickInterval`（时钟+任务计时器合并）拆分为独立 `clockInterval`（30 秒间隔，永不停止）和 `tickInterval`（仅任务计时器）；屏保时钟合并到 `updateMainClock` 统一更新；全量 356 测试通过 |
| 2026-06-08 | 修复 log 框显示 Node.js 弃用警告：移除 `package.json` overrides 中 `glob: "^8.1.0"`（glob 升级到 10.x 非弃用版本），添加 `_write_log()` '(node:' / '(Use `' 防御性过滤；全量 349 测试通过 |
| 2026-06-08 | 修复自由时间轮询回退 Bug：`saveFreeTimeSilent()`（全量 PUT 所有自由时间）改为 `API.putFreeTimeTask()`（只 PUT 当前任务）+ pollServer 状态保护；新增 TDD 测试 5 个；全量 349 测试通过 |
| 2026-06-08 | 修复 TTS 常驻进程 Windows 启动崩溃（asyncio pipe IOCP → run_in_executor 线程读取 stdin） |
| 2026-06-08 | 修复 `startPoll` 使用 `setInterval` 导致 poll 重叠触发的问题：改为 `setTimeout` 递归链 + `finally` 块确保前一次执行完成后才调度下一轮；`stopPoll` 同步改为 `clearTimeout`；修复兑换成功时重复播报；新增 TDD 测试 3 个；全量 349 测试通过 |
| 2026-06-08 | 修复孩子端轮询同步时最后一项作业被延后后不自动弹出评级界面 Bug：作业列表变化后全部为 done 时自动调用 `calculateSettlement()`；新增 TDD 测试 3 个；全量 341 测试通过 |
| 2026-06-08 | 修复积分商店每日数量不重置 Bug：Node.js 服务端 `_resetDailyShopQuantity()` 检查 `dailyLimit`/`dailySold` 字段与前端 `baseQuantity`/`remainingQuantity` 模型不匹配，新增 `baseQuantity → remainingQuantity` 重置逻辑；新增 TDD 测试 3 个；全量 327 测试通过 |
| 2026-06-08 | 修复孩子端作业状态轮询回退 Bug：`saveHomeworksSilent()`（全量 PUT 所有作业）改为 `API.patchHomework()`（只 PATCH 变更字段）；新增 TDD 测试 5 个；全量 324 测试通过 |
| 2026-06-08 | 修复自由时间起始播报重复时长（`durationMinutes` 冗余）；全量 341 测试通过 |
| 2026-06-08 | TTS 常驻 Python 子进程（`--daemon` stdin/stdout 协议），消除每次 spawn 的冷启动开销；全量 341 个测试通过 |
| 2026-06-08 | 修复 TTS 预生成 unsafe monkey patching：改用 Windows 客户端过滤 `[TTS] spawning` 日志；全量 321 个测试通过 |
| 2026-06-08 | Node.js 端启动时自动预生成 45 条固定短语的 TTS MP3 缓存（`FIXED_TEXTS` + `pregenAllFixed()` + 陈旧缓存清理），`pregenSpeech()` 支持无参调用 |
| 2026-06-08 | 项目清理：删除废弃文件（release.bat/RELEASE_USAGE.md/sync-mask-not-showing.env/覆盖率缓存），清理 `.trae/` 过期方案文档，图片移至 docs/imgs/ |
| 2026-06-07 | 修复管理端无法删除奖励箱物品 + Windows 防火墙弹窗优化（固定路径 + 提权添加防火墙规则） |
| 2026-06-07 | release.py 输出美化：去除命令日志，改用行内动画 + 阶段分区 + 双线框尾部总结；全量 311 个测试通过 |
| 2026-06-07 | 修复 pkg EXE 中 TTS 语音不播报：assets 路径错导致 tts_bridge.py 未打包 + existsSync 在快照虚拟文件系统失效 + Python 子进程访问不了快照路径（提取到临时目录解决）+ spawnPython 静默吞 stderr（添加 [TTS] 诊断日志）+ Voice.speak blob URL Range 请求失败（恢复原始方案）+ unlockAudio 只解锁 AudioContext 未解锁 HTMLAudioElement（添加 silent Audio.play()）+ 静态文件无反缓存头 + crypto 全局变量在 pkg 中未定义 |
| 2026-06-07 | 日志染色重构：六级逐行染色（API 状态码+方法类型 / 中文关键字），日志框增加行间距+滚动条+URL解码，配置缓存避免每次读磁盘 |
| 2026-06-07 | 修复邮件解析添加的作业在管理端显示"实际undefined分钟"：Node.js 邮件同步创建作业补充 `actualDuration: null`，admin.js 渲染判空改用 `!= null` |
| 2026-06-07 | 修复 `@fastify/static` 缓存导致静态文件全部返回 304（开发模式下禁用 ETag/Last-Modified），页面无法加载新代码 |
| 2026-06-07 | 修复 DELETE /api/notify/consumed 不符合 RESTful 规范：请求体改为 URL 查询参数 `?ids=` 传递 |
| 2026-06-07 | 专用通知接口（notify-api）：notifications 表 + 3 个 API 端点 + 前端 api.js 3 个方法 + admin.js 10 处接入 + app.js pollServer 统一通知拉取 + 邮件同步通知 + CRDT 集成；Code review 修复 6 个 minor 问题；全量 311 个 Vitest 测试通过 |
| 2026-06-07 | 修复 Android APK 更新"安装包损坏"Bug：`Directory.systemTemp` → `getTemporaryDirectory()`，提取 `UpdateService`（2 个 Flutter 测试）；全量 466 个测试全部通过 |
| 2026-06-07 | 重构 AI 邮件解析 prompt 仿照 email_client.py 重做（结构化输出格式+规则+约束）；恢复 markdown 代码块回退解析逻辑，提高鲁棒性 |
| 2026-06-07 | 修复孩子端积分商店和奖励箱的滚动条回弹问题：轮询触发 `updateBigScreen()` 时 `innerHTML` 重建 DOM 导致 `scrollTop` 重置为 0，通过保存/恢复 `scrollTop` 解决；全量 297 个 Vitest 测试通过 |
| 2026-06-07 | 修复 `updateSettlementPage()` 中引用未定义变量 `savedScrollTop` 和 `updateShopPage()` 缺失滚动恢复代码的问题；修复屏保模式轮询间隔被设为 60s 的 Bug（改为 5s）；全量 297 个 Vitest 测试通过 |
| 2026-06-07 | 覆盖率提升：JS/TS 从 79.39% → 85.12%（新增 24 个测试）、Python release.py 从 16% → 32%（新增 10 个测试）；修复 Flutter connect_failed_dialog 2 个失败测试；修复 IDE 测试发现（12 个测试文件重命名为标准 `*.test.js` 格式）；全量 363 个测试全部通过 |
| 2026-06-06 | Phase 4 完成：Windows 端迁移至 Node.js 服务器（子进程启动 Node.js EXE、邮件同步重写为 Node.js、构建流程更新、Windows 端 10 个新测试 + Node.js 175 个测试） |
| 2026-06-06 | Phase 3 完成：CRDT 同步引擎（字段级 LWW + PN-Counter + OR-Set 合并引擎，crdt_operations 表，crdt-push/pull 端点，前端操作日志 + CRDT 同步流程 + connection.js 重连降级） |
| 2026-06-06 | Phase 2 完成：RESTful API 重写（新增 12 PUT + 4 PATCH + 4 DELETE + 2 HEAD 端点，统一错误格式，api.js 新增 30 个方法） |
| 2026-06-06 | Phase 1 完成：Node.js 服务器骨架（Fastify + better-sqlite3 + 34 个 API 端点 + 83 个测试 + pkg 构建 + Swagger 文档） |
| 2026-06-06 | 修复：离线→在线切换的竞态窗口（ping 恢复后立即切 `reconnecting` 阻止旧数据展示、消除双重 `/api/data` 调用、统一 `_wasOnline` 分支） |
| 2026-06-05 | 修复：推迟到明天的作业，离线转在线模式同步后回到今天的作业列表（push_merge 跨 date_key 搜索 + move_homework record_modification） |
| 2026-06-03 | 创建项目文档体系（PRD、ARCHITECTURE、API、CHANGELOG、PROGRESS） |
| 2026-06-03 | 重构 API 模块：引入 _requestWithStrategy 统一请求策略处理器，消除在线/离线切换重复代码 |
| 2026-06-03 | 新增 api.js 策略单元测试 20 个（Node.js test runner + vm 沙箱），覆盖三种策略、getData、_fetch、resetDate、migrateBountyCompletionsToTotal |
| 2026-06-03 | 修复重构引入的 Bug：getData() 在 ConnectionManager 启动前被调用时错误走离线路径，改为不依赖 CM 模式直接请求服务器 |
| 2026-06-03 | 新增作业用时下限保护：actualDuration ≤ suggestedDuration×20% 且 ≤1分钟时修正为建议时长入库，防止秒点完成污染统计 |
| 2026-06-03 | 前端测试框架从 Node.js 内置 test runner 迁移到 Vitest，支持 IDE 测试面板集成；.gitignore 补充 node_modules/ |
| 2026-06-03 | 优化 Flaky Test `test_offline_web.py`：修复 SW 缓存就绪检测、mock fetch 竞态、测试间状态泄漏等 6 项不稳定根因，替换 8 处 try/except: pass 为结构化断言，ConnectionManager 测试加速约 22% |
| 2026-06-05 | 修复：Windows 端退出时重复日志 + 偶发卡死（去重 _quit_app 日志、_check_still_running 退出中跳过、防重入守卫）；新增退出守卫测试 4 个 |
| 2026-06-05 | 修复：ConnectionManager 单次 ping 失败即误切离线（引入连续 3 次失败阈值，复用已有 _failCount）；新增连接容错测试 8 个 |
| 2026-06-05 | 修复：孩子端赏金任务列表过多时超出框架且无滚动条（移除 `card.style.display = 'block'`，恢复 flex 弹性布局）；新增 bounty 溢出测试 6 个 |
| 2026-06-04 | 新增作业「在校提前完成」属性：孩子端一键标记完成、管理端统计饼图、效率统计扩展至所有模式 |
| 2026-06-04 | 修复：当天已评级后新增作业不再弹出评级框，直接按已有倍率计算追加积分（不含每日基础分） |
| 2026-06-04 | 修复：管理端新增作业不再无条件清空 settlement，保护已有评级（根因：`saveAdminHw()` 始终调用 `API.saveSettlement({})`） |
