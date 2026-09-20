import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {
  buildFixtureInBrowser,
  corruptMp4Buffer,
  expectedFrames,
  pdfInfo,
} from './browser/videoFixtures.js'

/**
 * Executes the REAL in-browser fixture builder (identical source) inside a
 * stubbed browser environment, then validates the muxed MP4 byte structure.
 * This is the next-best verification to running a real browser: box layout,
 * sample tables, and offsets are checked exactly.
 */

function makeSandbox() {
  const canvases = []
  const videos = []

  class FakeVideoEncoder {
    static async isConfigSupported() {
      return { supported: true }
    }

    constructor({ output, error }) {
      this.output = output
      this.error = error
      this.codec = null
    }

    configure(config) {
      this.codec = config.codec
    }

    encode(frame) {
      // Deterministic fake payloads: Annex B NALs for AVC, raw bytes for VP9.
      // (Payload byte is index+1 so it can never merge with the following
      // start code the way a zero byte would in real emulation-proof data.)
      const data = this.codec.startsWith('avc')
        ? new Uint8Array([0, 0, 0, 1, 0x65, frame.index + 1, 0, 0, 1, 0x41, 0x9a])
        : new Uint8Array([0x10 + frame.index, 0x20, 0x30])
      const meta =
        this.codec.startsWith('avc') && frame.index === 0
          ? { decoderConfig: { description: new Uint8Array([1, 0x42, 0xe0, 0x1e, 0xff, 0xe1, 0, 4, 1, 2, 3, 4]).buffer } }
          : this.codec.startsWith('vp')
            ? { decoderConfig: { description: new Uint8Array(0).buffer } }
            : undefined
      this.output(
        {
          byteLength: data.length,
          timestamp: frame.timestamp,
          type: frame.index === 0 ? 'key' : 'delta',
          copyTo(target) {
            target.set(data)
          },
        },
        meta,
      )
    }

    async flush() {}

    close() {}
  }

  class FakeVideoFrame {
    constructor(bitmap, { timestamp }) {
      this.timestamp = timestamp
      this.index = bitmap.index
    }

    close() {}
  }

  const canvasStub = () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        canvas,
        fillStyle: '',
        font: '',
        textBaseline: '',
        fillRect() {},
        fillText() {},
      }),
    }
    canvases.push(canvas)
    return canvas
  }

  const videoStub = () => {
    const listeners = {}
    const video = {
      preload: '',
      duration: 2,
      videoWidth: 160,
      videoHeight: 120,
      src: '',
      set onloadedmetadata(fn) {
        listeners.loadedmetadata = fn
      },
      set onerror(fn) {
        listeners.error = fn
      },
    }
    Object.defineProperty(video, 'src', {
      get() {
        return this._src
      },
      set(value) {
        this._src = value
        queueMicrotask(() => listeners.loadedmetadata?.())
      },
    })
    videos.push(video)
    return video
  }

  let bitmapIndex = 0
  return {
    canvases,
    videos,
    globals: {
      document: {
        createElement: (tag) => (tag === 'video' ? videoStub() : canvasStub()),
      },
      VideoEncoder: FakeVideoEncoder,
      VideoFrame: FakeVideoFrame,
      createImageBitmap: async () => ({ index: bitmapIndex++, close() {} }),
      performance: { now: () => Date.now() },
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (fn) => setTimeout(fn, 0),
      URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
      Blob,
      btoa: (s) => Buffer.from(s, 'latin1').toString('base64'),
    },
  }
}

async function runBuilder(args) {
  const sandbox = makeSandbox()
  const context = vm.createContext({ ...sandbox.globals, console })
  // Execute the exact serialized source used by page.evaluate.
  const factory = vm.runInContext(
    `(${buildFixtureInBrowser.toString()})`,
    context,
  )
  const result = await factory(args)
  return { result, sandbox }
}

function findBox(bytes, type) {
  const tag = Buffer.from(type, 'ascii')
  const at = bytes.indexOf(tag)
  assert.ok(at > 0, `missing ${type} box`)
  const size = bytes.readUInt32BE(at - 4)
  return { at: at - 4, size }
}

test('VP9 fixture muxes to a structurally valid MP4', async () => {
  const { result } = await runBuilder({ seconds: 0.1, width: 160, height: 120, fps: 30, exact: true })
  assert.equal(result.strategy, 'vp09')
  const bytes = Buffer.from(result.base64, 'base64')

  // Top-level boxes tile the file exactly.
  assert.equal(bytes.subarray(4, 8).toString(), 'ftyp')
  let offset = 0
  const topLevel = []
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString()
    assert.ok(size >= 8, `box ${type} too small`)
    topLevel.push(type)
    offset += size
  }
  assert.deepEqual(topLevel, ['ftyp', 'moov', 'mdat'])

  // VP9 sample entry + config, 3 samples (0.1s @ 30fps).
  assert.ok(bytes.includes('vp09'))
  assert.ok(bytes.includes('vpcC'))
  const stsz = findBox(bytes, 'stsz')
  assert.equal(bytes.readUInt32BE(stsz.at + 16), 3) // sample_count
  const stts = findBox(bytes, 'stts')
  assert.equal(bytes.readUInt32BE(stts.at + 12), 1) // entry_count
  assert.equal(bytes.readUInt32BE(stts.at + 16), 3) // sample_count
  assert.equal(bytes.readUInt32BE(stts.at + 20), 1000) // sample_delta: 30fps in 30kHz units

  // stco chunk offset points exactly at the mdat payload.
  const stco = findBox(bytes, 'stco')
  const mdat = findBox(bytes, 'mdat')
  assert.equal(bytes.readUInt32BE(stco.at + 12), 1) // entry_count: single chunk
  assert.equal(bytes.readUInt32BE(stco.at + 16), mdat.at + 8)

  // Track dimensions match the request.
  const tkhd = findBox(bytes, 'tkhd')
  assert.equal(bytes.readUInt32BE(tkhd.at + 84) >> 16, 160)
  assert.equal(bytes.readUInt32BE(tkhd.at + 88) >> 16, 120)
})

test('AVC fixture converts Annex B to AVCC samples', async () => {
  // Force the AVC branch by failing VP9 probing once.
  const sandbox = makeSandbox()
  let calls = 0
  const RealEncoder = sandbox.globals.VideoEncoder
  sandbox.globals.VideoEncoder = class extends RealEncoder {
    static async isConfigSupported({ codec }) {
      calls += 1
      return { supported: !codec.startsWith('vp09') || calls > 1 }
    }
  }
  const context = vm.createContext({ ...sandbox.globals, console })
  const factory = vm.runInContext(`(${buildFixtureInBrowser.toString()})`, context)
  const result = await factory({ seconds: 0.1, width: 160, height: 120, fps: 30, exact: true })
  assert.equal(result.strategy, 'avc1')
  const bytes = Buffer.from(result.base64, 'base64')
  assert.ok(bytes.includes('avc1'))
  assert.ok(bytes.includes('avcC'))
  // First mdat sample starts with a 4-byte NAL length (2 = 0x65 <idx>), not a
  // start code — proving Annex B → AVCC conversion happened.
  const mdat = findBox(bytes, 'mdat')
  assert.equal(bytes.readUInt32BE(mdat.at + 8), 2)
  assert.equal(bytes[mdat.at + 12], 0x65)
})

test('unsupported environments fail fast with a clear message', async () => {
  const sandbox = makeSandbox()
  sandbox.globals.VideoEncoder = undefined // no WebCodecs…
  // …and no MediaRecorder global at all.
  const context = vm.createContext({ ...sandbox.globals, console })
  const factory = vm.runInContext(`(${buildFixtureInBrowser.toString()})`, context)
  await assert.rejects(factory({ seconds: 1, width: 160, height: 120, fps: 30, exact: false }), (error) => {
    assert.match(error.message, /No MP4 fixture strategy worked/)
    return true
  })
})

test('Node-side fixture helpers behave', () => {
  assert.equal(expectedFrames(10, 2), 20)
  assert.equal(expectedFrames(0.4, 1), 1)
  assert.equal(expectedFrames(Number.NaN, 1), 1)
  const garbage = corruptMp4Buffer(64)
  assert.equal(garbage.length, 64)
  assert.deepEqual(garbage, corruptMp4Buffer(64)) // deterministic
  const pdf = pdfInfo(Buffer.from('%PDF-1.4 /Type /Page /Type /Page /Type /Pages /MediaBox [0 0 100 100]', 'latin1'))
  assert.equal(pdf.header, '%PDF-')
  assert.equal(pdf.pages, 2)
  assert.deepEqual(pdf.mediaboxes, ['0 0 100 100'])
})
