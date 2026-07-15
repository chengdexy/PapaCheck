# PapaCheck — 爸\~检查！

![PapaCheck Banner](./docs/imgs/_banner.jpg)

> **v1.6.6**（Android APK）/ Server 1.2.0 / Web 1.5.3 — 部署在腾讯云 CloudBase（云函数 + PG + 静态托管 + 网关），轻量版本戳短轮询（默认 3 秒）数据同步，643+ Vitest 测试通过

PapaCheck 是一个面向家庭的家长辅助工具，帮助管理和跟踪孩子的作业完成情况。孩子可以自主开始/暂停/完成作业并获得积分；家长远程评级并管理积分商店。部署在腾讯云 CloudBase，支持随时随地访问。

## ✨ 核心功能

- **📋 作业管理**：添加、开始、暂停、完成作业，支持挑战模式（限时）和自由模式（计时器）
- **🏫 在校提前完成**：孩子端一键标记已在学校完成，自动记录用时（建议时长的 90%）
- **⭐ 积分 & 评级**：家长四级评级（优/良/可/差）× 效率加成 = 最终积分；当天已评级后新增作业自动按已有倍率追加积分
- **🔊 语音提醒**：任务超时、评级结果、商店上新等场景的 TTS 语音播报
- **📊 数据统计**：管理端折线图/饼图（作业用时、效率比、评级分布、在校提前完成比例）
- **🏪 积分商店**：孩子用积分兑换游戏时间或奖励物品，支持 Buff 系统（双倍积分等）
- **🎁 奖励箱**：家长发放奖励，孩子自主兑换
- **💰 赏金任务**：家长发布任务（如"帮妈妈洗碗"），孩子提交完成证明获取积分
- **📱 多端支持**：Web 大屏（孩子端 + 管理端）、Android APP
- **⚡ 数据同步**：前端 `RealtimeManager` 默认每 3 秒轮询轻量版本戳，变更才拉取全量；写操作后自动提速（burst），两端数据变更秒级感知
- **🎨 品牌落地页**：`PapaCheck.Site` 提供产品介绍 + 下载 + 注册入口，含五态吉祥物插画（wave/point/ok/thumbs/bye）
- **🛠 统一管理面板**：`PapaCheck.Site/admin` 提供家庭成员/作业/积分商店的远程管理（与落地页同一 Vite + React + TS + Tailwind 技术栈）
- **🚀 发布控制台**：`PapaCheck.Release` 提供 Web 界面一键构建 APK / 同步云端 / 部署 Site（Node.js + Fastify + SSE 实时日志）

## 🚀 快速开始

### 0. 云部署（免局域网，随时随地访问）

项目已部署到腾讯云 CloudBase，访问 [https://chengdexy.cn/papacheck/app/](https://chengdexy.cn/papacheck/app/)：

- **孩子端**：`https://chengdexy.cn/papacheck/app/`
- **管理端**：`https://chengdexy.cn/papacheck/app/admin/`

> 部署架构：CloudBase SCF 云函数 + PostgreSQL + 静态托管 + 网关（chengdexy.cn）

### 1. 本地启动服务器

**Node.js 服务器（本地开发）**

```bash
cd PapaCheck.Server
npm install
npm run dev -- --port 8080
```

需要 Node.js 18+。

### 2. 访问客户端

**浏览器（任何设备）**

在浏览器中访问 `http://192.x.x.x:8080`：

- 孩子端：`http://192.x.x.x:8080/app/`
- 管理端：`http://192.x.x.x:8080/app/admin/`

**Android 平板/手机**

访问 `http://192.x.x.x:8080/api/download` 下载并安装最新 APK。

## 🏗 项目结构

```
PapaCheck/
├── PapaCheck.Server/        # 服务端（Node.js + Fastify + PostgreSQL，本地开发用）
│   ├── src/db/              # 数据库抽象层（IDatabase + PostgresAdapter）
│   └── scripts/             # 迁移脚本 + PostgreSQL DDL
├── PapaCheck.CloudFunc/     # CloudBase 云函数（生产部署）
│   └── papacheck-api/       # API 云函数（SCF + Fastify + PG，从 Server 迁移）
├── PapaCheck.Web/           # Web 前端（孩子大屏 & 管理端 admin.html）
├── PapaCheck.Android/       # Android 端（Flutter WebView 混合应用）
├── PapaCheck.Site/          # 落地页 + React 管理面板（Vite + Tailwind）
├── PapaCheck.Release/       # 发布控制台（Node.js + Fastify + Web UI）
├── PapaCheck.WeChat/        # 微信公众号文章生成
└── docs/                    # 项目文档
```

## 🛠 技术栈

| 模块              | 技术                                                    |
| ----------------- | ------------------------------------------------------- |
| **云函数（生产）** | CloudBase SCF（Node.js 20.19）、Fastify、PostgreSQL     |
| **本地开发服务器** | Node.js, Fastify, pg (PostgreSQL)；TTS 由独立云函数 `tts-svc` 提供（仓库外维护） |
| **Web 前端**      | 原生 HTML/CSS/JS, SVG 图表, 轻量版本戳短轮询（默认 3 秒）同步 |
| **Site（落地页+管理面板）** | Vite 5, React 18, TypeScript 5, Tailwind CSS 3, Lucide Icons |
| **Android 端**    | Flutter, `webview_flutter`                              |
| **基础设施**      | CloudBase PG / SCF / 网关 / 静态托管                     |
| **测试**          | Vitest（643 单元 + PG 集成）                              |
| **构建发布**      | PapaCheck.Release（tcb CLI 部署）                         |

## 🔧 开发

### 运行测试

```bash
npx vitest run
```

### 项目文档

| 文档                                   | 说明       |
| -------------------------------------- | ---------- |
| [PRD](docs/PRD.md)                     | 产品需求文档 |
| [ARCHITECTURE](docs/ARCHITECTURE.md)   | 技术架构文档 |
| [CHANGELOG](docs/CHANGELOG.md)         | 变更日志    |
| [PROGRESS](docs/PROGRESS.md)           | 进度记录    |

> **注意**：独立的 `docs/API.md` 当前不存在，REST API 以 `PapaCheck.Server/src/app.ts` 与 `PapaCheck.CloudFunc/papacheck-api/app.ts` 中的路由为准。

### 测试驱动开发

本项目采用 TDD（测试驱动开发）流程，所有功能和 Bug 修复必须先写测试再写实现代码。

## 📄 License

GNU Affero General Public License v3.0 (AGPL-3.0)

![开发历程词云](./docs/imgs/_worldCloud.png)
