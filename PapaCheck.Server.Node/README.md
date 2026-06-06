# PapaCheck.Server.Node

PapaCheck（爸~检查！）Node.js 服务器 — 基于 Fastify 的 HTTP 服务器，与现有 Python 服务器 API 兼容。

## 技术栈

- **运行时**: Node.js 22+
- **框架**: [Fastify](https://fastify.dev/) 5.x
- **数据库**: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (SQLite, 同步 API)
- **语言**: TypeScript 5.x
- **TTS**: Python 子进程桥接 (edge-tts)
- **构建**: esbuild + Node.js SEA (单 EXE)
- **测试**: Vitest 3.x

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（热重载）
npm run dev -- --port 8080 --web-dir ../PapaCheck.Web --db-path ../data.db

# 运行测试
npm test

# 构建
npm run build
```

## 命令行参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--port` | `8080` | 监听端口 |
| `--web-dir` | `../PapaCheck.Web` | 前端静态文件目录 |
| `--db-path` | `./data.db` | SQLite 数据库路径 |
| `--tts-python` | `python` | Python 可执行文件路径 |

## 单 EXE 构建

```bash
npm run build:sea
```

生成 `dist/papacheck-server.exe`，可在无 Node.js 环境的机器上运行。

## API 端点

共 34 个端点（16 GET + 18 POST），与 Python 服务器完全兼容：

### GET 端点

| 端点 | 说明 |
|------|------|
| `/api/ping` | 心跳 |
| `/api/version` | 版本号 |
| `/api/data` | 全量数据 |
| `/api/homeworks/:date` | 作业列表 |
| `/api/settlement/:date` | 结算 |
| `/api/shop` | 商店 |
| `/api/redemptions` | 兑换记录 |
| `/api/reward-box` | 奖励箱 |
| `/api/settings` | 设置 |
| `/api/active-buffs` | Buff |
| `/api/efficiency/:date` | 效率 |
| `/api/freetime/:date` | 自由时间 |
| `/api/bounty-tasks` | 赏金任务 |
| `/api/bounty-submissions/:date` | 赏金提交 |
| `/api/bounty-completions/:date` | 赏金完成 |
| `/api/sync/pull?lastSync=` | 同步拉取 |

### POST 端点

| 端点 | 说明 |
|------|------|
| `/api/data` | 全量导入 |
| `/api/homeworks/:date` | 保存作业 |
| `/api/settlement/:date` | 保存结算 |
| `/api/points` | 积分变动 |
| `/api/shop` | 保存商店 |
| `/api/redemptions` | 保存兑换 |
| `/api/reward-box` | 保存奖励箱 |
| `/api/settings` | 保存设置 |
| `/api/active-buffs` | 保存 Buff |
| `/api/efficiency/:date` | 保存效率 |
| `/api/freetime/:date` | 保存自由时间 |
| `/api/bounty-tasks` | 保存赏金任务 |
| `/api/bounty-submissions/:date` | 保存提交 |
| `/api/bounty-completions/:date` | 保存完成 |
| `/api/defer-homework` | 作业延后 |
| `/api/reset-date` | 重置日期 |
| `/api/sync/push` | 同步推送 |
| `/api/pregen-speech` | 预生成语音 |

## 项目结构

```
PapaCheck.Server.Node/
├── src/
│   ├── index.ts          # 入口文件（CLI 参数解析 + 启动）
│   ├── app.ts            # Fastify 应用（路由注册）
│   ├── db/
│   │   └── index.ts      # SQLite 数据库层
│   └── tts/
│       └── index.ts      # TTS 语音桥接
├── scripts/
│   ├── tts_bridge.py     # TTS Python 子进程脚本
│   └── build-sea.mjs     # SEA 单 EXE 构建脚本
├── test/
│   ├── server.test.ts    # 服务器基础测试
│   ├── api.test.ts       # API 端点集成测试（34 个端点）
│   ├── db.test.ts        # 数据库层测试
│   └── tts.test.ts       # TTS 桥接测试
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 开发说明

### TDD

本项目严格遵循测试驱动开发。每个功能必须先写测试，再写实现。

```bash
# 运行所有测试
npm test

# 监听模式
npm run test:watch

# 运行特定测试
npx vitest run test/api.test.ts
```

### 与 Python 服务器并行运行

Node.js 服务器和 Python 服务器可同时运行在不同端口：

```bash
# 终端 1：Python 服务器（8080 端口）
python PapaCheck.Server/server.py

# 终端 2：Node.js 服务器（8081 端口）
npm run dev -- --port 8081
```
