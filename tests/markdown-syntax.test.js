import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../src/markdown/render.js'
import { createAssetResolver } from '../src/markdown/assets.js'
const assets = createAssetResolver([{ path: 'attachments/image.png', src: 'data:image/png;base64,iVBORw0KGgo=' }])
const render = (source) => renderMarkdown(source, { assets })

test('wikilinks and aliases display readable labels without invented URLs', () => {
  const html = render('[[Indian Constitution]] [[Indian Constitution#Fundamental Rights]] [[Indian Constitution#^block-id]] [[Indian Constitution|Constitution]]')
  assert.match(html, /<span>Indian Constitution<\/span>/)
  assert.match(html, /<span>Constitution<\/span>/)
  assert.doesNotMatch(html, /href=|\[\[/)
})
test('internal heading links reuse sanitized slug IDs, including Hindi and formatting', () => {
  const html = render('[[#Fundamental Rights|Read this section]] [[#भारतीय संविधान]]\n\n# Fundamental **Rights**\n\n## भारतीय संविधान')
  assert.match(html, /href="#user-content-fundamental-rights">Read this section/)
  assert.match(html, /href="#user-content-भारतीय-संविधान"/)
})
test('duplicate headings keep existing slugging; explicit slug can select the second', () => {
  const html = render('# Topic\n\n# Topic\n\n[[#Topic]] [[#topic-1|Second]]')
  assert.match(html, /href="#user-content-topic"/)
  assert.match(html, /href="#user-content-topic-1">Second/)
})
test('missing internal targets are readable non-links', () => {
  const html = render('[[#Absent|Read]] [[#^missing]]')
  assert.match(html, />Read</)
  assert.match(html, />missing</)
  assert.doesNotMatch(html, /href=/)
})
test('external-looking and executable wikilink targets cannot create URLs', () => {
  const html = render('[[https://evil.example|External]] [[javascript:alert(1)|click]] [[//evil.example]]')
  assert.doesNotMatch(html, /href=|<script|<iframe/)
})
test('tags support nested and Hindi metadata but not headings or numeric fragments', () => {
  const html = render('# Indian Constitution\n\n#polity #indian-constitution #RAS/prelims #भारत #123')
  assert.equal((html.match(/class="obsidian-tag"/g) || []).length, 4)
  assert.match(html, /<h1[^>]*>Indian Constitution<\/h1>/)
})
test('code and math preserve Obsidian-looking text', () => {
  const html = render('`[[Page]] #tag ^id ![[image.png]]`\n\n```text\n[[Page]] #tag ^id\n```\n\n$ x^2 $')
  assert.match(html, /\[\[Page\]\]/)
  assert.doesNotMatch(html, /obsidian-tag|obsidian-block|<img/)
  assert.match(html, /katex/)
})
test('paragraph/list block IDs resolve forward and duplicates stay readable', () => {
  const html = render('[[#^fact|Fact]]\n\n- Important ^fact\n\nDuplicate ^fact')
  assert.match(html, /href="#user-content-obsidian-block-fact">Fact/)
  assert.equal((html.match(/id="user-content-obsidian-block-fact"/g) || []).length, 1)
  assert.match(html, /Duplicate \^fact/)
})
test('available embed differs from a normal wikilink with the same filename', () => {
  const html = render('[[image.png]] ![[image.png]]')
  assert.match(html, /<span>image.png<\/span>/)
  assert.equal((html.match(/<img /g) || []).length, 1)
  assert.match(html, /src="data:image\/png;base64,/)
})
test('embed dimensions retain aspect ratio using bounded width only', () => {
  const html = render('![[image.png|500]] ![[image.png|600x200]]')
  assert.match(html, /width="500"/)
  assert.match(html, /width="600"/)
  assert.doesNotMatch(html, /height=/)
})
test('missing, unsupported, remote and malicious embeds are non-breaking placeholders', () => {
  for (const path of ['missing.jpg', 'note.md', 'image.svg', '../../image.png', '%2e%2e/image.png', 'https://host/image.png']) {
    const html = render(`![[${path}]]`)
    assert.match(html, /Image unavailable:/)
    assert.doesNotMatch(html, /<img|href=/)
  }
})
test('relative Markdown images require exact supplied paths', () => {
  assert.match(render('![Constitution](attachments/image.png)'), /<img src="data:image\/png;base64,[^"]+" alt="Constitution"/)
  assert.doesNotMatch(render('![Missing](image.png)'), /<img/)
  assert.doesNotMatch(render('![Escape](../../attachments/image.png)'), /<img/)
})
test('existing remote-image filters, links and sanitizer protections remain intact', () => {
  const html = render('![ok](https://example.org/a.png)\n\n[external](https://example.org)\n\n<img src="data:image/svg+xml;base64,PHN2Zz4=">\n<script>alert(1)</script>\n<iframe src="https://evil.test"></iframe>\n<img src="x" onerror="alert(1)">')
  assert.match(html, /referrerpolicy="no-referrer"/)
  assert.match(html, /rel="noopener noreferrer"/)
  assert.doesNotMatch(html, /<script|<iframe|onerror=|data:image\/svg/)
})
test('frontmatter, Hindi, callouts, tables and math survive with assets', () => {
  const html = render('---\ntitle: Hidden title\n---\n# भारतीय संविधान\n\n> [!TIP] Review\n> [[#भारतीय संविधान]] #polity\n>\n> ![[image.png]]\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n$$x^2$$')
  for (const pattern of [/callout-tip/, /katex/, /<table>/, /<img/, /href="#user-content-भारतीय-संविधान"/]) assert.match(html, pattern)
  assert.doesNotMatch(html, /Hidden title/)
})
test('GFM autolinks cannot leak out of URL-looking embeds or aliases with spaces', () => {
  const html = render('[[https://evil.example|Read this]] ![[https://evil.example/a.png]] [[www.evil.example|Alias]]')
  assert.doesNotMatch(html, /href=|<img/)
  assert.match(html, />Read this</)
  assert.match(html, /Image unavailable:/)
})
test('block anchors avoid collisions with existing heading IDs', () => {
  const html = render('# obsidian-block-fact\n\nFact ^fact\n\n[[#^fact]] [[#obsidian-block-fact]]')
  assert.match(html, /href="#user-content-obsidian-block-fact-2"/)
  assert.match(html, /href="#user-content-obsidian-block-fact"/)
  assert.equal((html.match(/id="user-content-obsidian-block-fact"/g) || []).length, 1)
})
