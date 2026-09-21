/**
 * Handwritten notes typography: the bundled Kalam face (Latin + Devanagari)
 * is the default for the study document, can be switched to the book serif,
 * is remembered across reloads, and never changes the notes themselves.
 */
import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

const HINDI_ENGLISH = [
  '# संविधान — Fundamental Rights',
  '',
  'अनुच्छेद 14 से 32 तक *मौलिक अधिकार* दिए गए हैं। **Right to Equality** सबसे पहले आता है।',
  '',
  'Inline math $E = mc^2$ and `code()` keep their own faces.',
].join('\n')

async function openNotes(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
  await page.getByLabel('Edit Markdown').fill(HINDI_ENGLISH)
  await expect(page.frameLocator('iframe[title="Study notes preview"]').getByRole('heading', { level: 1, name: /Fundamental Rights/ })).toBeVisible()
}

const previewFrame = (page) => page.frames().find((frame) => frame.parentFrame())

async function inspect(page) {
  return previewFrame(page).evaluate(async () => {
    await document.fonts.ready
    const style = (selector) => getComputedStyle(document.querySelector(selector))
    const kalam = Array.from(document.fonts).filter((font) => font.family === 'Kalam')
    return {
      bodyClass: document.body.className,
      bodyFamily: style('main p').fontFamily,
      bodySize: style('main p').fontSize,
      codeFamily: style('main code').fontFamily,
      mathFamily: style('.katex .mathnormal').fontFamily,
      emphasisStyle: style('main em').fontStyle,
      emphasisMarked: style('main em').backgroundImage !== 'none',
      kalamLoaded: kalam.filter((font) => font.status === 'loaded').map((font) => `${font.weight} ${font.unicodeRange.startsWith('U+900') ? 'devanagari' : 'latin'}`).sort(),
      kalamFailed: kalam.filter((font) => font.status === 'error').length,
      text: document.querySelector('main p').textContent,
    }
  })
}

test('handwritten is the default: Kalam renders Hindi and English in one hand, code and math keep theirs', async ({ page }) => {
  await openNotes(page)
  await expect(page.locator('#notes-font')).toHaveValue('hand')
  const hand = await inspect(page)
  expect(hand.bodyClass).toBe('study-mode font-hand')
  expect(hand.bodyFamily).toMatch(/^Kalam\b/)
  expect(parseFloat(hand.bodySize)).toBeCloseTo((12.5 * 96) / 72, 1)
  const lineHeight = async () => previewFrame(page).evaluate(() => {
    const style = getComputedStyle(document.body)
    return { font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) }
  })
  let metrics = await lineHeight()
  expect(metrics.line / metrics.font).toBeCloseTo(1.7, 2)
  // Revision keeps the hand but tightens the rhythm, like the book profiles do.
  await page.getByRole('radio', { name: 'Revision', exact: true }).check()
  await expect.poll(async () => (await inspect(page)).bodyClass).toBe('revision-mode font-hand')
  metrics = await lineHeight()
  expect(metrics.font).toBeCloseTo((12 * 96) / 72, 1)
  expect(metrics.line / metrics.font).toBeCloseTo(1.58, 2)
  await page.getByRole('radio', { name: 'Study', exact: true }).check()
  await expect.poll(async () => (await inspect(page)).bodyClass).toBe('study-mode font-hand')
  expect(hand.kalamFailed).toBe(0)
  // Both scripts of the Regular weight were needed and loaded from the bundle; Bold Latin for **Right to Equality**.
  expect(hand.kalamLoaded).toEqual(expect.arrayContaining(['400 devanagari', '400 latin', '700 latin']))
  expect(hand.codeFamily).not.toMatch(/Kalam/)
  expect(hand.mathFamily).toMatch(/KaTeX/)
  expect(hand.emphasisStyle).toBe('normal')
  expect(hand.emphasisMarked).toBe(true)
  expect(hand.text).toContain('मौलिक अधिकार')
  // The document's running header stays in the sans meta face.
  expect(await previewFrame(page).evaluate(() => getComputedStyle(document.querySelector('.notes-header')).fontFamily)).not.toMatch(/Kalam/)
})

test('switching to Book restores the serif document and the choice survives a reload', async ({ page }) => {
  await openNotes(page)
  await page.locator('#notes-font').selectOption('book')
  await expect(page.locator('#notes-preview .md-section-heading')).toContainText('Book')
  await expect.poll(async () => (await inspect(page)).bodyClass).toBe('study-mode')
  const book = await inspect(page)
  expect(book.bodyFamily).toMatch(/^Charter\b/)
  expect(book.emphasisStyle).toBe('italic')
  expect(book.emphasisMarked).toBe(false)
  expect(book.text).toContain('मौलिक अधिकार') // same notes, different clothes
  expect(await page.evaluate(() => localStorage.getItem('pdf-lab:notes-font'))).toBe('book')

  await page.reload()
  await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
  await expect(page.locator('#notes-font')).toHaveValue('book')
  await page.locator('#notes-font').selectOption('hand')
  await page.reload()
  await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
  await expect(page.locator('#notes-font')).toHaveValue('hand')
})

test('a corrupt stored preference falls back to handwritten instead of breaking the converter', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pdf-lab:notes-font', '<script>x</script>'))
  await openNotes(page)
  await expect(page.locator('#notes-font')).toHaveValue('hand')
  expect((await inspect(page)).bodyClass).toBe('study-mode font-hand')
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled()
})
