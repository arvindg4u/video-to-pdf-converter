import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { longStudyNotes } from '../fixtures/long-study-notes.js'
import { renderStudyMarkdown } from '../../src/markdown/render.js'
import { analyzePreflight } from '../../src/markdown/preflight.js'
const helper = readFileSync(new URL('../../src/markdown/printExport.js', import.meta.url), 'utf8')
const tallImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAADCAYAAABS3WWCAAAAEElEQVR4nGNomLDgPwOcAAA6HQgOvMR/tAAAAABJRU5ErkJggg=='
const edgeCases = '\n# Print edge cases\n\n> [!WARNING]- Hidden revision material\n> This sentence must be printed, but the preview must collapse again.\n\n```text\n' + 'UnbrokenCode'.repeat(40) + '\n```\n\n$$\n' + Array(30).fill('a+b').join('+') + '\n$$\n\n| Table header | Meaning |\n|---|---|\n' + Array.from({length: 100}, (_, i) => `| Row ${i} | A useful explanation of constitutional law. |`).join('\n') + `\n\n<img src="data:image/png;base64,${tallImage}" width="2000" alt="Tall geometry image">\n\n<script>parent.__printAttack = true</script>`

for (const paper of ['A4', 'Letter']) for (const mode of ['Study', 'Revision']) {
  test(`real ${paper} ${mode} PDF uses a complete prepared large document`, async ({ page }, testInfo) => {
    test.setTimeout(90000)
    const source = longStudyNotes() + edgeCases
    let start = performance.now()
    const rendered = renderStudyMarkdown(source)
    const renderingMs = performance.now() - start
    start = performance.now()
    analyzePreflight(rendered.preflightFacts, { mode: mode.toLowerCase(), paper })
    const preflightMs = performance.now() - start
    await page.goto('/')
    await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
    start = performance.now()
    await page.getByLabel('Upload Markdown file').setInputFiles({ name: 'Complete Notes.md', mimeType: 'text/markdown', buffer: Buffer.from(source) })
    await page.locator('#notes-paper').selectOption(paper)
    await page.getByRole('radio', { name: mode, exact: true }).check()
    await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
    const importToReadyMs = performance.now() - start
    // Test the production preparation helper against real fonts/images/DOM.
    // Capture precisely the expanded snapshot at print invocation for a real
    // Chromium PDF. No test-only renderer is introduced into the application.
    const captured = await page.evaluate(async (code) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
      try {
        const { printNotes } = await import(url)
        const frame = document.querySelector('iframe'), doc = frame.contentDocument
        let html
        frame.contentWindow.print = () => { html = '<!doctype html>' + doc.documentElement.outerHTML }
        const metrics = await printNotes({ frame, expectedDocument: doc, isCurrent: () => true })
        return { html, metrics, restored: !doc.querySelector('details').open, sourceIntact: document.querySelector('#markdown-source').value }
      } finally { URL.revokeObjectURL(url) }
    }, helper)
    expect(captured.restored).toBe(true)
    expect(captured.sourceIntact).toBe(source)
    expect(captured.metrics.missingImages).toBe(0)
    expect(await page.evaluate(() => window.__printAttack)).toBeUndefined()
    const timingPath = testInfo.outputPath('preparation-timings.json')
    writeFileSync(timingPath, JSON.stringify({ renderingMs, preflightMs, importToReadyMs, ...captured.metrics }, null, 2))
    await testInfo.attach('preparation-timings.json', { path: timingPath, contentType: 'application/json' })
    await page.setContent(captured.html.replaceAll('href="about:srcdoc#', 'href="#'))
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode())) })
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.notes-toc a')).toHaveCount(301)
    await expect(page.locator('details')).toHaveAttribute('open', '')
    await expect(page.locator('script, [onerror]')).toHaveCount(0)
    const pdf = await page.pdf({ path: testInfo.outputPath(`${paper}-${mode}.pdf`), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false })
    const bytes = pdf.toString('latin1')
    expect(bytes.startsWith('%PDF')).toBe(true)
    expect((bytes.match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(60)
    expect(bytes).toContain('/Subtype /Link')
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(bytes)
    expect(Math.abs(Number(box[1]) - (paper === 'A4' ? 595.28 : 612))).toBeLessThan(2)
    expect(Math.abs(Number(box[2]) - (paper === 'A4' ? 841.89 : 792))).toBeLessThan(2)
  })
}

test('single-H1 header, page counters, restored callout state, and safe print title', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
  await page.getByLabel('Edit Markdown').fill('---\ntitle: RAS: / Complete Notes?\n---\n# Indian Polity\n\n> [!NOTE]- Closed\n> Always include this in the PDF.\n\n' + Array(120).fill('A long explanation of fundamental rights and constitutional remedies. '.repeat(8)).join('\n\n'))
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    const frame = document.querySelector('iframe')
    frame.contentWindow.print = () => {
      window.__printSnapshot = '<!doctype html>' + frame.contentDocument.documentElement.outerHTML
      window.__safeTitle = frame.contentDocument.title
    }
  })
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Print dialog requested')
  expect(await page.evaluate(() => window.__safeTitle)).toBe('RAS Complete Notes')
  expect(await page.locator('iframe').evaluate((f) => f.contentDocument.querySelector('details').open)).toBe(false)
  const html = await page.evaluate(() => window.__printSnapshot)
  await page.setContent(html.replaceAll('href="about:srcdoc#', 'href="#'))
  await page.evaluate(() => document.fonts.ready)
  await page.pdf({ path: testInfo.outputPath('single-header-no-backgrounds.pdf'), preferCSSPageSize: true, printBackground: false, displayHeaderFooter: false })
})

test('print exception and detached iframe restore the UI, and an edit during preparation cancels stale output', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
  await page.getByRole('button', { name: 'Try a sample' }).click()
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  await page.locator('iframe').evaluate((f) => { f.contentWindow.print = () => { throw Error('Print invocation failed') } })
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Print invocation failed')
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  await page.locator('iframe').evaluate((f) => {
    window.__releaseFonts = null
    Object.defineProperty(f.contentDocument.fonts, 'ready', { configurable: true, value: new Promise((resolve) => { window.__releaseFonts = resolve }) })
    f.contentWindow.print = () => { window.__stalePrinted = true }
  })
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  // Deliberately dispatch a queued input even though the normal UI is locked.
  await page.evaluate(() => {
    const editor = document.querySelector('#markdown-source')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, '# Current committed notes')
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    window.__releaseFonts()
  })
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Current committed notes' })).toBeVisible()
  expect(await page.evaluate(() => window.__stalePrinted)).toBeUndefined()
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  await page.locator('iframe').evaluate((frame) => frame.remove())
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('preview is unavailable')
  await expect(page.getByRole('button', { name: 'Video to PDF', exact: true })).toBeEnabled()
})

test('nonvisual edits still commit export intent when frontmatter overrides the title field', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
  await page.getByLabel('Edit Markdown').fill('---\ntitle: Fixed title\n---\n# Printable content')
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  await page.getByLabel('Document title').fill('Ignored field edit')
  await page.getByLabel('Edit Markdown').fill('---\ntitle: Fixed title\n---\n# Printable content\n\n<!-- nonvisual edit -->')
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  await page.locator('iframe').evaluate((frame) => { frame.contentWindow.print = () => { window.__nonvisualPrinted = frame.contentDocument.title } })
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Print dialog requested')
  expect(await page.evaluate(() => window.__nonvisualPrinted)).toBe('Fixed title')
})
