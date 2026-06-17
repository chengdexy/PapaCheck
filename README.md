# PapaCheck — 爸\~检查！

![PapaCheck Banner](./docs/imgs/_banner.jpg)

> **v1.4.1-beta** — 运维增强，PostgreSQL 自动备份 + 健康监控（657 测试）

PapaCheck 是一个面向家庭局域网的家长辅助工具，帮助管理和跟踪孩子的作业完成情况。支持通过转发微信群中老师布置的作业到邮件，AI 自动解析并添加到清单；孩子可以自主开始/暂停/完成作业并获得积分；家长远程评级并管理积分商店。

## ✨ 核心功能

- **📋 作业管理**：添加、开始、暂停、完成作业，支持挑战模式（限时）和自由模式（计时器）
- **🏫 在校提前完成**：孩子端一键标记已在学校完成，自动记录用时（建议时长的 90%）
- **⭐ 积分 & 评级**：家长四级评级（优/良/可/差）× 效率加成 = 最终积分；当天已评级后新增作业自动按已有倍率追加积分
- **🔊 语音提醒**：任务超时、评级结果、商店上新等场景的 TTS 语音播报
- **📊 数据统计**：管理端折线图/饼图（作业用时、效率比、评级分布、在校提前完成比例）
- **🏪 积分商店**：孩子用积分兑换游戏时间或奖励物品，支持 Buff 系统（双倍积分等）
- **🎁 奖励箱**：家长发放奖励，孩子自主兑换
- **💰 赏金任务**：家长发布任务（如"帮妈妈洗碗"），孩子提交完成证明获取积分
- **📧 邮件同步**：转发老师作业邮件到指定邮箱，AI 自动解析并发布
- **📎 附件下载**：邮件中的图片、文件自动下载保存
- **📱 多端支持**：Web 大屏（孩子端 + 管理端）、Android APP、Windows 桌面端
- **🔌 离线可用**：断网时核心功能正常，联网后自动同步
- **💾 自动备份**：每日凌晨 PostgreSQL 自动备份，超管面板可下载
- **📊 健康监控**：磁盘/PG/备份状态实时监控，异常邮件告警

## 🚀 快速开始

### 0. 云部署（免局域网，随时随地访问）

项目已部署到阿里云 ECS，访问 [https://papacheck.chengdexy.cn/app/](https://papacheck.chengdexy.cn/app/)：

- **孩子端**：`https://papacheck.chengdexy.cn/app/`
- **管理端**：`https://papacheck.chengdexy.cn/app/admin.html`

> 服务器配置：2核2G / 3M带宽 / Ubuntu 24.04 / systemd + Nginx + PostgreSQL

### 1. 本地启动服务器

**方式 A：Windows 桌面端（推荐）**

从 [Releases](https://github.com/chengdexy/PapaCheck/releases) 下载最新版 `PapaCheck-{version}.exe`（当前 v1.3.1-beta），双击运行即可。

服务默认启动在 `8080` 端口，首次运行会自动创建数据库和 TTS 语音缓存。

**方式 B：Node.js 服务器（开发调试）**

```bash
cd PapaCheck.Server.Node
npm install
npm run dev -- --port 8080
```

需要 Node.js 18+。

### 2. 访问客户端

**浏览器（任何设备）**

在浏览器中访问 `http://192.x.x.x:8080`：

- 孩子端：`http://192.x.x.x:8080/`
- 管理端：`http://192.x.x.x:8080/admin.html`

**Android 平板/手机**

访问 `http://192.x.x.x:8080/api/download` 下载并安装最新 APK。

> 服务器 IP 地址可在 Windows 桌面端主界面上找到。

### 3. 邮件同步（可选）

在 Windows 端菜单栏选择 **服务配置**，填写 IMAP 邮箱信息、接收作业的邮箱地址和 API Key（用于解析邮件内容）。点击 **邮件作业同步** 按钮，AI 会自动拉取邮件、解析作业并发布。

## 🏗 项目结构

```
PapaCheck/
├── PapaCheck.Server/        # [已废弃] Python 服务端（保留参考，不再维护）
├── PapaCheck.Server.Node/   # 服务端（Node.js + Fastify + SQLite/PostgreSQL 双后端）
│   ├── src/db/              # 数据库抽象层（IDatabase + SqliteAdapter + PostgresAdapter）
│   ├── src/auth-plugin.ts   # Cookie Session 认证（临时）
│   └── scripts/             # 迁移脚本 + PostgreSQL DDL
├── PapaCheck.Web/           # Web 前端（孩子大屏 & 管理端 admin.html）
├── PapaCheck.Windows/       # Windows 桌面端（PyInstaller 单 EXE，内嵌 Node.js 服务器）
├── PapaCheck.Android/       # Android 端（Flutter WebView 混合应用）
├── PapaCheck.Tests/         # 测试（Vitest + pytest）
└── docs/                    # 项目文档
```

## 🛠 技术栈

| 模块              | 技术                                                    |
| ----------------- | ------------------------------------------------------- |
| **Server**        | Node.js, Fastify, better-sqlite3 / pg (PostgreSQL), edge-tts (`tts_bridge.py`) |
| **Web 前端**      | 原生 HTML/CSS/JS, SVG 图表, Service Worker              |
| **Windows 桌面端** | Python, tkinter, 内嵌 Node.js 子进程（pkg SEA 单 EXE） |
| **邮件同步**      | Node.js IMAP 模块（内置于服务端）                       |
| **Android 端**    | Flutter, `webview_flutter`                              |
| **测试**          | Vitest（前端/服务端 644 测试）、pytest（Python 53 测试） |
| **构建发布**      | release.py（一站式：EXE + APK + ZIP）                    |

## 🔧 开发

### 运行测试

```bash
# 全部测试
npm test                   # 前端 + 服务端测试（Vitest，671 个测试用例）
cd PapaCheck.Android && flutter test  # Android 端测试

# 单个测试文件
npx vitest run PapaCheck.Tests/duplicate_rating.test.js
```

### 项目文档

| 文档                                   | 说明       |
| -------------------------------------- | ---------- |
| [PRD](docs/PRD.md)                     | 产品需求文档 |
| [ARCHITECTURE](docs/ARCHITECTURE.md)   | 技术架构文档 |
| [API](docs/API.md)                     | API 接口文档 |
| [CHANGELOG](docs/CHANGELOG.md)         | 变更日志    |
| [PROGRESS](docs/PROGRESS.md)           | 进度记录    |
| [HANDOVER](docs/HANDOVER.md)           | 上云交接文档 |

### 测试驱动开发

本项目采用 TDD（测试驱动开发）流程，所有功能和 Bug 修复必须先写测试再写实现代码。

## 📄 License

GNU Affero General Public License v3.0 (AGPL-3.0)

![开发历程词云](./docs/imgs/_worldCloud.png)
