import { validateAssetPath } from './assets.js'

/** Never expose absolute/traversing paths, URL credentials, or data payloads. */
export function resourceLabel(value) {
  const path = String(value || '')
  if (/^https?:\/\//i.test(path)) return 'Remote image'
  if (/^data:/i.test(path)) return 'Embedded image'
  const valid = validateAssetPath(path)
  return valid ? valid.split('/').at(-1).replace(/[\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 80) : 'Rejected path'
}
export function imageFact(path, resource, { embed = false, alt = '', width, height } = {}) {
  const value = String(path || '')
  const remote = !embed && /^https?:\/\//i.test(value)
  const data = !embed && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(value)
  const valid = validateAssetPath(value)
  const supported = /\.(png|jpe?g|webp|gif)$/i.test(valid || '')
  const status = resource || remote || data ? 'available' : !valid ? 'rejected' : !supported ? 'unsupported' : 'missing'
  const finite = (n) => Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 0
  return {
    label: resourceLabel(value), status, remote,
    missingAlt: !String(alt).trim(),
    bytes: finite(resource?.bytes) || (data ? Math.floor((value.length - value.indexOf(',') - 1) * 3 / 4) : 0),
    width: finite(resource?.width || width), height: finite(resource?.height || height),
  }
}
const plain = (node) => node.type === 'text' ? node.value : (node.children || []).map(plain).join('')
const classes = (node) => node.properties?.className || []
const isMath = (node) => classes(node).some((c) => ['math-inline', 'math-display', 'language-math'].includes(c))

/** Runs after sanitization/resource filtering, before KaTeX expands its DOM. */
export function collectPreflightFacts() {
  return (tree, file) => {
    const facts = { headings: [], tables: [], callouts: 0, math: 0, codeBlocks: 0, tasks: 0, words: 0, ...file.data.preflightResources }
    const prose = []
    function visit(node) {
      if (node.properties?.dataFootnotes !== undefined) return
      if (node.type === 'text') { prose.push(node.value); return }
      if (isMath(node)) { facts.math++; return }
      if (node.tagName === 'pre') {
        if (node.children?.some(isMath)) facts.math++
        else facts.codeBlocks++
        return
      }
      if (node.tagName === 'code') return
      if (/^h[1-6]$/.test(node.tagName)) facts.headings.push({ level: Number(node.tagName[1]), text: plain(node).trim() })
      if (classes(node).includes('callout')) facts.callouts++
      if (node.tagName === 'input' && node.properties.type === 'checkbox') facts.tasks++
      if (node.tagName === 'table') {
        let columns = 0, longestCell = 0, emptyHeaders = 0, rows = 0
        function cells(part) {
          if (part.tagName === 'tr') { rows++; columns = Math.max(columns, part.children.filter((c) => ['th', 'td'].includes(c.tagName)).length) }
          if (['th', 'td'].includes(part.tagName)) {
            const value = plain(part).trim()
            longestCell = Math.max(longestCell, value.length)
            if (part.tagName === 'th' && !value) emptyHeaders++
          }
          part.children?.forEach(cells)
        }
        cells(node)
        facts.tables.push({ columns, longestCell, emptyHeaders, rows })
      }
      node.children?.forEach(visit)
      if (['p', 'li', 'td', 'th', 'div', 'blockquote'].includes(node.tagName) || /^h[1-6]$/.test(node.tagName)) prose.push('\n')
    }
    visit(tree)
    // Approximate Unicode word tokens, preserving Hindi combining marks.
    facts.words = (prose.join('').match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu) || []).length
    file.data.preflightFacts = facts
  }
}
/** Count the final DOM, and reuse KaTeX's existing failure messages. */
export function finishPreflightFacts() {
  return (tree, file) => {
    let domNodes = 0
    const stack = [tree]
    const ids = new Set(), fragments = []
    while (stack.length) {
      const node = stack.pop()
      domNodes++
      if (node.properties?.id) ids.add(String(node.properties.id))
      if (node.tagName === 'a' && String(node.properties.href || '').startsWith('#') && node.properties.href.length > 1) fragments.push(node.properties.href.slice(1))
      if (node.children) for (const child of node.children) stack.push(child)
    }
    for (const fragment of fragments) {
      let id
      try { id = decodeURIComponent(fragment) } catch { id = fragment }
      if (!ids.has(id)) file.data.preflightFacts.references.push({ kind: 'heading', resolved: false, label: 'Markdown fragment link' })
    }
    Object.assign(file.data.preflightFacts, {
      domNodes,
      mathFailures: file.messages.filter((message) => message.source === 'rehype-katex').length,
    })
  }
}
