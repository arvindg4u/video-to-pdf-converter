import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clampFps,
  computeFrameTimestamps,
  countFrames,
  planQueueFrames,
} from '../src/video/videoSampling.js'
import { VIDEO_ERROR_CODES } from '../src/video/errors.js'

// --- Sampling rule: timestamps = k/fps while t < duration, 0 included. ---

test('normal video: floor(duration × fps) timestamps starting at 0', () => {
  assert.deepEqual(computeFrameTimestamps(10, 1), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.equal(countFrames(10, 1), 10)
  assert.deepEqual(computeFrameTimestamps(2.5, 2), [0, 0.5, 1, 1.5, 2])
  assert.equal(countFrames(2.5, 2), 5)
})

test('no timestamp reaches duration: no duplicate final frame', () => {
  for (const [duration, fps] of [[2, 3], [10, 6], [0.9, 1], [7.33, 4], [60, 6]]) {
    const timestamps = computeFrameTimestamps(duration, fps)
    assert.equal(timestamps.length, Math.floor(duration * fps) || 1)
    assert.ok(timestamps.every((t) => t < duration), `${duration}s @ ${fps}fps`)
    assert.equal(timestamps[0], 0)
    // Strictly increasing: no accidental duplicates.
    for (let i = 1; i < timestamps.length; i++) {
      assert.ok(timestamps[i] > timestamps[i - 1])
    }
  }
})

test('exact-boundary durations do not sample at the end', () => {
  // duration × fps is an integer: last stamp must still be < duration.
  // (Compared with float tolerance: index × (1/fps) differs from k/fps
  // literals by ~1 ulp, which is irrelevant to decoder seeks.)
  const actual = computeFrameTimestamps(2, 3)
  const expected = [0, 1 / 3, 2 / 3, 1, 4 / 3, 5 / 3]
  assert.equal(actual.length, expected.length)
  actual.forEach((t, i) => assert.ok(Math.abs(t - expected[i]) < 1e-9, `stamp ${i}`))
  assert.ok(actual.every((t) => t < 2))
  assert.deepEqual(computeFrameTimestamps(1, 1), [0])
})

test('very short videos yield exactly one frame at t=0', () => {
  assert.deepEqual(computeFrameTimestamps(0.4, 1), [0])
  assert.deepEqual(computeFrameTimestamps(0.01, 6), [0])
  assert.equal(countFrames(0.4, 1), 1)
})

test('FPS above source temporal resolution stays deterministic', () => {
  // 1s clip at 6 FPS: 6 evenly spaced stamps (some frames may look alike,
  // but the count and spacing are exact).
  const timestamps = computeFrameTimestamps(1, 6)
  assert.equal(timestamps.length, 6)
  timestamps.forEach((t, i) => assert.ok(Math.abs(t - i / 6) < 1e-9))
})

test('FPS is clamped to the supported slider range', () => {
  assert.equal(clampFps(0), 1)
  assert.equal(clampFps(99), 6)
  assert.equal(clampFps(2.9), 2)
  assert.equal(clampFps(Number.NaN), 1)
  assert.equal(countFrames(10, 99), 60)
  assert.equal(countFrames(10, 0), 10)
})

test('zero, negative, NaN, and infinite durations are rejected', () => {
  for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => countFrames(duration, 1, 'clip.mp4'), (error) => {
      assert.equal(error.code, VIDEO_ERROR_CODES.VIDEO_DECODE_FAILED)
      assert.match(error.message, /clip\.mp4/)
      return true
    })
    assert.throws(() => computeFrameTimestamps(duration, 1, 'clip.mp4'))
  }
})

test('queue planning sums per-video counts with no off-by-one', () => {
  const plan = planQueueFrames(
    [
      { fileName: 'a.mp4', duration: 10 },
      { fileName: 'b.mp4', duration: 2.5 },
      { fileName: 'c.mp4', duration: 0.4 },
    ],
    2,
  )
  assert.deepEqual(plan.map((p) => p.frameCount), [20, 5, 1])
  assert.equal(plan.reduce((sum, p) => sum + p.frameCount, 0), 26)
})
