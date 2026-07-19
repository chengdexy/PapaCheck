# CloudBase PG 版云存储 · AI 操作说明书（避坑版）

> 受众：后续接手**任何使用 CloudBase PG 版云存储（pgstore）**的项目、需要上传 / 管理静态资源（安装包、附件等）的 AI。
> 目的：把 CloudBase PG 版云存储的坑固化成规则，避免重复踩。
> 适用范围：所有接入 CloudBase「云存储（PG 版）」的项目，与具体业务无关。

---

## 0. 一句话结论

静态资源（安装包、附件等）**必须写入 pgstore 云存储桶**（命令 `tcb storage objects upload ... --bucket <bucket>`）；**读取**走云开发总桶的公开镜像 URL。**绝不**写云开发总桶本身，**绝不**写 web 托管文件夹，也**不要**用 Neo 网关手动上传。

---

## 1. 桶架构（最易搞错，先读）

- **云开发总桶**：域名形如 `https://6368-<env-id>-<app-id>.tcb.qcloud.la`，是云开发统一存储桶。它下面的某个路径（如 `/<bucket>/`）是 **pgstore 云存储桶的公开镜像读取入口**（只读；pgstore 桶自身用 RLS 权限策略管控）。
- **pgstore 云存储桶**（如 `dist`）= 真实写入层（基于 PostgreSQL RLS）。
- 写入目标：pgstore 桶。读取入口：云开发总桶的镜像 URL。
- ⚠️ 总桶下的 `<bucket>/` 只是镜像，**写不进去 / 写错位置**，不能当真实桶直接写。

---

## 2. 正确上传命令（资源 → pgstore 桶）

```bash
tcb storage objects upload <local-file> <object-key> \
  --bucket <bucket> --env-id <env-id> --upsert
```

- 关键：`tcb storage` **`objects` 子命令** + `--bucket <bucket>`。
- 来源参考：各项目发版控制台的上传实现，通常就是上述 `tcb storage objects upload ... --bucket <bucket> --upsert` 形式。
- `--upsert` 覆盖同名文件。
- 命令第二个参数是对象 key（如 `app-1.2.3.apk`）；完整对象路径即 `<bucket>/<object-key>`。

---

## 3. 错误命令 + 为什么错（重点坑）

| 命令 | 现象 | 原因 |
|---|---|---|
| `tcb storage upload <path> <key>`（缺 `objects`、缺 `--bucket`） | 报 `FLAT_CMD_NOT_AVAILABLE_IN_PG` | 默认落到云开发总桶，PG 环境禁写该桶 |
| `tcb storage objects upload ...`（不带 `--bucket <bucket>`） | 同上，落到总桶被禁 | 没指定 pgstore 桶 |
| 把资源 `tcb hosting deploy ... <bucket>/...`（传 web 托管） | 写进静态托管，不是存储桶 | 托管文件夹 ≠ 存储桶，会让下载 / 引用 URL 错乱 |
| 用 Neo 网关 `POST api.tcloudbasegateway.com/v1/storages/object/<bucket>/...` 手动上传 | 找错通道 | 该网关是给**云函数内部**调存储桶用的，不是给人 / AI 手动上传的 |

⚠️ `FLAT_CMD_NOT_AVAILABLE_IN_PG` **不等于**"storage 整体禁写"——只是不能写云开发总桶。加 `--bucket <bucket>` 即可写 pgstore。

---

## 4. 下载 / 公开读取 URL（后端构造）

- 公开读取域名 = 云开发总桶镜像地址，形如 `https://6368-<env-id>-<app-id>.tcb.qcloud.la`（记为 `<storage-mirror-url>`）。
- 资源公开 URL = `<storage-mirror-url>/<bucket>/<object-key>`。
- ⚠️ 不要把读取基础地址改成 web 托管自定义域名（那是网页静态托管，不是云存储桶）。改了下载链路彻底错。

---

## 5. 验证上传是否成功

```bash
# 经镜像只读入口（回源 / 边缘均可）
curl -sI "<storage-mirror-url>/<bucket>/<object-key>" \
  | grep -iE "HTTP|content-length|content-type"
# 期望：HTTP 200, content-length 与实际文件一致, content-type 正确
```

- 镜像有 CDN 边缘缓存，刚上传可能需等片刻，或 `curl -H "Cache-Control: no-cache"` 强制回源。
- 真实文件大小须与本地一致。

---

## 6. 删除托管文件（顺带避坑）

- `tcb hosting delete <cloudPath> --yes`（`--yes` 必带，否则命令行卡在交互确认）。
- ⚠️ **删除前别只靠"代码 grep 无引用"判定为遗留**：落地页 `index.html`、独立功能子目录（如 `/admin/` 管理面板）通常不通过代码链接引用，删了会真 404 掉功能。先 `tcb hosting list` 看清根路径全貌，确认每个路径真实用途再动手。

---

## 7. tcb CLI 通用注意（精简）

- 命令需显式 `--env-id <env-id>`。
- Git Bash 下用相对路径或先 `cd` 进目录（绝对路径 `/e/...` 会被当相对路径解析失败）。
- 列桶：`tcb storage buckets list --env-id <env-id>`；列对象：`tcb storage list <prefix> --env-id <env-id>`。
- 凡涉及 pgstore 桶的上传 / 下载，一律带 `--bucket <bucket>`。

---

## 8. 典型踩坑时间线（教训来源，可删）

1. 误把资源传 web 托管 `<bucket>/`，并把下载重定向改成托管域名。
2. 想改传云开发总桶，被 `FLAT_CMD_NOT_AVAILABLE_IN_PG` 吓到，误判"storage PG 禁写"。
3. 看某篇云存储笔记误以为要用 Neo 网关手动上传（那是给云函数内部用的）。
4. 调研项目发版脚本才找到正解：`tcb storage objects upload ... --bucket <bucket> --upsert`。
5. 顺带删托管文件时，误删根 `index.html`（落地页）和 `/admin/`（管理面板），靠本地构建产物重建恢复。

> 核心教训：**写 pgstore 桶、读总桶镜像、绝不碰 Neo 网关手动上传、删托管文件先确认用途。**
