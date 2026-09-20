/**
 * Robust HTMLVideoElement lifecycle helpers.
 *
 * Every promise returned here settles exactly once: each operation cleans up
 * its listeners/timers, honors an AbortSignal, and has a finite timeout, so
 * no seek or metadata load can remain pending forever — even for corrupt
 * files or wedged decoders.
 *
 * Element factories and URL functions are injectable so the timeout / abort /
 * error paths are unit-testable in Node without a DOM.
 */

import { METADATA_TIMEOUT_MS, SEEK_TIMEOUT_MS } from './constants.js'
import {
  cancelledError,
  decodeFailedError,
  metadataFailedError,
  metadataTimeoutError,
  seekFailedError,
  seekTimeoutError,
  toVideoError,
} from './errors.js'

function defaultCreateVideoElement() {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  return video
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancelledError()
}

/**
 * Load decodable metadata for one file.
 *
 * Resolves only after `loadedmetadata` with a validated handle:
 * finite duration, non-zero dimensions. Rejects on decoder `error`, on
 * timeout, or on abort — disposing the element and revoking the object URL
 * on every failure path so corrupt files never leak resources.
 *
 * The caller owns `handle.dispose()` on success (typically in a finally).
 *
 * @returns {Promise<{element, objectUrl, duration, videoWidth, videoHeight, dispose}>}
 */
export function loadVideoMetadata(
  file,
  {
    signal,
    timeoutMs = METADATA_TIMEOUT_MS,
    createVideoElement = defaultCreateVideoElement,
    createObjectURL = (blob) => URL.createObjectURL(blob),
    revokeObjectURL = (url) => URL.revokeObjectURL(url),
  } = {},
) {
  throwIfAborted(signal)

  const video = createVideoElement()
  const objectUrl = createObjectURL(file)
  let settled = false

  const dispose = () => {
    try {
      video.pause?.()
    } catch {
      // Element may already be detached; teardown must never throw.
    }
    try {
      video.removeAttribute?.('src')
      video.srcObject = null
      if (typeof video.load === 'function') video.load()
    } catch {
      // Best-effort decoder release.
    }
    try {
      revokeObjectURL(objectUrl)
    } catch {
      // Revoke is idempotent-safe; ignore double-revoke errors.
    }
  }

  return new Promise((resolve, reject) => {
    const finish = (callback, value, { keepAlive = false } = {}) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeEventListener?.('loadedmetadata', onLoadedMetadata)
      video.removeEventListener?.('error', onError)
      signal?.removeEventListener?.('abort', onAbort)
      if (!keepAlive) dispose()
      callback(value)
    }

    const onLoadedMetadata = () => {
      const duration = video.duration
      const videoWidth = video.videoWidth
      const videoHeight = video.videoHeight
      if (!Number.isFinite(duration) || duration <= 0) {
        finish(
          reject,
          decodeFailedError(file?.name || 'video', 'unknown duration'),
        )
        return
      }
      if (!videoWidth || !videoHeight) {
        finish(
          reject,
          decodeFailedError(file?.name || 'video', 'no video track'),
        )
        return
      }
      // Keep the element + object URL alive for frame extraction; the caller
      // must call dispose(). No listeners remain attached after finish().
      finish(
        (handle) => resolve(handle),
        {
          element: video,
          objectUrl,
          duration,
          videoWidth,
          videoHeight,
          dispose: () => {
            video.removeEventListener?.('loadedmetadata', onLoadedMetadata)
            video.removeEventListener?.('error', onError)
            dispose()
          },
        },
        { keepAlive: true },
      )
    }

    const onError = () => {
      finish(reject, metadataFailedError(file?.name || 'video'))
    }

    const onAbort = () => {
      finish(reject, cancelledError())
    }

    const onTimeout = () => {
      finish(
        reject,
        metadataTimeoutError(file?.name || 'video', timeoutMs),
      )
    }

    const timer = setTimeout(onTimeout, timeoutMs)
    video.addEventListener?.('loadedmetadata', onLoadedMetadata)
    video.addEventListener?.('error', onError)
    signal?.addEventListener?.('abort', onAbort, { once: true })

    try {
      video.src = objectUrl
      if (typeof video.load === 'function' && !video.src) video.load()
    } catch (error) {
      finish(reject, toVideoError(error, file?.name))
    }
  })
}

/**
 * Seek a loaded video element to `timestamp` seconds.
 *
 * - Validates/clamps the timestamp (finite, >= 0).
 * - Fast-paths when already at the target with data available, since some
 *   browsers never fire `seeked` for a no-op seek.
 * - Waits for `seeked`, rejects on `error`, timeout, or abort.
 * - Always removes its listeners — repeated seeks never stack stale handlers.
 */
export function seekToTime(
  video,
  timestamp,
  {
    signal,
    timeoutMs = SEEK_TIMEOUT_MS,
    fileName = 'video',
    nowAtTargetEpsilon = 0.001,
  } = {},
) {
  throwIfAborted(signal)

  const target = Number(timestamp)
  if (!Number.isFinite(target) || target < 0) {
    return Promise.reject(
      seekFailedError(fileName, Number.isFinite(target) ? target : 0),
    )
  }

  const readyState = video.readyState ?? 0
  const currentTime = Number(video.currentTime ?? NaN)
  const hasData = readyState >= 2 // HAVE_CURRENT_DATA
  if (hasData && Number.isFinite(currentTime) && Math.abs(currentTime - target) < nowAtTargetEpsilon) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    let settled = false

    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeEventListener?.('seeked', onSeeked)
      video.removeEventListener?.('error', onError)
      signal?.removeEventListener?.('abort', onAbort)
      callback(value)
    }

    const onSeeked = () => finish(resolve, undefined)
    const onError = () => finish(reject, seekFailedError(fileName, target))
    const onAbort = () => finish(reject, cancelledError())
    const onTimeout = () =>
      finish(reject, seekTimeoutError(fileName, target, timeoutMs))

    const timer = setTimeout(onTimeout, timeoutMs)
    video.addEventListener?.('seeked', onSeeked)
    video.addEventListener?.('error', onError)
    signal?.addEventListener?.('abort', onAbort, { once: true })

    try {
      video.currentTime = target
    } catch (error) {
      finish(reject, toVideoError(error, fileName))
    }
  })
}
