/**
 * Pre-decode validation for queued files.
 *
 * MP4 acceptance rule:
 * - MIME `video/mp4` (authoritative) → accepted regardless of extension, OR
 * - `.mp4` extension + missing/unknown MIME (`''` or `application/octet-stream`,
 *   which is what browsers report when they cannot sniff a type) → accepted.
 * - Anything else (known non-MP4 MIME, wrong extension) → rejected.
 *
 * This keeps `.mp4` the only supported format while tolerating platforms that
 * omit MIME types on file pick / drag-drop. Files that pass here are still
 * validated by real browser decoding (`loadedmetadata` + finite duration +
 * non-zero dimensions) before any frame work begins, so renamed garbage fails
 * fast with a named error instead of hanging.
 */

import { MAX_VIDEOS, MAX_VIDEO_FILE_BYTES } from './constants.js'
import {
  fileTooLargeError,
  invalidFileError,
  queueLimitError,
  unsupportedFormatError,
} from './errors.js'

export const ACCEPTED_VIDEO_MIME = 'video/mp4'
export const ACCEPTED_VIDEO_EXTENSION = '.mp4'

/** MIME types browsers use when the real type is unknown. */
const UNKNOWN_MIME_TYPES = new Set(['', 'application/octet-stream'])

export function hasMp4Extension(fileName) {
  return /\.mp4$/i.test(fileName || '')
}

export function isSupportedMp4(file) {
  if (!file || typeof file.name !== 'string') return false
  if (file.type === ACCEPTED_VIDEO_MIME) return true
  return hasMp4Extension(file.name) && UNKNOWN_MIME_TYPES.has(file.type || '')
}

/** File identity for deterministic duplicate detection. */
export function fileIdentity(file) {
  return `${file.name}|${file.size}|${file.lastModified}`
}

/**
 * Validate a single file before it enters the queue.
 * @throws {VideoError} INVALID_FILE | UNSUPPORTED_FORMAT | FILE_TOO_LARGE
 */
export function validateVideoFile(file) {
  if (!file || typeof file !== 'object' || typeof file.name !== 'string') {
    throw invalidFileError('unknown file', 'missing file metadata')
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw invalidFileError(file.name, 'empty file')
  }
  if (!isSupportedMp4(file)) {
    throw unsupportedFormatError(file)
  }
  if (file.size > MAX_VIDEO_FILE_BYTES) {
    throw fileTooLargeError(file)
  }
  return file
}

/**
 * Merge newly picked files into the existing queue.
 *
 * - Deterministic order: existing files first, then new files in pick order.
 * - Duplicates (same name + size + lastModified) are skipped, never duplicated.
 * - Invalid newcomers are collected into `rejected` with named errors; valid
 *   ones are still queued (partial acceptance at pick time — conversion itself
 *   stays all-or-nothing per the merged-PDF product requirement).
 *
 * @throws {VideoError} QUEUE_LIMIT when the merge would exceed MAX_VIDEOS.
 */
export function mergeIntoQueue(existingFiles, incomingFiles) {
  const seen = new Set(existingFiles.map(fileIdentity))
  const accepted = []
  const rejected = []
  let duplicates = 0

  for (const file of incomingFiles) {
    if (seen.has(fileIdentity(file))) {
      duplicates += 1
      continue
    }
    try {
      validateVideoFile(file)
      seen.add(fileIdentity(file))
      accepted.push(file)
    } catch (error) {
      rejected.push({ file, error })
    }
  }

  if (existingFiles.length + accepted.length > MAX_VIDEOS) {
    throw queueLimitError(accepted.length, existingFiles.length)
  }

  return {
    files: [...existingFiles, ...accepted],
    accepted,
    rejected,
    duplicates,
  }
}
