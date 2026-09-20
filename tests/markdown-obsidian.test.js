import test from 'node:test'
import assert from 'node:assert/strict'
import { detectObsidianSyntax, parseFrontmatter, prepareMarkdown, splitFrontmatter } from '../src/markdown/obsidian.js'
import { createNotesDocument, renderMarkdown } from '../src/markdown/render.js'

const OBSIDIAN_FILE = [
  '---',
  'title: Indian Polity',
  'subject: RAS',
  'tags:',
  '  - polity',
  '  - संविधान',
  '---',
  '',
  '# भारतीय संविधान (Indian Polity)',
  '',
  'See [[Fundamental Rights]] and [[Page#Heading|alias]].',
  '',
  '![[image.png]]',
  '',
  'Review #polity ^block-1',
  '',
].join('\n')

test('splitFrontmatter separates a leading YAML block and preserves the body verbatim', () => {
  const { content, frontmatter } = splitFrontmatter(OBSIDIAN_FILE)
  assert.ok(content.startsWith('\n# भारतीय संविधान'))
  assert.doesNotMatch(content, /subject: RAS/)
  assert.equal(frontmatter.title, 'Indian Polity')
  assert.equal(frontmatter.subject, 'RAS')
  assert.deepEqual(frontmatter.tags, ['polity', 'संविधान'])
})

test('splitFrontmatter handles CRLF, BOM, "..." terminator, and inline lists', () => {
  const crlf = splitFrontmatter('---\r\ntitle: CRLF\r\ntags: [a, "b c"]\r\n---\r\n\r\nBody\r\n')
  assert.equal(crlf.frontmatter.title, 'CRLF')
  assert.deepEqual(crlf.frontmatter.tags, ['a', 'b c'])
  assert.equal(crlf.content, '\r\nBody\r\n')
  const bom = splitFrontmatter('\uFEFF---\ntitle: BOM\n---\nBody')
  assert.equal(bom.frontmatter.title, 'BOM')
  const dots = splitFrontmatter('---\ntitle: Dots\n...\nBody')
  assert.equal(dots.frontmatter.title, 'Dots')
  assert.equal(dots.content, 'Body')
})

test('documents without valid frontmatter pass through untouched', () => {
  for (const source of [
    '# Notes\n\n---\n\nBody rule stays.',
    '---\ntitle: Unterminated\n\nBody keeps everything.',
    '--- title: Not a fence\n',
    '',
    '---',
  ]) {
    const { content, frontmatter } = splitFrontmatter(source)
    assert.equal(frontmatter, null, source)
    assert.equal(content, source.replace(/^\uFEFF/, ''), source)
  }
})

test('an oversized frontmatter block is treated as document content, not metadata', () => {
  const huge = `---\nnote: ${'x'.repeat(10_001)}\n---\nBody`
  const { content, frontmatter } = splitFrontmatter(huge)
  assert.equal(frontmatter, null)
  assert.equal(content, huge)
})

test('parseFrontmatter parses a safe YAML subset as inert strings only', () => {
  const metadata = parseFrontmatter([
    '# a comment',
    'title: "Quoted title"',
    "author: 'Single'",
    'empty:',
    'list:',
    '  - one',
    '  - two',
    'nested:',
    '  key: ignored-in-phase-1',
    'weird line without colon',
    'cssclass: [wide, table]',
  ].join('\n'))
  assert.equal(metadata.title, 'Quoted title')
  assert.equal(metadata.author, 'Single')
  assert.deepEqual(metadata.list, ['one', 'two'])
  assert.deepEqual(metadata.cssclass, ['wide', 'table'])
  assert.deepEqual(metadata.empty, [])
  assert.deepEqual(metadata.nested, [])
  assert.equal(metadata.weird, undefined)
  assert.ok(!('weird line without colon' in metadata))
})

test('frontmatter is untrusted: YAML tags are strings and nothing executes', () => {
  const metadata = parseFrontmatter('title: !!js/function >\n  function() { return 1 }\nexploit: !Ref pwn')
  // No interpretation, no execution: values stay inert strings.
  assert.equal(typeof metadata.title, 'string')
  assert.match(metadata.title, /!!js\/function/)
  assert.equal(metadata.exploit, '!Ref pwn')
  assert.equal(typeof metadata.exploit, 'string')
})

test('renderMarkdown strips frontmatter and renders only the body', () => {
  const html = renderMarkdown(OBSIDIAN_FILE)
  assert.doesNotMatch(html, /subject: RAS/)
  assert.doesNotMatch(html, /title: Indian Polity/)
  assert.match(html, /<h1[^>]*>भारतीय संविधान \(Indian Polity\)<\/h1>/u)
  // The frontmatter fences must not leave a stray <hr> at the top.
  assert.doesNotMatch(html, /^\s*<hr/)
})

test('frontmatter titles containing HTML stay escaped through the document', () => {
  const { frontmatter } = prepareMarkdown('---\ntitle: </title><script>alert(1)</script>\n---\n# Body')
  const document = createNotesDocument({ html: renderMarkdown('# Body'), title: frontmatter.title, paper: 'A4', styles: '' })
  assert.doesNotMatch(document, /<script>/)
  assert.match(document, /&lt;script&gt;/)
})

test('malicious Markdown loaded through the import path stays inert after frontmatter stripping', () => {
  const malicious = [
    '---',
    'title: <img src=x onerror=alert(1)>',
    'tags: [javascript:alert(1)]',
    '---',
    '',
    '<script>parent.hacked = true</script>',
    '',
    '[click](javascript:alert(1))',
    '',
    '![x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '',
    '<iframe src="https://evil.test"></iframe>',
    '',
    '![[evil.svg]]',
    '',
    '[[Page]][^1]',
    '',
    '[^1]: <style>body{display:none}</style>',
  ].join('\n')
  const html = renderMarkdown(malicious)
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /<iframe/i)
  assert.doesNotMatch(html, /<style/i)
  assert.doesNotMatch(html, /javascript:/i)
  assert.doesNotMatch(html, /data:text\/html/i)
  assert.doesNotMatch(html, /<[a-zA-Z][^>]*\son\w+\s*=/i)
})

test('Obsidian syntax has readable Phase-3 rendering without invented URLs', () => {
  const html = renderMarkdown(OBSIDIAN_FILE)
  assert.match(html, /<span>Fundamental Rights<\/span>/)
  assert.match(html, /<span>alias<\/span>/)
  assert.match(html, /Image unavailable: image\.png/)
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /class="obsidian-tag">#polity/)
  assert.match(html, /id="user-content-obsidian-block-block-1"/)
  assert.doesNotMatch(html, /<a /)
})

test('detectObsidianSyntax counts each construct and skips code', () => {
  const counts = detectObsidianSyntax(prepareMarkdown(OBSIDIAN_FILE).content)
  assert.equal(counts.wikilinks, 2)
  assert.equal(counts.embeds, 1)
  assert.equal(counts.blockReferences, 1)
  assert.ok(counts.tags >= 1)
  const inCode = detectObsidianSyntax('```js\nconst a = [[x]] ![[y]] #tag\n```\n\nInline `[[not-counted]]`.\n\n# Heading is not a tag\n\nReal #tag here.')
  assert.equal(inCode.wikilinks, 0)
  assert.equal(inCode.embeds, 0)
  assert.equal(inCode.tags, 1)
})

test('Hindi + English mixed UTF-8 notes render intact', () => {
  const html = renderMarkdown('---\ntitle: Complete Notes\n---\n\n# संविधान — Polity\n\n**मौलिक अधिकार** (Fundamental Rights) — अनुच्छेद 12–35।\n\n- हिंदी point one\n- English point two — ₹, “quotes”, émojis ✅')
  assert.match(html, /<h1[^>]*>संविधान — Polity<\/h1>/u)
  assert.match(html, /<strong>मौलिक अधिकार<\/strong>/u)
  assert.match(html, /अनुच्छेद 12–35/u)
  assert.match(html, /✅/u)
  assert.doesNotMatch(html, /Complete Notes/)
})

test('prepareMarkdown never throws on malformed or hostile input', () => {
  for (const source of ['', '---', '---\n', '\uFEFF', '---\n:\n---\n', '---\n- - -\n---\n', null, undefined, 42]) {
    const prepared = prepareMarkdown(source)
    assert.equal(typeof prepared.content, 'string')
    assert.equal(typeof prepared.obsidian.wikilinks, 'number')
  }
})
