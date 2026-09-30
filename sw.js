// Measure Calculator service worker. Keeps a copy of the app so it opens with
// no signal, refreshes that copy in the background, and answers the page's
// "is there a newer version?" question so it can offer a reload.
const CACHE = 'measure-calc-v1';
const APP_FILES = ['./', './index.html', './manifest.json', './apple-touch-icon.png', './icon-192.png', './icon-512.png', './icon-32.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())
  );
});

// Fetch the live index.html past the browser's own 10-minute cache and store it
// if it differs from the saved copy. Resolves to the live text, or null offline.
async function refreshPage() {
  try {
    const response = await fetch(new Request('./index.html', { cache: 'no-cache' }));
    if (!response.ok) return null;
    const fresh = await response.clone().text();
    const cache = await caches.open(CACHE);
    const cached = await cache.match('./index.html');
    if (!cached || (await cached.text()) !== fresh) await cache.put('./index.html', response);
    return fresh;
  } catch (error) { return null; }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  const isPage = event.request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');

  if (isPage) {
    // The page: the saved copy straight away, with a background refresh so the
    // next open gets anything newer.
    event.respondWith((async () => {
      const cached = await (await caches.open(CACHE)).match('./index.html');
      if (cached) { event.waitUntil(refreshPage()); return cached; }
      const fresh = await refreshPage();
      if (fresh) return (await caches.open(CACHE)).match('./index.html');
      return new Response('Offline, and no saved copy yet. Open once with a connection.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })());
    return;
  }

  // Icons and the manifest: saved copy first, network if missing.
  event.respondWith(
    caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
      return response;
    }))
  );
});

// The page sends its APP_VERSION after loading; if the live file carries a
// different one, the page is told so it can offer a reload.
self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'check-version') return;
  event.waitUntil((async () => {
    const fresh = await refreshPage();
    const version = fresh && (fresh.match(/APP_VERSION = '([^']*)'/) || [])[1];
    if (version && version !== event.data.version && event.source) event.source.postMessage({ type: 'update-available', version });
  })());
});
