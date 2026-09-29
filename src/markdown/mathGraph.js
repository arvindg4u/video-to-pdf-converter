/**
 * Math Graph & Diagram Vector SVG Engine
 *
 * Provides a pure, deterministic, client-side & server-side safe engine for
 * plotting mathematical functions, coordinate systems, calculus visualizations,
 * geometry diagrams, vectors, and TikZ-like coordinate figures directly into SVG.
 */

// --- 1. Math Expression Tokenizer & AST Evaluator ---

const CONSTANTS = {
  pi: Math.PI,
  PI: Math.PI,
  'π': Math.PI,
  e: Math.E,
  E: Math.E,
}

const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  sec: (x) => 1 / Math.cos(x),
  csc: (x) => 1 / Math.sin(x),
  cot: (x) => 1 / Math.tan(x),
}

/** Pre-process formula strings: convert LaTeX macros and implicit multiplication. */
export function normalizeMathExpression(raw) {
  let expr = String(raw || '').trim()
  if (!expr) return '0'

  // Normalize LaTeX expressions
  expr = expr
    .replace(/\\sin\b/g, 'sin')
    .replace(/\\cos\b/g, 'cos')
    .replace(/\\tan\b/g, 'tan')
    .replace(/\\ln\b/g, 'ln')
    .replace(/\\log\b/g, 'log')
    .replace(/\\exp\b/g, 'exp')
    .replace(/\\sqrt\s*\{([^}]+)\}/g, 'sqrt($1)')
    .replace(/\\sqrt\b/g, 'sqrt')
    .replace(/\\frac\s*\{([^}]+)\}\s*\{([^}]+)\}/g, '(($1)/($2))')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\pi\b/g, 'pi')
    .replace(/\\left\(/g, '(')
    .replace(/\\right\)/g, ')')
    .replace(/\\left\[/g, '(')
    .replace(/\\right\]/g, ')')
    .replace(/\{([^{}]+)\}/g, '($1)')

  // Handle implicit multiplication (e.g. 2x -> 2*x, 3sin(x) -> 3*sin(x), (x+1)(x-1) -> (x+1)*(x-1))
  // 1) Number followed by variable or function or open paren
  expr = expr.replace(/(\d+(?:\.\d+)?)\s*([a-zA-Z_π(])/g, '$1 * $2')
  // 2) Close paren followed by open paren, variable, or function
  expr = expr.replace(/\)\s*([a-zA-Z0-9_π(])/g, ') * $1')
  // 3) Variable followed by open paren (unless it's a known function name)
  const fnNames = Object.keys(FUNCTIONS).join('|')
  const fnRegex = new RegExp(`\\b(?!(${fnNames})\\b)([a-zA-Z_π])\\s*\\(`, 'g')
  expr = expr.replace(fnRegex, '$2 * (')
  // 4) Variable followed by variable or number (e.g. x y -> x * y, x 2 -> x * 2)
  expr = expr.replace(/([xXtT])\s+([a-zA-Z0-9_π])/g, '$1 * $2')

  return expr
}

/**
 * Tokenize a normalized math expression.
 */
function tokenize(expr) {
  const tokens = []
  const pattern = /\s*([0-9]+(?:\.[0-9]+)?|[a-zA-Z_π][a-zA-Z0-9_]*|\+|-|\*|\/|\^|%|\(|\)|,)\s*/g
  let match
  let lastIndex = 0
  while ((match = pattern.exec(expr)) !== null) {
    if (match.index > lastIndex) {
      const skipped = expr.slice(lastIndex, match.index).trim()
      if (skipped) throw new Error(`Unexpected character in expression: '${skipped}'`)
    }
    tokens.push(match[1])
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < expr.length) {
    const tail = expr.slice(lastIndex).trim()
    if (tail) throw new Error(`Unexpected character in expression: '${tail}'`)
  }
  return tokens
}

/**
 * Recursive descent parser building an AST evaluator.
 */
export function parseMathExpression(rawExpr) {
  const normalized = normalizeMathExpression(rawExpr)
  const tokens = tokenize(normalized)
  let pos = 0

  function peek() {
    return tokens[pos]
  }

  function consume(expected) {
    const token = tokens[pos]
    if (expected !== undefined && token !== expected) {
      throw new Error(`Expected '${expected}' but found '${token || 'EOF'}'`)
    }
    pos++
    return token
  }

  function parseExpression() {
    return parseAddition()
  }

  function parseAddition() {
    let node = parseMultiplication()
    while (peek() === '+' || peek() === '-') {
      const op = consume()
      const right = parseMultiplication()
      const left = node
      node = op === '+'
        ? (scope) => left(scope) + right(scope)
        : (scope) => left(scope) - right(scope)
    }
    return node
  }

  function parseMultiplication() {
    let node = parsePower()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume()
      const right = parsePower()
      const left = node
      if (op === '*') {
        node = (scope) => left(scope) * right(scope)
      } else if (op === '/') {
        node = (scope) => {
          const denom = right(scope)
          if (denom === 0) return NaN
          return left(scope) / denom
        }
      } else {
        node = (scope) => left(scope) % right(scope)
      }
    }
    return node
  }

  function parsePower() {
    let node = parseUnary()
    if (peek() === '^') {
      consume('^')
      const right = parsePower() // right-associative
      const left = node
      node = (scope) => Math.pow(left(scope), right(scope))
    }
    return node
  }

  function parseUnary() {
    if (peek() === '+') {
      consume('+')
      return parseUnary()
    }
    if (peek() === '-') {
      consume('-')
      const next = parseUnary()
      return (scope) => -next(scope)
    }
    return parsePrimary()
  }

  function parsePrimary() {
    const token = peek()
    if (!token) throw new Error('Unexpected end of expression')

    // Parentheses
    if (token === '(') {
      consume('(')
      const expr = parseExpression()
      consume(')')
      return expr
    }

    // Number literal
    if (/^[0-9]+(?:\.[0-9]+)?$/.test(token)) {
      consume()
      const num = Number(token)
      return () => num
    }

    // Constant
    if (Object.prototype.hasOwnProperty.call(CONSTANTS, token)) {
      consume()
      const val = CONSTANTS[token]
      return () => val
    }

    // Function call
    if (Object.prototype.hasOwnProperty.call(FUNCTIONS, token.toLowerCase())) {
      const fnName = consume().toLowerCase()
      const fn = FUNCTIONS[fnName]
      consume('(')
      const args = []
      if (peek() !== ')') {
        args.push(parseExpression())
        while (peek() === ',') {
          consume(',')
          args.push(parseExpression())
        }
      }
      consume(')')
      return (scope) => {
        const evaluatedArgs = args.map((arg) => arg(scope))
        return fn(...evaluatedArgs)
      }
    }

    // Variable (x, X, t, T, theta, etc.)
    consume()
    const varName = token.toLowerCase()
    return (scope) => {
      if (typeof scope === 'number') return scope
      if (scope && typeof scope === 'object') {
        if (scope[varName] !== undefined) return Number(scope[varName])
        if (scope[token] !== undefined) return Number(scope[token])
        if (scope.x !== undefined) return Number(scope.x)
      }
      return NaN
    }
  }

  const ast = parseExpression()
  if (pos < tokens.length) {
    throw new Error(`Unexpected token at end: '${tokens[pos]}'`)
  }

  return (scope) => {
    try {
      const result = ast(scope)
      return typeof result === 'number' && !Number.isNaN(result) && Number.isFinite(result) ? result : NaN
    } catch {
      return NaN
    }
  }
}

// --- 2. Color Palette for Math Graphs ---

const GRAPH_PALETTE = [
  '#2563eb', // Blue
  '#dc2626', // Red
  '#059669', // Emerald
  '#7c3aed', // Violet
  '#d97706', // Amber
  '#0891b2', // Cyan
  '#db2777', // Pink
  '#4f46e5', // Indigo
]

// --- 3. Parser for Graph Specifications ---

function parseRange(str, fallback = [-5, 5]) {
  if (!str) return fallback
  const match = /\[?\s*(-?\d+(?:\.\d+)?(?:pi|π)?)\s*(?:,|to|\.\.)\s*(-?\d+(?:\.\d+)?(?:pi|π)?)\s*\]?/i.exec(str)
  if (!match) return fallback
  const parseVal = (v) => {
    v = v.trim().toLowerCase()
    if (v.includes('pi') || v.includes('π')) {
      const mult = v.replace(/pi|π/g, '').trim()
      const factor = mult === '' || mult === '+' ? 1 : mult === '-' ? -1 : Number(mult)
      return factor * Math.PI
    }
    return Number(v)
  }
  const min = parseVal(match[1])
  const max = parseVal(match[2])
  return Number.isFinite(min) && Number.isFinite(max) && min < max ? [min, max] : fallback
}

function parsePoint(str) {
  if (!str) return null
  const match = /\(?\s*(-?\d+(?:\.\d+)?(?:pi|π)?)\s*,\s*(-?\d+(?:\.\d+)?(?:pi|π)?)\s*\)?/i.exec(str)
  if (!match) return null
  const parseVal = (v) => {
    v = v.trim().toLowerCase()
    if (v.includes('pi') || v.includes('π')) {
      const mult = v.replace(/pi|π/g, '').trim()
      const factor = mult === '' || mult === '+' ? 1 : mult === '-' ? -1 : Number(mult)
      return factor * Math.PI
    }
    return Number(v)
  }
  const x = parseVal(match[1])
  const y = parseVal(match[2])
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

function parseKeyValuePairs(str) {
  const result = {}
  // Split on commas not inside parentheses or brackets or quotes
  const parts = []
  let current = ''
  let depth = 0
  let inQuote = false
  let quoteChar = ''
  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    if ((char === '"' || char === "'") && (i === 0 || str[i - 1] !== '\\')) {
      if (inQuote && char === quoteChar) inQuote = false
      else if (!inQuote) { inQuote = true; quoteChar = char }
    }
    if (!inQuote) {
      if (char === '(' || char === '[' || char === '{') depth++
      else if (char === ')' || char === ']' || char === '}') depth--
      else if (char === ',' && depth === 0) {
        parts.push(current.trim())
        current = ''
        continue
      }
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())

  for (const part of parts) {
    const colonIdx = part.indexOf(':')
    const eqIdx = part.indexOf('=')
    let sepIdx = -1
    if (colonIdx !== -1 && eqIdx !== -1) sepIdx = Math.min(colonIdx, eqIdx)
    else sepIdx = colonIdx !== -1 ? colonIdx : eqIdx

    if (sepIdx !== -1) {
      const key = part.slice(0, sepIdx).trim().toLowerCase()
      let val = part.slice(sepIdx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      result[key] = val
    }
  }
  return result
}

/**
 * Parse a markdown math graph / geometry code block into a structured specification.
 */
export function parseGraphSpec(source, language = 'math-graph') {
  const lines = String(source || '').split(/\r?\n/)
  const spec = {
    title: '',
    language,
    width: 560,
    height: 360,
    domain: [-5, 5],
    range: [-5, 5],
    grid: true,
    axes: true,
    autoRange: true,
    functions: [],
    points: [],
    vectors: [],
    lines: [],
    circles: [],
    polygons: [],
    areas: [],
    angles: [],
    labels: [],
    errors: [],
  }

  let domainExplicit = false
  let rangeExplicit = false
  let colorIndex = 0

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    let line = lines[lineNum].trim()
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith('%')) continue

    // Title
    if (/^title\s*[:=]/i.test(line)) {
      spec.title = line.replace(/^title\s*[:=]\s*/i, '').replace(/^["']|["']$/g, '').trim()
      continue
    }

    // Dimensions
    if (/^width\s*[:=]/i.test(line)) {
      const val = parseInt(line.replace(/^width\s*[:=]\s*/i, ''), 10)
      if (val >= 200 && val <= 1200) spec.width = val
      continue
    }
    if (/^height\s*[:=]/i.test(line)) {
      const val = parseInt(line.replace(/^height\s*[:=]\s*/i, ''), 10)
      if (val >= 150 && val <= 1000) spec.height = val
      continue
    }

    // Domain / X Range
    if (/^(?:domain|x(?:-?range)?|x)\s*[:=]/i.test(line)) {
      const val = line.replace(/^(?:domain|x(?:-?range)?|x)\s*[:=]\s*/i, '')
      spec.domain = parseRange(val, spec.domain)
      domainExplicit = true
      continue
    }

    // Range / Y Range
    if (/^(?:range|y(?:-?range)?|y)\s*[:=]/i.test(line) && !/^(?:y\s*=\s*[^,]+)/i.test(line)) {
      const val = line.replace(/^(?:range|y(?:-?range)?|y)\s*[:=]\s*/i, '')
      spec.range = parseRange(val, spec.range)
      rangeExplicit = true
      spec.autoRange = false
      continue
    }

    // Grid / Axes
    if (/^grid\s*[:=]/i.test(line)) {
      spec.grid = !/^(false|off|0|no)$/i.test(line.replace(/^grid\s*[:=]\s*/i, '').trim())
      continue
    }
    if (/^axes\s*[:=]/i.test(line)) {
      spec.axes = !/^(false|off|0|no)$/i.test(line.replace(/^axes\s*[:=]\s*/i, '').trim())
      continue
    }

    // Function definition (e.g. y = x^2, f(x) = sin(x), fn: x^2)
    const fnMatch = /^(?:(?:(?:y|f\([xX]\)|g\([xX]\)|h\([xX]\))\s*=)|(?:fn\s*[:=]))\s*(.+)$/i.exec(line)
    if (fnMatch) {
      const fullFn = fnMatch[1].trim()
      const firstComma = fullFn.indexOf(',')
      let exprStr = firstComma === -1 ? fullFn : fullFn.slice(0, firstComma).trim()
      const optsStr = firstComma === -1 ? '' : fullFn.slice(firstComma + 1).trim()
      const opts = parseKeyValuePairs(optsStr)

      try {
        const evaluator = parseMathExpression(exprStr)
        const color = opts.color || GRAPH_PALETTE[colorIndex % GRAPH_PALETTE.length]
        colorIndex++
        spec.functions.push({
          raw: exprStr,
          evaluator,
          color,
          width: opts.width ? Number(opts.width) : 2.5,
          style: opts.style || 'solid', // solid, dashed, dotted
          label: opts.label || (line.startsWith('f(') || line.startsWith('g(') || line.startsWith('h(') ? line.slice(0, line.indexOf('=')).trim() : exprStr),
          domain: opts.domain ? parseRange(opts.domain) : null,
        })
      } catch (err) {
        spec.errors.push(`Line ${lineNum + 1}: Could not parse function '${exprStr}' (${err.message})`)
      }
      continue
    }

    // Point definition: point: (x, y), label: "Root"
    if (/^point\s*[:=]/i.test(line)) {
      const rest = line.replace(/^point\s*[:=]\s*/i, '').trim()
      const ptMatch = /\(?\s*(-?\d+(?:\.\d+)?(?:pi|π)?)\s*,\s*(-?\d+(?:\.\d+)?(?:pi|π)?)\s*\)?/i.exec(rest)
      if (ptMatch) {
        const pt = parsePoint(ptMatch[0])
        if (pt) {
          const opts = parseKeyValuePairs(rest.slice(ptMatch.index + ptMatch[0].length))
          spec.points.push({
            ...pt,
            label: opts.label || opts.text || `(${pt.x}, ${pt.y})`,
            color: opts.color || '#dc2626',
            size: opts.size ? Number(opts.size) : 4.5,
            dropLines: opts.lines !== 'false' && opts.droplines !== 'false',
          })
        }
      }
      continue
    }

    // Area / Integral shading: area: [a, b], from: 0, to: x^2, fill: rgba(...)
    if (/^(?:area|integral)\s*[:=]/i.test(line)) {
      const rest = line.replace(/^(?:area|integral)\s*[:=]\s*/i, '').trim()
      const rangeMatch = /\[?\s*(-?\d+(?:\.\d+)?)\s*(?:,|to)\s*(-?\d+(?:\.\d+)?)\s*\]?/i.exec(rest)
      if (rangeMatch) {
        const xMin = Number(rangeMatch[1])
        const xMax = Number(rangeMatch[2])
        const opts = parseKeyValuePairs(rest)
        try {
          const topFn = opts.to ? parseMathExpression(opts.to) : (opts.under ? parseMathExpression(opts.under) : parseMathExpression(opts.fn || '0'))
          const bottomFn = opts.from ? parseMathExpression(opts.from) : () => 0
          spec.areas.push({
            xMin,
            xMax,
            topFn,
            bottomFn,
            fill: opts.fill || opts.color || 'rgba(37, 99, 235, 0.18)',
            label: opts.label || '',
          })
        } catch (err) {
          spec.errors.push(`Line ${lineNum + 1}: Area function error (${err.message})`)
        }
      }
      continue
    }

    // Vector definition: vector: from=(x1, y1), to=(x2, y2), label: "v"
    if (/^vector\s*[:=]/i.test(line)) {
      const rest = line.replace(/^vector\s*[:=]\s*/i, '').trim()
      const opts = parseKeyValuePairs(rest)
      const fromPt = opts.from ? parsePoint(opts.from) : { x: 0, y: 0 }
      const toPt = opts.to ? parsePoint(opts.to) : parsePoint(rest)
      if (toPt) {
        spec.vectors.push({
          from: fromPt || { x: 0, y: 0 },
          to: toPt,
          label: opts.label || opts.text || '',
          color: opts.color || '#ea580c',
          width: opts.width ? Number(opts.width) : 2,
        })
      }
      continue
    }

    // Circle definition: circle: center=(h, k), r=R
    if (/^circle\s*[:=]/i.test(line)) {
      const rest = line.replace(/^circle\s*[:=]\s*/i, '').trim()
      const opts = parseKeyValuePairs(rest)
      const center = opts.center ? parsePoint(opts.center) : parsePoint(rest) || { x: 0, y: 0 }
      const radius = opts.r ? Number(opts.r) : (opts.radius ? Number(opts.radius) : 2)
      spec.circles.push({
        center,
        radius,
        stroke: opts.stroke || opts.color || '#7c3aed',
        fill: opts.fill || 'none',
        width: opts.width ? Number(opts.width) : 2,
        label: opts.label || '',
      })
      continue
    }

    // Triangle / Polygon: polygon: (0,0), (4,0), (0,3)
    if (/^(?:polygon|triangle)\s*[:=]/i.test(line)) {
      const rest = line.replace(/^(?:polygon|triangle)\s*[:=]\s*/i, '').trim()
      const ptRegex = /\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/g
      let match
      const vertices = []
      let lastMatchEnd = 0
      while ((match = ptRegex.exec(rest)) !== null) {
        vertices.push({ x: Number(match[1]), y: Number(match[2]) })
        lastMatchEnd = ptRegex.lastIndex
      }
      if (vertices.length >= 3) {
        const opts = parseKeyValuePairs(rest.slice(lastMatchEnd))
        spec.polygons.push({
          vertices,
          stroke: opts.stroke || opts.color || '#2563eb',
          fill: opts.fill || 'rgba(37, 99, 235, 0.1)',
          width: opts.width ? Number(opts.width) : 2,
          label: opts.label || '',
        })
      }
      continue
    }

    // Line / Segment: segment: (x1, y1) to (x2, y2)
    if (/^(?:line|segment)\s*[:=]/i.test(line)) {
      const rest = line.replace(/^(?:line|segment)\s*[:=]\s*/i, '').trim()
      const pts = []
      const ptRegex = /\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/g
      let match
      let lastIdx = 0
      while ((match = ptRegex.exec(rest)) !== null && pts.length < 2) {
        pts.push({ x: Number(match[1]), y: Number(match[2]) })
        lastIdx = ptRegex.lastIndex
      }
      if (pts.length === 2) {
        const opts = parseKeyValuePairs(rest.slice(lastIdx))
        spec.lines.push({
          p1: pts[0],
          p2: pts[1],
          color: opts.color || '#4b5563',
          width: opts.width ? Number(opts.width) : 1.5,
          style: opts.style || 'solid',
          label: opts.label || '',
        })
      }
      continue
    }

    // Angle: angle: at=(0,0), from=(4,0), to=(0,3), label="90°", rightAngle=true
    if (/^angle\s*[:=]/i.test(line)) {
      const rest = line.replace(/^angle\s*[:=]\s*/i, '').trim()
      const opts = parseKeyValuePairs(rest)
      const at = opts.at ? parsePoint(opts.at) : { x: 0, y: 0 }
      const from = opts.from ? parsePoint(opts.from) : { x: 1, y: 0 }
      const to = opts.to ? parsePoint(opts.to) : { x: 0, y: 1 }
      spec.angles.push({
        at,
        from,
        to,
        label: opts.label || opts.text || '',
        rightAngle: opts.rightangle === 'true' || opts.right === 'true',
        size: opts.size ? Number(opts.size) : 0.6,
        color: opts.color || '#2563eb',
      })
      continue
    }

    // Text Label: label: at=(x, y), text="Message"
    if (/^label\s*[:=]/i.test(line)) {
      const rest = line.replace(/^label\s*[:=]\s*/i, '').trim()
      const opts = parseKeyValuePairs(rest)
      const at = opts.at ? parsePoint(opts.at) : parsePoint(rest)
      if (at) {
        spec.labels.push({
          x: at.x,
          y: at.y,
          text: opts.text || opts.label || rest.replace(/\(?\s*-?\d+.*?\)?/, '').trim(),
          color: opts.color || '#1e293b',
          fontSize: opts.fontsize ? Number(opts.fontsize) : 12,
        })
      }
      continue
    }

    // TikZ subset parsing: \draw[options] (x1,y1) -- (x2,y2) ... ;
    if (line.startsWith('\\draw') || line.startsWith('\\node') || line.startsWith('\\fill')) {
      parseTikzLine(line, spec)
      continue
    }
  }

  // Auto-range calculation if Y range was not explicitly specified
  if (!rangeExplicit && spec.functions.length > 0) {
    let yMin = Infinity
    let yMax = -Infinity
    const [xMin, xMax] = spec.domain
    const sampleCount = 60
    const step = (xMax - xMin) / sampleCount

    for (const fn of spec.functions) {
      for (let i = 0; i <= sampleCount; i++) {
        const x = xMin + i * step
        const y = fn.evaluator(x)
        if (Number.isFinite(y)) {
          if (y < yMin) yMin = y
          if (y > yMax) yMax = y
        }
      }
    }

    if (Number.isFinite(yMin) && Number.isFinite(yMax) && yMin < yMax) {
      // Add 15% padding
      const span = yMax - yMin
      const pad = span === 0 ? 2 : Math.max(0.5, span * 0.15)
      spec.range = [
        Math.max(-1000, Math.floor(yMin - pad)),
        Math.min(1000, Math.ceil(yMax + pad)),
      ]
    }
  }

  return spec
}

/** Parse TikZ drawing commands */
function parseTikzLine(line, spec) {
  // \node[color] at (x, y) {label};
  const nodeMatch = /\\node(?:\s*\[([^\]]*)\])?\s*at\s*\(([^)]+)\)\s*\{([^}]*)\}/i.exec(line)
  if (nodeMatch) {
    const pt = parsePoint(nodeMatch[2])
    if (pt) {
      const opts = parseKeyValuePairs(nodeMatch[1] || '')
      spec.labels.push({
        x: pt.x,
        y: pt.y,
        text: nodeMatch[3].trim(),
        color: opts.color || '#1e293b',
      })
      return
    }
  }

  // \draw[options] (x,y) circle (r);
  const circleMatch = /\\draw(?:\s*\[([^\]]*)\])?\s*\(([^)]+)\)\s*circle\s*\(([^)]+)\)/i.exec(line)
  if (circleMatch) {
    const center = parsePoint(circleMatch[2])
    const r = parseFloat(circleMatch[3])
    if (center && Number.isFinite(r)) {
      const opts = parseKeyValuePairs(circleMatch[1] || '')
      spec.circles.push({
        center,
        radius: r,
        stroke: opts.color || opts.stroke || '#2563eb',
        fill: opts.fill || 'none',
      })
      return
    }
  }

  // \draw[options] (x1,y1) -- (x2,y2) ...
  if (line.includes('--')) {
    const isArrow = /\[[^\]]*->[^\]]*\]/.test(line)
    const isCycle = /--\s*cycle/i.test(line)
    const ptRegex = /\(([^)]+)\)/g
    let match
    const pts = []
    while ((match = ptRegex.exec(line)) !== null) {
      const pt = parsePoint(match[1])
      if (pt) pts.push(pt)
    }

    if (pts.length >= 2) {
      if (isCycle && pts.length >= 3) {
        spec.polygons.push({
          vertices: pts,
          stroke: '#2563eb',
          fill: line.includes('\\fill') ? 'rgba(37,99,235,0.1)' : 'none',
        })
      } else if (isArrow && pts.length === 2) {
        spec.vectors.push({
          from: pts[0],
          to: pts[1],
          color: '#1e293b',
        })
      } else {
        for (let i = 0; i < pts.length - 1; i++) {
          spec.lines.push({
            p1: pts[i],
            p2: pts[i + 1],
            color: '#1e293b',
          })
        }
      }
    }
  }
}

// --- 4. Nice Axis Step Calculation ---

function calculateNiceStep(min, max, maxTicks = 10) {
  const range = max - min
  if (range <= 0) return 1
  const roughStep = range / maxTicks
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const normalized = roughStep / magnitude

  let niceStep = 1
  if (normalized < 1.5) niceStep = 1
  else if (normalized < 3) niceStep = 2
  else if (normalized < 7) niceStep = 5
  else niceStep = 10

  return niceStep * magnitude
}

function formatTickNumber(num) {
  if (Math.abs(num) < 1e-10) return '0'
  if (Math.abs(num) >= 10000 || (Math.abs(num) < 0.001 && num !== 0)) {
    return num.toExponential(1)
  }
  const str = num.toFixed(4)
  return str.replace(/\.?0+$/, '')
}

// --- 5. SVG Vector Renderer ---

/**
 * Render a graph specification into a clean, standalone, responsive vector SVG string.
 */
export function renderMathGraphSvg(spec) {
  const width = spec.width || 560
  const height = spec.height || 360
  const padding = {
    top: spec.title ? 45 : 25,
    right: 25,
    bottom: 35,
    left: 45,
  }

  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const [xMin, xMax] = spec.domain
  const [yMin, yMax] = spec.range

  // Coordinate transforms (math space -> SVG pixel space)
  function toSvgX(x) {
    return padding.left + ((x - xMin) / (xMax - xMin)) * plotWidth
  }

  function toSvgY(y) {
    return padding.top + plotHeight - ((y - yMin) / (yMax - yMin)) * plotHeight
  }

  const originX = toSvgX(0)
  const originY = toSvgY(0)

  const elements = []
  const defs = []

  // Add marker definitions for arrows
  defs.push(`
    <marker id="arrow-axis" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#475569" />
    </marker>
    <marker id="arrow-vector" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#ea580c" />
    </marker>
    <marker id="arrow-vector-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#2563eb" />
    </marker>
    <clipPath id="plot-clip-${Math.abs(xMin + yMin).toFixed(0)}">
      <rect x="${padding.left}" y="${padding.top}" width="${plotWidth}" height="${plotHeight}" />
    </clipPath>
  `)

  // Background rect
  elements.push(`<rect width="${width}" height="${height}" rx="8" fill="var(--graph-bg, #ffffff)" stroke="var(--graph-border, #e2e8f0)" stroke-width="1" />`)

  // Title
  if (spec.title) {
    elements.push(`<text x="${width / 2}" y="24" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="600" fill="var(--graph-title, #1e293b)">${escapeXml(spec.title)}</text>`)
  }

  // --- Grid & Ticks ---
  const xStep = calculateNiceStep(xMin, xMax, Math.max(4, Math.floor(plotWidth / 60)))
  const yStep = calculateNiceStep(yMin, yMax, Math.max(4, Math.floor(plotHeight / 50)))

  const gridLines = []
  const tickLabels = []

  // Vertical Grid & X Ticks
  const firstXTick = Math.ceil(xMin / xStep) * xStep
  for (let x = firstXTick; x <= xMax + 1e-9; x += xStep) {
    if (Math.abs(x) < 1e-10) x = 0
    const px = toSvgX(x)
    if (px < padding.left - 1 || px > padding.left + plotWidth + 1) continue

    if (spec.grid) {
      gridLines.push(`<line x1="${px.toFixed(1)}" y1="${padding.top}" x2="${px.toFixed(1)}" y2="${padding.top + plotHeight}" stroke="var(--graph-grid, #f1f5f9)" stroke-width="1" />`)
    }

    // Tick label
    const labelY = Math.min(padding.top + plotHeight + 16, Math.max(padding.top + 14, originY >= padding.top && originY <= padding.top + plotHeight ? originY + 14 : padding.top + plotHeight + 16))
    if (Math.abs(x) > 1e-9 || (originY < padding.top || originY > padding.top + plotHeight)) {
      tickLabels.push(`<text x="${px.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10" fill="var(--graph-ticks, #64748b)">${formatTickNumber(x)}</text>`)
    }
  }

  // Horizontal Grid & Y Ticks
  const firstYTick = Math.ceil(yMin / yStep) * yStep
  for (let y = firstYTick; y <= yMax + 1e-9; y += yStep) {
    if (Math.abs(y) < 1e-10) y = 0
    const py = toSvgY(y)
    if (py < padding.top - 1 || py > padding.top + plotHeight + 1) continue

    if (spec.grid) {
      gridLines.push(`<line x1="${padding.left}" y1="${py.toFixed(1)}" x2="${padding.left + plotWidth}" y2="${py.toFixed(1)}" stroke="var(--graph-grid, #f1f5f9)" stroke-width="1" />`)
    }

    // Tick label
    const labelX = Math.max(padding.left - 6, Math.min(padding.left + plotWidth - 6, originX >= padding.left && originX <= padding.left + plotWidth ? originX - 6 : padding.left - 6))
    if (Math.abs(y) > 1e-9 || (originX < padding.left || originX > padding.left + plotWidth)) {
      tickLabels.push(`<text x="${labelX.toFixed(1)}" y="${(py + 3).toFixed(1)}" text-anchor="end" font-family="system-ui, sans-serif" font-size="10" fill="var(--graph-ticks, #64748b)">${formatTickNumber(y)}</text>`)
    }
  }

  elements.push(`<g class="graph-grid">${gridLines.join('')}</g>`)

  // --- Coordinate Axes ---
  if (spec.axes) {
    const axesLines = []
    // X Axis line
    const axisY = Math.max(padding.top, Math.min(padding.top + plotHeight, originY))
    axesLines.push(`<line x1="${padding.left}" y1="${axisY.toFixed(1)}" x2="${(padding.left + plotWidth + 8).toFixed(1)}" y2="${axisY.toFixed(1)}" stroke="var(--graph-axis, #475569)" stroke-width="1.5" marker-end="url(#arrow-axis)" />`)
    // X Axis label
    axesLines.push(`<text x="${(padding.left + plotWidth + 14).toFixed(1)}" y="${(axisY + 4).toFixed(1)}" font-family="serif" font-style="italic" font-size="12" font-weight="600" fill="var(--graph-axis, #334155)">x</text>`)

    // Y Axis line
    const axisX = Math.max(padding.left, Math.min(padding.left + plotWidth, originX))
    axesLines.push(`<line x1="${axisX.toFixed(1)}" y1="${(padding.top + plotHeight).toFixed(1)}" x2="${axisX.toFixed(1)}" y2="${(padding.top - 8).toFixed(1)}" stroke="var(--graph-axis, #475569)" stroke-width="1.5" marker-end="url(#arrow-axis)" />`)
    // Y Axis label
    axesLines.push(`<text x="${(axisX).toFixed(1)}" y="${(padding.top - 12).toFixed(1)}" text-anchor="middle" font-family="serif" font-style="italic" font-size="12" font-weight="600" fill="var(--graph-axis, #334155)">y</text>`)

    // Origin (0,0) label
    if (originX >= padding.left && originX <= padding.left + plotWidth && originY >= padding.top && originY <= padding.top + plotHeight) {
      axesLines.push(`<text x="${(originX - 6).toFixed(1)}" y="${(originY + 12).toFixed(1)}" text-anchor="end" font-family="system-ui, sans-serif" font-size="10" fill="var(--graph-ticks, #64748b)">0</text>`)
    }

    elements.push(`<g class="graph-axes">${axesLines.join('')}</g>`)
  }

  elements.push(`<g class="graph-tick-labels">${tickLabels.join('')}</g>`)

  // --- Plot Content (Clipped to plot area) ---
  const plotContent = []

  // 1. Shaded Areas / Integrals
  for (const area of spec.areas) {
    const startX = Math.max(xMin, area.xMin)
    const endX = Math.min(xMax, area.xMax)
    if (startX >= endX) continue

    const steps = 100
    const dx = (endX - startX) / steps
    const topPoints = []
    const bottomPoints = []

    for (let i = 0; i <= steps; i++) {
      const x = startX + i * dx
      const yTop = area.topFn(x)
      const yBottom = area.bottomFn(x)
      if (Number.isFinite(yTop) && Number.isFinite(yBottom)) {
        topPoints.push(`${toSvgX(x).toFixed(1)},${toSvgY(yTop).toFixed(1)}`)
        bottomPoints.unshift(`${toSvgX(x).toFixed(1)},${toSvgY(yBottom).toFixed(1)}`)
      }
    }

    if (topPoints.length > 1) {
      const d = `M ${topPoints.join(' L ')} L ${bottomPoints.join(' L ')} Z`
      plotContent.push(`<path d="${d}" fill="${escapeXml(area.fill)}" stroke="none" />`)
    }
  }

  // 2. Polygons & Triangles
  for (const poly of spec.polygons) {
    const pts = poly.vertices.map((v) => `${toSvgX(v.x).toFixed(1)},${toSvgY(v.y).toFixed(1)}`).join(' ')
    plotContent.push(`<polygon points="${pts}" fill="${escapeXml(poly.fill)}" stroke="${escapeXml(poly.stroke)}" stroke-width="${poly.width || 2}" />`)
  }

  // 3. Circles & Ellipses
  for (const circle of spec.circles) {
    const cx = toSvgX(circle.center.x)
    const cy = toSvgY(circle.center.y)
    const rx = ((circle.radius) / (xMax - xMin)) * plotWidth
    const ry = ((circle.radius) / (yMax - yMin)) * plotHeight
    plotContent.push(`<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" stroke="${escapeXml(circle.stroke)}" fill="${escapeXml(circle.fill)}" stroke-width="${circle.width || 2}" />`)
  }

  // 4. Lines & Segments
  for (const line of spec.lines) {
    const x1 = toSvgX(line.p1.x), y1 = toSvgY(line.p1.y)
    const x2 = toSvgX(line.p2.x), y2 = toSvgY(line.p2.y)
    const dash = line.style === 'dashed' ? 'stroke-dasharray="5,4"' : line.style === 'dotted' ? 'stroke-dasharray="2,3"' : ''
    plotContent.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${escapeXml(line.color)}" stroke-width="${line.width || 1.5}" ${dash} />`)
  }

  // 5. Angle Markers
  for (const angle of spec.angles) {
    const at = { x: toSvgX(angle.at.x), y: toSvgY(angle.at.y) }
    const from = { x: toSvgX(angle.from.x), y: toSvgY(angle.from.y) }
    const to = { x: toSvgX(angle.to.x), y: toSvgY(angle.to.y) }

    const v1 = { x: from.x - at.x, y: from.y - at.y }
    const v2 = { x: to.x - at.x, y: to.y - at.y }
    const len1 = Math.hypot(v1.x, v1.y) || 1
    const len2 = Math.hypot(v2.x, v2.y) || 1
    const u1 = { x: v1.x / len1, y: v1.y / len1 }
    const u2 = { x: v2.x / len2, y: v2.y / len2 }

    const sizePx = (angle.size || 0.6) * 25

    if (angle.rightAngle) {
      // Draw square 90 deg corner
      const p1 = { x: at.x + u1.x * sizePx, y: at.y + u1.y * sizePx }
      const p2 = { x: at.x + (u1.x + u2.x) * sizePx, y: at.y + (u1.y + u2.y) * sizePx }
      const p3 = { x: at.x + u2.x * sizePx, y: at.y + u2.y * sizePx }
      plotContent.push(`<path d="M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} L ${p3.x.toFixed(1)} ${p3.y.toFixed(1)}" fill="none" stroke="${escapeXml(angle.color)}" stroke-width="1.5" />`)
    } else {
      // Curved arc
      const p1 = { x: at.x + u1.x * sizePx, y: at.y + u1.y * sizePx }
      const p2 = { x: at.x + u2.x * sizePx, y: at.y + u2.y * sizePx }
      plotContent.push(`<path d="M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${sizePx} ${sizePx} 0 0 0 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}" fill="none" stroke="${escapeXml(angle.color)}" stroke-width="1.5" />`)
    }

    if (angle.label) {
      const mid = { x: at.x + (u1.x + u2.x) * (sizePx * 1.3), y: at.y + (u1.y + u2.y) * (sizePx * 1.3) }
      plotContent.push(`<text x="${mid.x.toFixed(1)}" y="${mid.y.toFixed(1)}" font-family="serif" font-style="italic" font-size="11" fill="${escapeXml(angle.color)}">${escapeXml(angle.label)}</text>`)
    }
  }

  // 6. Function Curves
  const totalSamples = Math.max(200, Math.min(1000, plotWidth * 1.5))
  for (const fn of spec.functions) {
    const fnDomain = fn.domain || [xMin, xMax]
    const curXMin = Math.max(xMin, fnDomain[0])
    const curXMax = Math.min(xMax, fnDomain[1])
    if (curXMin >= curXMax) continue

    const dx = (curXMax - curXMin) / totalSamples
    const segments = []
    let currentSegment = []
    let prevY = null

    for (let i = 0; i <= totalSamples; i++) {
      const x = curXMin + i * dx
      const y = fn.evaluator(x)

      if (!Number.isFinite(y)) {
        if (currentSegment.length > 1) segments.push(currentSegment)
        currentSegment = []
        prevY = null
        continue
      }

      // Check for asymptotes / sharp singularities (e.g. tan(x), 1/x)
      if (prevY !== null) {
        const yDiff = Math.abs(y - prevY)
        const signChange = (prevY > 0 && y < 0) || (prevY < 0 && y > 0)
        if (signChange && yDiff > (yMax - yMin) * 0.8) {
          if (currentSegment.length > 1) segments.push(currentSegment)
          currentSegment = []
        }
      }

      const px = toSvgX(x)
      const py = toSvgY(y)

      // Clamp excessively large off-screen values
      const clampedPy = Math.max(padding.top - 100, Math.min(padding.top + plotHeight + 100, py))
      currentSegment.push(`${px.toFixed(1)},${clampedPy.toFixed(1)}`)
      prevY = y
    }

    if (currentSegment.length > 1) segments.push(currentSegment)

    const dash = fn.style === 'dashed' ? 'stroke-dasharray="6,4"' : fn.style === 'dotted' ? 'stroke-dasharray="2,3"' : ''
    for (const segment of segments) {
      const pathData = `M ${segment.join(' L ')}`
      plotContent.push(`<path d="${pathData}" fill="none" stroke="${escapeXml(fn.color)}" stroke-width="${fn.width || 2.5}" stroke-linecap="round" stroke-linejoin="round" ${dash} />`)
    }
  }

  // 7. Vectors
  for (const vec of spec.vectors) {
    const x1 = toSvgX(vec.from.x), y1 = toSvgY(vec.from.y)
    const x2 = toSvgX(vec.to.x), y2 = toSvgY(vec.to.y)
    plotContent.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${escapeXml(vec.color)}" stroke-width="${vec.width || 2}" marker-end="url(#arrow-vector)" />`)
    if (vec.label) {
      const midX = (x1 + x2) / 2 + 5
      const midY = (y1 + y2) / 2 - 5
      plotContent.push(`<text x="${midX.toFixed(1)}" y="${midY.toFixed(1)}" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="${escapeXml(vec.color)}">${escapeXml(vec.label)}</text>`)
    }
  }

  // 8. Points & Annotations
  for (const pt of spec.points) {
    const px = toSvgX(pt.x)
    const py = toSvgY(pt.y)

    // Drop lines to axes
    if (pt.dropLines) {
      const axisY = Math.max(padding.top, Math.min(padding.top + plotHeight, originY))
      const axisX = Math.max(padding.left, Math.min(padding.left + plotWidth, originX))
      plotContent.push(`<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${px.toFixed(1)}" y2="${axisY.toFixed(1)}" stroke="var(--graph-dropline, #94a3b8)" stroke-width="1" stroke-dasharray="3,3" />`)
      plotContent.push(`<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${axisX.toFixed(1)}" y2="${py.toFixed(1)}" stroke="var(--graph-dropline, #94a3b8)" stroke-width="1" stroke-dasharray="3,3" />`)
    }

    // Point dot
    plotContent.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${pt.size || 4.5}" fill="${escapeXml(pt.color || '#dc2626')}" stroke="#ffffff" stroke-width="1.5" />`)

    // Point label
    if (pt.label) {
      const labelX = px + 6
      const labelY = py - 6
      plotContent.push(`
        <g class="graph-point-badge">
          <rect x="${labelX - 2}" y="${labelY - 11}" width="${pt.label.length * 6.5 + 6}" height="14" rx="3" fill="var(--graph-badge-bg, rgba(255,255,255,0.85))" />
          <text x="${labelX + 1}" y="${labelY}" font-family="system-ui, sans-serif" font-size="10" font-weight="600" fill="var(--graph-badge-text, #1e293b)">${escapeXml(pt.label)}</text>
        </g>
      `)
    }
  }

  // 9. Free Labels
  for (const lbl of spec.labels) {
    const px = toSvgX(lbl.x)
    const py = toSvgY(lbl.y)
    plotContent.push(`<text x="${px.toFixed(1)}" y="${py.toFixed(1)}" font-family="system-ui, sans-serif" font-size="${lbl.fontSize || 12}" font-weight="500" fill="${escapeXml(lbl.color)}">${escapeXml(lbl.text)}</text>`)
  }

  elements.push(`<g class="graph-plot-area" clip-path="url(#plot-clip-${Math.abs(xMin + yMin).toFixed(0)})">${plotContent.join('')}</g>`)

  // --- Legend (Bottom or Top) ---
  const labeledFns = spec.functions.filter((fn) => fn.label)
  if (labeledFns.length > 0) {
    const legendItems = []
    let curX = padding.left + 5
    const legendY = height - 10

    for (const fn of labeledFns) {
      const itemWidth = fn.label.length * 7 + 30
      if (curX + itemWidth < width - padding.right) {
        legendItems.push(`
          <g transform="translate(${curX.toFixed(1)}, ${legendY})">
            <line x1="0" y1="-3" x2="16" y2="-3" stroke="${escapeXml(fn.color)}" stroke-width="2.5" ${fn.style === 'dashed' ? 'stroke-dasharray="4,2"' : ''} />
            <text x="22" y="0" font-family="system-ui, sans-serif" font-size="10.5" font-weight="500" fill="var(--graph-legend, #334155)">${escapeXml(fn.label)}</text>
          </g>
        `)
        curX += itemWidth + 12
      }
    }
    if (legendItems.length > 0) {
      elements.push(`<g class="graph-legend">${legendItems.join('')}</g>`)
    }
  }

  // Error banners inside SVG if any syntax errors
  if (spec.errors.length > 0) {
    const errText = spec.errors.slice(0, 2).join('; ')
    elements.push(`
      <g class="graph-error-banner" transform="translate(10, ${height - 25})">
        <rect width="${width - 20}" height="18" rx="3" fill="#fee2e2" stroke="#f87171" stroke-width="1" />
        <text x="6" y="13" font-family="monospace" font-size="9.5" fill="#991b1b">⚠️ ${escapeXml(errText)}</text>
      </g>
    `)
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="math-diagram-svg" role="img" aria-label="${escapeXml(spec.title || 'Mathematical Diagram')}"><defs>${defs.join('')}</defs>${elements.join('')}</svg>`
}

function escapeXml(value) {
  return String(value ?? '').replace(/[<>&"']/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  })[c])
}
