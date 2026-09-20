import test from 'node:test'
import assert from 'node:assert/strict'
import { createNotesDocument, renderMarkdown } from '../src/markdown/render.js'

/**
 * Phase 15 security audit battery: every payload family from the hardening
 * plan is rendered and must come out inert, while legitimate academic
 * features (tables, task lists, footnotes, math, code, details) survive.
 */

const ATTACKS = {
  script: '<script>alert(document.domain)</script>',
  iframe: '<iframe src="https://evil.test"></iframe>',
  javascriptLink: '[click](javascript:alert(1))',
  javascriptHrefCase: '<a href="JaVaScRiPt:alert(1)">x</a>',
  dataHtmlLink: '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  dataHtmlImage: '![x](data:text/html;base64,YQ==)',
  svgImage: '![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)',
  inlineSvg: '<svg onload="alert(1)"><circle r="10">',
  eventHandlers: '<img src="https://example.org/x.png" onerror="alert(1)" onclick="alert(2)">',
  styleTag: '<style>body{display:none} .x{background:url(https://evil.test)}</style>',
  styleAttr: '<p style="color:expression(alert(1))">x</p>',
  form: '<form action="https://evil.test"><input name="q"></form>',
  objectEmbed: '<object data="https://evil.test/x.swf"></object><embed src="https://evil.test/x">',
  katexHref: '$\\href{javascript:alert(1)}{click}$',
  katexInclude: '$\\includegraphics{https://evil.test/x.png}$',
  linkTitleBreakout: '[x](https://example.org "title" onmouseover="alert(1)")',
}

test('no active content survives rendering', () => {
  for (const [name, markdown] of Object.entries(ATTACKS)) {
    const html = renderMarkdown(markdown)
    assert.doesNotMatch(html, /<script/i, name)
    assert.doesNotMatch(html, /<iframe/i, name)
    // KaTeX echoes untrusted input inside <annotation> TEXT (inert by
    // definition, and scripts are impossible under the export CSP), so URL
    // schemes are only dangerous in real link/image attributes.
    if (name.startsWith('katex')) {
      assert.doesNotMatch(html, /<a[ >]/i, name)
      assert.doesNotMatch(html, /(href|src)\s*=\s*["']?\s*javascript:/i, name)
    } else {
      assert.doesNotMatch(html, /javascript:/i, name)
    }
    assert.doesNotMatch(html, /data:text\/html/i, name)
    // Event handlers are only dangerous as real element attributes; the same
    // text in inert text content (e.g. a non-link that merely mentions
    // "onmouseover=") cannot execute.
    assert.doesNotMatch(html, /<[a-zA-Z][^>]*\son\w+\s*=/i, name)
    assert.doesNotMatch(html, /<style/i, name)
    assert.doesNotMatch(html, /<form/i, name)
    assert.doesNotMatch(html, /<svg/i, name)
    assert.doesNotMatch(html, /<(object|embed)/i, name)
  }
})

test('SVG data URLs are rejected even though raster data URLs pass', () => {
  const svg = renderMarkdown(ATTACKS.svgImage)
  assert.doesNotMatch(svg, /data:image\/svg/i)
  assert.match(svg, /Image unavailable/)
  const raster = renderMarkdown('![ok](data:image/png;base64,YQ==)')
  assert.match(raster, /src="data:image\/png;base64,YQ=="/)
})

test('KaTeX cannot exfiltrate: trust off, errors contained', () => {
  const html = renderMarkdown(`${ATTACKS.katexHref}\n\n${ATTACKS.katexInclude}`)
  // No clickable/requesting construct may reference the payloads (their only
  // appearance is the inert <annotation> source echo).
  assert.doesNotMatch(html, /<a[ >]/)
  assert.doesNotMatch(html, /(href|src)\s*=\s*["']?\s*javascript:/i)
  assert.doesNotMatch(html, /(href|src)\s*=\s*["']?https?:\/\/evil\.test/i)
  // Malformed/unsafe math renders as an error span, not a crash or link.
  assert.match(html, /mathcolor="#cc0000"/)
})

test('over-sanitization check: legitimate academic features survive', () => {
  const html = renderMarkdown([
    '# Title',
    '',
    '| A | B |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '- [x] done',
    '',
    'Fact[^1].',
    '',
    '[^1]: source',
    '',
    'Inline $x^2$ and:',
    '',
    '$$',
    'y = mx + b',
    '$$',
    '',
    '```js',
    'const x = 1',
    '```',
    '',
    '<details><summary>More</summary>hidden</details>',
    '',
    '[safe](https://example.org)',
  ].join('\n'))
  for (const [name, pattern] of [
    ['table', /<table>/],
    ['task list', /task-list-item/],
    ['footnotes', /data-footnotes/],
    ['inline math', /class="katex"/],
    ['display math', /katex-display/],
    ['highlighting', /hljs/],
    ['details', /<details>/],
    ['safe link', /href="https:\/\/example\.org"/],
  ]) {
    assert.match(html, pattern, name)
  }
})

test('export document CSP forbids scripts, forms, and arbitrary origins', () => {
  const document = createNotesDocument({
    html: renderMarkdown('# Hi\n\n<script>alert(1)</script>'),
    title: 'Notes',
    paper: 'A4',
    styles: 'body{}',
  })
  assert.match(document, /Content-Security-Policy/)
  assert.match(document, /default-src 'none'/)
  assert.match(document, /form-action 'none'/)
  assert.match(document, /base-uri 'none'/)
  assert.doesNotMatch(document, /script-src/)
  assert.doesNotMatch(document, /<script/)
})
