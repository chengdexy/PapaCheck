# 实时刷新最小化回归验证清单（FR-6 / AC-4）

> ⚠️ **状态注记（2026-07-19）**：本清单断言的 `Data.refreshActive()` / `Data.init()` / `Data.day` 等 API 在 `PapaCheck.Web` 代码中**尚未实现**（`js/data-layer.js` 未落地），前端实际仍全量 `API.getData()` 拉取 `/api/data`。**本清单待前端 `Data` 层实现后适用**，当前仅作设计目标留存。

> 由 QA（T05）产出。验证目标：**版本戳变化后只重拉「当前视图」资源，不触发全量 `/api/data` 重拉**。
> 代码级已通过 `PapaCheck.Web/js/__tests__/data-layer.test.js`（4 用例，全过）覆盖 `Data.refreshActive()`；
> 本清单用于浏览器 / 真机手动回归，确认各端接线符合预期。

## 断言点（版本戳变化后只应重拉当前视图资源）

### 家长端 admin.js
- [ ] 切到统计 tab（`setStatsRange`）时，只发 `GET /api/stats?range=<当前>`，**不**发 `/api/data`；
- [ ] 切到其它 tab 再切回统计，只重拉当前 range 的 `/api/stats`，不重拉全量；
- [ ] 版本戳变化触发刷新时，网络面板只见：当前 range 的 `/api/stats` + `/api/points/balance` + `/api/bounty-completions/total` + 当前选定日的 `/api/settlement|homeworks|freetime/:date`，**无** `/api/data`；
- [ ] 配置类（shop / redemptions / reward-box / settings / bounty-tasks / active-buffs）在刷新中**不**重新请求（沿用缓存）。

### 孩子端 app.js
- [ ] 启动只拉今天 day + 配置 + balance + 当前 stats range + bounty total（`Data.init()`），首屏**不**发 `/api/data`；
- [ ] 写操作（提交作业 / 评分等）成功后，bump 版本戳 → 仅重拉当前视图资源（`refreshFromServer()` → `Data.refreshActive()`），**不**全量重拉；
- [ ] 切到某历史日期查看 / 编辑时，只重拉该 `:date` 的点状资源。

### 大屏 big-screen.js
- [ ] 大屏不依赖跨天 `cachedData`，只读今天 settlement（经 `Data.day`）与积分余额（`Data.points.getBalance()`）；
- [ ] 大屏**无** `/api/stats` 请求（设计确认大屏为单日消费者，见 design §A.2-②）。

### 通用
- [ ] `realtime.js` 的 `onRefresh` 回调在 admin / app 均指向 `Data.refreshActive()`（或 `refreshAllData()` 其函数体已改为 `Data.refreshActive()`），而非旧 `refreshAllData()` 全量语义；
- [ ] 刷新请求总量不随孩子历史天数增长（历史 30 天与 365 天用户的刷新请求数一致）。

## 反例（应判为源码 Bug → 路由工程师修复）
- 版本戳变化后若出现 `GET /api/data` 请求 → 源码 Bug，回退到全量重拉，需路由工程师修复；
- 切 tab 触发了非当前视图的 `/api/stats?range=其它` 或全量 `/api/data` → 源码 Bug。

## 已通过的自动化证据
- `PapaCheck.Web/js/__tests__/data-layer.test.js`：`refreshActive()` 仅调用 day / stats / balance / bounty total 的 loader，
  不调用配置 loader、不调用 `getData`（即 `/api/data`），**4/4 通过**。
- 代码审阅：`admin.js:199-200` → `refreshAllData()` → `Data.refreshActive()`；
  `app.js:1040-1041` → `refreshFromServer()` → `Data.refreshActive()`；`realtime.js` 的 `onRefresh` 统一由 `_fireRefresh()` 触发。
