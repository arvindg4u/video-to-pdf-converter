/** Pure analysis over safely extracted facts. No Markdown parser, DOM, I/O,
 * network, mutation, or resource resolver is used here. Thresholds are advisory.
 */
export const PREFLIGHT_LIMITS = Object.freeze({ sourceBytes: 1024 * 1024, headings: 300, images: 100, math: 200, domNodes: 25000, columns: 7, cellCharacters: 500, imageBytes: 5 * 1024 * 1024, imageDimension: 6000, imagePixels: 24000000 })

export function analyzePreflight(facts = {}, { mode = 'study', paper = 'A4', processingError = false } = {}) {
  const headings = facts.headings || [], images = facts.images || [], tables = facts.tables || [], references = facts.references || []
  const stats = {
    words: facts.words || 0, characters: facts.characters || 0, headings: headings.length,
    h1: headings.filter((h) => h.level === 1).length, h2: headings.filter((h) => h.level === 2).length, h3: headings.filter((h) => h.level === 3).length,
    tables: tables.length, images: images.length, callouts: facts.callouts || 0, math: facts.math || 0, codeBlocks: facts.codeBlocks || 0, tasks: facts.tasks || 0,
  }
  const findings = []
  const add = (code, severity, count, message, recommendation, names = []) => {
    if (count) findings.push({ code, severity, count, message, recommendation, examples: [...new Set(names)].slice(0, 3) })
  }
  if (processingError) add('processing', 'error', 1, 'The document could not be rendered.', 'Check the Markdown or reduce the document size, then try again.')
  const missing = images.filter((image) => image.status !== 'available')
  add('images-unresolved', 'warning', missing.length, `${missing.length} image(s) could not be resolved.`, 'Supply matching PNG/JPEG/WebP/GIF assets. Unsupported formats and unsafe paths cannot be used.', missing.map((i) => i.label))
  for (const [kind, severity, label] of [['wikilink', 'info', 'cross-note Wikilink(s)'], ['heading', 'warning', 'internal heading link(s)'], ['block', 'warning', 'block reference(s)']]) {
    const absent = references.filter((ref) => ref.kind === kind && !ref.resolved)
    add(`unresolved-${kind}`, severity, absent.length, `${absent.length} ${label} could not be resolved.`, kind === 'wikilink' ? 'These remain readable text; a single note does not include the whole vault.' : 'Check the target heading or block ID. Missing references remain readable text.', absent.map((r) => r.label))
  }
  const embeds = facts.unsupportedEmbeds || []
  add('unsupported-embeds', 'warning', embeds.length, `${embeds.length} note or advanced embed(s) are not supported.`, 'Include the required note content directly in your Markdown.', embeds)
  const first = headings[0]
  add('heading-start', 'warning', first && first.level > 1 ? 1 : 0, 'The document starts below H1.', 'Consider a top-level subject heading; this is optional.')
  const jumps = headings.filter((h, i) => i && h.level > headings[i - 1].level + 1)
  add('heading-jumps', 'warning', jumps.length, `${jumps.length} heading-level jump(s).`, 'Review skipped levels for a clear study outline.', headings.flatMap((h, i) => i && h.level > headings[i - 1].level + 1 ? [`H${headings[i - 1].level} → H${h.level}`] : []))
  add('empty-headings', 'warning', headings.filter((h) => !h.text.trim()).length, 'Empty headings were found.', 'Give these headings a readable topic name.')
  add('deep-headings', 'warning', headings.filter((h) => h.level >= 5).length, 'H5/H6 headings may be too deeply nested.', 'Check the hierarchy; the Contents list includes only H1–H3.')
  const wide = tables.filter((t) => t.columns > PREFLIGHT_LIMITS.columns)
  add('wide-tables', 'warning', wide.length, `${wide.length} table(s) have more than ${PREFLIGHT_LIMITS.columns} columns.`, 'Review in print preview; split wide tables manually if needed.')
  add('long-cells', 'warning', tables.filter((t) => t.longestCell > PREFLIGHT_LIMITS.cellCharacters).length, 'Some tables have very long cell content.', 'Check wrapping and row pagination in print preview.')
  add('empty-headers', 'warning', tables.filter((t) => t.emptyHeaders > 0).length, 'Some tables have empty header cells.', 'Add meaningful column labels where useful.')
  const large = images.filter((i) => i.bytes > PREFLIGHT_LIMITS.imageBytes || Math.max(i.width, i.height) > PREFLIGHT_LIMITS.imageDimension || i.width * i.height > PREFLIGHT_LIMITS.imagePixels)
  add('large-images', 'warning', large.length, `${large.length} image(s) have large known dimensions or file size.`, 'Large raster images may slow printing; resizing is optional, never automatic.', large.map((i) => i.label))
  add('image-alt', 'warning', images.filter((i) => i.missingAlt).length, 'Some images have no alternative text.', 'Add a short description where useful for accessibility.')
  add('remote-images', 'info', images.filter((i) => i.remote).length, 'Remote image availability is not checked by preflight.', 'The existing preview/export image-loading step may report unavailable images.')
  add('math-errors', 'warning', facts.mathFailures || 0, `${facts.mathFailures || 0} math expression(s) failed KaTeX rendering.`, 'Review the formula syntax in the preview; preflight does not rewrite it.')
  for (const [key, value, label] of [['sourceBytes', facts.sourceBytes || 0, 'Markdown source size'], ['headings', stats.headings, 'heading count'], ['images', stats.images, 'image count'], ['math', stats.math, 'math count'], ['domNodes', facts.domNodes || 0, 'rendered document size']]) {
    add(`large-${key}`, 'warning', value > PREFLIGHT_LIMITS[key] ? 1 : 0, `High ${label} may slow preview or printing.`, 'Consider exporting smaller topic groups if your browser struggles. Size alone does not block export.')
  }
  // Broad content-weight estimate, not measured pagination. Account for media,
  // table rows, heading spacing, and the existing H1 chapter-start policy.
  const capacity = (mode === 'revision' ? 650 : 500) * (paper === 'Letter' ? 0.94 : 1)
  const weight = stats.words + headings.length * 12 + tables.reduce((sum, t) => sum + t.rows * 12, 0) + stats.images * 120 + stats.math * 10 + stats.codeBlocks * 50 + stats.callouts * 15
  const estimatedPages = processingError ? null : facts.characters ? Math.max(1, stats.h1, Math.ceil(weight / capacity)) : 0
  return { stats, estimatedPages, findings, warningCount: findings.filter((f) => f.severity === 'warning').length, errorCount: findings.filter((f) => f.severity === 'error').length, infoCount: findings.filter((f) => f.severity === 'info').length }
}
