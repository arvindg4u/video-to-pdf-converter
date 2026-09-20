import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'allow' })

test('production Markdown assets and previously used math fonts survive an offline reload', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
  await page.getByRole('button', { name: 'Try a sample' }).click()
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  await page.frames().find((frame) => frame.parentFrame()).evaluate(() => document.fonts.ready)

  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
  await page.getByRole('button', { name: 'Try a sample' }).click()
  await expect(page.frameLocator('iframe').locator('.katex-display')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  const fonts = await page.frames().find((frame) => frame.parentFrame()).evaluate(async () => {
    await document.fonts.ready
    return Array.from(document.fonts).filter((font) => font.status === 'loaded').map((font) => font.family)
  })
  expect(fonts).toContain('KaTeX_Main')
  expect(fonts).toContain('KaTeX_Math')
})
