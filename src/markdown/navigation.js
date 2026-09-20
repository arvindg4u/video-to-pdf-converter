/** Navigation is derived from the existing sanitized HAST, not another parse. */
export const TOC_MIN_HEADINGS = 4
const element = (tagName, properties, children) => ({ type: 'element', tagName, properties, children })
const text = (value) => ({ type: 'text', value })

function headingText(node) {
  if (node.type === 'text') return node.value
  // KaTeX emits both a visual HTML tree and a screen-reader MathML tree.
  // Read only the visual tree so equations don't appear twice in the TOC.
  if (node.properties?.className?.includes('katex-mathml')) return ''
  if (node.tagName === 'img') return String(node.properties.alt || '')
  if (node.tagName === 'br') return ' '
  return (node.children || []).map(headingText).join('')
}

export function studyNavigation() {
  return (tree, file) => {
    const headings = []
    function visit(node) {
      // Exclude generated footnotes and hidden disclosure contents: TOC links
      // must not land on invisible headings without executing a script.
      if (node.properties?.dataFootnotes !== undefined ||
        (node.tagName === 'details' && !node.properties.open)) return
      if (/^h[1-3]$/.test(node.tagName) && node.properties.id) {
        const label = headingText(node).replace(/\s+/g, ' ').trim()
        if (label) {
          headings.push({ level: Number(node.tagName[1]), id: String(node.properties.id), text: label })
          // Programmatic/native fragment focus, without adding tab stops.
          node.properties.tabIndex = -1
        }
      }
      node.children?.forEach(visit)
    }
    visit(tree)

    // Only top-level chapter headings after real content get forced breaks.
    // Consecutive headings and the first chapter never create blank pages.
    let seenChapter = false, contentSinceChapter = false
    for (const node of tree.children) {
      if (node.tagName === 'h1') {
        if (seenChapter && contentSinceChapter) {
          node.properties.className = [...(node.properties.className || []), 'notes-chapter']
        }
        seenChapter = true
        contentSinceChapter = false
      } else if (node.type === 'element' && !/^h[1-6]$/.test(node.tagName)) contentSinceChapter = true
    }

    const root = element('ul', {}, [])
    const stack = []
    for (const heading of headings) {
      while (stack.length && stack.at(-1).level >= heading.level) stack.pop()
      const parent = stack.at(-1)
      let list = root
      if (parent) {
        if (!parent.list) {
          parent.list = element('ul', {}, [])
          parent.item.children.push(parent.list)
        }
        list = parent.list
      }
      // Fragment only, from a sanitized ID. Never accepts a user-written URL.
      const item = element('li', {}, [element('a', { href: `#${encodeURIComponent(heading.id)}` }, [text(heading.text)])])
      list.children.push(item)
      stack.push({ level: heading.level, item })
    }
    file.data.navigation = {
      headings,
      toc: headings.length >= TOC_MIN_HEADINGS ? element('nav', { className: ['notes-toc'], ariaLabel: 'Contents' }, [
        element('p', { className: ['notes-toc-title'] }, [text('Contents')]), root,
      ]) : null,
    }
  }
}

/** Inert metadata only; never interpolate these values into CSS or raw HTML. */
export function resolveDocumentMetadata({ metadata, title, fileName } = {}) {
  const clean = (value) => typeof value === 'string' ? value.trim().slice(0, 150) : ''
  return {
    title: clean(metadata?.title) || clean(title) || clean(fileName)?.replace(/\.(?:md|markdown)$/i, '') || 'Study notes',
    subject: clean(metadata?.subject),
  }
}

/** Optional srcdoc enhancement. Exported links remain native HTML fragments.
 * srcdoc inherits its embedding page's base URL, so don't let fragment clicks
 * accidentally load the app inside the preview frame. No script is injected.
 */
export function bindPreviewNavigation(doc) {
  // Explicit same-document URLs also give the print engine destinations in
  // this document, not in the parent app URL inherited by srcdoc.
  for (const link of doc.querySelectorAll('a[href^="#"]')) {
    link.setAttribute('href', `about:srcdoc${link.getAttribute('href')}`)
  }
  const handler = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = event.target.closest?.('a[href^="about:srcdoc#"]')
    if (!link) return
    let id
    try { id = decodeURIComponent(link.getAttribute('href').slice('about:srcdoc#'.length)) } catch { return }
    const target = doc.getElementById(id)
    if (!target) return
    event.preventDefault()
    // Changing location.hash (rather than assigning link.href) stays in srcdoc.
    doc.defaultView.location.hash = encodeURIComponent(id)
    target.scrollIntoView({ block: 'start' })
    target.focus({ preventScroll: true })
  }
  doc.addEventListener('click', handler)
  return () => doc.removeEventListener('click', handler)
}
