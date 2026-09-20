import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import katexStyles from 'katex/dist/katex.min.css?inline'
import academicStyles from './markdown/academic.css?inline'
import sampleNotes from '../examples/academic-study-notes.md?raw'
import { createNotesDocument, renderMarkdown } from './markdown/render'
import './MarkdownConverter.css'

const MAX_FILE_SIZE = 1024 * 1024
const documentStyles = `${katexStyles}\n${academicStyles}`

export default function MarkdownConverter({ onBusyChange }) {
  const [source, setSource] = useState('')
  const [title, setTitle] = useState('Study notes')
  const [fileName, setFileName] = useState('')
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

  const rendered = useMemo(() => {
    try {
      return { html: renderMarkdown(deferredSource), error: '' }
    } catch {
      return { html: '', error: 'These notes could not be rendered. Check the Markdown and try again.' }
    }
  }, [deferredSource])

  const documentHtml = useMemo(() => createNotesDocument({
    html: rendered.html, title, paper, styles: documentStyles,
  }), [rendered.html, title, paper])

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
    function checkDocument() {
      const doc = frame.contentDocument
      if (doc && doc !== previousDocument && doc.readyState !== 'loading') {
        setLoadedDocument(documentHtml)
      } else {
        timer = setTimeout(checkDocument, 50)
      }
    }
    checkDocument()
    return () => clearTimeout(timer)
  }, [documentHtml])

  async function loadFile(files) {
    if (busy) return
    setError('')
    setStatus('')
    if (files.length !== 1 || !/\.(md|markdown)$/i.test(files[0]?.name || '')) {
      setError('Choose one Markdown file (.md or .markdown).')
      return
    }
    const file = files[0]
    if (file.size > MAX_FILE_SIZE) {
      setError('This file is too large. Choose a Markdown file up to 1 MB.')
      return
    }
    setReading(true)
    try {
      const text = await file.text()
      if (!text.trim()) throw new Error('This Markdown file is empty. Choose a file with some notes.')
      if (text.includes('\0')) throw new Error('This does not look like a text file. Use a UTF-8 Markdown file.')
      setSource(text)
      setTitle(file.name.replace(/\.(md|markdown)$/i, ''))
      setFileName(file.name)
      setStatus(`Loaded ${file.name}. Your notes are ready to edit and preview.`)
    } catch (err) {
      setError(err.message || 'The file could not be read. Please try again.')
    } finally {
      setReading(false)
    }
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
        <span className="academic-badge">Academic study notes</span>
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
              <small>One .md or .markdown file · up to 1 MB · UTF-8</small>
            </div>
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
            <p className="md-help">Academic theme: serif body text, navy headings, highlighted code, and warm callouts. The PDF always uses a light, print-friendly page.</p>
            <button type="button" className="primary-btn" onClick={exportPdf} disabled={busy || !source.trim() || !previewReady || Boolean(rendered.error)}>
              {exporting ? 'Preparing PDF…' : 'Export PDF'}
            </button>
            <p className="md-help">Opens your browser’s print dialog. Choose <strong>Save as PDF</strong>, keep the selected paper size, and turn off browser headers/footers for a clean result.</p>
          </section>
        </div>

        <section className="panel markdown-panel md-editor-panel">
          <div className="md-section-heading">
            <h3><label htmlFor="markdown-source">3. Edit Markdown</label></h3>
            <span className="muted">{source.length.toLocaleString()} characters</span>
          </div>
          <textarea id="markdown-source" value={source} maxLength={MAX_FILE_SIZE} spellCheck={false} disabled={busy}
            placeholder={'# Your study notes\n\nPaste Markdown here, upload a .md file, or try the sample.\n\n## Key concepts\n- **Important idea**\n- [ ] Review before the exam\n\n> A useful takeaway\n\nInline math: $E = mc^2$'}
            onChange={(event) => { setSource(event.target.value); setStatus(''); setError('') }} />
          <p className="md-help">Supports headings, emphasis, nested lists, tables, task lists, links, images, blockquotes, code, footnotes, safe HTML, and LaTeX math (<code>$…$</code> / <code>$$…$$</code>).</p>
          <p className="md-help">Images need absolute HTTP(S) URLs or embedded PNG/JPEG/GIF/WebP data. Relative image paths are unavailable. Remote images are fetched from their hosts; scripts and unsafe HTML are removed. Diagram plugins such as Mermaid are not rendered.</p>
        </section>
      </div>

      {(error || rendered.error) && <div role="alert" className="notice fail">{error || rendered.error}</div>}
      {status && <div role="status" className="notice ok">{status}</div>}

      <section className="panel markdown-panel md-preview-panel">
        <div className="md-section-heading">
          <h3>Document preview</h3>
          <span className="muted">{paper} · Academic · {previewReady ? 'Up to date' : 'Updating…'}</span>
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
