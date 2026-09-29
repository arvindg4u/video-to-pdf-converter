/**
 * Client-side Mermaid Diagram Renderer
 *
 * Renders Mermaid diagram definitions into crisp vector SVGs inside the
 * preview iframe DOM and during print/PDF export.
 */
import mermaid from 'mermaid'

let mermaidInitialized = false
let diagramCounter = 0

export function initMermaid() {
  if (mermaidInitialized) return
  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'neutral',
      securityLevel: 'strict',
      fontFamily: 'var(--font-body, system-ui, -apple-system, sans-serif)',
      themeVariables: {
        fontSize: '13px',
        primaryColor: '#e0e7ff',
        primaryTextColor: '#1e293b',
        primaryBorderColor: '#6366f1',
        lineColor: '#475569',
        secondaryColor: '#f1f5f9',
        tertiaryColor: '#f8fafc',
      },
    })
    mermaidInitialized = true
  } catch (err) {
    console.warn('[mermaid] Initialization error:', err)
  }
}

/**
 * Render all `.mermaid-block[data-mermaid]` elements inside a document or container.
 * Returns a promise that resolves when all diagrams are rendered.
 */
export async function renderMermaidDiagrams(root) {
  if (!root) return
  initMermaid()

  const blocks = Array.from(root.querySelectorAll?.('.mermaid-block[data-mermaid]') || [])
  if (blocks.length === 0) return

  for (const block of blocks) {
    if (block.getAttribute('data-rendered') === 'true') continue
    const code = block.getAttribute('data-mermaid') || ''
    if (!code.trim()) continue

    const id = `mermaid-svg-${Date.now()}-${++diagramCounter}`
    try {
      // Mermaid render returns { svg }
      const { svg } = await mermaid.render(id, code)
      block.innerHTML = svg
      block.setAttribute('data-rendered', 'true')
      const svgEl = block.querySelector('svg')
      if (svgEl) {
        svgEl.classList.add('mermaid-svg')
        svgEl.setAttribute('role', 'img')
      }
    } catch (err) {
      // Clean up any stray error elements Mermaid might append to document.body
      const stray = document.getElementById(id)
      if (stray) stray.remove()
      const dId = document.getElementById(`d${id}`)
      if (dId) dId.remove()

      // Render a calm, styled error message in the document
      block.innerHTML = `
        <div class="diagram-error" role="alert">
          <div class="diagram-error-title">⚠️ Diagram syntax error</div>
          <div class="diagram-error-message">${escapeHtml(err.message || 'Could not parse Mermaid diagram')}</div>
          <pre class="diagram-error-source">${escapeHtml(code)}</pre>
        </div>
      `
      block.setAttribute('data-rendered', 'error')
    }
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&"']/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  })[c])
}
