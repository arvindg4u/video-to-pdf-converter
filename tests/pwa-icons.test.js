import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, pngDimensions } from './helpers/png.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = path.join(root, 'public')
const manifest = JSON.parse(readFileSync(path.join(publicDir, 'manifest.json'), 'utf8'))
const indexHtml = readFileSync(path.join(root, 'index.html'), 'utf8')

const EXPECTED_ICONS = {
  'icons/icon-192.png': 192,
  'icons/icon-512.png': 512,
  'icons/icon-512-maskable.png': 512,
  'icons/apple-touch-icon.png': 180,
  'icons/favicon-32.png': 32,
  'icons/favicon-16.png': 16,
}

test('every shipped icon is a real PNG with the advertised dimensions', () => {
  for (const [file, size] of Object.entries(EXPECTED_ICONS)) {
    const buffer = readFileSync(path.join(publicDir, file))
    assert.deepEqual(pngDimensions(buffer), { width: size, height: size }, file)
  }
})

test('manifest identity, display and icon references are correct', () => {
  assert.equal(manifest.name, 'PDF Lab — Video & Markdown to PDF')
  assert.equal(manifest.short_name, 'PDF Lab')
  assert.equal(manifest.id, '/')
  assert.equal(manifest.start_url, './')
  assert.equal(manifest.scope, './')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.orientation, undefined, 'orientation must not be forced')
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i)
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i)
  assert.ok(manifest.description.length > 20)

  const purposes = manifest.icons.map((icon) => icon.purpose)
  assert.ok(purposes.every((purpose) => purpose === 'any' || purpose === 'maskable'), 'no combined "any maskable" entries')
  assert.ok(purposes.includes('any') && purposes.includes('maskable'))
  const sizesFor = (purpose) => manifest.icons.filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes)
  assert.deepEqual(sizesFor('any').sort(), ['192x192', '512x512'])
  assert.deepEqual(sizesFor('maskable'), ['512x512'])

  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith('/'), `${icon.src} must be manifest-relative for subdirectory hosting`)
    const file = path.join(publicDir, icon.src)
    assert.ok(existsSync(file), `${icon.src} exists`)
    const [w, h] = icon.sizes.split('x').map(Number)
    assert.deepEqual(pngDimensions(readFileSync(file)), { width: w, height: h }, icon.src)
    assert.equal(icon.type, 'image/png')
  }
})

test('index.html metadata matches the manifest branding and references shipped icons', () => {
  assert.match(indexHtml, /<title>PDF Lab — Video & Markdown to PDF<\/title>/)
  assert.match(indexHtml, /<link rel="manifest" href="\/manifest\.json">/)
  assert.match(indexHtml, /<meta name="application-name" content="PDF Lab">/)
  assert.match(indexHtml, /<meta name="apple-mobile-web-app-title" content="PDF Lab">/)
  assert.match(indexHtml, /<meta name="theme-color" content="#[0-9a-f]{6}">/i)
  assert.doesNotMatch(indexHtml, /serviceWorker\.register/, 'registration lives in the app (production only), not inline')
  for (const href of indexHtml.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="\/([^"]+)"/g)) {
    assert.ok(existsSync(path.join(publicDir, href[1])), `${href[1]} exists`)
  }
  assert.match(indexHtml, /rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png" sizes="180x180"/)
  assert.match(indexHtml, /href="\/icons\/favicon-32\.png" type="image\/png" sizes="32x32"/)
  assert.match(indexHtml, /href="\/icons\/favicon-16\.png" type="image\/png" sizes="16x16"/)
})

function colourDistance(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
}

test('maskable icon keeps all artwork inside the 40 %-radius safe circle on an opaque background', () => {
  const png = decodePng(readFileSync(path.join(publicDir, 'icons/icon-512-maskable.png')))
  const size = png.width
  const centre = (size - 1) / 2
  const safeRadius = 0.4 * size

  // Fully opaque everywhere (corners included): required for masking.
  for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1], [Math.round(centre), Math.round(centre)]]) {
    assert.equal(png.pixel(x, y)[3], 255, `pixel ${x},${y} opaque`)
  }

  // Outside the safe circle only the navy background (a smooth gradient) may
  // appear: sample a ring just beyond the radius and compare with the corner.
  const corner = png.pixel(2, 2)
  assert.ok(corner[2] > corner[0] && corner[2] > corner[1], 'background is navy (blue-dominant)')
  let samples = 0
  for (let angle = 0; angle < 360; angle += 3) {
    for (const radius of [safeRadius + 4, safeRadius + 24, size / 2 - 2]) {
      const x = Math.round(centre + radius * Math.cos((angle * Math.PI) / 180))
      const y = Math.round(centre + radius * Math.sin((angle * Math.PI) / 180))
      if (x < 0 || y < 0 || x >= size || y >= size) continue
      const [r, g, b] = png.pixel(x, y)
      // Navy background: dark and blue-dominant. Page/amber artwork is bright.
      assert.ok(r < 70 && g < 90 && b > r && b > g, `ring sample at ${x},${y} is background, got ${[r, g, b]}`)
      samples++
    }
  }
  assert.ok(samples > 200)

  // …and the artwork really is there: the light page (±200/1024 units wide
  // at scale 1) left of the play symbol, and the amber symbol near the centre.
  const [pr, pg, pb] = png.pixel(Math.round(centre - 0.15 * size), Math.round(centre))
  assert.ok(pr > 200 && pg > 200 && pb > 200, 'light document inside the safe zone')
  const amber = png.pixel(Math.round(centre - 0.02 * size), Math.round(centre - 0.02 * size))
  assert.ok(amber[0] > 200 && amber[1] > 120 && amber[2] < 90, `amber play symbol near the centre, got ${amber}`)
  assert.ok(colourDistance(amber, corner) > 100)
})

test('ordinary icons are rounded squares (transparent corners, opaque tile) and favicons stay readable', () => {
  for (const file of ['icons/icon-192.png', 'icons/icon-512.png']) {
    const png = decodePng(readFileSync(path.join(publicDir, file)))
    assert.equal(png.pixel(0, 0)[3], 0, `${file} corner transparent`)
    assert.equal(png.pixel(png.width - 1, png.height - 1)[3], 0, `${file} corner transparent`)
    const mid = png.pixel(Math.round(png.width / 2), 8)
    assert.equal(mid[3], 255, `${file} tile opaque near the top edge`)
    assert.ok(mid[2] > mid[0], `${file} navy background`)
  }
  const apple = decodePng(readFileSync(path.join(publicDir, 'icons/apple-touch-icon.png')))
  assert.equal(apple.pixel(0, 0)[3], 255, 'Apple touch icon is fully opaque (iOS applies its own mask)')
  const favicon = decodePng(readFileSync(path.join(publicDir, 'icons/favicon-16.png')))
  let amberPixels = 0
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const [r, g, b, a] = favicon.pixel(x, y)
    if (a > 200 && r > 180 && g > 100 && b < 120) amberPixels++
  }
  assert.ok(amberPixels >= 3, `16 px favicon still shows the amber play symbol (${amberPixels} px)`)
})
