/**
 * "i" buttons: every hint lives behind an InfoTip instead of on the screen.
 * These tests cover the interaction contract of src/ui/InfoTip.jsx across the
 * real app: one tip open at a time, keyboard operation, focus return, and a
 * popover that never leaves the viewport on a phone.
 */
import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

async function openMarkdown(page) {
  await page.getByRole('button', { name: 'Markdown to PDF', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Markdown notes' })).toBeVisible()
}

test('the screen shows no hint paragraphs; hints open on demand and only one at a time', async ({ page }) => {
  await page.goto('/')
  await openMarkdown(page)

  // Nothing is open by default and every trigger is a labelled, collapsed button.
  await expect(page.locator('.tip-pop')).toHaveCount(0)
  const buttons = page.locator('.tip-btn')
  expect(await buttons.count()).toBeGreaterThanOrEqual(8)
  for (const button of await buttons.all()) {
    expect(await button.getAttribute('aria-label')).toMatch(/^Info: .+/)
    await expect(button).toHaveAttribute('aria-expanded', 'false')
  }

  // The long explanations are gone from the page itself.
  const visibleText = await page.locator('body').innerText()
  expect(visibleText).not.toContain('Obsidian')
  expect(visibleText).not.toContain('Add to Home Screen')
  expect(visibleText).not.toContain('print dialog')

  // Open one tip, then another: the first one closes.
  await page.getByRole('button', { name: 'Info: Notes and images' }).click()
  const notesTip = page.getByRole('dialog', { name: 'Notes and images' })
  await expect(notesTip).toBeVisible()
  await expect(notesTip).toContainText('Obsidian')
  await page.getByRole('button', { name: 'Info: Exporting the PDF' }).click()
  await expect(notesTip).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Exporting the PDF' })).toBeVisible()
  await expect(page.locator('.tip-pop')).toHaveCount(1)

  // A click anywhere else closes it, and the controls underneath are usable again.
  await page.getByRole('heading', { name: 'Markdown notes' }).click()
  await expect(page.locator('.tip-pop')).toHaveCount(0)
  await page.getByLabel('Document title').click()
  await expect(page.getByLabel('Document title')).toBeFocused()
})

test('keyboard: Enter opens, Tab reaches Close, Escape closes and returns focus', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Info: Frame settings' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const tip = page.getByRole('dialog', { name: 'Frame settings' })
  await expect(tip).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(trigger).toBeFocused() // non-modal: focus is not stolen

  await page.keyboard.press('Tab')
  await expect(tip.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(tip).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  // Space toggles as well, and the Close button works with the keyboard.
  await page.keyboard.press('Space')
  await expect(tip).toBeVisible()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(tip).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('on a 390 px phone every tip stays inside the viewport and is scrollable when long', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 })
  await page.goto('/')
  await openMarkdown(page)
  const labels = await page.locator('.tip-btn:visible').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
  expect(labels.length).toBeGreaterThanOrEqual(8)
  for (const label of labels) {
    const button = page.getByRole('button', { name: label, exact: true })
    await button.scrollIntoViewIfNeeded()
    await button.click()
    const tip = page.locator('.tip-pop')
    await expect(tip).toBeVisible()
    const box = await tip.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(740)
    await page.keyboard.press('Escape')
    await expect(tip).toHaveCount(0)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
