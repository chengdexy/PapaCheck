# PapaCheck 进度记录

> 最后更新：2026-06-15（Phase 5c + 数据库 PK 迁移完成）

## 当前版本

**v1.3.1-beta**（Phase 5c JWT 多租户认证系统完成，625 测试）

## 部署状态

- [x] **Phase 5b 服务器迁移完成** — 已移除 Docker，改用 systemd + Nginx + PostgreSQL 直接部署
- [x] **Phase 5c 完成** — JWT 多租户认证系统，官网管理面板，超级管理员

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
- [x] Node.js HTTP 服务器（Fastify + TypeScript）
- [x] **数据库抽象层重构** — `IDatabase` 接口 + `SqliteAdapter` / `PostgresAdapter`（Phase 5a）
- [x] **JWT 多租户认证系统** — Hash 码预授权 + token_version 吊销 + 租户行级隔离（Phase 5c）
- [x] **Cookie Session 临时认证** — 部署密码 + 登录页（Phase 5b，已替换为 JWT）
- [x] **PostgreSQL 迁移脚本** — `migrate-to-pg.ts` 逐表迁移 + 行数校验
- [x] **部署脚本 + systemd service** — `scripts/deploy.sh` + `papacheck.service`
- [x] **服务器已迁移到 systemd + Nginx** — 移除 Docker，Nginx 反向代理 + HTTPS Let's Encrypt
- [x] **云端数据库已切换到 PostgreSQL 16** — SQLite 数据完整迁移，19 张表行数校验通过
- [x] TTS 语音提醒（edge-tts，Python 子进程桥接）
- [x] 邮件同步（IMAP + AI 解析）
- [x] 附件下载
- [x] 离线支持（Service Worker + localforage）
- [x] 增量同步（pull/push）
- [x] 一站式发布脚本（release.py）
- [x] OpenAPI 自动文档（Swagger UI）
- [x] 单 EXE 构建（Node.js SEA）
- [x] 测试框架（pytest + Vitest 4.x + Flutter test）
- [x] JS/TS 代码覆盖率 85.22%（Stmts）| 71.89%（Branch）| 90.94%（Funcs）| 87.06%（Lines）
- [x] Python 代码覆盖率 18%（release.py 32%）
- [x] **自定义科目**：科目从硬编码改为 settings 可配置，设置页可添加/删除/恢复/重置
- [x] **官网管理面板**：落地页增量添加家庭管理（注册/登录/成员管理）+ 超级管理员控制台

---

## 待开发功能

- [ ] Phase 5d: 运维增强（增强 release.py + 备份日报 + 巡检）
- [ ] Phase 5e: 客户端适配（Android 远程配置 + Web 登录状态持久化）
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
| 2026-06-15 | **修复数据库 PK 缺少 tenant_id**：19 张业务表 PK 缺失 tenant_id 列，导致新增作业 UPSERT 失败；已手动迁移修复；测试数 625
| 2026-06-15 | **修复赏金任务放弃/提交静默失败**：abandonBountyTask/submitBountyTask 找不到提交记录时新增 toast 反馈；测试数 620
| 2026-06-15 | **修复 release.py 部署缺失 tsc 编译**：打包时 `--exclude=dist` + 远程缺 `npm run build`，语音播报 401 修复未生效；测试数 616
| 2026-06-15 | **测试补齐 + 3 个 Bug 修复**：`/api/speak` 未加入 PUBLIC_PATHS 导致语音播报 401；`getTenantMembers` 残留已删除字段；成员列表返回 `'已生成'` 占位符；新增 29 个测试；全量 613 测试通过 |
| 2026-06-15 | **Phase 5c: JWT 多租户认证系统完成** — Hash 码预授权认证 + token_version 吊销 + tenant_id 行级隔离 + JWT 中间件 + 认证/管理员/超管 API（12 个端点）+ 官网管理面板 + 登录页改造；修复 postgres-adapter.ts 4 处代码损坏；全量 588 测试通过 |
| 2026-06-15 | **修复孩子端奖励兑换/撤回在离线→在线转换期间的竞态条件 Bug**：`guardOnline()` 守卫 + `reconnecting` API 降级 + 服务端 409 兜底 + 19 个 TDD 测试；全量 554 测试通过 |
| 2026-06-15 | **LICENSE 填写版权信息 + 删除 CNAME 关闭 GitHub Pages** |
| 2026-06-13 | **修复管理端删光作业后孩子端评级界面不关闭 Bug**：`pollServer` 结算清除逻辑嵌套在 homework 替换块内导致不执行；新增独立结算清理检查 + `submitForRating()` 防御性守卫；新增 TDD 测试 9 个；全量 535 测试通过 |
| 2026-06-13 | **修复孩子端暂停作业后计时器仍在计时的竞态条件 Bug**：`pollServer` 替换 `homeworks` 数组时丢失 `paused` 标记，导致计时器重启；修复后捕获并恢复 in-memory pause 状态；新增 TDD 测试 5 个；全量 526 测试通过 |
| 2026-06-12 | **修复 Node.js 服务关闭时 WAL 未合并 Bug**：`SqliteAdapter.close()` 加 WAL checkpoint，`gracefulShutdown` 调用 `db.close()`，避免备份/迁移时丢数据；新增 TDD 测试 1 个；全量 521 测试通过 |
| 2026-06-12 | **release.py 云端部署迁移 + 发布流程修复 + 版本发布 v1.3.1** |
| 2026-06-12 | **修复管理端确认兑现时全量 PUT 兑换记录导致的两个 Bug** |
| 2026-06-12 | **Phase 5a+5b 代码实施完成 + 服务器部署切换 PostgreSQL** |
| 2026-06-12 | **修复 Dockerfile TTS Python 路径**：Docker CMD 添加 `--tts-python python3`（Alpine 无 `python` 命令，只有 `python3`，之前 TTS 实际未生效）；优化 pip 安装参数 `--no-cache-dir` 减镜像体积；代码审查修复 SCP 失败后 tar 包提前删除 bug；清理 publish.ps1 统一到 release.py；全量 505 测试通过 |
| 2026-06-12 | **HTTPS + 域名配置**：DNS A 记录 papacheck → 123.57.129.243；Nginx 容器加端口 443 + Let's Encrypt 免费证书 + HTTP 自动 301 跳转；部署产品落地页（80 端口）；全量 505 测试通过 |
| 2026-06-12 | **修复 OOM 宕机**：docker compose up -d 重建容器时内存溢出（2核2G 无 Swap），导致 SSH 断连、服务器卡死。修复：创建 2GB Swap 分区 + Docker mem_limit 768m + memswap_limit 1536m；更新 docker-compose.yml、Dockerfile、SKILL.md |
| 2026-06-12 | **阿里云 ECS 上云完成**：购买 2核2G 经济型 e 实例（99元/年）→ Ubuntu 24.04 初始化 → Docker 安装 → SSH 安全加固 + UFW 防火墙 → 本地打包上传代码 → Docker 多阶段构建（node:22-alpine）→ Docker Compose 启动 → 阿里云安全组配置 8080 端口；创建 `cloud-deploy` Skill 记录完整部署流程 |
| 2026-06-11 | 修复 Windows 端版本号更迭后开机自启动配置被取消：`_cleanup_stale_autostart`（删除无效路径）→ `_repair_autostart`（更新为当前 EXE 路径），保留用户自启动设定；新增 TDD 测试 4 个；全量 565 测试通过（505 JS + 60 Python） |
| 2026-06-11 | 修复奖励箱物品消耗后重新出现（`_fulfillFromRewardBox` 数量归零时未删除服务端记录）；修复商店每日数量重置被陈旧 CRDT 操作覆盖（`putShopItem` 时间戳保护 + `_resetDailyShopQuantity` 更新 `lastModified`）；`getRewardBox` 添加 `_filterDeleted`；新增 TDD 测试 6 个；全量 505 测试通过 |
| 2026-06-11 | 全量代码审查 + 30 个 Bug 修复（11 Critical + 19 Major）：`getTomorrow` 无效日期保护、`dateKey!` 非空断言 → 400 校验、IMAP 连接泄漏修复、TTS daemon error 监听、XSS 防护（innerHTML + onclick bypass）、SQL 参数分批、软删除复活保护、UI 瞬态字段不持久化、fetch 超时控制、数据导入校验、静态文件哈希错误分级日志等；新增 91 个测试（Server 28 + Frontend 50 + TTS/Email 8 + 定向补漏 5）；全量 499 测试通过；覆盖提升至 Stmts 85.22% / Branch 71.89% |
| 2026-06-11 | 增量代码审查 + 修复 2 个 Minor 问题：删除 `cleanupExpiredNotifications` 死代码（已内联到 `getPendingNotifications`）；删除 `getLastError()` 冗余兜底 `\|\| ''`；全量 499 测试通过 |
|------|------|
| 2026-06-10 | 静态文件版本号自动检测：服务端 `/api/static-version`（SHA1 hash）+ SW 后台版本检测（30s 节流）+ 前端自动刷新（Mask + reload + Toast）；全量 408 测试通过 |
| 2026-06-10 | 修复短时间内添加多项新作业导致孩子端连续快速播报"收到新作业"多次的问题：pollServer 通知播报增加 `dedupNewHomeworkNotifications` 去重过滤，多条同文本只保留最后一条播报；新增 TDD 测试 5 个；全量 407 测试通过 |
| 2026-06-10 | 修复新增科目输入框被轮询打断：输入框添加 `_editingSettings` 守卫，输入中跳过设置页重建 |
| 2026-06-10 | 修复科目管理卡片删除/恢复按钮 XSS 风险：内联 onclick 改为 data-* 属性 + 事件委托 |
| 2026-06-10 | 自定义科目：科目从硬编码改为 settings 可配置；设置页新增科目管理卡片（添加/删除/恢复/重置）；管理端作业弹窗科目选择器动态读取；孩子端不存在的科目显示纯文本；新增 TDD 测试 18 个；全量 400 测试通过 |
| 2026-06-10 | 孩子端科目显示改为动态读取：`SUBJECTS` 常量替换为 `DEFAULT_SUBJECTS` 数组 + `getSubject()` 函数，从 `cachedData.settings.subjects` 动态读取科目配置；icon 为 null 时跳过渲染；新增 TDD 测试 4 个；全量 400 测试通过 |
| 2026-06-10 | 管理端统计页折线图"均值线"改为"中值线"，新增 LOESS 平滑曲线（月/总计视图）；新增 calcMedian/calcLOESS 纯函数 + TDD 15 个测试；全量 382 测试通过 |
| 2026-06-10 | 效率比公式翻转为 suggested/actual，review 页标签/数据源修复 |
| 2026-06-10 | 修复管理端统计页"连续全勤天数"计算 Bug：`calcStreak` 逐日历日回退改为遍历有 settlement 记录的日期数组；新增 TDD 测试 5 个；全量 366/367 测试通过 |
| 2026-06-09 | Phase 5 上云规划完成：方案选型（腾讯云 + pg + node:22-alpine）、spec/tasks/checklist 已创建、实施计划已就绪，待 1.3.0 启动 |
| 2026-06-08 | TTS 错误日志简化：非零退出时只取 stderr 最后一行，省略 Python 完整堆栈；`.gitignore` 补充 `PapaCheck.Web/tts_cache/` 并清理遗留 MP3 |
| 2026-06-08 | 修复退出时阻塞 Windows 主界面：`_quit_app()` 改为后台线程停止服务器；按钮显示"⏹ 正在关闭..."状态；全量 362 测试通过 |
| 2026-06-08 | 修复管理端赏金任务通过后审核状态未切换：`splice` 移除提交后未在数据库标记删除，添加 `isDeleted: true`；全量 362 测试通过 |
| 2026-06-08 | 修复停止服务器阻塞 Windows 主界面：`_stop_server()` 改为后台线程执行，通过 `after()` 回调更新 UI；全量 362 测试通过 |
| 2026-06-08 | 修复 Windows 调试模式停止服务器后端口未释放：`_stop_node_server_process()` 先优雅退出（`taskkill /T` + Node.js `SIGTERM` → `app.close()`），超时后兜底强制杀；Node.js 端添加优雅关闭处理器；全量 362 测试通过 |
| 2026-06-08 | 离线遮罩显示时机优化：第一次 ping 失败不显示遮罩，第二次 ping 失败才显示，降低偶发网络抖动的无用遮罩闪烁；全量 362 测试通过 |
| 2026-06-08 | 修复初始 ping 失败时（应用启动即离线）_mode 未过渡到 reconnecting，导致离线遮罩和 toast 均不显示的 Bug；全量 362 测试通过 |
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
