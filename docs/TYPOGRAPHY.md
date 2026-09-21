# Notes typography: the handwritten option

PDF Lab's study document (preview and exported PDF) can be set in two faces from
**Output → Notes font**:

| Choice | Face | Scripts | Source |
| --- | --- | --- | --- |
| **Handwritten** (default) | [Kalam](https://github.com/itfoundry/kalam) Regular + Bold | Latin + Devanagari in one hand | bundled (`src/markdown/fonts/`, SIL OFL 1.1) |
| **Book** | Charter / Cambria / Noto Serif stack, Devanagari via system faces | per system | system fonts, no download |

The choice is a reading preference: it is stored in `localStorage`
(`pdf-lab:notes-font`), never written into the Markdown, and it changes only
the faces and their metrics. Notes, paper size, output profile (Study /
Revision), pagination rules, code (monospace) and math (KaTeX) are identical in
both settings.

## What the research says (and does not say)

Before choosing a face we checked the evidence behind "fonts that help you
learn":

- **Hard-to-read fonts do not improve memory.** The "desirable difficulty" font
  Sans Forgetica was tested in several independent, peer-reviewed studies
  (882 participants across four experiments in one of them). It reliably *feels*
  harder to read but does not improve recall or comprehension of educational
  text, and in some tasks it hurts recall. Sources: University of Warwick /
  Waikato summary (Taylor et al., *Memory*, 2020) — https://www.sciencedaily.com/releases/2020/05/200528115754.htm ;
  review of Geller et al. 2020, Wetzler et al. 2021 — https://www.psychologyinaction.org/2022-5-23-sans-forgetica-will-a-font-boost-your-studying/ ;
  Huff et al. 2022 — https://link.springer.com/article/10.1186/s41235-022-00448-9 .
  So the handwritten option is **not** sold as a memory booster, and we did not
  pick a deliberately awkward face.
- **Handwritten typefaces do change how text feels.** Schroll, Schnurr & Grewal
  (*Journal of Consumer Research*, 2018) showed across lab and field studies that
  handwritten (vs. machine) typefaces create a sense of human presence and
  emotional attachment — the "someone wrote this for me" feeling — while noting
  their generally poorer readability as the main cost. Source:
  https://www.dhruvgrewal.com/wp-content/uploads/2018/05/2018-JCR-Font-2.pdf .
  That matches the request that started this feature: less "resistance" when
  sitting down with the notes.
- **Legibility rules still apply.** Reading guidance such as the British Dyslexia
  Association style guide asks for uncrowded letterforms, 12–14 pt body text,
  generous line spacing (about 1.5), bold rather than italics or underlining for
  emphasis, and no long stretches of capitals. Source:
  https://www2.worc.ac.uk/disabilityanddyslexia/documents/British%20Dyslexia%20Association%20Style%20Guide.pdf .

Conclusion: choose a *print-hand* (separate, upright-ish letters, not a
cursive/script), set it slightly larger and looser than the book face, keep it
optional, and keep everything that depends on precise glyphs (code, math) in
their proper faces.

## Why Kalam

- **One hand for Hindi and English.** Kalam was designed by the Indian Type
  Foundry (Lipi Raval and Jonny Pinhorn, 2014) as a handwriting-style family
  covering Devanagari *and* Latin, optimised for text on screen, with 1,025
  glyphs including the Devanagari conjuncts needed for real Hindi text
  (https://github.com/google/fonts/blob/main/ofl/kalam/DESCRIPTION.en_us.html).
  Every other well-known legible handwriting face (Patrick Hand, Architects
  Daughter, Indie Flower, Caveat…) is Latin-only, which would make mixed notes
  jump between a handwritten English face and a printed Hindi face mid-line.
- **Rated as a body-text hand.** Independent comparisons of handwriting fonts
  for long entries rank Kalam alongside Patrick Hand as "high paragraph
  legibility, best role: body" (https://keepfond.com/journaling/handwriting-fonts-for-digital-journaling ;
  https://madegooddesigns.com/best-handwritten-fonts/).
- **Free to bundle.** SIL Open Font License 1.1 (copy in
  `src/markdown/fonts/OFL-Kalam.txt`), so the files ship inside the app, are
  precached by the service worker, and never trigger a network request during
  export.

## How it is applied (`src/markdown/handwriting.css`)

- Body 12.5 pt / 1.7 (Study) and 12 pt / 1.58 (Revision) instead of 11.5 / 1.62
  and 11 / 1.48; headings scaled up by one step; tables and contents 11.5 pt.
- **Emphasis is a highlighter stroke, not italic.** Kalam has no italic, and a
  synthetic slant on an already slanted hand is unreadable; a pale amber mark
  under `*emphasis*` is the mark a student makes in a notebook. Bold stays bold.
  Emphasis inside code or math is left alone.
- Running header/footer and the subject line stay in the sans meta face, so the
  page keeps a calm printed frame around the handwritten body.
- The `@page` running header uses `var(--font-body)`, so it follows the choice.

## Files, size, offline

`kalam-latin-400/700.woff2` (~22 KB each) and `kalam-devanagari-400/700.woff2`
(~109 KB each) — 264 KB in total, split by `unicode-range` so a browser only
decodes the script it needs. The Light weight and the Latin Extended subset are
not bundled (rare accented Latin falls back to the system stack). The build adds
the four files to the precache inventory automatically (`78` files after this
change), and `tests/browser/offline.spec.js` verifies the face loads with the
network off.

## Tests

- `tests/markdown-fonts.test.js` — bundled files are real WOFF2 under the OFL,
  `fonts.css` declares exactly them with local URLs, the hand layer never
  touches code/math/meta faces, `createNotesDocument` applies `font-hand` only
  for the closed value `hand`, and the stored preference is validated and
  tolerant of blocked storage.
- `tests/browser/fonts.spec.js` — default is handwritten; Hindi + English render
  in Kalam (Regular Devanagari + Latin and Bold Latin loaded from the bundle);
  code and math keep their faces; emphasis is a mark; Study/Revision metrics;
  switching to Book restores the serif; the choice survives reloads; a corrupt
  stored value falls back safely.
- `tests/browser/profiles.spec.js` and `markdown.spec.js` pin the *book*
  metrics and therefore select Book explicitly.

Not verified here: how the exported PDF looks in a real print-to-PDF dialog on
Android/iOS (the sandbox exercises Chromium's print path only).
