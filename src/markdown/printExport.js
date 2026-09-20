/** Browser-print transaction. No parsing, resource fetching, or pagination. */
export const RESOURCE_TIMEOUT_MS = 15000
export const PRINT_TIMEOUT_MS = 120000
const stale = () => new Error('The notes changed or the preview is unavailable. Wait for the current preview, then export again.')

export function sanitizePrintTitle(value) {
  const title = String(value || '').normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '')
  const short = Array.from(title).slice(0, 100).join('').replace(/[. ]+$/g, '')
  return !short ? 'Study notes' : /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(short) ? Array.from(`Notes ${short}`).slice(0, 100).join('').replace(/[. ]+$/g, '') : short
}

function bounded(promise, milliseconds, signal, message) {
  let timer, abort
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds)
    abort = () => reject(stale())
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
  return Promise.race([promise, guard]).finally(() => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  })
}

export async function printNotes({ frame, expectedDocument, isCurrent, signal, timeoutMs = RESOURCE_TIMEOUT_MS, printTimeoutMs = PRINT_TIMEOUT_MS, now = () => performance.now() }) {
  const started = now()
  const doc = expectedDocument
  const assertCurrent = () => {
    if (signal?.aborted || !doc || !frame?.isConnected || frame.contentDocument !== doc || !frame.contentWindow || doc.readyState === 'loading' || !isCurrent()) throw stale()
  }
  assertCurrent()
  const win = frame.contentWindow
  const details = Array.from(doc.querySelectorAll('details'), (node) => [node, node.open])
  const images = Array.from(doc.images)
  const loading = images.map((image) => [image, image.getAttribute('loading')])
  const title = doc.title
  const cleanups = []
  let beforePrint = false, afterPrint = false, resolveAfterPrint
  const printed = new Promise((resolve) => { resolveAfterPrint = resolve })
  const onBeforePrint = () => { beforePrint = true }
  const onAfterPrint = () => { afterPrint = true; resolveAfterPrint() }
  let resourceMs = 0, fontFallback = false
  try {
    for (const [node] of details) node.open = true
    for (const image of images) image.setAttribute('loading', 'eager')
    doc.title = sanitizePrintTitle(title)
    // Opening disclosures must precede observing fonts.ready and image decode.
    doc.documentElement.getBoundingClientRect()
    const resourceStarted = now()
    const imageReady = (image) => new Promise((resolve) => {
      let settled = false
      const done = (failed = !image.naturalWidth) => { if (!settled) { settled = true; resolve(Boolean(failed)) } }
      const loaded = () => {
        if (typeof image.decode === 'function' && image.naturalWidth) image.decode().then(() => done(), () => done(true))
        else done()
      }
      image.addEventListener('load', loaded, { once: true })
      image.addEventListener('error', done, { once: true })
      cleanups.push(() => { image.removeEventListener('load', loaded); image.removeEventListener('error', done) })
      if (image.complete) loaded()
    })
    const fonts = doc.fonts?.ready ? Promise.resolve(doc.fonts.ready).catch(() => { fontFallback = true }) : Promise.resolve().then(() => { fontFallback = true })
    const results = await bounded(Promise.all([fonts, ...images.map(imageReady)]), timeoutMs, signal,
      'Images or fonts are still loading. Check your connection or remove stalled resources, then try again.')
    if (doc.fonts?.[Symbol.iterator]) fontFallback ||= Array.from(doc.fonts).some((font) => font.status === 'error')
    resourceMs = now() - resourceStarted
    assertCurrent()
    // Force the fully decoded, expanded document's layout before invoking print.
    doc.documentElement.getBoundingClientRect()
    win.addEventListener('beforeprint', onBeforePrint)
    win.addEventListener('afterprint', onAfterPrint)
    assertCurrent()
    const preparationMs = now() - started
    win.focus()
    win.print()
    // Chromium blocks until its dialog closes. Engines that return after
    // beforeprint but before afterprint keep the expanded snapshot until done.
    if (beforePrint && !afterPrint) await bounded(printed, printTimeoutMs, signal,
      'The browser did not finish its print lifecycle. Close the print dialog and retry.')
    return { missingImages: results.slice(1).filter(Boolean).length, fontFallback, resourceMs, preparationMs }
  } finally {
    cleanups.forEach((cleanup) => cleanup())
    win.removeEventListener('beforeprint', onBeforePrint)
    win.removeEventListener('afterprint', onAfterPrint)
    for (const [node, open] of details) node.open = open
    for (const [image, value] of loading) {
      if (value === null) image.removeAttribute('loading')
      else image.setAttribute('loading', value)
    }
    doc.title = title
  }
}
