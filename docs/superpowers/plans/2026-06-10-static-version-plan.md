# 静态文件版本号自动检测 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 静态文件变更时，客户端 Service Worker 自动检测并刷新缓存，用户无感切换到最新版本

**Architecture:** 服务端新增 `/api/static-version` 返回所有核心文件的 SHA1 hash → SW 的 `cacheFirst` 拦截中每分钟后台检测一次 hash → hash 变化时清空缓存、重新预缓存、`postMessage` 通知页面 → 页面全屏 Mask 后 `location.reload()` → 刷新后 toast 提示

**Tech Stack:** Node.js (crypto), Service Worker, 原生 JS

---

### Task 1: 服务端新增 `/api/static-version` 路由

**Files:**
- Modify: `PapaCheck.Server.Node/src/app.ts`（约第 235 行后插入路由，文件顶部追加 import）
- Test: `PapaCheck.Server.Node/test/server.test.ts`（追加测试用例）

- [ ] **Step 1: 在 app.ts 顶部添加 crypto 和 readFile 导入**

在 `PapaCheck.Server.Node/src/app.ts` 第 3-4 行处追加：

```typescript
import { createHash } from 'crypto';
import { readdir, stat, readFile } from 'fs/promises';
```

当前第 4 行是 `import { readdir, stat } from 'fs/promises';`，改为：

```typescript
import { readdir, stat, readFile } from 'fs/promises';
```

- [ ] **Step 2: 新增 static-version JSON Schema**

在 `versionSchema`（约第 45 行）之后追加：

```typescript
const staticVersionSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        version: { type: 'string' },
      },
      required: ['version'],
    },
  },
};
```

- [ ] **Step 3: 注册 GET /api/static-version 路由**

在 `/api/version` 路由（约第 235 行）之后、`/api/download`（约第 238 行）之前插入：

```typescript
// 2c. GET /api/static-version - 静态文件版本 hash
app.get('/api/static-version', { schema: staticVersionSchema }, async (_request, reply) => {
  let version = '';
  if (options.webDir) {
    const files = [
      'index.html', 'admin.html', 'sw.js', 'favicon.png',
      'css/style.css', 'css/admin.css',
      'js/api.js', 'js/connection.js', 'js/app.js', 'js/big-screen.js',
      'js/admin.js', 'js/db.js', 'js/change-log.js', 'js/crdt-sync.js', 'js/sync.js',
    ];
    const hash = createHash('sha1');
    for (const f of files) {
      try {
        const content = await readFile(join(options.webDir, f));
        hash.update(content);
      } catch {
        // 文件不存在则跳过
      }
    }
    version = hash.digest('hex').slice(0, 12);
  }
  return sendJson(reply, { version });
});
```

- [ ] **Step 4: 编写测试用例**

在 `PapaCheck.Server.Node/test/server.test.ts` 末尾追加：

```typescript
describe('GET /api/static-version', () => {
  it('webDir 为空时返回空字符串 version', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/static-version',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('version');
    expect(typeof body.version).toBe('string');
  });
});
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run PapaCheck.Server.Node/test/server.test.ts --reporter=verbose`

Expected: 所有测试 PASS（包括新增的 1 个）

- [ ] **Step 6: 手动验证 API 响应**

启动开发服务器后，访问 `http://localhost:PORT/api/static-version`

Expected: `{"version":"a3f2b8e1c90d"}`（12 位 hex 字符串）

---

### Task 2: 重写 Service Worker（sw.js）

**Files:**
- Modify: `PapaCheck.Web/sw.js`（全量替换）

注意：sw.js 运行在浏览器 SW 环境，无法用 vitest/jsdom 测试。依赖 Task 4 的手动验证。

- [ ] **Step 1: 更新 CACHE_NAME 和 CORE_RESOURCES**

```javascript
var CACHE_NAME = 'papacheck-v3';

var CORE_RESOURCES = [
  '/',
  '/index.html',
  '/admin.html',
  '/css/style.css',
  '/css/admin.css',
  '/js/api.js',
  '/js/connection.js',
  '/js/app.js',
  '/js/big-screen.js',
  '/js/admin.js',
  '/js/db.js',
  '/js/change-log.js',
  '/js/crdt-sync.js',
  '/js/sync.js',
  '/favicon.png'
];
```

> 相比 v2 的变更：缓存版本升至 v3，新增 `crdt-sync.js`。

- [ ] **Step 2: 重写 install 事件——保留现有逻辑 + skipWaiting**

```javascript
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_RESOURCES).catch(function (err) {
        console.warn('SW pre-cache partial failure:', err);
      });
    })
  );
  self.skipWaiting();
});
```

- [ ] **Step 3: 重写 activate 事件——清理旧缓存 + claim**

```javascript
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});
```

- [ ] **Step 4: 添加版本检测和刷新函数**

在 `activate` 事件之后、`fetch` 事件之前插入：

```javascript
// ========== 静态文件版本检测 ==========

var _lastVersionCheck = 0;
var _serverHash = '';

function isCoreResource(url) {
  var path = url.pathname;
  return CORE_RESOURCES.indexOf(path) !== -1 || path === '/';
}

function shouldCheckVersion(url) {
  return isCoreResource(url);
}

function checkVersionInBackground() {
  var now = Date.now();
  if (now - _lastVersionCheck < 60000) return;
  _lastVersionCheck = now;

  fetch('/api/static-version').then(function (resp) {
    if (!resp.ok) return;
    return resp.json();
  }).then(function (data) {
    if (!data || !data.version) return;
    var newHash = data.version;

    if (!_serverHash) {
      _serverHash = newHash;
      return;
    }

    if (newHash !== _serverHash) {
      _serverHash = newHash;
      triggerFullRefresh();
    }
  }).catch(function () {
    // 离线，忽略
  });
}

function triggerFullRefresh() {
  console.log('SW: static files changed, refreshing all clients...');
  caches.delete(CACHE_NAME).then(function () {
    return caches.open(CACHE_NAME);
  }).then(function (cache) {
    return cache.addAll(CORE_RESOURCES);
  }).then(function () {
    return self.clients.matchAll();
  }).then(function (clients) {
    clients.forEach(function (client) {
      client.postMessage({ type: 'FORCE_REFRESH' });
    });
  }).catch(function (err) {
    console.warn('SW refresh failed:', err);
  });
}
```

- [ ] **Step 5: 更新 fetch 事件——在 cacheFirst 中触发版本检测**

保持 `addEventListener('fetch', ...)` 逻辑不变，但修改 `cacheFirst` 函数：

```javascript
function cacheFirst(request) {
  return caches.match(request).then(function (cached) {
    // 后台检查版本（仅对核心资源生效，每分钟最多一次）
    if (shouldCheckVersion(request.url)) {
      checkVersionInBackground();
    }

    if (cached) {
      if (request.method === 'GET') {
        fetch(request).then(function (response) {
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, response);
          });
        }).catch(function () { });
      }
      return cached;
    }
    return fetch(request).then(function (response) {
      if (request.method === 'GET') {
        var cloned = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, cloned);
        });
      }
      return response;
    });
  });
}
```

`networkFirst` 函数保持不变：

```javascript
function networkFirst(request) {
  return fetch(request).then(function (response) {
    if (request.method === 'GET') {
      var cloned = response.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        cache.put(request, cloned);
      });
    }
    return response;
  }).catch(function () {
    return caches.match(request).then(function (cached) {
      return cached || new Response('', { status: 503, statusText: 'Service Unavailable' });
    });
  });
}
```

---

### Task 3: 更新前端页面——消息监听 + Toast

**Files:**
- Modify: `PapaCheck.Web/js/app.js`
- Modify: `PapaCheck.Web/js/admin.js`

两个文件改动完全相同。

- [ ] **Step 1: 在 app.js 中添加 SW message 监听和 toast**

现有代码（第 6-14 行）：

```javascript
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      console.log('SW registered:', reg.scope);
    }).catch(function (err) {
      console.log('SW registration failed:', err);
    });
  });
}
```

修改为：

```javascript
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      console.log('SW registered:', reg.scope);
    }).catch(function (err) {
      console.log('SW registration failed:', err);
    });

    // 监听 SW 发来的强制刷新消息
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'FORCE_REFRESH') {
        sessionStorage.setItem('sw_updated', 'true');
        showTransitionMask('检测到新版本，正在刷新页面...');
        window.location.reload();
      }
    });
  });
}

// 页面加载时检测是否为刷新后
if (sessionStorage.getItem('sw_updated') === 'true') {
  sessionStorage.removeItem('sw_updated');
  setTimeout(function () {
    showToast('已更新到最新版本');
  }, 500);
}
```

- [ ] **Step 2: 在 admin.js 中做完全相同的修改**

admin.js 第 6-14 行也是完全相同的 SW 注册代码，改成与 Step 1 完全相同的内容。

---

### Task 4: 全量测试验证

- [ ] **Step 1: 运行全量 Vitest 测试**

Run: `npx vitest run --reporter=verbose`

Expected: 所有测试 PASS（407+ 个，包含新增的 1 个）

- [ ] **Step 2: 手动端到端验证**

在开发环境中执行以下手动验证：

| # | 步骤 | 期望结果 |
|---|------|---------|
| 1 | 启动 Node 服务器 | 服务正常启动 |
| 2 | 浏览器打开 `index.html`，打开 DevTools → Application → Cache Storage | 看到 `papacheck-v3` 缓存，包含所有核心资源 |
| 3 | 向浏览器发送 `navigator.serviceWorker.controller.postMessage({type:'FORCE_REFRESH'})` | 页面弹出全屏 Mask 后自动刷新，刷新后显示 "已更新到最新版本" toast |
| 4 | 修改任意 CSS/JS 文件内容，等待最多 60 秒（版本检测间隔），或直接修改并刷新页面 | SW 检测到 hash 变化 → 自动刷新 |
| 5 | 打开 DevTools → Network，断开网络连接 | `/api/static-version` 请求失败 → 不触发刷新，离线可用 |

- [ ] **Step 3: 确认 crdt-sync.js 已加入预缓存**

打开 DevTools → Application → Cache Storage → `papacheck-v3`，确认列表中包含 `/js/crdt-sync.js`。
