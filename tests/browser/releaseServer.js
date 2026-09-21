/**
 * Tiny static server for browser tests that need REAL service-worker updates:
 * it serves the production `dist/` directory and lets a test swap which
 * worker script is returned for /sw.js between requests. Because the browser
 * fetches worker scripts through its own network stack (Playwright routing
 * cannot intercept them), a switchable origin is the honest way to exercise
 * the update lifecycle end to end.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.md': 'text/markdown; charset=utf-8',
}

export async function startReleaseServer({ distDir, workers, initial, extraFiles = {} }) {
  let current = initial
  const requests = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    let pathname = decodeURIComponent(url.pathname)
    requests.push(pathname)
    if (pathname === '/sw.js') {
      if (workers[current] == null) {
        // A release whose worker script is missing: the browser must fail registration.
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
        return
      }
      res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-cache' })
      res.end(workers[current])
      return
    }
    if (extraFiles[pathname]) {
      const { body, type } = extraFiles[pathname]
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
      res.end(body)
      return
    }
    if (pathname === '/') pathname = '/index.html'
    const file = path.join(distDir, pathname)
    if (!file.startsWith(distDir)) {
      res.writeHead(403).end()
      return
    }
    try {
      const info = await stat(file)
      if (!info.isFile()) throw new Error('not a file')
      const ext = path.extname(file)
      const immutable = pathname.startsWith('/assets/')
      res.writeHead(200, {
        'content-type': TYPES[ext] || 'application/octet-stream',
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      })
      res.end(await readFile(file))
    } catch {
      // Unknown, extension-less paths get the SPA shell (like a real static host).
      if (!path.extname(pathname)) {
        res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' })
        res.end(await readFile(path.join(distDir, 'index.html')))
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}/`,
    requests,
    get release() { return current },
    setRelease(name) {
      if (!(name in workers)) throw new Error(`unknown release ${name}`)
      current = name
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
