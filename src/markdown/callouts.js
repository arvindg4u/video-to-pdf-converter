/**
 * Phase 2 — Obsidian callout support: `> [!TYPE]`, `> [!TYPE]+/-`, optional
 * custom titles, nested Markdown preserved.
 *
 * Design constraints:
 *   - Transformation happens at the mdast (remark) stage, BEFORE
 *     remark-rehype/rehype-raw/rehype-sanitize, so callout content goes
 *     through the exact same sanitization as everything else. Callouts can
 *     never bypass the security pipeline.
 *   - The user-written type name is NEVER emitted into markup. It is mapped
 *     through an allowlist to one of five style variants; unknown types
 *     degrade gracefully to the neutral "note" variant with the type name
 *     shown only as (escaped) title text.
 *   - Class names emitted are fixed strings; rehype-sanitize additionally
 *     allowlists them via CALLOUT_CLASS_PATTERN in render.js.
 *   - Collapsible callouts (`[!type]+` expanded / `[!type]-` collapsed)
 *     become <details>/<summary>; the export flow already opens all
 *     <details> before printing so PDFs keep full contents.
 */

/** Style variants — kept few and muted (no rainbow of loud boxes). */
const VARIANTS = ['note', 'tip', 'important', 'warning', 'caution']

/** Obsidian type aliases mapped onto the five variants. */
const VARIANT_BY_TYPE = {
  note: 'note', info: 'note', abstract: 'note', summary: 'note', tldr: 'note',
  todo: 'note', example: 'note', quote: 'note', cite: 'note',
  question: 'note', help: 'note', faq: 'note',
  tip: 'tip', hint: 'tip', success: 'tip', check: 'tip', done: 'tip',
  important: 'important',
  warning: 'warning', attention: 'warning',
  caution: 'caution', danger: 'caution', error: 'caution', failure: 'caution',
  fail: 'caution', missing: 'caution', bug: 'caution',
}

/** `[!TYPE]` with optional +/- collapsible flag and optional title text. */
const CALLOUT_MARKER = /^\[!([A-Za-z][A-Za-z0-9_-]*)\]([+-])?[ \t]*/

export const CALLOUT_CLASS_PATTERN = /^callout(?:-(?:title|note|tip|important|warning|caution))?$/

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * Parse a blockquote into a callout descriptor, or return null when it is
 * an ordinary blockquote. Mutates nothing; the caller rebuilds nodes.
 */
function parseCalloutBlock(blockquote) {
  const first = blockquote.children?.[0]
  if (!first || first.type !== 'paragraph') return null
  const head = first.children?.[0]
  if (!head || head.type !== 'text') return null
  const match = CALLOUT_MARKER.exec(head.value)
  if (!match) return null

  const [, rawType, collapseFlag] = match
  const type = rawType.toLowerCase()
  const markerLine = first.position?.start?.line ?? 0

  // Everything on the marker line is the title: the remainder of the first
  // text node plus any inline nodes (emphasis, links…) sharing that line.
  // A '\n' inside a text node (soft break) ends the title line even though
  // the node's position still starts on the marker line.
  const titleChildren = []
  const paragraphRest = []
  const headValue = head.value.slice(match[0].length)
  const newline = headValue.indexOf('\n')
  const titleText = newline === -1 ? headValue : headValue.slice(0, newline)
  const bodyText = newline === -1 ? '' : headValue.slice(newline + 1)
  if (titleText.trim()) titleChildren.push({ type: 'text', value: titleText.trim() })
  if (bodyText) paragraphRest.push({ type: 'text', value: bodyText.replace(/^\n/, '') })
  let titleDone = newline !== -1

  for (const child of first.children.slice(1)) {
    if (titleDone) {
      paragraphRest.push(child)
      continue
    }
    const line = child.position?.start?.line ?? Number.MAX_SAFE_INTEGER
    if (line > markerLine) {
      titleDone = true
      paragraphRest.push(child)
      continue
    }
    if (child.type === 'break') continue // hard break terminates the title line
    if (child.type === 'text') {
      const split = child.value.indexOf('\n')
      if (split === -1) {
        titleChildren.push(child)
      } else {
        if (child.value.slice(0, split).trim()) titleChildren.push({ type: 'text', value: child.value.slice(0, split) })
        paragraphRest.push({ type: 'text', value: child.value.slice(split + 1) })
        titleDone = true
      }
    } else {
      titleChildren.push(child)
    }
  }

  const title = titleChildren.length
    ? titleChildren
    : [{ type: 'text', value: capitalize(type) }]

  const remainingChildren = paragraphRest.length
    ? [{ type: 'paragraph', data: first.data, children: paragraphRest }, ...blockquote.children.slice(1)]
    : blockquote.children.slice(1)

  const collapsible = collapseFlag === '+' || collapseFlag === '-'
  return {
    variant: VARIANT_BY_TYPE[type] || 'note',
    collapsible,
    expanded: collapseFlag === '+',
    title,
    children: remainingChildren,
  }
}

/** remark plugin: rewrite Obsidian callout blockquotes into callout nodes. */
export function remarkCallouts() {
  return (tree) => {
    function visit(node) {
      const children = node.children
      if (!Array.isArray(children)) return
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index]
        if (child.type === 'blockquote') {
          const callout = parseCalloutBlock(child)
          if (callout) {
            const properties = {
              className: ['callout', `callout-${callout.variant}`],
            }
            if (callout.expanded) properties.open = true
            children[index] = {
              type: 'callout',
              data: {
                hName: callout.collapsible ? 'details' : 'div',
                hProperties: properties,
              },
              children: [
                {
                  type: 'paragraph',
                  data: {
                    hName: callout.collapsible ? 'summary' : 'p',
                    hProperties: { className: ['callout-title'] },
                  },
                  children: callout.title,
                },
                ...callout.children,
              ],
            }
            // Re-visit the new node so nested blockquotes inside the callout
            // body are still processed.
            visit(children[index])
            continue
          }
        }
        visit(child)
      }
    }
    visit(tree)
  }
}

export { VARIANTS }
