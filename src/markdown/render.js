import { collectPreflightFacts, finishPreflightFacts } from './preflightFacts.js'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSlug from 'rehype-slug'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import { obsidianSyntax, resolveObsidianAnchors } from './syntax.js'
import { studyNavigation, resolveDocumentMetadata } from './navigation.js'
import { splitFrontmatter } from './obsidian.js'
import { CALLOUT_CLASS_PATTERN, remarkCallouts } from './callouts.js'

// Sanitize untrusted HTML BEFORE KaTeX/highlighting add their trusted markup.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
    // Callout structure built by remarkCallouts: fixed, allowlisted class
    // names only — user-written callout types never reach markup. `open` is
    // needed for expanded collapsible callouts (<details>).
    span: [...(defaultSchema.attributes.span || []), ['className', 'obsidian-tag']],
    div: [['className', CALLOUT_CLASS_PATTERN]],
    details: [['className', CALLOUT_CLASS_PATTERN], 'open'],
    summary: [['className', CALLOUT_CLASS_PATTERN]],
    p: [['className', CALLOUT_CLASS_PATTERN]],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ['https', 'http', 'data'],
  },
}

function safeResources() {
  return (tree) => {
    function visit(node) {
      if (node.type === 'element' && node.tagName === 'img') {
        const src = String(node.properties.src || '')
        // A dropped .md file cannot grant access to neighboring files. Also
        // disallow SVG data URLs and arbitrary data types in embedded images.
        if (!/^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(src)) {
          const alt = node.properties.alt || 'use an absolute image URL'
          node.tagName = 'span'
          node.properties = {}
          node.children = [{ type: 'text', value: `[Image unavailable: ${alt}]` }]
        } else {
          node.properties.referrerPolicy = 'no-referrer'
        }
      }
      if (node.type === 'element' && node.tagName === 'a') {
        const href = String(node.properties.href || '')
        if (href.startsWith('#') && href.length > 1) {
          // Match the ID prefix added by rehype-sanitize (including footnotes).
          node.properties.href = `#${defaultSchema.clobberPrefix}${href.slice(1)}`
        } else if (!href.startsWith('#')) {
          node.properties.target = '_blank'
          node.properties.rel = ['noopener', 'noreferrer']
        }
      }
      for (const attribute of ['ariaDescribedBy', 'ariaLabelledBy']) {
        if (node.properties?.[attribute]) {
          const ids = node.properties[attribute]
          node.properties[attribute] = (Array.isArray(ids) ? ids : String(ids).split(/\s+/))
            .map((id) => `${defaultSchema.clobberPrefix}${id}`)
        }
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

const processor = (options) => unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkCallouts)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(obsidianSyntax, options)
  .use(rehypeSlug)
  .use(resolveObsidianAnchors)
  .use(rehypeSanitize, schema)
  .use(safeResources)
  .use(collectPreflightFacts)
  .use(rehypeKatex, { trust: false, strict: 'ignore', throwOnError: false })
  .use(rehypeHighlight, { detect: false, ignoreMissing: true })
  .use(studyNavigation)
  .use(finishPreflightFacts)
  .use(rehypeStringify)

/** Rich result for the app: one Markdown parse produces content + navigation. */
export function renderStudyMarkdown(source, options = {}) {
  const { content, frontmatter } = splitFrontmatter(source)
  const result = processor(options).processSync(content)
  const { headings, toc } = result.data.navigation
  // Stringify a small generated tree; this does not parse Markdown again.
  const tocHtml = toc ? unified().use(rehypeStringify).stringify(toc) : ''
  const preflightFacts = { ...result.data.preflightFacts, characters: String(source ?? '').length, sourceBytes: new TextEncoder().encode(String(source ?? '')).length }
  return { html: String(result), tocHtml, headings, metadata: frontmatter, preflightFacts }
}

export function renderMarkdown(source, options = {}) {
  return renderStudyMarkdown(source, options).html
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

export function createNotesDocument({ html, title, fileName, metadata, tocHtml = '', headings = [], paper = 'A4', mode = 'study', font = 'book', styles }) {
  // Body classes are a closed set: unknown values fall back, never echo input.
  const modeClass = mode === 'revision' ? 'revision-mode' : 'study-mode'
  const fontClass = font === 'hand' ? ' font-hand' : ''
  const documentMetadata = resolveDocumentMetadata({ metadata, title, fileName })
  const chapters = headings.filter((heading) => heading.level === 1)
  // A sole H1 can describe the whole document. With several chapters, a
  // fixed first-chapter header would misleadingly label later chapters.
  const runningContext = chapters.length === 1 ? chapters[0].text : ''
  // CSS strings are a different injection boundary from HTML. Hex-escape every
  // codepoint, including '<', quotes, backslashes and line breaks.
  const cssContext = Array.from(runningContext.slice(0, 80), (char) => `\\${char.codePointAt(0).toString(16)} `).join('')
  const pageSize = paper === 'Letter' ? 'Letter' : 'A4'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src https: http: data:; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(documentMetadata.title)}</title>
<style>${styles}
@page {
  @bottom-center { content: counter(page); font: 8pt var(--font-meta, sans-serif); color: #5b6874; }
  @top-center { content: "${cssContext}"; font: 8pt var(--font-body, serif); color: #5b6874; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
}
@page { size: ${pageSize}; margin: 16mm 16mm 18mm; }</style>
</head><body class="${modeClass}${fontClass}"><article class="study-notes">
<header class="notes-header"><span>Exam study notes</span><span>${escapeHtml(documentMetadata.title)}</span></header>
<div class="notes-frontmatter"><p class="notes-document-title">${escapeHtml(documentMetadata.title)}</p>${documentMetadata.subject ? `<p class="notes-subject">${escapeHtml(documentMetadata.subject)}</p>` : ''}</div>
${tocHtml}
<main>${html}</main>
<footer class="notes-footer">Exam study notes · PDF Lab</footer>
</article></body></html>`
}
