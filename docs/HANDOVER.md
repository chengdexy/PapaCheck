# PapaCheck 上云交接文档（HANDOVER）

> 最后更新：2026-07-14（文档事实修正：版本号 / 表数 / RLS / 轮询机制）
> 状态：CloudBase 迁移已完成，ECS 已下线，所有服务通过 CloudBase（SCF 云函数 + 静态托管 + 网关 + PG）运行。当前版本：Android APK 1.6.6 / Server 1.2.0 / Web 1.5.2（文档曾误标 v2.0.0）

## 概述

PapaCheck 已从阿里云 ECS 迁移到腾讯云 CloudBase。迁移后对外提供孩子端 / 管理端 / 落地页 / Android APK 下载服务，全部基于 CloudBase（SCF 云函数 + PG + 静态托管 + 网关）。ECS 已下线释放。

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
| TTS 云函数 | `tts-svc`（Python3.10，独立仓库维护，不在本仓库；`/api/speak`、`/api/pregen-speech` 经网关转发） |
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

> PostgreSQL 配置由 CloudBase 托管，无需手动维护本地 PG 实例。

## 历史 ECS 服务器信息（已下线释放）

| 项目 | 值 |
|------|-----|
| 公网 IP | `123.57.129.243` |
| SSH 用户 | `root` |
| 操作系统 | Ubuntu 24.04 LTS |
| Node.js | v22.22.3 |
| PostgreSQL | 16（运行中）|
| 服务管理 | systemd（`papacheck.service`）|
| 部署路径 | `/opt/papacheck/PapaCheck.Server` |
| Web 目录 | `/opt/papacheck/PapaCheck.Web` |
| 最后版本 | v1.5.2 |

> systemd / Nginx 配置在 ECS 下线后已废弃，生产环境不再使用。

## 域名与端点

### CloudBase（当前生产环境）

| 路径 | 用途 |
|------|------|
| `https://chengdexy.cn/papacheck/` | 落地页（静态托管） |
| `https://chengdexy.cn/papacheck/app/` | 孩子端（静态托管） |
| `https://chengdexy.cn/papacheck/app/admin/` | 管理面板（静态托管） |
| `https://chengdexy.cn/papacheck/api/...` | REST API（SCF 云函数 `papacheck-api`，含 `/api/speak` TTS 转发到 `tts-svc`） |

### ECS（已下线）

ECS 服务器 `123.57.129.243` 已下线释放，不再可用。

## 部署流程

### CloudBase 部署（生产环境）

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

### 历史 ECS 部署（已下线释放）

ECS 服务器 `123.57.129.243` 已下线，相关 systemd、Nginx 配置不再使用。

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

## APK 发布

APK 已迁移到**腾讯云 CloudBase 云存储**，`cloud-publish.ts` 自动执行上传：

1. `tcb storage objects upload` → 上传到 CloudBase `dist` 存储桶
2. `PAPACHECK_CLIENT_VERSION` 环境变量自动更新

客户端通过 `/api/download`（302 → CloudBase CDN）或 `GET /api/version` 返回的 `clientVersion` 检测更新。

详细规范请参考 `docs/ARCHITECTURE.md` 第五节"部署架构"。

## CloudBase 网关路由

### 坑：CloudBase 网关路由 STATIC_STORE 类型无法通过 MCP 工具管理

`manageGateway` MCP 工具的 `createRoute`/`updateRoute` 存在 bug：无论传入 `serviceType: "STATIC_STORE"`，创建的路由始终被转换为 `CBR` 类型，导致静态托管子路径无法正确转发。

**症状**：
- 通过网关访问 `/papacheck/app/admin.html` 等 HTML 文件时，始终返回 login 页内容（CSS/JS 文件正常）
- `SERVICE_VERSION_NOT_FOUND` 错误（因为 CBR 类型指向错误的 upstream）

**解决方案**（手动，通过 CloudBase 控制台）：
1. 登录 [CloudBase 控制台](https://tcb.cloud.tencent.com) → 环境 `child-teacher-parent` → HTTP 访问 → 路由管理
2. 找到 `/papacheck` 路由（如不存在则新建）
3. 设置 `UpstreamResourceType = "STATIC_STORE"`，`UpstreamResourceName = "staticstore"`，`enablePathTransmission = true`
4. 设置 PathRewrite `Prefix = "/papacheck"`
5. 保存生效

详情见 [CloudBase CLI 路由管理文档](https://docs.cloudbase.net/cli-v1/routes)。

### 部署流程

通过 Release 控制台 `all` 命令一键部署（tcb CLI，无需 SSH）：

```bash
# 启动发布控制台（推荐）
cd PapaCheck.Release && npm run dev

# 或直接 CLI — 一键部署全部
npx tsx release.ts all
```
