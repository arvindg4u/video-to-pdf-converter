/** Obsidian syntax is transformed on parsed text, never in code or math.
 * Generated links resolve against rehype-slug IDs before the existing sanitizer
 * adds its clobber prefix. This is not a second heading-anchor implementation.
 */
const text = (value) => ({ type: 'text', value })
const element = (tagName, properties, children) => ({ type: 'element', tagName, properties, children })
const plain = (node) => node.type === 'text' ? node.value : (node.children || []).map(plain).join('')
const blocked = new Set(['code', 'pre', 'a', 'script', 'style', 'textarea', 'math'])

export function obsidianSyntax({ assets } = {}) {
  return (tree, file) => {
    const links = [], blocks = new Map()
    function visit(node) {
      if (blocked.has(node.tagName) || node.properties?.className?.some?.((c) => /^math-/.test(c))) return
      if (!node.children) return
      // GFM may auto-link URL-shaped fragments inside [[...]]. Rejoin only
      // inline runs bounded by wiki delimiters, never code or block content.
      for (let i = 0; i < node.children.length; i++) {
        const before = node.children[i]
        if (before.type !== 'text' || before.value.lastIndexOf('[[') <= before.value.lastIndexOf(']]')) continue
        let combined = before.value
        for (let j = i + 1; j < node.children.length; j++) {
          const part = node.children[j]
          if (part.type !== 'text' && !['a', 'em', 'strong', 'del'].includes(part.tagName)) break
          const value = plain(part)
          if (value.includes('\n')) break
          combined += value
          if (value.includes(']]')) {
            node.children.splice(i, j - i + 1, text(combined))
            i-- // the merged tail may begin another wikilink
            break
          }
        }
      }
      // Common paragraph/list block IDs. First occurrence wins; duplicates
      // remain visible, avoiding duplicate DOM IDs and ambiguous references.
      if (node.tagName === 'p' || node.tagName === 'li') {
        const last = node.children.at(-1)
        const match = last?.type === 'text' && /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(last.value)
        if (match && !blocks.has(match[1])) {
          const id = `obsidian-block-${match[1]}`
          const anchor = element('span', { id }, [])
          blocks.set(match[1], anchor)
          last.value = last.value.slice(0, match.index)
          node.children.push(anchor)
        }
      }
      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text') { visit(child); return [child] }
        const output = []
        // Unicode letters/marks support Hindi tags; a tag needs a non-number.
        const pattern = /!?\[\[([^\]\n]+)\]\]|(?<![\p{L}\p{N}_/#])#[\p{L}\p{M}\p{N}_-]+(?:\/[\p{L}\p{M}\p{N}_-]+)*/gu
        let end = 0
        for (const match of child.value.matchAll(pattern)) {
          output.push(text(child.value.slice(end, match.index)))
          end = match.index + match[0].length
          if (!match[1]) {
            output.push(/[\p{L}_-]/u.test(match[0]) ? element('span', { className: ['obsidian-tag'] }, [text(match[0])]) : text(match[0]))
            continue
          }
          const [rawTarget, ...aliasParts] = match[1].split('|')
          const target = rawTarget.trim(), alias = aliasParts.join('|').trim()
          if (match[0].startsWith('!')) {
            const resource = assets?.resolve(target, { basename: true })
            const dimensions = /^(\d{1,4})(?:x(\d{1,4}))?$/.exec(alias)
            if (resource) {
              const props = { src: resource.src, alt: dimensions ? target : (alias || target) }
              // Width only: never stretch an image by imposing an aspect ratio.
              if (dimensions) props.width = Math.max(1, Math.min(2000, Number(dimensions[1])))
              output.push(element('img', props, []))
            } else output.push(text(`[Image unavailable: ${target}]`))
          } else {
            const label = alias || target.replace(/^#\^?/, '')
            const link = element('span', {}, [text(label)])
            if (target.startsWith('#')) links.push({ node: link, target })
            output.push(link)
          }
        }
        output.push(text(child.value.slice(end)))
        return output
      })
    }
    visit(tree)
    file.data.obsidian = { links, blocks }
    // Ordinary Markdown images use exact relative paths, never basename guesses.
    function images(node) {
      if (node.tagName === 'img') {
        const resource = assets?.resolve(String(node.properties.src || ''))
        if (resource) node.properties.src = resource.src
      }
      node.children?.forEach(images)
    }
    images(tree)
  }
}

export function resolveObsidianAnchors() {
  return (tree, file) => {
    const headings = new Map(), ids = new Set(), occupied = new Set()
    const blockNodes = new Set(file.data.obsidian?.blocks.values() || [])
    function visit(node) {
      if (node.properties?.id && !blockNodes.has(node)) occupied.add(node.properties.id)
      if (/^h[1-6]$/.test(node.tagName) && node.properties.id) {
        const label = plain(node).trim().toLocaleLowerCase()
        if (!headings.has(label)) headings.set(label, node.properties.id)
        ids.add(node.properties.id)
      }
      node.children?.forEach(visit)
    }
    visit(tree)
    for (const anchor of blockNodes) {
      const base = anchor.properties.id
      let id = base, suffix = 2
      while (occupied.has(id)) id = `${base}-${suffix++}`
      anchor.properties.id = id
      occupied.add(id)
    }
    for (const { node, target } of file.data.obsidian?.links || []) {
      const value = target.slice(1)
      const id = value.startsWith('^') ? file.data.obsidian.blocks.get(value.slice(1))?.properties.id
        : headings.get(value.trim().toLocaleLowerCase()) || (ids.has(value) ? value : null)
      if (id) { node.tagName = 'a'; node.properties.href = `#${id}` }
    }
  }
}
