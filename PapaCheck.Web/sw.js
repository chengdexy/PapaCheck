var CACHE_NAME = 'papacheck-v4';

var CORE_RESOURCES = [
  '/',
  '/child',
  '/parent',
  '/index.html',
  '/admin/',
  '/css/style.css',
  '/css/admin.css',
  '/js/common.js',
  '/js/api.js',
  '/js/connection.js',
  '/js/app.js',
  '/js/big-screen.js',
  '/js/admin.js',
  '/js/db.js',
  '/js/crdt-sync.js',
  '/js/sync.js',
  '/favicon.png'
];

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

// ========== 静态文件版本检测 ==========

var _lastVersionCheck = 0;
var _serverHash = '';

function isCoreResource(url) {
  var path = url.pathname;
  return CORE_RESOURCES.indexOf(path) !== -1;
}

function shouldCheckVersion(url) {
  return isCoreResource(url);
}

function checkVersionInBackground() {
  var now = Date.now();
  if (now - _lastVersionCheck < 30000) return;
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

function cacheFirst(request) {
  return caches.match(request).then(function (cached) {
    // 后台检查版本（仅对核心资源生效，每分钟最多一次）
    if (shouldCheckVersion(new URL(request.url))) {
      checkVersionInBackground();
    }

    if (cached) {
      if (request.method === 'GET') {
        fetch(request).then(function (response) {
          if (response.ok) {
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(request, response);
            });
          }
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
