import test from 'node:test'
import assert from 'node:assert/strict'
import { loadVideoMetadata, seekToTime } from '../src/video/videoLoader.js'
import { VIDEO_ERROR_CODES } from '../src/video/errors.js'

/**
 * Minimal HTMLVideoElement stand-in: real EventTarget semantics (including
 * { once }) plus the media properties the loader touches.
 */
class FakeVideo extends EventTarget {
  constructor() {
    super()
    this._src = ''
    this.srcObject = undefined
    this.currentTime = 0
    this.duration = Number.NaN
    this.videoWidth = 0
    this.videoHeight = 0
    this.readyState = 0
    this.paused = true
    this.adds = 0
    this.removes = 0
    this.loadCalls = 0
  }

  get src() {
    return this._src
  }

  set src(value) {
    this._src = value
  }

  addEventListener(...args) {
    this.adds += 1
    return super.addEventListener(...args)
  }

  removeEventListener(...args) {
    this.removes += 1
    return super.removeEventListener(...args)
  }

  removeAttribute(name) {
    // Mirror real element semantics: blob-URL teardown removes `src`.
    if (name === 'src') this._src = ''
  }

  pause() {
    this.paused = true
  }

  load() {
    this.loadCalls += 1
  }

  emit(name) {
    this.dispatchEvent(new Event(name))
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function urlTracker() {
  const created = []
  const revoked = []
  return {
    created,
    revoked,
    createObjectURL: (file) => {
      const url = `blob:fake/${created.length}`
      created.push({ file, url })
      return url
    },
    revokeObjectURL: (url) => {
      revoked.push(url)
    },
  }
}

const file = (overrides = {}) => ({
  name: 'clip.mp4',
  type: 'video/mp4',
  size: 1024,
  ...overrides,
})

// --- loadVideoMetadata ---

test('metadata resolves after loadedmetadata with validated dimensions', async () => {
  const video = new FakeVideo()
  const urls = urlTracker()
  const pending = loadVideoMetadata(file(), {
    createVideoElement: () => video,
    ...urls,
  })
  await tick()
  video.duration = 12.5
  video.videoWidth = 640
  video.videoHeight = 360
  video.emit('loadedmetadata')
  const handle = await pending
  assert.equal(handle.duration, 12.5)
  assert.equal(handle.videoWidth, 640)
  assert.equal(urls.created.length, 1)
  assert.equal(urls.revoked.length, 0) // caller owns disposal on success
  assert.equal(video.adds, video.removes) // no listeners left behind
  handle.dispose()
  assert.deepEqual(urls.revoked, [urls.created[0].url])
})

test('metadata rejects on decoder error and releases everything', async () => {
  const video = new FakeVideo()
  const urls = urlTracker()
  const pending = loadVideoMetadata(file(), {
    createVideoElement: () => video,
    ...urls,
  })
  await tick()
  video.emit('error')
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, VIDEO_ERROR_CODES.VIDEO_METADATA_FAILED)
    assert.match(error.message, /clip\.mp4/)
    return true
  })
  assert.equal(urls.revoked.length, 1)
  assert.equal(video.adds, video.removes)
  assert.equal(video.src, '')
})

test('metadata rejects on timeout instead of hanging forever', async () => {
  const video = new FakeVideo()
  const urls = urlTracker()
  await assert.rejects(
    loadVideoMetadata(file(), {
      timeoutMs: 20,
      createVideoElement: () => video,
      ...urls,
    }),
    (error) => {
      assert.equal(error.code, VIDEO_ERROR_CODES.VIDEO_METADATA_TIMEOUT)
      assert.match(error.message, /clip\.mp4/)
      return true
    },
  )
  assert.equal(urls.revoked.length, 1)
  assert.equal(video.adds, video.removes)
})

test('metadata honors abort mid-flight and on entry', async () => {
  const video = new FakeVideo()
  const urls = urlTracker()
  const controller = new AbortController()
  const pending = loadVideoMetadata(file(), {
    signal: controller.signal,
    createVideoElement: () => video,
    ...urls,
  })
  await tick()
  controller.abort()
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, VIDEO_ERROR_CODES.CANCELLED)
    return true
  })
  assert.equal(urls.revoked.length, 1)

  const aborted = new AbortController()
  aborted.abort()
  assert.throws(
    () =>
      loadVideoMetadata(file(), {
        signal: aborted.signal,
        createVideoElement: () => new FakeVideo(),
        ...urlTracker(),
      }),
    (error) => error.code === VIDEO_ERROR_CODES.CANCELLED,
  )
})

test('metadata rejects unplayable streams (bad duration / no video track)', async () => {
  for (const patch of [
    { duration: Number.NaN, videoWidth: 640, videoHeight: 360 },
    { duration: Number.POSITIVE_INFINITY, videoWidth: 640, videoHeight: 360 },
    { duration: 0, videoWidth: 640, videoHeight: 360 },
    { duration: 5, videoWidth: 0, videoHeight: 0 },
  ]) {
    const video = new FakeVideo()
    const urls = urlTracker()
    const pending = loadVideoMetadata(file(), {
      createVideoElement: () => video,
      ...urls,
    })
    await tick()
    Object.assign(video, patch)
    video.emit('loadedmetadata')
    await assert.rejects(pending, (error) => {
      assert.equal(error.code, VIDEO_ERROR_CODES.VIDEO_DECODE_FAILED)
      assert.equal(error.fileName, 'clip.mp4')
      return true
    })
    assert.equal(urls.revoked.length, 1)
  }
})

// --- seekToTime ---

function seekableVideo() {
  const video = new FakeVideo()
  video.duration = 10
  video.readyState = 1 // HAVE_METADATA: no fast-path; must wait for 'seeked'
  let time = 0
  Object.defineProperty(video, 'currentTime', {
    get: () => time,
    set: (value) => {
      time = value
      queueMicrotask(() => video.emit('seeked'))
    },
  })
  return video
}

test('seek resolves on seeked and cleans up listeners', async () => {
  const video = seekableVideo()
  await seekToTime(video, 4.5, { fileName: 'clip.mp4' })
  assert.equal(video.currentTime, 4.5)
  assert.equal(video.adds, video.removes)
})

test('repeated seeks are safe and never stack stale handlers', async () => {
  const video = seekableVideo()
  await seekToTime(video, 1, { fileName: 'clip.mp4' })
  await seekToTime(video, 2, { fileName: 'clip.mp4' })
  await seekToTime(video, 3, { fileName: 'clip.mp4' })
  assert.equal(video.currentTime, 3)
  assert.equal(video.adds, video.removes)
})

test('seek fast-paths when already at the target with data available', async () => {
  const video = seekableVideo()
  video.readyState = 2 // HAVE_CURRENT_DATA
  await seekToTime(video, 0, { fileName: 'clip.mp4' })
  assert.equal(video.adds, 0) // no listeners were even attached
})

test('seek rejects on decoder error with the timestamp named', async () => {
  const video = new FakeVideo()
  video.readyState = 1
  // currentTime assignment triggers an async decode error instead of seeked.
  let time = 0
  Object.defineProperty(video, 'currentTime', {
    get: () => time,
    set: (value) => {
      time = value
      queueMicrotask(() => video.emit('error'))
    },
  })
  await assert.rejects(seekToTime(video, 2.5, { fileName: 'clip.mp4' }), (error) => {
    assert.equal(error.code, VIDEO_ERROR_CODES.VIDEO_SEEK_FAILED)
    assert.match(error.message, /2\.50s/)
    assert.match(error.message, /clip\.mp4/)
    return true
  })
  assert.equal(video.adds, video.removes)
})

test('seek rejects on timeout instead of hanging forever', async () => {
  const video = new FakeVideo()
  video.readyState = 1
  await assert.rejects(
    seekToTime(video, 1, { timeoutMs: 20, fileName: 'clip.mp4' }),
    (error) => {
      assert.equal(error.code, VIDEO_ERROR_CODES.VIDEO_SEEK_TIMEOUT)
      assert.match(error.message, /clip\.mp4/)
      return true
    },
  )
  assert.equal(video.adds, video.removes)
})

test('seek honors abort mid-flight and on entry', async () => {
  const video = new FakeVideo()
  video.readyState = 1
  const controller = new AbortController()
  const pending = seekToTime(video, 1, {
    signal: controller.signal,
    fileName: 'clip.mp4',
  })
  await tick()
  controller.abort()
  await assert.rejects(pending, (error) => error.code === VIDEO_ERROR_CODES.CANCELLED)
  assert.equal(video.adds, video.removes)

  const aborted = new AbortController()
  aborted.abort()
  // Pre-aborted signals throw synchronously (callers always await, so this
  // still surfaces as a rejection in the pipeline).
  assert.throws(
    () => seekToTime(video, 1, { signal: aborted.signal }),
    (error) => error.code === VIDEO_ERROR_CODES.CANCELLED,
  )
})

test('seek rejects invalid timestamps without touching the decoder', async () => {
  const video = seekableVideo()
  await assert.rejects(seekToTime(video, Number.NaN, { fileName: 'c.mp4' }), (error) => {
    assert.equal(error.code, VIDEO_ERROR_CODES.VIDEO_SEEK_FAILED)
    return true
  })
  await assert.rejects(seekToTime(video, -1, { fileName: 'c.mp4' }))
  assert.equal(video.adds, 0)
})
