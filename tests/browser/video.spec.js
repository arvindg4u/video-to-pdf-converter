import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  corruptMp4Buffer,
  expectedFrames,
  generateFixture,
  mp4FilePayload,
  pdfInfo,
  spoofVideoProperties,
} from './videoFixtures.js'

async function openVideo(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Video to PDF', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Frame settings' })).toBeVisible()
}

async function downloadPdf(page, clickGenerate = true) {
  const downloadPromise = page.waitForEvent('download')
  if (clickGenerate) {
    await page.getByRole('button', { name: 'Generate PDF', exact: true }).click()
  }
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^merged-videos-.*\.pdf$/)
  const path = await download.path()
  return pdfInfo(await readFile(path))
}

test('fixture self-check: generated MP4s decode with exact durations', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  const fixture = await generateFixture(page, { seconds: 2, exact: true })
  expect(fixture.width).toBe(160)
  expect(fixture.height).toBe(120)
  expect(Math.abs(fixture.duration - 2)).toBeLessThan(0.05)
  expect(fixture.byteLength).toBeGreaterThan(1024)
  expect(fixture.byteLength).toBeLessThan(2 * 1024 * 1024)
})

test('uploads a valid MP4 and converts it to a verified A4 PDF', async ({ page }) => {
  test.setTimeout(120_000)
  await openVideo(page)
  const fixture = await generateFixture(page, { seconds: 3, exact: true })
  const frames = expectedFrames(fixture.duration, 1)
  await page.getByLabel('Choose MP4 video files').setInputFiles([mp4FilePayload(fixture, 'clip.mp4')])
  await expect(page.locator('.queue-item')).toHaveCount(1)
  await expect(page.locator('.queue-item')).toContainText('clip.mp4')

  const pdf = await downloadPdf(page)
  expect(pdf.header).toBe('%PDF-')
  expect(pdf.pages).toBe(frames)
  // A4 landscape frame pages: 297×210mm ≈ 841.89×595.28pt.
  expect(pdf.mediaboxes.length).toBe(frames)
  expect(pdf.mediaboxes[0]).toContain('841.89')
  expect(pdf.mediaboxes[0]).toContain('595.28')
  await expect(page.getByRole('status')).toContainText(`${frames} frames from 1 video`)
  await expect(page.locator('.kpi', { hasText: 'Engine' })).toContainText('Idle')
})

test('accepts drag and drop and queues the video', async ({ page }) => {
  test.setTimeout(90_000)
  await openVideo(page)
  const fixture = await generateFixture(page, { seconds: 1, exact: true })
  const data = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], 'drop.mp4', { type: 'video/mp4' }))
    return transfer
  }, fixture.buffer.toString('base64'))
  await page.locator('.upload-panel').dispatchEvent('drop', { dataTransfer: data })
  await expect(page.locator('.queue-item')).toHaveCount(1)
  await expect(page.locator('.queue-item')).toContainText('drop.mp4')
})

test('rejects invalid files with an alert while keeping valid ones', async ({ page }) => {
  test.setTimeout(90_000)
  await openVideo(page)
  const fixture = await generateFixture(page, { seconds: 1, exact: true })
  await page.getByLabel('Choose MP4 video files').setInputFiles([
    mp4FilePayload(fixture, 'good.mp4'),
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
    { name: 'movie.webm', mimeType: 'video/webm', buffer: Buffer.from('fake') },
  ])
  await expect(page.locator('.queue-item')).toHaveCount(1)
  await expect(page.locator('.queue-item')).toContainText('good.mp4')
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('not a supported MP4 video')
})

test('converts multiple videos in order into one combined PDF', async ({ page }) => {
  test.setTimeout(180_000)
  await openVideo(page)
  const first = await generateFixture(page, { seconds: 2, exact: true })
  const second = await generateFixture(page, { seconds: 3, exact: true })
  const total = expectedFrames(first.duration, 1) + expectedFrames(second.duration, 1)
  await page.getByLabel('Choose MP4 video files').setInputFiles([
    mp4FilePayload(first, 'aaa-first.mp4'),
    mp4FilePayload(second, 'zzz-second.mp4'),
  ])
  await expect(page.locator('.queue-item')).toHaveCount(2)
  await expect(page.locator('.queue-item').first()).toContainText('aaa-first.mp4')

  const pdf = await downloadPdf(page)
  expect(pdf.pages).toBe(total)
  // Queue order is preserved inside the document.
  expect(pdf.text.indexOf('aaa-first.mp4')).toBeGreaterThanOrEqual(0)
  expect(pdf.text.indexOf('zzz-second.mp4')).toBeGreaterThan(pdf.text.indexOf('aaa-first.mp4'))
  await expect(page.getByRole('status')).toContainText(`${total} frames from 2 video`)
})

test('removes an individual video from the queue', async ({ page }) => {
  test.setTimeout(90_000)
  await openVideo(page)
  const fixture = await generateFixture(page, { seconds: 1, exact: true })
  await page.getByLabel('Choose MP4 video files').setInputFiles([
    mp4FilePayload(fixture, 'keep.mp4'),
    mp4FilePayload(fixture, 'remove.mp4'),
  ])
  await expect(page.locator('.queue-item')).toHaveCount(2)
  await page.getByRole('button', { name: 'Remove remove.mp4 from queue' }).click()
  await expect(page.locator('.queue-item')).toHaveCount(1)
  await expect(page.locator('.queue-item')).toContainText('keep.mp4')
})

test('rejects duplicate uploads with a notice instead of queueing twice', async ({ page }) => {
  test.setTimeout(90_000)
  await openVideo(page)
  const fixture = await generateFixture(page, { seconds: 1, exact: true })
  const base64 = fixture.buffer.toString('base64')
  for (let round = 0; round < 2; round++) {
    const data = await page.evaluateHandle((payload) => {
      const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'same.mp4', { type: 'video/mp4', lastModified: 424242 }))
      return transfer
    }, base64)
    await page.locator('.upload-panel').dispatchEvent('drop', { dataTransfer: data })
  }
  await expect(page.locator('.queue-item')).toHaveCount(1)
  await expect(page.getByRole('status')).toContainText('already in the queue')
})

test('FPS changes the extracted frame count deterministically', async ({ page }) => {
  test.setTimeout(180_000)
  await openVideo(page)
  const fixture = await generateFixture(page, { seconds: 4, exact: true })
  await page.getByLabel('Choose MP4 video files').setInputFiles([mp4FilePayload(fixture, 'fps.mp4')])

  const first = await downloadPdf(page)
  expect(first.pages).toBe(expectedFrames(fixture.duration, 1))
  // The success state clears the queue after ~2s; wait for it before round 2.
  await expect(page.getByText('Queue is empty')).toBeVisible({ timeout: 10_000 })

  await page.getByLabel('Choose MP4 video files').setInputFiles([mp4FilePayload(fixture, 'fps.mp4')])
  const slider = page.getByLabel(/Frames per second/)
  await slider.focus()
  await slider.press('ArrowRight')
  await slider.press('ArrowRight')
  await expect(page.locator('label[for="fps-select"]')).toContainText('3')
  const third = await downloadPdf(page)
  expect(third.pages).toBe(expectedFrames(fixture.duration, 3))
})

test('shows accessible live progress and ends at 100%', async ({ page }) => {
  test.setTimeout(120_000)
  await openVideo(page)
  const fixture = await generateFixture(page, { seconds: 8 })
  const slider = page.getByLabel(/Frames per second/)
  await slider.focus()
  await slider.press('ArrowRight')
  await slider.press('ArrowRight')
  await page.getByLabel('Choose MP4 video files').setInputFiles([mp4FilePayload(fixture, 'long.mp4')])

  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click()
  const progress = page.getByRole('progressbar', { name: 'Video conversion progress' })
  await expect(progress).toBeVisible({ timeout: 10_000 })
  const total = expectedFrames(fixture.duration, 3)
  await expect(page.getByRole('status')).toContainText(`${total} frames from 1 video`, { timeout: 90_000 })
  await expect(page.locator('.kpi', { hasText: 'Engine' })).toContainText('Idle')
})

test('cancellation stops conversion, keeps the queue, and downloads nothing', async ({ page }) => {
  test.setTimeout(180_000)
  await openVideo(page)
  const fixture = await generateFixture(page, { seconds: 15 })
  const slider = page.getByLabel(/Frames per second/)
  await slider.focus()
  await slider.press('ArrowRight')
  await page.getByLabel('Choose MP4 video files').setInputFiles([mp4FilePayload(fixture, 'cancel.mp4')])

  let downloads = 0
  page.on('download', () => {
    downloads += 1
  })
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click()
  await expect(page.getByRole('progressbar')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Cancel conversion' }).click()

  await expect(page.getByRole('status')).toContainText('Conversion cancelled')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.locator('.queue-item')).toHaveCount(1)
  await expect(page.locator('.kpi', { hasText: 'Engine' })).toContainText('Idle')
  await expect(page.getByRole('button', { name: 'Generate PDF', exact: true })).toBeEnabled()
  await page.waitForTimeout(4000)
  expect(downloads).toBe(0)
})

test('corrupt MP4 fails gracefully and names the file', async ({ page }) => {
  test.setTimeout(120_000)
  await openVideo(page)
  await page.getByLabel('Choose MP4 video files').setInputFiles([
    { name: 'corrupt.mp4', mimeType: 'video/mp4', buffer: corruptMp4Buffer() },
  ])
  let downloads = 0
  page.on('download', () => {
    downloads += 1
  })
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('corrupt.mp4', { timeout: 30_000 })
  await expect(alert).toContainText(/corrupt|could not be read|took longer/i)
  await expect(page.locator('.kpi', { hasText: 'Engine' })).toContainText('Idle')
  await expect(page.getByRole('button', { name: 'Generate PDF', exact: true })).toBeEnabled()
  expect(downloads).toBe(0)
})

test('very short videos still produce a single-frame PDF', async ({ page }) => {
  test.setTimeout(90_000)
  await openVideo(page)
  const fixture = await generateFixture(page, { seconds: 0.4, exact: true })
  await page.getByLabel('Choose MP4 video files').setInputFiles([mp4FilePayload(fixture, 'tiny.mp4')])
  const pdf = await downloadPdf(page)
  expect(pdf.header).toBe('%PDF-')
  expect(pdf.pages).toBe(1)
  await expect(page.getByRole('status')).toContainText('1 frames from 1 video')
})

test('frame-limit guard is enforced and explained at the UI level', async ({ page }) => {
  test.setTimeout(90_000)
  await openVideo(page)
  // 1700s × 1 FPS = 1700 planned frames > 1000 cap, without a real 28-minute file.
  await spoofVideoProperties(page, { duration: 1700 })
  const fixture = await generateFixture(page, { seconds: 1, exact: true })
  await page.getByLabel('Choose MP4 video files').setInputFiles([mp4FilePayload(fixture, 'limit.mp4')])
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('maximum is 1,000')
  await expect(page.locator('.kpi', { hasText: 'Engine' })).toContainText('Idle')
})

test('duration-limit guard is enforced and explained at the UI level', async ({ page }) => {
  test.setTimeout(90_000)
  await openVideo(page)
  await spoofVideoProperties(page, { duration: 2000 })
  const fixture = await generateFixture(page, { seconds: 1, exact: true })
  await page.getByLabel('Choose MP4 video files').setInputFiles([mp4FilePayload(fixture, 'too-long.mp4')])
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('too-long.mp4')
  await expect(alert).toContainText('maximum supported duration is 30')
  await expect(page.locator('.kpi', { hasText: 'Engine' })).toContainText('Idle')
})

test('resolution-limit guard is enforced and explained at the UI level', async ({ page }) => {
  test.setTimeout(90_000)
  await openVideo(page)
  await spoofVideoProperties(page, { width: 5000, height: 3000 })
  const fixture = await generateFixture(page, { seconds: 1, exact: true })
  await page.getByLabel('Choose MP4 video files').setInputFiles([mp4FilePayload(fixture, 'huge.mp4')])
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('huge.mp4')
  await expect(alert).toContainText('3840×2160')
  await expect(page.locator('.kpi', { hasText: 'Engine' })).toContainText('Idle')
})

test('queue limit rejects oversized selections without decoding anything', async ({ page }) => {
  await openVideo(page)
  const files = Array.from({ length: 21 }, (_, i) => ({
    name: `video-${i}.mp4`,
    mimeType: 'video/mp4',
    buffer: Buffer.alloc(1024, i),
  }))
  await page.getByLabel('Choose MP4 video files').setInputFiles(files)
  await expect(page.getByRole('alert')).toContainText('maximum is 20')
  await expect(page.locator('.queue-item')).toHaveCount(0)
})

test('Letter paper produces Letter-sized pages', async ({ page }) => {
  test.setTimeout(120_000)
  await openVideo(page)
  const fixture = await generateFixture(page, { seconds: 2, exact: true, width: 120, height: 160 })
  await page.getByLabel('Choose MP4 video files').setInputFiles([mp4FilePayload(fixture, 'letter.mp4')])
  await page.locator('#video-paper').selectOption('Letter')
  const pdf = await downloadPdf(page)
  expect(pdf.pages).toBe(expectedFrames(fixture.duration, 1))
  // Portrait Letter: 8.5×11in = 612×792pt.
  expect(pdf.mediaboxes[0]).toContain('612')
  expect(pdf.mediaboxes[0]).toContain('792')
})

test('frame labels can be disabled without breaking conversion', async ({ page }) => {
  test.setTimeout(120_000)
  await openVideo(page)
  const fixture = await generateFixture(page, { seconds: 2, exact: true })
  await page.getByLabel('Choose MP4 video files').setInputFiles([mp4FilePayload(fixture, 'nolabel.mp4')])
  await page.locator('#video-labels').uncheck()
  const pdf = await downloadPdf(page)
  expect(pdf.pages).toBe(expectedFrames(fixture.duration, 1))
  expect(pdf.text).not.toContain('nolabel.mp4')
})

test('video controls expose accessible names and roles', async ({ page }) => {
  await openVideo(page)
  await expect(page.getByLabel('Choose MP4 video files')).toBeAttached()
  await expect(page.getByLabel(/Frames per second/)).toBeVisible()
  // Scoped: Markdown mode has its own (hidden) Paper size control.
  await expect(page.locator('.video-workspace').getByLabel('Paper size')).toBeVisible()
  await expect(page.getByLabel(/filename \+ timestamp/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Browse Files' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate PDF', exact: true })).toBeDisabled()
  // Failed picks surface a focused alert for screen readers.
  await page.getByLabel('Choose MP4 video files').setInputFiles([
    { name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('x') },
  ])
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible()
  await expect(alert).toBeFocused()
})

test('works on a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openVideo(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Generate PDF', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Browse Files' })).toBeVisible()
})

test('dark and light themes toggle the whole video workspace', async ({ page }) => {
  await openVideo(page)
  await page.getByRole('button', { name: 'Switch Dark' }).click()
  await expect(page.locator('html[data-theme="dark"]')).toBeAttached()
  await page.getByRole('button', { name: 'Switch Light' }).click()
  await expect(page.locator('html[data-theme="light"]')).toBeAttached()
  // Conversion controls keep working after theme switches.
  await expect(page.getByRole('button', { name: 'Generate PDF', exact: true })).toBeVisible()
})
