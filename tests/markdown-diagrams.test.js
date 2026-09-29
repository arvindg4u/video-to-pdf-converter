import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown, renderStudyMarkdown, createNotesDocument } from '../src/markdown/render.js'
import { parseMathExpression, parseGraphSpec, renderMathGraphSvg } from '../src/markdown/mathGraph.js'

test('evaluates mathematical expressions safely and accurately', () => {
  const f1 = parseMathExpression('x^2 - 4')
  assert.equal(f1({ x: 2 }), 0)
  assert.equal(f1({ x: 3 }), 5)
  assert.equal(f1({ x: -2 }), 0)

  const fTrig = parseMathExpression('2*sin(x) + cos(x)')
  assert.ok(Math.abs(fTrig({ x: 0 }) - 1) < 1e-6)

  const fLatex = parseMathExpression('\\frac{x^2 + 1}{2}')
  assert.equal(fLatex({ x: 3 }), 5)

  const fSqrt = parseMathExpression('\\sqrt{x^2 + 9}')
  assert.equal(fSqrt({ x: 4 }), 5)

  const fImplicit = parseMathExpression('2x(x + 1)')
  assert.equal(fImplicit({ x: 3 }), 24)

  const fExp = parseMathExpression('exp(-x/2)')
  assert.ok(Math.abs(fExp({ x: 0 }) - 1) < 1e-6)
})

test('renders math function plot from markdown code block into vector SVG', () => {
  const md = `
# Calculus Notes

Here is the quadratic curve and its tangent line:

\`\`\`plot
title: Parabola & Tangent Line
domain: [-4, 4]
range: [-2, 10]
grid: true
y = x^2 - 2, color: #2563eb, label: f(x) = x^2 - 2
y = 2*x + 1, color: #dc2626, label: Tangent: g(x) = 2x + 1, style: dashed
point: (0, -2), label: Vertex
point: (3, 7), label: Intersection
area: [0, 2], from: 0, to: x^2 - 2, fill: rgba(37, 99, 235, 0.15)
\`\`\`
`
  const html = renderMarkdown(md)

  assert.match(html, /<figure class="math-diagram-figure"/)
  assert.match(html, /<div class="math-diagram-container">/)
  assert.match(html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 560 360"/)
  assert.match(html, /class="math-diagram-svg"/)
  assert.match(html, /role="img"/)
  assert.match(html, /Parabola (?:&amp;|&#x26;|&) Tangent Line/)
  assert.match(html, /<figcaption class="math-diagram-caption">Parabola (?:&amp;|&#x26;|&) Tangent Line<\/figcaption>/)
  assert.match(html, /<path d="M /) // Function curve path
  assert.match(html, /stroke="#2563eb"/)
  assert.match(html, /stroke="#dc2626"/)
  assert.match(html, /stroke-dasharray="6[ ,]4"/) // Dashed style
  assert.match(html, /<circle cx="/) // Point markers
  assert.match(html, /Vertex/)
  assert.match(html, /Intersection/)
  assert.match(html, /<line x1=.*marker-end="url\(#arrow-axis\)"/) // Coordinate axes
})

test('renders geometry diagrams with triangles, circles, vectors and angle marks', () => {
  const md = `
\`\`\`geometry
title: Pythagorean Triangle Proof
axes: true
grid: true
triangle: (0,0), (4,0), (0,3), fill: rgba(37, 99, 235, 0.12), stroke: #2563eb
circle: center=(2, 1.5), r=2.5, stroke: #7c3aed
vector: from=(0,0), to=(4,3), color: #ea580c, label: Hypotenuse Vector
angle: at=(0,0), from=(4,0), to=(0,3), rightAngle: true, label: 90°
point: (0, 0), label: A (0,0)
point: (4, 0), label: B (4,0)
point: (0, 3), label: C (0,3)
\`\`\`
`
  const html = renderMarkdown(md)

  assert.match(html, /<figure class="math-diagram-figure" data-diagram-type="geometry"/)
  assert.match(html, /<polygon points=/)
  assert.match(html, /<ellipse cx=/)
  assert.match(html, /marker-end="url\(#arrow-vector\)"/)
  assert.match(html, /Hypotenuse Vector/)
  assert.match(html, /Pythagorean Triangle Proof/)
  assert.match(html, /90°/)
})

test('renders TikZ code block into coordinate figure', () => {
  const md = `
\`\`\`tikz
title: TikZ Vector System
\\draw[->] (-3,0) -- (3,0);
\\draw[->] (0,-3) -- (0,3);
\\draw (0,0) circle (2);
\\node at (1.5, 2.5) {Circle r=2};
\`\`\`
`
  const html = renderMarkdown(md)

  assert.match(html, /<figure class="math-diagram-figure" data-diagram-type="tikz"/)
  assert.match(html, /<svg/)
  assert.match(html, /<ellipse cx=/)
  assert.match(html, /Circle r=2/)
})

test('renders Mermaid code block into structured diagram container', () => {
  const md = `
# Algorithm Flow

\`\`\`mermaid
graph TD
    A[Start Evaluation] --> B{x > 0?}
    B -- Yes --> C[Compute f(x) = x^2]
    B -- No --> D[Compute f(x) = -x]
    C --> E[Return Result]
    D --> E
\`\`\`
`
  const html = renderMarkdown(md)

  assert.match(html, /<figure class="mermaid-figure">/)
  assert.match(html, /<div class="mermaid-block" data-mermaid="graph TD/)
  assert.match(html, /data-diagram-type="mermaid"/)
  assert.match(html, /<pre class="mermaid-diagram">/)
  assert.match(html, /Compute f\(x\) = x\^2/)
})

test('handles invalid math plot syntax gracefully without crashing renderer', () => {
  const md = `
\`\`\`plot
title: Broken Function
y = 1 / / invalid syntax +++
y = sin(x)
\`\`\`
`
  const html = renderMarkdown(md)

  // Should render SVG with an inline error banner for the broken line while still plotting valid functions
  assert.match(html, /<figure class="math-diagram-figure"/)
  assert.match(html, /<svg/)
  assert.match(html, /class="graph-error-banner"/)
  assert.match(html, /Could not parse function/)
})

test('counts math graphs and diagrams in preflight facts', () => {
  const md = `
# Math Topic

\`\`\`plot
y = x^2
\`\`\`

\`\`\`functionplot
y = sin(x)
\`\`\`

\`\`\`geometry
triangle: (0,0), (3,0), (0,4)
\`\`\`

\`\`\`mermaid
graph LR
    A --> B
\`\`\`
`
  const result = renderStudyMarkdown(md)
  assert.equal(result.preflightFacts.graphs, 2)
  assert.equal(result.preflightFacts.diagrams, 2) // 1 geometry + 1 mermaid
})

test('preserves diagram SVGs in full study document export', () => {
  const md = `
# Trigonometry Notes

\`\`\`plot
title: Sine and Cosine Waves
domain: [-3.14, 6.28]
range: [-1.5, 1.5]
grid: true
y = sin(x), color: #2563eb, label: sin(x)
y = cos(x), color: #059669, label: cos(x)
\`\`\`
`
  const rendered = renderStudyMarkdown(md)
  const doc = createNotesDocument({
    ...rendered,
    title: 'Trig Notes',
    paper: 'A4',
    styles: '',
  })

  assert.match(doc, /<!doctype html>/)
  assert.match(doc, /<figure class="math-diagram-figure"/)
  assert.match(doc, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(doc, /Sine and Cosine Waves/)
  assert.match(doc, /sin\(x\)/)
  assert.match(doc, /cos\(x\)/)
})
