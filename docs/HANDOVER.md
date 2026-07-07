# PapaCheck 上云交接文档（HANDOVER）

> 最后更新：2026-07-07（CloudBase 迁移进行中，v2.0.0 开发中）
> 状态：v2.0.0 开发中 — CloudBase 迁移子计划 1-5 代码完成，待网关切换 + 数据迁移 + ECS 下线

## 概述

PapaCheck 正在从阿里云 ECS 迁移到腾讯云 CloudBase。迁移后对外提供孩子端 / 管理端 / 落地页 / Android APK 下载服务，全部基于 CloudBase（SCF 云函数 + PG + 静态托管 + 网关）。

> **迁移期间**：ECS 仍在运行（作为回滚兜底），CloudBase 环境已就绪，网关路由待切换。切换后 1 周释放 ECS。

## CloudBase 环境信息

| 项目 | 值 |
|------|-----|
| 环境 ID | `child-teacher-parent-d9aef9d2208` |
| 别名 | `child-teacher-parent` |
| Region | `ap-shanghai` |
| 套餐 | 个人版（`baas_personal`），已付费至 2027-07-03 |
| PostgreSQL 实例 | `postgres-9pagpv9i`（max_connections=2048） |
| 静态托管 | CDN 域名 `...tcloudbaseapp.com`（已就绪） |
| 云存储 | CDN `6368-...tcb.qcloud.la`（APK 已用） |
| 网关自定义域名 | `chengdexy.cn`（certId `YvG6ZmNq`，HTTP+HTTPS） |
| API 云函数 | `papacheck-api`（Nodejs20.19，SCF + Fastify + PG） |
| TTS 云函数 | `tts-svc`（Python3.10，已迁移） |
| 已有路由 | `chengdexy.cn/dictations`（另一个项目，共存） |

### CloudBase 云函数环境变量

| 变量名 | 说明 |
|--------|------|
| `PG_HOST` | PostgreSQL 主机地址 |
| `PG_PORT` | PostgreSQL 端口（5432） |
| `PG_DATABASE` | 数据库名（`papacheck`） |
| `PG_USER` | 数据库用户（`papacheck`） |
| `PG_PASSWORD` | 数据库密码 |
| `JWT_SECRET` | JWT 签名密钥 |
| `JWT_ISSUER` | JWT 签发者（`papacheck`） |

> PostgreSQL 配置由 CloudBase 托管，不再需要手动维护本地 PG 实例。

## ECS 服务器信息（迁移期间保留，切换后 1 周释放）

| 项目 | 值 |
|------|-----|
| 公网 IP | `123.57.129.243` |
| SSH 用户 | `root` |
| 操作系统 | Ubuntu 24.04 LTS |
| Node.js | v22.22.3 |
| PostgreSQL | 16（运行中）|
| 服务管理 | systemd（`papacheck.service`）— **ECS 下线后废弃** |
| 部署路径 | `/opt/papacheck/PapaCheck.Server` |
| Web 目录 | `/opt/papacheck/PapaCheck.Web` |
| 当前版本 | v1.5.2（ECS 最后版本） |

> systemd / Nginx 配置将在 ECS 下线后废弃，生产环境不再使用。

## 域名与端点

### CloudBase（切换后生效）

| 路径 | 用途 |
|------|------|
| `https://chengdexy.cn/papacheck/` | 落地页（静态托管） |
| `https://chengdexy.cn/papacheck/app/` | 孩子端（静态托管） |
| `https://chengdexy.cn/papacheck/app/admin/` | 管理面板（静态托管） |
| `https://chengdexy.cn/papacheck/api/...` | REST API（SCF 云函数 `papacheck-api`，含 `/api/speak` TTS 转发到 `tts-svc`） |

### ECS（迁移前，切换后失效）

| 路径 | 用途 |
|------|------|
| `https://papacheck.chengdexy.cn/` | 落地页 |
| `https://papacheck.chengdexy.cn/app/` | 孩子端 |
| `https://papacheck.chengdexy.cn/app/admin/` | 管理面板 |
| `https://papacheck.chengdexy.cn/api/...` | REST API |

## 部署流程

### CloudBase 部署（切换后）

通过 Release 控制台 `all` 命令一键部署（tcb CLI，无需 SSH）：

```bash
# 启动发布控制台（推荐）
cd PapaCheck.Release && npm run dev

# 或直接 CLI — 一键部署全部
npx tsx release.ts all

# 单独部署各模块
npx tsx release.ts fn      # 部署 API 云函数（tcb fn deploy）
npx tsx release.ts site    # 部署静态托管（tcb hosting deploy）
npx tsx release.ts build-apk  # 构建 APK
```

执行步骤（`all` 命令）：
1. `cd PapaCheck.CloudFunc/papacheck-api && npm install && npm run build`（编译云函数）
2. `tcb fn deploy papacheck-api`（部署 API 云函数）
3. `cd PapaCheck.Site && npm install && npm run build`（Vite MPA 构建）
4. `tcb hosting deploy dist/ --dir papacheck`（部署静态托管到 `/papacheck/` 路径）
5. `cd PapaCheck.Web && tcb hosting deploy . --dir papacheck/app`（部署 Web 前端）
6. （可选）`build-apk --publish` 构建 + 上传 APK 到云存储

### ECS 部署（迁移前，切换后废弃）

```bash
# 启动发布控制台
cd PapaCheck.Release && npm run dev

# 或直接 CLI
npx tsx release.ts site --ip papacheck.chengdexy.cn --user root
```

执行步骤：
1. `cd PapaCheck.Site && npm install && npm run build`（Vite MPA 构建）
2. 打包 `dist/` 为 `landing.tar.gz`（排除 `admin/` 子目录和 `assets/admin-*`）
3. 打包 `dist/admin/` 为 `admin.tar.gz`
4. SSH 上传到 `/opt/papacheck/app/releases/site-vX.Y.Z/`
5. 重启 `papacheck.service`
6. 软链切换 `app/current → releases/site-vX.Y.Z/`

### 构建产物结构

```
dist/
├── index.html                # 落地页（引用 /assets/）
├── assets/                   # 共享资源（含 admin-*.js，被插件复制到 admin/assets/）
├── admin/
│   ├── index.html            # 管理面板（引用 /admin/assets/）
│   └── assets/
│       ├── admin-xxxxxx.js
│       └── admin-xxxxxx.css
└── imgs/mascot/              # 吉祥物 PNG
```

## 待补充

本文档为占位版本，后续会话需补充：
- [x] 阿里云 ECS 服务器规格与登录方式 — **2026-06-21 已补充**
- [x] Nginx 配置（站点配置 / HTTPS / 反向代理）— **2026-06-18 部分补充：cache 策略见下文**
- [x] systemd service 文件 — **2026-06-21 见下方部署说明**
- [x] PostgreSQL 数据库配置 — **2026-06-21 已补充**
- [x] 备份策略（每日 03:00 自动备份，本地保留 3 份）— **Phase 5d 已完成**；异地备份短期不规划
- [x] 监控与告警配置（磁盘/PG/备份状态，每 5 分钟轮询 + SMTP 邮件告警 + 每日运维报告）— **Phase 5d 已完成**
- [ ] 常见问题 FAQ — 短期不规划

## systemd 服务配置

`/etc/systemd/system/papacheck.service`：

| 项 | 值 |
|---|-----|
| 用户/组 | `papacheck` |
| 工作目录 | `/opt/papacheck/PapaCheck.Server` |
| ExecStart | `/usr/bin/node dist/index.js --web-dir /opt/papacheck/PapaCheck.Web`（TTS 已抽离为独立 tts-svc 服务，详见 `../tts-svc/`） |
| DATABASE_URL | `postgresql://papacheck:DaRkMoOn@localhost:5432/papacheck` |
| NODE_ENV | `production` |

## PostgreSQL 配置

| 项 | 值 |
|---|-----|
| 版本 | 16 |
| 主机 | localhost:5432 |
| 数据库名 | `papacheck` |
| 用户 | `papacheck` |
| 密码 | 见 `papacheck.service` 中 `DATABASE_URL` |
| 认证方式 | `scram-sha-256`（TCP），`peer`（本地 socket）|
| 表数量 | 26 张 |
| Swap | 2GB (`/swapfile`) |

### 手动连接
```bash
sudo -u papacheck psql -d papacheck
# 或远程：
PGPASSWORD=<密码> psql -U papacheck -h localhost -d papacheck
```

## 本地测试数据库搭建

> **说明**：SQLite 已退役，所有测试依赖 PostgreSQL 16。首次运行测试前需搭建本地测试数据库。

### 先决条件
- 安装 PostgreSQL 16：`winget install PostgreSQL.PostgreSQL.16`
- 确保 PostgreSQL 服务运行中：`pg_ctl start -D "C:\Program Files\PostgreSQL\16\data"`

### 一键搭建
```powershell
# 进入项目目录
cd PapaCheck.Server

# 运行搭建脚本
.\scripts\setup-test-db.ps1
```

脚本会：① 检查 PG 可用性 → ② 创建测试数据库 `papacheck_test` → ③ 执行 schema 建表 → ④ 生成 `.env.test` → ⑤ 输出测试命令

### 运行测试
```powershell
# 方式一：自动加载 .env.test（推荐）
npx vitest run

# 方式二：手动指定
$env:DATABASE_URL="postgresql://papacheck***REDACTED***@localhost:5432/papacheck_test"; npx vitest run

# 方式三：持久化设置（一次设置，永久生效）
[System.Environment]::SetEnvironmentVariable('DATABASE_URL', 'postgresql://papacheck***REDACTED***@localhost:5432/papacheck_test', 'User')
```

## 服务器端部署流程

### Node.js 服务更新

```bash
# 1. 本地编译
cd PapaCheck.Server && npm run build

# 2. 上传 dist/
scp -r dist/* root@123.57.129.243:/tmp/papacheck-dist/

# 3. 服务器端替换 + 重启
ssh root@123.57.129.243 "
  rsync -a --delete /tmp/papacheck-dist/ /opt/papacheck/PapaCheck.Server/dist/ &&
  systemctl daemon-reload &&
  systemctl restart papacheck
"

# 4. 验证
curl https://papacheck.chengdexy.cn/api/ping
```

### APK 推送

APK 已迁移到**腾讯云 CloudBase PG 存储**，发布流程不再需要手动 SCP 到 ECS。`cloud-publish.ts` 自动执行：

1. `tcb storage objects upload` → 上传到 CloudBase `dist` 存储桶
2. SSH `sed` → 更新 ECS 上 `PAPACHECK_CLIENT_VERSION` 系统环境变量
3. `systemctl daemon-reload && systemctl restart papacheck`

客户端通过 `/api/download`（302 → CloudBase CDN）或 `GET /api/version` 返回的 `clientVersion` 检测更新。
当前最新APK：`PapaCheck-1.5.0.apk`（包名 `com.chengdexy.papacheck` + Release 签名）

详细规范请参考 `docs/ARCHITECTURE.md` 第五节"部署架构"和 `nginx.conf` / `papacheck.service` 等根目录文件。

## Nginx 静态资源 Cache 策略

PapaCheck.Site 是 Vite SPA 单页应用，HTML 引用带 content-hash 命名的 bundle。正确的 cache 策略：

| 路径 | Cache-Control | 原因 |
|------|---------------|------|
| `/` (含 `index.html`) | `no-cache, must-revalidate` | HTML 不带 hash，必须每次 revalidate 才能拿到新 bundle 引用 |
| `/assets/*` | `public, max-age=31536000, immutable` | Vite 输出全部带 content-hash，URL 变了就一定是新文件，缓存 1 年安全 |

**坑1**：2026-06-18 之前 `location /` 漏设 `Cache-Control`，依赖浏览器启发式缓存，导致 site 上线后用户必须硬刷新（Ctrl+Shift+R）才能看到新 footer。修复方式：见 `nginx.conf` 第 65-72 行。

**坑2**：用 `expires 1y` + `add_header Cache-Control ...` 会被 nginx 自动生成 `Cache-Control: max-age=31536000` **并抑制** `add_header`，导致响应同时带两条 `cache-control` 头，浏览器行为不可预测。**正确做法是只用 `add_header`，不要 `expires`**。

**坑3**：`/etc/nginx/sites-available/default`（不是 `papacheck.conf`）才是实际的 papacheck vhost 配置文件。直接 scp `nginx.conf` 到 `sites-available/papacheck.conf` 不会被加载（默认 `sites-enabled` 没有对应的 symlink，且与 `default` 形成 `conflicting server name`）。正确做法：scp 覆盖 `sites-available/default` 本身。

**手动同步流程**：
```bash
# 1. 把项目 nginx.conf 同步到 live default
scp nginx.conf root@123.57.129.243:/etc/nginx/sites-available/default

# 2. 验证 + reload
ssh root@123.57.129.243 "nginx -t && nginx -s reload"

# 3. 验证响应头
curl -sI https://papacheck.chengdexy.cn/ | grep -i cache-control
curl -sI https://papacheck.chengdexy.cn/assets/main-C5smNfJo.js | grep -i cache-control
# index.html 应返回: cache-control: no-cache, must-revalidate
# /assets/*.js 应返回: cache-control: public, max-age=31536000, immutable
```

**自动化**：见 `scripts/add_nginx_cache_headers.py`（幂等修复脚本，可重复跑，不影响其他 location）。

## CloudBase 迁移切换与回滚

### 切换流程（网关路由配置）

1. 全量测试通过（npx vitest run，覆盖率达标）
2. 生产数据迁移到 CloudBase PG（执行 RLS 策略 SQL + 数据迁移脚本）
3. 部署 API 云函数 `papacheck-api`（`release.ts fn`）
4. 部署静态托管（`release.ts site`，Web 前端 + Site 落地页）
5. 配置网关路由：
   - `chengdexy.cn/papacheck/` → 静态托管（落地页）
   - `chengdexy.cn/papacheck/app/` → 静态托管（Web 前端）
   - `chengdexy.cn/papacheck/api/` → SCF 云函数 `papacheck-api`
   - `chengdexy.cn/papacheck/api/speak` → SCF 云函数 `tts-svc`
6. Android APK 推送新版（默认地址改为 `chengdexy.cn/papacheck/app/`）
7. 观察 24-48 小时
8. 无问题 → 释放 ECS（切换后 1 周）；有问题 → 回滚

### 回滚预案（< 5 分钟）

删除 CloudBase 网关的 `/papacheck/` 路由，DNS 恢复指向 ECS：

1. CloudBase 控制台删除 `/papacheck/` 网关路由
2. DNS A 记录 `papacheck.chengdexy.cn` 恢复指向 ECS IP `123.57.129.243`
3. ECS 上 systemd + Nginx + PostgreSQL 仍在运行（迁移期间不关机）
4. 验证 `https://papacheck.chengdexy.cn/api/ping` 返回 200

> **注意**：回滚窗口为切换后 1 周内。1 周后释放 ECS，回滚不再可能。
