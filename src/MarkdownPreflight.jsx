/** Calm, bounded presentation. React escapes all example labels as plain text. */
export default function MarkdownPreflight({ result, pending, hasSource }) {
  const { stats, estimatedPages, findings, warningCount, errorCount, infoCount } = result
  return (
    <section id="notes-preflight" className="md-preflight" aria-label="Document preflight" aria-busy={pending}>
      <h4>Preflight</h4>
      {!hasSource ? <p>Add notes to run preflight.</p> : <>
        <p className="md-preflight-summary" aria-live="polite">
          {pending ? 'Updating preflight… Previous results shown.' : `${errorCount} errors · ${warningCount} warnings · ${infoCount} info checks`}
        </p>
        <p className="md-preflight-stats">{stats.words.toLocaleString()} words (approx.) · {stats.characters.toLocaleString()} source characters<br />
          {stats.headings} headings (H1: {stats.h1} · H2: {stats.h2} · H3: {stats.h3}) · {stats.tables} tables · {stats.images} images · {stats.callouts} callouts<br />
          {stats.math} math expressions · {stats.codeBlocks} code blocks · {stats.tasks} checklist items</p>
        <p><strong>Estimated PDF: {estimatedPages === null ? 'unavailable' : `~${estimatedPages} pages`}</strong> · rough {result.modeLabel} / {result.paperLabel} content estimate, not pagination.</p>
        <p className="md-help">Images include unresolved image references. Words exclude code, math, and frontmatter. Print preview determines actual pages; asset availability and browser layout can change the result.</p>
        {findings.length > 0 ? <details open={errorCount > 0}>
          <summary>Review {findings.length} grouped checks — warnings do not block export</summary>
          <ul>{findings.map((finding) => <li key={finding.code}>
            <strong>{finding.severity === 'error' ? 'Error' : finding.severity === 'warning' ? 'Warning' : 'Info'}: </strong>{finding.message}
            {finding.examples.length > 0 && <span> Examples: {finding.examples.join(', ')}.</span>}
            <small>{finding.recommendation}</small>
          </li>)}</ul>
        </details> : <p>No issues detected by these checks. This is not a guarantee of perfect PDF output.</p>}
      </>}
    </section>
  )
}
