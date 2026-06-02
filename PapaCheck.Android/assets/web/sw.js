var CACHE_NAME = 'papacheck-v1';

var CORE_RESOURCES = [
  '/',
  '/index.html',
  '/admin.html',
  '/css/style.css',
  '/css/admin.css',
  '/js/api.js',
  '/js/app.js',
  '/js/big-screen.js',
  '/js/admin.js',
  '/js/db.js',
  '/js/change-log.js',
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
    })
  );
  self.clients.claim();
});

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
