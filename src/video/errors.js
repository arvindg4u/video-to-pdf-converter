/**
 * Consistent error taxonomy for the video → PDF pipeline.
 *
 * Every failure raised to the UI is a `VideoError` with a stable `code`, a
 * human-readable `message` (current value + allowed value + what to do), and
 * an optional `cause`/`fileName` for debugging and per-video reporting.
 * Cancellation is a control-flow signal, not an error: callers must check
 * `isCancellation(error)` and restore the idle UI without an alert.
 */

import {
  MAX_FRAMES,
  MAX_VIDEOS,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_FILE_BYTES,
  MAX_VIDEO_HEIGHT,
  MAX_VIDEO_WIDTH,
} from './constants.js'

export const VIDEO_ERROR_CODES = Object.freeze({
  INVALID_FILE: 'INVALID_FILE',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  QUEUE_LIMIT: 'QUEUE_LIMIT',
  VIDEO_METADATA_FAILED: 'VIDEO_METADATA_FAILED',
  VIDEO_METADATA_TIMEOUT: 'VIDEO_METADATA_TIMEOUT',
  VIDEO_DECODE_FAILED: 'VIDEO_DECODE_FAILED',
  VIDEO_SEEK_FAILED: 'VIDEO_SEEK_FAILED',
  VIDEO_SEEK_TIMEOUT: 'VIDEO_SEEK_TIMEOUT',
  FRAME_LIMIT: 'FRAME_LIMIT',
  DURATION_LIMIT: 'DURATION_LIMIT',
  RESOLUTION_LIMIT: 'RESOLUTION_LIMIT',
  CANCELLED: 'CANCELLED',
  PDF_GENERATION_FAILED: 'PDF_GENERATION_FAILED',
  UNKNOWN: 'UNKNOWN',
})

export class VideoError extends Error {
  constructor(code, message, { cause, fileName } = {}) {
    super(message)
    this.name = 'VideoError'
    this.code = code
    if (fileName !== undefined) this.fileName = fileName
    if (cause !== undefined) this.cause = cause
  }
}

export function isCancellation(error) {
  return (
    error instanceof VideoError && error.code === VIDEO_ERROR_CODES.CANCELLED
  )
}

export function toVideoError(error, fallbackFileName) {
  if (error instanceof VideoError) return error
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new VideoError(VIDEO_ERROR_CODES.CANCELLED, 'Conversion cancelled.', {
      cause: error,
      fileName: fallbackFileName,
    })
  }
  return new VideoError(
    VIDEO_ERROR_CODES.UNKNOWN,
    'Something went wrong while converting. Please try again with a different file.',
    { cause: error, fileName: fallbackFileName },
  )
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]
  for (const candidate of units) {
    unit = candidate
    if (value < 1024 || candidate === 'GB') break
    value /= 1024
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown length'
  if (seconds < 60) return `${seconds.toFixed(1)} seconds`
  const minutes = seconds / 60
  return `${minutes >= 100 ? Math.round(minutes) : minutes.toFixed(1)} minutes`
}

export function quoteFileName(fileName) {
  return `“${fileName}”`
}

// --- Factories: one per failure mode so messages stay consistent. ---

export function invalidFileError(fileName, detail) {
  return new VideoError(
    VIDEO_ERROR_CODES.INVALID_FILE,
    `${quoteFileName(fileName)} is not a usable file${detail ? ` (${detail})` : ''}. Choose a valid .mp4 video.`,
    { fileName },
  )
}

export function unsupportedFormatError(file) {
  const name = file?.name || 'That file'
  const reported = file?.type ? ` (reported as ${file.type})` : ''
  return new VideoError(
    VIDEO_ERROR_CODES.UNSUPPORTED_FORMAT,
    `${quoteFileName(name)} is not a supported MP4 video${reported}. Only .mp4 files (video/mp4) are supported — convert it to MP4 and try again.`,
    { fileName: file?.name },
  )
}

export function fileTooLargeError(file) {
  return new VideoError(
    VIDEO_ERROR_CODES.FILE_TOO_LARGE,
    `${quoteFileName(file.name)} is ${formatBytes(file.size)}, but the maximum supported file size is ${formatBytes(MAX_VIDEO_FILE_BYTES)}. Use a smaller or shorter video.`,
    { fileName: file.name },
  )
}

export function queueLimitError(incomingCount, existingCount) {
  return new VideoError(
    VIDEO_ERROR_CODES.QUEUE_LIMIT,
    `You already have ${existingCount} video(s) queued and tried to add ${incomingCount} more, but the maximum is ${MAX_VIDEOS}. Remove some videos or convert in smaller batches.`,
  )
}

export function metadataFailedError(fileName, cause) {
  return new VideoError(
    VIDEO_ERROR_CODES.VIDEO_METADATA_FAILED,
    `${quoteFileName(fileName)} could not be read by your browser. The file may be corrupt or use an unsupported codec. Try re-exporting it as H.264 MP4.`,
    { cause, fileName },
  )
}

export function metadataTimeoutError(fileName, timeoutMs, cause) {
  return new VideoError(
    VIDEO_ERROR_CODES.VIDEO_METADATA_TIMEOUT,
    `${quoteFileName(fileName)} took longer than ${Math.round(timeoutMs / 1000)} seconds to load. The file may be corrupt or use an unsupported codec. Try re-exporting it as H.264 MP4.`,
    { cause, fileName },
  )
}

export function decodeFailedError(fileName, detail, cause) {
  return new VideoError(
    VIDEO_ERROR_CODES.VIDEO_DECODE_FAILED,
    `${quoteFileName(fileName)} could not be decoded (${detail}). The file may be corrupt or incomplete. Try playing it in your browser first — if it does not play there, conversion cannot work either.`,
    { cause, fileName },
  )
}

export function seekFailedError(fileName, timestamp, cause) {
  return new VideoError(
    VIDEO_ERROR_CODES.VIDEO_SEEK_FAILED,
    `${quoteFileName(fileName)} failed while seeking to ${timestamp.toFixed(2)}s. The file may be corrupt or use an unsupported codec. Try re-exporting it as H.264 MP4.`,
    { cause, fileName },
  )
}

export function seekTimeoutError(fileName, timestamp, timeoutMs, cause) {
  return new VideoError(
    VIDEO_ERROR_CODES.VIDEO_SEEK_TIMEOUT,
    `${quoteFileName(fileName)} stalled while seeking to ${timestamp.toFixed(2)}s (over ${Math.round(timeoutMs / 1000)} seconds). The file may be corrupt. Try re-exporting it as H.264 MP4.`,
    { cause, fileName },
  )
}

export function frameLimitError(totalFrames) {
  return new VideoError(
    VIDEO_ERROR_CODES.FRAME_LIMIT,
    `This selection needs ${totalFrames.toLocaleString()} frames, but the maximum is ${MAX_FRAMES.toLocaleString()}. Lower the FPS, use fewer/shorter videos, or convert in smaller batches.`,
  )
}

export function durationLimitError(fileName, durationSeconds) {
  return new VideoError(
    VIDEO_ERROR_CODES.DURATION_LIMIT,
    `${quoteFileName(fileName)} is ${formatDuration(durationSeconds)}, but the maximum supported duration is ${formatDuration(MAX_VIDEO_DURATION_SECONDS)}. Use a shorter clip.`,
    { fileName },
  )
}

export function resolutionLimitError(fileName, width, height) {
  return new VideoError(
    VIDEO_ERROR_CODES.RESOLUTION_LIMIT,
    `${quoteFileName(fileName)} is ${width}×${height}, but the maximum supported resolution is ${MAX_VIDEO_WIDTH}×${MAX_VIDEO_HEIGHT}. Downscale the video and try again.`,
    { fileName },
  )
}

export function cancelledError() {
  return new VideoError(VIDEO_ERROR_CODES.CANCELLED, 'Conversion cancelled.')
}

export function pdfGenerationFailedError(cause) {
  return new VideoError(
    VIDEO_ERROR_CODES.PDF_GENERATION_FAILED,
    'The PDF could not be generated. Your browser may be low on memory — try fewer videos or a lower FPS.',
    { cause },
  )
}
