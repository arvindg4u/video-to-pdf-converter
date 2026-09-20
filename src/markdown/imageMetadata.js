/** Read dimensions from bounded raster headers already supplied by the user.
 * No decoding, execution, filesystem access, or network requests.
 */
export function imageDimensions(bytes, mime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  try {
    if (mime === 'image/png' && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) }
    if (mime === 'image/gif' && bytes.length >= 10) return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
    if (mime === 'image/webp' && bytes.length >= 30 && String.fromCharCode(...bytes.slice(12, 16)) === 'VP8X') {
      const u24 = (i) => bytes[i] + bytes[i + 1] * 256 + bytes[i + 2] * 65536 + 1
      return { width: u24(24), height: u24(27) }
    }
    if (mime === 'image/webp' && bytes.length >= 25 && String.fromCharCode(...bytes.slice(12, 16)) === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (mime === 'image/webp' && bytes.length >= 30 && String.fromCharCode(...bytes.slice(12, 16)) === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    }
    if (mime === 'image/jpeg') {
      // Cap header scanning; metadata is advisory, not required for rendering.
      const end = Math.min(bytes.length, 256 * 1024)
      for (let i = 2; i + 8 < end;) {
        if (bytes[i++] !== 255) break
        while (bytes[i] === 255 && i < end) i++
        const marker = bytes[i++]
        if (marker === 0xda || marker === 0xd9) break
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
        const length = view.getUint16(i)
        if (length < 2 || i + length > end) break
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
          return { width: view.getUint16(i + 5), height: view.getUint16(i + 3) }
        }
        i += length
      }
    }
  } catch { /* Short or unusual headers simply have unknown dimensions. */ }
  return {}
}
