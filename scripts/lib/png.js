/**
 * Minimal PNG codec (8-bit, non-interlaced) shared by the icon renderer and
 * the tests. Pure Node: only zlib is needed.
 */
import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }
const COLOR_TYPE = { 1: 0, 2: 4, 3: 2, 4: 6 }

export function readChunks(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file')
  const chunks = []
  let offset = 8
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) })
    offset += 12 + length
    if (type === 'IEND') break
  }
  return chunks
}

export function pngDimensions(buffer) {
  const ihdr = readChunks(buffer).find((chunk) => chunk.type === 'IHDR')
  if (!ihdr) throw new Error('PNG without IHDR')
  return { width: ihdr.data.readUInt32BE(0), height: ihdr.data.readUInt32BE(4) }
}

/** Decodes an 8-bit non-interlaced PNG into straight (non-premultiplied) samples. */
export function decodePng(buffer) {
  const chunks = readChunks(buffer)
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR').data
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const bitDepth = ihdr[8]
  const colorType = ihdr[9]
  const interlace = ihdr[12]
  const channels = CHANNELS[colorType]
  if (bitDepth !== 8 || !channels || interlace !== 0) {
    throw new Error(`Unsupported PNG layout (depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})`)
  }
  const raw = inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data)))
  const stride = width * channels
  const data = Buffer.alloc(stride * height)
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const current = data.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? current[i - channels] : 0
      const b = previous[i]
      const c = i >= channels ? previous[i - channels] : 0
      let value = line[i]
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += Math.floor((a + b) / 2)
      else if (filter === 4) value += paeth(a, b, c)
      else if (filter !== 0) throw new Error(`Unknown PNG filter ${filter}`)
      current[i] = value & 0xff
    }
    previous = current
  }
  return {
    width,
    height,
    channels,
    data,
    /** Returns [r, g, b, a] for the pixel at (x, y). */
    pixel(x, y) {
      const offset = (y * width + x) * channels
      if (colorType === 6) return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]
      if (colorType === 2) return [data[offset], data[offset + 1], data[offset + 2], 255]
      if (colorType === 4) return [data[offset], data[offset], data[offset], data[offset + 1]]
      return [data[offset], data[offset], data[offset], 255]
    },
  }
}

/**
 * Encodes 8-bit samples (1, 2, 3 or 4 channels) as a PNG. Each row gets the
 * filter with the smallest absolute sum (the heuristic libpng uses).
 * Deterministic: identical input always yields identical bytes.
 */
export function encodePng({ width, height, channels, data }) {
  const colorType = COLOR_TYPE[channels]
  if (colorType === undefined) throw new Error(`Unsupported channel count ${channels}`)
  const stride = width * channels
  if (data.length !== stride * height) throw new Error('PNG sample buffer has the wrong size')

  const raw = Buffer.alloc((stride + 1) * height)
  const candidates = Array.from({ length: 5 }, () => Buffer.alloc(stride))
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const current = data.subarray(y * stride, (y + 1) * stride)
    let best = 0
    let bestScore = Infinity
    for (let filter = 0; filter < 5; filter++) {
      const out = candidates[filter]
      let score = 0
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? current[i - channels] : 0
        const b = previous[i]
        const c = i >= channels ? previous[i - channels] : 0
        let value = current[i]
        if (filter === 1) value -= a
        else if (filter === 2) value -= b
        else if (filter === 3) value -= Math.floor((a + b) / 2)
        else if (filter === 4) value -= paeth(a, b, c)
        value &= 0xff
        out[i] = value
        score += value < 128 ? value : 256 - value
      }
      if (score < bestScore) {
        bestScore = score
        best = filter
      }
    }
    raw[y * (stride + 1)] = best
    candidates[best].copy(raw, y * (stride + 1) + 1)
    previous = current
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = colorType
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}
