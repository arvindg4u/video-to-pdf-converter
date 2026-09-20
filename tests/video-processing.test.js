import test from 'node:test'
import assert from 'node:assert/strict'
import { convertVideosToPdf, planConversion } from '../src/video/videoProcessing.js'
import { addVideoFrame, createVideoPdf } from '../src/video/pdfWriter.js'
import { VIDEO_ERROR_CODES, VideoError } from '../src/video/errors.js'
import { MAX_FRAMES } from '../src/video/constants.js'

const TINY_JPEG_DATA_URL = `data:image/jpeg;base64,${Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01,
  0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
]).toString('base64')}`

const file = (name, size = 1024) => ({ name, type: 'video/mp4', size, lastModified: 7 })

/** Programmable decode backend: durations, dimensions, failures per file. */
function makeLoaderBackend(specs) {
  const state = { loads: 0, disposes: 0, seeks: [] }
  const loadVideo = async (f, { signal } = {}) => {
    state.loads += 1
    if (signal?.aborted) {
      throw new VideoError('CANCELLED', 'cancelled')
    }
    const spec = specs[f.name]
    if (!spec) throw new Error(`no spec for ${f.name}`)
    if (spec.error) throw spec.error
    if (signal?.aborted) throw new VideoError('CANCELLED', 'cancelled')
    return {
      element: { fileName: f.name },
      duration: spec.duration,
      videoWidth: spec.width,
      videoHeight: spec.height,
      dispose: () => {
        state.disposes += 1
      },
    }
  }
  const seek = async (element, timestamp, { signal } = {}) => {
    if (signal?.aborted) throw new VideoError('CANCELLED', 'cancelled')
    if (specs[element.fileName]?.seekError) throw specs[element.fileName].seekError
    await new Promise((resolve) => setTimeout(resolve, specs.seekDelayMs || 0))
    if (signal?.aborted) throw new VideoError('CANCELLED', 'cancelled')
    state.seeks.push({ file: element.fileName, timestamp })
  }
  return { state, loadVideo, seek }
}

function makeCanvasStub(frames) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: () => {} }),
    toDataURL: () => TINY_JPEG_DATA_URL,
  }
  return canvas
}

function makePdfStub() {
  const calls = []
  return {
    calls,
    createPdf: () => ({ stub: true }),
    addFrame: (pdf, options) => {
      calls.push(options)
    },
  }
}

// --- Planning: guards run before any canvas/PDF work ---

test('plan computes exact per-video totals for a queue', async () => {
  const backend = makeLoaderBackend({
    'a.mp4': { duration: 10, width: 640, height: 360 },
    'b.mp4': { duration: 2.5, width: 640, height: 360 },
  })
  const { plan, totalFrames } = await planConversion([file('a.mp4'), file('b.mp4')], {
    fps: 2,
    loadVideo: backend.loadVideo,
  })
  assert.equal(totalFrames, 25)
  assert.deepEqual(plan.map((p) => p.timestamps.length), [20, 5])
  assert.equal(backend.state.loads, 2)
  assert.equal(backend.state.disposes, 2) // disposed immediately after planning
})

test('plan rejects over-limit queues before rendering anything', async () => {
  const backend = makeLoaderBackend({ 'a.mp4': { duration: 600, width: 640, height: 360 } })
  await assert.rejects(
    planConversion([file('a.mp4')], { fps: 6, loadVideo: backend.loadVideo }),
    (error) => {
      assert.equal(error.code, VIDEO_ERROR_CODES.FRAME_LIMIT)
      assert.match(error.message, new RegExp(MAX_FRAMES.toLocaleString()))
      return true
    },
  )
  assert.equal(backend.state.disposes, 1)
})

test('plan enforces duration and resolution limits with the file named', async () => {
  const long = makeLoaderBackend({ 'long.mp4': { duration: 3600, width: 640, height: 360 } })
  await assert.rejects(
    planConversion([file('long.mp4')], { loadVideo: long.loadVideo }),
    (error) => error.code === VIDEO_ERROR_CODES.DURATION_LIMIT && /long\.mp4/.test(error.message),
  )
  const huge = makeLoaderBackend({ 'huge.mp4': { duration: 5, width: 4000, height: 2000 } })
  await assert.rejects(
    planConversion([file('huge.mp4')], { loadVideo: huge.loadVideo }),
    (error) => error.code === VIDEO_ERROR_CODES.RESOLUTION_LIMIT && /huge\.mp4/.test(error.message),
  )
  // A max-duration video passes duration/resolution guards and only trips the
  // frame guard (1800 frames > MAX_FRAMES) — proving limits were not the cause.
  const edge = makeLoaderBackend({ 'edge.mp4': { duration: 1800, width: 3840, height: 2160 } })
  await assert.rejects(
    planConversion([file('edge.mp4')], { fps: 1, loadVideo: edge.loadVideo }),
    (error) => error.code === VIDEO_ERROR_CODES.FRAME_LIMIT,
  )
})

test('boundary resolution passes when frames are within limits', async () => {
  const edge = makeLoaderBackend({ 'edge.mp4': { duration: 10, width: 3840, height: 2160 } })
  const { totalFrames } = await planConversion([file('edge.mp4')], {
    fps: 1,
    loadVideo: edge.loadVideo,
  })
  assert.equal(totalFrames, 10)
})

test('plan rejects empty queues and pre-aborted signals', async () => {
  const backend = makeLoaderBackend({})
  await assert.rejects(planConversion([], { loadVideo: backend.loadVideo }), (error) => {
    assert.equal(error.code, VIDEO_ERROR_CODES.INVALID_FILE)
    return true
  })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    planConversion([file('a.mp4')], { signal: controller.signal, loadVideo: backend.loadVideo }),
    (error) => error.code === VIDEO_ERROR_CODES.CANCELLED,
  )
  assert.equal(backend.state.loads, 0)
})

// --- Full conversion ---

test('conversion renders deterministic frames and reports 100% progress', async () => {
  const backend = makeLoaderBackend({
    'a.mp4': { duration: 3, width: 640, height: 360 },
    'b.mp4': { duration: 1.5, width: 640, height: 360 },
  })
  const pdfStub = makePdfStub()
  const canvas = makeCanvasStub()
  const events = []
  const { pdf, totalFrames, perVideo } = await convertVideosToPdf(
    [file('a.mp4'), file('b.mp4')],
    {
      fps: 2,
      paper: 'A4',
      loadVideo: backend.loadVideo,
      seek: backend.seek,
      createCanvas: () => canvas,
      createPdf: pdfStub.createPdf,
      addFrame: pdfStub.addFrame,
      onProgress: (event) => events.push(event),
    },
  )
  assert.equal(pdf.stub, true)
  assert.equal(totalFrames, 9) // 6 + 3
  assert.deepEqual(perVideo, [
    { fileName: 'a.mp4', frameCount: 6 },
    { fileName: 'b.mp4', frameCount: 3 },
  ])
  assert.equal(pdfStub.calls.length, 9)
  assert.deepEqual(
    backend.state.seeks.map((s) => s.timestamp),
    [0, 0.5, 1, 1.5, 2, 2.5, 0, 0.5, 1],
  )
  // Progress always ends at 100%.
  const last = events[events.length - 1]
  assert.equal(last.processedFrames, 9)
  assert.equal(last.totalFrames, 9)
  assert.equal(last.phase, 'complete')
  // Every load (plan + render per video) is disposed; canvas released.
  assert.equal(backend.state.loads, 4)
  assert.equal(backend.state.disposes, 4)
  assert.equal(canvas.width, 1)
  assert.equal(canvas.height, 1)
})

test('4K sources are downscaled to the output cap, small sources untouched', async () => {
  const backend = makeLoaderBackend({
    'big.mp4': { duration: 1, width: 3840, height: 2160 },
    'small.mp4': { duration: 1, width: 640, height: 360 },
  })
  const pdfStub = makePdfStub()
  await convertVideosToPdf([file('big.mp4'), file('small.mp4')], {
    fps: 1,
    loadVideo: backend.loadVideo,
    seek: backend.seek,
    createCanvas: makeCanvasStub,
    createPdf: pdfStub.createPdf,
    addFrame: pdfStub.addFrame,
  })
  assert.deepEqual(
    pdfStub.calls.map((c) => [c.srcWidth, c.srcHeight]),
    [[1920, 1080], [640, 360]],
  )
})

test('one corrupt video aborts everything with that video named', async () => {
  const corrupt = new VideoError(
    VIDEO_ERROR_CODES.VIDEO_METADATA_FAILED,
    '“bad.mp4” could not be read',
    { fileName: 'bad.mp4' },
  )
  const backend = makeLoaderBackend({
    'good.mp4': { duration: 2, width: 640, height: 360 },
    'bad.mp4': { error: corrupt },
  })
  const pdfStub = makePdfStub()
  await assert.rejects(
    convertVideosToPdf([file('good.mp4'), file('bad.mp4')], {
      fps: 1,
      loadVideo: backend.loadVideo,
      seek: backend.seek,
      createCanvas: makeCanvasStub,
      createPdf: pdfStub.createPdf,
      addFrame: pdfStub.addFrame,
    }),
    (error) => {
      assert.equal(error.code, VIDEO_ERROR_CODES.VIDEO_METADATA_FAILED)
      assert.equal(error.fileName, 'bad.mp4')
      return true
    },
  )
  assert.equal(pdfStub.calls.length, 0) // planning failed: nothing rendered
  assert.equal(backend.state.disposes, 1) // good.mp4's handle was released
})

test('seek failures keep their code and release the video handle', async () => {
  const backend = makeLoaderBackend({
    'a.mp4': {
      duration: 5,
      width: 640,
      height: 360,
      seekError: new VideoError(VIDEO_ERROR_CODES.VIDEO_SEEK_TIMEOUT, 'stalled', { fileName: 'a.mp4' }),
    },
  })
  const pdfStub = makePdfStub()
  await assert.rejects(
    convertVideosToPdf([file('a.mp4')], {
      fps: 1,
      loadVideo: backend.loadVideo,
      seek: backend.seek,
      createCanvas: makeCanvasStub,
      createPdf: pdfStub.createPdf,
      addFrame: pdfStub.addFrame,
    }),
    (error) => error.code === VIDEO_ERROR_CODES.VIDEO_SEEK_TIMEOUT,
  )
  assert.equal(backend.state.loads, 2) // plan + render loads…
  assert.equal(backend.state.disposes, 2) // …both disposed
})

test('cancellation mid-render stops work and releases all resources', async () => {
  const backend = makeLoaderBackend({
    'a.mp4': { duration: 30, width: 640, height: 360 },
  })
  backend.seekDelayMs = 5
  const pdfStub = makePdfStub()
  const canvas = makeCanvasStub()
  const controller = new AbortController()
  await assert.rejects(
    convertVideosToPdf([file('a.mp4')], {
      fps: 1,
      signal: controller.signal,
      loadVideo: backend.loadVideo,
      seek: backend.seek,
      createCanvas: () => canvas,
      createPdf: pdfStub.createPdf,
      addFrame: pdfStub.addFrame,
      onProgress: (event) => {
        if (event.processedFrames >= 2) controller.abort()
      },
    }),
    (error) => error.code === VIDEO_ERROR_CODES.CANCELLED,
  )
  assert.ok(pdfStub.calls.length < 30, 'stopped early')
  assert.equal(backend.state.loads, backend.state.disposes)
  assert.equal(canvas.width, 1)
})

test('a throwing progress listener cannot break conversion', async () => {
  const backend = makeLoaderBackend({ 'a.mp4': { duration: 2, width: 640, height: 360 } })
  const pdfStub = makePdfStub()
  const { totalFrames } = await convertVideosToPdf([file('a.mp4')], {
    fps: 1,
    loadVideo: backend.loadVideo,
    seek: backend.seek,
    createCanvas: makeCanvasStub,
    createPdf: pdfStub.createPdf,
    addFrame: pdfStub.addFrame,
    onProgress: () => {
      throw new Error('listener bug')
    },
  })
  assert.equal(totalFrames, 2)
})

test('end-to-end through real jsPDF: header, page count, combined videos', async () => {
  const backend = makeLoaderBackend({
    'a.mp4': { duration: 2, width: 640, height: 360 },
    'b.mp4': { duration: 1, width: 360, height: 640 },
  })
  const { pdf, totalFrames } = await convertVideosToPdf([file('a.mp4'), file('b.mp4')], {
    fps: 1,
    paper: 'Letter',
    loadVideo: backend.loadVideo,
    seek: backend.seek,
    createCanvas: makeCanvasStub,
    createPdf: createVideoPdf,
    addFrame: addVideoFrame,
  })
  assert.equal(totalFrames, 3)
  assert.equal(pdf.getNumberOfPages(), 3)
  const bytes = Buffer.from(pdf.output('arraybuffer'))
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  assert.equal((bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 3)
  // Mixed aspects → mixed orientations, both standard Letter sizes.
  pdf.setPage(1)
  assert.ok(Math.abs(pdf.internal.pageSize.width - 279.4) < 0.01)
  pdf.setPage(3)
  assert.ok(Math.abs(pdf.internal.pageSize.width - 215.9) < 0.01)
})
