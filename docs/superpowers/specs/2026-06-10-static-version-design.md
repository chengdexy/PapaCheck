# 静态文件版本号自动检测与 Service Worker 缓存刷新

> **最后更新**: 2026-06-10
> **状态**: 已批准

## 1. 问题

PapaCheck 前端使用 Service Worker 以 cache-first 策略缓存全部静态资源（HTML、CSS、JS）。当文件更新后，客户端 SW 缓存不会自动失效，用户仍使用陈旧版本，导致 UI 异常或功能不一致。

## 2. 目标

- 静态文件更新后，客户端 SW 自动检测并刷新缓存
- 刷新过程用户无感：全屏 Mask → 自动 reload → toast 提示
- 离线时不做任何操作
- 支持 Web 浏览器和 Android WebView

## 3. 方案

### 3.1 核心思路

```
用户打开页面（或刷新）
    │
    ▼
SW cacheFirst 拦截 → 返回缓存 HTML → 后台检查 /api/static-version
                                              │
                                    ┌─────────┴──────────┐
                                    ▼                    ▼
                                hash 一致            hash 不一致
                                    │                    │
                                    ▼                    ▼
                              不做任何操作        清空缓存 → 重新预缓存
                                                    → 通知所有页面
                                                    │
                                                    ▼
                                          页面收到 SW 消息
                                          全屏 Mask → location.reload()
                                                    │
                                                    ▼
                                          刷新后 → toast "已更新到最新版本"
```

为什么不在 `activate` 中检测？因为 SW 的 `activate` 只在 `sw.js` 自身变化时才触发。如果只改了 `style.css` 或 `app.js` 而没改 `sw.js`，`activate` 不会执行。因此版本检测必须放在**每次 fetch 拦截时**执行。

### 3.2 服务端：`/api/static-version`

新增 `GET /api/static-version` 路由。

- 扫描 `PapaCheck.Web/` 下所有核心静态文件
- 计算 SHA1 总 hash，取前 12 位作为版本号
- 任意文件内容变化 → hash 变化
- 零依赖，使用 Node.js 内置 `crypto` + `fs/promises` 模块

**扫描文件列表**（与 `sw.js` 的 `CORE_RESOURCES` 保持一致）：

```
index.html, admin.html, sw.js, favicon.png,
css/style.css, css/admin.css,
js/api.js, js/connection.js, js/app.js, js/big-screen.js,
js/admin.js, js/db.js, js/change-log.js, js/crdt-sync.js, js/sync.js
```

### 3.3 Service Worker (`sw.js`) 改动

#### install 事件

保持现有逻辑不变——预缓存 + `self.skipWaiting()`。

```javascript
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_RESOURCES).catch(function (err) {
        console.warn('SW pre-cache partial failure:', err);
      });
    })
  );
  self.skipWaiting();   // ← 保留，让新 SW 能进入 activate
});
```

> `skipWaiting()` 必须在 install 中调用，否则 SW 会卡在 "waiting" 状态，永远进不了 activate。

#### activate 事件

清理旧版本缓存 + claim 接管页面。

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

不再在这里做版本检测（理由见 3.1）。

#### fetch 事件——版本检测机制

保持现有 `cacheFirst` / `networkFirst` 策略不变，但在 `cacheFirst` 中添加**后台版本检测**。

```javascript
function cacheFirst(request) {
  return caches.match(request).then(function (cached) {
    // 后台检查版本（仅对 HTML/CSS/JS 核心资源生效，每分钟最多检查一次）
    if (shouldCheckVersion(request.url)) {
      checkVersionInBackground();
    }

    // 现有逻辑：有缓存返回缓存，后台更新
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

**`shouldCheckVersion(url)`**：只对核心资源（属于 `CORE_RESOURCES` 的路径）触发，避免每次图片/API 请求都检查。

**`checkVersionInBackground()`**：

```javascript
var _lastVersionCheck = 0;
var _serverHash = '';

function checkVersionInBackground() {
  var now = Date.now();
  if (now - _lastVersionCheck < 60000) return;  // 每分钟最多一次
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
    // 通知所有已打开的页面刷新
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

**流程**：
1. 某次 `cacheFirst` 拦截到核心资源请求 → 触发后台检测
2. `fetch(/api/static-version)` 拿到新 hash
3. 与内存中的 `_serverHash` 对比
4. 不一致 → `triggerFullRefresh()`：清空缓存 → 重新预缓存 → postMessage 通知所有页面
5. 页面收到消息 → 执行刷新

首次访问时 `_serverHash` 为空，仅赋值、不做刷新。后续每次检测到变化才触发。

#### 完整 fetch 事件

```javascript
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  if (url.pathname === '/api/data' || url.pathname === '/api/ping') {
    event.respondWith(fetch(event.request).catch(function () {
      return new Response('', { status: 503, statusText: 'Service Unavailable' });
    }));
  } else if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request));
  } else {
    event.respondWith(cacheFirst(event.request));
  }
});
```

不需要单独处理 `/api/static-version`——它通过 fetch 请求直接走网络，不会被拦截（因为不是 GET 静态资源模式下的 cache-first 路径）。

### 3.4 前端页面改动

#### 注册 SW 并监听消息

在 `app.js` 和 `admin.js` 中，增加 `message` 事件监听：

```javascript
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      console.log('SW registered:', reg.scope);
    }).catch(function (err) {
      console.log('SW registration failed:', err);
    });

    // 监听 SW 发来的消息
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'FORCE_REFRESH') {
        sessionStorage.setItem('sw_updated', 'true');
        showTransitionMask('检测到新版本，正在刷新页面...');
        window.location.reload();
      }
    });
  });
}

// 页面加载时检测是否需要弹 toast
if (sessionStorage.getItem('sw_updated') === 'true') {
  sessionStorage.removeItem('sw_updated');
  // 延迟一点等页面和 toast DOM 都就绪
  setTimeout(function () {
    showToast('已更新到最新版本');
  }, 500);
}
```

#### 全屏 Mask

复用现有 `transitionMask` DOM 元素（已存在于 `index.html` 和 `admin.html`），显示 "检测到新版本，正在刷新页面..." + spinner。从显示 mask 到 `location.reload()` 是近乎瞬时的，用户不会看到白屏或闪现。

#### Toast

复用现有 `showToast()` 函数（已存在于 `app.js` 和 `admin.js`），显示 "已更新到最新版本"，2 秒后自动消失。

### 3.5 `CORE_RESOURCES` 同步

`sw.js` 中的 `CORE_RESOURCES` 数组与扫描文件列表保持同步。如果后续新增了前端文件，两处都需要添加。

当前列表：
```
/, /index.html, /admin.html,
/css/style.css, /css/admin.css,
/js/api.js, /js/connection.js, /js/app.js,
/js/big-screen.js, /js/admin.js, /js/db.js,
/js/change-log.js, /js/sync.js,
/favicon.png
```

> 注意：`index.html` 中引用了 `crdt-sync.js`，但 `CORE_RESOURCES` 中当前没有它。需要补上。

## 4. 边界情况

| 场景 | 行为 |
|------|------|
| 完全离线 | `fetch(/api/static-version)` 失败 → 不触发检查，继续使用缓存 |
| 文件未变化 | hash 一致 → 不做任何操作 |
| 仅 CSS/JS 变，sw.js 不变 | SW 在 fetch 拦截时检测到 hash 变化 → 自动刷新（核心改进） |
| 首次访问 | `_serverHash` 为空 → 仅赋值，不刷新 |
| SW 消息发出后页面已关闭 | `postMessage` 无效果，下次打开自动用新缓存 |
| Android WebView | 与浏览器行为一致，SW 机制相同 |
| 用户正在操作 | 全屏 Mask 阻止误操作，刷新后 toast 告知 |

### 3.6 版本检测间隔

当前间隔为 **30 秒**（`sw.js` 中 `_lastVersionCheck` 节流值），适合家庭局域网环境。

> ⚠️ **上云注意事项**：SaaS 多租户部署时，此间隔必须调整：
> 1. `sw.js` 中 `_lastVersionCheck` 改为 **2~5 分钟**（减少客户端无谓请求）
> 2. `/api/static-version` 服务端增加**内存缓存**（启动时计算一次 hash，每 60 秒刷新，避免每次请求都读文件）
> 3. 服务端缓存示意见 `app.ts` 中 `/api/static-version` 路由的注释

## 5. 不做什么

- 不改 HTML 引用方式（不引入 `?v=` query string）
- 不引入任何构建工具或编译步骤
- 不改动现有的 cache-first / network-first 缓存策略
- 不改动现有的发布流程（release.py）

## 6. 涉及文件

| 文件 | 改动类型 |
|------|---------|
| `PapaCheck.Server.Node/src/app.ts` | 新增 `/api/static-version` 路由 |
| `PapaCheck.Web/sw.js` | 重写 activate + 新增 cacheFirst 后台版本检测 + triggerFullRefresh |
| `PapaCheck.Web/js/app.js` | 增加 SW message 监听 + 刷新后 toast |
| `PapaCheck.Web/js/admin.js` | 增加 SW message 监听 + 刷新后 toast |
