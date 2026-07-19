# 合并 CloudBase 迁移分支 + 部署记录（2026-07-19）

> 本文记录将 `backup/pre-rewrite-2026-07-14` 合并入 `main` 的事实、冲突处理、移动端重做、验证与部署状态。
> 回退点：`git tag pre-merge-backup-20260719`

---

## 一、背景：为什么合并

`backup/pre-rewrite-2026-07-14` 不是"只有 Android"，而是一条完整的 **ECS → CloudBase 云函数迁移 + 全面下线离线模式**任务线：

- 73 个提交（2026-07-07~08）：新建 `papacheck-api` 云函数、Site/Release 发布脚本从 `tar+SSH` 改为 `tcb hosting deploy`/`tcb fn deploy`、删除 Web 离线引擎（`sw/db/sync/crdt-sync/connection`）、Android 移除离线快照/写队列、MainActivity 删除 Room/WorkManager 写队列桥接。
- 1 个提交（2026-07-14，`211cf45`）：安全加固——移除硬编码 JWT 密钥、多租户隔离 fail-fast、部署凭证环境变量化。

**关键核实**：该 07-14 安全加固 `main` 已独立实现（`jwt.ts` 读 `process.env.JWT_SECRET`、`postgres-adapter.ts` 有 `tenantId required` 守卫），合并对此**零增量**。`main` 与 `backup` 是同一轮迁移的两条平行实现，不是主干+补丁。

`main` 此前是迁移前的遗留状态——Web 仍完整跑离线引擎（`ConnectionManager` 大量使用、`index.html` 加载 `connection.js` 等）。离线文件在 `main` 里是**该被迁移清掉的遗留物**，不是生产依赖。合并 = 把 `main` 升级到既定迁移终点。

---

## 二、合并执行（已完成）

| 步骤 | 操作 | 结果 |
|---|---|---|
| 1. 保护 | `git tag pre-merge-backup-20260719` | ✅ |
| 2. 暂存工作树 | `git stash push -u`（含当天移动 CSS / 竖屏 / WebView 手术） | ✅ 可恢复 |
| 3. 临时分支 | `git checkout -b merge/cloudbase-migration` | ✅ |
| 4. 合并 | `git merge backup/pre-rewrite-2026-07-14` | ✅ 仅 4 个后端文件冲突 |
| 5. 解冲突 | 4 个后端文件 `git checkout --ours`（保留 main 数据按需后端）后 `git add` + commit | ✅ 合并提交 `1fdc21a` |
| 6. fast-forward | `git checkout main && git merge --ff-only merge/cloudbase-migration` | ✅ main = `1fdc21a` |

**冲突文件（均保留 main）**：
- `PapaCheck.CloudFunc/papacheck-api/app.ts`
- `PapaCheck.CloudFunc/papacheck-api/src/admin/routes.ts`
- `PapaCheck.CloudFunc/papacheck-api/src/db/postgres-adapter.ts`
- `PapaCheck.CloudFunc/papacheck-api/src/db/types.ts`

> 理由：main 的数据按需后端（07-15~19）比分支 07-07~08 旧后端更新且已部署；分支后端被分支版 14 日提交覆盖，与 main 实现重复。

---

## 三、合并后重做（当天三项，已提交 `11f539e`）

用户确认"当天改动丢弃、合并后重做"，故未保留工作树版本，在干净树上重做：

1. **Web `style.css`**：分支前端结构是 `.big-screen-mode.active` 固定全屏 + `.big-content` grid（非原 `#homeworkCard/#buffBar`）。按分支结构重做移动端：
   - 900px 块改滚动流：`position:static; overflow-y:auto` + flex column（修手机内容超屏被裁切）。
   - 新增 480px 手机档：大时钟 30px、任务名 24px、`min-height` 适配、`@media(hover:none)` 去 hover。
2. **Android `main.dart`**：child 端恢复允许竖屏（与 parent 一致）。
3. **`pubspec.yaml`** → `1.6.7`。

---

## 四、验证结果（部署前必查）

| 项 | 命令/方法 | 结果 |
|---|---|---|
| Android 编译 | `flutter analyze`（先 `flutter pub get --offline`，沙箱无 pub.dev 网络） | ✅ No issues found |
| Web 离线移除 | grep `ConnectionManager` in `app.js` | ✅ 0 次；`RealtimeManager` 就位；5 个离线文件全删 |
| 后端编译 | `JWT_SECRET=buildcheck node build.mjs` | ✅ 产出 `dist/index.js` + `dist/handler-body.js` |
| 版本对齐 | `package.json` / `cloudbaserc.json` / `pubspec.yaml` | ✅ 均 1.6.7 |
| Web 离线移除 | `ConnectionManager` 0 次、`RealtimeManager` 就位、5 个离线文件本地已删 | ✅ |
| Web 数据机制（真实） | 核查 git 历史：`data-layer.js` 在合并前 main **也不存在**，三端一直 `API.getData()` 全量拉取。**前端按需从未真正实现**（3e19c41 文档是设计稿，仅后端 `/api/stats` 等端点落地）。合并前后前端行为一致全量，**无回退** | ✅ 已澄清（见 CHANGELOG/设计稿状态注记） |
| 移动端 CSS | `max-width:480px` ×2、`100dvh`×1 就位 | ✅ |
| 构建 APK | `./gradlew.bat assembleRelease --no-daemon`（gradle daemon 本机损坏，必须 `--no-daemon`） | ✅ 22M，13:17 |

> **重要纠正**：最初误报"合并回退了按需优化"。实查 git 历史证明 `data-layer.js` 合并前 main 即不存在，前端始终全量 `API.getData()`；3e19c41 的 design/requirement/regression 三份文档描述的是**未落地的设计稿**。合并无回退，前端全量为历史常态。用户决策：接受全量先部署，按需作为后续独立重构（三份文档已加状态注记）。

---

## 五、部署步骤与状态

| 阶段 | 命令 | 状态 |
|---|---|---|
| ① 构建 APK | `./gradlew.bat assembleRelease --no-daemon` | ✅ 成功（22M，13:17），产物 `PapaCheck.Android/build/app/outputs/flutter-apk/app-release.apk` |
| ② APK 传桶 | `tcb storage upload ... dist/PapaCheck-1.6.7.apk` | ⚠️ 本机 `tcb storage` 报 `FLAT_CMD_NOT_AVAILABLE_IN_PG` 不可用，**需你手动传**（目标 `*.tcb.qcloud.la/dist/PapaCheck-1.6.7.apk`） |
| ③ 前端部署 | 复制必要文件到临时目录 + `tcb hosting deploy <tmp> papacheck/app -e ...`（deploy.bat 逻辑，跳过 node_modules） | ✅ 已上线，新 CSS 已生效 |
| ④ 后端部署 | `tcb fn deploy papacheck-api --dir dist --force` | ✅ 已上线（`/api/version`=1.6.7） |
| ⑤ 公网验证 | version=1.6.7 / download 302 / app 200 / 新 CSS 上线 | ✅ 通过 |
| ⑥ 离线残留清理 | `tcb hosting delete` 删 5 个旧离线文件 | ⚠️ 本环境 `hosting delete` 同 `storage` 残废（报 success 实未删），残留文件仍 200 但代码不引用、**无害**；需 CloudBase 控制台手动删 |

---

## 六、回退方案

- 代码：`git checkout pre-merge-backup-20260719`（tag 永久保留，合并不满意可整体回退）。
- 工作树：合并前 `git stash` 内容仍可 `git stash pop` 恢复（若需原当天改动）。
- 生产：回退需重新 `tcb fn deploy` + `tcb hosting deploy` 旧 dist；APK 因安卓不允许降级装，旧版需用户手动卸载。
