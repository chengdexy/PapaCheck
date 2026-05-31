# 项目规范 (Project Rules)

## 1. 核心架构

- **后端**: Python Flask (`PapaCheck.Server/`)
- **前端**: 原生 JavaScript + IndexedDB + Service Worker (`PapaCheck.Web/`)
- **测试**: PyTest (后端) + Playwright (前端 E2E)

## 2. TDD 铁律

1. **没有失败的测试，不准写生产代码。** 如果先写了代码再补测试，必须删除代码重来。
2. **每次 bug 修复**：RED → GREEN → REFACTOR
3. **提交前**：跑全部测试（后端 + E2E），零失败才能 commit

## 3. E2E 测试规范

- **浏览器**: Playwright + Chromium (Edge channel), headless
- **定位器**: 使用 `page.wait_for_selector` / `page.wait_for_function` 等精确等待，**不用 `wait_for_timeout` 作为协议信号**
- **隔离**: `browser` fixture 用 `scope='function'`，每个测试独立浏览器实例
- **数据库**: `test_server` 用 `scope='class'`，同类共享临时 SQLite
- **命名**: `test_<场景描述>`, 类 `Test<模块>`, 中文 docstring

## 4. 后端测试规范

- **数据库**: tempfile + 内存隔离，无需 mock
- **命名**: `test_<函数>_<场景>`, 类 `Test<功能>`
- **断言**: 中文错误消息，`assert x == y, f'描述: 实际={x}'`

## 5. 离线同步架构

- `sw.js`: Service Worker (Cache First 静态 + Network First API, /api/data /api/ping 直连)
- `db.js`: IndexedDB 数据层 (14 张表)
- `change-log.js`: 离线变更队列
- `sync.js`: 同步引擎 (push → pull → LWW → clear)
- `api.js`: 在线优先 + 离线降级
- `app.js`: SW 注册 + 轮询 + 离线检测 (ping → fullSync → refresh)

## 6. Git 规范

- **必须 commit 的文件**: 所有 `.py`, `.js`, `.html`, `.css`, `sw.js`, 测试文件, `.trae/rules/project_rules.md`
- **不允许暂存/commit**: `.dbg/`, `__pycache__/`, `.pytest_cache/`, 临时文件
- **commit message**: 中文描述
