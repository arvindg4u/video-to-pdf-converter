import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_VIDEOS,
  MAX_VIDEO_FILE_BYTES,
} from '../src/video/constants.js'
import { VIDEO_ERROR_CODES } from '../src/video/errors.js'
import {
  fileIdentity,
  hasMp4Extension,
  isSupportedMp4,
  mergeIntoQueue,
  validateVideoFile,
} from '../src/video/videoValidation.js'

const mp4 = (overrides = {}) => ({
  name: 'clip.mp4',
  type: 'video/mp4',
  size: 1024,
  lastModified: 1,
  ...overrides,
})

test('accepts MIME video/mp4 and .mp4 with missing/unknown MIME', () => {
  assert.equal(isSupportedMp4(mp4()), true)
  assert.equal(isSupportedMp4(mp4({ type: '' })), true)
  assert.equal(isSupportedMp4(mp4({ type: 'application/octet-stream' })), true)
  assert.equal(isSupportedMp4(mp4({ name: 'CLIP.MP4', type: '' })), true)
  assert.equal(validateVideoFile(mp4({ type: '' })).name, 'clip.mp4')
})

test('rejects known non-MP4 formats even with tricky names', () => {
  assert.equal(isSupportedMp4(mp4({ type: 'video/webm' })), false)
  assert.equal(isSupportedMp4(mp4({ type: 'video/quicktime' })), false)
  assert.equal(isSupportedMp4(mp4({ type: 'text/plain' })), false)
  // Unknown MIME but wrong extension: not our format.
  assert.equal(isSupportedMp4(mp4({ name: 'clip.mov', type: '' })), false)
  assert.equal(isSupportedMp4(mp4({ name: 'clip', type: '' })), false)
  assert.throws(() => validateVideoFile(mp4({ type: 'video/webm' })), (error) => {
    assert.equal(error.code, VIDEO_ERROR_CODES.UNSUPPORTED_FORMAT)
    assert.match(error.message, /clip\.mp4/)
    assert.match(error.message, /video\/webm/)
    return true
  })
})

test('rejects empty, oversized, and malformed files with actionable messages', () => {
  assert.throws(() => validateVideoFile(mp4({ size: 0 })), (error) => {
    assert.equal(error.code, VIDEO_ERROR_CODES.INVALID_FILE)
    return true
  })
  assert.throws(() => validateVideoFile(null), (error) => {
    assert.equal(error.code, VIDEO_ERROR_CODES.INVALID_FILE)
    return true
  })
  assert.throws(
    () => validateVideoFile(mp4({ size: MAX_VIDEO_FILE_BYTES + 1 })),
    (error) => {
      assert.equal(error.code, VIDEO_ERROR_CODES.FILE_TOO_LARGE)
      assert.match(error.message, /clip\.mp4/)
      assert.match(error.message, /maximum supported file size/)
      return true
    },
  )
})

test('hasMp4Extension matches case-insensitively at the end only', () => {
  assert.equal(hasMp4Extension('a.mp4'), true)
  assert.equal(hasMp4Extension('a.MP4'), true)
  assert.equal(hasMp4Extension('a.mp4.txt'), false)
  assert.equal(hasMp4Extension('mp4'), false)
  assert.equal(hasMp4Extension(''), false)
})

test('queue merge preserves order and skips deterministic duplicates', () => {
  const first = mp4({ name: 'a.mp4' })
  const second = mp4({ name: 'b.mp4', size: 2048 })
  const merged = mergeIntoQueue([first], [second, { ...first }])
  assert.deepEqual(merged.files.map((f) => f.name), ['a.mp4', 'b.mp4'])
  assert.equal(merged.duplicates, 1)
  assert.equal(merged.accepted.length, 1)
  assert.equal(merged.rejected.length, 0)
  // Same name but different size is a different file, not a duplicate.
  const again = mergeIntoQueue([first], [mp4({ name: 'a.mp4', size: 999 })])
  assert.equal(again.accepted.length, 1)
})

test('queue merge partially accepts: valid files queue, invalid are named', () => {
  const merged = mergeIntoQueue([], [
    mp4({ name: 'good.mp4' }),
    mp4({ name: 'bad.webm', type: 'video/webm' }),
  ])
  assert.deepEqual(merged.files.map((f) => f.name), ['good.mp4'])
  assert.equal(merged.rejected.length, 1)
  assert.equal(merged.rejected[0].error.code, VIDEO_ERROR_CODES.UNSUPPORTED_FORMAT)
  assert.equal(merged.rejected[0].error.fileName, 'bad.webm')
})

test('queue merge enforces MAX_VIDEOS without mutating the existing queue', () => {
  const existing = Array.from({ length: MAX_VIDEOS }, (_, i) =>
    mp4({ name: `v${i}.mp4`, size: 100 + i }),
  )
  assert.throws(() => mergeIntoQueue(existing, [mp4({ name: 'extra.mp4' })]), (error) => {
    assert.equal(error.code, VIDEO_ERROR_CODES.QUEUE_LIMIT)
    assert.match(error.message, new RegExp(String(MAX_VIDEOS)))
    return true
  })
  assert.equal(existing.length, MAX_VIDEOS)
})

test('fileIdentity combines name, size, and modification time', () => {
  assert.equal(fileIdentity(mp4()), fileIdentity(mp4()))
  assert.notEqual(fileIdentity(mp4()), fileIdentity(mp4({ size: 2 })))
})
