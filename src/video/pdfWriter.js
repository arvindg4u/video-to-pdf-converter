/**
 * Predictable PDF layout for extracted video frames.
 *
 * Layout contract:
 * - Standard page sizes only (A4 / US Letter, shared concept with Markdown
 *   mode), orientation chosen per page from the frame aspect ratio so both
 *   landscape and portrait clips stay large.
 * - Each frame is fitted inside the page margins, centered, never cropped,
 *   never stretched (aspect preserved).
 * - The optional filename/timestamp label sits in a semi-transparent dark bar
 *   overlaid on the frame's bottom edge: readable on bright AND dark frames,
 *   with padding and a safe margin from the page edges.
 */

import { jsPDF } from 'jspdf'
import { PDF_PAGE_MARGIN_MM } from './constants.js'
import { pdfGenerationFailedError } from './errors.js'

export const PAPER_FORMATS = Object.freeze({
  A4: 'a4',
  Letter: 'letter',
})

export function normalizePaper(paper) {
  return paper === 'Letter' ? 'Letter' : 'A4'
}

/** Page dimensions in mm for a paper + orientation. */
export function pageDimensionsMm(paper = 'A4', orientation = 'landscape') {
  const base = normalizePaper(paper) === 'Letter'
    ? { width: 215.9, height: 279.4 }
    : { width: 210, height: 297 }
  return orientation === 'landscape'
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height }
}

export function orientationForAspect(srcWidth, srcHeight) {
  return srcWidth >= srcHeight ? 'landscape' : 'portrait'
}

/**
 * Fit src (w×h) inside dst (w×h), preserving aspect ratio and centering.
 * Pure — unit-tested without jsPDF.
 */
export function fitRect(srcWidth, srcHeight, dstX, dstY, dstWidth, dstHeight) {
  const scale = Math.min(dstWidth / srcWidth, dstHeight / srcHeight)
  const width = srcWidth * scale
  const height = srcHeight * scale
  return {
    x: dstX + (dstWidth - width) / 2,
    y: dstY + (dstHeight - height) / 2,
    width,
    height,
  }
}

/**
 * jsPDF's built-in fonts cover WinAnsi (Latin-1). Replace anything outside
 * that range so exotic filenames degrade to '?' instead of corrupt bytes.
 */
export function sanitizeLabel(text, maxLength = 90) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  const safe = flat.replace(/[^\x20-\xFF]/g, '?')
  return safe.length > maxLength ? `${safe.slice(0, maxLength - 1)}…` : safe
}

function drawLabelBar(pdf, frame, label) {
  const barHeight = 9
  const barY = frame.y + frame.height - barHeight
  let transparent = false
  try {
    if (typeof pdf.GState === 'function' && typeof pdf.setGState === 'function') {
      pdf.setGState(new pdf.GState({ opacity: 0.62 }))
      transparent = true
    }
  } catch {
    transparent = false
  }
  pdf.setFillColor(0, 0, 0)
  pdf.rect(frame.x, barY, frame.width, barHeight, 'F')
  if (transparent) {
    try {
      pdf.setGState(new pdf.GState({ opacity: 1 }))
    } catch {
      // Non-fatal: subsequent content keeps working without reset.
    }
  }
  pdf.setTextColor(255, 255, 255)
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'normal')
  pdf.text(label, frame.x + 2, barY + 6.2, { maxWidth: frame.width - 4 })
}

/**
 * Create an empty PDF document (no pages) in the requested paper size.
 * Pages are appended per frame with per-page orientation.
 */
export function createVideoPdf(paper = 'A4') {
  try {
    const pdf = new jsPDF({
      unit: 'mm',
      format: PAPER_FORMATS[normalizePaper(paper)],
      orientation: 'landscape',
    })
    pdf.deletePage(1)
    return pdf
  } catch (error) {
    throw pdfGenerationFailedError(error)
  }
}

/**
 * Append one fitted frame page. Returns the placed rect (useful for tests).
 */
export function addVideoFrame(pdf, {
  imageDataUrl,
  imageFormat = 'JPEG',
  srcWidth,
  srcHeight,
  paper = 'A4',
  label = '',
  includeLabel = true,
}) {
  if (!imageDataUrl || !srcWidth || !srcHeight) {
    throw pdfGenerationFailedError(
      new Error('addVideoFrame requires image data and source dimensions'),
    )
  }
  try {
    const orientation = orientationForAspect(srcWidth, srcHeight)
    pdf.addPage(PAPER_FORMATS[normalizePaper(paper)], orientation)
    const pageWidth = pdf.internal.pageSize.width
    const pageHeight = pdf.internal.pageSize.height
    const margin = PDF_PAGE_MARGIN_MM
    const frame = fitRect(
      srcWidth,
      srcHeight,
      margin,
      margin,
      pageWidth - margin * 2,
      pageHeight - margin * 2,
    )
    pdf.addImage(imageDataUrl, imageFormat, frame.x, frame.y, frame.width, frame.height)
    if (includeLabel && label) {
      drawLabelBar(pdf, frame, sanitizeLabel(label))
    }
    return frame
  } catch (error) {
    if (error?.code === 'PDF_GENERATION_FAILED') throw error
    throw pdfGenerationFailedError(error)
  }
}
