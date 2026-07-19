# PapaCheck 数据按需获取 — 状态报告与待决策事项

**日期**：2026-07-19
**性质**：交接报告，供专家团裁决
**一句话结论**：后端链路（数据按需 + 两处生产 500 修复 + TZ 固化）已真实合并部署；但**前端"数据按需/首屏解耦"并未落地**，承载它的提交是 git 游离对象、不在 main。交付总监终报把"前端已在 main"写成已交付，与实测不符。

---

## 1. 已核实的真实状态（git 实测，2026-07-19）

| 项目 | 实测结果 |
|---|---|
| 本地 main tip | `81b0de4`（工作树干净） |
| origin/main 是否含后端提交 | ✅ 含 `16b60cc`、`0f26f00`、`09a7508`、`cfe7207`、`746d242` |
| PR #2（`bugfix/clean-pr`） | **MERGED** |
| PR #1（`bugfix/admin-members-fk`） | CLOSED（被 #2 替代） |
| `feature/cloudbase-migration` 分支 | 远端已删除，本地/远程跟踪均无 |
| 前端 5 个提交 `73d2839` `9a77578` `c5ae05d` `72d8af4` `4edfeef` | ❌ **都不在 main**，无任何分支引用（纯游离对象） |
| `PapaCheck.Web/js/data-layer.js` | ❌ 工作树与 HEAD 均无 |

**结论**：任务 1（合并 PR #2）、任务 2（删 feature/cloudbase-migration）确已真实完成，不是口头声称。

---

## 2. 与"交付总监终报"的冲突点

| 交付总监终报声称 | 实测事实 |
|---|---|
| 前端 `data-layer.js` 已建、三端已迁到 Data 层 | `data-layer.js` 仅存于游离提交，HEAD/工作树均无；三端仍以全量 `API.getData()` 拉 `/api/data` |
| 前端 5 个提交"已在 main" | 5 个提交均不在 main，无任何分支够得到 |
| 首屏下载量降为 1/43.8（AC-1 达成） | 前端仍全量拉取，AC-1（首屏不随历史天数涨）**未达成** |
| "全链路已合并" | 仅后端链路合并；前端链路是游离提交，未进任何分支 |

---

## 3. 真实缺口（对照需求文档 `requirement-data-on-demand.md`）

- **服务端侧（FR-1~FR-4）**：✅ 已满足并已部署。端点 `GET /api/stats`、`GET /api/points/balance`、`GET /api/bounty-completions/total` 在 `dist/handler-body.js` 中确认存在，且 `dist/package.json` 版本 `1.6.7` = 生产版本。
- **客户端侧（AC-1 核心：首屏下载量与历史天数解耦）**：❌ 未满足。三端主加载仍走全量 `await API.getData()`（`app.js` 3 处、`admin.js` 1 处、`big-screen.js` 3 处，共 7 处）。后端按需端点已上线但**无人调用**。
- 需求文档内已标注"前端实现尚未落地"——该注记正确；终报把游离提交当"已在 main"夸大。

---

## 4. 合并前端的风险（专家团执行前必读）

- `git merge-tree` 预演 `73d2839 → main`：**冲突一大片**。涉及 `pubspec.yaml`、CloudFunc 的 `app.ts`/`handler-body.ts`/`routes.ts`/`postgres-adapter.ts`/`types.ts`、Server 的 `app.ts`、Web 的 `admin.js`/`app.js`/`big-screen.js` 等。
- **根因**：这批提交分叉点早于 CloudBase 合并（`1fdc21a`）与合并版后端（`16b60cc`），所改文件之后均被重写过 → 不能干净合。
- **盲合后果**：① 重复改已部署的生产后端文件，可能搞挂线上；② 覆盖 CloudBase 合并后的前端改动（移动端 CSS 适配、`child` 竖屏）。
- **建议**：不要直接 `git merge` 这 5 个游离提交。如需落地，应基于**当前 main** 重做前端切换（逐个解决冲突，把 `data-layer.js` + 三端迁移干净并入），再部署验证 AC-1/AC-2。

---

## 5. 需要专家团决策

1. **是否要真正落地前端按需？**
   - 维持现状：前端继续全量 `/api/data`，后端按需端点待调用，无功能损失（用户此前已拍板"先全量部署，前端按需后续单独重构"）。
   - 落地切换：按第 4 节方式基于当前 main 重做并部署验证。
2. **`/api/data` 是否择机下线**：thin 版稳定运行后可删路由，但当前前端仍依赖它，删前必须先完成前端切换。
3. 若决策为"落地"，需提供：基于 main 的重做计划 + 冲突解决策略 + 部署验证清单（AC-1 首屏字节数对比、AC-2 各 range 200）。

---

## 6. 执行者致命易错点（若需重新部署）

- **云函数部署**：`tcb fn deploy papacheck-api --dir dist --env-id child-teacher-parent-d9aef9d2208 --force`；`cloudbaserc.json` 必须保留全部 6 个环境变量（含 `vpc` 段），否则 redeploy 后连不上内网 DB。
- **前端部署**：必须走 `PapaCheck.Web/deploy.bat`（白名单拷贝 + 部署前清场），**禁止** `tcb hosting deploy .` 整目录上传（会把 `node_modules` 传上托管污染）。
- **`tcb` 3.5.9 不读 `.tcbignore`**，勿依赖该文件做防护。
- 改 `dist/package.json` 的 `version` 时，下载链接由 `CLIENT_VERSION` 拼装，需同步改。
- 生产对外域名是 `https://chengdexy.cn/papacheck/api`（非 CloudBase 默认域名）。
