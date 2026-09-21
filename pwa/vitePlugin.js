/**
 * Vite plugin: makes every production build (including a plain `vite build`)
 * ship a working PWA:
 *
 *   1. dist/manifest.json gets a stable `id` matching the configured base.
 *   2. dist/sw.js is generated from pwa/sw.template.js with a deterministic,
 *      content-hashed inventory of EVERY file in dist (HTML, JS/CSS chunks,
 *      lazy Markdown modules, KaTeX fonts, manifest, icons).
 *
 * The template is not part of public/, so an unprocessed worker can never be
 * deployed by accident.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPrecacheInventory,
  finalizeManifest,
  normalizeBasePath,
  renderServiceWorker,
  SERVICE_WORKER_FILE,
} from './precache.js'

const here = path.dirname(fileURLToPath(import.meta.url))
export const TEMPLATE_PATH = path.join(here, 'sw.template.js')

export function pdfLabPwa(options = {}) {
  const manifestFile = options.manifestFile || 'manifest.json'
  let config

  return {
    name: 'pdf-lab-pwa',
    apply: 'build',
    enforce: 'post',
    configResolved(resolved) {
      config = resolved
    },
    closeBundle() {
      if (!config || config.build.ssr || config.build.write === false) return
      const outDir = path.resolve(config.root, config.build.outDir)
      const base = config.base
      const log = config.logger

      if (!normalizeBasePath(base) && base !== './' && base !== '') {
        log.warn(`[pdf-lab-pwa] base "${base}" is not a same-origin path; service workers and manifests need one.`)
      }

      // 1. Manifest identity.
      const manifestPath = path.join(outDir, manifestFile)
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const finalManifest = finalizeManifest(manifest, base)
      writeFileSync(manifestPath, `${JSON.stringify(finalManifest, null, 2)}\n`)

      // 2. Precache inventory + worker (after the manifest so its hash is final).
      const inventory = createPrecacheInventory(outDir)
      const template = readFileSync(TEMPLATE_PATH, 'utf8')
      writeFileSync(path.join(outDir, SERVICE_WORKER_FILE), renderServiceWorker(template, inventory))

      const bytes = inventory.entries.reduce((sum, entry) => sum + entry.size, 0)
      log.info(`[pdf-lab-pwa] ${SERVICE_WORKER_FILE}: release ${inventory.version}, ${inventory.entries.length} files precached (${(bytes / 1024).toFixed(0)} kB), id ${finalManifest.id || '(start_url)'}`)
    },
  }
}
