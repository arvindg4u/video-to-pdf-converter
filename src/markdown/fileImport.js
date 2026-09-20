import { prepareMarkdown } from './obsidian.js'

/**
 * Explicit Markdown input cap. Raised from 1 MB to 5 MB for realistic large
 * exam notes (a continuously growing Obsidian "Complete Notes.md"); still
 * bounded — input is never unlimited. Mirrors the editor's maxLength.
 */
export const MAX_FILE_SIZE = 5 * 1024 * 1024
export const MAX_FILE_SIZE_LABEL = '5 MB'

/** Case-insensitive Markdown extension check (.md, .MD, .markdown, …). */
export const MARKDOWN_FILE_PATTERN = /\.(md|markdown)$/i

export function isMarkdownFileName(name) {
  return MARKDOWN_FILE_PATTERN.test(String(name ?? ''))
}

/**
 * Validate and read a user-chosen file into the Markdown pipeline.
 * Pure logic (works with any File-like object exposing `name`, `size`, and
 * `text()`), so the browser file-selection path is unit-testable in Node.
 *
 * Returns either `{ error }` with a user-facing message for unsupported,
 * empty, oversized, or unreadable files, or `{ text, title, frontmatter }`:
 *   - `text`        the raw UTF-8 file content, verbatim (the editor shows
 *                   exactly what the user's Obsidian file contains),
 *   - `title`       frontmatter `title` when present, else the file name
 *                   without its extension,
 *   - `frontmatter` parsed metadata (or null), preserved for future phases.
 * The file content itself remains untrusted input: rendering strips the
 * frontmatter and sanitizes everything (see render.js).
 */
export async function readMarkdownFile(files) {
  if (!Array.isArray(files) || files.length !== 1 || !isMarkdownFileName(files[0]?.name)) {
    return { error: 'Choose one Markdown file (.md or .markdown).' }
  }
  const file = files[0]
  if (file.size > MAX_FILE_SIZE) {
    return { error: `This file is too large. Choose a Markdown file up to ${MAX_FILE_SIZE_LABEL}.` }
  }
  let text
  try {
    text = await file.text()
  } catch {
    return { error: 'The file could not be read. Please try again.' }
  }
  if (!text.trim()) {
    return { error: 'This Markdown file is empty. Choose a file with some notes.' }
  }
  if (text.includes('\0')) {
    return { error: 'This does not look like a text file. Use a UTF-8 Markdown file.' }
  }
  const { frontmatter } = prepareMarkdown(text)
  const metadataTitle = typeof frontmatter?.title === 'string' ? frontmatter.title.trim().slice(0, 150) : ''
  const title = metadataTitle || String(file.name).replace(MARKDOWN_FILE_PATTERN, '')
  return { text, title, frontmatter }
}
