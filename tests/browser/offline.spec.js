import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'allow' })

const READY = /^Offline ready$/

/** Waits until the app itself confirms that the active worker holds the complete release. */
async function waitForOfflineReady(page) {
  await page.goto('/')
  await expect(page.locator('.pwa-offline-text')).toHaveText(READY, { timeout: 60_000 })
  await expect(page.locator('.pwa-connectivity')).toHaveText('Online')
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
}

test('critical: Markdown opened for the FIRST time offline renders the sample with bundled math fonts', async ({ page, context }) => {
  // Online: only the video workspace is visited. Markdown is never opened.
  await waitForOfflineReady(page)
  await expect(page.getByRole('heading', { name: 'Frame settings' })).toBeVisible()
  expect(await page.locator('.markdown-workspace').count()).toBe(0)

  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.pwa-connectivity')).toHaveText('Offline')
  await expect(page.locator('.pwa-offline-text')).toHaveText(READY)

  // First ever use of the lazy-loaded Markdown module, while offline.
  await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
  await page.getByRole('button', { name: 'Try a sample' }).click()
  const preview = page.frameLocator('iframe[title="Study notes preview"]')
  await expect(preview.locator('.katex-display').first()).toBeVisible()
  await expect(preview.getByRole('heading', { name: 'Learning & memory', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()

  const fonts = await page.frames().find((frame) => frame.parentFrame()).evaluate(async () => {
    await document.fonts.ready
    // Touch every KaTeX family the sample uses so lazy font loads are forced.
    const loaded = Array.from(document.fonts).filter((font) => font.status === 'loaded').map((font) => font.family)
    const failed = Array.from(document.fonts).filter((font) => font.status === 'error').map((font) => font.family)
    return { loaded, failed }
  })
  expect(fonts.failed).toEqual([])
  expect(fonts.loaded).toContain('KaTeX_Main')
  expect(fonts.loaded).toContain('KaTeX_Math')
})

test('video workspace loads offline and still queues local files', async ({ page, context }) => {
  await waitForOfflineReady(page)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Frame settings' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate PDF', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Browse Files' })).toBeVisible()
  await page.getByLabel('Choose MP4 video files').setInputFiles([
    { name: 'offline.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 7) },
  ])
  await expect(page.locator('.queue-item')).toHaveCount(1)
  await expect(page.locator('.pwa-connectivity')).toHaveText('Offline')
  // Brand icon and manifest come from the precache too.
  expect(await page.evaluate(async () => (await fetch('/manifest.json')).ok)).toBe(true)
  expect(await page.evaluate(() => document.querySelector('.brand-icon').naturalWidth)).toBe(192)
})

test('the worker never caches uploads, remote images or unknown URLs', async ({ page }) => {
  await waitForOfflineReady(page)
  const keys = await page.evaluate(async () => {
    await fetch('/api/anything', { method: 'POST', body: 'x' }).catch(() => {})
    await fetch('/uploads/video.mp4').catch(() => {})
    await fetch('/not-part-of-the-release.txt').catch(() => {})
    const names = await caches.keys()
    const cache = await caches.open(names.find((name) => name.startsWith('pdf-lab::')))
    return (await cache.keys()).map((request) => new URL(request.url).pathname)
  })
  expect(keys.some((key) => key.includes('/api/') || key.includes('/uploads/') || key.includes('not-part-of'))).toBe(false)
  expect(keys).toContain('/index.html')
  expect(keys).toContain('/manifest.json')
  expect(keys.some((key) => /^\/assets\/MarkdownConverter-.*\.js$/.test(key))).toBe(true)
  expect(keys.some((key) => /^\/assets\/KaTeX_Main-Regular-.*\.woff2$/.test(key))).toBe(true)
})
