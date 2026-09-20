import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { renderStudyMarkdown } from '../src/markdown/render.js'
import { analyzePreflight, PREFLIGHT_LIMITS as L } from '../src/markdown/preflight.js'
import { imageFact, resourceLabel } from '../src/markdown/preflightFacts.js'
import { imageDimensions } from '../src/markdown/imageMetadata.js'
import { createAssetResolver, ingestAssets } from '../src/markdown/assets.js'
import { longStudyNotes } from './fixtures/long-study-notes.js'
const report = (source, options) => analyzePreflight(renderStudyMarkdown(source, options).preflightFacts)
const finding = (result, code) => result.findings.find((f) => f.code === code)
const png = 'data:image/png;base64,iVBORw0KGgo='

test('statistics cover headings, Unicode words, characters, tables, images, callouts, math, code and tasks', () => {
  const source = '# One\n\n## Two\n\n### तीन\n\nHello हिंदी 123.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![Diagram](data:image/png;base64,iVBORw0KGgo=)\n\n> [!TIP] Recall\n> Read.\n\n$x^2$\n\n$$\nx+y\n$$\n\n```js\nconst x = 1\n```\n\n- [x] Done\n- [ ] Todo'
  const { stats } = report(source)
  assert.deepEqual({ ...stats, words: 0, characters: 0 }, { words: 0, characters: 0, headings: 3, h1: 1, h2: 1, h3: 1, tables: 1, images: 1, callouts: 1, math: 2, codeBlocks: 1, tasks: 2 })
  assert.equal(stats.characters, source.length)
  assert.equal(report('Hello **world** हिंदी 123').stats.words, 4)
  assert.equal(report('---\ntitle: Hidden\n---\nOne $x$ `code`\n\n```txt\nnot words\n```').stats.words, 1)
})
test('normal heading hierarchy produces no structural warnings', () => {
  assert.equal(report('# One\n\n## Two\n\n### Three\n\n## Four').warningCount, 0)
})
for (const [source, code] of [['## Topic', 'heading-start'], ['### Topic', 'heading-start'], ['# One\n\n#### Four', 'heading-jumps'], ['# ', 'empty-headings'], ['# One\n\n##### Deep', 'deep-headings']]) {
  test(`heading check: ${code} (${source.replaceAll('\n', ' ')})`, () => assert.ok(finding(report(source), code)))
}
test('table checks distinguish ordinary, wide, empty-header and long-cell tables', () => {
  assert.equal(report('| A | B |\n|---|---|\n| 1 | 2 |').warningCount, 0)
  const wide = `|${Array(8).fill('Column').join('|')}|\n|${Array(8).fill('---').join('|')}|`
  assert.ok(finding(report(wide), 'wide-tables'))
  assert.ok(finding(report('| | B |\n|---|---|'), 'empty-headers'))
  assert.ok(finding(report(`| A |\n|---|\n| ${'x'.repeat(501)} |`), 'long-cells'))
})
test('supplied images resolve and missing/unsupported/rejected images are grouped', () => {
  const assets = createAssetResolver([{ path: 'attachments/ok.png', src: png }])
  const result = report('![[ok.png]] ![[missing.png]] ![[bad.svg]]\n\n![Good](attachments/ok.png)\n\n![Bad](../../private/secret.png)', { assets })
  assert.equal(result.stats.images, 5)
  assert.equal(finding(result, 'images-unresolved').count, 3)
  assert.deepEqual(finding(result, 'images-unresolved').examples, ['missing.png', 'bad.svg', 'Rejected path'])
  assert.doesNotMatch(JSON.stringify(result), /private|secret/)
  assert.equal(result.errorCount, 0)
})
test('unsupported note/advanced/block embeds are distinct from supported images, tags and callouts', () => {
  const result = report('![[Other.md]] ![[Other#^fact]] ![[movie.mp4]]\n\n#tag\n\n> [!TIP] Tip\n> Read')
  assert.equal(finding(result, 'unsupported-embeds').count, 3)
  assert.equal(result.stats.images, 0)
  assert.equal(result.findings.length, 1)
})
test('code and math contents do not create false Obsidian warnings', () => {
  const result = report('`[[Unknown]] ![[missing.png]] #tag`\n\n```text\n![[Other.md]] [[#Missing]]\n```\n\n$x^2$')
  assert.equal(result.findings.length, 0)
  assert.equal(result.stats.math, 1)
  assert.equal(result.stats.codeBlocks, 1)
})
test('Wikilinks, aliases, local heading links and block references use actual resolution outcomes', () => {
  const result = report('# Topic\n\nFact ^fact\n\n[[#Topic|Here]] [[#^fact]] [[Other|Alias]] [[#Missing]] [[#^absent]]')
  assert.equal(finding(result, 'unresolved-wikilink').count, 1)
  assert.equal(finding(result, 'unresolved-wikilink').severity, 'info')
  assert.equal(finding(result, 'unresolved-heading').count, 1)
  assert.equal(finding(result, 'unresolved-block').count, 1)
  assert.equal(result.errorCount, 0)
})
test('math failures reuse KaTeX messages rather than inspecting arbitrary source text', () => {
  assert.equal(finding(report('$x^2$'), 'math-errors'), undefined)
  assert.equal(finding(report('$\\notacommand{x}$'), 'math-errors').count, 1)
  assert.equal(report('```math\nx^2\n```').stats.math, 1)
  assert.equal(report('```math\nx^2\n```').stats.codeBlocks, 0)
})
test('large known image dimensions and byte counts are advisory; missing alt is reported', () => {
  const assets = createAssetResolver([{ path: 'large.png', src: png, bytes: L.imageBytes + 1, width: 8000, height: 6000 }])
  const result = report('![[large.png]]\n\n![](https://example.org/image.png)', { assets })
  assert.equal(finding(result, 'large-images').count, 1)
  assert.equal(finding(result, 'image-alt').count, 1)
  assert.equal(finding(result, 'remote-images').severity, 'info')
  assert.equal(result.errorCount, 0)
})
test('asset ingestion retains bounded header dimensions and file size, without decoding', async () => {
  const bytes = new Uint8Array(24)
  bytes.set([137,80,78,71,13,10,26,10])
  const view = new DataView(bytes.buffer); view.setUint32(16, 8000); view.setUint32(20, 7000)
  const { resolver } = await ingestAssets([{ name: 'large.png', size: bytes.length, arrayBuffer: async () => bytes.buffer }])
  assert.equal(resolver.resolve('large.png').width, 8000)
  assert.equal(resolver.resolve('large.png').bytes, 24)
  assert.ok(finding(report('![[large.png]]', { assets: resolver }), 'large-images'))
})
test('dimension header reader tolerates malformed and short buffers', () => {
  for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) assert.deepEqual(imageDimensions(new Uint8Array(2), mime), {})
  const gif = new Uint8Array(10); gif[6] = 20; gif[8] = 30
  assert.deepEqual(imageDimensions(gif, 'image/gif'), { width: 20, height: 30 })
  const jpeg = Uint8Array.from([255,216,255,192,0,7,8,0,30,0,20,255,217])
  assert.deepEqual(imageDimensions(jpeg, 'image/jpeg'), { width: 20, height: 30 })
  const webp = new Uint8Array(30); webp.set(new TextEncoder().encode('VP8X'), 12); webp[24] = 19; webp[27] = 29
  assert.deepEqual(imageDimensions(webp, 'image/webp'), { width: 20, height: 30 })
})
for (const key of ['sourceBytes', 'headings', 'images', 'math', 'domNodes']) {
  test(`large-document threshold boundaries: ${key}`, () => {
    const facts = (n) => key === 'headings' ? { headings: Array(n).fill({ level: 1, text: 'Topic' }) }
      : key === 'images' ? { images: Array(n).fill({ status: 'available' }) } : { [key]: n }
    assert.equal(finding(analyzePreflight(facts(L[key])), `large-${key}`), undefined)
    const result = analyzePreflight(facts(L[key] + 1))
    assert.equal(finding(result, `large-${key}`).severity, 'warning')
    assert.equal(result.errorCount, 0)
  })
}
test('table and image quality thresholds are strictly greater-than boundaries', () => {
  const facts = { tables: [{ columns: 7, longestCell: 500, rows: 1, emptyHeaders: 0 }], images: [{ label: 'x', status: 'available', bytes: L.imageBytes, width: 6000, height: 4000 }] }
  assert.equal(analyzePreflight(facts).warningCount, 0)
  assert.ok(finding(analyzePreflight({ images: [{ ...facts.images[0], width: 6001 }] }), 'large-images'))
})
test('estimates are profile/paper-aware heuristics; processing failure is the only blocking result', () => {
  const facts = { words: 5000, characters: 30000 }
  assert.ok(analyzePreflight(facts, { mode: 'revision' }).estimatedPages < analyzePreflight(facts).estimatedPages)
  assert.ok(analyzePreflight(facts, { paper: 'Letter' }).estimatedPages >= analyzePreflight(facts).estimatedPages)
  assert.equal(analyzePreflight().estimatedPages, 0)
  const result = analyzePreflight({}, { processingError: true })
  assert.equal(result.errorCount, 1)
  assert.equal(result.estimatedPages, null)
})
test('malicious source/frontmatter/assets stay inert and analysis never fetches', () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw Error('Preflight must not fetch') }
  try {
    const result = report('---\ntitle: !!js/function hacked\n---\n# Safe <script>globalThis.__preflightPwned = true</script>\n\n[[javascript:alert(1)|Click]]\n\n![[/private/secret.png]]\n\n![Remote](https://user:password@example.org/private.png)\n\n![](data:text/html;base64,PHNjcmlwdD4=)')
    assert.equal(globalThis.__preflightPwned, undefined)
    assert.doesNotMatch(JSON.stringify(result), /password|private|secret|hacked|<script>/)
    assert.equal(result.errorCount, 0)
    assert.equal(resourceLabel('a/../../secret.png'), 'Rejected path')
    assert.equal(imageFact('file:///secret.png').status, 'rejected')
  } finally { globalThis.fetch = originalFetch }
})
test('analysis is deterministic, nonmutating, and limits example lists', () => {
  const facts = renderStudyMarkdown(Array(20).fill('![[missing.png]] [[Other]]').join('\n')).preflightFacts
  const before = JSON.stringify(facts)
  assert.deepEqual(analyzePreflight(facts), analyzePreflight(facts))
  assert.equal(JSON.stringify(facts), before)
  assert.ok(analyzePreflight(facts).findings.every((f) => f.examples.length <= 3))
})
test('large-document benchmark separates extraction/render from pure analysis', (t) => {
  const source = longStudyNotes()
  const start = performance.now()
  const { preflightFacts } = renderStudyMarkdown(source)
  const renderMs = performance.now() - start
  const analysisStart = performance.now()
  const result = analyzePreflight(preflightFacts)
  const analysisMs = performance.now() - analysisStart
  t.diagnostic(`${source.length} source characters: render + facts ${renderMs.toFixed(1)} ms; pure preflight ${analysisMs.toFixed(2)} ms`)
  assert.equal(result.stats.headings, 300)
  for (const key of ['tables', 'images', 'callouts', 'math']) assert.equal(result.stats[key], 60)
  assert.ok(result.estimatedPages > 0)
  // Record timings, deliberately no hardware-dependent speed promise.
})
test('ordinary Markdown fragment links are checked against real IDs without flagging valid footnotes', () => {
  const valid = report('# Topic\n\n[Here](#topic)\n\nFact[^a].\n\n[^a]: Source')
  assert.equal(finding(valid, 'unresolved-heading'), undefined)
  assert.equal(finding(report('[Missing](#missing)'), 'unresolved-heading').count, 1)
})
test('current-note block transclusion is unsupported, but ordinary block links resolve', () => {
  const result = report('A fact ^id\n\n[[#^id]] ![[#^id]]')
  assert.equal(finding(result, 'unresolved-block'), undefined)
  assert.deepEqual(finding(result, 'unsupported-embeds').examples, ['Current-note embed'])
})
test('both export controls and the print handler gate errors, never advisory warnings', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/MarkdownConverter.jsx', import.meta.url), 'utf8')
  assert.match(source, /if \(!previewReady[^\n]*preflight\.errorCount[^\n]*\) return/)
  assert.equal((source.match(/disabled=\{[^\n]*preflight\.errorCount > 0\}/g) || []).length, 2)
  assert.doesNotMatch(source, /disabled=\{[^\n]*preflight\.warningCount/)
})
