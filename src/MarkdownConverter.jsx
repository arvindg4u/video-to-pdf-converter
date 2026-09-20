import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import katexStyles from 'katex/dist/katex.min.css?inline'
import studyStyles from './markdown/study.css?inline'
import sampleNotes from '../examples/academic-study-notes.md?raw'
import { createNotesDocument, renderStudyMarkdown } from './markdown/render'
import { MAX_FILE_SIZE, MAX_FILE_SIZE_LABEL, readMarkdownFile } from './markdown/fileImport'
import { prepareMarkdown } from './markdown/obsidian'
import { bindPreviewNavigation } from './markdown/navigation'
import { ingestAssets } from './markdown/assets'
import './MarkdownConverter.css'
const documentStyles = `${katexStyles}\n${studyStyles}`

export default function MarkdownConverter({ onBusyChange }) {
  const [source, setSource] = useState('')
  const [title, setTitle] = useState('Study notes')
  const [fileName, setFileName] = useState('')
  const [assets, setAssets] = useState(null)
  const [paper, setPaper] = useState('A4')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [reading, setReading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [loadedDocument, setLoadedDocument] = useState('')
  const inputRef = useRef(null)
  const previewRef = useRef(null)
  const deferredSource = useDeferredValue(source)

  // Phase-1 Obsidian boundary: separate frontmatter metadata (preserved for
  // future phases, never rendered/executed) and report Obsidian-only syntax.
  // renderMarkdown() strips the same frontmatter before rendering, so the
  // editor can keep showing the user's original file verbatim.
  const prepared = useMemo(() => prepareMarkdown(deferredSource), [deferredSource])

  const rendered = useMemo(() => {
    try {
      return { ...renderStudyMarkdown(deferredSource, { assets }), error: '' }
    } catch {
      return { html: '', error: 'These notes could not be rendered. Check the Markdown and try again.' }
    }
  }, [deferredSource, assets])

  const documentHtml = useMemo(() => createNotesDocument({
    ...rendered, title, fileName, paper, styles: documentStyles,
  }), [rendered, title, fileName, paper])

  const busy = reading || exporting
  const previewReady = loadedDocument === documentHtml && source === deferredSource

  useEffect(() => {
    onBusyChange?.(busy)
    return () => onBusyChange?.(false)
  }, [busy, onBusyChange])

  useEffect(() => {
    const frame = previewRef.current
    const previousDocument = frame.contentDocument
    // Wait for the new DOM, not iframe.onload: onload also waits for remote
    // images, which may stall forever before the export timeout can even run.
    frame.srcdoc = documentHtml
    let timer
    let unbindNavigation
    function checkDocument() {
      const doc = frame.contentDocument
      if (doc && doc !== previousDocument && doc.readyState !== 'loading') {
        unbindNavigation = bindPreviewNavigation(doc)
        setLoadedDocument(documentHtml)
      } else {
        timer = setTimeout(checkDocument, 50)
      }
    }
    checkDocument()
    return () => { clearTimeout(timer); unbindNavigation?.() }
  }, [documentHtml])

  async function loadFile(files) {
    if (busy) return
    setError('')
    setStatus('')
    setReading(true)
    try {
      // Validation and reading live in markdown/fileImport.js so the same
      // rules (extension, size, emptiness, UTF-8) are unit-tested.
      const result = await readMarkdownFile(files)
      if (result.error) {
        setError(result.error)
        return
      }
      setAssets(null)
      setSource(result.text)
      // Prefer the Obsidian frontmatter title; fall back to the file name.
      // Metadata values are untrusted strings and are escaped downstream.
      setTitle(result.title)
      setFileName(files[0].name)
      setStatus(`Loaded ${files[0].name}${result.frontmatter ? ' · frontmatter kept as metadata' : ''}. Your notes are ready to edit and preview.`)
    } finally {
      setReading(false)
    }
  }

  async function loadAssets(files, folder = false) {
    if (busy || !files.length) return
    setReading(true)
    setError('')
    setStatus('')
    try {
      const result = await ingestAssets(files, { folder })
      setAssets(result.resolver)
      setStatus(`Loaded ${result.resolver.size} images; ${result.skipped} unsupported files ignored. Asset selection replaces the previous image context.`)
    } catch (err) {
      setError(err.message || 'Unable to read the selected images.')
    } finally { setReading(false) }
  }

  async function exportPdf() {
    if (!previewReady || !source.trim() || rendered.error || busy) return
    setExporting(true)
    setError('')
    setStatus('Preparing fonts and images…')
    const frame = previewRef.current
    const doc = frame?.contentDocument
    try {
      if (!doc || !frame.contentWindow) throw new Error('The preview is not ready. Please try again.')
      // Open disclosure blocks so printable notes include their full contents.
      doc.querySelectorAll('details').forEach((details) => { details.open = true })
      // Flush layout so fonts in newly opened disclosure blocks start loading
      // before observing FontFaceSet.ready.
      doc.documentElement.getBoundingClientRect()
      const resources = Promise.all([
        doc.fonts.ready,
        ...Array.from(doc.images, (image) => image.decode().catch(() => {})),
      ])
      let timer
      try {
        await Promise.race([
          resources,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Images or fonts are still loading. Check your connection or remove unavailable images, then try again.')), 15000)
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
      const missingImages = Array.from(doc.images).filter((image) => !image.naturalWidth)
      frame.contentWindow.focus()
      frame.contentWindow.print()
      setStatus(`${missingImages.length ? `${missingImages.length} image(s) could not load and will be missing. ` : ''}Print dialog requested. Choose “Save as PDF” to save your notes. You can export again at any time.`)
    } catch (err) {
      setError(err.message || 'Unable to open the print dialog. Try again in a browser that supports printing.')
      setStatus('')
    } finally {
      setExporting(false)
    }
  }

  function useSample() {
    setAssets(null)
    setSource(sampleNotes)
    setTitle('Learning and memory')
    setFileName('academic-study-notes.md')
    setError('')
    setStatus('Sample loaded. Edit the notes or export them as a PDF.')
  }

  return (
    <section className="markdown-workspace" aria-label="Markdown to PDF converter">
      <div className="markdown-intro">
        <div>
          <p className="meta">Read. Recall. Retain.</p>
          <h2>Turn Markdown into study-ready notes</h2>
          <p className="muted">Beautifully typeset notes, equations, and code. All conversion stays in your browser.</p>
        </div>
        <span className="academic-badge">Exam study notes</span>
      </div>

      <div className="markdown-layout">
        <div className="markdown-sidebar">
          <section className="panel markdown-panel">
            <h3>1. Add your notes</h3>
            <input ref={inputRef} className="md-file-input" type="file" accept=".md,.markdown,text/markdown" aria-label="Upload Markdown file" disabled={busy}
              onChange={(event) => {
                loadFile(Array.from(event.target.files || []))
                event.target.value = ''
              }} />
            <div className={`drop-zone md-drop-zone ${dragActive ? 'active' : ''}`}
              onDragOver={(event) => { event.preventDefault(); if (!busy) setDragActive(true) }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragActive(false)
                loadFile(Array.from(event.dataTransfer.files || []))
              }}>
              <span className="md-file-icon" aria-hidden="true">MD</span>
              <p>{reading ? 'Reading your notes…' : 'Drop your Markdown file here'}</p>
              <button type="button" className="secondary-btn" disabled={busy} onClick={() => inputRef.current?.click()}>Browse .md files</button>
              <small>One .md or .markdown file · up to {MAX_FILE_SIZE_LABEL} · UTF-8 · works with Obsidian notes</small>
            </div>
            <p className="md-help">Optional: add images after choosing your note. Select the folder that relative image paths start from (for <code>attachments/image.png</code>, choose the folder containing <code>attachments</code>). Only image files are read; notes in this folder are not imported.</p>
            <label className="md-help">Add image folder
              <input type="file" webkitdirectory="" multiple aria-label="Add image folder" disabled={busy}
                onChange={(event) => { loadAssets(Array.from(event.target.files || []), true); event.target.value = '' }} />
            </label>
            <label className="md-help">Or select image files
              <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif" aria-label="Add image files" disabled={busy}
                onChange={(event) => { loadAssets(Array.from(event.target.files || [])); event.target.value = '' }} />
            </label>
            <p className="md-help">{assets?.size || 0} local images · 200 files max · 10 MB/image · 40 MB total. Selecting a new note or sample clears images.</p>
            {assets && <button type="button" className="md-text-button" disabled={busy} onClick={() => setAssets(null)}>Clear local images</button>}
            <div className="md-file-row">
              <span className="muted">{fileName || 'Or paste your notes below.'}</span>
              <button type="button" className="md-text-button" disabled={busy} onClick={useSample}>Try a sample</button>
            </div>
          </section>

          <section className="panel markdown-panel md-settings">
            <h3>2. Make it yours</h3>
            <label htmlFor="notes-title">Document title</label>
            <input id="notes-title" value={title} maxLength={150} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
            <label htmlFor="notes-paper">Paper size</label>
            <select id="notes-paper" value={paper} disabled={busy} onChange={(event) => setPaper(event.target.value)}>
              <option value="A4">A4</option><option value="Letter">US Letter</option>
            </select>
            <p className="md-help">Exam study theme: book-like serif typography tuned for long revision sessions and Hindi + English mixed notes, clear heading hierarchy, calm callouts, and print-safe tables. The PDF always uses a light page optimized for A4 (Letter also supported).</p>
            <button type="button" className="primary-btn" onClick={exportPdf} disabled={busy || !source.trim() || !previewReady || Boolean(rendered.error)}>
              {exporting ? 'Preparing PDF…' : 'Export PDF'}
            </button>
            <p className="md-help">Four or more H1–H3 headings add a linked Contents list. Frontmatter title takes precedence over the title field. Opens your browser’s print dialog. Choose <strong>Save as PDF</strong>, keep the selected paper size, and turn off browser headers/footers for a clean result. Chrome/Edge 131+ support our page numbers and a fixed document header when there is a single H1; other engines may omit them. Dynamic chapter headers are not supported; PDF title metadata depends on your browser.</p>
          </section>
        </div>

        <section className="panel markdown-panel md-editor-panel">
          <div className="md-section-heading">
            <h3><label htmlFor="markdown-source">3. Edit Markdown</label></h3>
            <span className="muted">{source.length.toLocaleString()} characters</span>
          </div>
          {prepared.frontmatter && (
            <p className="md-help">
              YAML frontmatter detected ({Object.keys(prepared.frontmatter).join(', ') || 'empty'}) — kept as metadata, not rendered.
            </p>
          )}
          <textarea id="markdown-source" value={source} maxLength={MAX_FILE_SIZE} spellCheck={false} disabled={busy}
            placeholder={'# Your study notes\n\nPaste Markdown here, upload a .md file, or try the sample.\n\n## Key concepts\n- **Important idea**\n- [ ] Review before the exam\n\n> A useful takeaway\n\nInline math: $E = mc^2$'}
            onChange={(event) => { setSource(event.target.value); setStatus(''); setError('') }} />
          <p className="md-help">Supports headings, emphasis, nested lists, tables, task lists, links, images, blockquotes, code, footnotes, safe HTML, and LaTeX math (<code>$…$</code> / <code>$$…$$</code>).</p>
          <p className="md-help">Obsidian files welcome: a YAML frontmatter block (<code>title</code>, <code>tags</code>, …) is detected, kept as metadata, and left out of the rendered notes; a frontmatter <code>title</code> becomes the document title. Obsidian callouts (<code>&gt; [!NOTE]</code>, <code>&gt; [!IMPORTANT]</code>, <code>&gt; [!TIP]</code>, <code>&gt; [!WARNING]</code>, <code>&gt; [!CAUTION]</code>, collapsible <code>+</code>/<code>−</code>, custom titles, aliases like <code>[!INFO]</code>) render as calm study blocks; unknown types degrade gracefully. Wikilinks display readable labels; current-document heading and paragraph block links resolve when present. Tags render as subtle metadata. Image embeds resolve only from explicitly supplied assets; unavailable embeds show a placeholder.</p>
          <p className="md-help">Local PNG/JPEG/GIF/WebP images require an explicit image selection; a .md file alone cannot access its vault. Relative Markdown images use exact paths within your selected asset root. Obsidian embeds may also use a unique filename. Ambiguous names are not guessed. Remote HTTP(S) images and raster data URLs remain supported; scripts and unsafe HTML are removed. Mermaid and embedded notes are not rendered.</p>
        </section>
      </div>

      {(error || rendered.error) && <div role="alert" className="notice fail">{error || rendered.error}</div>}
      {status && <div role="status" className="notice ok">{status}</div>}

      <section className="panel markdown-panel md-preview-panel">
        <div className="md-section-heading">
          <h3>Document preview</h3>
          <span className="muted">{paper} · Study theme · {previewReady ? 'Up to date' : 'Updating…'}</span>
        </div>
        {!source.trim() && <p className="md-empty">Your rendered study notes will appear here. Add a file, paste Markdown, or try the sample to begin.</p>}
        <iframe ref={previewRef} title="Study notes preview" className={`md-preview ${!source.trim() ? 'md-preview-empty' : ''}`}
          sandbox="allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox"
          />
        <p className="md-help">Continuous preview. The print dialog shows final page breaks; text remains selectable in the PDF.</p>
      </section>
    </section>
  )
}
