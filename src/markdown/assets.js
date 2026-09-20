/** Explicit, bounded local image context. No network or filesystem access. */
export const ASSET_LIMITS = { count: 200, perFile: 10 * 1024 * 1024, total: 40 * 1024 * 1024 }
const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

export function validateAssetPath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024) return null
  // Decode once for Markdown's URL encoding, reject residual encodings rather
  // than allowing double-encoded separators/traversal to mean something else.
  let path
  try { path = decodeURIComponent(value) } catch { return null }
  if (/[\\:%?#\x00-\x1f\x7f]/.test(path) || path.startsWith('/')) return null
  const parts = path.split('/').filter((part) => part !== '.')
  if (parts.some((part) => !part || part === '..')) return null
  return parts.join('/') || null
}
function mimeFor(path) {
  const extension = path.split('.').pop().toLowerCase()
  return Object.hasOwn(types, extension) ? types[extension] : null
}
function signature(bytes, mime) {
  const at = (...values) => values.every((v, i) => bytes[i] === v)
  const text = (start, end) => String.fromCharCode(...bytes.slice(start, end))
  if (mime === 'image/png') return at(137, 80, 78, 71, 13, 10, 26, 10)
  if (mime === 'image/jpeg') return at(255, 216, 255)
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(text(0, 6))
  return text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP'
}
function base64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

export function createAssetResolver(entries = []) {
  const resources = new Map()
  for (const entry of entries) {
    const path = validateAssetPath(entry.path)
    if (!path || !mimeFor(path) || !entry.src.startsWith(`data:${mimeFor(path)};base64,`)) continue
    // Duplicate exact paths are deliberately unresolvable, not last-wins.
    resources.set(path, resources.has(path) ? null : Object.freeze({ ...entry, path }))
  }
  return Object.freeze({
    validate: validateAssetPath,
    resolve(value, { basename = false } = {}) {
      const path = validateAssetPath(value)
      if (!path || !mimeFor(path)) return null
      if (resources.has(path)) return resources.get(path)
      if (!basename || path.includes('/')) return null
      const matches = [...resources].filter(([key]) => key.split('/').pop() === path)
      return matches.length === 1 ? matches[0][1] : null
    },
    size: [...resources.values()].filter(Boolean).length,
  })
}

/** Folder paths are relative to the selected folder, not the host filesystem.
 * Unsupported files are ignored without reading them. Import is atomic on errors.
 */
export async function ingestAssets(files, { folder = false } = {}) {
  const selected = Array.from(files)
  if (selected.length > ASSET_LIMITS.count) throw new Error('Select at most 200 files in a focused asset folder.')
  const entries = []
  let total = 0, skipped = 0
  for (const file of selected) {
    const raw = folder ? file.webkitRelativePath?.split('/').slice(1).join('/') : file.name
    const path = validateAssetPath(raw)
    if (!path) throw new Error('An asset has an unsafe or invalid path.')
    const mime = mimeFor(path)
    if (!mime) { skipped++; continue }
    total += file.size
    if (file.size > ASSET_LIMITS.perFile || total > ASSET_LIMITS.total) throw new Error('Images exceed the 10 MB per-file or 40 MB total limit.')
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length !== file.size || !signature(bytes, mime)) throw new Error(`Invalid image content: ${path}`)
    entries.push({ path, src: `data:${mime};base64,${base64(bytes)}` })
  }
  return { resolver: createAssetResolver(entries), skipped }
}
