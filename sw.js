// Service Worker — يخزّن ملفات التطبيق ليعمل دون اتصال.
// غيّر VERSION مع كل إصدار (نفس الرقم في js/config.js)
const VERSION = '0.2.2';
const CACHE = 'dzweather-' + VERSION;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/config.js', 'js/util.js', 'js/storage.js', 'js/db.js', 'js/wilayas.js', 'js/outline.js',
  'js/weather.js', 'js/prompt.js', 'js/bulletin.js', 'js/audio.js', 'js/gemini.js', 'js/mapview.js', 'js/player.js', 'js/publish.js', 'js/mp4fix.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dzweather-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// الشبكة أولاً (لتصل التحديثات فوراً) ثم الكاش عند انقطاع الاتصال. طلبات الـ API الخارجية لا تُعترض.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'version') e.source && e.source.postMessage({ version: VERSION });
});
