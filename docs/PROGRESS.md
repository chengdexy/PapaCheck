# PapaCheck 进度记录

> 最后更新：2026-06-07 11:00

## 当前版本

**v1.2.2**（Android APK 更新修复）

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
- [x] Android APP（Flutter WebView + 离线快照 + APK 自动更新）
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
