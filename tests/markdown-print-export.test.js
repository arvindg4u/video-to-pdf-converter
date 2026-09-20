import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { printNotes, sanitizePrintTitle } from '../src/markdown/printExport.js'
import { resolveDocumentMetadata } from '../src/markdown/navigation.js'
import { renderStudyMarkdown, createNotesDocument } from '../src/markdown/render.js'

function fixture({ fonts = Promise.resolve(), images = [] } = {}) {
  const closed = { open: false }, opened = { open: true }
  const doc = { readyState: 'complete', title: 'Notes: / Hindi हिंदी', fonts: { ready: fonts }, images,
    querySelectorAll: () => [closed, opened], documentElement: { getBoundingClientRect() {} } }
  const win = new EventTarget()
  let prints = 0
  win.focus = () => {}
  win.print = () => { prints++; assert.equal(closed.open, true); assert.equal(doc.title, 'Notes Hindi हिंदी') }
  const frame = { contentDocument: doc, contentWindow: win, isConnected: true }
  return { frame, doc, win, closed, opened, prints: () => prints, args: { frame, expectedDocument: doc, isCurrent: () => true, timeoutMs: 20, printTimeoutMs: 20 } }
}
function image({ complete = true, width = 10, decode = () => Promise.resolve() } = {}) {
  const node = new EventTarget(), attrs = new Map([['loading', 'lazy']])
  Object.assign(node, { complete, naturalWidth: width, decode, getAttribute: (key) => attrs.get(key) ?? null,
    setAttribute: (key, value) => attrs.set(key, value), removeAttribute: (key) => attrs.delete(key) })
  return node
}
const never = () => new Promise(() => {})

test('safe Unicode print title removes path/illegal/control characters, normalizes whitespace and caps length', () => {
  assert.equal(sanitizePrintTitle(' ../Polity: हिंदी / Notes?*\n '), 'Polity हिंदी Notes')
  assert.equal(sanitizePrintTitle('\\<>:"/|?*'), 'Study notes')
  assert.equal(sanitizePrintTitle('CON'), 'Notes CON')
  assert.equal(sanitizePrintTitle('LPT1.pdf'), 'Notes LPT1.pdf')
  assert.equal(Array.from(sanitizePrintTitle('अ'.repeat(200))).length, 100)
  assert.doesNotMatch(sanitizePrintTitle('a\u202eb\0c'), /[\u202e\0]/)
})
test('print title follows existing frontmatter/field/filename/default precedence', () => {
  for (const [options, expected] of [[{ metadata: { title: 'Front: matter' }, title: 'Field' }, 'Front matter'], [{ title: 'Field' }, 'Field'], [{ fileName: 'Notes.md' }, 'Notes'], [{}, 'Study notes']]) assert.equal(sanitizePrintTitle(resolveDocumentMetadata(options).title), expected)
})
test('correct document, fonts and images are ready before print; disclosures and title restored', async () => {
  const img = image(), f = fixture({ images: [img] })
  const result = await printNotes(f.args)
  assert.equal(f.prints(), 1)
  assert.equal(result.missingImages, 0)
  assert.equal(f.closed.open, false); assert.equal(f.opened.open, true)
  assert.equal(f.doc.title, 'Notes: / Hindi हिंदी')
  assert.equal(img.getAttribute('loading'), 'lazy')
  assert.ok(result.preparationMs >= result.resourceMs)
})
test('fonts must settle before printing; failed FontFaceSet readiness permits safe fallback', async () => {
  let release
  const f = fixture({ fonts: new Promise((resolve) => { release = resolve }) })
  const result = printNotes({ ...f.args, timeoutMs: 1000 })
  assert.equal(f.prints(), 0); assert.equal(f.closed.open, true)
  release(); await result
  assert.equal(f.prints(), 1)
  const fallback = fixture({ fonts: Promise.reject(Error('font unavailable')) })
  assert.equal((await printNotes(fallback.args)).fontFallback, true)
})
test('loaded, failed and pending images are distinguished without extra fetching', async () => {
  const pending = image({ complete: false, width: 0 }), f = fixture({ images: [image(), image({ width: 0 }), pending] })
  const result = printNotes({ ...f.args, timeoutMs: 1000 })
  assert.equal(f.prints(), 0)
  pending.complete = true; pending.naturalWidth = 20; pending.dispatchEvent(new Event('load'))
  assert.equal((await result).missingImages, 1)
})
for (const [name, options] of [['fonts', { fonts: never() }], ['image load', { images: [image({ complete: false, width: 0 })] }], ['image decode', { images: [image({ decode: never })] }]]) {
  test(`stalled ${name} times out and restores temporary state`, async () => {
    const f = fixture(options)
    await assert.rejects(printNotes(f.args), /still loading/)
    assert.equal(f.prints(), 0); assert.equal(f.closed.open, false)
    assert.equal(f.doc.title, 'Notes: / Hindi हिंदी')
  })
}
test('stale, loading and detached documents never print', async () => {
  for (const mutate of [(f) => { f.args.isCurrent = () => false }, (f) => { f.frame.isConnected = false }, (f) => { f.frame.contentDocument = {} }, (f) => { f.doc.readyState = 'loading' }, (f) => { f.frame.contentWindow = null }]) {
    const f = fixture(); mutate(f)
    await assert.rejects(printNotes(f.args), /preview/)
    assert.equal(f.prints(), 0)
  }
})
test('source revision or destroyed iframe during resource wait prevents stale printing', async () => {
  for (const destroy of [false, true]) {
    let release, current = true
    const f = fixture({ fonts: new Promise((resolve) => { release = resolve }) })
    const result = printNotes({ ...f.args, isCurrent: () => current })
    if (destroy) f.frame.contentDocument = null
    else current = false
    release()
    await assert.rejects(result, /notes changed/)
    assert.equal(f.prints(), 0); assert.equal(f.closed.open, false)
  }
})
test('abort cancels waits promptly and clears disclosure/image changes', async () => {
  const f = fixture({ fonts: never() }), controller = new AbortController()
  const result = printNotes({ ...f.args, signal: controller.signal, timeoutMs: 10000 })
  controller.abort()
  await assert.rejects(result, /notes changed/)
  assert.equal(f.closed.open, false)
})
test('print invocation failure cleans up; subsequent attempts work', async () => {
  const f = fixture(), originalPrint = f.win.print
  f.win.print = () => { throw Error('print blocked') }
  await assert.rejects(printNotes(f.args), /print blocked/)
  assert.equal(f.closed.open, false)
  f.win.print = originalPrint
  await printNotes(f.args)
  assert.equal(f.prints(), 1)
})
test('asynchronous print lifecycle retains disclosures until afterprint, then restores', async () => {
  const f = fixture()
  f.win.print = () => { f.win.dispatchEvent(new Event('beforeprint')); queueMicrotask(() => { assert.equal(f.closed.open, true); f.win.dispatchEvent(new Event('afterprint')) }) }
  await printNotes(f.args)
  assert.equal(f.closed.open, false)
})
test('missing afterprint cannot leave an exporting transaction stuck forever', async () => {
  const f = fixture(); f.win.print = () => f.win.dispatchEvent(new Event('beforeprint'))
  await assert.rejects(printNotes(f.args), /print lifecycle/)
  assert.equal(f.closed.open, false)
})
test('A4/Letter geometry, native counters, fragmentation and background rules remain standard', () => {
  const css = readFileSync(new URL('../src/markdown/study.css', import.meta.url), 'utf8')
  for (const paper of ['A4', 'Letter']) for (const mode of ['study', 'revision']) {
    const html = createNotesDocument({ ...renderStudyMarkdown('# Context'), paper, mode, styles: css })
    assert.ok(html.includes(`size: ${paper}; margin: 16mm 16mm 18mm`))
    assert.match(html, /counter\(page\)/)
    assert.match(html, /default-src 'none'/)
  }
  for (const pattern of [/print-color-adjust: exact/, /thead \{ display: table-header-group/, /pre \{ break-inside: avoid/, /table \{ table-layout: fixed/, /max-height: 210mm/, /\.katex-display > \.katex \{ white-space: normal/, /break-before: page/]) assert.match(css, pattern)
})
test('chapter breaks handle single, consecutive, table/callout/image-followed H1s', () => {
  assert.doesNotMatch(renderStudyMarkdown('# One\n\n# Two').html, /notes-chapter/)
  for (const content of ['|A|\n|---|\n|B|', '> [!NOTE]\n> Read', '![img](https://example.org/a.png)']) {
    const { html } = renderStudyMarkdown(`# First\n\n${content}\n\n# Second\n\n${content}`)
    assert.equal((html.match(/notes-chapter/g) || []).length, 1)
  }
})
test('failed decoding is reported even when intrinsic dimensions are known', async () => {
  const f = fixture({ images: [image({ decode: () => Promise.reject(Error('decode failed')) })] })
  assert.equal((await printNotes(f.args)).missingImages, 1)
  assert.equal(f.prints(), 1)
})
