/**
 * Minimal PNG reader for tests (no dependencies): dimensions from IHDR and
 * pixel access for 8-bit non-interlaced grayscale/RGB/RGBA images, which is
 * what Chromium's screenshot encoder produces.
 */
import { inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function readChunks(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file')
  const chunks = []
  let offset = 8
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    chunks.push({ type, data })
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

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }

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
  const pixels = Buffer.alloc(stride * height)
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const current = pixels.subarray(y * stride, (y + 1) * stride)
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
    /** Returns [r, g, b, a] for the pixel at (x, y). */
    pixel(x, y) {
      const offset = (y * width + x) * channels
      if (colorType === 6) return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]]
      if (colorType === 2) return [pixels[offset], pixels[offset + 1], pixels[offset + 2], 255]
      if (colorType === 4) return [pixels[offset], pixels[offset], pixels[offset], pixels[offset + 1]]
      return [pixels[offset], pixels[offset], pixels[offset], 255]
    },
  }
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}
