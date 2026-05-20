# PapaCheck（爸~检查！）- Project Context

> 本文档供 AI 编码助手阅读，包含项目的完整设计细节、技术规范和实现指南。
> 请在开始任何编码工作前完整阅读本文档。

---

## 1. 项目概述

### 1.1 产品定位
**PapaCheck（爸~检查！）** 是一款面向 10-14 岁儿童的每日学习计划管理工具，通过积分激励和可视化进度展示，帮助孩子建立时间管理意识。核心使用场景是**挂墙大屏**（平板/显示器），作为家庭信息中心。

中文名：爸~检查！
英文名：PapaCheck

### 1.2 目标用户
- **孩子**：使用大屏端（index.html）查看作业、开始/完成任务、查看积分、兑换商品
- **家长（爸爸）**：使用管理端（admin.html，手机浏览器访问）布置作业、管理商店、确认兑换、作业评级、查看统计

### 1.3 技术栈
- **前端**：纯 HTML + CSS + JavaScript，无框架、无构建工具
- **后端**：Python 3 标准库 http.server
- **数据存储**：SQLite（data.db），单文件数据库，零配置
- **通信**：局域网 HTTP REST API，前端每 5 秒轮询同步（屏保模式降为 60 秒）
- **语音**：edge-tts（微软 Edge TTS，zh-CN-XiaoxiaoNeural），动态生成 MP3
- **部署**：局域网内运行，`python server.py` 一键启动

### 1.4 启动方式
```bash
python server.py
# 本机访问: http://localhost:8080
# 大屏端: http://localhost:8080
# 管理端: http://localhost:8080/admin.html
# 手机访问: http://<本机IP>:8080/admin.html
```

---

## 2. 项目架构

### 2.1 文件结构
```
PapaCheck/
├── index.html               # 大屏端（孩子使用）
├── admin.html               # 管理端（爸爸使用，手机浏览器）
├── ReadMe.html              # 纯静态项目展示页（不参与逻辑）
├── server.py                # Python 后端服务器（核心入口）
├── db.py                    # SQLite 数据库层
├── migration.py             # JSON → SQLite 数据迁移工具
├── start.bat                # Windows 一键启动
├── .gitignore
├── icon.svg                 # PWA 图标
├── manifest.json            # PWA 清单
├── PROJECT_CONTEXT.md       # 本文件（AI 助手上文）
├── PapaCheck_设计报告.md     # 中文设计文档
├── images/                  # 截图目录（手动放置）
│   ├── big-screen.png
│   └── admin.png
├── css/
│   ├── style.css            # 大屏端样式
│   └── admin.css            # 管理端样式
└── js/
    ├── api.js               # 数据层（API 通信）
    ├── big-screen.js         # 大屏端渲染逻辑
    ├── app.js                # 大屏端应用主逻辑
    └── admin.js              # 管理端逻辑（~1300 行）
```

### 2.2 前后端分离规范
- **改 API/后端**：只动 `js/api.js` + `server.py` + `db.py`
- **改大屏样式**：只动 `css/style.css`
- **改管理端样式**：只动 `css/admin.css`
- **改大屏渲染**：只动 `js/big-screen.js`
- **改管理端逻辑**：只动 `js/admin.js`
- **改交互/业务逻辑**：只动 `js/app.js` 或 `js/admin.js`
- **index.html / admin.html** 只包含 HTML 结构，尽量不动

---

## 3. 数据库结构（SQLite）

### 3.1 表列表

| 表名 | 用途 |
|------|------|
| `points` | 积分余额（单行，id=1） |
| `points_history` | 积分收支历史明细 |
| `homeworks` | 作业数据（按 date_key 存储） |
| `daily_settlement` | 每日结算数据 |
| `shop_items` | 积分商店商品列表 |
| `redemptions` | 兑换券列表 |
| `efficiency_history` | 效率历史数据 |
| `free_time_tasks` | 自由时间任务（游戏/娱乐） |
| `meta` | 元数据（商店每日重置标记等） |
| `badges` | 徽章数据 |
| `reward_box` | 奖励箱（孩子兑换后暂存） |
| `settings` | 系统设置参数（评级倍率等） |
| `active_buffs` | 当前生效的 Buff |

### 3.2 核心 get_full_data() 结构

```json
{
  "points": { "balance": 150 },
  "pointsHistory": [...],
  "homeworks": { "2025-6-26": [...] },
  "dailySettlement": { "2025-6-26": {...} },
  "shopItems": [...],
  "redemptions": [...],
  "efficiencyHistory": { "2025-6-26": {...} },
  "freeTimeTasks": { "2025-6-26": [...] },
  "badges": [...],
  "rewardBox": [...],
  "settings": { "challengeMultipliers": {...}, ... },
  "activeBuffs": [...]
}
```

---

## 4. 核心功能详细设计

### 4.1 作业管理

#### 4.1.1 两种作业模式

| 特性 | 挑战模式 (Challenge) | 计时模式 (Timer) |
|------|---------------------|------------------|
| 孩子能看到参考时长 | ✅ 显示倒计时 + 进度条 | ❌ 只显示已用时间（正计时） |
| 超时行为 | 自动降级为计时模式，无效率奖励 | 无变化 |
| 语音提醒 | 50%/剩余5分钟/剩余1分钟/超时 | 无中间提醒 |
| 积分倍率（评级后） | 更高 | 较低 |
| 适用场景 | 培养时间规划能力 | 专注完成不焦虑 |

#### 4.1.2 作业打卡完整流程

```
步骤1: 爸爸在管理端布置作业
  - 输入科目、内容、建议时长、基础分
  - 保存

步骤2: 孩子在大屏查看今日作业列表
  - 按顺序显示所有作业卡片
  - 每张卡片：科目图标 + 名称 + 挑战/计时按钮

步骤3: 孩子点击"挑战"或"计时"开始
  - 弹窗确认
  - 挑战模式：语音"开始XX作业，挑战X分钟"
  - 计时模式：语音"开始XX作业"
  - 开始计时

步骤4: 作业进行中
  - 挑战模式：倒计时 + 进度条 + 阶段性语音提醒
  - 计时模式：正计时显示
  - 可暂停/继续

步骤5: 孩子点击"完成"
  - 挑战模式：提前完成 → "挑战成功！"；超时 → 自动降级
  - 计时模式：记录用时
  - 语音播报结果

步骤6: 全部完成后，大屏显示结算页面
  - 显示基础积分、效率奖励
  - 孩子点击"提交等待评级"

步骤7: 爸爸在管理端看到待评级提醒
  - 点击弹出评级弹窗
  - 给出评级：优/良/可/差

步骤8: 大屏自动显示评级结果
  - 语音播报："爸爸评了优，获得25分"
  - 显示鼓励语
```

#### 4.1.3 驳回流程
- 爸爸对已完成作业点击"驳回"
- 作业回到 pending 状态，标记 rejected = true
- 孩子的结算被清除
- 重新开始时强制计时模式，不显示建议时长

#### 4.1.4 周末作业延后

**触发条件**：明天是假日（周六/周日自动判定 + 爸爸手动配置的自定义假日），且作业状态为 pending

**完整流程**：

```
步骤1: 孩子在大屏端看到 pending 作业卡片
  - 如果明天是假日，卡片底部出现「⏭️ 明天做」按钮
  - 已有延后申请的作业显示「⏳ 等待确认...」，不可点击

步骤2: 孩子点击「⏭️ 明天做」
  - 弹窗确认 → 确认后语音「已申请延后，等待爸爸确认」
  - 作业标记 deferRequest = { status: "pending", requestedAt: "..." }

步骤3: 爸爸在管理端作业 Tab 看到延后提醒
  - 顶部显示「⏭️ N 项作业申请延后到明天」
  - 对应作业行显示「⏭️ 申请延后」标签 + 「批准」「拒绝」按钮

步骤4: 爸爸点击「批准」
  - 作业从当天移除，移至明天的 homeworks 列表
  - 大屏端轮询检测到消失 → 语音「爸爸批准了XX的延后申请，明天再做」

步骤5: 爸爸点击「拒绝」
  - 作业 deferRequest 清除，恢复为正常 pending
  - 大屏端语音「爸爸拒绝了XX的延后申请，今天完成吧」
```

**数据模型**：

Homework 对象新增可选字段 `deferRequest`：
```json
{
  "deferRequest": null  // 默认无延后申请
}
// 发起申请后:
{
  "deferRequest": {
    "requestedAt": "2026-05-20T19:30:00.000Z",
    "status": "pending"     // pending | approved | null(拒绝后清除)
  }
}
```

**假日判定规则**：
1. 自动判定周六（getDay() === 6）和周日（getDay() === 0）
2. Settings 的 `customHolidays` 数组（日期字符串列表），由爸爸在设置 Tab 管理
3. 二者满足其一即为假日

**约束**：
- 只有 `status === 'pending'` 的作业可发起延后申请
- 同一作业不能重复申请（已有 pending deferRequest 时不可再申请）
- 被驳回过的作业（rejected=true）恢复 pending 后也可延后
- 延后目标永远是"明天"（today + 1天），不递归跳过多日假期
- 爸爸拒绝后 deferRequest 置为 null，作业留在当天

### 4.2 积分系统

#### 4.2.1 积分计算规则

**基础积分**：每项作业单独设定基础分（默认10分，可在设置中修改）

**效率奖励**（仅挑战模式）：实际用时 ≤ 建议用时 × 0.8：额外 + 效率奖励分（默认5分，可在设置中修改）

**评级倍率**：全部作业完成后，爸爸给出评级：

| 评级 | 挑战模式倍率 | 计时模式倍率 |
|------|-------------|-------------|
| 优 | 可配置（默认 ×2.0） | 可配置（默认 ×1.5） |
| 良 | 可配置（默认 ×1.5） | 可配置（默认 ×1.2） |
| 可 | 可配置（默认 ×1.2） | 可配置（默认 ×1.0） |
| 差 | 可配置（默认 ×0） | 可配置（默认 ×0） |

**公式**：
```
最终积分 = (基础积分总和 + 效率奖励总和) × 评级倍率
```

#### 4.2.2 积分管理
- 爸爸在管理端设置 Tab 可直接修改积分余额
- 支持输入新值，自动计算差额并记录调整日志
- 积分是孩子的，允许自由使用

### 4.3 积分商店 & 奖励箱

#### 4.3.1 商品类型

| 类型 | 说明 | 额外属性 |
|------|------|----------|
| 时间类 ⏱️ | 如"游戏时间30分钟" | durationMinutes |
| 物品类 🎁 | 如"巧克力" | 无 |
| Buff类 ✨ | 限时增益效果 | buffDuration + buffUnit（分钟/天） |

#### 4.3.2 两步兑换流程

```
1. 孩子在"积分商店"点击兑换
   → 积分扣除 → 商品进入"奖励箱"

2. 孩子打开"我的奖励"查看奖励箱
   → 点击"兑换"提交申请

3. 爸爸在管理端"兑换管理"看到待兑现
   → 点击"确认兑现"

4. 兑现处理：
   - 时间类 → 自动创建自由时间任务
   - Buff类 → 激活 ActiveBuff，显示在 buff 栏
   - 物品类 → 爸爸线下交付
```

### 4.4 Buff 系统

#### 4.4.1 工作机制
- Buff 商品设一个时长值 + 单位（分钟/天）
- 分钟单位：兑现时存 ISO 时间戳，startDate + duration 分钟后过期
- 天单位：兑现时存日期 key，startDate + duration 天后次日过期
- 孩子端首页右侧"今日作业"上方显示 buff 栏：`✨ Buff名称`
- 过期后轮询自动清除

#### 4.4.2 ActiveBuff 数据结构
```json
{
  "id": "xxx",
  "name": "晚睡30分钟",
  "duration": 30,
  "unit": "minutes",
  "startDate": "2025-06-26T14:30:00.000Z"
}
```

### 4.5 语音提醒系统

#### 4.5.1 技术实现
- 后端使用 edge-tts 库，动态调用微软 Edge TTS 生成 MP3
- `GET /api/speak?text=...` 返回 `audio/mpeg`
- 内存缓存 _tts_cache，同一文本只合成一次
- 前端音频队列，前一段播完自动播下一段

#### 4.5.2 语音触发点（共 23 个）

| 事件 | 语音内容 |
|------|----------|
| 挑战开始 | "开始XX作业，挑战X分钟" |
| 计时开始 | "开始XX作业" |
| 自由时间开始 | "开始XX，X分钟" |
| 任务暂停 | "任务已暂停" |
| 任务继续 | "任务已继续" |
| 时间过半 | "已用X分钟，继续加油" |
| 还剩5分钟 | "还剩5分钟" |
| 还剩1分钟 | "还剩1分钟" |
| 超时 | "已超时，请尽快完成"（首次+每30分钟重复） |
| 挑战成功 | "挑战成功！XX提前完成" |
| 挑战超时降级 | "超时了，本次按计时模式统计，XX作业完成" |
| 计时完成 | "XX作业完成！" |
| 自由时间完成 | "XX时间到！" |
| 全部完成提审 | "全部作业已完成，等待爸爸评级" |
| 爸爸评级 | "爸爸评了X，获得X分" |
| 积分变化 | "积分已更新为X分" |
| Buff 激活 | "XX已生效" |
| 奖励箱新品 | "奖励箱有新奖励，快去看看吧" |
| 兑换成功 | "兑换成功！" |
| 提交兑现申请 | "已提交申请，等待爸爸确认" |
| 申请延后 | "已申请延后，等待爸爸确认" |
| 延后批准 | "爸爸批准了XX的延后申请，明天再做" |
| 延后拒绝 | "爸爸拒绝了XX的延后申请，今天完成吧" |
| 屏幕唤醒 | "屏幕已唤醒" |
| 整点报时 | "现在是X点" |

### 4.6 屏保模式

- 60 秒无操作自动进入大数字时钟屏保
- 整点语音报时
- 点击唤醒 + 语音确认
- 屏保期间轮询降频（5s → 60s）

### 4.7 管理端 Tab 结构

| Tab | 名称 | 核心功能 |
|-----|------|----------|
| 📋 作业 | 作业布置 | 添加/编辑/删除作业，驳回，待评级提醒 |
| 🏪 商店 | 积分商店 | 商品 CRUD，三种类型，每日数量管理 |
| 🎁 奖励箱 | 奖励箱 | 查看、添加、编辑条目 |
| 📋 兑换 | 兑换管理 | 待兑现/已兑现列表，清空记录 |
| 📊 统计 | 数据统计 | 完成率/效率比趋势图，评级历史 |
| ⚙️ 设置 | 设置 | 积分余额修改，评级倍率配置，日期管理，重置一天 |

---

## 5. API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/data` | GET | 获取全量数据 |
| `/api/data` | POST | 导入全量数据 |
| `/api/speak?text=...` | GET | TTS 语音合成，返回 MP3 |
| `/api/homeworks/{date}` | GET/POST | 作业 CRUD |
| `/api/settlement/{date}` | GET/POST | 结算数据 CRUD |
| `/api/points` | POST | 积分增减（earn/spend/adjust） |
| `/api/shop` | GET/POST | 商店商品管理 |
| `/api/redemptions` | GET/POST | 兑换券管理 |
| `/api/reward-box` | GET/POST | 奖励箱管理 |
| `/api/settings` | GET/POST | 系统参数配置 |
| `/api/active-buffs` | GET/POST | Buff 管理 |
| `/api/efficiency/{date}` | GET/POST | 效率数据 |
| `/api/freetime/{date}` | GET/POST | 自由时间任务 |
| `/api/reset-date` | POST | 重置某天所有数据 |
| `/api/defer-homework` | POST | 作业延后申请/审批（action: request/approve/reject） |

---

## 6. 界面设计规范

### 6.1 CSS 变量（style.css）

```css
:root {
  --bg: #0f172a;
  --card: #111827;
  --text: #e2e8f0;
  --text-secondary: #94a3b8;
  --accent: #38bdf8;
  --success: #4ade80;
  --warning: #fbbf24;
  --danger: #f87171;
  --shadow: 0 4px 20px rgba(0,0,0,0.3);
  --shadow-lg: 0 8px 40px rgba(0,0,0,0.4);
  --radius: 14px;
}
```

### 6.2 设计原则
1. **深色主题**：护眼，适合长时间挂墙显示（`--bg: #0f172a`）
2. **触屏优先**：所有触控目标最小 44px
3. **大屏可读**：时钟 72px，任务名 56px，3 米外清晰可见
4. **孩子友好**：大 emoji 图标、颜色区分、语音反馈
5. **手机优先管理端**：100dvh 全屏 + 底部固定 Tab

### 6.3 大屏端布局

```
┌──────────────────────────────────────────────────────────────┐
│  日期                  当前时间（大数字时钟）        🟢       │
├───────────────────────┬──────────────────────────────────────┤
│  ⏰ 当前任务卡片       │  ✨ Buff栏（如有）                   │
│  - 大图标 + 任务名    │  📝 今日作业                         │
│  - 倒计时/进度条      │  - 科目卡片网格                      │
│  - 暂停/完成按钮      │  - 每张含挑战/计时按钮               │
│                       │  🎮 奖励时间                         │
│  📊 统计栏            │                                      │
│  - 完成进度、积分      │                                      │
│  - 🏪 积分商店按钮    │                                      │
│  - 🎁 我的奖励按钮    │                                      │
└───────────────────────┴──────────────────────────────────────┘
```

### 6.4 页面状态

| 状态 | 显示内容 |
|------|----------|
| main | 当前任务 + 作业网格 + 统计 |
| settlement | 结算页面（基础分 + 效率奖励 + 提交按钮） |
| rated | 评级结果 + 最终积分 + 鼓励语 |
| shop | 积分商店（半透明遮罩覆盖） |

---

## 7. 关键变量和函数

### js/api.js
- `API.getData()` - 获取全量数据
- `API.saveHomeworks(dateKey, list)` - 保存作业
- `API.deferHomework(dateKey, hwId, action, requestedAt)` - 作业延后申请/审批
- `API.updatePoints(action, amount, detail)` - 积分操作
- `API.getActiveBuffs()` / `API.saveActiveBuffs(buffs)` - Buff 管理
- `API.saveSettings(settings)` - 保存设置
- `cachedData` - 服务器数据缓存

### js/app.js
- `homeworks` / `freeTimeTasks` - 当日任务列表
- `Voice.speak(text)` - 语音播报（队列播放）
- `checkReminders(hw)` - 挑战模式阶段性提醒
- `calculateSettlement()` / `submitForRating()` - 结算流程
- `requestDeferHomework(hwId)` - 发起延后申请
- `startPoll(ms)` / `stopPoll()` - 服务器轮询

### js/big-screen.js
- `SUBJECTS` - 科目配置（语文📖、数学🔢、英语🔤、科学🔬、其他📚）
- `PAGE` - 页面状态枚举
- `updateBigScreen()` - 主渲染入口
- `isTomorrowHoliday()` - 判断明天是否假日（周末+自定义假日）
- `renderBuffBar()` - Buff 栏渲染
- `showShopPage()` / `backToMain()` - 商店页面切换

### js/admin.js
- `switchTab(name)` - Tab 切换
- `renderHomeworkTab()` / `renderShopTab()` / `renderRedeemTab()` ...
- `fulfillRedemption(id)` - 确认兑现
- `approveDeferHomework(hwId)` / `rejectDeferHomework(hwId)` - 审批延后
- `addCustomHoliday()` / `removeCustomHoliday(dateStr)` - 假日管理
- `saveShopItem()` - 保存商品（含 Buff 类型处理）

### db.py
- `move_homework(from_date, to_date, hw_id)` - 跨日期移动作业（延后审批）

---

## 8. 注意事项

1. **不要修改已有功能的正常行为**，在现有代码基础上扩展
2. **保持前后端分离**，CSS/JS/HTML 各司其职
3. **大屏端操作要极简**，孩子只需要：查看 → 开始 → 完成 → 兑换
4. **管理端手机优先**，爸爸用手机操作，6 个底部 Tab 导航
5. **所有时间显示使用中文格式**："X分Y秒" 而非 "X:Y"
6. **科目使用 emoji 图标**：语文📖、数学🔢、英语🔤、科学🔬、其他📚
7. **自由时间任务和作业任务分开存储**（homeworks vs freeTimeTasks）
8. **挑战模式和计时模式在同一日可以混合使用**
9. **数据库操作通过 db.py 函数**，不要直接操作 SQLite
10. **语言播报前后端协同**：前端 Voice.speak() → 后端 /api/speak → edge-tts → MP3
