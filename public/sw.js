// v3: video-engine refactor changed the app shell + entry chunks. Old
// `video-to-pdf-*` caches are deleted on activate (see below), so existing
// installs pick up the new shell on next online visit. Bump this version
// (and only this line) whenever a release must invalidate the shell.
const CACHE_NAME = 'video-to-pdf-v3'
const APP_SHELL = ['/', '/index.html', '/icon.svg', '/manifest.json']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(APP_SHELL)
        // The initial page can load before the worker controls it. Precache
        // Vite's production entry assets too so that first offline reload works.
        const shell = await cache.match('/index.html')
        const html = await shell.text()
        const entryAssets = Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g), (match) => match[1])
        await cache.addAll(entryAssets)
      })
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  // Never cache uploaded content, external Markdown images, or Vite's dev modules.
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      (!APP_SHELL.includes(url.pathname) && !url.pathname.startsWith('/assets/'))) return

  // Network-first avoids serving an old app shell after a feature update.
  // Production chunks and bundled math fonts are cached as they are used.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    try {
      const response = await fetch(request)
      if (response.ok) {
        // Cache storage can be full or unavailable. A failed write must not
        // turn a valid network response into a failed script/font request.
        try {
          await cache.put(request, response.clone())
        } catch {
          // Keep serving the live app even when offline storage is unavailable.
        }
      }
      return response
    } catch (error) {
      // These are public, same-origin static files; Vite varies responses by
      // Origin, which differs between precache requests and module requests.
      const cached = await cache.match(request, { ignoreVary: true })
      if (cached) return cached
      throw error
    }
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter((key) => key.startsWith('video-to-pdf-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})
