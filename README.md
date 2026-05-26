# PapaCheck — 爸~检查！

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
- **📧 邮件同步**：自动拉取老师布置的作业邮件，AI（DeepSeek）解析内容并入库
- **📎 附件下载**：邮件附件自动保存到本地
- **⭐ 积分&评级**：家长评级（优/良/可/差），结合效率加成计算积分
- **🏪 积分商店**：孩子用积分兑换游戏时间或奖励物品，支持 Buff 系统
- **🎁 奖励箱**：家长发放奖励，孩子自主兑换
- **🔊 语音提醒**：任务超时、评级结果、商店上新等重要环节的 TTS 语音播报
- **📊 数据统计**：管理端折线图/饼图展示作业用时、效率比、评级分布
- **📱 全平台**：电脑 Web 端、Android APK、iOS Safari PWA 均可使用

## 🚀 快速开始

### 1. 启动服务端

```bash
cd PapaCheck.Server
python server.py
```

服务启动在 `8080` 端口，默认读取 `data.db` 文件。首次运行会自动创建数据库和 TTS 语音缓存。

### 2. 访问 Web 端

- **孩子大屏端**：`http://localhost:8080`
- **管理端**：`http://localhost:8080/admin.html`

其他设备通过局域网 IP 访问，例如 `http://192.168.1.x:8080`。

### 3. Windows 桌面版（可选）

```bash
cd PapaCheck.Windows
python app_gui.py
```

提供 GUI 界面，可在系统托盘运行，支持开机自启动、配置管理、邮件同步和日志查看。

### 4. 邮件同步

配置 `PapaCheck.Email/config.json`（或通过 Windows 端配置界面），填写 IMAP 邮箱信息、发件人地址和 AI API Key。

```json
{
  "email": "xxx@qq.com",
  "password": "授权码",
  "imap_server": "imap.qq.com",
  "port": 993,
  "sender": "老师邮箱",
  "ai_base_url": "https://api.deepseek.com",
  "ai_model": "deepseek-chat",
  "ai_api_key": "sk-xxx"
}
```

### 5. 生成测试数据

```bash
python gen_test_data.py -d 90
```

向数据库写入 90 天的模拟数据，方便验证管理端图表功能。

## 🛠 技术栈

| 模块 | 技术 |
|------|------|
| Server | Python 3, `http.server`, SQLite, edge-tts |
| Web | 原生 HTML/CSS/JS, SVG 图表 |
| Windows | tkinter, Windows Credential Manager |
| Email | IMAP4_SSL, DeepSeek API |
| Android | Flutter, `webview_flutter` |

## 📄 License

MIT
