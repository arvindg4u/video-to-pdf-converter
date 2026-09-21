# PDF Lab colour system — “study vibes”

The app UI uses one token-based palette defined in `src/index.css` with two
themes: **Paper & Ink** (light) and **Night Desk** (dark). Every component
stylesheet (`src/App.css`, `src/MarkdownConverter.css`, `src/pwa/pwa.css`)
references tokens only; `tests/palette.test.js` enforces that and checks every
colour pairing the UI relies on against WCAG 2.2 thresholds.

The printed/exported study-notes document (`src/markdown/study.css`) is a
separate, print-tuned design (black-on-white paper, calm callouts) and is
intentionally **not** part of this palette: PDFs must look the same whichever
app theme is active.

## What the research says (and how it is applied)

| Guidance | Source | Applied as |
| --- | --- | --- |
| For learning/study interfaces use calm cool tones (navy, deep blue, green) as the base, warm yellow/orange only to highlight actions, red only for alerts; neutral backgrounds; no more than ~4 core colours. | Verpex, *Best Color Combinations for Educational Websites* (2025) — <https://verpex.com/blog/best-color-combinations-for-educational-websites>; CLRN, *What Colours Help You Study* — <https://www.clrn.org/what-colours-help-you-study/>; ACS Learning, *What Color Helps You Study* — <https://acslearning.org/what-color-helps-you-study/> | Navy “ink” for text and primary actions, sage green for success, brick red only for errors, amber “highlighter” used sparingly (active tab underline, emphasised values, slider thumb, update notice). Four hue families total. |
| 60‑30‑10: ~60 % neutrals, ~30 % secondary, ~10 % accents; reserve accents for interactive elements. | AppInstitute, *How to Build a Color Palette for Your App* — <https://appinstitute.com/build-color-palette-app/> | Paper surfaces dominate; navy for controls; amber and status colours are small touches. |
| Pure white backgrounds glare during long sessions; warm off‑white/paper tones (~92–95 % brightness) and dark‑grey rather than pure‑black text are easier on the eyes. Keep contrast moderate‑high, saturation low. | EnigmaEasel, *Color Palettes That Reduce Eye Strain* (2026) — <https://enigmaeasel.com/color-palettes-that-reduce-eye-strain/>; Lost Among Notes, *The madness of white backgrounds* (2026) — <https://blog.silvela.org/post/2026-03-31-bright-backgrounds/>; Design for Ducks, *Alternatives to white background* — <https://designforducks.com/alternative-to-white-background-for-website-and-app-ui/> | `--bg-base #f4efe6`, cards `#fffdf8` (never `#fff`), text `#1f2a3a` (never `#000`). |
| Dark theme: use dark grey (Material recommends `#121212`-class surfaces), not black; higher elevation = lighter surface; desaturate accents so they pass 4.5:1 and do not “vibrate”; off‑white rather than pure‑white text; softer reds/teal‑greens for status. | Material Design, *Dark theme* — <https://m2.material.io/design/color/dark-theme.html>; ColorPick, *Dark Mode Color Schemes* (2026) — <https://colorpick.app/blog/dark-mode-color-schemes>; James Dowen, *Dark Mode Design* (2025) — <https://jamesdowen.com/blog/dark-mode-design-best-practices-for-accessibility-and-aesthetics/>; Tunde Hercules, *Designing effective dark mode interfaces* — <https://medium.com/@tundehercules/designing-effective-dark-mode-interfaces-17f38ecea2e9> | Night Desk base `#141a24` → cards `#1c2431` → insets `#26303f` (tinted navy‑grey, lighter as elevation rises); text `#ebe6dc`; accents desaturated (`#8fb3e0`, `#e6b455`, `#7cc4a1`, `#e08a8a`). |
| WCAG 2.2: 4.5:1 for normal text (SC 1.4.3), 3:1 for large text, UI component boundaries, focus indicators and meaningful graphics (SC 1.4.11); ratios are thresholds, do not round up. | W3C, *Understanding SC 1.4.11 Non‑text Contrast* — <https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html>; web-accessibility-checker, *WCAG 2.2 colour contrast guide* — <https://web-accessibility-checker.com/en/blog/color-contrast-checker-wcag-guide> | Automated check of 60+ pairings per theme in `tests/palette.test.js`; input borders use `--border-strong` (≥ 3:1), focus rings use `--accent` (≥ 3:1 on every surface), the amber slider thumb carries a ring so its boundary meets 3:1 on the track. |

## Tokens

| Token | Paper & Ink (light) | Night Desk (dark) | Used for |
| --- | --- | --- | --- |
| `--bg-base` | `#f4efe6` | `#141a24` | page background, browser theme colour |
| `--bg-glow` | amber 16 % | amber 10 % | faint radial “desk lamp” glow in one corner |
| `--surface-solid` | `#fffdf8` | `#1c2431` | cards/panels |
| `--surface-muted` | `#efe8db` | `#26303f` | inset areas, inputs, drop zones |
| `--border-soft` | `#dcd3c2` | `#354052` | decorative card borders |
| `--border-strong` | `#8d8574` | `#6d7890` | input/select/textarea borders, drop-zone dashes (≥ 3:1) |
| `--text-main` | `#1f2a3a` | `#ebe6dc` | body text, headings |
| `--text-soft` | `#4a5261` | `#bdb6aa` | secondary text |
| `--text-dim` | `#6b675e` | `#a09a91` | small labels (still ≥ 4.5:1) |
| `--accent` / `--accent-2` | `#1f3d63` / `#2f5d8a` | `#8fb3e0` / `#a9c6ea` | primary buttons (subtle gradient), links, focus rings, progress fill |
| `--on-accent` | `#fffdf8` | `#0f1a2b` | text on primary buttons |
| `--accent-soft` | `#e3ebf4` | `#22304a` | navy wash |
| `--highlight` | `#f2b134` | `#e6b455` | amber highlighter fills (slider thumb) |
| `--highlight-soft` | `#fbe9bf` | `#3a3220` | amber wash (active drop zone, update notice, file badge) |
| `--highlight-text` | `#8a5a0b` | `#e6b455` | emphasised values in text (e.g. FPS) |
| `--highlight-border` | `#b07a12` | `#e6b455` | active-tab underline, amber borders (≥ 3:1) |
| `--on-highlight` | `#1f2a3a` | `#1a1610` | text on a solid amber fill |
| `--success` / `--success-soft` | `#2b6f53` / `#dcebe1` | `#7cc4a1` / `#1f3a30` | online dot, success notices |
| `--warning` | `#a86c17` | `#e0a04a` | offline dot |
| `--danger` / `--danger-soft` / `--on-danger` | `#b23a3a` / `#f6dcdc` / `#fffdf8` | `#e08a8a` / `#3d2626` / `#1b1214` | errors, cancel/remove buttons |
| `--progress-track` | `#e4dccb` | `#2b3446` | slider and progress tracks |
| `--thumb-ring` | `--accent` | `--bg-base` | ring around the amber slider thumb |
| `--elevation` | warm shadow | deeper shadow | card shadow |
| `--brand-shadow` | `rgba(14, 36, 66, .35)` | same | shadow under the app icon (tied to its navy) |

The manifest `theme_color`/`background_color` stay `#0e2442`, the icon's own
navy, so splash screens match the icon; the page `<meta name="theme-color">`
follows `--bg-base` of the active theme (`src/pwa/themeColor.js`).

## Verified contrast (WCAG 2.2, computed in `tests/palette.test.js`)

Lowest ratios in each category, light / dark:

- Body and secondary text on any surface: 4.62 / 4.77 (`--text-dim` on `--surface-muted`); main text 11.9 / 10.7 or better.
- Button labels: 6.76 / 8.06 (label on the gradient's lighter end / on `--accent`).
- Component boundaries and focus rings: 3.00 / 3.01 (`--border-strong` on `--surface-muted`), `--accent` ≥ 9.0 / 6.2.
- Status indicators: `--warning` 3.57 / 5.90, `--success` 4.92 / 6.51, `--danger` 4.84 / 5.18 on the muted surface.
- Progress fill on its track: 8.08 / 5.76; slider thumb boundary on the track: 8.08 (ring) / 6.55 (amber itself).

## Changing colours

Edit tokens in `src/index.css` only, keep both theme blocks in sync (the test
fails if a token is missing from the dark theme), update `THEME_COLORS` in
`src/pwa/themeColor.js` and the `theme-color` meta in `index.html` if
`--bg-base` changes, and run `npm test`. Component stylesheets must not contain
literal colours.
