/**
 * Keeps the browser/OS chrome colour in step with the app theme. Installed
 * (standalone) windows paint their title bar with <meta name="theme-color">;
 * the manifest's theme_color only covers the splash screen and the moment
 * before the page has loaded.
 */
// Must equal --bg-base of each theme in src/index.css (tests/palette.test.js checks).
export const THEME_COLORS = Object.freeze({ light: '#f4efe6', dark: '#141a24' })

export function applyThemeColor(theme, doc = document) {
  const color = THEME_COLORS[theme] || THEME_COLORS.light
  let meta = doc.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = doc.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    doc.head.appendChild(meta)
  }
  meta.setAttribute('content', color)
  return color
}
