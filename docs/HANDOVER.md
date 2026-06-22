# PapaCheck 上云交接文档（HANDOVER）

> 最后更新：2026-06-22（v1.4.0 APK 发布）
> 状态：v1.4.0 已上线

## 概述

PapaCheck 部署在阿里云 ECS，对外提供孩子端 / 管理端 / 落地页 / Android APK 下载服务。

## 服务器信息

| 项目 | 值 |
|------|-----|
| 公网 IP | `123.57.129.243` |
| SSH 用户 | `root` |
| 操作系统 | Ubuntu 24.04 LTS |
| Node.js | v22.22.3 |
| PostgreSQL | 16（运行中）|
| 服务管理 | systemd（`papacheck.service`）|
| 部署路径 | `/opt/papacheck/PapaCheck.Server.Node` |
| Web 目录 | `/opt/papacheck/PapaCheck.Web` |
| 当前版本 | v1.4.0 |

## 域名与端点

| 路径 | 用途 |
|------|------|
| `https://papacheck.chengdexy.cn/` | 落地页（产品介绍） |
| `https://papacheck.chengdexy.cn/app/` | 孩子端 |
| `https://papacheck.chengdexy.cn/app/admin/` | 管理面板 |
| `https://papacheck.chengdexy.cn/api/...` | REST API |
| `https://papacheck.chengdexy.cn/ws/...` | WebSocket 实时通知 |

## 部署流程

### `release.py site_publish` 一键发布

```bash
python release.py site-publish <server_ip> <server_user>
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
- [ ] 备份策略与异地备份
- [ ] 监控与告警配置
- [ ] 常见问题 FAQ

## systemd 服务配置

`/etc/systemd/system/papacheck.service`：

| 项 | 值 |
|---|-----|
| 用户/组 | `papacheck` |
| 工作目录 | `/opt/papacheck/PapaCheck.Server.Node` |
| ExecStart | `/usr/bin/node dist/index.js --web-dir /opt/papacheck/PapaCheck.Web --tts-python python3` |
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
cd PapaCheck.Server.Node

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
cd PapaCheck.Server.Node && npm run build

# 2. 上传 dist/
scp -r dist/* root@123.57.129.243:/tmp/papacheck-dist/

# 3. 服务器端替换 + 重启
ssh root@123.57.129.243 "
  rsync -a --delete /tmp/papacheck-dist/ /opt/papacheck/PapaCheck.Server.Node/dist/ &&
  systemctl daemon-reload &&
  systemctl restart papacheck
"

# 4. 验证
curl https://papacheck.chengdexy.cn/api/ping
```

### APK 推送

```bash
scp PapaCheck.Android/build/app/outputs/flutter-apk/app-release.apk \
  root@123.57.129.243:/opt/papacheck/PapaCheck.Web/apk/PapaCheck-<version>.apk
```

APK 存放在 `/opt/papacheck/PapaCheck.Web/apk/`，客户端通过 `/api/download` 或 `GET /api/version` 返回的 `clientVersion` 检测更新。
当前最新APK：`PapaCheck-1.4.0.apk`（包含 WebView session 持久化修复）

详细规范请参考 `docs/ARCHITECTURE.md` 第五节"部署架构"和 `nginx.conf` / `papacheck.service` / `docker-compose.yml` 等根目录文件。

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
