import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addVideoFrame,
  createVideoPdf,
  fitRect,
  normalizePaper,
  orientationForAspect,
  pageDimensionsMm,
  sanitizeLabel,
} from '../src/video/pdfWriter.js'
import { VIDEO_ERROR_CODES } from '../src/video/errors.js'

/**
 * Minimal JPEG (SOI + SOF0 1×1 + EOI): enough for jsPDF's dimension parser.
 * The embedded bytes are placeholders — these tests verify document
 * structure (header, page count, sizes), not image fidelity.
 */
const TINY_JPEG_DATA_URL = `data:image/jpeg;base64,${Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01,
  0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
]).toString('base64')}`

function pdfBytes(pdf) {
  return Buffer.from(pdf.output('arraybuffer'))
}

function countPages(bytes) {
  return (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
}

// --- Pure layout math (no jsPDF needed) ---

test('fitRect preserves aspect ratio, centers, and never overflows', () => {
  for (const [sw, sh, dw, dh] of [
    [1920, 1080, 277, 190], // landscape frame on landscape page
    [1080, 1920, 190, 277], // portrait frame on portrait page
    [1920, 1080, 190, 277], // landscape frame on portrait page
    [100, 100, 277, 190], // square frame
  ]) {
    const rect = fitRect(sw, sh, 10, 10, dw, dh)
    assert.ok(Math.abs(rect.width / rect.height - sw / sh) < 1e-9, 'aspect kept')
    assert.ok(rect.x >= 10 && rect.y >= 10, 'inside top-left')
    assert.ok(rect.x + rect.width <= 10 + dw + 1e-9, 'inside right edge')
    assert.ok(rect.y + rect.height <= 10 + dh + 1e-9, 'inside bottom edge')
    // Centered: leftover margins are equal on both sides.
    assert.ok(Math.abs((rect.x - 10) - (10 + dw - rect.x - rect.width)) < 1e-9)
    assert.ok(Math.abs((rect.y - 10) - (10 + dh - rect.y - rect.height)) < 1e-9)
  }
})

test('page sizes are standard A4/Letter with aspect-driven orientation', () => {
  assert.deepEqual(pageDimensionsMm('A4', 'portrait'), { width: 210, height: 297 })
  assert.deepEqual(pageDimensionsMm('A4', 'landscape'), { width: 297, height: 210 })
  assert.deepEqual(pageDimensionsMm('Letter', 'portrait'), { width: 215.9, height: 279.4 })
  assert.equal(orientationForAspect(1920, 1080), 'landscape')
  assert.equal(orientationForAspect(1080, 1920), 'portrait')
  assert.equal(orientationForAspect(100, 100), 'landscape')
  assert.equal(normalizePaper('Letter; evil'), 'A4')
  assert.equal(normalizePaper('Letter'), 'Letter')
})

test('labels are flattened to WinAnsi-safe printable text', () => {
  // U+00B7 MIDDLE DOT is Latin-1, so the standard separator survives…
  assert.equal(sanitizeLabel('a.mp4 · 1.00s'), 'a.mp4 · 1.00s')
  // …while emoji / symbols outside WinAnsi degrade to '?' per UTF-16 unit
  // (🎥 is a surrogate pair, hence two placeholders).
  assert.equal(sanitizeLabel('clip 🎥 ✓.mp4'), 'clip ?? ?.mp4')
  assert.equal(sanitizeLabel('  spaced\tout\n'), 'spaced out')
  assert.ok(sanitizeLabel('x'.repeat(200)).length <= 90)
})

// --- Real jsPDF document structure ---

test('empty document has zero pages; frames append one page each', () => {
  const pdf = createVideoPdf('A4')
  assert.equal(pdf.getNumberOfPages(), 0)
  addVideoFrame(pdf, {
    imageDataUrl: TINY_JPEG_DATA_URL,
    srcWidth: 640,
    srcHeight: 360,
    paper: 'A4',
    label: 'clip.mp4 · 0.00s',
  })
  addVideoFrame(pdf, {
    imageDataUrl: TINY_JPEG_DATA_URL,
    srcWidth: 640,
    srcHeight: 360,
    paper: 'A4',
    label: 'clip.mp4 · 1.00s',
  })
  assert.equal(pdf.getNumberOfPages(), 2)
  const bytes = pdfBytes(pdf)
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  assert.equal(countPages(bytes), 2)
})

test('multiple aspect ratios produce correctly sized pages', () => {
  const pdf = createVideoPdf('Letter')
  addVideoFrame(pdf, {
    imageDataUrl: TINY_JPEG_DATA_URL, srcWidth: 640, srcHeight: 360, paper: 'Letter',
  })
  pdf.setPage(1)
  assert.ok(Math.abs(pdf.internal.pageSize.width - 279.4) < 0.01) // landscape Letter
  addVideoFrame(pdf, {
    imageDataUrl: TINY_JPEG_DATA_URL, srcWidth: 360, srcHeight: 640, paper: 'Letter',
  })
  pdf.setPage(2)
  assert.ok(Math.abs(pdf.internal.pageSize.width - 215.9) < 0.01) // portrait Letter
  assert.equal(countPages(pdfBytes(pdf)), 2)
})

test('label overlay is optional and absence changes nothing structural', () => {
  const pdf = createVideoPdf('A4')
  const withLabel = addVideoFrame(pdf, {
    imageDataUrl: TINY_JPEG_DATA_URL, srcWidth: 640, srcHeight: 360, label: 'x',
  })
  const withoutLabel = addVideoFrame(pdf, {
    imageDataUrl: TINY_JPEG_DATA_URL, srcWidth: 640, srcHeight: 360, includeLabel: false,
  })
  assert.deepEqual(withLabel, withoutLabel) // identical geometry either way
  assert.equal(pdf.getNumberOfPages(), 2)
})

test('invalid frame input raises PDF_GENERATION_FAILED, not a raw crash', () => {
  const pdf = createVideoPdf('A4')
  assert.throws(
    () => addVideoFrame(pdf, { imageDataUrl: '', srcWidth: 640, srcHeight: 360 }),
    (error) => error.code === VIDEO_ERROR_CODES.PDF_GENERATION_FAILED,
  )
  assert.equal(pdf.getNumberOfPages(), 0) // no empty page left behind
})
