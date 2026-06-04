# PapaCheck — 爸\~检查！

<img src="PapaCheck_ban.jpg" alt="PapaCheck Banner" width="100%" />

> **v1.1.6** — 家庭作业管理从未如此轻松

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

## 🚀 快速开始

### 1. 下载并启动 Windows 桌面端

从 [Releases](https://github.com/chengdexy/PapaCheck/releases) 下载最新版 `PapaCheck.exe`，双击运行即可。

服务默认启动在 `8080` 端口，首次运行会自动创建数据库和 TTS 语音缓存。

### 2. 访问客户端（二选一）

**方式一：浏览器（任何设备）**

在浏览器中访问 `http://192.x.x.x:8080`：

- 孩子端：`http://192.x.x.x:8080/`
- 管理端：`http://192.x.x.x:8080/admin.html`

**方式二：Android 平板/手机**

访问 `http://192.x.x.x:8080/api/download` 下载并安装最新 APK。

> 服务器 IP 地址可在 Windows 桌面端主界面上找到。

### 3. 邮件同步（可选）

在 Windows 端菜单栏选择 **服务配置**，填写 IMAP 邮箱信息、接收作业的邮箱地址和 API Key （用于解析邮件内容）。点击 **邮件作业同步** 按钮，AI 会自动拉取邮件、解析作业并发布。

### 4. 生成测试数据（可选）

```bash
python gen_test_data.py -d 90
```

向数据库写入 90 天的模拟数据，方便验证管理端图表功能。

## 🏗 项目结构

```
PapaCheck/
├── PapaCheck.Server/     # 服务端 (Python HTTP + SQLite + TTS)
├── PapaCheck.Web/        # Web 端 (孩子大屏端 & 管理端 admin.html)
├── PapaCheck.Windows/    # Windows 桌面管理端 (tkinter GUI)
├── PapaCheck.Email/      # 邮件收取 & AI 解析
├── PapaCheck.Android/    # Android 端 (Flutter WebView 混合应用)
├── PapaCheck.Tests/      # 测试 (pytest + Vitest)
└── docs/                 # 项目文档
```

## 🛠 技术栈

| 模块              | 技术                                               |
| --------------- | ------------------------------------------------ |
| **Server**      | Python 3, `http.server`, SQLite, edge-tts        |
| **Web 前端**      | 原生 HTML/CSS/JS, SVG 图表, Service Worker           |
| **Windows 桌面端** | Python, tkinter, Windows Credential Manager      |
| **Email 模块**    | IMAP4\_SSL, LLM API（邮件解析）                      |
| **Android 端**   | Flutter, `webview_flutter`                       |
| **测试**          | Vitest（前端）、pytest（后端）、Flutter test（Android）      |
| **构建发布**        | PyInstaller（EXE）、release.py（一站式：EXE + APK + ZIP） |

## 🔧 开发

### 运行测试

```bash
# 全部测试
npm test               # 前端测试（Vitest，49 个测试用例）
pytest                 # 后端测试（pytest）

# 单个测试文件
npx vitest run PapaCheck.Tests/test_duplicate_rating.js
```

### 项目文档

| 文档                                   | 说明       |
| ------------------------------------ | -------- |
| [PRD](docs/PRD.md)                   | 产品需求文档   |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 技术架构文档   |
| [API](docs/API.md)                   | API 接口文档 |
| [CHANGELOG](docs/CHANGELOG.md)       | 变更日志     |
| [PROGRESS](docs/PROGRESS.md)         | 进度记录     |

### 测试驱动开发

本项目采用 TDD（测试驱动开发）流程，所有功能和 Bug 修复必须先写测试再写实现代码。

## 📄 License

GNU Affero General Public License v3.0 (AGPL-3.0)
