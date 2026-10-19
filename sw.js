// Offline-Fähigkeit: App-Dateien zwischenspeichern, Netzwerk bevorzugen.
const CACHE = 'wisch-wanda-v4';
const FILES = [
  './', 'index.html', 'css/styles.css', 'js/app.js', 'js/planner.js', 'js/store.js', 'js/sync.js', 'js/waste.js', 'js/config.js',
  'js/vendor/supabase.js', 'manifest.webmanifest', 'icons/wanda.svg', 'icons/icon.svg', 'icons/icon-180.png',
  'icons/icon-192.png', 'icons/icon-512.png',
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
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
