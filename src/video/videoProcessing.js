/**
 * Conversion controller: orchestrates metadata → sampling → rendering → PDF.
 *
 * Pipeline (all steps honor `signal` for cancellation):
 *
 *   planConversion (pass 1, cheap)
 *     load metadata per video → duration/resolution guards → frame counts
 *     → total frame-limit guard. Each video element is disposed immediately
 *     so peak memory is one decoder, not N.
 *
 *   renderConversion (pass 2, expensive)
 *     one reused canvas → per video: load metadata, seek each deterministic
 *     timestamp, draw, append one fitted PDF page. Frame JPEG strings are
 *     released right after embedding; nothing accumulates.
 *
 * Two metadata passes (instead of holding N decoders open) is a deliberate
 * trade-off: header parsing is milliseconds, while 20 live decoders + blob
 * URLs risk real memory pressure. Every resource (video elements, object
 * URLs, canvas backing store) is released in `finally` blocks on success,
 * failure, AND cancellation.
 *
 * UI responsiveness: every frame awaits a real seek (macrotask I/O), so the
 * event loop — and therefore React paints and the Cancel button — is never
 * starved. Progress callbacks fire per frame; the React layer throttles
 * setState (see App.jsx).
 *
 * All-or-nothing output: one corrupt video aborts the whole merged PDF with
 * a NAMED error (`fileName` on every VideoError), and no partial download is
 * ever produced. The caller decides whether to keep or clear the queue.
 */

import {
  JPEG_MIME_TYPE,
  JPEG_QUALITY,
  MAX_FRAMES,
  MAX_OUTPUT_DIMENSION,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_HEIGHT,
  MAX_VIDEO_WIDTH,
} from './constants.js'
import {
  VIDEO_ERROR_CODES,
  VideoError,
  cancelledError,
  durationLimitError,
  frameLimitError,
  pdfGenerationFailedError,
  resolutionLimitError,
  toVideoError,
} from './errors.js'
import { loadVideoMetadata, seekToTime } from './videoLoader.js'
import { clampFps, computeFrameTimestamps } from './videoSampling.js'
import { addVideoFrame, createVideoPdf } from './pdfWriter.js'

export const DEFAULT_DEPS = {
  loadVideo: loadVideoMetadata,
  seek: seekToTime,
  createCanvas: () => document.createElement('canvas'),
  createPdf: createVideoPdf,
  addFrame: addVideoFrame,
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancelledError()
}

function outputSize(videoWidth, videoHeight) {
  const longest = Math.max(videoWidth, videoHeight)
  const scale = Math.min(1, MAX_OUTPUT_DIMENSION / longest)
  return {
    width: Math.max(1, Math.round(videoWidth * scale)),
    height: Math.max(1, Math.round(videoHeight * scale)),
    scaled: scale < 1,
  }
}

/**
 * Pass 1: validate every video can be decoded within limits and compute the
 * exact total frame count. Rejects before any canvas/PDF work exists.
 */
export async function planConversion(
  files,
  { fps = 1, signal, loadVideo = DEFAULT_DEPS.loadVideo } = {},
) {
  throwIfAborted(signal)
  if (!Array.isArray(files) || files.length === 0) {
    throw new VideoError(
      VIDEO_ERROR_CODES.INVALID_FILE,
      'Choose at least one .mp4 video to convert.',
    )
  }

  const safeFps = clampFps(fps)
  const plan = []
  let totalFrames = 0

  for (let index = 0; index < files.length; index++) {
    throwIfAborted(signal)
    const file = files[index]
    const handle = await loadVideo(file, { signal })
    try {
      throwIfAborted(signal)
      if (handle.duration > MAX_VIDEO_DURATION_SECONDS) {
        throw durationLimitError(file.name, handle.duration)
      }
      if (
        handle.videoWidth > MAX_VIDEO_WIDTH ||
        handle.videoHeight > MAX_VIDEO_HEIGHT
      ) {
        throw resolutionLimitError(file.name, handle.videoWidth, handle.videoHeight)
      }
      const timestamps = computeFrameTimestamps(handle.duration, safeFps, file.name)
      plan.push({
        file,
        duration: handle.duration,
        videoWidth: handle.videoWidth,
        videoHeight: handle.videoHeight,
        timestamps,
      })
      totalFrames += timestamps.length
    } finally {
      handle.dispose()
    }
  }

  if (totalFrames > MAX_FRAMES) {
    throw frameLimitError(totalFrames)
  }

  return { plan, totalFrames, fps: safeFps }
}

/**
 * Full conversion. Resolves with the finished (unsaved) PDF document plus
 * per-video frame counts; the caller owns `pdf.save()` so cancellation and
 * failure paths can never trigger a partial download.
 */
export async function convertVideosToPdf(
  files,
  {
    fps = 1,
    paper = 'A4',
    includeLabels = true,
    signal,
    onProgress,
    loadVideo = DEFAULT_DEPS.loadVideo,
    seek = DEFAULT_DEPS.seek,
    createCanvas = DEFAULT_DEPS.createCanvas,
    createPdf = DEFAULT_DEPS.createPdf,
    addFrame = DEFAULT_DEPS.addFrame,
  } = {},
) {
  const { plan, totalFrames, fps: safeFps } = await planConversion(files, {
    fps,
    signal,
    loadVideo,
  })

  const emit = (update) => {
    try {
      onProgress?.({ totalFrames, fps: safeFps, ...update })
    } catch {
      // Progress listeners must never break conversion.
    }
  }

  const canvas = createCanvas()
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw pdfGenerationFailedError(
      new Error('2D canvas context is unavailable in this browser'),
    )
  }
  const pdf = createPdf(paper)
  const perVideo = []
  let processedFrames = 0

  try {
    for (let videoIndex = 0; videoIndex < plan.length; videoIndex++) {
      throwIfAborted(signal)
      const entry = plan[videoIndex]
      const { file, timestamps } = entry

      emit({
        phase: 'rendering',
        videoIndex: videoIndex + 1,
        videoCount: plan.length,
        fileName: file.name,
        processedFrames,
      })

      const handle = await loadVideo(file, { signal })
      try {
        const size = outputSize(entry.videoWidth, entry.videoHeight)
        if (canvas.width !== size.width || canvas.height !== size.height) {
          canvas.width = size.width
          canvas.height = size.height
        }

        for (const timestamp of timestamps) {
          throwIfAborted(signal)
          try {
            await seek(handle.element, timestamp, { signal, fileName: file.name })
            throwIfAborted(signal)
            ctx.drawImage(handle.element, 0, 0, canvas.width, canvas.height)
            const frameData = canvas.toDataURL(JPEG_MIME_TYPE, JPEG_QUALITY)
            try {
              addFrame(pdf, {
                imageDataUrl: frameData,
                imageFormat: 'JPEG',
                srcWidth: canvas.width,
                srcHeight: canvas.height,
                paper,
                includeLabel: includeLabels,
                label: `${file.name} · ${timestamp.toFixed(2)}s`,
              })
            } finally {
              // Release the (large) data-URL string immediately; the bytes
              // now live only inside the PDF document.
              void frameData
            }
          } catch (error) {
            if (error instanceof VideoError) throw error
            throw toVideoError(error, file.name)
          }

          processedFrames += 1
          emit({
            phase: 'rendering',
            videoIndex: videoIndex + 1,
            videoCount: plan.length,
            fileName: file.name,
            processedFrames,
          })
        }
      } finally {
        handle.dispose()
      }

      perVideo.push({ fileName: file.name, frameCount: timestamps.length })
    }
  } finally {
    // Release the (potentially large) canvas backing store.
    canvas.width = 1
    canvas.height = 1
  }

  if (processedFrames === 0) {
    throw pdfGenerationFailedError(new Error('no frames were rendered'))
  }

  emit({
    phase: 'complete',
    videoIndex: plan.length,
    videoCount: plan.length,
    processedFrames,
  })

  return { pdf, totalFrames: processedFrames, perVideo }
}
