/**
 * Phase 1 — Obsidian ingestion boundary.
 *
 * The app accepts an Obsidian-maintained `.md` file (e.g. a continuously
 * growing "Complete Notes.md") and passes it into the existing
 * Markdown → sanitize → preview → print/PDF pipeline. This module is the
 * single, extensible seam between "raw Obsidian file" and "Markdown the
 * renderer understands":
 *
 *   - `splitFrontmatter`  detects and separates a leading YAML frontmatter
 *                         block so it never renders as document content.
 *   - `parseFrontmatter`  extracts metadata into plain strings/arrays.
 *                         Frontmatter is UNTRUSTED input: a minimal YAML
 *                         subset is parsed with pure string operations —
 *                         no eval, no constructors, no YAML tags are
 *                         interpreted (a `!!js/function` value is just an
 *                         inert string). Metadata is preserved for future
 *                         phases; nothing here executes it.
 *   - `detectObsidianSyntax` reports Wikilinks (`[[Page]]`, `[[Page#Heading]]`),
 *                         embeds (`![[image.png]]`), inline tags (`#tag`), and
 *                         block references (`^block-id`) outside code.
 *
 * Phase 1 deliberately renders unsupported Obsidian syntax as the literal
 * text the user wrote — it is never silently dropped, mangled, or turned
 * into broken links/images. Later phases plug transformations into
 * `prepareMarkdown` (Wikilink resolution, callouts, embeds, tag panels).
 *
 * KNOWN LIMITATION (deferred to a future vault/folder/ZIP import phase):
 * selecting only a `.md` file cannot give the browser access to the rest of
 * the Obsidian vault. Local attachments referenced by `![[image.png]]` or
 * relative paths therefore stay unavailable; `render.js` already downgrades
 * them to visible "[Image unavailable]" text. Nothing here pretends
 * otherwise.
 */

/** Frontmatter blocks larger than this are treated as document content. */
const MAX_FRONTMATTER_LENGTH = 10_000
/** Metadata values are capped; frontmatter is untrusted input. */
const MAX_VALUE_LENGTH = 500
/** Block/inline lists are capped to a sane metadata size. */
const MAX_LIST_ITEMS = 200

const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

function clip(value) {
  return String(value).slice(0, MAX_VALUE_LENGTH)
}

/**
 * Parse one YAML scalar as an inert string (or list of strings). Quotes are
 * unwrapped; YAML tags (`!!js/function`, `!Ref`, …) are never interpreted —
 * they simply remain part of the string. No type coercion is attempted.
 */
function parseScalar(raw) {
  const value = String(raw).trim()
  if (value.startsWith('[') && value.endsWith(']') && value.length > 1) {
    return value.slice(1, -1)
      .split(',')
      .slice(0, MAX_LIST_ITEMS)
      .map((item) => parseScalar(item))
  }
  const quoted = /^("([^"]*)"|'([^']*)')$/.exec(value)
  return clip(quoted ? (quoted[2] ?? quoted[3] ?? '') : value)
}

/**
 * Parse a YAML frontmatter body (the text between the `---` fences) into a
 * flat metadata object: string scalars and arrays of strings. Supports the
 * subset Obsidian notes realistically use — `key: value`, quoted values,
 * inline `[a, b]` lists, block lists (`  - item`), and `#` comments.
 * Nested maps and multi-line scalars are not interpreted (the key keeps an
 * empty list); unknown lines are ignored. Never throws, never executes.
 */
export function parseFrontmatter(raw) {
  const metadata = {}
  let listKey = null
  for (const line of String(raw).split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const item = /^\s+-\s*(.*)$/.exec(line)
    if (item && listKey !== null) {
      if (metadata[listKey].length < MAX_LIST_ITEMS) metadata[listKey].push(parseScalar(item[1]))
      continue
    }
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (pair) {
      const [, key, value] = pair
      if (value.trim() === '') {
        metadata[key] = []
        listKey = key
      } else {
        metadata[key] = parseScalar(value)
        listKey = null
      }
    } else {
      // Nested-map entries, continuations, anything unrecognized: ignored.
      listKey = null
    }
  }
  return metadata
}

/**
 * Separate a leading YAML frontmatter block from the Markdown body.
 * Returns `{ content, frontmatter, raw }` where `frontmatter` is `null`
 * when the document has none (or the block is unterminated/oversized, in
 * which case the whole document is returned untouched as content).
 * The body is sliced from the original text, preserving line endings.
 */
export function splitFrontmatter(source) {
  const text = String(source ?? '').replace(/^\uFEFF/, '')
  const match = text.startsWith('---') ? FRONTMATTER_PATTERN.exec(text) : null
  if (!match || match[1].length > MAX_FRONTMATTER_LENGTH) {
    return { content: text, frontmatter: null, raw: '' }
  }
  return {
    content: text.slice(match[0].length),
    frontmatter: parseFrontmatter(match[1]),
    raw: match[1],
  }
}

/** Remove inline code spans so detection does not count code as syntax. */
function withoutCodeSpans(line) {
  return line.replace(/(`+)[^`]*\1/g, ' ')
}

/**
 * Heuristically count Obsidian-only syntax in a Markdown body, skipping
 * fenced code blocks and inline code. Informational in Phase 1 (the UI
 * tells the user these render as plain text); future phases replace the
 * counted constructs with real transformations.
 */
export function detectObsidianSyntax(content) {
  const counts = { wikilinks: 0, embeds: 0, tags: 0, blockReferences: 0 }
  let fence = ''
  for (const line of String(content ?? '').split(/\r?\n/)) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line)
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0]
      else if (fenceMatch[1][0] === fence) fence = ''
      continue
    }
    if (fence) continue
    const body = withoutCodeSpans(line)
    counts.embeds += (body.match(/!\[\[[^\]\n]+\]\]/g) || []).length
    counts.wikilinks += (body.replace(/!\[\[[^\]\n]+\]\]/g, ' ').match(/\[\[[^\]\n]+\]\]/g) || []).length
    if (/(?:^|\s)\^[A-Za-z][A-Za-z0-9-]*\s*$/.test(body)) counts.blockReferences += 1
    // Obsidian tags: `#` + letter-led word (never pure digits, never a
    // Markdown heading marker, never glued to a preceding word character).
    counts.tags += (body.match(/(^|[^\p{L}\p{N}#])#[\p{L}][\p{L}\p{N}/_-]*/gu) || []).length
  }
  return counts
}

/**
 * Full Phase-1 preparation of an untrusted Obsidian file: strip frontmatter
 * (kept as inert metadata), report Obsidian-only syntax, and return the
 * Markdown body ready for the existing renderer. Identity-preserving for
 * the body — nothing else is rewritten in this phase.
 */
export function prepareMarkdown(source) {
  const { content, frontmatter, raw } = splitFrontmatter(source)
  return { content, frontmatter, raw, obsidian: detectObsidianSyntax(content) }
}
