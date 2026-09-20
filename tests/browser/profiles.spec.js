import { test, expect } from '@playwright/test'
import { longStudyNotes } from '../fixtures/long-study-notes.js'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const source = longStudyNotes(3) + '\n[[#Fundamental Rights|Review rights]] #RAS/prelims\n\n> [!NOTE]- More detail\n> Hindi + English — 123 ± ₹\n\n```js\nconst recall = true;\n```\n\n![[pixel.png]]'

async function openNotes(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
  const name = `Complete_Notes_${'Chapter_'.repeat(20)}.md`
  await page.getByLabel('Upload Markdown file').setInputFiles({ name, mimeType: 'text/markdown', buffer: Buffer.from(source) })
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  await page.getByLabel('Add image files', { exact: true }).setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.getByRole('button', { name: 'Export preview PDF', exact: true })).toBeEnabled()
  return page.frameLocator('iframe[title="Study notes preview"]')
}

for (const width of [600, 720, 840, 960, 1280]) {
  test.describe(`output profiles at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 1280 })
    test('preserve notes, reflow without overflow, and support touch/keyboard/export', async ({ page }, testInfo) => {
      const preview = await openNotes(page)
      await expect(page.getByRole('radio', { name: 'Study', exact: true })).toBeChecked()
      await expect(page.locator('.md-file-name')).toContainText('Complete_Notes_Chapter_')
      const studyMain = await preview.locator('main').innerHTML()
      const studyToc = await preview.locator('.notes-toc').innerHTML()
      let studyHeight
      for (const mode of ['Study', 'Revision']) {
        await page.getByRole('radio', { name: mode, exact: true }).check()
        await expect(preview.locator('body')).toHaveClass(`${mode.toLowerCase()}-mode`)
        await expect(page.getByRole('button', { name: 'Export preview PDF', exact: true })).toBeEnabled()
        await expect(page.getByLabel('Edit Markdown')).toHaveValue(source)
        expect(await preview.locator('main').innerHTML()).toBe(studyMain)
        expect(await preview.locator('.notes-toc').innerHTML()).toBe(studyToc)
        const metrics = await preview.locator('body').evaluate((body) => ({
          font: parseFloat(getComputedStyle(body).fontSize),
          line: parseFloat(getComputedStyle(body).lineHeight),
          width: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
          height: document.querySelector('main').getBoundingClientRect().height,
        }))
        expect(metrics.font).toBeCloseTo(mode === 'Study' ? 11.5 * 4 / 3 : 11 * 4 / 3, 1)
        expect(metrics.line / metrics.font).toBeCloseTo(mode === 'Study' ? 1.62 : 1.48, 2)
        expect(metrics.width).toBeLessThanOrEqual(metrics.viewport + 1)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        if (mode === 'Study') studyHeight = metrics.height
        else expect(metrics.height).toBeLessThan(studyHeight * 0.97)
        await expect(preview.locator('img')).toHaveCount(4)
        await expect(preview.locator('table')).toHaveCount(3)
        await expect(preview.locator('.katex')).toHaveCount(3)
        await expect(preview.locator('.callout')).toHaveCount(4)
        await expect(preview.locator('.hljs-keyword')).not.toHaveCount(0)
        await expect(preview.locator('main')).toContainText('भारतीय संविधान')
        for (const label of await page.locator('.md-mode-switch label').all()) expect((await label.boundingBox()).height).toBeGreaterThanOrEqual(44)
        const tocLink = preview.getByRole('navigation', { name: 'Contents' }).getByRole('link', { name: 'अध्याय 3 — Indian Polity', exact: true })
        if (width < 1280) expect((await tocLink.boundingBox()).height).toBeGreaterThanOrEqual(44)
        await tocLink.click()
        await expect(preview.getByRole('heading', { name: 'अध्याय 3 — Indian Polity', exact: true })).toBeFocused()
        expect(await preview.locator('body').evaluate(() => window.scrollY)).toBeGreaterThan(0)
        await preview.locator('summary').click()
        await expect(preview.locator('details')).toHaveAttribute('open', '')
        // Store actual screenshots for side-by-side CI/local review, not golden
        // screenshots fabricated in an environment without Chromium.
        await preview.locator('body').evaluate(() => window.scrollTo(0, 0))
        await page.locator('iframe').scrollIntoViewIfNeeded()
        await page.locator('iframe').screenshot({ path: testInfo.outputPath(`${mode.toLowerCase()}-${width}.png`) })
        await page.locator('iframe').evaluate((frame) => {
          frame.contentWindow.print = () => { window.__profilePrinted = frame.contentDocument.body.className }
        })
        await page.getByRole('button', { name: 'Export preview PDF', exact: true }).click()
        expect(await page.evaluate(() => window.__profilePrinted)).toBe(`${mode.toLowerCase()}-mode`)
      }
      // Native radio arrow-key behavior; selected state isn't color alone.
      await expect(page.getByRole('radio', { name: 'Revision', exact: true })).toBeEnabled()
      await page.getByRole('radio', { name: 'Revision', exact: true }).focus()
      await page.keyboard.press('ArrowLeft')
      await expect(page.getByRole('radio', { name: 'Study', exact: true })).toBeChecked()
      await expect(preview.locator('body')).toHaveClass('study-mode')
      await page.getByLabel('Upload Markdown file').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') })
      await expect(page.getByRole('alert')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    })
  })
}

test('both profiles retain standard A4/Letter print sizes independent of narrow screen width', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  await page.setViewportSize({ width: 600, height: 900 })
  const preview = await openNotes(page)
  for (const mode of ['Study', 'Revision']) for (const paper of ['A4', 'Letter']) {
    await page.getByRole('radio', { name: mode, exact: true }).check()
    await page.locator('#notes-paper').selectOption(paper)
    await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
    await expect(preview.locator('body')).toHaveClass(`${mode.toLowerCase()}-mode`)
    const html = await page.locator('iframe').getAttribute('srcdoc')
    const printPage = await page.context().newPage()
    await printPage.goto(page.url())
    await printPage.setContent(html)
    await printPage.emulateMedia({ media: 'print' })
    await printPage.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((img) => img.decode().catch(() => {}))) })
    expect(await printPage.locator('body').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(mode === 'Study' ? 15.333 : 14.667, 1)
    expect(await printPage.locator('table').first().evaluate((node) => getComputedStyle(node).display)).toBe('table')
    expect(await printPage.locator('.study-notes').evaluate((node) => getComputedStyle(node).padding)).toBe('0px')
    expect(await printPage.locator('h1.notes-chapter').first().evaluate((node) => getComputedStyle(node).breakBefore)).toBe('page')
    const pdf = await printPage.pdf({ path: testInfo.outputPath(`${mode}-${paper}.pdf`), preferCSSPageSize: true, printBackground: true })
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    const mediaBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(pdf.toString('latin1'))
    expect(mediaBox).not.toBeNull()
    expect(Math.abs(Number(mediaBox[1]) - (paper === 'A4' ? 595.28 : 612))).toBeLessThan(2)
    expect(Math.abs(Number(mediaBox[2]) - (paper === 'A4' ? 841.89 : 792))).toBeLessThan(2)
    await printPage.close()
  }
})
