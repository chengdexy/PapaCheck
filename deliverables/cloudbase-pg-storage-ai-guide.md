# CloudBase PG 版云存储 · AI 操作说明书（避坑版）

> 受众：后续接手 PapaCheck 部署 / 发版的 AI。
> 目的：把我踩过的 CloudBase PG 版云存储坑固化成规则，避免你重复踩。
> 项目环境：env-id `child-teacher-parent-d9aef9d2208`

---

## 0. 一句话结论

APK 等文件**必须写入 pgstore 的 `dist` 云存储桶**（命令 `tcb storage objects upload ... --bucket dist`）；**读取**走 6368 总桶下的 `dist/` 公开镜像 URL。**绝不**写 6368 总桶本身，**绝不**写 web 托管文件夹，也**不要**用 Neo 网关手动上传。

---

## 1. 桶架构（最易搞错，先读）

- **6368 总桶**（域名 `https://6368-<envId>-1253991009.tcb.qcloud.la`）= 云开发总桶。它下面的 `/dist/` 是 **pgstore `dist` 桶的公开镜像读取入口**（只读；4 条 public 策略作用在 `bucket_id='dist'` 上，但 6368 路径本身没有可写权限策略）。
- **pgstore `dist` 桶** = 真实写入层（基于 PostgreSQL RLS）。
- 写入目标：`dist` 桶。读取入口：6368 镜像 URL。
- ⚠️ 6368 的 `dist/` 只是镜像，**写不进去 / 写错位置**，不能当真实桶直接写。

---

## 2. 正确上传命令（APK → dist 桶）

```bash
ENV=child-teacher-parent-d9aef9d2208
tcb storage objects upload <local-apk> PapaCheck-X.Y.Z.apk \
  --bucket dist --env-id $ENV --upsert
```

- 关键：`tcb storage` **`objects` 子命令** + `--bucket dist`。
- 来源参考：`PapaCheck.Release/lib/build-apk.ts`（web 控制台发版脚本正是这么传的）。
- `--upsert` 覆盖同名文件。
- 命令第二个参数是对象 key，只写 `PapaCheck-X.Y.Z.apk`（`--bucket dist` 已含桶名）；完整对象路径即 `dist/PapaCheck-X.Y.Z.apk`。

---

## 3. 错误命令 + 为什么错（重点坑）

| 命令 | 现象 | 原因 |
|---|---|---|
| `tcb storage upload <path> <key>`（缺 `objects`、缺 `--bucket`） | 报 `FLAT_CMD_NOT_AVAILABLE_IN_PG` | 默认落到 6368 总桶，PG 环境禁写该桶 |
| `tcb storage objects upload ...`（不带 `--bucket dist`） | 同上，落到 6368 总桶被禁 | 没指定 pgstore `dist` 桶 |
| `tcb hosting deploy ... papacheck/dist/...`（把 APK 传托管） | 写进 web 托管，不是存储桶 | 托管文件夹 ≠ 存储桶，会让 `/api/download` 重定向错乱 |
| 用 Neo 网关 `POST api.tcloudbasegateway.com/v1/storages/object/dist/...` 手动上传 | 找错通道 | 该网关是给**云函数内部**调存储桶用的，不是给人 / AI 手动上传的 |

⚠️ `FLAT_CMD_NOT_AVAILABLE_IN_PG` **不等于**"storage 整体禁写"——只是不能写 6368 总桶。加 `--bucket dist` 即可写 pgstore。

---

## 4. 下载 URL / CDN_BASE（后端 `app.ts`）

- `CDN_BASE = 'https://6368-<envId>-1253991009.tcb.qcloud.la'`（6368 镜像域名，**不是**托管域名）。
- `/api/download` → 302 到 `${CDN_BASE}/dist/PapaCheck-${CLIENT_VERSION}.apk`。
- ⚠️ 不要把 `CDN_BASE` 改成 `chengdexy.cn/papacheck`（那是网页静态托管，不是 APK 存储桶）。改了下载链路彻底错。

---

## 5. 验证上传是否成功

```bash
# 经 6368 镜像只读入口（回源 / 边缘均可）
curl -sI "https://6368-<envId>-1253991009.tcb.qcloud.la/dist/PapaCheck-1.6.8.apk" \
  | grep -iE "HTTP|content-length|content-type"
# 期望：HTTP/2 200, content-length 21846140, content-type application/vnd.android.package-archive
```

- 镜像有 CDN 边缘缓存，刚上传可能需等片刻，或 `curl -H "Cache-Control: no-cache"` 强制回源。
- 真实文件大小须与本地 APK 一致（21.8MB ≈ 21846140 字节）。

---

## 6. 删除托管文件（顺带避坑）

- `tcb hosting delete <cloudPath> --yes`（`--yes` 必带，否则命令行卡在交互确认）。
- ⚠️ **删除前别只靠"代码 grep 无引用"判定为遗留**：落地页 `index.html`、独立功能子目录（如 `/admin/` 管理面板首页）通常不通过代码链接引用，删了会真 404 掉功能。先 `tcb hosting list` 看清根路径全貌，确认每个路径真实用途再动手。

---

## 7. 其他 CloudBase PG 部署事实（同源相关，精简）

- 自定义域名路由：`chengdexy.cn` 根 → `chengdexy` 云函数（主站）；`/papacheck` 路径 → `papacheck-api` 云函数（生产后端）；静态托管在 `/papacheck/app/`。CloudBase 默认函数域名（`envId-appId.ap-shanghai...`）落到根函数，**验证后端须打自定义域名 `/papacheck/api`**，默认域名 404 不说明任何问题。
- 云函数构建：`cd PapaCheck.CloudFunc/papacheck-api && node build.mjs`（需 `JWT_SECRET` 环境变量，从 `cloudbaserc.json` 的 `functions[0].config.envVariables.JWT_SECRET` 取，bake 进 `dist/jwt.secret`）。
- 部署：`tcb fn deploy papacheck-api --dir dist --env-id $ENV --force`。
- 静态托管部署：`tcb hosting deploy <localPath> <cloudPath>`。
- `tcb` 命令需显式 `--env-id child-teacher-parent-d9aef9d2208`；Git Bash 下用相对路径或先 `cd` 进目录（绝对路径 `/e/...` 会被当相对路径解析失败）。
- 云函数环境变量须全保留：`JWT_SECRET / DATABASE_URL / JWT_EXPIRES_IN / APK_VERSION / APK_CDN_URL / TZ`；`cloudbaserc.json` 须含 vpc 配置（否则连不上内网 PG）；runtime 保持 Nodejs18.15。

---

## 8. 本次踩坑时间线（教训来源，可删）

1. 误把 APK 传 web 托管 `papacheck/dist/`，并把 `/api/download` 重定向改成托管域名。
2. 想改传 6368 总桶 `dist/`，被 `FLAT_CMD_NOT_AVAILABLE_IN_PG` 吓到，误判"storage PG 禁写"。
3. 看《CloudBase 云存储调教笔记》误以为要用 Neo 网关手动上传（那是给云函数内部用的）。
4. 调研 `PapaCheck.Release` 才找到正解：`tcb storage objects upload ... --bucket dist --upsert`。
5. 顺带删托管文件时，误删根 `index.html`（落地页）和 `/admin/`（管理面板），靠本地 `PapaCheck.Site/dist/` 重建恢复。

> 核心教训：**写 pgstore `dist` 桶、读 6368 镜像、绝不碰 Neo 网关手动上传、删托管文件先确认用途。**
