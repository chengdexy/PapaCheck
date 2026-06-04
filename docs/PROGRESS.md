# PapaCheck 进度记录

> 最后更新：2026-06-04

## 当前版本

**v1.1.6**（EXE `1.1.6`，APK `1.1.6+25`）

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
- [x] TTS 语音提醒（edge-tts）
- [x] 邮件同步（IMAP + AI 解析）
- [x] 附件下载
- [x] 离线支持（Service Worker + localforage）
- [x] 增量同步（pull/push）
- [x] 一站式发布脚本（release.py）
- [x] 测试框架（pytest + Flutter test）

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
| 2026-06-03 | 创建项目文档体系（PRD、ARCHITECTURE、API、CHANGELOG、PROGRESS） |
| 2026-06-03 | 重构 API 模块：引入 _requestWithStrategy 统一请求策略处理器，消除在线/离线切换重复代码 |
| 2026-06-03 | 新增 api.js 策略单元测试 20 个（Node.js test runner + vm 沙箱），覆盖三种策略、getData、_fetch、resetDate、migrateBountyCompletionsToTotal |
| 2026-06-03 | 修复重构引入的 Bug：getData() 在 ConnectionManager 启动前被调用时错误走离线路径，改为不依赖 CM 模式直接请求服务器 |
| 2026-06-03 | 新增作业用时下限保护：actualDuration ≤ suggestedDuration×20% 且 ≤1分钟时修正为建议时长入库，防止秒点完成污染统计 |
| 2026-06-03 | 前端测试框架从 Node.js 内置 test runner 迁移到 Vitest，支持 IDE 测试面板集成；.gitignore 补充 node_modules/ |
| 2026-06-03 | 优化 Flaky Test `test_offline_web.py`：修复 SW 缓存就绪检测、mock fetch 竞态、测试间状态泄漏等 6 项不稳定根因，替换 8 处 try/except: pass 为结构化断言，ConnectionManager 测试加速约 22% |
| 2026-06-04 | 新增作业「在校提前完成」属性：孩子端一键标记完成、管理端统计饼图、效率统计扩展至所有模式 |
| 2026-06-04 | 修复：当天已评级后新增作业不再弹出评级框，直接按已有倍率计算追加积分（不含每日基础分） |
| 2026-06-04 | 修复：管理端新增作业不再无条件清空 settlement，保护已有评级（根因：`saveAdminHw()` 始终调用 `API.saveSettlement({})`） |
