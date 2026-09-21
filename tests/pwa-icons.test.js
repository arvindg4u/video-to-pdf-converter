import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, pngDimensions } from './helpers/png.js'
import { MASTER_PATH, renderIcons, toHex, VARIANTS } from '../scripts/render-icons.mjs'

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

const icon = (file) => decodePng(readFileSync(path.join(publicDir, 'icons', file)))
const isLight = ([r, g, b]) => r > 200 && g > 200 && b > 200
const isAmber = ([r, g, b]) => r > 200 && g > 120 && g < 200 && b < 90
const isNavy = ([r, g, b]) => r < 70 && g < 90 && b > r && b > g

test('every shipped icon is a real PNG with the advertised dimensions', () => {
  for (const [file, size] of Object.entries(EXPECTED_ICONS)) {
    const buffer = readFileSync(path.join(publicDir, file))
    assert.deepEqual(pngDimensions(buffer), { width: size, height: size }, file)
  }
  assert.deepEqual(Object.keys(EXPECTED_ICONS).map((file) => file.replace('icons/', '')).sort(), VARIANTS.map((variant) => variant.file).sort())
})

test('shipped icons are exactly what the renderer produces from the design master', () => {
  const masterBuffer = readFileSync(MASTER_PATH)
  const master = decodePng(masterBuffer)
  assert.equal(master.width, 1024)
  assert.equal(master.height, 1024)
  assert.ok(!MASTER_PATH.includes(`${path.sep}public${path.sep}`), 'the master must not ship with the app')

  const rendered = renderIcons(masterBuffer)
  for (const { file, png } of rendered.icons) {
    const committed = readFileSync(path.join(publicDir, 'icons', file))
    assert.ok(committed.equals(png), `public/icons/${file} is stale: run \`npm run icons\``)
  }
  assert.ok(rendered.maskableZoom <= 1 && rendered.maskableZoom > 0.5, `maskable zoom ${rendered.maskableZoom}`)
  // The manifest colours must match the master's background so splash screens are seamless.
  assert.equal(manifest.background_color, toHex(rendered.background))
  assert.equal(manifest.theme_color, toHex(rendered.background))
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

  const purposes = manifest.icons.map((entry) => entry.purpose)
  assert.ok(purposes.every((purpose) => purpose === 'any' || purpose === 'maskable'), 'no combined "any maskable" entries')
  assert.ok(purposes.includes('any') && purposes.includes('maskable'))
  const sizesFor = (purpose) => manifest.icons.filter((entry) => entry.purpose === purpose).map((entry) => entry.sizes)
  assert.deepEqual(sizesFor('any').sort(), ['192x192', '512x512'])
  assert.deepEqual(sizesFor('maskable'), ['512x512'])

  for (const entry of manifest.icons) {
    assert.ok(!entry.src.startsWith('/'), `${entry.src} must be manifest-relative for subdirectory hosting`)
    const file = path.join(publicDir, entry.src)
    assert.ok(existsSync(file), `${entry.src} exists`)
    const [w, h] = entry.sizes.split('x').map(Number)
    assert.deepEqual(pngDimensions(readFileSync(file)), { width: w, height: h }, entry.src)
    assert.equal(entry.type, 'image/png')
  }
})

test('index.html metadata matches the manifest branding and references shipped icons', () => {
  assert.match(indexHtml, /<title>PDF Lab — Video & Markdown to PDF<\/title>/)
  assert.match(indexHtml, /<link rel="manifest" href="\/manifest\.json">/)
  assert.match(indexHtml, /<meta name="application-name" content="PDF Lab">/)
  assert.match(indexHtml, /<meta name="apple-mobile-web-app-title" content="PDF Lab">/)
  assert.match(indexHtml, /<meta name="theme-color" content="#[0-9a-f]{6}">/i)
  assert.doesNotMatch(indexHtml, /serviceWorker\.register/, 'registration lives in the app (production only), not inline')
  const links = [...indexHtml.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="\/([^"]+)"/g)]
  assert.ok(links.length >= 3)
  for (const href of links) {
    assert.ok(existsSync(path.join(publicDir, href[1])), `${href[1]} exists`)
  }
  assert.match(indexHtml, /rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png" sizes="180x180"/)
  assert.match(indexHtml, /href="\/icons\/favicon-32\.png" type="image\/png" sizes="32x32"/)
  assert.match(indexHtml, /href="\/icons\/favicon-16\.png" type="image\/png" sizes="16x16"/)
})

test('maskable icon keeps all artwork inside the 40 %-radius safe circle on an opaque background', () => {
  const png = icon('icon-512-maskable.png')
  const size = png.width
  const centre = (size - 1) / 2
  const safeRadius = 0.4 * size

  // Fully opaque everywhere (corners included): required for masking.
  for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1], [Math.round(centre), Math.round(centre)]]) {
    assert.equal(png.pixel(x, y)[3], 255, `pixel ${x},${y} opaque`)
  }

  // Outside the safe circle only the solid navy background may appear.
  const corner = png.pixel(2, 2)
  assert.ok(isNavy(corner), `background is navy, got ${corner}`)
  let samples = 0
  for (let angle = 0; angle < 360; angle += 2) {
    for (const radius of [safeRadius + 2, safeRadius + 24, size / 2 - 2]) {
      const x = Math.round(centre + radius * Math.cos((angle * Math.PI) / 180))
      const y = Math.round(centre + radius * Math.sin((angle * Math.PI) / 180))
      if (x < 0 || y < 0 || x >= size || y >= size) continue
      const pixel = png.pixel(x, y)
      assert.ok(isNavy(pixel), `ring sample at ${x},${y} is background, got ${pixel}`)
      samples++
    }
  }
  assert.ok(samples > 300)

  // …and the artwork really is inside: the light page left of centre and the
  // amber play symbol in the lower right of the page.
  const page = png.pixel(Math.round(centre - 0.15 * size), Math.round(centre))
  assert.ok(isLight(page), `light document inside the safe zone, got ${page}`)
  const amber = png.pixel(Math.round(centre + 0.14 * size), Math.round(centre + 0.12 * size))
  assert.ok(isAmber(amber), `amber play symbol inside the safe zone, got ${amber}`)
})

test('ordinary icons are rounded tiles with the artwork; Apple icon is full-bleed; favicons stay readable', () => {
  for (const file of ['icon-192.png', 'icon-512.png']) {
    const png = icon(file)
    const size = png.width
    assert.equal(png.pixel(0, 0)[3], 0, `${file} corner transparent`)
    assert.equal(png.pixel(size - 1, size - 1)[3], 0, `${file} corner transparent`)
    const top = png.pixel(Math.round(size / 2), Math.round(size * 0.02))
    assert.equal(top[3], 255, `${file} tile opaque near the top edge`)
    assert.ok(isNavy(top), `${file} navy background, got ${top}`)
    assert.ok(isLight(png.pixel(Math.round(size * 0.35), Math.round(size * 0.5))), `${file} light document`)
    assert.ok(isAmber(png.pixel(Math.round(size * 0.66), Math.round(size * 0.64))), `${file} amber play symbol`)
  }

  const apple = icon('apple-touch-icon.png')
  assert.equal(apple.channels, 3, 'Apple touch icon has no alpha channel (iOS applies its own mask)')
  assert.ok(isNavy(apple.pixel(0, 0)), 'Apple touch icon corner is navy')
  assert.ok(isLight(apple.pixel(63, 90)))

  for (const [file, minimum] of [['favicon-32.png', 20], ['favicon-16.png', 4]]) {
    const png = icon(file)
    let amberPixels = 0
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const [r, g, b, a] = png.pixel(x, y)
        if (a > 200 && r > 180 && g > 100 && b < 120) amberPixels++
      }
    }
    assert.ok(amberPixels >= minimum, `${file} still shows the amber play symbol (${amberPixels} px)`)
    assert.equal(png.pixel(0, 0)[3], 0, `${file} rounded corner`)
  }
})
