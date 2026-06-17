# PapaCheck 技术架构文档

> 最后更新：2026-06-10 | 版本：1.2.21

## 一、技术栈

| 模块 | 语言/框架 | 关键依赖 |
|------|-----------|----------|
| **Server (Python)** | Python 3 | `http.server`（标准库）、SQLite、`edge-tts` |
| **Server (Node.js)** | Node.js 22+ | Fastify 5.x、better-sqlite3、TypeScript 5.x |
| **Web 前端** | 原生 HTML/CSS/JS | `localforage`（本地存储）、Service Worker |
| **Site（落地页+管理面板）** | Vite 5, React 18, TypeScript 5, Tailwind CSS 3 | Lucide Icons、Tailwind preset、React Router（可选） |
| **Windows 桌面端** | Python + tkinter | PyInstaller、`pystray`、Pillow、`keyring` |
| **Email 模块** | Python | IMAP4_SSL、LLM API（邮件内容解析） |
| **Android 端** | Dart/Flutter | `webview_flutter`、`path_provider` |
| **测试** | Python pytest, Vitest, Flutter test | pytest、conftest fixtures、Vitest 3.x、Flutter test |
| **构建发布** | Python 脚本 | `release.py` 一站式发布 |

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────┐
│                   家庭局域网                          │
│                                                     │
│  ┌──────────┐    HTTP/JSON     ┌──────────────────┐ │
│  │  孩子端   │ ◄─────────────► │                  │ │
│  │  (Web)   │                  │   PapaCheck      │ │
│  └──────────┘                  │   Server         │ │
│                                │  (Python+SQLite)  │ │
│  ┌──────────┐    HTTP/JSON     │   或              │ │
│  │  管理端   │ ◄─────────────► │  Node.js+Fastify  │ │
│  │  (Web)   │                  │  +better-sqlite3  │ │
│  └──────────┘                  └────────┬─────────┘ │
│                                         │           │
│  ┌──────────┐    HTTP/JSON              │           │
│  │ Android  │ ◄─────────────────────────┤           │
│  │ (Flutter)│                           │           │
│  └──────────┘                  ┌────────┴─────────┐ │
│                                │  Email Client    │ │
│  ┌──────────┐    HTTP/JSON     │  (IMAP+LLM)      │ │
│  │ Windows  │ ◄─────────────────┤                  │ │
│  │ (tkinter)│                  └──────────────────┘ │
│  └──────────┘                                       │
└─────────────────────────────────────────────────────┘
```

### 核心设计原则

1. **零外部服务依赖**：Python 标准库 HTTP 服务器 + SQLite 单文件数据库
2. **离线优先**：前端 Service Worker + localforage 缓存，Android 离线快照
3. **增量同步**：基于 `last_modified` 时间戳的 pull/push 机制
4. **单进程部署**：一个 Python 进程同时提供 API 和静态文件服务

---

## 三、项目结构

```
PapaCheck/
├── PapaCheck.Server/          # Python HTTP 服务器（标准库 http.server）
│   ├── server.py              # 主服务器（API 路由、TTS、静态文件）
│   ├── db.py                  # SQLite 数据库层（线程本地连接、WAL 模式）
│   └── tts_cache/             # TTS MP3 缓存
│
├── PapaCheck.Server.Node/     # [NEW] Node.js 服务器（Fastify）
│   ├── src/
│   │   ├── app.ts             # Fastify 应用（34 个 API 端点）
│   │   ├── index.ts           # CLI 入口
│   │   ├── db/index.ts        # better-sqlite3 数据库层
│   │   └── tts/index.ts       # Python 子进程 TTS 桥接
│   ├── scripts/
│   │   ├── tts_bridge.py      # TTS Python 子进程脚本
│   │   └── build-sea.mjs      # SEA 单 EXE 构建脚本
│   ├── test/                  # Vitest 测试（81 个测试用例）
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
│
├── PapaCheck.Web/             # Web 前端（孩子端 + 管理端）
│   ├── index.html             # 孩子端大屏界面
│   ├── admin.html             # 管理端界面
│   ├── css/                   # 样式
│   ├── js/                    # 逻辑（app/admin/api/db/sync/connection）
│   └── sw.js                  # Service Worker
│
├── PapaCheck.Site/            # [v1.4 整合] 落地页 + 管理面板（Vite 5 MPA）
│   ├── index.html             # 落地页入口
│   ├── admin/index.html       # 管理面板入口（Vite 第二入口）
│   ├── public/imgs/mascot/    # 5 张吉祥物 PNG（wave/point/ok/thumbs/bye）
│   ├── src/
│   │   ├── landing/           # 落地页 React 应用（TopNav/Hero/Story/Features/Platforms/CtaFinal/Footer）
│   │   └── admin/             # 管理面板 React 应用（AuthView/Dashboard/MemberTable/TenantTable/SystemHealth 等）
│   └── vite.config.ts         # MPA 配置 + adminBaseRewrite/copyAdminAssets 自定义插件
│
├── PapaCheck.Windows/         # Windows 桌面端
│   ├── app_gui.py             # tkinter GUI（系统托盘、配置管理）
│   ├── build_exe.py           # PyInstaller 打包
│   └── build_config.json      # 版本号配置
│
├── PapaCheck.Email/           # 邮件收取 & AI 解析
│   └── email_client.py        # IMAP + LLM API 解析
│
├── PapaCheck.Android/         # Android 端（Flutter WebView）
│   ├── lib/                   # Dart 源码（首次连通引导页、离线快照）
│   ├── test/                  # Flutter 测试
│   └── apk/                   # 预构建 APK 文件
│
├── PapaCheck.Tests/           # Python 服务端测试
│   ├── conftest.py            # pytest fixtures
│   └── test_*.py              # 测试文件
│
├── docs/                      # 文档 + GitHub Pages 落地页
├── release.py                 # 一站式发布脚本
└── pytest.ini                 # pytest 配置
```

---

## 四、数据模型

### 数据库：SQLite（`data.db`），WAL 模式

共 17 张表：

| 表名 | 用途 |
|------|------|
| `homeworks` | 作业记录（名称、科目、状态、计时、评级） |
| `daily_settlement` | 每日结算 |
| `points` | 积分余额 |
| `points_history` | 积分变动历史 |
| `shop_items` | 商店商品 |
| `redemptions` | 兑换记录 |
| `reward_box` | 奖励箱 |
| `bounty_tasks` | 赏金任务 |
| `bounty_submissions` | 赏金提交 |
| `bounty_completions` | 赏金完成 |
| `active_buffs` | 活跃 Buff |
| `badges` | 徽章 |
| `efficiency_history` | 效率历史 |
| `free_time_tasks` | 自由时间任务 |
| `last_modified` | 增量同步时间戳 |
| `settings` | 系统设置 |
| `meta` | 元数据 |

### 关键字段约定

- 时间字段：ISO 8601 字符串（`YYYY-MM-DDTHH:MM:SS`）
- 日期字段：`YYYY-MM-DD` 格式
- 状态字段：枚举字符串（如 `pending`/`in_progress`/`completed`/`paused`）
- 评级字段：`excellent`/`good`/`fair`/`poor`

---

## 五、关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| HTTP 服务器 | Python 标准库 `http.server` | 零依赖，适合局域网低并发场景 |
| 数据库 | SQLite（WAL 模式） | 单文件部署，无需安装，WAL 支持并发读 |
| 前端框架 | 原生 HTML/CSS/JS | 轻量、离线友好、无构建步骤 |
| Android 方案 | Flutter WebView 混合 | 复用 Web 前端，原生提供离线快照和 APK 更新 |
| 离线存储 | localforage (IndexedDB) | 浏览器端结构化存储，容量大 |
| 数据同步 | 基于 `last_modified` 增量同步 | 简单可靠，适合单用户场景 |
| TTS | edge-tts（微软） | 免费高质量中文语音 |
| AI 解析 | LLM API（如 DeepSeek 等） | 任意支持中文的 LLM 均可，默认使用 DeepSeek |
| 凭据存储 | Windows Credential Manager | 系统级安全存储 |

---

## 六、构建与发布

```
release.py → 一站式发布编排
  ├── bump_version.py           # 递增版本号
  ├── build_exe.py              # PyInstaller 打包 Windows EXE（Python 服务器）
  ├── npm run build:sea         # Node.js SEA 打包单 EXE（Node.js 服务器）
  ├── flutter build apk         # 构建 Android APK
  └── ZIP 打包分发
```

- EXE 版本号：`PapaCheck.Windows/build_config.json`
- APK 版本号：`PapaCheck.Android/pubspec.yaml`
- Node.js 服务器版本号：`PapaCheck.Server.Node/package.json`
- 当前版本：EXE `1.2.0`，APK `1.2.0+26`

---

## 七、Node.js 服务器架构（新增）

### 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 框架 | Fastify 5.x | 高性能、TypeScript 原生支持、插件生态 |
| 数据库 | better-sqlite3 | 同步 API 简化逻辑，与 Python 共用 data.db |
| 构建 | esbuild + SEA | Node.js 22 原生单 EXE 支持 |
| 测试 | Vitest 3.x | 与现有前端测试框架统一 |

### API 兼容性

Node.js 服务器提供与 Python 服务器完全等价的 34 个 API 端点（16 GET + 18 POST），数据结构完全一致，前端可以透明切换。

### 并行运行

两台服务器可同时运行在不同端口，共享同一 data.db：
