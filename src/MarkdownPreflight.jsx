import InfoTip from './ui/InfoTip.jsx'
/** Calm, bounded presentation. React escapes all example labels as plain text. */
export default function MarkdownPreflight({ result, pending, hasSource }) {
  const { stats, estimatedPages, findings, warningCount, errorCount, infoCount } = result
  return (
    <section id="notes-preflight" className="md-preflight" aria-label="Document preflight" aria-busy={pending}>
      <div className="panel-title">
        <h4>Preflight</h4>
        <InfoTip label="About preflight">
          <p>Automatic checks on your notes before export. <strong>Errors</strong> block export; <strong>warnings</strong> and info are recommendations, not academic rules.</p>
          <p>Counts are approximate: images include unresolved references, words exclude code, math and frontmatter. The page estimate is a rough content estimate — the print preview determines the actual pages, and asset availability or browser layout can change the result.</p>
        </InfoTip>
      </div>
      {!hasSource ? <p>Add notes to run preflight.</p> : <>
        <p className="md-preflight-summary" aria-live="polite">
          {pending ? 'Updating preflight… Previous results shown.' : `${errorCount} errors · ${warningCount} warnings · ${infoCount} info checks`}
        </p>
        <p className="md-preflight-stats">{stats.words.toLocaleString()} words (approx.) · {stats.characters.toLocaleString()} source characters<br />
          {stats.headings} headings (H1: {stats.h1} · H2: {stats.h2} · H3: {stats.h3}) · {stats.tables} tables · {stats.images} images · {stats.callouts} callouts<br />
          {stats.math} math expressions · {stats.codeBlocks} code blocks · {stats.tasks} checklist items</p>
        <p><strong>Estimated PDF: {estimatedPages === null ? 'unavailable' : `~${estimatedPages} pages`}</strong> · {result.modeLabel} / {result.paperLabel}</p>
        {findings.length > 0 ? <details open={errorCount > 0}>
          <summary>{findings.length} grouped {findings.length === 1 ? 'check' : 'checks'}</summary>
          <ul>{findings.map((finding) => <li key={finding.code}>
            <strong>{finding.severity === 'error' ? 'Error' : finding.severity === 'warning' ? 'Warning' : 'Info'}: </strong>{finding.message}
            {finding.examples.length > 0 && <span> Examples: {finding.examples.join(', ')}.</span>}
            <small>{finding.recommendation}</small>
          </li>)}</ul>
        </details> : <p>No issues detected by these checks.</p>}
      </>}
    </section>
  )
}
