/* Service Worker 20261109a — 静态壳缓存 + 推送通知
   策略：HTML = network-first（在线永远拿最新，离线回退缓存）；静态资源 = cache-first。
   /api/ 与 /sso/ 等动态接口一律不拦截、不缓存。 */
var CACHE = 'jerry-shell-v1';
self.addEventListener('install', function (e) {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then(function (c) { return c.add('./').catch(function () {}); }),
  ]).catch(function () {}));
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var u;
  try { u = new URL(req.url); } catch (err) { return; }
  if (u.origin !== self.location.origin) return;
  if (u.pathname.indexOf('/api/') >= 0 || u.pathname.indexOf('/sso/') >= 0) return;
  var html = req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0;
  if (html) {
    e.respondWith(fetch(req).then(function (r) {
      if (r && r.ok) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp).catch(function () {}); }); }
      return r;
    }).catch(function () {
      return caches.match(req).then(function (h) { return h || caches.match('./404.html'); });
    }));
    return;
  }
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (r) {
      if (r && r.ok && r.type === 'basic') { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp).catch(function () {}); }); }
      return r;
    });
  }));
});
self.addEventListener('push', function (e) {
  e.waitUntil(self.registration.showNotification('Jerry 的网站', {
    body: '你有新消息，点开查看', tag: 'jerry-msg', icon: './favicon.svg',
    data: { url: 'https://mc-creator-jerry-webpage.pages.dev/notice/' }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || 'https://mc-creator-jerry-webpage.pages.dev/notice/';
  e.waitUntil(clients.matchAll({ type: 'window' }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) { if (cs[i].url.indexOf('mc-creator-jerry-webpage.pages.dev') >= 0) return cs[i].focus(); }
    return clients.openWindow(url);
  }));
});
