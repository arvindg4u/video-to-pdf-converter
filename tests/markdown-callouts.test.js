import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../src/markdown/render.js'

test('renders the five common Obsidian callout types as study blocks', () => {
  const pairs = [
    ['NOTE', 'callout-note', 'Note'],
    ['IMPORTANT', 'callout-important', 'Important'],
    ['TIP', 'callout-tip', 'Tip'],
    ['WARNING', 'callout-warning', 'Warning'],
    ['CAUTION', 'callout-caution', 'Caution'],
  ]
  for (const [type, variant, label] of pairs) {
    const html = renderMarkdown(`> [!${type}]\n> Content for ${type}.`)
    assert.match(html, new RegExp(`<div class="callout ${variant}">`), type)
    assert.match(html, new RegExp(`<p class="callout-title">${label}</p>`), type)
    assert.match(html, new RegExp(`Content for ${type}\\.`), type)
    // Callouts replace the blockquote; ordinary quotes are untouched elsewhere.
    assert.doesNotMatch(html, /<blockquote>/, type)
  }
})

test('lowercase and mixed-case types work; aliases map to known variants', () => {
  assert.match(renderMarkdown('> [!tip]\n> x'), /callout callout-tip/)
  assert.match(renderMarkdown('> [!Warning]\n> x'), /callout callout-warning/)
  assert.match(renderMarkdown('> [!INFO]\n> x'), /callout callout-note/)
  assert.match(renderMarkdown('> [!info]\n> x'), /<p class="callout-title">Info<\/p>/)
  assert.match(renderMarkdown('> [!DANGER]\n> x'), /callout callout-caution/)
  assert.match(renderMarkdown('> [!ABSTRACT]\n> x'), /callout callout-note/)
})

test('unknown callout types degrade gracefully without leaking into markup', () => {
  const html = renderMarkdown('> [!MyWeirdType]\n> Body survives.')
  assert.match(html, /<div class="callout callout-note">/)
  assert.match(html, /<p class="callout-title">Myweirdtype<\/p>/)
  assert.match(html, /Body survives\./)
  // The user-written type never appears inside an attribute.
  assert.doesNotMatch(html, /class="[^"]*myweirdtype/i)
  assert.doesNotMatch(html, /=("[^"]*)?myweirdtype/i)
})

test('custom titles are used; body content stays intact', () => {
  const html = renderMarkdown('> [!NOTE] परीक्षा से पहले (Before the exam)\n> Revise **all** chapters.\n> - Point one\n> - Point two')
  assert.match(html, /<p class="callout-title">परीक्षा से पहले \(Before the exam\)<\/p>/u)
  assert.match(html, /<strong>all<\/strong>/)
  assert.match(html, /<ul>/)
  assert.match(html, /Point two/)
})

test('inline formatting on the title line belongs to the title', () => {
  const html = renderMarkdown('> [!TIP] Remember *this*\n> Body line.')
  assert.match(html, /<p class="callout-title">Remember\s*<em>this<\/em><\/p>/)
  assert.match(html, /<p>Body line\.<\/p>/)
})

test('collapsible callouts become details/summary; + expands, - collapses', () => {
  const collapsed = renderMarkdown('> [!NOTE]-\n> Hidden until opened.')
  assert.match(collapsed, /<details class="callout callout-note">/)
  assert.match(collapsed, /<summary class="callout-title">Note<\/summary>/)
  assert.doesNotMatch(collapsed, /<details[^>]*\bopen\b/)
  assert.match(collapsed, /Hidden until opened\./)
  const expanded = renderMarkdown('> [!WARNING]+\n> Visible immediately.')
  assert.match(expanded, /<details class="callout callout-warning" open>/)
  assert.match(expanded, /Visible immediately\./)
})

test('nested Markdown inside callouts keeps working: lists, code, tables, math', () => {
  const html = renderMarkdown([
    '> [!IMPORTANT] Study plan',
    '> 1. First step',
    '>    - Nested bullet',
    '> 2. Second step with `inline code` and $E = mc^2$',
    '>',
    '> ```python',
    '> print("hi")',
    '> ```',
    '>',
    '> | A | B |',
    '> | - | - |',
    '> | 1 | 2 |',
  ].join('\n'))
  assert.match(html, /callout callout-important/)
  assert.match(html, /<ol>/)
  assert.match(html, /<ul>/)
  assert.match(html, /<code>inline code<\/code>/)
  assert.match(html, /class="katex"/)
  assert.match(html, /hljs/)
  assert.match(html, /<table>/)
})

test('a callout with no body renders just its title', () => {
  const html = renderMarkdown('> [!NOTE]')
  assert.match(html, /<div class="callout callout-note"><p class="callout-title">Note<\/p><\/div>/)
})

test('ordinary blockquotes and inline [!NOTE] text are not callouts', () => {
  const html = renderMarkdown('> **Key takeaway**\n>\n> Just a quote.\n\nMentioning [!NOTE] inline stays text.\n\n> [not-a-callout]\n> body')
  assert.match(html, /<blockquote>/)
  assert.doesNotMatch(html, /class="callout/)
  assert.match(html, /\[!NOTE\] inline stays text/)
})

test('callouts inside list items are supported', () => {
  const html = renderMarkdown('- Step one\n\n  > [!TIP]\n  > Do it well\n\n- Step two')
  assert.match(html, /<li>[\s\S]*callout callout-tip[\s\S]*<\/li>/)
})

test('malicious HTML inside callouts is sanitized like everything else', () => {
  const html = renderMarkdown([
    '> [!WARNING] <script>alert(1)</script>',
    '> <iframe src="https://evil.test"></iframe>',
    '> <img src="https://example.org/x.png" onerror="alert(1)">',
    '> <style>body{display:none}</style>',
    '> <form action="https://evil.test"><input></form>',
  ].join('\n'))
  assert.match(html, /callout callout-warning/)
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /<iframe/i)
  assert.doesNotMatch(html, /<style/i)
  assert.doesNotMatch(html, /<form/i)
  assert.doesNotMatch(html, /<[a-zA-Z][^>]*\son\w+\s*=/i)
  // The safe part of the image survives, the handler does not.
  assert.match(html, /src="https:\/\/example\.org\/x\.png" referrerpolicy="no-referrer"/)
})

test('hostile callout markers cannot forge classes or bypass sanitization', () => {
  // Marker grammar is strict: anything unusual stays a plain blockquote.
  for (const marker of ['> [! <script>alert(1)</script>]', '> [!"evil"]', '> [!note" onload="alert(1)]', '> ![NOTE]']) {
    const html = renderMarkdown(`${marker}\n> body`)
    assert.doesNotMatch(html, /<script/i, marker)
    assert.doesNotMatch(html, /<[a-zA-Z][^>]*\son\w+\s*=/i, marker)
    assert.doesNotMatch(html, /class="[^"]*(evil|onload)/i, marker)
  }
  // Raw HTML cannot borrow the callout class allowlist for extra classes.
  const forged = renderMarkdown('<div class="callout evil-class">x</div>')
  assert.doesNotMatch(forged, /evil-class/)
})

test('callouts render after frontmatter stripping (Obsidian file end-to-end)', () => {
  const html = renderMarkdown('---\ntitle: Polity\ntags: [ras]\n---\n\n# Chapter\n\n> [!NOTE] संक्षेप में\n> Fundamental Rights — अनुच्छेद 12–35.\n')
  assert.doesNotMatch(html, /tags: \[ras\]/)
  assert.match(html, /callout callout-note/)
  assert.match(html, /<p class="callout-title">संक्षेप में<\/p>/u)
  assert.match(html, /अनुच्छेद 12–35/u)
})
