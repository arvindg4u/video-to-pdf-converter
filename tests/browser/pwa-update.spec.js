/**
 * Real service-worker lifecycle tests against the production build.
 *
 * These do not use Playwright's route mocking: browsers fetch worker scripts
 * through their own network stack, so each test starts a tiny static server
 * (tests/browser/releaseServer.js) that serves dist/ and can switch which
 * release is published at /sw.js. Everything the browser does here — install,
 * waiting, activation, cache cleanup — is the genuine Chromium behaviour.
 */
import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createPrecacheInventory, inventoryVersion, renderServiceWorker, sha256 } from '../../pwa/precache.js'
import { TEMPLATE_PATH } from '../../pwa/vitePlugin.js'
import { startReleaseServer } from './releaseServer.js'

test.use({ serviceWorkers: 'allow' })

const DIST = path.resolve('dist')
const READY = /Works offline · release ([0-9a-f]{8})/

async function buildReleases() {
  const template = await readFile(TEMPLATE_PATH, 'utf8')
  const current = createPrecacheInventory(DIST)

  // Release B: the same app plus one new hashed asset (a realistic next deploy).
  const markerBody = Buffer.from('export const release = "B"\n')
  const markerUrl = 'assets/release-marker-b1b2c3d4.js'
  const nextEntries = [...current.entries, { url: markerUrl, hash: sha256(markerBody), size: markerBody.length, immutable: true }]
    .sort((a, b) => (a.url < b.url ? -1 : 1))
  const next = { version: inventoryVersion(nextEntries), entries: nextEntries }

  // Release C: claims a file the server never publishes (a broken/partial deploy).
  const brokenEntries = [...current.entries, { url: 'assets/missing-deadbeef.js', hash: sha256(Buffer.from('x')), size: 1, immutable: true }]
  const broken = { version: inventoryVersion(brokenEntries), entries: brokenEntries }

  return {
    versions: { A: current.version, B: next.version, C: broken.version },
    workers: {
      A: renderServiceWorker(template, current),
      B: renderServiceWorker(template, next),
      C: renderServiceWorker(template, broken),
      missing: null,
    },
    extraFiles: { [`/${markerUrl}`]: { body: markerBody, type: 'text/javascript; charset=utf-8' } },
  }
}

async function waitForReady(page, url, version) {
  await page.goto(url)
  await expect(page.locator('.pwa-offline-text')).toHaveText(READY, { timeout: 60_000 })
  await expect(page.locator('.pwa-offline-text')).toContainText(`release ${version.slice(0, 8)}`)
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
}

const registrationState = (page) => page.evaluate(async () => {
  const registration = await navigator.serviceWorker.getRegistration()
  return {
    waiting: Boolean(registration?.waiting),
    installing: Boolean(registration?.installing),
    active: registration?.active?.state ?? null,
    caches: (await caches.keys()).sort(),
  }
})

test.describe('real worker updates (Chromium, production build)', () => {
  let releases
  test.beforeAll(async () => {
    releases = await buildReleases()
  })

  test('a new release waits until every PDF Lab tab is closed; unsaved notes survive', async ({ context }) => {
    const server = await startReleaseServer({ distDir: DIST, workers: releases.workers, initial: 'A', extraFiles: releases.extraFiles })
    try {
      const { A, B } = releases.versions
      const cacheA = `pdf-lab::/::${A}`
      const cacheB = `pdf-lab::/::${B}`

      // Tab 1: release A, with unsaved Markdown notes.
      const tab1 = await context.newPage()
      await waitForReady(tab1, server.url, A)
      await tab1.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
      const editor = tab1.locator('#markdown-source')
      await editor.fill('# Unsaved notes\n\nDo not lose me. $E = mc^2$')
      await tab1.evaluate(() => { window.__pdfLabTabMarker = 'still-the-same-document' })
      expect((await registrationState(tab1)).caches).toEqual([cacheA])

      // A new release is deployed while the app is open.
      server.setRelease('B')

      // Tab 2 opens: its startup update check discovers release B.
      const tab2 = await context.newPage()
      await waitForReady(tab2, server.url, A) // still served by A: B must not take over
      const notice2 = tab2.locator('.pwa-update')
      await expect(notice2).toBeVisible({ timeout: 60_000 })
      await expect(notice2).toContainText(/close all PDF Lab tabs/i)
      await expect(notice2).toContainText(/save or export/i)

      // Tab 1 learned about it too, without reloading and without losing anything.
      await expect(tab1.locator('.pwa-update')).toBeVisible({ timeout: 30_000 })
      expect(await tab1.evaluate(() => window.__pdfLabTabMarker)).toBe('still-the-same-document')
      await expect(editor).toHaveValue(/Do not lose me/)
      await expect(tab1.locator('.pwa-offline-text')).toContainText(`release ${A.slice(0, 8)}`)

      let state = await registrationState(tab1)
      expect(state.waiting).toBe(true)
      expect(state.active).toBe('activated')
      // B installed its complete cache next to A's; A's cache is untouched.
      expect(state.caches).toEqual([cacheA, cacheB].sort())
      expect(server.requests).toContain('/assets/release-marker-b1b2c3d4.js')

      // Closing ONE tab is not enough: the old worker still has a client.
      await tab2.close()
      await tab1.waitForTimeout(1500)
      state = await registrationState(tab1)
      expect(state.waiting).toBe(true)
      expect(await tab1.evaluate(() => window.__pdfLabTabMarker)).toBe('still-the-same-document')
      await expect(editor).toHaveValue(/Do not lose me/)
      await expect(tab1.locator('.pwa-offline-text')).toContainText(`release ${A.slice(0, 8)}`)

      // Closing the last tab lets B activate and clean up A's cache.
      await tab1.close()
      await expect.poll(async () => {
        for (const worker of context.serviceWorkers()) {
          try {
            const keys = await worker.evaluate(async () => (await caches.keys()).sort())
            if (keys.length === 1 && keys[0] === cacheB) return 'activated'
          } catch {
            // A terminated worker cannot be evaluated; keep polling the others.
          }
        }
        return 'waiting'
      }, { timeout: 30_000, message: 'release B never activated after the last tab closed' }).toBe('activated')

      const tab3 = await context.newPage()
      await waitForReady(tab3, server.url, B)
      state = await registrationState(tab3)
      expect(state.waiting).toBe(false)
      expect(state.caches).toEqual([cacheB])
      await expect(tab3.locator('.pwa-update')).toHaveCount(0)
      await tab3.close()
    } finally {
      await server.close()
    }
  })

  test('a release with a missing file is discarded and the working release stays in place', async ({ context }) => {
    const server = await startReleaseServer({ distDir: DIST, workers: releases.workers, initial: 'A' })
    try {
      const { A, C } = releases.versions
      const tab1 = await context.newPage()
      await waitForReady(tab1, server.url, A)

      server.setRelease('C')
      const tab2 = await context.newPage()
      await waitForReady(tab2, server.url, A)

      // The broken worker's install fails (404 during precache) and it becomes redundant.
      await expect(tab2.locator('.pwa-message')).toContainText(/newer version could not be downloaded/i, { timeout: 60_000 })
      await expect(tab2.locator('.pwa-update')).toHaveCount(0)
      await expect(tab2.locator('.pwa-offline-text')).toContainText(`release ${A.slice(0, 8)}`)
      expect(server.requests).toContain('/assets/missing-deadbeef.js')

      const state = await registrationState(tab2)
      expect(state.waiting).toBe(false)
      expect(state.installing).toBe(false)
      expect(state.active).toBe('activated')
      expect(state.caches).toEqual([`pdf-lab::/::${A}`]) // no partial C cache left behind
      expect(state.caches.some((name) => name.includes(C))).toBe(false)

      // Still fully usable offline on release A.
      await context.setOffline(true)
      await tab2.reload()
      await expect(tab2.getByRole('heading', { name: 'Frame Controller' })).toBeVisible()
      await expect(tab2.locator('.pwa-connectivity')).toHaveText('Offline')
      await context.setOffline(false)
      await tab1.close()
      await tab2.close()
    } finally {
      await server.close()
    }
  })

  test('a real HTTP 404 for the worker script is reported as a failed setup while the app keeps working', async ({ context }) => {
    const server = await startReleaseServer({ distDir: DIST, workers: releases.workers, initial: 'missing' })
    try {
      const page = await context.newPage()
      await page.goto(server.url)
      await expect(page.locator('.pwa-offline-text')).toHaveText(/Offline setup failed/, { timeout: 30_000 })
      await expect(page.locator('.pwa-connectivity')).toHaveText('Online')
      expect(server.requests).toContain('/sw.js')
      expect(await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()))).toBe(false)

      // Both converters remain usable online.
      await expect(page.getByRole('heading', { name: 'Frame Controller' })).toBeVisible()
      await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
      await page.getByRole('button', { name: 'Try a sample' }).click()
      const preview = page.frameLocator('iframe[title="Study notes preview"]')
      await expect(preview.locator('.katex-display').first()).toBeVisible()
      await page.close()
    } finally {
      await server.close()
    }
  })
})
