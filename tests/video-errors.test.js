import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VIDEO_ERROR_CODES,
  VideoError,
  cancelledError,
  durationLimitError,
  fileTooLargeError,
  formatBytes,
  formatDuration,
  frameLimitError,
  isCancellation,
  metadataTimeoutError,
  pdfGenerationFailedError,
  queueLimitError,
  resolutionLimitError,
  seekTimeoutError,
  toVideoError,
  unsupportedFormatError,
} from '../src/video/errors.js'

test('VideoError carries code, message, fileName, and cause', () => {
  const cause = new Error('boom')
  const error = new VideoError('X', 'msg', { cause, fileName: 'a.mp4' })
  assert.equal(error.code, 'X')
  assert.equal(error.fileName, 'a.mp4')
  assert.equal(error.cause, cause)
  assert.ok(error instanceof Error)
})

test('every documented error code exists exactly once', () => {
  assert.deepEqual(Object.keys(VIDEO_ERROR_CODES).sort(), [
    'CANCELLED',
    'DURATION_LIMIT',
    'FILE_TOO_LARGE',
    'FRAME_LIMIT',
    'INVALID_FILE',
    'PDF_GENERATION_FAILED',
    'QUEUE_LIMIT',
    'RESOLUTION_LIMIT',
    'UNSUPPORTED_FORMAT',
    'VIDEO_DECODE_FAILED',
    'VIDEO_METADATA_FAILED',
    'VIDEO_METADATA_TIMEOUT',
    'VIDEO_SEEK_FAILED',
    'VIDEO_SEEK_TIMEOUT',
    'UNKNOWN',
  ].sort())
})

test('limit messages state current value, allowed value, and remedy', () => {
  const duration = durationLimitError('long.mp4', 42 * 60)
  assert.equal(duration.code, VIDEO_ERROR_CODES.DURATION_LIMIT)
  assert.match(duration.message, /long\.mp4/)
  assert.match(duration.message, /42\.0 minutes/)
  assert.match(duration.message, /30\.0 minutes/)
  assert.match(duration.message, /shorter/i)

  const frames = frameLimitError(2500)
  assert.equal(frames.code, VIDEO_ERROR_CODES.FRAME_LIMIT)
  assert.match(frames.message, /2,500/)
  assert.match(frames.message, /1,000/)
  assert.match(frames.message, /FPS/i)

  const resolution = resolutionLimitError('huge.mp4', 7680, 4320)
  assert.match(resolution.message, /7680×4320/)
  assert.match(resolution.message, /3840×2160/)

  const size = fileTooLargeError({ name: 'big.mp4', size: 3 * 1024 ** 3 })
  assert.match(size.message, /3\.0 GB/)
  assert.match(size.message, /2\.0 GB/)

  const queue = queueLimitError(3, 19)
  assert.match(queue.message, /19/)
  assert.match(queue.message, /20/)

  const format = unsupportedFormatError({ name: 'c.mov', type: 'video/quicktime' })
  assert.match(format.message, /c\.mov/)
  assert.match(format.message, /video\/quicktime/)
  assert.match(format.message, /\.mp4/)
})

test('timeout errors name the file, stall point, and budget', () => {
  const meta = metadataTimeoutError('stuck.mp4', 15_000)
  assert.equal(meta.code, VIDEO_ERROR_CODES.VIDEO_METADATA_TIMEOUT)
  assert.match(meta.message, /15 seconds/)

  const seek = seekTimeoutError('stuck.mp4', 3.25, 10_000)
  assert.equal(seek.code, VIDEO_ERROR_CODES.VIDEO_SEEK_TIMEOUT)
  assert.match(seek.message, /3\.25s/)
  assert.match(seek.message, /10 seconds/)
})

test('cancellation is detectable and never an error alert', () => {
  assert.equal(isCancellation(cancelledError()), true)
  assert.equal(isCancellation(new Error('x')), false)
  assert.equal(isCancellation(pdfGenerationFailedError(new Error('x'))), false)
})

test('toVideoError preserves VideoErrors, AbortErrors, and wraps the rest', () => {
  const videoError = frameLimitError(5)
  assert.equal(toVideoError(videoError), videoError)

  const abort = new DOMException('aborted', 'AbortError')
  assert.equal(toVideoError(abort, 'a.mp4').code, VIDEO_ERROR_CODES.CANCELLED)

  const wrapped = toVideoError(new Error('raw failure'), 'b.mp4')
  assert.equal(wrapped.code, VIDEO_ERROR_CODES.UNKNOWN)
  assert.equal(wrapped.fileName, 'b.mp4')
  assert.match(wrapped.cause.message, /raw failure/)
  assert.doesNotMatch(wrapped.message, /raw failure/) // no raw leaks to UI
})

test('formatters handle edge inputs without crashing', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(Number.NaN), 'unknown size')
  assert.equal(formatDuration(30), '30.0 seconds')
  assert.equal(formatDuration(90), '1.5 minutes')
  assert.equal(formatDuration(Number.POSITIVE_INFINITY), 'unknown length')
})
