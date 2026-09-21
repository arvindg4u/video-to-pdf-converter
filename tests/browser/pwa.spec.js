import { test, expect } from '@playwright/test'

/**
 * NOTE: the install-prompt tests below dispatch SYNTHETIC `beforeinstallprompt`
 * / `appinstalled` events. They prove the app's handling of the browser API;
 * they are not an operating-system installation (headless Chromium never
 * fires the real event). Real-device steps live in docs/PWA.md.
 */

const READY = /^Offline ready$/

function dispatchInstallPrompt(page, { outcome = 'accepted', fail = false } = {}) {
  return page.evaluate(({ outcome, fail }) => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    window.__installPromptCalls = 0
    event.prompt = () => {
      window.__installPromptCalls++
      if (fail) return Promise.reject(new Error('The prompt() method must be called with a user gesture'))
      return Promise.resolve({ outcome, platform: 'web' })
    }
    event.userChoice = fail ? Promise.resolve({ outcome: 'dismissed' }) : Promise.resolve({ outcome, platform: 'web' })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }, { outcome, fail })
}

test.describe('install prompt (synthetic browser events)', () => {
  test.use({ serviceWorkers: 'allow' })

  test('Install PDF Lab appears only after beforeinstallprompt and drives the prompt from a click', async ({ page }) => {
    await page.goto('/')
    const button = page.getByRole('button', { name: 'Install PDF Lab' })
    await expect(button).toBeHidden()

    expect(await dispatchInstallPrompt(page, { outcome: 'accepted' })).toBe(true)
    await expect(button).toBeVisible()
    await button.focus()
    await page.keyboard.press('Enter')
    expect(await page.evaluate(() => window.__installPromptCalls)).toBe(1)
    await expect(button).toBeHidden()
    await expect(page.locator('.pwa-message')).toContainText('Installing PDF Lab')

    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
    await expect(page.locator('.pwa-message')).toContainText('PDF Lab is installed')
    await expect(button).toBeHidden()
  })

  test('dismissal and prompt errors are reported with manual help', async ({ page }) => {
    await page.goto('/')
    await dispatchInstallPrompt(page, { outcome: 'dismissed' })
    await page.getByRole('button', { name: 'Install PDF Lab' }).click()
    await expect(page.locator('.pwa-message')).toContainText('Installation dismissed')
    await expect(page.getByRole('button', { name: 'Install PDF Lab' })).toBeHidden()

    await dispatchInstallPrompt(page, { fail: true })
    await page.getByRole('button', { name: 'Install PDF Lab' }).click()
    await expect(page.locator('.pwa-message')).toContainText('could not be shown')
    // Manual instructions are one keyboard step away, behind the "i" button.
    await page.locator('.pwa-panel .tip-btn').focus()
    await page.keyboard.press('Enter')
    const tip = page.getByRole('dialog', { name: 'Offline use & installing' })
    await expect(tip).toContainText('Add to Home Screen')
    await expect(tip).toContainText('Chrome / Edge (desktop)')
    await expect(tip).toContainText('never saves your videos, Markdown notes')
    await page.keyboard.press('Escape')
    await expect(tip).toBeHidden()
    await expect(page.locator('.pwa-panel .tip-btn')).toBeFocused()
  })

  test('no install offer inside a standalone (installed) window', async ({ page }) => {
    // Headless Chromium cannot be launched as an installed app; emulate the
    // display-mode media query the way an installed window would report it.
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window)
      window.matchMedia = (query) => (query.includes('display-mode: standalone')
        ? { matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
        : original(query))
    })
    await page.goto('/')
    expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true)
    await dispatchInstallPrompt(page)
    await page.waitForTimeout(300)
    await expect(page.getByRole('button', { name: 'Install PDF Lab' })).toBeHidden()
  })
})

test.describe('registration failure', () => {
  // Playwright's block mode makes register() resolve without a registration.
  // (A real HTTP 404 for the worker script is covered in pwa-update.spec.js.)
  test.use({ serviceWorkers: 'block' })

  test('a blocked registration is reported truthfully and the converters keep working online', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.pwa-offline-text')).toHaveText('Offline unavailable', { timeout: 15_000 })
    await expect(page.locator('.pwa-panel')).toHaveAttribute('data-phase', 'failed')
    await expect(page.locator('.pwa-offline-text')).not.toHaveText(READY)
    // The truthful explanation lives in the info tip.
    await page.locator('.pwa-panel .tip-btn').click()
    await expect(page.getByRole('dialog', { name: 'Offline use & installing' })).toContainText('Offline setup failed')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Frame settings' })).toBeVisible()
    await page.getByLabel('Choose MP4 video files').setInputFiles([
      { name: 'still-works.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(1024, 1) },
    ])
    await expect(page.locator('.queue-item')).toHaveCount(1)
    await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
    await page.getByRole('button', { name: 'Try a sample' }).click()
    await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  })
})

test.describe('manifest and installability (Chromium)', () => {
  test.use({ serviceWorkers: 'allow' })

  test('Chromium parses the manifest without errors and reports no manifest-related installability problems', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.pwa-offline-text')).toHaveText(READY, { timeout: 60_000 })
    const cdp = await page.context().newCDPSession(page)
    const manifest = await cdp.send('Page.getAppManifest')
    expect(manifest.url).toMatch(/\/manifest\.json$/)
    expect(manifest.errors).toEqual([])
    const data = JSON.parse(manifest.data)
    expect(data.name).toBe('PDF Lab — Video & Markdown to PDF')
    expect(data.short_name).toBe('PDF Lab')
    expect(data.id).toBe('/')
    expect(data.icons.map((icon) => icon.purpose)).toEqual(['any', 'any', 'maskable'])

    // Chromium's own installability audit. Environment-specific findings
    // (e.g. headless "not from a secure origin" quirks) are logged; anything
    // about the manifest, icons, start_url, display or worker fails the test.
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
    const ids = installabilityErrors.map((error) => error.errorId)
    console.log('Chromium installability errors:', JSON.stringify(installabilityErrors))
    const manifestRelated = ids.filter((id) => /manifest|icon|start-url|start_url|display|scope|service-worker|no-matching|url-not-supported|name/i.test(id))
    expect(manifestRelated).toEqual([])

    // Every declared icon is actually served with the right size.
    for (const icon of data.icons) {
      const info = await page.evaluate(async (src) => {
        const response = await fetch(src)
        const blob = await response.blob()
        const bitmap = await createImageBitmap(blob)
        return { ok: response.ok, type: blob.type, width: bitmap.width, height: bitmap.height }
      }, icon.src)
      const [w, h] = icon.sizes.split('x').map(Number)
      expect(info).toEqual({ ok: true, type: 'image/png', width: w, height: h })
    }
  })
})

test.describe('mobile layout', () => {
  test.use({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } })

  test('the status strip, install button and expanded help never overflow horizontally at 390 px', async ({ page }) => {
    await page.goto('/')
    const noOverflow = () => page.evaluate(() => ({
      document: document.documentElement.scrollWidth <= window.innerWidth,
      panel: document.querySelector('.pwa-panel').scrollWidth <= document.querySelector('.pwa-panel').clientWidth,
    }))
    expect(await noOverflow()).toEqual({ document: true, panel: true })

    await dispatchInstallPrompt(page)
    await expect(page.getByRole('button', { name: 'Install PDF Lab' })).toBeVisible()
    expect(await noOverflow()).toEqual({ document: true, panel: true })

    await page.locator('.pwa-panel .tip-btn').click()
    const tip = page.getByRole('dialog', { name: 'Offline use & installing' })
    await expect(tip).toBeVisible()
    expect(await noOverflow()).toEqual({ document: true, panel: true })
    const help = await tip.boundingBox()
    expect(help.x).toBeGreaterThanOrEqual(0)
    expect(help.x + help.width).toBeLessThanOrEqual(390)
    await tip.getByRole('button', { name: 'Close' }).click()
    await expect(tip).toBeHidden()

    // The converter controls stay reachable below the strip.
    await expect(page.getByRole('button', { name: 'Video to PDF', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Try a sample' })).toBeVisible()
    expect(await noOverflow()).toEqual({ document: true, panel: true })
  })

  test('the panel is hidden from printed output', async ({ page }) => {
    await page.goto('/')
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.pwa-panel')).toBeHidden()
    await page.emulateMedia({ media: 'screen' })
    await expect(page.locator('.pwa-panel')).toBeVisible()
  })
})
