/**
 * Deterministic MP4 fixtures generated inside the test browser.
 *
 * No committed binaries, no ffmpeg, no network: fixtures are encoded at test
 * time with WebCodecs (exact durations: N frames @ 30 fps) or MediaRecorder
 * (wall-clock durations, measured afterwards). Every fixture is verified by
 * real browser decoding (loadedmetadata + dimensions) before use.
 *
 * IMPORTANT: `buildFixtureInBrowser` is serialized into the page by
 * `page.evaluate`, so it must stay fully self-contained (no outer references,
 * no Node APIs). Everything else in this file runs in Node.
 */

export function expectedFrames(duration, fps) {
  if (!Number.isFinite(duration) || duration <= 0) return 1
  return Math.max(1, Math.floor(duration * fps))
}

export function pdfInfo(buffer) {
  const text = buffer.toString('latin1')
  return {
    header: buffer.subarray(0, 5).toString(),
    pages: (text.match(/\/Type\s*\/Page[^s]/g) || []).length,
    mediaboxes: [...text.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((m) => m[1].trim()),
    text,
  }
}

/** Deterministic pseudo-random garbage: never accidentally a valid video. */
export function corruptMp4Buffer(size = 4096) {
  const bytes = Buffer.alloc(size)
  let seed = 0x12345678
  for (let i = 0; i < size; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    bytes[i] = (seed >> 16) & 0xff
  }
  bytes[4] = 0x00
  bytes[5] = 0x00
  bytes[6] = 0x00
  bytes[7] = 0x00
  return bytes
}

// ---------------------------------------------------------------------------
// Runs entirely in the browser (serialized by page.evaluate). Keep it pure.
// Exported for the Node structural test (tests/mp4-muxer.test.js), which
// executes this exact source with stubbed browser globals.
// ---------------------------------------------------------------------------
export async function buildFixtureInBrowser({ seconds, width, height, fps, exact }) {
  const TIMESCALE = 30000
  const UNIT = TIMESCALE / fps

  function concat(...arrays) {
    let total = 0
    for (const a of arrays) total += a.length
    const out = new Uint8Array(total)
    let offset = 0
    for (const a of arrays) {
      out.set(a, offset)
      offset += a.length
    }
    return out
  }
  function u32(v) {
    return new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])
  }
  function u16(v) {
    return new Uint8Array([(v >>> 8) & 255, v & 255])
  }
  function ascii(s) {
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255
    return out
  }
  function box(type, ...payloads) {
    const body = concat(...payloads)
    return concat(u32(8 + body.length), ascii(type), body)
  }

  // Annex B (00 00 01 …) → AVCC length-prefixed NAL units. Emulation
  // prevention (00 00 03) can never form a start code, so a naive scan is
  // safe. Input without a leading start code is passed through as one unit.
  function splitAnnexBNalus(data) {
    const startsAnnexB =
      data.length > 4 &&
      data[0] === 0 &&
      data[1] === 0 &&
      (data[2] === 1 || (data[2] === 0 && data[3] === 1))
    if (!startsAnnexB) return [data]
    const units = []
    let i = 0
    let unitStart = -1
    while (i + 2 < data.length) {
      let startCode = 0
      if (data[i] === 0 && data[i + 1] === 0) {
        if (data[i + 2] === 1) startCode = 3
        else if (data[i + 2] === 0 && i + 3 < data.length && data[i + 3] === 1) startCode = 4
      }
      if (startCode > 0) {
        if (unitStart >= 0 && i > unitStart) units.push(data.subarray(unitStart, i))
        unitStart = i + startCode
        i += startCode
      } else {
        i += 1
      }
    }
    if (unitStart >= 0 && unitStart < data.length) units.push(data.subarray(unitStart))
    return units
  }

  // Minimal single-track MP4: ftyp + moov (mvhd/trak/mdia/minf/stbl) + mdat
  // with one chunk, uniform sample durations, and explicit sample sizes.
  function muxMp4({ codec, samples, description }) {
    const isAvc = codec.indexOf('avc') === 0
    const payloads = samples.map((sample) => {
      if (!isAvc) return sample
      const parts = []
      for (const unit of splitAnnexBNalus(sample)) {
        parts.push(u32(unit.length), unit)
      }
      return concat(...parts)
    })
    const entryName = isAvc ? 'avc1' : 'vp09'
    const codecBox = isAvc
      ? box('avcC', description)
      : box(
          'vpcC',
          new Uint8Array([1, 0, 0, 0, 0, 10, 0x82, 2, 2, 2, 0, 0]),
        )
    const visualFixed = concat(
      new Uint8Array(6),
      u16(1),
      new Uint8Array(16),
      u16(width),
      u16(height),
      u32(0x00480000),
      u32(0x00480000),
      u32(0),
      u16(1),
      new Uint8Array(32),
      u16(0x0018),
      u16(0xffff),
    )
    const count = payloads.length
    const durationMedia = count * UNIT
    const durationMs = Math.round((count / fps) * 1000)
    const stsd = box('stsd', u32(0), u32(1), box(entryName, visualFixed, codecBox))
    const stts = box('stts', u32(0), u32(1), u32(count), u32(UNIT))
    const stsc = box('stsc', u32(0), u32(1), u32(1), u32(count), u32(1))
    const sizeEntries = [u32(0), u32(0), u32(count)]
    for (const payload of payloads) sizeEntries.push(u32(payload.length))
    const stsz = box('stsz', ...sizeEntries)
    const mvhd = box(
      'mvhd',
      u32(0), u32(0), u32(0), u32(1000), u32(durationMs),
      u32(0x00010000), u16(0x0100), u16(0), new Uint8Array(8),
      u32(0x00010000), u32(0), u32(0),
      u32(0), u32(0x00010000), u32(0),
      u32(0), u32(0), u32(0x40000000),
      new Uint8Array(24), u32(2),
    )
    const tkhd = box(
      'tkhd',
      u32(7), u32(0), u32(0), u32(1), u32(0), u32(durationMs),
      new Uint8Array(8), u16(0), u16(0), u16(0), u16(0),
      u32(0x00010000), u32(0), u32(0),
      u32(0), u32(0x00010000), u32(0),
      u32(0), u32(0), u32(0x40000000),
      u32(width * 65536), u32(height * 65536),
    )
    const mdhd = box('mdhd', u32(0), u32(0), u32(0), u32(TIMESCALE), u32(durationMedia), u16(0x55c4), u16(0))
    const hdlr = box('hdlr', u32(0), u32(0), ascii('vide'), new Uint8Array(12), ascii('VideoHandler\0'))
    const vmhd = box('vmhd', u32(1), u16(0), new Uint8Array(6))
    const dinf = box('dinf', box('dref', u32(0), u32(1), box('url ', u32(1))))
    const ftyp = box(
      'ftyp',
      ascii('isom'), u32(0x200), ascii('isom'), ascii('iso2'),
      ascii(isAvc ? 'avc1' : 'vp09'), ascii('mp41'),
    )
    // stco needs the final moov size, so compute the layout first.
    const stcoSize = 20
    const stblSize = 8 + stsd.length + stts.length + stsc.length + stsz.length + stcoSize
    const minfSize = 8 + vmhd.length + dinf.length + stblSize
    const mdiaSize = 8 + mdhd.length + hdlr.length + minfSize
    const trakSize = 8 + tkhd.length + mdiaSize
    const moovSize = 8 + mvhd.length + trakSize
    const chunkOffset = ftyp.length + moovSize + 8
    const stco = box('stco', u32(0), u32(1), u32(chunkOffset))
    const moov = box(
      'moov',
      mvhd,
      box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', vmhd, dinf, box('stbl', stsd, stts, stsc, stsz, stco)))),
    )
    if (moov.length !== moovSize) throw new Error('muxer size mismatch')
    return concat(ftyp, moov, box('mdat', ...payloads))
  }

  function drawFrame(ctx, index, total) {
    const hue = Math.round((index / Math.max(1, total - 1)) * 360)
    ctx.fillStyle = `hsl(${hue}, 70%, 45%)`
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${Math.max(12, Math.floor(ctx.canvas.height / 6))}px sans-serif`
    ctx.textBaseline = 'middle'
    ctx.fillText(`frame ${index + 1}/${total}`, 10, ctx.canvas.height / 2)
  }

  async function encodeWebCodecs(codec) {
    if (typeof VideoEncoder === 'undefined') return null
    let probe = null
    try {
      probe = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: 300_000,
        framerate: fps,
      })
    } catch {
      return null
    }
    if (!probe || !probe.supported) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const total = Math.max(1, Math.round(seconds * fps))
    const chunks = []
    let description = null
    let encoderError = null
    const encoder = new VideoEncoder({
      output(chunk, meta) {
        if (meta && meta.decoderConfig && meta.decoderConfig.description) {
          description = new Uint8Array(meta.decoderConfig.description)
        }
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        chunks.push({ timestamp: chunk.timestamp, data })
      },
      error(error) {
        encoderError = error
      },
    })
    encoder.configure({
      codec,
      width,
      height,
      bitrate: 300_000,
      framerate: fps,
      latencyMode: 'realtime',
    })
    try {
      for (let i = 0; i < total; i++) {
        drawFrame(ctx, i, total)
        const bitmap = await createImageBitmap(canvas)
        const frame = new VideoFrame(bitmap, {
          timestamp: Math.round((i * 1_000_000) / fps),
          duration: Math.round(1_000_000 / fps),
        })
        encoder.encode(frame, { keyFrame: i % 15 === 0 })
        frame.close()
        bitmap.close()
      }
      await encoder.flush()
    } finally {
      encoder.close()
    }
    if (encoderError) throw encoderError
    if (!description || chunks.length !== total) return null
    chunks.sort((a, b) => a.timestamp - b.timestamp)
    return muxMp4({
      codec,
      samples: chunks.map((chunk) => chunk.data),
      description,
    })
  }

  async function recordMp4() {
    if (typeof MediaRecorder === 'undefined') return null
    const candidates = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4']
    let mimeType = null
    for (const candidate of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(candidate)) {
          mimeType = candidate
          break
        }
      } catch {
        // Keep probing.
      }
    }
    if (!mimeType) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx || typeof canvas.captureStream !== 'function') return null
    const stream = canvas.captureStream(fps)
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 500_000 })
    const parts = []
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) parts.push(event.data)
    }
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve
      recorder.onerror = () => reject(new Error('recorder error'))
      setTimeout(() => reject(new Error('recorder stall')), seconds * 1000 + 15000)
    })
    const total = Math.max(1, Math.round(seconds * fps))
    recorder.start()
    const start = performance.now()
    let index = 0
    while (performance.now() - start < seconds * 1000) {
      drawFrame(ctx, index % total, total)
      index += 1
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    drawFrame(ctx, total - 1, total)
    recorder.stop()
    await stopped
    for (const track of stream.getTracks()) track.stop()
    const blob = new Blob(parts, { type: 'video/mp4' })
    if (!blob.size) return null
    return new Uint8Array(await blob.arrayBuffer())
  }

  async function verify(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
    try {
      const meta = await new Promise((resolve, reject) => {
        const video = document.createElement('video')
        video.preload = 'metadata'
        const timer = setTimeout(() => reject(new Error('fixture verify timeout')), 15000)
        video.onloadedmetadata = () => {
          clearTimeout(timer)
          resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight })
        }
        video.onerror = () => {
          clearTimeout(timer)
          reject(new Error('fixture decode error'))
        }
        video.src = url
      })
      if (!Number.isFinite(meta.duration) || meta.duration <= 0 || !meta.width || !meta.height) {
        throw new Error('unplayable fixture')
      }
      return meta
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  function toBase64(bytes) {
    let text = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    }
    return btoa(text)
  }

  const order = exact ? ['vp09', 'avc1'] : ['record', 'vp09', 'avc1']
  const errors = []
  for (const strategy of order) {
    try {
      let bytes = null
      if (strategy === 'record') bytes = await recordMp4()
      else if (strategy === 'vp09') bytes = await encodeWebCodecs('vp09.00.10.08')
      else bytes = await encodeWebCodecs('avc1.42E01E')
      if (!bytes) {
        errors.push(`${strategy}: unsupported`)
        continue
      }
      const meta = await verify(bytes)
      return { base64: toBase64(bytes), byteLength: bytes.length, strategy, ...meta }
    } catch (error) {
      errors.push(`${strategy}: ${(error && error.message) || error}`)
    }
  }
  throw new Error(
    `No MP4 fixture strategy worked in this browser (${errors.join('; ') || 'no strategies'}). ` +
      'Chromium with WebCodecs VP9/AVC or MP4 MediaRecorder is required.',
  )
}

// ---------------------------------------------------------------------------
// Node-side helpers.
// ---------------------------------------------------------------------------

/**
 * Generate a verified MP4 in the page. `exact` fixtures (WebCodecs only)
 * have mathematically exact durations for page-count assertions; behavior
 * fixtures may use MediaRecorder and report their measured duration.
 */
export async function generateFixture(
  page,
  { seconds, width = 160, height = 120, fps = 30, exact = false } = {},
) {
  const result = await page.evaluate(buildFixtureInBrowser, {
    seconds,
    width,
    height,
    fps,
    exact,
  })
  return {
    buffer: Buffer.from(result.base64, 'base64'),
    byteLength: result.byteLength,
    duration: result.duration,
    width: result.width,
    height: result.height,
    strategy: result.strategy,
  }
}

export function mp4FilePayload(fixture, name) {
  return { name, mimeType: 'video/mp4', buffer: fixture.buffer }
}

/** Spoof media properties app-wide (prototype) to hit guard rails cheaply. */
export async function spoofVideoProperties(page, { duration, width, height } = {}) {
  await page.evaluate(
    ({ duration, width, height }) => {
      const proto = HTMLVideoElement.prototype
      if (duration !== undefined) {
        Object.defineProperty(proto, 'duration', { get: () => duration, configurable: true })
      }
      if (width !== undefined) {
        Object.defineProperty(proto, 'videoWidth', { get: () => width, configurable: true })
      }
      if (height !== undefined) {
        Object.defineProperty(proto, 'videoHeight', { get: () => height, configurable: true })
      }
    },
    { duration, width, height },
  )
}
