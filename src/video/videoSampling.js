/**
 * Deterministic frame sampling.
 *
 * SAMPLING RULE (documented contract, also in README):
 *
 *   timestamps = [0/fps, 1/fps, 2/fps, ..., (n-1)/fps]
 *   where n = floor(duration × fps)
 *
 * - Timestamp 0 IS included (the first frame of the video).
 * - Every timestamp is strictly less than `duration`, so we never seek at or
 *   beyond the end of the stream (which is unreliable across browsers) and
 *   never emit an accidental duplicate final frame.
 * - `n` is exactly the number of frames the video contributes, so totals are
 *   `sum(n)` across the queue — no off-by-one errors with multiple videos.
 * - Very short but playable videos (0 < duration, yet floor(duration × fps)
 *   === 0) contribute exactly ONE frame at t=0 instead of erroring, so a
 *   valid 0.4s clip at 1 FPS still converts.
 * - FPS above the source's temporal resolution yields deterministically
 *   spaced timestamps; some frames may look identical (the decoder holds the
 *   nearest decoded frame), but the count stays predictable.
 * - Non-finite or non-positive durations/distances are rejected so a corrupt
 *   `video.duration` (NaN/Infinity) can never silently produce an empty PDF.
 */

import { MAX_FPS, MIN_FPS } from './constants.js'
import { decodeFailedError } from './errors.js'

export function clampFps(fps) {
  const value = Math.floor(Number(fps))
  if (!Number.isFinite(value)) return MIN_FPS
  return Math.min(MAX_FPS, Math.max(MIN_FPS, value))
}

function assertFinitePositiveDuration(duration, fileName) {
  if (typeof duration !== 'number' || !Number.isFinite(duration)) {
    throw decodeFailedError(fileName, 'unknown duration')
  }
  if (duration <= 0) {
    throw decodeFailedError(fileName, `duration of ${duration}s`)
  }
}

/**
 * Number of frames sampled from one video. Pure and total-order safe.
 * @throws {VideoError} VIDEO_DECODE_FAILED for unusable durations.
 */
export function countFrames(duration, fps, fileName = 'video') {
  assertFinitePositiveDuration(duration, fileName)
  const count = Math.floor(duration * clampFps(fps))
  return count > 0 ? count : 1
}

/**
 * Exact seek timestamps (seconds) for one video.
 * @throws {VideoError} VIDEO_DECODE_FAILED for unusable durations.
 */
export function computeFrameTimestamps(duration, fps, fileName = 'video') {
  const count = countFrames(duration, fps, fileName)
  if (count === 1 && duration * clampFps(fps) < 1) {
    // Very short video: one representative frame at the start.
    return [0]
  }
  const step = 1 / clampFps(fps)
  const timestamps = new Array(count)
  for (let index = 0; index < count; index++) {
    // (count-1) × step < duration by construction; the Math.min is float
    // safety so a rounding artifact can never seek past the end.
    timestamps[index] = Math.min(index * step, duration)
  }
  return timestamps
}

/**
 * Planned frame counts for a queue of videos. Each entry keeps the file's
 * identity so errors and progress can name the exact video.
 */
export function planQueueFrames(durations, fps) {
  return durations.map(({ fileName, duration }) => ({
    fileName,
    frameCount: countFrames(duration, fps, fileName),
  }))
}
