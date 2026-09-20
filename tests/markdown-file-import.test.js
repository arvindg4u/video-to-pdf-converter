import test from 'node:test'
import assert from 'node:assert/strict'
import { File } from 'node:buffer'
import { MAX_FILE_SIZE, isMarkdownFileName, readMarkdownFile } from '../src/markdown/fileImport.js'

function mdFile(name, content, options) {
  return new File([content], name, { type: 'text/markdown', ...options })
}

test('accepts .md and .markdown extensions case-insensitively', () => {
  for (const name of ['notes.md', 'notes.MD', 'notes.Md', 'Complete Notes.markdown', 'NOTES.MARKDOWN', 'notes.MarkDown']) {
    assert.ok(isMarkdownFileName(name), name)
  }
  for (const name of ['notes.txt', 'notes.pdf', 'notes.md.txt', 'notes', 'md']) {
    assert.ok(!isMarkdownFileName(name), name)
  }
  // A name that merely contains "md" is not enough; the extension must match.
  assert.ok(!isMarkdownFileName('notes.mdx'))
})

test('reads a chosen Markdown file into the pipeline verbatim', async () => {
  const source = '# Complete Notes\n\nGrowing every day.\n'
  const result = await readMarkdownFile([mdFile('Complete Notes.md', source)])
  assert.equal(result.error, undefined)
  assert.equal(result.text, source)
  assert.equal(result.title, 'Complete Notes')
  assert.equal(result.frontmatter, null)
})

test('upper-case extension files load with the extension stripped from the title', async () => {
  const result = await readMarkdownFile([mdFile('NOTES.MARKDOWN', '# New notes')])
  assert.equal(result.error, undefined)
  assert.equal(result.title, 'NOTES')
})

test('rejects unsupported files, multiple files, and no files', async () => {
  const unsupported = await readMarkdownFile([mdFile('notes.txt', 'hello')])
  assert.match(unsupported.error, /Choose one Markdown file/)
  const many = await readMarkdownFile([mdFile('a.md', '# a'), mdFile('b.md', '# b')])
  assert.match(many.error, /Choose one Markdown file/)
  const none = await readMarkdownFile([])
  assert.match(none.error, /Choose one Markdown file/)
})

test('rejects empty and whitespace-only files', async () => {
  for (const content of ['', '   ', '\n\n\t\n']) {
    const result = await readMarkdownFile([mdFile('empty.md', content)])
    assert.match(result.error, /empty/)
  }
})

test('rejects files over the explicit 5 MB limit but accepts ones just under it', async () => {
  assert.equal(MAX_FILE_SIZE, 5 * 1024 * 1024)
  const oversize = { name: 'large.md', size: MAX_FILE_SIZE + 1, text: async () => '' }
  const result = await readMarkdownFile([oversize])
  assert.match(result.error, /too large/)
  assert.match(result.error, /5 MB/)
  // Size is checked before reading: the huge text is never loaded.
  let readAttempted = false
  const guarded = { name: 'large.md', size: MAX_FILE_SIZE + 1, text: async () => { readAttempted = true; return '' } }
  await readMarkdownFile([guarded])
  assert.equal(readAttempted, false)
  const under = mdFile('big.md', `# Big\n\n${'A study line of exam notes.\n'.repeat(Math.floor((MAX_FILE_SIZE - 16) / 28))}`)
  assert.ok(under.size <= MAX_FILE_SIZE)
  const ok = await readMarkdownFile([under])
  assert.equal(ok.error, undefined)
  assert.ok(ok.text.length > 4 * 1024 * 1024)
})

test('rejects binary content that is not UTF-8 text', async () => {
  const result = await readMarkdownFile([mdFile('binary.md', 'header\0\0\0more')])
  assert.match(result.error, /does not look like a text file/)
})

test('reports file read failures without crashing', async () => {
  const broken = { name: 'broken.md', size: 10, text: async () => { throw new DOMException('gone', 'NotFoundError') } }
  const result = await readMarkdownFile([broken])
  assert.match(result.error, /could not be read/)
})

test('preserves UTF-8 Hindi + English mixed content exactly', async () => {
  const source = '# संविधान — Indian Polity\n\n**मौलिक अधिकार** (Fundamental Rights), ₹, “quotes”, ✅\n'
  const result = await readMarkdownFile([mdFile('Complete Notes.md', source)])
  assert.equal(result.error, undefined)
  assert.equal(result.text, source)
})

test('frontmatter title becomes the document title and metadata is preserved', async () => {
  const source = '---\ntitle: Indian Polity\nsubject: RAS\ntags:\n  - polity\n---\n\n# Body\n'
  const result = await readMarkdownFile([mdFile('Complete Notes.md', source)])
  assert.equal(result.error, undefined)
  assert.equal(result.title, 'Indian Polity')
  assert.equal(result.text, source)
  assert.deepEqual(result.frontmatter, { title: 'Indian Polity', subject: 'RAS', tags: ['polity'] })
})

test('hostile frontmatter titles are capped, trimmed, and never executed', async () => {
  const long = await readMarkdownFile([mdFile('a.md', `---\ntitle: ${'T'.repeat(400)}\n---\nBody`)])
  assert.equal(long.title.length, 150)
  const blank = await readMarkdownFile([mdFile('a.md', '---\ntitle: "   "\n---\nBody')])
  assert.equal(blank.title, 'a')
  const evil = await readMarkdownFile([mdFile('a.md', '---\ntitle: </title><script>alert(1)</script>\n---\nBody')])
  // Kept as an inert string; escaping happens at document creation.
  assert.equal(typeof evil.title, 'string')
  assert.match(evil.title, /<script>/)
})

test('a file without frontmatter falls back to its file name for the title', async () => {
  const result = await readMarkdownFile([mdFile('RAS Polity Complete.MD', '# Notes')])
  assert.equal(result.title, 'RAS Polity Complete')
})
