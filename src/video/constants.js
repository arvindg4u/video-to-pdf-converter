/**
 * Resource guardrails for the browser-only video → PDF pipeline.
 *
 * Rationale for each value:
 *
 * - MAX_VIDEOS (20): preserves the long-standing product limit. The queue UI,
 *   progress copy, and merged-PDF workflow were all designed around it.
 * - MAX_FRAMES (1000): bounds peak memory and conversion time. Each frame is a
 *   full-resolution JPEG held transiently plus its bytes inside the jsPDF
 *   document, so 1000 frames keeps the final PDF in the tens-of-MB range on
 *   typical 1080p content instead of exhausting tab memory.
 * - MAX_VIDEO_DURATION_SECONDS (1800 = 30 min): seeking/decoding very long
 *   files in a tab is slow and flaky (keyframe distance, evicted buffers).
 *   30 minutes covers lectures/demos while rejecting effectively unbounded
 *   inputs before any expensive work starts.
 * - MAX_VIDEO_FILE_BYTES (2 GiB): a practical tab-memory guard. The file is
 *   decoded from a blob URL, so multi-GB inputs risk OOM crashes; 2 GiB is far
 *   above legitimate phone/camera clips for frame extraction.
 * - MAX_VIDEO_WIDTH/HEIGHT (3840×2160): 4K sources are accepted, but frames
 *   are downscaled to MAX_OUTPUT_DIMENSION before embedding so one 8K file
 *   cannot blow up canvas memory or produce a gigabyte PDF.
 * - MAX_OUTPUT_DIMENSION (1920): longest edge of an embedded frame image.
 *   1920px still looks sharp on a printed A4/Letter page while keeping each
 *   JPEG around a few hundred KB.
 * - METADATA_TIMEOUT_MS (15s) / SEEK_TIMEOUT_MS (10s): local blob decoding is
 *   normally near-instant. If `loadedmetadata`/`seeked` has not fired within
 *   these windows the file is corrupt, uses an unsupported codec, or the
 *   decoder is wedged — fail fast instead of hanging forever.
 * - MIN_FPS / MAX_FPS (1–6): preserves the existing slider range. Higher FPS
 *   values explode frame counts (and usually duplicate near-identical frames).
 * - JPEG_QUALITY (0.85): visually near-lossless for slides/talking-head
 *   content at roughly half the byte size of 0.95+.
 */

export const MAX_VIDEOS = 20
export const MAX_FRAMES = 1000
export const MAX_VIDEO_DURATION_SECONDS = 30 * 60
export const MAX_VIDEO_FILE_BYTES = 2 * 1024 * 1024 * 1024
export const MAX_VIDEO_WIDTH = 3840
export const MAX_VIDEO_HEIGHT = 2160
export const MAX_OUTPUT_DIMENSION = 1920

export const METADATA_TIMEOUT_MS = 15_000
export const SEEK_TIMEOUT_MS = 10_000

export const MIN_FPS = 1
export const MAX_FPS = 6

export const JPEG_QUALITY = 0.85
export const JPEG_MIME_TYPE = 'image/jpeg'

/** Smallest playable duration we attempt to sample (anything above 0 works). */
export const MIN_PLAYABLE_DURATION_SECONDS = 0

/** Page margin (mm) around a fitted video frame. */
export const PDF_PAGE_MARGIN_MM = 10
