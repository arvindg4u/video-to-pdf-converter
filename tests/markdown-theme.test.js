import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createNotesDocument, renderMarkdown } from '../src/markdown/render.js'

const css = readFileSync(new URL('../src/markdown/study.css', import.meta.url), 'utf8')
// Negative "no decoration" assertions run against code only (comments may
// legitimately mention forbidden words like "gradient").
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '')

test('body typography targets long reading sessions (11–12pt, 1.55–1.7 line-height)', () => {
  const body = /body \{[^}]*\}/.exec(css)[0]
  const size = /font:\s*([\d.]+)pt\/([\d.]+)/.exec(body)
  assert.ok(size, 'body font shorthand found')
  assert.ok(Number(size[1]) >= 11 && Number(size[1]) <= 12, `body size ${size[1]}pt in range`)
  assert.ok(Number(size[2]) >= 1.55 && Number(size[2]) <= 1.7, `line-height ${size[2]} in range`)
  assert.match(body, /var\(--font-body\)/)
})

test('font stack is offline-safe with deterministic Latin-first Devanagari fallback', () => {
  // No remote font dependency anywhere in the theme.
  assert.doesNotMatch(css, /@import/i)
  assert.doesNotMatch(css, /url\(\s*['"]?https?:/i)
  assert.doesNotMatch(css, /@font-face/i)
  const stack = /--font-body:\s*([^;]+);/.exec(css)[1]
  for (const face of ['Noto Serif Devanagari', 'Kohinoor Devanagari', 'Mangal']) {
    assert.ok(stack.includes(face), `Devanagari face ${face} present`)
  }
  for (const face of ['Georgia', 'Cambria', 'Charter']) {
    assert.ok(stack.includes(face), `Latin face ${face} present`)
  }
  // Latin faces come first so Devanagari-only faces never capture Latin glyphs.
  const firstDevanagari = stack.indexOf('Noto Serif Devanagari')
  assert.ok(stack.indexOf('Georgia') < firstDevanagari)
  assert.ok(stack.indexOf('Cambria') < firstDevanagari)
  assert.ok(stack.trim().endsWith('serif'))
})

test('heading hierarchy is differentiated but not oversized', () => {
  const sizes = {}
  for (const level of [1, 2, 3, 4, 5, 6]) {
    const rule = new RegExp(`h${level} \\{[^}]*font-size:\\s*([\\d.]+)pt`).exec(css)
    assert.ok(rule, `h${level} rule found`)
    sizes[level] = Number(rule[1])
  }
  // Strictly descending, body-proportional, nowhere near poster sizes.
  for (let level = 1; level < 6; level += 1) {
    assert.ok(sizes[level] >= sizes[level + 1], `h${level} >= h${level + 1}`)
  }
  assert.ok(sizes[1] <= 18, 'h1 stays book-like')
  assert.ok(sizes[1] >= 14, 'h1 still reads as chapter')
  assert.ok(sizes[2] >= 12 && sizes[2] < sizes[1])
  // Headings keep with following content and never split internally.
  const headingRule = /h1, h2, h3, h4, h5, h6 \{[^}]*\}/.exec(css)[0]
  assert.match(headingRule, /break-after: avoid/)
  assert.match(headingRule, /page-break-after: avoid/)
  assert.match(headingRule, /break-inside: avoid/)
  assert.match(css, /h1, h2, h3, h4 \{ break-after: avoid-page; \}/)
})

test('paragraphs and lists are tuned for compact study notes', () => {
  assert.match(css, /p \{[^}]*orphans: 3[^}]*widows: 3/s)
  const listRule = /ul, ol \{[^}]*\}/.exec(css)[0]
  assert.match(listRule, /margin: 6px 0 11px/)
  assert.match(css, /li \{ margin: 2\.5px 0; \}/)
  assert.match(css, /\.task-list-item \{ list-style: none/)
  assert.match(css, /blockquote \{[^}]*break-inside: avoid/s)
})

test('tables repeat headers across pages and avoid splitting rows', () => {
  assert.match(css, /thead \{ display: table-header-group; \}/)
  assert.match(css, /tr \{ break-inside: avoid; page-break-inside: avoid; \}/)
  const tableRule = /table \{[^}]*\}/.exec(css)[0]
  assert.match(tableRule, /font-size: 10\.5pt/)
  assert.match(tableRule, /border-collapse: collapse/)
  const cellRule = /th, td \{[^}]*\}/.exec(css)[0]
  assert.match(cellRule, /padding: 5px 9px/)
  assert.match(cellRule, /overflow-wrap: anywhere/)
  assert.match(css, /th \{[^}]*background: #e9edf1/s)
})

test('images keep aspect ratio, stay inside the page, and avoid splits', () => {
  const imgRule = /img \{[^}]*\}/.exec(css)[0]
  assert.match(imgRule, /max-width: 100%/)
  assert.match(imgRule, /height: auto/)
  assert.match(imgRule, /object-fit: contain/)
  assert.match(imgRule, /max-height: 210mm/) // fits A4 printable area
  assert.match(imgRule, /break-inside: avoid/)
})

test('callout styles are subtle, print-friendly, and limited to five variants', () => {
  for (const variant of ['note', 'tip', 'important', 'warning', 'caution']) {
    assert.match(css, new RegExp(`\\.callout-${variant} \\{`))
  }
  const calloutRule = /\.callout \{[^}]*\}/.exec(css)[0]
  assert.match(calloutRule, /break-inside: avoid/)
  assert.match(calloutRule, /print-color-adjust: exact/)
  assert.match(calloutRule, /border-left: 3px solid/)
  // No loud decoration anywhere in the theme.
  assert.doesNotMatch(cssCode, /gradient/i)
  assert.doesNotMatch(cssCode, /box-shadow/)
  assert.doesNotMatch(cssCode, /text-shadow/)
  assert.doesNotMatch(cssCode, /animation|@keyframes/)
})

test('code and math keep working with dedicated stacks and calm highlighting', () => {
  assert.match(css, /--font-mono: ui-monospace/)
  assert.match(css, /\.katex \{ font-size: 1\.06em; \}/)
  assert.match(css, /\.katex-display \{[^}]*overflow-x: auto/s)
  for (const token of ['hljs-keyword', 'hljs-string', 'hljs-number', 'hljs-comment', 'hljs-title', 'hljs-attr']) {
    assert.match(css, new RegExp(`\\.${token}[ ,{]`))
  }
})

test('print media rules improve pagination without replacing the engine', () => {
  const printBlock = /@media print \{[\s\S]*\n\}/.exec(css)[0]
  assert.match(printBlock, /print-color-adjust: exact/)
  assert.match(printBlock, /h1, h2, h3, h4 \{ break-after: avoid-page/)
  assert.match(printBlock, /orphans: 3; widows: 3/)
  assert.match(printBlock, /thead \{ display: table-header-group; \}/)
  assert.match(printBlock, /tr, img, \.callout, figure \{ break-inside: avoid/)
  assert.match(printBlock, /\.katex-display \{[^}]*break-inside: avoid/s)
  assert.match(printBlock, /box-decoration-break: clone/)
  // Paper stays white and light.
  assert.match(printBlock, /html, body \{ background: #fff; \}/)
})

test('page layout keeps A4 primary with restrained margins; Letter still works', () => {
  const a4 = createNotesDocument({ html: '<p>x</p>', title: 'T', paper: 'A4', styles: '' })
  assert.match(a4, /@page \{ size: A4; margin: 16mm 16mm 18mm; \}/)
  const letter = createNotesDocument({ html: '<p>x</p>', title: 'T', paper: 'Letter', styles: '' })
  assert.match(letter, /@page \{ size: Letter; margin: 16mm 16mm 18mm; \}/)
  // Security-relevant document structure is unchanged from Phase 1.
  assert.match(a4, /default-src 'none'/)
  assert.match(a4, /<header class="notes-header"><span>Exam study notes<\/span>/)
  assert.match(a4, /<main><p>x<\/p><\/main>/)
})

test('Hindi + English mixed content renders with the study structure intact', () => {
  const html = renderMarkdown([
    '# भारतीय संविधान — Indian Polity',
    '',
    '## मौलिक अधिकार (Fundamental Rights)',
    '',
    'अनुच्छेद 12–35 में **छह अधिकार** दिए गए हैं — right to equality, freedom, and more।',
    '',
    '### अनुच्छेद 21 — Right to Life',
    '',
    '#### Putta Swamy case (2017)',
    '',
    '- निजता (Privacy) — मौलिक अधिकार है ✅',
    '- Mixed line with $x^2$ math और हिंदी',
    '',
    '| अनुच्छेद | Right |',
    '| - | - |',
    '| 14 | Equality |',
  ].join('\n'))
  for (const level of [1, 2, 3, 4]) assert.match(html, new RegExp(`<h${level} id="user-content-`))
  assert.match(html, /अनुच्छेद 12–35/u)
  assert.match(html, /<strong>छह अधिकार<\/strong>/u)
  assert.match(html, /✅/u)
  assert.match(html, /class="katex"/)
  assert.match(html, /<table>/)
  assert.match(html, /<ul>/)
})
