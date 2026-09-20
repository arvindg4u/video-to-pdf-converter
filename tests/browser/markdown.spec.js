import { test, expect } from '@playwright/test'

async function openMarkdown(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Turn Markdown into study-ready notes' })).toBeVisible()
}

async function sample(page) {
  await openMarkdown(page)
  await page.getByRole('button', { name: 'Try a sample' }).click()
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
}

test('uploads Markdown, renders all study elements, and retains edits across modes', async ({ page }) => {
  await openMarkdown(page)
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeDisabled()
  await page.getByLabel('Upload Markdown file').setInputFiles('examples/academic-study-notes.md')
  const preview = page.frameLocator('iframe[title="Study notes preview"]')
  await expect(preview.getByRole('heading', { name: 'Learning & memory', exact: true })).toBeVisible()
  await expect(preview.locator('table')).toHaveCount(1)
  await expect(preview.locator('.katex-display')).toHaveCount(1)
  await expect(preview.locator('.hljs-keyword')).not.toHaveCount(0)
  await expect(preview.locator('input[type="checkbox"]')).toHaveCount(4)
  await expect(preview.locator('section[data-footnotes]')).toHaveCount(1)
  await expect(page.getByLabel('Document title')).toHaveValue('academic-study-notes')
  await page.getByLabel('Edit Markdown').fill('# Edited notes\n\n**Important**')
  await expect(preview.getByRole('heading', { name: 'Edited notes' })).toBeVisible()
  await page.getByRole('button', { name: 'Video to PDF', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Frame Controller' })).toBeVisible()
  await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
  await expect(page.getByLabel('Edit Markdown')).toHaveValue('# Edited notes\n\n**Important**')
})

test('rejects invalid, empty and oversized files without losing previous notes', async ({ page }) => {
  await sample(page)
  const input = page.getByLabel('Upload Markdown file')
  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(page.getByRole('alert')).toContainText('Choose one Markdown file')
  await input.setInputFiles({ name: 'empty.md', mimeType: '', buffer: Buffer.from('  ') })
  await expect(page.getByRole('alert')).toContainText('empty')
  await input.setInputFiles({ name: 'large.md', mimeType: '', buffer: Buffer.alloc(1024 * 1024 + 1, 'a') })
  await expect(page.getByRole('alert')).toContainText('too large')
  await expect(page.getByLabel('Edit Markdown')).toContainText('Learning & memory')
  await input.setInputFiles({ name: 'NOTES.MARKDOWN', mimeType: '', buffer: Buffer.from('# New notes') })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'New notes' })).toBeVisible()
})

test('accepts drag and drop and clears export eligibility when editor is empty', async ({ page }) => {
  await openMarkdown(page)
  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['# Dropped notes'], 'drop.md', { type: '' }))
    return transfer
  })
  await page.locator('.md-drop-zone').dispatchEvent('drop', { dataTransfer: data })
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Dropped notes' })).toBeVisible()
  await page.getByLabel('Edit Markdown').fill('')
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeDisabled()
})

test('isolates unsafe HTML, resolves internal anchors, and keeps paper light in dark mode', async ({ page }) => {
  await openMarkdown(page)
  await page.getByLabel('Edit Markdown').fill('# Heading\n\n[Jump](#heading)\n\n<script>parent.hacked = true</script>\n\n<img src="x" onerror="parent.hacked=true">\n\nA note[^a].\n\n[^a]: A source.')
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  const frame = page.frames().find((frame) => frame.parentFrame())
  expect(await frame.locator('script, [onerror]').count()).toBe(0)
  expect(await page.evaluate(() => window.hacked)).toBeUndefined()
  expect(await frame.evaluate(() => Array.from(document.querySelectorAll('a[href^="#"]')).every((a) => document.getElementById(a.hash.slice(1))))).toBe(true)
  await page.getByRole('button', { name: 'Switch Dark' }).click()
  expect(await frame.locator('.study-notes').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)')
})

test('requests printing of only the notes after fonts load, with the chosen paper size', async ({ page }) => {
  await sample(page)
  await page.getByLabel('Paper size').selectOption('Letter')
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  const frame = page.frames().find((frame) => frame.parentFrame())
  await frame.evaluate(() => { window.print = () => { window.printRequested = true } })
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Choose “Save as PDF”')
  expect(await frame.evaluate(() => window.printRequested)).toBe(true)
  expect(await frame.locator('style').textContent()).toContain('size: Letter')
  expect(await frame.evaluate(() => document.fonts.check('16px KaTeX_Main'))).toBe(true)
  await expect(frame.getByRole('heading', { name: 'Frame Controller' })).toHaveCount(0)
})

test('produces a multipage PDF from a long rendered document without horizontal overflow', async ({ page }, testInfo) => {
  await sample(page)
  await page.getByLabel('Edit Markdown').fill('# Long study notes\n\n' + Array.from({ length: 20 }, (_, i) => `## Topic ${i + 1}\n\nA useful explanation with **key terms** and an equation $E = mc^2$.\n\n- Recall the concept\n- Apply it to an example\n\n`).join(''))
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  const html = await page.locator('iframe').getAttribute('srcdoc')
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  const pdf = await page.pdf({ path: testInfo.outputPath('long-study-notes.pdf'), preferCSSPageSize: true, printBackground: true })
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('works on a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await sample(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeVisible()
})

test('native printing is permitted by the preview sandbox', async ({ page }) => {
  await sample(page)
  // Register the callback in the parent realm: script callbacks inside the
  // sandboxed document are intentionally blocked, including test listeners.
  await page.evaluate(() => document.querySelector('iframe').contentWindow.addEventListener('beforeprint', () => { window.beforePrintFired = true }))
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Print dialog requested')
  expect(await page.evaluate(() => window.beforePrintFired)).toBe(true)
})

test('embeds image data and reports failed remote images when exporting', async ({ page }) => {
  await openMarkdown(page)
  await page.route('https://images.example.test/missing.png', (route) => route.abort())
  await page.getByLabel('Edit Markdown').fill('# Images\n\n![Pixel](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9AAAAABJRU5ErkJggg==)\n\n![Missing](https://images.example.test/missing.png)')
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  const frame = page.frames().find((frame) => frame.parentFrame())
  await frame.evaluate(() => { window.print = () => {} })
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('1 image(s) could not load')
  expect(await frame.locator('img').first().evaluate((image) => image.naturalWidth)).toBe(1)
})

test('a stalled image reaches the export timeout instead of permanently disabling export', async ({ page }) => {
  await openMarkdown(page)
  let releaseImage
  const imageReleased = new Promise((resolve) => { releaseImage = resolve })
  await page.route('https://images.example.test/stalled.png', async (route) => {
    await imageReleased
    await route.abort()
  })
  try {
    await page.getByLabel('Edit Markdown').fill('# Stalled image\n\n![Diagram](https://images.example.test/stalled.png)')
    await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Stalled image' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Video to PDF', exact: true })).toBeDisabled()
    await expect(page.getByRole('alert')).toContainText('still loading', { timeout: 20000 })
    await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Video to PDF', exact: true })).toBeEnabled()
  } finally {
    releaseImage()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('rapid edits and paper changes export only the latest document', async ({ page }) => {
  await sample(page)
  await page.getByLabel('Edit Markdown').fill('# Earlier revision')
  await page.getByLabel('Edit Markdown').fill('# Latest revision\n\nReady for print.')
  await page.getByLabel('Document title').fill('Final title')
  await page.getByLabel('Paper size').selectOption('Letter')
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    document.querySelector('iframe').contentWindow.addEventListener('beforeprint', () => {
      const doc = document.querySelector('iframe').contentDocument
      window.printedNotes = { title: doc.title, text: doc.body.textContent, styles: doc.querySelector('style').textContent }
    })
  })
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  const printed = await page.evaluate(() => window.printedNotes)
  expect(printed.title).toBe('Final title')
  expect(printed.text).toContain('Latest revision')
  expect(printed.text).not.toContain('Earlier revision')
  expect(printed.styles).toContain('size: Letter')
})
