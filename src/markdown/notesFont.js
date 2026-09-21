/**
 * Notes typography choice for the study document (preview and PDF).
 *
 * 'hand' — Kalam, a legible print-hand covering Devanagari + Latin (bundled).
 * 'book' — the original book serif stack (system fonts, no download).
 *
 * The choice is a reading preference, not document content, so it is kept in
 * localStorage like the app theme and never written into the Markdown.
 */
export const NOTES_FONTS = Object.freeze([
  Object.freeze({ value: 'hand', label: 'Handwritten (Kalam)' }),
  Object.freeze({ value: 'book', label: 'Book (serif)' }),
])

export const DEFAULT_NOTES_FONT = 'hand'
export const NOTES_FONT_STORAGE_KEY = 'pdf-lab:notes-font'

const VALID = new Set(NOTES_FONTS.map((font) => font.value))

export function normalizeNotesFont(value) {
  return VALID.has(value) ? value : DEFAULT_NOTES_FONT
}

function storageOrNull(storage) {
  if (storage !== undefined) return storage
  try { return globalThis.localStorage ?? null } catch { return null } // access can throw (sandboxed iframes, blocked storage)
}

export function readNotesFont(storage) {
  try {
    return normalizeNotesFont(storageOrNull(storage)?.getItem(NOTES_FONT_STORAGE_KEY))
  } catch {
    return DEFAULT_NOTES_FONT
  }
}

/** Best effort: a full or blocked storage must never break the converter. */
export function writeNotesFont(value, storage) {
  const font = normalizeNotesFont(value)
  try { storageOrNull(storage)?.setItem(NOTES_FONT_STORAGE_KEY, font) } catch { /* ignore */ }
  return font
}
