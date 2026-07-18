# 需求文档：客户端数据按需获取（按需索取）

- 文档版本：v1.0
- 创建日期：2026-07-18
- 状态：待评审
- 受众：技术专家团（负责技术方案决策与设计）
- 文档定位：**仅描述问题、现状事实、目标与验收标准，不给出任何技术实现建议**。技术方案（接口形态、聚合位置、数据分层、刷新机制等）由专家团基于本需求独立决策。

---

## 1. 背景

PapaCheck 是一个家长检查孩子作业的应用，包含孩子端与家长端（Web 前端 `PapaCheck.Web` + 服务端 `PapaCheck.Server` / 生产云函数 `PapaCheck.CloudFunc`）。

客户端启动后通过单一聚合接口 `GET /api/data` 拉取当前孩子（单个 `child_id` 绑定于登录 JWT）的全部业务数据，并在本地内存对象 `cachedData` 中缓存，作为各功能模块的数据源。

## 2. 问题陈述

`/api/data` 返回的数据体量随孩子的**历史使用天数单调递增**，与时间无上限累积。具体表现：

- 服务端在构造响应时不带任何日期范围过滤，把该孩子从注册至今每一天的业务数据全量拼入响应。
- 客户端每次进入应用（及每次实时刷新触发）都重新全量下载这份快照。
- 随着使用天数增长，首屏加载数据量与请求耗时同步膨胀，长期使用的家庭体验持续劣化。

核心诉求：**客户端获取的数据总量应与孩子的历史使用天数解耦**，即“按需索取——对应功能要哪一块数据，才请求哪一块”，而非一次性全量拉取。

## 3. 现状调研（客观事实，附证据）

> 以下为当前代码实际行为，供专家团作为决策输入。行号指向 `E:\trae_projects\PapaCheck` 仓库。

### 3.1 服务端数据返回现状

入口：`PapaCheck.Server/src/db/postgres-adapter.ts` 的 `getFullData` 方法。

- 返回对象结构（约 410–430 行）包含以下按天聚合的字段，均为「日期 → 数据」映射，`SQL` 查询仅按 `tenant_id + child_id` 过滤，**无任何 `date_key` 范围条件**：
  - `homeworks`：`SELECT date_key, data FROM homeworks ...`（436 行）
  - `dailySettlement`：`SELECT date_key, data FROM daily_settlement ...`（457 行）
  - `efficiencyHistory`：`SELECT date_key, data FROM efficiency_history ...`（478 行）
  - `freeTimeTasks`：`SELECT date_key, data FROM free_time_tasks ...`（499 行）
  - `bountySubmissions`：`SELECT date_key, data FROM bounty_submissions ...`（520 行）
- 以下为全量流水 / 配置类字段：
  - `points`：`{ balance, history }`，其中 `history` 为 `SELECT * FROM points_history ... ORDER BY id ASC` 的**全量流水**（400–408 行）
  - `shopItems` / `redemptions` / `rewardBox` / `settings` / `bountyTasks` / `activeBuffs`：配置类，与孩子使用天数无关，体量稳定
  - `badges` / `history` / `tasks`：当前返回空对象
- 结论：**按天字段（`homeworks` / `dailySettlement` / `efficiencyHistory` / `freeTimeTasks` / `bountySubmissions`）与 `points.history` 流水随天数线性增长，是体量膨胀的直接来源。**

### 3.2 前端数据消费现状

数据源统一为 `cachedData`（`API.getData()` 拉取的 `/api/data` 快照）。消费模式分两类：

**（A）单日 / 点状消费**（只在特定日期下读取当天数据）：
- 孩子端 `app.js`：`cachedData.homeworks?.[dateKey]`、`cachedData.dailySettlement?.[dateKey]`、`cachedData.freeTimeTasks?.[dateKey]`（221、851、948 等行）；首屏 `init()` 直接 `await API.getData()` 全量（935 行）
- 家长端 `admin.js`：单日作业 `cachedData.homeworks?.[AdminUtil.dateKey(adminDate)]`（234 行）
- 大屏 `big-screen.js`：`cachedData.dailySettlement[Util.dateKey(currentDate)]`（285–286 行）

**（B）跨天 / 聚合消费**（必须读取多天乃至全量历史才能得出结果）：

家长端统计页 `renderStatsTab()`（`admin.js` 1775–1926 行）是跨天消费的核心：
- `allDates = Object.keys(cachedData.dailySettlement).sort()` 取出**全部历史日期**（1778 行）
- `_statsRange === 'all'` 时 `dateRange = allDates`（全部历史），`week`/`month` 时取末尾 7/30 天（1779–1780 行）
- 遍历 `dateRange` 逐日计算：总用时、效率比、获得积分（1787–1800 行）
- **效率比非独立存储字段**，由前端现场用每天 `homeworks[date]` 的 `suggestedDuration / actualDuration` 计算（1793–1796 行）——即该指标的正确性**依赖全量 `homeworks` 可用**
- 遍历全量计算评级分布 `ratingCounts`（1806–1814 行）
- `calcStreak(allDates)` 遍历全量 `dailySettlement` 计算**连续全勤天数**（1861、1928–1949 行）
- 评级历史列表遍历全量 `dailySettlement` 渲染（1910–1916 行）
- 赏金历史统计 `historyCounts` 遍历全量 `bountySubmissions` 计算各任务完成次数（1060–1101 行）
- 大屏 `big-screen.js` 同样读取 `Object.keys(cachedData.dailySettlement)`（254–255 行）

**（C）仅用部分字段、其余未消费**：
- 积分：前端仅使用 `cachedData.points.balance`（`admin.js` 1955 行），**全量 `points.history` 流水在前端无任何渲染消费**
- `efficiencyHistory`：全仓库（前端）检索**无任何消费点**，效率指标由前端现场计算（见 3.2-B）
- `badges` / `history` / `tasks`：返回空对象，前端未使用

### 3.3 跨天功能清单（必须被新方案覆盖，结果需正确）

以下家长端功能依赖跨天数据，新方案必须保证其结果与当前一致：
1. 统计页——总用时（日均/周均/月均）
2. 统计页——平均效率比（日均/周均/月均）
3. 统计页——获得积分汇总
4. 统计页——评级分布（优/良/可/差计数与占比）
5. 统计页——连续全勤天数
6. 统计页——评级历史列表（可展开更多）
7. 统计页——在校/在家完成比例
8. 赏金任务历史完成统计
9. 大屏展示（依赖多日 `dailySettlement`）

### 3.4 前端未使用的返回字段（供专家团判断是否停止传输）

| 服务端返回字段 | 前端消费情况 |
|---|---|
| `points.history`（全量流水） | 仅 `balance` 被使用，流水未渲染 |
| `efficiencyHistory`（按天） | 全仓库无消费点 |
| `badges` / `history` / `tasks` | 返回空对象，未使用 |

---

## 4. 目标

1. **解耦天数**：客户端获取数据的总量不再随孩子的历史使用天数线性增长。
2. **按需索取**：每个功能模块仅请求其完成渲染/计算所必需的数据粒度，对应功能申请对应数据。
3. **功能等价**：现有孩子端、家长端、大屏的全部功能在新的数据获取方式下行为与结果保持一致（含上述 3.3 跨天功能）。
4. **实时性保持**：数据变更后客户端仍能在合理延迟内刷新到最新状态，且刷新过程不触发无谓的全量重拉。
5. **向后兼容（如需要）**：若方案涉及接口变更，需明确旧客户端/灰度期的兼容或迁移策略（由专家团裁定是否必要）。

## 5. 非目标（范围外）

- 不改变业务规则（积分算法、评级规则、效率比定义等逻辑本身）。
- 不改变认证 / JWT 签发与校验机制。
- 不要求改变产品功能范围或新增产品特性。
- 数据库表结构是否调整，由专家团根据所选方案裁定，不在本需求强制。

## 6. 功能需求（FR）

> 以下条目描述“系统应当支持什么”，不规定“如何实现”。

- **FR-1 单日数据轻量获取**：系统应支持客户端仅获取指定单日（如今日或某一历史日期）的业务数据，且返回体量与该日数据量成正比、与历史总天数无关。
- **FR-2 跨天聚合数据获取**：系统应支持家长端统计类功能（见 3.3）所需的数据，且返回体量应为**聚合后的精简结果**，而非全量原始历史。
- **FR-3 配置类数据获取**：商店 / 兑换 / 赏金任务 / 设置 / 奖励箱等与孩子使用天数无关的数据，应可独立获取，体量稳定。
- **FR-4 历史范围可控**：对于需要历史区间的场景（如“月”视图、“总计”视图），系统应支持按日期范围获取，且响应体量受范围约束、不随总历史长度无界增长。
- **FR-5 数据最小化传输**：系统不应传输客户端确定不消费的数据；对于当前前端未使用的返回字段（见 3.4），专家团应裁定其传输策略。
- **FR-6 实时刷新最小化**：数据版本变更触发刷新时，系统应仅重拉当前所需的数据，不应触发整体全量重拉。
- **FR-7 功能等价性**：迁移后，3.3 所列全部跨天功能的结果须与现状逐一对齐（建议以现有页面为基准做回归校验）。
- **FR-8 隔离性保持**：任何数据获取必须维持现有的多租户隔离（`tenant_id`）与单孩子隔离（`child_id` 绑定于 JWT）。

## 7. 约束

- 现有已存在的单日细粒度接口（如按天的作业 / 结算 / 自由时间 / 赏金提交等）可作为方案基础被复用，但非强制。
- 效率比指标当前由前端基于每日 `homeworks` 的 `suggestedDuration / actualDuration` 计算，任何方案须保证该指标计算结果正确（无论计算迁移至何处）。
- 客户端当前以 `cachedData` 内存快照为统一数据源，重构数据层时须保证各模块读取契约不被破坏（或同步迁移所有消费点）。
- 生产环境为 CloudBase 云函数（`PapaCheck.CloudFunc`），改动需走现有构建/部署流程。

## 8. 验收标准（AC）

- **AC-1（解耦）**：在固定网络与设备上，同一孩子账号在“历史 30 天”与“历史 365 天”两种数据规模下，首屏（及核心单日视图）的数据下载量差异应低于约定阈值（具体阈值由专家团与干系人商定，建议量级为“基本持平”）。
- **AC-2（跨天正确）**：家长端统计页在 `week` / `month` / `all` 三种范围下，其总用时、效率比、积分、评级分布、连续全勤天数、评级历史、赏金历史的结果，与当前 `/api/data` 全量快照下的计算结果完全一致。
- **AC-3（性能）**：在较长历史（如 ≥ 365 天）下，统计页任意范围视图的加载/响应时间应满足可用标准（具体指标由专家团商定）。
- **AC-4（实时）**：家长端发布/修改作业、孩子端完成等变更，客户端刷新延迟不劣于现状；且刷新请求总量不应随历史天数增长。
- **AC-5（回归）**：现有孩子端、家长端、大屏的全部功能 e2e / 手动回归通过，无功能退化。
- **AC-6（隔离）**：跨租户 / 跨孩子数据不可越权访问（沿用现有 JWT 隔离）。

## 9. 待专家团决策的开放问题

以下问题不在本需求范围内作答，交由专家团基于上述事实与目标做出技术决策：

1. **聚合计算位置**：跨天统计（总用时、效率比、积分、评级分布、连续天数等）的计算应放在客户端还是服务端？若服务端，接口应如何组织（单一聚合端点 vs 多个细分端点 vs 现有接口扩展）？
2. **数据分层策略**：如何划分“点状资源 / 聚合资源 / 配置资源”，各自通过什么接口契约暴露？
3. **历史区间与分页**：长历史（积分流水、评级历史等）应采用日期范围查询、游标分页还是其他策略？
4. **未使用字段处置**：3.4 所列前端未消费字段是否停止返回？若部分保留，理由为何？
5. **实时刷新机制**：现有 `/api/data-version` 轮询 + 全量重拉的模式应如何改造以符合 FR-6？
6. **兼容与迁移**：是否保留 `/api/data` 作为兼容/降级通道？旧客户端如何过渡？
7. **客户端数据层**：`cachedData` 统一快照模式是否解耦为模块化数据层？迁移范围如何界定？

## 附录 A：证据索引

| 事实 | 位置 |
|---|---|
| 服务端全量返回结构 | `PapaCheck.Server/src/db/postgres-adapter.ts:410-430` |
| homeworks 无日期过滤查询 | `postgres-adapter.ts:436` |
| dailySettlement 无日期过滤查询 | `postgres-adapter.ts:457` |
| efficiencyHistory 无日期过滤查询 | `postgres-adapter.ts:478` |
| points.history 全量流水查询 | `postgres-adapter.ts:400-408` |
| 家长端统计页跨天遍历 | `PapaCheck.Web/js/admin.js:1775-1926` |
| 效率比前端现场计算 | `admin.js:1793-1796` |
| 连续全勤天数计算 | `admin.js:1861, 1928-1949` |
| 赏金历史统计遍历 | `admin.js:1060-1101` |
| 积分仅用 balance | `admin.js:1955` |
| 大屏读取全量日期 | `PapaCheck.Web/js/big-screen.js:254-255` |
| 孩子端单日消费 + 全量 init | `PapaCheck.Web/js/app.js:221, 851, 935, 948` |
