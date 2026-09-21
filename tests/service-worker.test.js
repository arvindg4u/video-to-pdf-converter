import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { renderServiceWorker, sha256 } from '../pwa/precache.js'
import { TEMPLATE_PATH } from '../pwa/vitePlugin.js'

const template = readFileSync(TEMPLATE_PATH, 'utf8')

/** Files of a pretend release, keyed by path relative to the worker. */
const RELEASE = {
  'index.html': '<!doctype html><script type="module" src="/assets/index-AbCdEf12.js"></script>',
  'assets/index-AbCdEf12.js': 'console.log("shell")',
  'assets/MarkdownConverter-Zy9xWv87.js': 'export const markdown = true',
  'assets/KaTeX_Main-Regular-B22Nviop.woff2': 'wOF2 font bytes',
  'manifest.json': '{"name":"PDF Lab"}',
  'icons/icon-192.png': 'PNG bytes',
}

function inventoryFor(files, version = 'v1release0000000') {
  return {
    version,
    entries: Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)).map(([url, body]) => ({
      url,
      hash: sha256(Buffer.from(body)),
      size: body.length,
      immutable: /^assets\/.+-[A-Za-z0-9_-]{8}\./.test(url),
    })),
  }
}

/** In-memory Cache API good enough for the worker's usage. */
function memoryCache(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    async put(request, response) { store.set(typeof request === 'string' ? request : request.url, response) },
    async match(request, options = {}) {
      const url = typeof request === 'string' ? request : request.url
      const hit = store.get(url)
      if (hit) hit.matchOptions = options
      return hit ? hit.clone() : undefined
    },
    async keys() { return Array.from(store.keys(), (url) => new Request(url)) },
  }
}

function harness({
  files = RELEASE,
  served = files,
  version,
  origin = 'https://pdf.test',
  scopePath = '/',
  caches: cacheNames = [],
  openError = null,
  putError = null,
  existing = {},
} = {}) {
  const inventory = inventoryFor(files, version)
  const source = renderServiceWorker(template, inventory)
  const handlers = {}
  const cache = memoryCache(existing)
  if (putError) cache.put = async () => { throw putError }
  const deleted = []
  const fetched = []
  const skipWaitingCalls = []
  let claimed = 0

  const context = {
    URL, Map, Set, Headers, Request, Response, MessageChannel, console: { ...console, error() {} }, crypto: globalThis.crypto, Promise, Array, Uint8Array, Error, String, Math, Object, JSON, TypeError,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input.url || input)
      fetched.push({ url: request.url, cache: request.cache })
      const url = new URL(request.url)
      const relative = decodeURIComponent(url.pathname.slice(scopePath.length))
      if (!(relative in served)) return new Response('missing', { status: 404 })
      return new Response(served[relative], { status: 200, headers: { 'content-type': 'text/plain', vary: 'Origin', 'content-encoding': 'identity' } })
    },
    caches: {
      open: async (name) => { if (openError) throw openError; cache.name = name; return cache },
      keys: async () => cacheNames,
      delete: async (name) => { deleted.push(name); return true },
    },
  }
  context.self = {
    registration: { scope: `${origin}${scopePath}` },
    location: new URL(`${origin}${scopePath}sw.js`),
    addEventListener: (name, callback) => { handlers[name] = callback },
    skipWaiting: async () => { skipWaitingCalls.push(true) },
    clients: { claim: async () => { claimed++ } },
  }
  vm.runInNewContext(source, context)

  const dispatch = (name, properties = {}) => {
    let pending
    const event = {
      ...properties,
      waitUntil: (promise) => { pending = promise },
      respondWith: (promise) => { pending = promise },
    }
    handlers[name](event)
    return pending
  }
  return { dispatch, cache, deleted, fetched, skipWaitingCalls, claimed: () => claimed, inventory, origin, scopePath }
}

const abs = (path, origin = 'https://pdf.test') => `${origin}/${path}`
/** Node's Request constructor rejects mode "navigate"; the worker only reads these fields. */
const navigation = (url) => ({ method: 'GET', url, mode: 'navigate', headers: new Headers() })
const plain = (value) => JSON.parse(JSON.stringify(value))

test('installation precaches every file of the release after verifying its hash — and never skips waiting', async () => {
  const sw = harness()
  await sw.dispatch('install')
  assert.deepEqual(Array.from(sw.cache.store.keys()).sort(), Object.keys(RELEASE).map((file) => abs(file)).sort())
  assert.equal(sw.cache.name, 'pdf-lab::/::v1release0000000')
  assert.equal(sw.skipWaitingCalls.length, 0, 'skipWaiting must never be called')
  const stored = await sw.cache.match(abs('index.html'))
  assert.equal(await stored.text(), RELEASE['index.html'])
  assert.equal(stored.headers.get('vary'), null, 'stored copies drop Vary/encoding headers')
  assert.equal(stored.headers.get('content-encoding'), null)
  assert.equal(stored.headers.get('content-type'), 'text/plain')
  // Unhashed files are revalidated; hashed assets may use the HTTP cache.
  assert.equal(sw.fetched.find((f) => f.url.endsWith('/index.html')).cache, 'no-cache')
  assert.equal(sw.fetched.find((f) => f.url.endsWith('/manifest.json')).cache, 'no-cache')
  assert.equal(sw.fetched.find((f) => f.url.includes('/assets/index-')).cache, 'default')
})

test('installation fails safely when a required file is missing, and removes the partial cache', async () => {
  const served = { ...RELEASE }
  delete served['assets/KaTeX_Main-Regular-B22Nviop.woff2']
  const sw = harness({ served })
  await assert.rejects(sw.dispatch('install'), /could not download .*KaTeX_Main-Regular.*HTTP 404/)
  assert.deepEqual(sw.deleted, ['pdf-lab::/::v1release0000000'], 'only its own partial cache is deleted')
})

test('installation fails when a served file does not belong to this release (old shell + new assets)', async () => {
  const served = { ...RELEASE, 'index.html': '<!doctype html><script src="/assets/index-OLDOLD11.js"></script>' }
  const sw = harness({ served })
  await assert.rejects(sw.dispatch('install'), /integrity mismatch for .*index\.html/)
  assert.deepEqual(sw.deleted, ['pdf-lab::/::v1release0000000'])
})

test('installation fails when cache storage is unavailable or writes fail', async () => {
  const unavailable = harness({ openError: new Error('SecurityError: storage disabled') })
  await assert.rejects(unavailable.dispatch('install'), /cache storage is unavailable/)
  assert.deepEqual(unavailable.deleted, [], 'nothing to clean up when the cache never opened')

  const quota = harness({ putError: new Error('QuotaExceededError') })
  await assert.rejects(quota.dispatch('install'), /QuotaExceededError/)
  assert.deepEqual(quota.deleted, ['pdf-lab::/::v1release0000000'])
})

test('fetch handler ignores non-GET, cross-origin, API, dev-module, upload and unknown requests', () => {
  const sw = harness()
  const untouched = [
    new Request(abs('assets/index-AbCdEf12.js'), { method: 'POST' }),
    new Request('https://images.example/photo.png'),
    new Request('https://cdn.example/assets/index-AbCdEf12.js'),
    new Request(abs('api/convert')),
    new Request(abs('src/App.jsx')),
    new Request(abs('@vite/client')),
    new Request(abs('node_modules/.vite/deps/react.js')),
    new Request(abs('uploads/holiday.mp4')),
    new Request(abs('assets/not-in-this-release-Qq1Ww2Ee.js')),
    new Request(abs('notes.md')),
  ]
  for (const request of untouched) {
    assert.equal(sw.dispatch('fetch', { request }), undefined, `${request.method} ${request.url} passes through`)
  }
  assert.deepEqual(sw.fetched, [], 'no network calls were made by the worker')
})

test('precached files are served cache-first, ignoring Vary', async () => {
  const sw = harness()
  await sw.dispatch('install')
  sw.fetched.length = 0
  const response = await sw.dispatch('fetch', { request: new Request(abs('assets/KaTeX_Main-Regular-B22Nviop.woff2')) })
  assert.equal(await response.text(), RELEASE['assets/KaTeX_Main-Regular-B22Nviop.woff2'])
  assert.equal(sw.cache.store.get(abs('assets/KaTeX_Main-Regular-B22Nviop.woff2')).matchOptions.ignoreVary, true)
  assert.deepEqual(sw.fetched, [], 'served from cache, no network')
})

test('in-scope navigations get the precached app shell; file-like navigations are not hijacked', async () => {
  const sw = harness()
  await sw.dispatch('install')
  for (const url of [abs(''), abs('?mode=markdown'), abs('deep/link'), abs('index.html')]) {
    const response = await sw.dispatch('fetch', { request: navigation(url) })
    assert.equal(await response.text(), RELEASE['index.html'], `${url} → shell`)
  }
  const manifestNav = await sw.dispatch('fetch', { request: navigation(abs('manifest.json')) })
  assert.equal(await manifestNav.text(), RELEASE['manifest.json'], 'a precached file opened directly is served as itself')
  assert.equal(sw.dispatch('fetch', { request: navigation(abs('sw.js')) }), undefined)
  assert.equal(sw.dispatch('fetch', { request: navigation(abs('robots.txt')) }), undefined)
  assert.equal(sw.dispatch('fetch', { request: navigation('https://other.test/') }), undefined)
})

test('a file evicted from the cache is healed from a verified download; storage failures fall back to the network', async () => {
  const sw = harness({ existing: {} })
  const response = await sw.dispatch('fetch', { request: new Request(abs('assets/MarkdownConverter-Zy9xWv87.js')) })
  assert.equal(await response.text(), RELEASE['assets/MarkdownConverter-Zy9xWv87.js'])
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(sw.cache.store.has(abs('assets/MarkdownConverter-Zy9xWv87.js')), 'healed into the cache')

  const broken = harness({ openError: new Error('storage gone') })
  const fallback = await broken.dispatch('fetch', { request: new Request(abs('assets/index-AbCdEf12.js')) })
  assert.equal(await fallback.text(), RELEASE['assets/index-AbCdEf12.js'])
})

test('tampered network content is never written to the cache', async () => {
  const sw = harness({ served: { ...RELEASE, 'icons/icon-192.png': 'injected bytes' } })
  const response = await sw.dispatch('fetch', { request: new Request(abs('icons/icon-192.png')) })
  assert.equal(await response.text(), 'injected bytes', 'online use still works')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(sw.cache.store.size, 0)
})

test('activation deletes only obsolete caches owned by this app and scope, then claims clients', async () => {
  const sw = harness({
    caches: [
      'pdf-lab::/::v1release0000000', // current
      'pdf-lab::/::older00000000000', // previous release, same scope → delete
      'pdf-lab::/staging/::abc0000000000000', // another deployment on this origin → keep
      'video-to-pdf-v3', // legacy root worker → delete
      'video-to-pdf-v1',
      'another-app-cache', // not ours → keep
      'workbox-precache-v2', // not ours → keep
    ],
  })
  await sw.dispatch('activate')
  assert.deepEqual(sw.deleted.sort(), ['pdf-lab::/::older00000000000', 'video-to-pdf-v1', 'video-to-pdf-v3'])
  assert.equal(sw.claimed(), 1)

  const nested = harness({ scopePath: '/lab/', caches: ['pdf-lab::/lab/::old0000000000000', 'pdf-lab::/::v1release0000000', 'video-to-pdf-v3'] })
  await nested.dispatch('activate')
  assert.deepEqual(nested.deleted, ['pdf-lab::/lab/::old0000000000000'], 'a nested deployment leaves root caches alone')
})

function messageEvent(data) {
  const replies = []
  return { event: { data, ports: [{ postMessage: (message) => replies.push(message) }] }, replies }
}

test('status messages report the release version and whether the cache is complete', async () => {
  const sw = harness()
  const { event: before, replies: earlyReplies } = messageEvent({ type: 'pdf-lab:status' })
  await sw.dispatch('message', before)
  assert.equal(earlyReplies[0].complete, false)
  assert.equal(earlyReplies[0].missing, Object.keys(RELEASE).length)

  await sw.dispatch('install')
  const { event, replies } = messageEvent({ type: 'pdf-lab:status' })
  await sw.dispatch('message', event)
  assert.deepEqual(plain(replies[0]), { type: 'pdf-lab:status', version: 'v1release0000000', scope: 'https://pdf.test/', complete: true, missing: 0, total: Object.keys(RELEASE).length })

  sw.cache.store.delete(abs('assets/MarkdownConverter-Zy9xWv87.js'))
  const { event: after, replies: afterReplies } = messageEvent({ type: 'pdf-lab:status' })
  await sw.dispatch('message', after)
  assert.equal(afterReplies[0].complete, false)
  assert.equal(afterReplies[0].missing, 1)

  const { event: repair, replies: repairReplies } = messageEvent({ type: 'pdf-lab:repair' })
  await sw.dispatch('message', repair)
  assert.equal(repairReplies[0].complete, true)
  assert.equal(repairReplies[0].repaired, 1)

  assert.equal(sw.dispatch('message', { data: { type: 'unrelated' }, ports: [] }), undefined)
  assert.equal(sw.dispatch('message', { data: 'string payload', ports: [] }), undefined)
})

test('status reports incomplete (never ready) when storage is unavailable', async () => {
  const sw = harness({ openError: new Error('storage disabled') })
  const { event, replies } = messageEvent({ type: 'pdf-lab:status' })
  await sw.dispatch('message', event)
  assert.equal(replies[0].complete, false)
  assert.match(replies[0].error, /storage disabled/)
})
