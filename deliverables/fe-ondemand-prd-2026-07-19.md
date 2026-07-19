# 前端数据按需获取（重构）增量 PRD / 决策文档

> **文档元信息**
> - 项目：PapaCheck（前端按需获取重构）
> - 作者：许清楚（产品经理 / software-product-manager-2）
> - 日期：2026-07-19
> - 版本：v1.0（增量决策稿）
> - 基线：`main` 分支 tip `81b0de4`，工作树干净
> - 定位：基于已部署后端按需端点的**纯前端重构**决策与范围界定，**不改后端、不写代码**
> - 输入：需求稿 `docs/requirement-data-on-demand.md`、生产 CloudBase 已部署端点契约（实测核实）、`PapaCheck.Web/js` 当前 7 处消费点代码

---

## 1. 产品目标与范围

### 1.1 核心验收（复述，作为决策约束）
- **AC-1（解耦）**：首屏/核心单日视图数据下载量不随孩子历史使用天数增长（30 天 vs 365 天基本持平）。
- **AC-2（跨天正确）**：家长端统计页 `week`/`month`/`all` 三种范围下，总用时、效率比、积分、评级分布、连续全勤天数、评级历史、在校/在家比例、赏金历史，结果须与当前全量 `/api/data` 完全一致。
- **AC-5（回归）**：三端全部功能 e2e / 手动回归通过，无功能退化。
- AC-4（实时）：刷新请求总量不随历史天数增长；AC-6（隔离）：沿用 JWT 隔离。

### 1.2 In-Scope（本次必做）
1. 新增前端 **Data 层**（`PapaCheck.Web/js/data-layer.js`），作为按需端点的唯一调用方与 `cachedData` 填充方。
2. 迁移三端 **7 处** `await API.getData()` 全量调用（详见 §8 映射表）到 Data 层按需方法。
3. 实时刷新改造：保留 `/api/data-version` 轮询，但触发时只重拉**当前视图所需**最小集（§2-Q5）。
4. 兼容/降级：保留 `/api/data` 全量作为降级通道（§2-Q6）。

### 1.3 Out-of-Scope（本次不做）
- **后端零改动**：所有按需端点已部署上线，前端直接调用，新增/修改任何云函数不在本次范围。
- 不改变业务规则（积分算法、评级规则、效率比定义）、认证/JWT、数据库表结构。
- 不新增产品特性，不改变功能范围。
- 需求稿 3.4 未消费字段的"停止传输"**不在本次**（Q4 裁决）。
- 灰度发布策略为可选（Q6），默认一次性随版本上线 + 降级保底。

### 1.4 决策输入：已实测核实的后端端点契约（生产已部署）
| 类别 | 端点 | 说明 |
|---|---|---|
| 聚合 | `GET /api/stats?range=week\|month\|all`（或 `{range,from,to}`） | 服务端聚合：totalMinutes / efficiencyRatios / dailyPoints / ratingCounts / ratingTotal / ratingsList / completedInSchool / streak / avgTotalMin / avgEffVal / totalPoints。**已覆盖 admin 统计页全部跨天指标**，效率比由服务端用每日 homeworks 的 suggested/actualDuration 现场算 |
| 聚合 | `GET /api/bounty-completions/total` | 赏金各任务累计完成数（替代原前端 `migrateBountyCompletionsToTotal` 对全量 `bountyCompletions` 的遍历） |
| 点状 | `GET /api/homeworks/:date`、`/api/settlement/:date`、`/api/freetime/:date`、`/api/efficiency/:date`、`/api/bounty-submissions/:date`、`/api/bounty-completions/:date` | 单日/点状资源 |
| 配置 | `GET /api/shop`、`/api/settings`、`/api/reward-box`、`/api/bounty-tasks`、`/api/active-buffs`、`/api/points/balance` | 体量稳定，与历史天数无关 |
| 兼容 | `GET /api/data`（全量，保留）、`GET /api/data-version`（版本戳，保留） | 降级与轮询 |
| 认证 | 所有端点复用现有 JWT | parent JWT 含 tenant_id+child_id，隔离已内建（AC-6 直接满足） |

---

## 2. 开放问题裁决（需求稿第 9 节 Q1–Q7）

> 裁决总原则：**零后端改动、最小风险、AC-1/AC-2 必须达成**，且尽量保持现有消费点契约不变以降低回归面（AC-5）。

### Q1 聚合计算位置 → **服务端**
- **结论**：跨天统计全部交于服务端 `/api/stats`，前端不再遍历全量 `dailySettlement`/`homeworks` 自算。
- **理由**：(1) 现状 `renderStatsTab`（`admin.js:1775-1926`）必须持有全量历史才能算 streak/评级历史/效率比，是 AC-1 失败的根因；(2) 服务端已提供聚合端点且字段已覆盖全部跨天指标；(3) 服务端用每日 `homeworks` 现场算效率比，与现状口径一致，满足 AC-2。
- **影响**：`renderStatsTab` 改为消费 `Data.loadAdminStats(range)` 返回的聚合对象（§2-Q7），不再读 `cachedData.dailySettlement/homeworks`。

### Q2 数据分层策略 → **三层 + 兼容层**
- **结论**：点状资源 / 聚合资源 / 配置资源 三层划分，接口清单如下：

| 层 | 接口清单 | 消费方 |
|---|---|---|
| **点状资源**（单日） | `/api/homeworks/:date`、`/api/settlement/:date`、`/api/freetime/:date`、`/api/bounty-submissions/:date`（`/api/efficiency/:date`、`/api/bounty-completions/:date` 按需） | 孩子端单日、大屏单日、家长单日作业/赏金 |
| **聚合资源** | `/api/stats?range=week\|month\|all`、`/api/bounty-completions/total` | 家长端统计页、赏金历史 |
| **配置资源** | `/api/shop`、`/api/settings`、`/api/reward-box`、`/api/bounty-tasks`、`/api/active-buffs`、`/api/points/balance` | 三端配置/商店/积分 |
| **兼容/降级层** | `/api/data`（全量）、`/api/data-version`（轮询） | 降级通道、实时触发 |

### Q3 历史区间与分页 → 统计用 range，赏金历史用既有聚合 + 单日，无需新增后端端点
- **结论**：
  - 统计跨天 → `GET /api/stats?range=week|month|all`，服务端按范围聚合，响应体量由 range 约束（week≤7 天、month≤30 天、all=聚合后精简结果），不随总历史无界增长。✓ AC-1
  - 赏金"历史完成统计"（`historyCounts`）→ 直接取 `/api/bounty-completions/total`（全局累计，已覆盖现状 `adminBountyCompletions._total`）。✓ 无需 range。
  - 赏金管理页提交列表 → 单日 `/api/bounty-submissions/:date`（现状仅渲染当前 `adminDate` 当日提交）。
- **推荐（是否需后端配合）**：**当前产品无需 range 版赏金端点，零后端配合即可交付 AC-2**。若未来需要"按 week/month 展示赏金完成趋势"，推荐**客户端按当前 range 逐日调 `/api/bounty-submissions/:date` + `/api/bounty-completions/:date` 聚合**（范围已限定 ≤30 天，成本可控），仍**不新增后端端点**。仅在需要"无界历史导出"时才考虑新增 `GET /api/bounty-submissions?from=&to=`（列为 P2，本次不做）。

### Q4 未使用字段处置 → **暂不要求后端停传**
- **结论**：`points.history`、`efficiencyHistory`、`badges`、`history`、`tasks` 本次**保留后端传输**，前端仅停止全量拉取（不再调 `/api/data` 全量）。
- **理由**：纯前端重构目标是不改后端、零回归风险；停传需后端改动且牵涉未知消费方，风险收益比不划算。
- **记录**：列为 **P2 后续优化项**（后端在确认无消费方后停传/裁剪，进一步压缩 `/api/data` 体积）。注意：本次前端已不再消费这些字段，故即便后端仍传，也不进入按需路径。

### Q5 实时刷新机制 → 轮询保留，触发后只重拉"当前视图最小集"
- **结论**：沿用 `RealtimeManager` 轮询 `/api/data-version`；版本变更回调中**不再全量重拉**，改为调用 `Data.refreshCurrentView()`，按 entry + 当前视图重拉最小集：

| 端 | 触发场景 | 重拉最小集 |
|---|---|---|
| 孩子端 | RealtimeManager 回调 / 延后作业等操作 | `Data.loadChildDay(currentDateKey)`（单日 4 接口） |
| 家长端 | RealtimeManager 回调 / 多操作（refreshAllData） | 统计页激活 → `loadAdminStats(_statsRange)` + `loadBountyCompletionsTotal()`；赏金/作业页激活 → `loadAdminDay(adminDateKey)`；**配置类 init 一次性加载，刷新不重拉** |
| 大屏 | 奖励/商店操作后刷新（当前无轮询，仅操作后） | `Data.loadConfig()`（均为配置变更，体积稳定） |

- **理由**：最小集体量由"单日"或"range"约束，与历史天数无关，达成 AC-1/AC-4；配置类稳定，无需每次刷新。
- **影响**：替换 `app.js:836 refreshFromServer`、`admin.js:220 refreshAllData` 内部实现为 `Data.refreshCurrentView()`（调用点可保留，内部改为按需）。

### Q6 兼容与迁移 → 保留 `/api/data` 作为降级通道，旧客户端无影响
- **结论**：`/api/data` 全量接口**保留不删**；Data 层在任一按需端点失败/超时/解析异常时回退 `GET /api/data` 填充 `cachedData` 全量，保证功能不退化（AC-5）。旧版客户端（未更新）继续走 `/api/data`，不受影响，故**无需强制灰度**。
- **灰度（可选）**：可借 `/api/data-version` 或配置开关控制"新 Data 层"启用比例；默认关闭灰度、全量上线 + 降级保底。
- **待确认**：降级触发的具体阈值（超时 ms、连续失败次数）见 §6。

### Q7 客户端数据层 → **保留 `cachedData` 内存快照形状，由 Data 层按视图按需填充**
- **结论**：采用"快照形状不变 + Data 层按需填充"方案（最低风险），**而非**大改各模块调用。
- **契约保持规则**：
  - **单日点状消费**（孩子端 `homeworks/freeTimeTasks/bountySubmissions`、大屏 `dailySettlement`、家长单日作业/赏金）：**完全保留** `cachedData[field][dateKey]` 读取契约，Data 层按日期填充，消费点零改动。
  - **跨天聚合消费**（家长 `renderStatsTab`）：改为消费 `Data.loadAdminStats(range)` 返回的聚合对象，不再遍历 `cachedData`。这是本次**唯一必要的消费点迁移**，范围可控。
  - **配置类消费**（`shopItems/redemptions/rewardBox/bountyTasks/settings/activeBuffs/points.balance`）：保留 `cachedData` 形状，由 `loadConfig` 填充。
- **Data 层对外方法契约**（模块 `PapaCheck.Web/js/data-layer.js`，全局 `Data`）：

```js
// 初始化（替代各端 init 的 await API.getData()）
Data.bootstrap(entry /* 'child'|'admin'|'bigscreen' */, opts)

// 单日 / 点状资源
Data.loadChildDay(dateKey)        // → /api/homeworks/:d + /api/settlement/:d + /api/freetime/:d + /api/bounty-submissions/:d
Data.loadAdminDay(dateKey)        // → /api/bounty-submissions/:d + /api/homeworks/:d（家长单日作业/赏金）
Data.loadBigScreenDay(dateKey)    // → /api/settlement/:d + /api/homeworks/:d + /api/freetime/:d（可复用 loadChildDay 子集）

// 聚合资源
Data.loadAdminStats(range)        // → /api/stats?range= + /api/bounty-completions/total；返回 stats 聚合对象
Data.loadBountyCompletionsTotal() // → /api/bounty-completions/total

// 配置资源
Data.loadConfig()                 // → 并行 /api/shop,/api/settings,/api/reward-box,/api/bounty-tasks,/api/active-buffs,/api/points/balance

// 实时刷新（最小集，替代 refreshFromServer/refreshAllData 内的全量重拉）
Data.refreshCurrentView()         // 依据 entry + 当前视图重拉最小集（见 §2-Q5）

// 降级
Data.fallbackToFullCachedData()   // 任一按需端点失败 → GET /api/data 填 cachedData 全量

// 快照访问（契约不变）
Data.getSnapshot()                // → 返回 cachedData，供各模块按原形状读取
```

---

## 3. 数据分层架构（Mermaid）

```mermaid
graph TD
  subgraph 三端视图
    C[孩子端 app.js]
    A[家长端 admin.js]
    B[大屏 big-screen.js]
  end
  subgraph Data层[Data 层 data-layer.js]
    D1[loadChildDay]
    D2[loadAdminDay]
    D3[loadAdminStats]
    D4[loadConfig]
    D5[refreshCurrentView]
    FB[fallbackToFull]
  end
  subgraph 后端端点[生产 CloudBase 已部署]
    P1[点状 /api/homeworks|settlement|freetime|bounty-submissions/:date]
    P2[聚合 /api/stats?range /api/bounty-completions/total]
    P3[配置 /api/shop|settings|reward-box|bounty-tasks|active-buffs|points/balance]
    P4[兼容 /api/data /api/data-version]
  end
  C --> D1 & D4 & D5
  A --> D2 & D3 & D4 & D5
  B --> D1 & D4 & D5
  D1 --> P1
  D2 --> P1
  D3 --> P2
  D4 --> P3
  D5 --> P1 & P2 & P3
  D1 & D2 & D3 & D4 & D5 -.失败.-> FB --> P4
```

---

## 4. 需求池

### P0（Must have，达成 AC-1/AC-2/AC-5 的硬交付）
- P0-1 新增 `Data` 层模块，封装全部按需端点调用与 `cachedData` 填充。
- P0-2 **首屏/单日解耦**：孩子端 init 与单日视图改用 `loadChildDay`，首屏下载量与历史天数无关（AC-1）。
- P0-3 **统计页迁移**：`renderStatsTab` 改消费 `loadAdminStats(range)`，覆盖 week/month/all 全部跨天指标（AC-2）。
- P0-4 **配置类迁移**：三端配置/商店/积分改用 `loadConfig`，init 一次性加载。
- P0-5 **实时刷新最小化**：`refreshCurrentView` 按视图重拉最小集，替换全量重拉（AC-4）。
- P0-6 **降级回退**：任一按需端点失败回退 `/api/data` 全量，保功能不退（AC-5）。
- P0-7 **7 处调用点全量迁移**（见 §8），删除三端对 `API.getData()` 的直接全量调用。

### P1（Should have）
- P1-1 赏金历史 range 处理：当前用 `/api/bounty-completions/total` + 单日提交已满足；如未来需按范围趋势，采用客户端逐日聚合（Q3，零后端配合）。
- P1-2 （可选）`/api/data-version` 维度细化，使轮询能区分"配置变更 vs 业务变更"，进一步收敛刷新集。

### P2（Nice to have / 后续优化）
- P2-1 后端确认无消费方后停止传输 `points.history`/`efficiencyHistory`/`badges`/`history`/`tasks`，压缩 `/api/data` 体积（Q4）。
- P2-2 新增 `GET /api/bounty-submissions?from=&to=` 以支持无界赏金历史导出（仅当产品需要）。
- P2-3 大屏接入 `RealtimeManager` 轮询（当前仅操作后刷新，可选增强实时性）。

---

## 5. 用户故事

1. **孩子端首屏（AC-1）**：作为孩子，我打开 App 时只下载"今天"的作业/自由时间/赏金数据，无论我用了 30 天还是 365 天，首屏加载速度基本一致。
2. **家长端统计（AC-2）**：作为家长，我在统计页切换周/月/总计时，看到的总用时、效率比、积分、评级分布、连续全勤天数、评级历史、在校/在家比例、赏金历史，结果与升级前完全一致。
3. **大屏展示**：作为家庭大屏，我展示今日结算与作业进度时，只拉取当日数据，长时间使用也不会越用越慢。
4. **实时刷新（AC-4）**：作为家长，孩子完成作业或我审批赏金后，页面在合理延迟内刷新到最新，且刷新不会因我家历史数据多而变慢或拉全量。
5. **降级保底（AC-5）**：作为用户，即便某个按需接口偶发故障，应用仍能通过全量接口正常展示，不出现白屏或功能缺失。

---

## 6. 待确认问题（架构师/工程师拍板）

1. **服务端聚合公式一致性**：`/api/stats` 的服务端算法（效率比 mean、streak 跳过日历缺口、completedInSchool 比例、ratingCounts）必须与 `admin.js` 现状客户端算法逐字节一致，方能满足 AC-2。**需通过回归测试比对 `/api/stats` 输出与 `/api/data` 全量客户端计算结果（week/month/all）确认**。
2. **降级触发条件**：超时阈值（建议 8s）、连续失败次数（建议 1 次即回退）、stats 端点失败是否也回退全量（建议是）。
3. **`renderStatsTab` 迁移粒度**：确认改为消费 `Data.loadAdminStats` 返回的聚合对象，不再遍历 `cachedData`（唯一必要消费点迁移）。
4. **`loadConfig` 刷新策略**：确认配置类仅在 `bootstrap` 加载、操作后本地即时更新、刷新不重拉；是否需要在特定操作后（如兑换后）强制 `loadConfig` 一次以防并发。
5. **`/api/data-version` 区分度**：是否足以区分"配置变更 vs 业务变更"以进一步收敛刷新集（P1-2）。
6. **大屏是否需接入 RealtimeManager**（P2-3）。

---

## 7. 验收映射（AC-1 ~ AC-6）

| 验收 | 验证方式 |
|---|---|
| **AC-1 解耦** | 固定网络/设备，同一账号分别构造"历史 30 天"与"历史 365 天"数据，对比孩子端首屏 + 单日视图的**下载字节数/请求数**（Network 面板），差异应 < 阈值（建议基本持平）；统计 `week` 视图请求体量与历史总天数无关 |
| **AC-2 跨天正确** | 对 week/month/all 三范围，分别用 `/api/data` 全量在旧 `renderStatsTab` 算法下算出基准值，与迁移后 `loadAdminStats` 渲染值逐项比对：总用时、效率比、积分、评级分布、连续全勤天数、评级历史、在校/在家比例、赏金历史，必须完全一致（建议自动化比对脚本） |
| **AC-3 性能** | ≥365 天历史下，统计页任意范围视图加载/响应时间满足可用标准（指标由架构师定） |
| **AC-4 实时** | 构造数据变更 → 轮询触发刷新，断言仅重发"当前视图最小集"请求（断言不出现 `/api/data` 全量，除非降级）；刷新请求总量不随历史天数增长 |
| **AC-5 回归** | 三端 e2e + 手动回归：孩子端作业/自由时间/赏金、家长端统计/作业/赏金/商店、大屏结算/商店；注入按需端点失败，验证降级到 `/api/data` 后功能正常 |
| **AC-6 隔离** | 沿用现有 JWT（tenant_id+child_id），断言跨租户/跨孩子无法越权访问按需端点（现有隔离，回归确认即可） |

---

## 8. 附录：7 处全量调用点迁移映射表

| # | 文件:行 | 当前行为 | 触发/视图 | 迁移到 Data 层 |
|---|---|---|---|---|
| 1 | `app.js:220` | `requestDeferHomework` 后全量重拉 | 孩子端操作 | `Data.loadChildDay(currentDateKey)` |
| 2 | `app.js:836` | `refreshFromServer`（RealtimeManager 回调） | 孩子端实时 | `Data.refreshCurrentView()` → `loadChildDay(today)` |
| 3 | `app.js:882` | `init` 首屏全量 | 孩子端启动 | `Data.bootstrap('child')` = `loadChildDay(today)` + `loadConfig()` |
| 4 | `admin.js:222` | `refreshAllData`（init + 多操作点） | 家长端 | `Data.bootstrap('admin')` / `Data.refreshCurrentView()` |
| 5 | `big-screen.js:1114` | `redeemRewardBox` 后全量重拉 | 大屏奖励 | `Data.loadConfig()` |
| 6 | `big-screen.js:1149` | `cancelRedemption` 后全量重拉 | 大屏奖励 | `Data.loadConfig()` |
| 7 | `big-screen.js:1260` | `redeemItem` 后全量重拉 | 大屏商店 | `Data.loadConfig()` |

> 注：admin.js 另有约 30 处 `await refreshAllData()` 操作点（审批/兑换/设置等），统一将 `refreshAllData` 内部实现改为 `Data.refreshCurrentView()` 即可，无需逐点改调用。
