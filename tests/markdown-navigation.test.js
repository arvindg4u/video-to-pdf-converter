import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderStudyMarkdown, createNotesDocument } from '../src/markdown/render.js'
import { resolveDocumentMetadata, bindPreviewNavigation, TOC_MIN_HEADINGS } from '../src/markdown/navigation.js'
import { longStudyNotes } from './fixtures/long-study-notes.js'
const styles = readFileSync(new URL('../src/markdown/study.css', import.meta.url), 'utf8')

for (const source of ['Plain notes', '# One', '# One\n\n## Two\n\n### Three']) {
  test(`no TOC below threshold: ${source.split('\n')[0]}`, () => {
    assert.equal(TOC_MIN_HEADINGS, 4)
    assert.equal(renderStudyMarkdown(source).tocHtml, '')
  })
}
test('TOC follows H1–H3 hierarchy, order and existing numbering without adding numbers', () => {
  const { tocHtml, headings } = renderStudyMarkdown('# 1. Polity\n\n## 1.1 Rights\n\n### Article 14\n\n## History\n\n#### Details')
  assert.deepEqual(headings.map((h) => h.text), ['1. Polity', '1.1 Rights', 'Article 14', 'History'])
  assert.match(tocHtml, /^<nav class="notes-toc" aria-label="Contents">/)
  assert.match(tocHtml, /1\. Polity<\/a><ul><li><a/)
  assert.match(tocHtml, /1\.1 Rights<\/a><ul><li><a/)
  assert.doesNotMatch(tocHtml, /<ol|Details|counter/)
})
test('skipped and leading heading levels attach to the nearest shallower ancestor', () => {
  const result = renderStudyMarkdown('### Initial\n\n# Chapter\n\n### Skipped\n\n## Topic')
  assert.match(result.tocHtml, /Initial<\/a><\/li><li><a/)
  assert.match(result.tocHtml, /Chapter<\/a><ul><li><a[^>]+>Skipped<\/a><\/li><li><a[^>]+>Topic/)
})
test('duplicate and Hindi heading links match the actual sanitized IDs', () => {
  const { html, tocHtml, headings } = renderStudyMarkdown('# भारतीय संविधान\n\n## Rights\n\n## Rights\n\n### अनुच्छेद 14')
  assert.equal(new Set(headings.map((h) => h.id)).size, 4)
  assert.ok(headings.some((h) => h.id === 'user-content-rights-1'))
  for (const [, href] of tocHtml.matchAll(/href="#([^"]+)"/g)) assert.ok(html.includes(`id="${decodeURIComponent(href)}"`))
  assert.match(tocHtml, /भारतीय संविधान/)
})
test('TOC text comes from rendered formatting, aliases, entities, image alt and math', () => {
  const { headings, tocHtml } = renderStudyMarkdown('# **Bold** and *italic* &amp; `code`\n\n## [[Other|Alias]]\n\n## ![Diagram](https://example.test/image.png)\n\n### $x^2$')
  assert.deepEqual(headings.slice(0, 3).map((h) => h.text), ['Bold and italic & code', 'Alias', 'Diagram'])
  assert.match(headings[3].text, /x/)
  assert.doesNotMatch(tocHtml, /<strong|<img|<math|<code|<a[^>]*>[^<]*<a/)
})
test('dangerous HTML and link content cannot become executable TOC markup', () => {
  const result = renderStudyMarkdown('# Good <script>alert(1)</script>\n\n## [click](javascript:alert(1))\n\n## <img src="x" onerror="alert(1)">\n\n### &lt;script&gt; inert\n\n# Last')
  assert.ok(result.tocHtml)
  assert.doesNotMatch(result.tocHtml, /<script|onerror=|href="javascript:|<img/)
  for (const [, href] of result.tocHtml.matchAll(/href="([^"]+)"/g)) assert.ok(href.startsWith('#user-content-'))
})
test('footnotes and closed details do not create invisible navigation destinations', () => {
  const result = renderStudyMarkdown('# One\n\n## Two\n\n## Three\n\n## Four\n\nFact[^a].\n\n[^a]: Source\n\n<details><summary>Hidden</summary>\n\n## Hidden topic\n\n</details>')
  assert.equal(result.headings.length, 4)
  assert.doesNotMatch(result.tocHtml, /Footnotes|Hidden topic/)
})
test('frontmatter title and subject precede contents without exposing YAML', () => {
  const rendered = renderStudyMarkdown('---\ntitle: RAS Complete Notes\nsubject: Indian Polity\nprivate: not-for-print\n---\n# A\n\n## B\n\n## C\n\n## D')
  const html = createNotesDocument({ ...rendered, title: 'Field', fileName: 'Filename.md', styles })
  assert.match(html, /<title>RAS Complete Notes<\/title>/)
  assert.match(html, /notes-subject">Indian Polity/)
  assert.ok(html.indexOf('notes-document-title">') < html.indexOf('<nav'))
  assert.ok(html.indexOf('<nav') < html.indexOf('<main>'))
  assert.doesNotMatch(html, /not-for-print|subject: Indian|title: RAS/)
})
test('metadata fallback is title field, filename, default; non-string metadata is inert', () => {
  assert.equal(resolveDocumentMetadata({ title: 'Field', fileName: 'file.md' }).title, 'Field')
  assert.equal(resolveDocumentMetadata({ title: ' ', fileName: 'file.MARKDOWN' }).title, 'file')
  assert.equal(resolveDocumentMetadata({ metadata: { title: ['x'] } }).title, 'Study notes')
  assert.equal(resolveDocumentMetadata({ metadata: { subject: ['x'] } }).subject, '')
})
test('metadata and running context cannot escape HTML or CSS boundaries', () => {
  const html = createNotesDocument({ html: '', styles: '', metadata: { title: '</title><script>bad</script>', subject: '<img onerror=x>' }, headings: [{ level: 1, text: '";} </style><script>bad</script>\\\n' }] })
  assert.doesNotMatch(html, /<script>|<img onerror/)
  assert.equal((html.match(/<\/style>/g) || []).length, 1)
  assert.match(html, /\\3c /)
  assert.match(html, /default-src 'none'/)
})
test('native margin counters work with either paper size; header uses heading not UI title', () => {
  for (const paper of ['A4', 'Letter']) {
    const html = createNotesDocument({ html: '', styles, paper, title: 'UI title', headings: [{ level: 1, text: 'ABC' }] })
    assert.match(html, /@bottom-center \{ content: counter\(page\)/)
    assert.match(html, /@top-center \{ content: "\\41 \\42 \\43 "/)
    assert.ok(html.includes(`size: ${paper}; margin: 16mm 16mm 18mm`))
    assert.doesNotMatch(html, /counter\(pages\)|string-set:|position: fixed/)
  }
})
test('only later top-level H1s with intervening content get chapter breaks', () => {
  const { html } = renderStudyMarkdown('# First\n\n# Consecutive\n\nText\n\n## Topic\n\n# Second\n\n> # Quoted heading\n> Content')
  assert.equal((html.match(/class="notes-chapter"/g) || []).length, 1)
  assert.match(html, /<h1 id="user-content-second"[^>]*class="notes-chapter"/)
  assert.match(styles, /@media print \{\s*main > h1.notes-chapter \{ break-before: page; page-break-before: always;/)
})
test('existing keep-with-content, callout/image/table pagination stays intact', () => {
  for (const rule of [/h1, h2, h3, h4 \{ break-after: avoid-page/, /thead \{ display: table-header-group/, /tr, img, \.callout, figure \{ break-inside: avoid/, /orphans: 3; widows: 3/, /\.notes-toc, \.notes-toc li, \.notes-toc ul \{ break-inside: auto/]) assert.match(styles, rule)
})
test('large mixed document derives hundreds of stable destinations in one pipeline', (t) => {
  const source = longStudyNotes()
  const start = performance.now()
  const result = renderStudyMarkdown(source)
  const elapsed = performance.now() - start
  t.diagnostic(`${source.length} characters, ${result.headings.length} headings, ${elapsed.toFixed(0)} ms`)
  assert.equal(result.headings.length, 300)
  assert.equal((result.tocHtml.match(/<a /g) || []).length, 300)
  assert.equal(new Set(result.headings.map((h) => h.id)).size, 300)
  assert.equal((result.html.match(/<table>/g) || []).length, 60)
  assert.equal((result.html.match(/class="katex"/g) || []).length, 60)
  assert.equal((result.html.match(/<img /g) || []).length, 60)
  assert.equal((result.html.match(/class="callout callout-tip"/g) || []).length, 60)
  for (const heading of result.headings) assert.ok(result.html.includes(`id="${heading.id}"`))
  assert.ok(elapsed < 15000, 'generous regression guard, not a browser responsiveness claim')
})
test('srcdoc enhancement scrolls/focuses real fragment targets and cleans up', () => {
  let listener, removed = false, scrolled = false, focused = false, prevented = false
  const target = { scrollIntoView() { scrolled = true }, focus() { focused = true } }
  let href = '#user-content-%E0%A4%AD%E0%A4%BE%E0%A4%B0%E0%A4%A4'
  const link = { getAttribute: () => href, setAttribute: (_, value) => { href = value } }
  const doc = { querySelectorAll: () => [link], defaultView: { location: { hash: '' } }, getElementById: (id) => id === 'user-content-भारत' ? target : null,
    addEventListener: (_, fn) => { listener = fn }, removeEventListener: (_, fn) => { removed = fn === listener } }
  const cleanup = bindPreviewNavigation(doc)
  assert.ok(href.startsWith('about:srcdoc#'))
  listener({ button: 0, target: { closest: () => link }, preventDefault() { prevented = true } })
  assert.ok(scrolled && focused && prevented)
  assert.equal(decodeURIComponent(doc.defaultView.location.hash), 'user-content-भारत')
  cleanup(); assert.ok(removed)
})
test('multiple chapters never get a misleading fixed first-chapter running header', () => {
  const result = renderStudyMarkdown('# Polity\n\nNotes\n\n# History\n\nNotes')
  const doc = createNotesDocument({ ...result, styles: '' })
  assert.match(doc, /@top-center \{ content: ""/)
})
