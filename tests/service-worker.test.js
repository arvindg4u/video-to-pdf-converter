import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

function worker({ cache, fetch, keys = [], onDelete = () => {} }) {
  const handlers = {}
  const context = {
    URL,
    console,
    fetch,
    caches: {
      open: async () => cache,
      keys: async () => keys,
      delete: async (key) => { onDelete(key); return true },
    },
    self: {
      location: { origin: 'https://pdf.test' },
      addEventListener: (name, callback) => { handlers[name] = callback },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
  }
  vm.runInNewContext(source, context)
  return (name, properties = {}) => {
    let response
    handlers[name]({
      ...properties,
      waitUntil: (promise) => { response = promise },
      respondWith: (promise) => { response = promise },
    })
    return response
  }
}

const assetRequest = () => new Request('https://pdf.test/assets/app.js')

test('cache-write failures do not discard a successful network response', async () => {
  const emit = worker({
    fetch: async () => new Response('fresh asset'),
    cache: { put: async () => { throw new Error('Quota exceeded') }, match: async () => undefined },
  })
  const response = await emit('fetch', { request: assetRequest() })
  assert.equal(await response.text(), 'fresh asset')
})

test('offline static requests fall back to cached content, ignoring Vite Origin variance', async () => {
  let options
  const emit = worker({
    fetch: async () => { throw new Error('Offline') },
    cache: { match: async (_, matchOptions) => { options = matchOptions; return new Response('cached asset') } },
  })
  const response = await emit('fetch', { request: assetRequest() })
  assert.equal(await response.text(), 'cached asset')
  assert.equal(options.ignoreVary, true)
})

test('does not intercept remote images, dev source, or non-GET requests', () => {
  const emit = worker({ fetch: () => assert.fail('Should not fetch'), cache: {} })
  for (const request of [
    new Request('https://images.test/photo.png'),
    new Request('https://pdf.test/src/App.jsx'),
    new Request('https://pdf.test/assets/app.js', { method: 'POST' }),
  ]) assert.equal(emit('fetch', { request }), undefined)
})

test('installation precaches the shell and production entry assets', async () => {
  const batches = []
  const emit = worker({
    cache: {
      addAll: async (urls) => { batches.push(Array.from(urls)) },
      match: async () => new Response('<script src="/assets/app.js"></script><link href="/assets/app.css"><link href="https://other.test/style.css">'),
    },
  })
  await emit('install')
  assert.deepEqual(batches, [['/', '/index.html', '/icon.svg', '/manifest.json'], ['/assets/app.js', '/assets/app.css']])
})

test('activation removes only obsolete caches owned by this app', async () => {
  const deleted = []
  const emit = worker({ keys: ['video-to-pdf-v1', 'video-to-pdf-v2', 'another-app'], onDelete: (key) => deleted.push(key) })
  await emit('activate')
  assert.deepEqual(deleted, ['video-to-pdf-v1'])
})
