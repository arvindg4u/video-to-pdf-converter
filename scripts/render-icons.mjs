#!/usr/bin/env node
/**
 * Renders every shipped PDF Lab icon from the design master
 * `branding/pdf-lab-icon.png` (1024 × 1024: a light folded document with an
 * amber play symbol on a solid deep-navy background) into `public/icons/`.
 *
 * Pure Node, no browser or image library: the master is resampled with exact
 * area averaging, rounded corners are anti-aliased analytically, and PNGs are
 * written through scripts/lib/png.js. The output is byte-for-byte
 * reproducible — tests/pwa-icons.test.js re-renders it and compares.
 *
 * Usage:  npm run icons          (re-run only when the master artwork changes)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from './lib/png.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MASTER_PATH = path.join(root, 'branding', 'pdf-lab-icon.png')
export const OUT_DIR = path.join(root, 'public', 'icons')

/** Rounded-tile corner radius as a fraction of the icon size (≈ iOS/macOS tiles). */
const CORNER_RADIUS = 0.22
/** Maskable icons: the farthest artwork pixel is placed at this fraction of the width (safe circle = 0.40). */
const MASKABLE_ART_RADIUS = 0.38
/** Pixels further than this (max channel difference) from the border colour count as artwork. */
const ART_THRESHOLD = 24

/**
 * Icon variants. `zoom` scales the master around its centre before cropping to
 * the tile (1 = the whole master fits exactly; >1 crops in; 'maskable' shrinks
 * so the artwork stays inside the 40 %-radius safe circle with padding).
 */
export const VARIANTS = [
  { file: 'icon-192.png', size: 192, shape: 'rounded', zoom: 1.1 },
  { file: 'icon-512.png', size: 512, shape: 'rounded', zoom: 1.1 },
  { file: 'icon-512-maskable.png', size: 512, shape: 'square', zoom: 'maskable' },
  // iOS applies its own mask: ship a full-bleed square.
  { file: 'apple-touch-icon.png', size: 180, shape: 'square', zoom: 1.1 },
  // Favicons crop in further so the play symbol still reads at 16 px.
  { file: 'favicon-32.png', size: 32, shape: 'rounded', zoom: 1.25 },
  { file: 'favicon-16.png', size: 16, shape: 'rounded', zoom: 1.25 },
]

/** Average colour of the outermost 2 px of the master: the solid background. */
export function backgroundColour(master) {
  const { width, height } = master
  const sum = [0, 0, 0]
  let count = 0
  const add = (x, y) => {
    const [r, g, b] = master.pixel(x, y)
    sum[0] += r
    sum[1] += g
    sum[2] += b
    count++
  }
  for (let x = 0; x < width; x++) for (const y of [0, 1, height - 2, height - 1]) add(x, y)
  for (let y = 2; y < height - 2; y++) for (const x of [0, 1, width - 2, width - 1]) add(x, y)
  return sum.map((value) => Math.round(value / count))
}

/** Distance (in master pixels) from the centre to the farthest artwork pixel. */
export function artworkRadius(master, background) {
  const { width, height } = master
  const cx = (width - 1) / 2
  const cy = (height - 1) / 2
  let radius = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = master.pixel(x, y)
      const difference = Math.max(Math.abs(r - background[0]), Math.abs(g - background[1]), Math.abs(b - background[2]))
      if (difference > ART_THRESHOLD) radius = Math.max(radius, Math.hypot(x - cx, y - cy))
    }
  }
  return radius
}

/** Exact area-averaging resample of a centred, zoomed window of the master. */
function resample(master, { size, zoom, background }) {
  const M = master.width
  const span = M / zoom
  const step = span / size
  const origin = (M - span) / 2
  const axis = []
  for (let i = 0; i < size; i++) {
    const start = origin + i * step
    const end = start + step
    const weights = []
    for (let s = Math.floor(start); s < Math.ceil(end); s++) {
      const overlap = Math.min(end, s + 1) - Math.max(start, s)
      if (overlap > 1e-9) weights.push([s, overlap / step])
    }
    axis.push(weights)
  }
  const out = new Float64Array(size * size * 3)
  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      let r = 0
      let g = 0
      let b = 0
      for (const [sy, wy] of axis[oy]) {
        for (const [sx, wx] of axis[ox]) {
          const w = wx * wy
          const inside = sx >= 0 && sy >= 0 && sx < M && sy < master.height
          const p = inside ? master.pixel(sx, sy) : background
          r += p[0] * w
          g += p[1] * w
          b += p[2] * w
        }
      }
      const o = (oy * size + ox) * 3
      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
    }
  }
  return out
}

/** Anti-aliased coverage of a rounded square for the pixel centred at (x, y). */
function roundedCoverage(x, y, size, radius) {
  const half = size / 2
  const px = Math.abs(x - half) - (half - radius)
  const py = Math.abs(y - half) - (half - radius)
  const outside = Math.hypot(Math.max(px, 0), Math.max(py, 0))
  const inside = Math.min(Math.max(px, py), 0)
  const distance = outside + inside - radius
  return Math.min(1, Math.max(0, 0.5 - distance))
}

export function renderVariant(master, variant, context) {
  const { size, shape } = variant
  const zoom = variant.zoom === 'maskable' ? context.maskableZoom : variant.zoom
  const rgb = resample(master, { size, zoom, background: context.background })
  const channels = shape === 'rounded' ? 4 : 3
  const data = Buffer.alloc(size * size * channels)
  const radius = CORNER_RADIUS * size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3
      const o = (y * size + x) * channels
      const coverage = shape === 'rounded' ? roundedCoverage(x + 0.5, y + 0.5, size, radius) : 1
      const alpha = Math.round(coverage * 255)
      if (alpha === 0) continue // fully transparent: leave zeroed for compression
      data[o] = Math.round(rgb[i])
      data[o + 1] = Math.round(rgb[i + 1])
      data[o + 2] = Math.round(rgb[i + 2])
      if (channels === 4) data[o + 3] = alpha
    }
  }
  return encodePng({ width: size, height: size, channels, data })
}

/** Renders all variants from the master PNG bytes. Returns [{ file, png }] plus the analysis. */
export function renderIcons(masterBuffer) {
  const master = decodePng(masterBuffer)
  if (master.width !== master.height) throw new Error('The icon master must be square')
  const background = backgroundColour(master)
  const radius = artworkRadius(master, background)
  // Shrink so the farthest artwork pixel lands at MASKABLE_ART_RADIUS of the width; never enlarge.
  const maskableZoom = Math.min(1, (MASKABLE_ART_RADIUS * master.width) / radius)
  const context = { background, maskableZoom, artworkRadius: radius }
  const icons = VARIANTS.map((variant) => ({ file: variant.file, png: renderVariant(master, variant, context) }))
  return { icons, ...context }
}

export const toHex = (rgb) => `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`

async function main() {
  const masterBuffer = await readFile(MASTER_PATH)
  const { icons, background, maskableZoom, artworkRadius: radius } = renderIcons(masterBuffer)
  await mkdir(OUT_DIR, { recursive: true })
  for (const { file, png } of icons) {
    await writeFile(path.join(OUT_DIR, file), png)
    console.log(`wrote public/icons/${file} (${png.length} bytes)`)
  }
  console.log(`background ${toHex(background)} · artwork radius ${radius.toFixed(1)} px · maskable zoom ${maskableZoom.toFixed(3)}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
