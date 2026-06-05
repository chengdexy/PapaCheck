# PapaCheck 变更日志

> 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)

---

## [Unreleased]

### 修复（Fixed）
- 孩子端赏金任务列表过多时超出框架且无滚动条：移除 `updateHomeworkGrid()` 中错误的 `card.style.display = 'block'`，恢复 CSS `display: flex` 弹性布局，使 `.homework-grid` 的 `overflow-y: auto` 正常生效
- 孩子端/管理端静置后误切离线模式：ConnectionManager 引入 ping 失败阈值（连续 3 次失败才切换离线），利用已有 `_failCount` 变量，防止设备休眠/浏览器后台节流导致的偶发 ping 超时误判

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
