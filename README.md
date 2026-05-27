# PapaCheck — 爸\~检查！

<img src="PapaCheck_ban.jpg" alt="PapaCheck Banner" width="100%" />

PapaCheck 是一个家长辅助工具，帮助管理和跟踪孩子的作业完成情况。老师通过邮件布置作业，AI 自动解析并添加到清单；孩子可以自主开始/暂停/完成作业并获得积分；家长远程评级并管理积分商店。

适用于 **家庭局域网**：一台电脑作为服务器，孩子的手机/平板打开 Web 大屏界面使用。

## 🏗 项目结构

```
PapaCheck/
├── PapaCheck.Server/     # 服务端 (Python HTTP + SQLite + TTS)
├── PapaCheck.Web/        # Web 端 (孩子大屏端 & 管理端 admin.html)
├── PapaCheck.Windows/    # Windows 桌面管理端 (tkinter GUI)
├── PapaCheck.Email/      # 邮件收取 & AI 解析
├── PapaCheck.Android/    # Android 端 (Flutter WebView 混合应用)
└── gen_test_data.py      # 测试数据生成
```

## ✨ 核心功能

- **📋 作业管理**：添加、开始、暂停、完成作业，支持计时器和挑战模式
- **🔊 语音提醒**：任务超时、评级结果、商店上新等重要环节的 TTS 语音播报
- **⭐ 积分&评级**：家长评级（优/良/可/差），结合效率加成计算积分
- **📊 数据统计**：管理端折线图/饼图展示作业用时、效率比、评级分布
- **🏪 积分商店**：孩子用积分兑换游戏时间或奖励物品，支持 Buff 系统
- **🎁 奖励箱**：家长发放奖励，孩子自主兑换
- **📧 邮件同步**：微信群多选老师作业信息，转发指定邮箱，AI 自动拉取邮件，解析作业并发布给孩子端
- **📎 附件下载**：微信转发到邮箱的图片、文件等，自动下载保存到本地

## 🚀 快速开始

### 1. 启动桌面端（推荐）

运行 `PapaCheck.exe`，GUI 界面会自动启动内置服务器，同时提供系统托盘、开机自启动、配置管理和日志查看功能。

服务默认启动在 `8080` 端口，首次运行会自动创建数据库和 TTS 语音缓存。

### 2. 访问客户端

**浏览器**（孩子端 / 管理端）

在其他设备的浏览器中访问 `http://192.x.x.x:8080` 即可。

- 孩子端：`http://192.x.x.x:8080/`
- 管理端：`http://192.x.x.x:8080/admin.html`

**Android 设备**：访问 `http://192.x.x.x:8080/api/download` 下载安装 APK。

（地址可在 EXE 主界面上找到）

### 3. 邮件同步

在 Windows 端菜单栏选择 **服务配置**，填写 IMAP 邮箱信息、用于接收作业邮件的邮箱地址和 AI API Key 即可启用。\
点击主界面 **邮件作业同步** 按钮，AI 会自动拉取邮件、解析作业并发布到孩子端。

### 4. 生成测试数据

```bash
python gen_test_data.py -d 90
```

向数据库写入 90 天的模拟数据，方便验证管理端图表功能。（不带任何参数时，默认生成60天数据）

## 🛠 技术栈

| 模块      | 技术                                        |
| ------- | ----------------------------------------- |
| Server  | Python 3, `http.server`, SQLite, edge-tts |
| Web     | 原生 HTML/CSS/JS, SVG 图表                    |
| Windows | tkinter, Windows Credential Manager       |
| Email   | IMAP4\_SSL, DeepSeek API                  |
| Android | Flutter, `webview_flutter`                |

## 📄 License

GNU Affero General Public License v3.0 (AGPL-3.0)
