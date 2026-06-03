# PapaCheck 变更日志

> 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)

---

## [Unreleased]

### 变更

- 重构 Web 前端 API 模块：引入 `_requestWithStrategy` 统一请求策略处理器，消除 27 个方法中重复的在线/离线切换逻辑，新增 `online-first`/`online-only`/`offline-only` 三种策略
- 新增 api.js 策略单元测试 20 个（Node.js 内置 test runner + vm 沙箱），覆盖三种策略、getData、_fetch、resetDate、migrateBountyCompletionsToTotal
- 新增作业用时下限保护：当实际用时 ≤ 建议时长×20% 且 ≤1分钟时，actualDuration 修正为建议时长入库，防止秒点完成污染统计数据
- 前端测试框架从 Node.js 内置 test runner 迁移到 Vitest，支持 IDE 测试面板集成

### 新增

- 一次性数据库迁移脚本 `migrate_actual_duration.py`：修正历史异常 actualDuration 数据并同步更新 efficiency_history
- `clampActualDuration` 函数单元测试 7 个（Vitest），覆盖正常用时、修正触发、边界值等场景
- 项目级 Vitest 配置（`vitest.config.js`、`package.json`）

### 修复

- 修复 `getData()` 在 `ConnectionManager.start()` 之前被调用时错误走离线路径导致页面无法加载的问题，改为不依赖 CM 模式直接请求服务器
- 优化 Flaky Test `test_offline_web.py`：修复 6 项不稳定根因（SW 缓存就绪检测、mock fetch 竞态、测试间状态泄漏），替换 8 处 `try/except: pass` 为结构化断言，缩短运行时间约 22%

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
