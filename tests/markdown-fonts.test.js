import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createNotesDocument } from '../src/markdown/render.js'
import { DEFAULT_NOTES_FONT, NOTES_FONTS, NOTES_FONT_STORAGE_KEY, normalizeNotesFont, readNotesFont, writeNotesFont } from '../src/markdown/notesFont.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const fontsDir = `${root}src/markdown/fonts/`
const fontCss = read('../src/markdown/fonts.css')
const handCss = read('../src/markdown/handwriting.css')

test('the handwriting face ships as bundled WOFF2 files (Latin + Devanagari, 400 + 700) under the OFL', () => {
  const files = readdirSync(fontsDir).sort()
  assert.deepEqual(files, ['OFL-Kalam.txt', 'kalam-devanagari-400.woff2', 'kalam-devanagari-700.woff2', 'kalam-latin-400.woff2', 'kalam-latin-700.woff2'])
  for (const file of files.filter((name) => name.endsWith('.woff2'))) {
    const bytes = readFileSync(fontsDir + file)
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${file} is a WOFF2 file`)
    assert.ok(statSync(fontsDir + file).size < 160 * 1024, `${file} stays small enough to precache (${bytes.length} bytes)`)
  }
  const licence = readFileSync(`${fontsDir}OFL-Kalam.txt`, 'utf8')
  assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/)
  assert.match(licence, /Indian Type Foundry/)
})

test('fonts.css declares exactly the bundled faces, locally, with per-script unicode ranges', () => {
  const faces = fontCss.match(/@font-face\s*{[^}]*}/g)
  assert.equal(faces.length, 4)
  const summary = faces.map((face) => ({
    family: face.match(/font-family:\s*'([^']+)'/)[1],
    weight: face.match(/font-weight:\s*(\d+)/)[1],
    src: face.match(/url\('([^']+)'\)/)[1],
    range: face.match(/unicode-range:\s*([^;]+);/)[1],
  }))
  assert.deepEqual(summary.map((face) => `${face.family}:${face.weight}:${face.src}`).sort(), [
    "Kalam:400:./fonts/kalam-devanagari-400.woff2",
    "Kalam:400:./fonts/kalam-latin-400.woff2",
    "Kalam:700:./fonts/kalam-devanagari-700.woff2",
    "Kalam:700:./fonts/kalam-latin-700.woff2",
  ])
  for (const face of summary) {
    assert.ok(face.src.includes('devanagari') ? face.range.includes('U+0900-097F') : face.range.includes('U+0000-00FF'), `${face.src} covers its script`)
  }
  assert.doesNotMatch(fontCss, /https?:\/\//, 'no remote font requests: exports must never stall on the network')
})

test('the handwritten layer only changes faces and metrics, keeps code and math untouched, and survives print resets', () => {
  assert.match(handCss, /body\.font-hand\s*{[^}]*--font-body:\s*'Kalam'/)
  assert.match(handCss, /body\.font-hand\s*{[^}]*font-size:\s*12\.5pt/)
  assert.match(handCss, /body\.font-hand\.revision-mode\s*{[^}]*font-size:\s*12pt/)
  assert.match(handCss, /@media print\s*{[^}]*body\.font-hand\s*{[^}]*font-size:\s*12\.5pt/)
  // Emphasis becomes a highlighter mark (Kalam has no italic), never inside code or math.
  assert.match(handCss, /body\.font-hand em,\s*body\.font-hand i\s*{[^}]*font-style:\s*normal/)
  assert.match(handCss, /body\.font-hand code em, body\.font-hand \.katex em\s*{\s*background:\s*none/)
  assert.doesNotMatch(handCss, /--font-mono|\.katex\s*{/, 'code and math faces are not redefined')
  assert.doesNotMatch(handCss, /--font-meta/, 'running header/footer keep the printed sans face')
})

test('createNotesDocument applies the handwritten class only for the closed value "hand"', () => {
  const body = (options) => createNotesDocument({ html: '<p>x</p>', styles: '', ...options }).match(/<body class="([^"]*)"/)[1]
  assert.equal(body({}), 'study-mode')
  assert.equal(body({ font: 'book' }), 'study-mode')
  assert.equal(body({ font: 'hand' }), 'study-mode font-hand')
  assert.equal(body({ font: 'hand', mode: 'revision' }), 'revision-mode font-hand')
  assert.equal(body({ font: 'hand" onload="x' }), 'study-mode', 'unknown values never reach the markup')
})

test('the notes-font preference is validated, defaults to handwritten, and tolerates broken storage', () => {
  assert.deepEqual(NOTES_FONTS.map((font) => font.value), ['hand', 'book'])
  assert.equal(DEFAULT_NOTES_FONT, 'hand')
  assert.equal(normalizeNotesFont('book'), 'book')
  assert.equal(normalizeNotesFont('comic'), 'hand')
  assert.equal(normalizeNotesFont(undefined), 'hand')

  const store = new Map()
  const storage = { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, value) }
  assert.equal(readNotesFont(storage), 'hand')
  assert.equal(writeNotesFont('book', storage), 'book')
  assert.equal(store.get(NOTES_FONT_STORAGE_KEY), 'book')
  assert.equal(readNotesFont(storage), 'book')
  assert.equal(writeNotesFont('nonsense', storage), 'hand', 'invalid writes are normalised')
  assert.equal(readNotesFont(storage), 'hand')

  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') } }
  assert.equal(readNotesFont(broken), 'hand')
  assert.equal(writeNotesFont('book', broken), 'book')
  assert.equal(readNotesFont(null), 'hand')
  assert.equal(writeNotesFont('book', null), 'book')
})
