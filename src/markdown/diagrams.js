/**
 * Markdown Diagram & Math Graph Rehype Plugin
 *
 * Transforms diagram code blocks (mermaid, plot, functionplot, math-graph,
 * geometry, tikz, etc.) into crisp vector SVG figures or Mermaid diagram
 * containers during the rehype stage (after sanitization, alongside KaTeX).
 */

import { fromHtml } from 'hast-util-from-html'
import { parseGraphSpec, renderMathGraphSvg } from './mathGraph.js'

const MATH_GRAPH_LANGS = new Set([
  'math-graph',
  'mathgraph',
  'plot',
  'functionplot',
  'function-plot',
  'graph',
  'chart',
])

const GEOMETRY_LANGS = new Set([
  'geometry',
  'math-diagram',
  'tikz',
  'tikzpicture',
])

function getTextValue(node) {
  if (!node) return ''
  if (node.type === 'text') return node.value || ''
  if (Array.isArray(node.children)) {
    return node.children.map(getTextValue).join('')
  }
  return ''
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&"']/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  })[c])
}

/**
 * Rehype plugin to transform diagram code blocks.
 */
export function rehypeDiagrams() {
  return (tree, file) => {
    const stats = {
      mathGraphs: 0,
      mermaidDiagrams: 0,
      geometryDiagrams: 0,
    }

    function walk(node, parent, index) {
      if (
        node.type === 'element' &&
        node.tagName === 'pre' &&
        parent &&
        typeof index === 'number'
      ) {
        const codeChild = node.children?.find(
          (c) => c.type === 'element' && c.tagName === 'code'
        )

        if (codeChild) {
          const classList = codeChild.properties?.className || []
          const langClass = Array.isArray(classList)
            ? classList.find((c) => String(c).startsWith('language-'))
            : null

          if (langClass) {
            const lang = String(langClass).replace(/^language-/, '').trim().toLowerCase()
            const rawCode = getTextValue(codeChild)

            if (lang === 'mermaid') {
              stats.mermaidDiagrams++
              parent.children[index] = {
                type: 'element',
                tagName: 'figure',
                properties: { className: ['mermaid-figure'] },
                children: [
                  {
                    type: 'element',
                    tagName: 'div',
                    properties: {
                      className: ['mermaid-block'],
                      dataMermaid: rawCode,
                      dataDiagramType: 'mermaid',
                    },
                    children: [
                      {
                        type: 'element',
                        tagName: 'pre',
                        properties: { className: ['mermaid-diagram'] },
                        children: [{ type: 'text', value: rawCode }],
                      },
                    ],
                  },
                ],
              }
              return
            }

            if (MATH_GRAPH_LANGS.has(lang)) {
              stats.mathGraphs++
              const spec = parseGraphSpec(rawCode, lang)
              const svg = renderMathGraphSvg(spec)
              const svgHast = fromHtml(svg, { fragment: true, space: 'svg' })

              const figureChildren = [
                {
                  type: 'element',
                  tagName: 'div',
                  properties: { className: ['math-diagram-container'] },
                  children: svgHast.children,
                },
              ]

              if (spec.title) {
                figureChildren.push({
                  type: 'element',
                  tagName: 'figcaption',
                  properties: { className: ['math-diagram-caption'] },
                  children: [{ type: 'text', value: spec.title }],
                })
              }

              parent.children[index] = {
                type: 'element',
                tagName: 'figure',
                properties: {
                  className: ['math-diagram-figure'],
                  dataDiagramType: lang,
                },
                children: figureChildren,
              }
              return
            }

            if (GEOMETRY_LANGS.has(lang)) {
              stats.geometryDiagrams++
              const spec = parseGraphSpec(rawCode, lang)
              const svg = renderMathGraphSvg(spec)
              const svgHast = fromHtml(svg, { fragment: true, space: 'svg' })

              const figureChildren = [
                {
                  type: 'element',
                  tagName: 'div',
                  properties: { className: ['math-diagram-container'] },
                  children: svgHast.children,
                },
              ]

              if (spec.title) {
                figureChildren.push({
                  type: 'element',
                  tagName: 'figcaption',
                  properties: { className: ['math-diagram-caption'] },
                  children: [{ type: 'text', value: spec.title }],
                })
              }

              parent.children[index] = {
                type: 'element',
                tagName: 'figure',
                properties: {
                  className: ['math-diagram-figure'],
                  dataDiagramType: lang,
                },
                children: figureChildren,
              }
              return
            }
          }
        }
      }

      if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
          walk(node.children[i], node, i)
        }
      }
    }

    walk(tree, null, null)

    file.data.diagramStats = stats
    if (file.data.preflightFacts) {
      file.data.preflightFacts.graphs = stats.mathGraphs
      file.data.preflightFacts.diagrams = stats.mermaidDiagrams + stats.geometryDiagrams
    }
  }
}
