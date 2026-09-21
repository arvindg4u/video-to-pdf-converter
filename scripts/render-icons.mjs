#!/usr/bin/env node
/**
 * Renders every shipped PDF Lab icon from the design master
 * `branding/pdf-lab-icon.svg` into `public/icons/`.
 *
 * Why a browser? Chromium's SVG rasteriser gives clean anti-aliasing,
 * gradients and drop shadows at every size without adding an image-processing
 * dependency to the project: Playwright is already a devDependency.
 *
 * Usage:  npm run icons
 *         PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run icons
 *
 * The generated PNG/SVG files are committed; `vite build` never needs a
 * browser. Re-run this script only when the master artwork changes.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const masterPath = path.join(root, 'branding', 'pdf-lab-icon.svg')
const outDir = path.join(root, 'public', 'icons')

/** Icon variants. Scale is relative to the master artwork (±200 × ±280 units). */
export const VARIANTS = [
  // Ordinary ("any") icons: rounded square, artwork fills the tile generously.
  { file: 'icon-192.png', size: 192, shape: 'rounded', scale: 1.12 },
  { file: 'icon-512.png', size: 512, shape: 'rounded', scale: 1.12 },
  // Maskable icon: full-bleed opaque square; artwork stays inside the 40 %-radius safe circle.
  { file: 'icon-512-maskable.png', size: 512, shape: 'square', scale: 1.0 },
  // iOS home-screen icon: full-bleed square (iOS applies its own rounded mask).
  { file: 'apple-touch-icon.png', size: 180, shape: 'square', scale: 1.06 },
  // Favicons: simplified composition so the play symbol still reads at 16 px.
  { file: 'favicon-32.png', size: 32, shape: 'rounded', scale: 1.34, simplified: true },
  { file: 'favicon-16.png', size: 16, shape: 'rounded', scale: 1.34, simplified: true },
]

function extractDefs(master) {
  const match = master.match(/<defs>[\s\S]*<\/defs>/)
  if (!match) throw new Error('branding/pdf-lab-icon.svg has no <defs> block')
  return match[0]
}

/** Builds a standalone SVG document for one variant. */
export function composeVariant(master, { size, shape, scale, simplified = false }) {
  let defs = extractDefs(master)
  if (simplified) {
    // Tiny sizes: drop the text lines and fold crease, they only add noise.
    defs = defs
      .replace(/\s*<!-- Abstract text lines[\s\S]*?<rect[^>]*\/>\s*<rect[^>]*\/>/, '')
      .replace(/\s*<path d="M 80 -280 L 80 -190 Q 80 -160 110 -160 L 200 -160" fill="none"[^>]*\/>/, '')
  }
  const rx = shape === 'rounded' ? ' rx="224"' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}">
${defs}
  <rect width="1024" height="1024"${rx} fill="url(#pdf-lab-bg)"/>
  <use href="#artwork" transform="translate(512 512) scale(${scale})"/>
</svg>
`
}

async function main() {
  const master = await readFile(masterPath, 'utf8')
  await mkdir(outDir, { recursive: true })

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  const browser = await chromium.launch(executablePath
    ? { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
    : {})
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1024, height: 1024 } })
    for (const variant of VARIANTS) {
      const svg = composeVariant(master, variant)
      await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`)
      await page.waitForFunction(() => document.fonts.ready.then(() => true))
      const png = await page.screenshot({
        type: 'png',
        omitBackground: true,
        clip: { x: 0, y: 0, width: variant.size, height: variant.size },
      })
      await writeFile(path.join(outDir, variant.file), png)
      console.log(`wrote public/icons/${variant.file} (${variant.size}×${variant.size}, ${png.byteLength} bytes)`)
    }
  } finally {
    await browser.close()
  }

  // Vector favicon for high-DPI tabs: same simplified composition as the PNG favicons.
  const faviconSvg = composeVariant(master, { size: 64, shape: 'rounded', scale: 1.34, simplified: true })
    .replace(/ width="64" height="64"/, '')
  await writeFile(path.join(outDir, 'favicon.svg'), `<!-- Generated from branding/pdf-lab-icon.svg by scripts/render-icons.mjs -->\n${faviconSvg}`)
  console.log('wrote public/icons/favicon.svg')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
