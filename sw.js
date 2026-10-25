// Offline-Fähigkeit: App-Dateien zwischenspeichern, Netzwerk bevorzugen.
const CACHE = 'wisch-wanda-v24';
const FILES = [
  './', 'index.html', 'css/styles.css', 'js/app.js', 'js/planner.js', 'js/store.js', 'js/sync.js', 'js/waste.js', 'js/push.js', 'js/rewards.js', 'js/config.js',
  'js/vendor/supabase.js', 'manifest.webmanifest', 'icons/wanda.svg', 'icons/icon.svg', 'icons/icon-180.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  // Nur die eigenen App-Dateien – Anfragen an den Familien-Server nie zwischenspeichern.
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    // Immer beim Server nachfragen (GitHub Pages lässt Dateien sonst bis zu 10 Minuten veraltet im Browser)
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});

// ---------- Push-Benachrichtigungen ----------

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data?.json() ?? {};
  } catch {
    d = { body: e.data?.text() };
  }
  e.waitUntil(self.registration.showNotification(d.title || 'Wisch-Wanda', {
    body: d.body || '',
    tag: d.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow(e.notification.data?.url || './');
    }),
  );
});
