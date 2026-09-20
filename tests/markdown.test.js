import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createNotesDocument, renderMarkdown } from '../src/markdown/render.js'

test('renders CommonMark headings, emphasis, nested lists, links and quotes', () => {
  const html = renderMarkdown('# Title\n\n## Section\n\n### Third\n\n#### Fourth\n\n##### Fifth\n\n###### Sixth\n\n**bold** *italic* ~~removed~~ `code`\n\n1. First\n   - Nested\n\n> Quote\n\n---\n\n[Link](https://example.org)')
  for (let level = 1; level <= 6; level++) assert.match(html, new RegExp(`<h${level} id="user-content-`))
  for (const tag of ['strong', 'em', 'del', 'code', 'ol', 'ul', 'blockquote', 'hr']) assert.match(html, new RegExp(`<${tag}[ >]`))
  assert.match(html, /target="_blank" rel="noopener noreferrer"/)
})

test('renders GFM tables, alignment, task lists and autolinks', () => {
  const html = renderMarkdown('| Name | Value |\n| :--- | ---: |\n| A | 2 |\n\n- [x] Done\n- [ ] Todo\n\nhttps://example.org')
  assert.match(html, /<table>/)
  assert.match(html, /align="right"/)
  assert.match(html, /type="checkbox" checked disabled/)
  assert.match(html, /type="checkbox" disabled/)
  assert.match(html, /href="https:\/\/example.org"/)
})

test('footnotes and heading anchors resolve to sanitized IDs', () => {
  const html = renderMarkdown('# Core ideas\n\n[Jump](#core-ideas)\n\nFact[^1].\n\n[^1]: A reference.')
  for (const [, href] of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(html.includes(`id="${href}"`), `Missing target for #${href}`)
  }
  assert.match(html, /data-footnotes/)
})

test('renders math and syntax highlighting without executing code', () => {
  const html = renderMarkdown('Inline $E = mc^2$.\n\n$$\n\\frac{a}{b}\n$$\n\n```python\ndef add(a, b):\n    return a + b\n```\n\n```unknown-language\n<unsafe>\n```')
  assert.match(html, /class="katex"/)
  assert.match(html, /katex-display/)
  assert.match(html, /<math /)
  assert.match(html, /hljs-keyword/)
  assert.match(html, /&#x3C;unsafe>/)
})

test('retains safe HTML and images while removing active content', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<iframe src="https://evil.test"></iframe>\n\n<img src="https://example.org/x.png" onerror="alert(1)">\n\n<a href="javascript:alert(1)">Bad</a>\n\n<details><summary>More</summary>Notes</details>\n\n![Diagram](./local.png)\n\n![Unsafe](data:text/html;base64,YQ==)\n\n![Pixel](data:image/png;base64,YQ==)')
  assert.doesNotMatch(html, /<script|<iframe|onerror|javascript:|data:text\/html/)
  assert.match(html, /<details>/)
  assert.match(html, /src="https:\/\/example.org\/x.png" referrerpolicy="no-referrer"/)
  assert.match(html, /\[Image unavailable: Diagram\]/)
  assert.match(html, /src="data:image\/png;base64,YQ=="/)
})

test('math trust is disabled and malformed math does not crash rendering', () => {
  const html = renderMarkdown('$\\href{javascript:alert(1)}{click}$\n\n$\\notacommand{x}$')
  assert.doesNotMatch(html, /href="javascript:/)
  assert.match(html, /mathcolor="#cc0000"/)
})

test('escapes document metadata, constrains paper size, and isolates content', () => {
  const document = createNotesDocument({ html: '<p>Notes</p>', title: '</title><script>alert(1)</script>', paper: 'Letter; color:red', styles: 'body{color:black}' })
  assert.doesNotMatch(document, /<script>/)
  assert.match(document, /&lt;script&gt;/)
  assert.match(document, /@page \{ size: A4;/)
  assert.match(document, /default-src 'none'/)
  assert.match(document, /<main><p>Notes<\/p><\/main>/)
  assert.match(createNotesDocument({ html: '', title: '', paper: 'Letter', styles: '' }), /size: Letter;/)
})

test('renders the bundled academic notes sample', () => {
  const html = renderMarkdown(readFileSync(new URL('../examples/academic-study-notes.md', import.meta.url), 'utf8'))
  for (const markup of ['<table>', 'katex-display', 'hljs-keyword', 'data-footnotes', 'task-list-item']) assert.ok(html.includes(markup), markup)
})
