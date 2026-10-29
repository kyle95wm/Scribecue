// Offline support for the web version of Scribecue. It keeps a copy of the app's own
// files, so once it's been opened it works without a connection. Piper voices people
// download are kept apart, in the "piper-voices" cache, so new versions don't clear them. Video, audio and
// scripts never pass through here: they're opened straight from disk.
// The cache is named after the version, so a new release brings a new copy, and the app
// asks to reload when it's ready. Keep VERSION in step with app/js/update.js.
const VERSION = '0.20.0';
const CACHE = `scribecue-${VERSION}`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/browser.js', 'js/config.js', 'js/formats.js', 'js/piper-engine.js', 'js/piper-worker.js',
  'js/project.js', 'js/tts.js',
  'js/update.js', 'js/welcome.js', 'js/wave-worker.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('scribecue-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page asks for this when you choose to reload into a new version.
self.addEventListener('message', (e) => { if (e.data === 'update') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/tts/')) return;
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true }) ||
      (e.request.mode === 'navigate' ? await caches.match('index.html') : null);
    return hit || fetch(e.request);
  })());
});
