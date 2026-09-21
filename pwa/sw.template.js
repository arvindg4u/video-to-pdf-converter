/*
 * PDF Lab service worker — SOURCE TEMPLATE.
 *
 * `vite build` replaces the BUILD placeholder below with the release inventory
 * (a content hash for every shipped file) and writes the result to dist/sw.js.
 * This template itself must never be served: without the inventory it has
 * nothing to precache.
 *
 * Design (see docs/PWA.md):
 *   - Precache the complete release at install time, verifying every file's
 *     SHA-256 hash. Any missing or mismatched file fails the install, so a
 *     partial or mixed release can never replace a working one.
 *   - Serve precached files cache-first and in-scope navigations from the
 *     precached app shell. Everything else (uploads, remote images, APIs,
 *     dev modules, unknown URLs) is left to the browser and never cached.
 *   - Never call skipWaiting(): a new release waits until every tab and app
 *     window of the previous one has closed. Pages are never reloaded by us.
 *   - Caches are named per scope + version; activation deletes only obsolete
 *     caches owned by this app and scope (plus the pre-2025 root caches).
 */
const BUILD = __PDF_LAB_BUILD__

const CACHE_PREFIX = 'pdf-lab'
const LEGACY_CACHE_PREFIX = 'video-to-pdf-'
const SCOPE_URL = new URL(self.registration.scope)
const SCOPE_PATH = SCOPE_URL.pathname
const OWNED_CACHE_PREFIX = `${CACHE_PREFIX}::${SCOPE_PATH}::`
const CACHE_NAME = `${OWNED_CACHE_PREFIX}${BUILD.version}`
const FETCH_CONCURRENCY = 6

/** Inventory URLs are relative to the worker script, i.e. to Vite's base. */
const PRECACHE = BUILD.precache.map((entry) => ({
  ...entry,
  url: new URL(entry.url, self.location.href).href,
}))
const PRECACHE_BY_URL = new Map(PRECACHE.map((entry) => [entry.url, entry]))
const SHELL_URL = new URL('index.html', self.location.href).href

self.addEventListener('install', (event) => {
  // No skipWaiting(): the previous release keeps serving its open clients.
  event.waitUntil(precacheRelease())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await deleteObsoleteCaches()
    // Take over uncontrolled pages (first install) so offline readiness can be
    // confirmed without a reload. Existing pages are never reloaded.
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  const key = url.origin + url.pathname

  if (request.mode === 'navigate') {
    if (!url.pathname.startsWith(SCOPE_PATH)) return
    if (PRECACHE_BY_URL.has(key)) {
      event.respondWith(servePrecached(key, request))
    } else if (!looksLikeFile(url.pathname)) {
      event.respondWith(serveShell(request))
    }
    return
  }

  // Only files that are part of this release are ever answered from cache.
  if (!PRECACHE_BY_URL.has(key)) return
  event.respondWith(servePrecached(key, request))
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'pdf-lab:status') {
    event.waitUntil(reply(event, statusReport()))
  } else if (data.type === 'pdf-lab:repair') {
    event.waitUntil(reply(event, repairCache()))
  }
})

/* ----------------------------- installation ----------------------------- */

async function precacheRelease() {
  let cache
  try {
    cache = await caches.open(CACHE_NAME)
  } catch (error) {
    throw new Error(`PDF Lab offline setup: cache storage is unavailable (${describe(error)})`)
  }
  try {
    await runWithConcurrency(PRECACHE, FETCH_CONCURRENCY, async (entry) => {
      const response = await fetchVerified(entry)
      await cache.put(entry.url, response)
    })
    const status = await inspectCache(cache)
    if (!status.complete) {
      throw new Error(`PDF Lab offline setup: ${status.missing} file(s) missing after precache`)
    }
  } catch (error) {
    // Leave no partial release behind; the previous release's cache is untouched.
    try { await caches.delete(CACHE_NAME) } catch { /* nothing more we can do */ }
    console.error('[pdf-lab-sw] install failed:', describe(error))
    throw error
  }
}

/**
 * Downloads one inventory file and verifies its SHA-256 hash. Hashed Vite
 * assets are immutable and may come from the HTTP cache; unhashed files
 * (index.html, manifest, icons) are revalidated so an outdated shell can never
 * be paired with a newer release's assets.
 */
async function fetchVerified(entry) {
  const request = new Request(entry.url, {
    cache: entry.immutable ? 'default' : 'no-cache',
    credentials: 'same-origin',
  })
  let response
  try {
    response = await fetch(request)
  } catch (error) {
    throw new Error(`could not download ${entry.url} (${describe(error)})`)
  }
  if (!response.ok) throw new Error(`could not download ${entry.url} (HTTP ${response.status})`)
  const body = await response.arrayBuffer()
  const digest = await sha256Hex(body)
  if (digest !== entry.hash) {
    throw new Error(`integrity mismatch for ${entry.url}: the served file does not belong to this release`)
  }
  return cleanResponse(response, body)
}

/**
 * Stores a plain copy of the verified bytes: hosts that redirect
 * /index.html → / would otherwise leave a "redirected" response, which
 * browsers refuse to use for navigations, and encoding/Vary headers no longer
 * describe the decoded body.
 */
function cleanResponse(response, body) {
  const headers = new Headers()
  for (const name of ['content-type', 'cache-control', 'etag', 'last-modified', 'date']) {
    const value = response.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(body, { status: 200, statusText: 'OK', headers })
}

async function runWithConcurrency(items, limit, task) {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await task(queue.shift())
  })
  await Promise.all(workers)
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/* ------------------------------ activation ------------------------------ */

async function deleteObsoleteCaches() {
  let keys
  try {
    keys = await caches.keys()
  } catch {
    return
  }
  await Promise.all(keys.filter(isObsoleteOwnedCache).map((key) => caches.delete(key).catch(() => false)))
}

function isObsoleteOwnedCache(name) {
  if (name === CACHE_NAME) return false
  if (name.startsWith(OWNED_CACHE_PREFIX)) return true
  // Caches created by the original root-scoped worker (video-to-pdf-v1…v3).
  return SCOPE_PATH === '/' && name.startsWith(LEGACY_CACHE_PREFIX)
}

/* -------------------------------- serving ------------------------------- */

async function servePrecached(key, request) {
  const entry = PRECACHE_BY_URL.get(key)
  try {
    const cache = await caches.open(CACHE_NAME)
    // Static public files: ignore Vary (dev/preview servers vary on Origin).
    const cached = await cache.match(key, { ignoreVary: true })
    if (cached) return cached
    // Evicted or never completed: heal the cache from a verified download.
    const response = await fetchVerified(entry)
    cache.put(key, response.clone()).catch(() => {})
    return response
  } catch {
    // Storage failure or integrity mismatch must not break online use.
    return fetch(request)
  }
}

async function serveShell(request) {
  try {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(SHELL_URL, { ignoreVary: true })
    if (cached) return cached
  } catch {
    // Fall through to the network.
  }
  return fetch(request)
}

function looksLikeFile(pathname) {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1)
  return /\.[a-z0-9]{1,8}$/i.test(last) && !/\.html?$/i.test(last)
}

/* ------------------------------- messaging ------------------------------ */

async function inspectCache(cache) {
  const keys = await cache.keys()
  const present = new Set(keys.map((request) => request.url))
  const missing = PRECACHE.filter((entry) => !present.has(entry.url)).length
  return { complete: missing === 0, missing, total: PRECACHE.length }
}

async function statusReport() {
  const base = { type: 'pdf-lab:status', version: BUILD.version, scope: SCOPE_URL.href }
  try {
    const cache = await caches.open(CACHE_NAME)
    return { ...base, ...(await inspectCache(cache)) }
  } catch (error) {
    return { ...base, complete: false, missing: PRECACHE.length, total: PRECACHE.length, error: describe(error) }
  }
}

async function repairCache() {
  try {
    const cache = await caches.open(CACHE_NAME)
    const before = await inspectCache(cache)
    if (before.complete) return { ...(await statusReport()), repaired: 0 }
    const keys = new Set((await cache.keys()).map((request) => request.url))
    const missing = PRECACHE.filter((entry) => !keys.has(entry.url))
    await runWithConcurrency(missing, FETCH_CONCURRENCY, async (entry) => {
      await cache.put(entry.url, await fetchVerified(entry))
    })
    return { ...(await statusReport()), repaired: missing.length }
  } catch (error) {
    return { ...(await statusReport()), repaired: 0, error: describe(error) }
  }
}

async function reply(event, promise) {
  const message = await promise
  const port = event.ports && event.ports[0]
  if (port) port.postMessage(message)
  else if (event.source && typeof event.source.postMessage === 'function') event.source.postMessage(message)
}

function describe(error) {
  return error && error.message ? error.message : String(error)
}
