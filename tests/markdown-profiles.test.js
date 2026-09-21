import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createNotesDocument, renderStudyMarkdown } from '../src/markdown/render.js'
import { longStudyNotes } from './fixtures/long-study-notes.js'
const study = readFileSync(new URL('../src/markdown/study.css', import.meta.url), 'utf8')
const profiles = readFileSync(new URL('../src/markdown/profiles.css', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('../src/MarkdownConverter.css', import.meta.url), 'utf8')
const component = readFileSync(new URL('../src/MarkdownConverter.jsx', import.meta.url), 'utf8')
const styles = `${study}\n${profiles}`
const document = (options = {}) => createNotesDocument({ html: '<p>Notes</p>', styles, ...options })

test('Study is the default and unrecognized profiles cannot inject document attributes', () => {
  for (const mode of [undefined, '', 'unknown', 'revision" onload="alert(1)']) {
    const html = document({ mode })
    assert.match(html, /<body class="study-mode">/)
    assert.doesNotMatch(html, /onload=/)
  }
  assert.match(component, /useState\('study'\)/)
})
test('Revision is an explicit presentation class, with the same content and CSP', () => {
  const baseline = document({ mode: 'study' })
  const revision = document({ mode: 'revision' })
  assert.equal(revision.replace('class="revision-mode"', 'class="study-mode"'), baseline)
  assert.match(revision, /default-src 'none'/)
})
test('both typography profiles remain readable and Revision is moderately denser', () => {
  assert.match(study, /font: 11\.5pt\/1\.62 var\(--font-body\)/)
  const rule = /body\.revision-mode \{ font-size: ([\d.]+)pt; line-height: ([\d.]+);/.exec(profiles)
  assert.ok(Number(rule[1]) >= 10.5 && Number(rule[1]) < 11.5)
  assert.ok(Number(rule[2]) >= 1.45 && Number(rule[2]) < 1.62)
  assert.doesNotMatch(profiles, /font-family:|--font-body:|transform:|zoom:/)
  assert.match(study, /Noto Serif Devanagari/)
  assert.doesNotMatch(styles, /@import|@font-face|url\(\s*["']?https?:/)
})
test('Revision compacts paragraphs, lists, callouts and cells without reducing code/table fonts', () => {
  for (const rule of [/\.revision-mode p \{ margin-bottom: 6px/, /\.revision-mode li \{ margin-top: 1\.5px/, /\.revision-mode \.callout \{ margin: 9px 0; padding: 6px 11px/, /\.revision-mode th, \.revision-mode td \{ padding: 3px 7px/]) assert.match(profiles, rule)
  assert.match(study, /table \{[^}]*font-size: 10\.5pt/)
  assert.match(study, /code, pre \{[^}]*font-size: 9\.5pt/)
  assert.doesNotMatch(profiles, /(?:table|code|pre|img|katex)[^{]*\{[^}]*font-size:/)
})
test('paper size, margins and native counters do not depend on profile', () => {
  for (const mode of ['study', 'revision']) for (const paper of ['A4', 'Letter']) {
    const html = document({ mode, paper })
    assert.ok(html.includes(`@page { size: ${paper}; margin: 16mm 16mm 18mm; }`))
    assert.match(html, /content: counter\(page\)/)
  }
  assert.doesNotMatch(profiles, /@page/)
})
test('TOC, Hindi/English, math, callouts, tables and image markup are identical across modes', () => {
  const rendered = renderStudyMarkdown(longStudyNotes(3))
  const normal = document({ ...rendered, mode: 'study' })
  const compact = document({ ...rendered, mode: 'revision' })
  assert.equal(compact.replace('class="revision-mode"', 'class="study-mode"'), normal)
  for (const value of ['भारतीय संविधान', 'Indian Polity', 'notes-toc', 'callout-tip', '<table>', '<img ', 'class="katex"', 'notes-chapter']) assert.ok(compact.includes(value), value)
})
test('both modes inherit all existing pagination and asset aspect-ratio rules', () => {
  for (const rule of [/break-after: avoid-page/, /thead \{ display: table-header-group/, /tr, img, \.callout, figure \{ break-inside: avoid/, /main > h1.notes-chapter \{ break-before: page/, /height: auto; object-fit: contain/]) assert.match(study, rule)
  assert.doesNotMatch(profiles, /break-before:|break-after:|break-inside:|page-break|height: auto|object-fit:/)
})
test('screen reflow and touch rules do not leak into printed density or paper size', () => {
  assert.match(profiles, /@media screen and \(max-width: 800px\)/)
  assert.match(profiles, /padding: clamp\(16px, 4vw, 40px\)/)
  assert.match(profiles, /@media screen and \(pointer: coarse\)[\s\S]*min-height: 44px/)
  assert.match(study, /@media screen and \(max-width: 600px\)/)
  assert.doesNotMatch(study, /body \{ font-size: 11pt/)
  assert.match(study, /@media print[\s\S]*\.study-notes \{ max-width: none; min-height: 0; margin: 0; padding: 0/)
})
test('workspace wraps filenames and actions, stacks at tablet widths, and has touch targets', () => {
  assert.match(workspace, /@media \(max-width: 960px\)/)
  assert.match(workspace, /\.markdown-layout \{ grid-template-columns: 1fr/)
  assert.match(workspace, /\.md-file-name \{ min-width: 0; flex: 1 1 12rem/)
  assert.match(workspace, /input\[type="file"\]:not\(\.md-file-input\) \{[^}]*width: 100%; max-width: 100%; min-width: 0/)
  assert.match(workspace, /\.md-preview-actions \{[^}]*flex-wrap: wrap/)
  assert.match(workspace, /min-height: 44px/)
  assert.match(workspace, /height: clamp\(360px, 65vh, 800px\)/)
})
test('mode switching changes document composition, not Markdown parsing or source', () => {
  assert.match(component, /renderStudyMarkdown\(deferredSource, \{ assets \}\)/)
  assert.match(component, /\}, \[deferredSource, assets\]\)/)
  assert.match(component, /\[rendered, title, fileName, paper, mode\]/)
  assert.match(component, /type="radio" name="notes-mode"/)
  assert.match(component, /<legend>Mode<\/legend>/)
  assert.match(component, /checked=\{mode === value\}/)
})
