/**
 * Colour-system guard rails (docs/PALETTE.md).
 *
 * Parses the design tokens in src/index.css and checks every pairing the UI
 * relies on against WCAG 2.2 thresholds: 4.5:1 for text (SC 1.4.3) and 3:1 for
 * user-interface components, focus indicators and meaningful graphics
 * (SC 1.4.11). Also keeps component stylesheets token-only, so the palette
 * really is defined in one place.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { THEME_COLORS } from '../src/pwa/themeColor.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(path.join(root, 'src/index.css'), 'utf8')

function tokensOf(selector) {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, `${selector} block present`)
  const block = css.slice(start, css.indexOf('}', start))
  const tokens = {}
  for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[match[1]] = match[2].trim()
  return tokens
}

function resolve(tokens, value) {
  const reference = value.match(/^var\(--([\w-]+)\)$/)
  return reference ? resolve(tokens, tokens[reference[1]]) : value
}

const light = tokensOf(':root')
const dark = { ...light, ...tokensOf(":root[data-theme='dark']") }
const darkOwn = tokensOf(":root[data-theme='dark']")

function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `${hex} is a 6-digit hex colour`)
  const channel = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const SURFACES = ['bg-base', 'surface-solid', 'surface-muted']
/** [foreground, background, minimum ratio, why] */
const PAIRINGS = [
  ...['text-main', 'text-soft', 'text-dim', 'highlight-text', 'danger', 'accent'].flatMap((fg) =>
    SURFACES.map((bg) => [fg, bg, 4.5, 'text on surfaces'])),
  ...['border-strong', 'highlight-border', 'success', 'warning', 'accent'].flatMap((fg) =>
    SURFACES.map((bg) => [fg, bg, 3, 'component boundaries, status dots, focus rings'])),
  ['on-accent', 'accent', 4.5, 'button label'],
  ['on-accent', 'accent-2', 4.5, 'button label at the gradient end'],
  ['on-danger', 'danger', 4.5, 'destructive button label'],
  ['on-highlight', 'highlight', 4.5, 'label on an amber fill'],
  ['text-main', 'highlight-soft', 4.5, 'notice text on the amber wash'],
  ['text-main', 'success-soft', 4.5, 'notice text on the green wash'],
  ['text-main', 'danger-soft', 4.5, 'notice text on the red wash'],
  ['text-main', 'accent-soft', 4.5, 'text on the navy wash'],
  ['text-soft', 'highlight-soft', 4.5, 'help text on the amber wash'],
  ['highlight-text', 'highlight-soft', 4.5, 'file badge'],
  ['success', 'success-soft', 3, 'notice border against its wash'],
  ['danger', 'danger-soft', 3, 'notice border against its wash'],
  ['accent', 'progress-track', 3, 'progress fill against its track'],
]

for (const [name, tokens] of [['light', light], ['dark', dark]]) {
  test(`${name} theme meets WCAG 2.2 contrast for every pairing the UI uses`, () => {
    const failures = []
    for (const [fg, bg, minimum, why] of PAIRINGS) {
      const ratio = contrast(resolve(tokens, tokens[fg]), resolve(tokens, tokens[bg]))
      if (ratio < minimum) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)} < ${minimum} (${why})`)
    }
    // The slider thumb is amber with a ring; either the fill or the ring must mark its boundary on the track.
    const track = resolve(tokens, tokens['progress-track'])
    const thumb = Math.max(contrast(resolve(tokens, tokens.highlight), track), contrast(resolve(tokens, tokens['thumb-ring']), track))
    if (thumb < 3) failures.push(`slider thumb against track: ${thumb.toFixed(2)} < 3`)
    assert.deepEqual(failures, [])
  })
}

test('both themes define the same tokens (no light-only colour leaks into dark mode)', () => {
  const lightKeys = Object.keys(light).filter((key) => key !== 'brand-shadow').sort()
  const darkKeys = Object.keys(darkOwn).sort()
  assert.deepEqual(darkKeys, lightKeys)
})

test('backgrounds follow long-session guidance: no glaring white, no pure black', () => {
  assert.notEqual(light['surface-solid'].toLowerCase(), '#ffffff')
  assert.notEqual(light['bg-base'].toLowerCase(), '#ffffff')
  assert.ok(luminance(light['bg-base']) < luminance('#ffffff') && luminance(light['bg-base']) > 0.8, 'light base is a soft off-white')
  assert.notEqual(dark['bg-base'].toLowerCase(), '#000000')
  assert.ok(luminance(dark['bg-base']) > 0.005 && luminance(dark['bg-base']) < 0.03, 'dark base is a dark grey/navy, not black')
  assert.notEqual(dark['text-main'].toLowerCase(), '#ffffff', 'dark text is off-white, not pure white')
  assert.ok(luminance(light['text-main']) > 0.005, 'light text is a rich near-black, not #000')
})

test('the browser theme colour follows the page background of each theme', () => {
  assert.equal(THEME_COLORS.light, light['bg-base'])
  assert.equal(THEME_COLORS.dark, dark['bg-base'])
  const html = readFileSync(path.join(root, 'index.html'), 'utf8')
  assert.match(html, new RegExp(`<meta name="theme-color" content="${THEME_COLORS.light}">`))
})

test('component stylesheets use tokens only (no hard-coded colours outside src/index.css)', () => {
  for (const file of ['src/App.css', 'src/MarkdownConverter.css', 'src/pwa/pwa.css']) {
    const text = readFileSync(path.join(root, file), 'utf8')
    const literal = text.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\b(?:white|black|red|blue|green|orange)\b(?=\s*[;)])/g) || []
    assert.deepEqual(literal, [], `${file} must reference var(--…) tokens`)
  }
})
