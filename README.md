# 🎬 PDF Lab — Video & Markdown to PDF

**Video Frames • Markdown Study Notes • 100% Browser-Based • PWA Support**

Ek saath 20 videos ke frames ko ek single PDF mein merge karo!

## ✨ Video Features

- ✅ **Multiple Videos Support** - Up to 20 videos ek saath upload karo
- ✅ **Single Merged PDF** - Sabhi videos ke frames ek PDF mein
- ✅ **Deterministic Sampling** - Exact, predictable frame timestamps
- ✅ **Standard Page Sizes** - A4 or US Letter, aspect preserved, no cropping
- ✅ **Readable Frame Labels** - Filename + timestamp on a contrast bar (optional)
- ✅ **Real Cancellation** - Stop long conversions anytime, queue kept
- ✅ **Graceful Failures** - Corrupt files fail fast with the filename named
- ✅ **PWA Support** - App ki tarah install karo (Chrome/Edge prompt, ya manual: Share → Add to Home Screen)
- ✅ **Offline Support** - Production build poora app precache karta hai; status strip mein "Offline ready" dikhne ke baad video aur Markdown (math fonts ke saath) bina internet chalte hain — details [docs/PWA.md](docs/PWA.md)
- ✅ **Progress Tracking** - Real-time progress bar with stats
- ✅ **Minimal UI** - Screen pe sirf labels, controls aur status; har hint/help ek chhote **i** button ke peeche (tap/click, Enter/Space; Escape se band; screen readers ke liye `dialog` role) — `src/ui/InfoTip.jsx`
- ✅ **Study-friendly themes** - “Paper & Ink” light theme (warm paper, navy ink, amber highlighter) and “Night Desk” dark theme; WCAG 2.2 contrast checked by tests — see [docs/PALETTE.md](docs/PALETTE.md)
- ✅ **Remove Videos** - Upload ke baad bhi videos remove kar sakte ho
- ✅ **Duplicate Detection** - Same video dobara add nahi hota

## 🎥 Video Converter

### Supported format

- **Container:** `.mp4` only (`video/mp4` MIME, or `.mp4` extension when the platform reports no MIME type).
- **Recommended codec:** H.264 video. Whatever your browser can play, the converter can usually process — if a file does not play in your browser, conversion cannot work either.
- Files that merely *look* like MP4 (renamed `.webm`, text files, random bytes) are rejected: first by MIME/extension validation, then by real browser decoding before any frame work begins.

### Frame sampling (exact rule)

For a video of `duration` seconds at `fps` frames per second:

```
timestamps = 0, 1/fps, 2/fps, … , (n−1)/fps
n = floor(duration × fps)
```

- Timestamp `0` **is** included (the first frame).
- Every timestamp is strictly **less than** `duration`: the converter never seeks at/past the end of the stream, so there is no duplicate final frame.
- Each video contributes exactly `n` frames; multi-video totals are the plain sum — no off-by-one errors.
- Very short but playable clips (`floor(duration × fps) === 0`, e.g. a 0.4 s video at 1 FPS) contribute **one** frame at `t=0` instead of erroring.
- FPS above the source's temporal resolution still yields exact timestamps; some frames may look identical (the decoder holds the nearest frame), but the count stays predictable.
- Unplayable durations (`NaN`, `Infinity`, `0`) fail fast with a named decode error.

### Limits

| Limit | Value | Why |
|---|---|---|
| Videos per conversion | 20 | Long-standing product limit |
| Total frames | 1000 | Bounds tab memory + conversion time |
| Duration per video | 30 minutes | Long files seek/decode unreliably in tabs |
| File size | 2 GB | Practical tab-memory guard |
| Source resolution | 3840×2160 (4K) | Larger sources are rejected before decoding |
| Embedded frame size | 1920 px longest edge | 4K sources are downscaled for sane PDF sizes |
| Metadata load budget | 15 s per video | Corrupt/unsupported files fail instead of hanging |
| Seek budget | 10 s per seek | Stalled decoders fail instead of hanging forever |
| FPS range | 1–6 | Higher values explode frame counts |

Every limit error states the current value, the allowed value, and what to do (e.g. lower FPS, shorten the clip, convert in batches).

### PDF output

- Standard **A4** or **US Letter** pages (your choice; same concept as Markdown mode).
- Page orientation follows each frame's aspect ratio (landscape ↔ portrait), so mixed clips all stay large.
- Frames are **fitted, centered, never cropped, never stretched**.
- Optional label bar (on by default): `filename.mp4 · 12.50s` in white on a semi-transparent dark strip — readable on bright and dark frames alike.
- File names: `merged-videos-<timestamp>.pdf`.

### Cancellation & reliability

- **Cancel conversion** stops everything: metadata loads, seeks, rendering, and PDF writing. No partial PDF is ever downloaded, resources (video decoders, object URLs, canvas memory) are released, and your queue is left untouched so you can retry.
- One corrupt video aborts the merged PDF with a **named** error (`"holiday.mp4" could not be read…`) — the app never gets stuck in a busy state.
- Progress updates are throttled so the UI stays responsive, and always end at exactly 100%.

### Architecture

```
App.jsx                      — mode/theme shell + conversion lifecycle state
video/
  VideoUploader.jsx          — file picker + drag & drop
  VideoQueue.jsx             — deterministic queue + removal
  FrameController.jsx        — FPS / paper / label settings
  ConversionProgress.jsx     — accessible progress bar
  constants.js               — limits & timeouts (with rationale)
  errors.js                  — VideoError taxonomy + human messages
  videoValidation.js         — MIME/extension/queue validation
  videoSampling.js           — deterministic timestamp math
  videoLoader.js             — metadata + seek helpers (timeout/abort/cleanup)
  pdfWriter.js               — standard-page layout + label overlay
  videoProcessing.js         — controller: plan (guards) → render (frames)
```

The pipeline is browser-only: `HTMLVideoElement → Canvas → JPEG → jsPDF`. `toDataURL()` is kept deliberately — it is the most compatible jsPDF input, and frames are embedded one-by-one (never accumulated) with references released immediately, so peak memory stays flat.

## 📚 Markdown to PDF

Switch to **Markdown to PDF** to turn a `.md` or `.markdown` file into an exam-study PDF — including notes maintained in **Obsidian** (e.g. a continuously growing `Complete Notes.md`): choose the file directly, no copy/paste needed. The existing video converter remains available in its own mode.

1. Upload or drag in **one UTF-8 Markdown file (up to 5 MB)**, paste Markdown into the editor, or choose **Try a sample**. Extensions are case-insensitive (`.MD`, `.MARKDOWN` work), and Hindi + English mixed notes render correctly.
2. Edit your notes and check the live, light-paper preview. Choose a document title and **A4** or **US Letter** paper.
3. Click **Export PDF**. In your browser’s print dialog, select **Save as PDF**. Keep the selected paper size and disable browser headers/footers for a clean result. Enable background graphics if your browser does not preserve the theme’s shading by default.

PDF export uses the browser’s print engine rather than screenshots: text stays selectable, links remain clickable in supporting browsers, and long notes paginate. The preview is continuous; use print preview to check final page breaks. A browser with printing/PDF support is required; mobile print/share options vary.

### Supported Markdown

- CommonMark headings (all six levels), paragraphs, emphasis, strong text, blockquotes, rules, nested ordered/unordered lists, links, images, and inline/fenced code.
- GitHub-flavored tables, alignment, strikethrough, autolinks, and task lists.
- Footnotes, heading anchors, and syntax highlighting for common code languages (unknown languages remain readable plain code).
- Inline math with `$…$` and display math with `$$…$$`, rendered using bundled **KaTeX** fonts. Use fenced blocks for literal code. KaTeX supports a subset of LaTeX, not an entire LaTeX document.
- Safe embedded HTML. Scripts, event handlers, iframes, unsafe URLs, and arbitrary styles are removed. Preview content is isolated in a sandboxed document.
- **Obsidian files (Phase 1):** a leading YAML frontmatter block (`title`, `subject`, `tags`, …) is detected, kept as inert metadata (a frontmatter `title` becomes the document title), and never rendered as document content.
- **Obsidian callouts (Phase 2):** `> [!NOTE]`, `> [!IMPORTANT]`, `> [!TIP]`, `> [!WARNING]`, `> [!CAUTION]` render as calm, print-friendly study blocks — with optional custom titles, aliases (`[!INFO]`, `[!DANGER]`, `[!ABSTRACT]`, …), and collapsible `[!type]+` / `[!type]-` forms (collapsible callouts are expanded automatically when exporting). Unknown types degrade to a neutral block. Nested Markdown (lists, tables, code, math) is preserved, and callout content goes through the same sanitization as everything else.

The **Exam study notes** theme is tuned for long revision sessions: book-like 11.5 pt serif body text at 1.62 line-height with a local, offline-safe font stack that falls back deterministically for Devanagari (Hindi + English mixed notes), a restrained heading hierarchy (chapter → topic → subtopic → detail), compact lists, readable tables with repeating print headers, aspect-preserving images, calm callout colors, and pagination rules that keep headings, callouts, images, and table rows intact across page breaks. No remote fonts, gradients, or decoration; A4 is the primary layout (US Letter also supported), and the page stays light even when the application uses dark mode.

### Obsidian syntax and local images (Phase 3)

- `[[Indian Constitution]]` and `[[Page|Constitution]]` display readable text, not invented URLs. Cross-document heading/block targets also remain text.
- `[[#Fundamental Rights|Read this section]]` links to an existing heading using the existing sanitized heading ID. Missing targets remain readable non-links.
- `#polity`, `#indian-constitution`, `#RAS/prelims`, and Hindi tags are subtle inline metadata, not navigation. Markdown headings and code are unaffected.
- Paragraph/list endings such as `Important fact ^fact` create safe block anchors; `[[#^fact]]` can link forward or backward. Duplicate block markers remain visible after the first. Complex Obsidian block structures are not a graph engine.
- `![[image.png]]` is an **embed**, distinct from `[[image.png]]`. It resolves an exact asset path or a unique basename; duplicate basenames are not guessed. `![[image.png|500]]` sets a bounded width; `500x200` uses width only to preserve intrinsic aspect ratio. Missing/unsupported assets and embedded notes show an explicit `Image unavailable` placeholder.

**Choose notes → add images (optional) → preview → export PDF.** After choosing your note, use **Add image folder** to supply an explicit asset root, or **Add image files** when folder selection is unavailable. For `![Constitution](attachments/constitution.png)`, select the folder containing `attachments`, not `attachments` itself. Relative Markdown images require exact paths; only Obsidian embeds use unique-basename fallback. File matching is case-sensitive. Folder inputs use the browser's `webkitdirectory` selection, not arbitrary filesystem access. The selected folder's outer name is removed; nested paths are preserved. No Markdown notes are discovered or read from it.

Selection replaces the current image context; selecting a new note/sample clears it. Images remain in memory only (no autosave). Limits: **200 selected files, 10 MB per image, 40 MB total image bytes**. Choose a focused image folder rather than a huge vault. Unsupported files are counted and skipped without reading; unsafe paths, read errors, oversized images, or mismatched raster signatures reject the selection without replacing the previous context. Use PNG, JPEG/JPG, WebP, or GIF; GIF print output is a browser-selected frame, not animation.

**Architecture:** React handles file selection; `assets.js` handles bounded ingestion and exposes an immutable resolver (`validate`, `resolve`, `size`); `syntax.js` handles parsed Obsidian text and existing heading IDs; `renderMarkdown(source, { assets })` injects the explicit context. The asset resolver has no filesystem/network APIs. Images become raster-only data URLs that work with the existing CSP and PDF resource waiting; no object-URL lifetime or CSP relaxation is needed. Markdown parsing, sanitization, KaTeX, and rendering remain separate from asset ingestion.

**Images & privacy:** Notes and supplied images are processed locally, never uploaded. A `.md` file alone does **not** grant access to neighboring files. Absolute paths, backslashes, traversal segments (including encoded traversal), URL schemes, query/fragment paths, and ambiguous duplicate asset names are rejected. SVG/HTML/JS are not supported assets. Existing HTTP(S) and raster data-URL image support remains; remote Markdown images contact their hosts and need network access. Unavailable remote images are reported at export. CSP, iframe sandbox, sanitization, safe external-link attributes, and untrusted KaTeX remain unchanged.

**Deferred:** ZIP import (folder selection plus explicit files covers the current workflow), cross-note resolution, Markdown-note embeds, vault navigation/search, graph/backlinks, automatic note discovery, advanced block transclusion, Mermaid, Canvas, Dataview/plugins, TOC redesign, citations, and PDF-engine replacement.


**Offline:** In a production build the service worker precaches the *whole* release during its first install — shell, all JS/CSS chunks including the lazily loaded Markdown converter, and the bundled KaTeX fonts — so the Markdown converter works offline even if it was never opened online. Wait for the status strip to read “Offline ready” before disconnecting (the release id and a plain-language explanation are behind the strip’s “i” button). External images referenced from notes are never cached, and neither are your notes, videos, or attachments. The Vite development server is not an offline build. See [docs/PWA.md](docs/PWA.md).

A complete example is available at [`examples/academic-study-notes.md`](examples/academic-study-notes.md).

### Long-document navigation (Phase 4)

Documents with **at least four nonempty H1–H3 headings** automatically receive a compact **Contents** navigation after the title/optional subject and before the notes. Entries retain document order and existing numbering. Nested, unnumbered lists follow heading levels; a skipped level attaches to the nearest shallower heading without inventing a chapter. H4–H6, generated footnotes, and headings inside closed disclosure blocks are excluded. Short notes do not get a TOC.

Navigation uses the **actual sanitized heading IDs** already used by Markdown/Obsidian links, including duplicate-heading suffixes and Hindi text. Labels come from the rendered tree, not a separate Markdown parser; formatting becomes readable text, and KaTeX's accessible/visual representations are not duplicated. Native fragment links support keyboard navigation without scripts in the exported document. The app qualifies fragments as `about:srcdoc#…` in the live iframe to prevent its inherited base URL from navigating back to the parent app. A parent-side enhancement focuses and scrolls the destination; it does not enable scripts in imported notes or loosen CSP.

**Title and metadata:** a nonempty string frontmatter `title` takes precedence, followed by the existing title field, the Markdown filename, then “Study notes.” This also applies when editing/pasting frontmatter. A string `subject` is displayed below the title; all other YAML stays out of the print document. Metadata is escaped/inert. The iframe document's HTML `<title>` is set for printing. The browser/PDF driver controls PDF title metadata and the suggested filename; the app does not guarantee or post-process either.

**Print structure:** later top-level H1 headings start new pages after intervening content. The first H1, consecutive heading-only sections, H2/H3, and headings inside callouts do not force chapter breaks. Existing keep-with-content, widows/orphans, image/callout avoidance, and repeating table headers remain. Oversized elements can still split when the browser must fit them. The TOC can span pages rather than forcing an entire chapter subtree into an unbreakable box. There are no estimated TOC page numbers.

**Page numbers and running context:** CSS page-margin boxes provide a centered, subtle `counter(page)` on A4 and Letter in **Chrome/Edge 131+**. Use default/document margins and disable the browser's own headers/footers to avoid duplicate furniture. Unsupported engines may omit these margin boxes; use their native print headers/footers if page numbering is essential. There is no JavaScript pagination or fixed-position counter fallback. A document with exactly one eligible H1 repeats its text (bounded to 80 characters) as a fixed document-level header. Multiple H1 chapters get **no running header**: dynamic per-page chapter strings are not reliably supported by the current browser-print pipeline, and repeating the first chapter over unrelated chapters would be misleading. We deliberately omit total-page counts and custom PDF metadata.

Support references: [Chrome's page-margin documentation](https://developer.chrome.com/blog/print-margins) describes native margin boxes/counters from version 131 and the limitations of generated running strings; [MDN iframe documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) explains `srcdoc` base URLs. These are capability references, not a claim that PDF output was visually verified in this sandbox. Link preservation in PDFs depends on the browser engine/viewer.

**Performance and verification:** `renderStudyMarkdown()` returns content, headings, TOC, and frontmatter from one Markdown pipeline. Changing title/paper does not reparse notes. A deterministic 123,571-character fixture (`tests/fixtures/long-study-notes.js`) exercises 300 headings plus 60 each of tables, callouts, images, and math expressions. The Node test reports elapsed rendering time with a generous regression guard; actual interactive performance and pagination still need browser validation. Playwright covers iframe/standalone navigation, keyboard focus, duplicate/Hindi targets, metadata, print requests, and multipage A4/Letter PDFs. These assertions were initially blocked by missing Chromium; the Phase-7 run below subsequently exercised them with a test-only Chromium installation.

Phase 4 intentionally defers dynamic chapter headers, TOC page-number cross-references, a PDF-outline/bookmarks manager, search, arbitrary typography controls, PDF-engine replacement, and all other previously excluded features.

### Study / Revision profiles and tablet preview (Phase 5)

Choose **Study** (default) or **Revision** above the preview. The native radio group supports Tab/arrow keys, a visible radio indicator, and a text-weight/underline selected state—not color alone. A nearby **Export preview PDF** shortcut exports the same current document as the existing Export PDF action. “Jump to preview and output mode” avoids scrolling through the editor to reach these controls.

| Presentation | Study | Revision |
| --- | --- | --- |
| Body | 11.5 pt / 1.62 | 11 pt / 1.48 |
| Paragraph bottom gap | 9 px | 6 px |
| List item vertical margin | 2.5 px | 1.5 px |
| Callout padding | 8 × 13 px (9 px bottom) | 6 × 11 px |
| Table cell padding | 5 × 9 px | 3 × 7 px |

Study retains the existing book-like baseline. Revision reduces spacing moderately, not the content: table text stays 10.5 pt, code stays 9.5 pt, and images retain their aspect ratio. Both inherit the same local Latin/Devanagari font stack, heading hierarchy, math rendering, chapter breaks, and keep-with-content rules. No remote fonts or new typography controls are introduced.

**One pipeline:** the mode is an allowlisted body class (`study-mode` / `revision-mode`) applied by document composition. Changing it does not edit Markdown, reparse notes, resolve assets again, or change the TOC/content markup. The profile is session-only (no persistence); choosing another note keeps the selected profile. Preview readiness gates both export buttons so the selected profile's document is used for printing. Unknown profile values fall back to Study.

**Responsive workspace:** at widths of 960 px or below, settings/editor panels stack. Filenames, messages, headings and action rows wrap; native asset inputs are width-constrained. Important buttons, mode labels, settings and file-picker buttons have at least 44 px targets. The iframe height adapts to window height rather than assuming a full-screen tablet. The same rules apply to Samsung Galaxy Tab split-screen or any other narrow browser window—there are no device-specific dimensions.

**Readable preview, standard PDF:** the iframe reflows text at its natural reading size with smaller screen-only page gutters; it does not scale an entire A4 sheet down to tiny text. Oversized tables and display equations may scroll inside their own region rather than widening the page. Touch-device TOC links and disclosure summaries have comfortable targets. Screen-only reflow/touch rules do not affect printed density. A4 remains the default, Letter remains available, and both retain the existing 16/16/18 mm page margins. The print dialog remains the authority for final page breaks.

**Validation:** unit tests cover default/invalid modes, document-class safety, density rules, mixed-script/TOC/content preservation, fonts, pagination, and responsive CSS boundaries. `tests/browser/profiles.spec.js` covers **600, 720, 840, 960 and 1280 px**, local assets, long filenames, keyboard switching, scrolling/TOC navigation, error wrapping, print requests, and both profiles on A4/Letter. It measures Revision's main-content height against Study and saves actual screenshots and PDFs into ignored test output for visual comparison when run. These browser/screenshot/PDF scenarios were subsequently executed in the Phase-7 Chromium run below. Real Samsung hardware and interactive mobile print dialogs have not been tested.

Custom fonts/sizes/colors, user themes, search/bookmarks, nonstandard paper sizes, PDF-engine replacement, and all other excluded features remain deferred.

### Document preflight (Phase 6)

A compact **Preflight** panel beside the preview/export controls answers “Is there anything I should know before exporting?” It runs automatically for imports and deferred editor updates, and refreshes when assets change. While reading/editing is pending, previous results are explicitly marked as updating. Checks remain outside the printed document.

Statistics include approximate prose words, source characters (JavaScript string length, including markup/frontmatter), all H1–H6 headings plus H1/H2/H3 counts, tables, image references (including unresolved ones), callouts, math expressions, code blocks, and checklist items. Words exclude code, math, generated footnotes, and frontmatter; visible fallback text may contribute. The **Estimated PDF: ~N pages** figure is only a coarse content-weight heuristic using words, media, tables, headings and the selected Study/Revision and A4/Letter profile—not measured browser pagination. Actual line wrapping, fonts, chapter breaks and images can change the result substantially.

**Severity and export:**
- **Info:** cross-note Wikilinks remain readable text because a single note does not contain its vault; remote image availability is unverified.
- **Warning:** unresolved images/references, unsupported note/advanced embeds, heading structure issues, potentially difficult tables, large images, missing alt text, KaTeX failures, or a large document. Export is still available.
- **Error:** the existing renderer failed to produce a document. Both export controls and the print handler remain disabled until it renders again. No new advisory threshold is a blocking limit. Existing file/asset ingestion limits and non-destructive import errors remain unchanged.

Findings are grouped by check, with at most three example labels per group and a short recommendation. The warning count is the number of **warning groups**, not individual affected resources. Invalid or traversing paths are redacted, valid local paths show only the basename, and remote/data URLs are never printed into the report. React displays labels as escaped text.

**Checks and current thresholds (strictly greater than unless noted):**
- Heading checks: first heading below H1, upward depth jumps of more than one level, empty headings, and H5/H6 nesting. These are optional study-outline recommendations, not academic rules.
- Tables: more than **7 columns**, cells longer than **500 characters**, or any empty header cell. Nothing is automatically shrunk or rewritten.
- Images: unresolved/missing, unsupported formats, unsafe paths, and missing alt text. Supplied raster headers retain advisory dimensions/byte counts; warnings appear above **5 MiB**, **6,000 px on either side**, or **24 megapixels**. Unknown dimensions stay unknown; high-resolution images are not rejected by preflight. Existing ingestion caps still apply.
- Size: source above **1 MiB** (well below the existing 5 MiB import cap), more than **300 headings**, **100 image references**, **200 math expressions**, or **25,000 rendered content-tree nodes**. These suggest smaller topic exports only if the browser struggles.
- Math failures reuse **rehype-katex's existing diagnostic messages**, not a new formula parser. Unmatched delimiters that parse as ordinary text are not diagnosed as math failures.
- Unsupported Obsidian note/advanced/block embeds reuse Phase-3 syntax recognition. Supported tags, callouts, wikilinks, heading links and block links are not mislabeled as unsupported. Preflight is not an exhaustive plugin/Obsidian validator.

**Architecture and privacy:** `syntax.js` records existing resolution outcomes, `preflightFacts.js` extracts facts from the sanitized tree and existing KaTeX diagnostics, and the pure `analyzePreflight()` in `preflight.js` returns statistics/findings/estimates. There is no second Markdown parse. Mode/paper changes reuse the cached facts. `imageMetadata.js` reads bounded headers from already supplied bytes, never decodes/executes files or accesses the filesystem. Preflight performs **no fetches**. Remote-image reachability, corrupt raster decoding, and final pagination cannot be confirmed by this analysis; the existing preview/export resource-loading checks remain responsible for load failures. CSP, sanitizer, sandbox, KaTeX trust settings and asset validation are unchanged.

**Validation:** unit tests cover statistics, threshold boundaries, resolution outcomes, heading/table/image/math checks, metadata/path security, determinism, and error-only export gating. The shared 123,571-character fixture contains 300 headings and 60 each of tables/images/callouts/math; its test records rendering/extraction and pure analysis separately, without a hardware-dependent speed promise. Playwright covers automatic import checks, editing/profile refresh, missing images/references, asset refresh, warning-tolerant export and existing rejected-file handling. These browser assertions were subsequently executed in the Phase-7 Chromium run below. The exceptional renderer-failure state is covered by pure-analysis and export-gating unit tests, not an artificial production fault-injection UI.

Deferred: network resource probes, exhaustive plugin diagnostics, exact PDF pagination, automatic repair/rewriting, landscape tables, a new PDF engine, and all other excluded features.

### Browser-print hardening (Phase 7)

The production engine remains **HTML → browser print → Save as PDF**, with no server-side or test-runner PDF service.

**Deterministic export transaction:**
1. Each preview gets a non-content generation marker. Only the matching parsed iframe document is marked ready. Immediate input intent is tracked separately from React's committed/deferred rendering, including nonvisual edits.
2. `printNotes()` captures that document, opens all disclosures, requests eager image loading and flushes layout so newly visible fonts/resources start loading.
3. It waits for `document.fonts.ready` and image load/decode, bounded by the existing **15-second resource deadline**. Settled image failures are counted and allow printing with a warning; stalled load/decode or fonts fail with an actionable timeout. Font failures use safe browser fallback rather than requiring remote fonts.
4. It verifies document identity/current intent again immediately before print. Edits or unmounts abort pending preparation; detached/replaced frames cannot print stale content. Both export actions share an in-flight lock.
5. It invokes print and restores original disclosure states, image loading attributes and document title on success, cancellation or failure. Chromium's blocking lifecycle is supported; an observed asynchronous `beforeprint` waits for `afterprint`, with a **120-second fallback deadline** rather than an indefinitely stuck UI. Engines with different/unobservable lifecycles are not guaranteed. Browser dialogs that block JavaScript control their own duration.

**Safe title:** the existing frontmatter → title field → filename → default precedence is preserved. Only while printing, the iframe's title is normalized to a suggested file-safe title (illegal/path/control characters removed, whitespace normalized, Windows reserved names handled, at most 100 Unicode characters). The user's Markdown, visible document metadata and title field are not rewritten. PDF metadata and the Save As filename remain browser-controlled: no parent-tab title hacks or forced download filename are used. Headless test PDFs used the safe title; interactive Save As behavior has not been verified.

**Geometry:** A4 stays 210 × 297 mm; Letter stays 215.9 × 279.4 mm. Margins remain 16 mm top/left/right and 18 mm bottom, giving **178 × 263 mm** and **183.9 × 245.4 mm** content areas respectively. The existing 210 mm image-height cap leaves room inside either paper's printable height. Print tables use bounded fixed layout and wrapping without reducing font size; rows prefer staying intact and `thead` repeats. Code prefers staying together when it fits, but long code can fragment and wrap. Display math loses screen scrollports and can wrap at KaTeX's top-level operator groups. **Indivisible oversized matrices/fractions cannot be guaranteed to fit**; split such expressions manually. No JavaScript pagination or automatic scaling is added.

Chapter rules and TOC hierarchy remain unchanged. Native margin counters are checked in Chromium 153; page 1 is numbered. The sole-H1 running header is bounded/ellipsized; multi-H1 documents intentionally have no running header. Necessary borders/text remain readable without background printing, while `print-color-adjust: exact` requests backgrounds. Keep default/document print margins, scale 100%, the intended A4/Letter paper, and disable the browser's own headers/footers to avoid competing page furniture. Other browsers/drivers can fragment differently, omit counters or backgrounds, or choose different metadata.

**Executed validation:** the standard Playwright CDN download still failed in this sandbox. A test-only portable Chromium 153 (`@sparticuz/chromium`, installed outside the repository) plus bundled runtime libraries made actual browser/PDF tests possible. Local test fonts included DejaVu and Noto Serif Devanagari; nothing was added to the production font strategy. The focused Markdown/navigation/preflight/profile/offline/print suite passed **34/34** tests, including 600/720/840/960/1280 px layouts, stalled/broken images, queued edits during preparation, print exceptions and missing frames. Unit/security coverage includes font/image/lifecycle deadlines, fallback, cleanup, filename sanitization and fragmentation.

The large mixed fixture generated real PDFs in both modes/papers. `tests/inspect-print-pdfs.py` (optional **PyMuPDF** test dependency, never production) verifies every page counter, appropriate header presence/absence, horizontal text bounds, image bounds, nonblank pages, repeated table headers, all 100 long-table rows, disclosure contents and Hindi text. Representative rendered pages were visually inspected; this is not a guarantee for every possible note or browser. A separate multipage single-H1 PDF was checked with backgrounds disabled.

The test saves timing JSON beside the PDFs: independent Node rendering/preflight timings, browser import-to-ready time, actual resource-readiness time and total preparation before invoking print. These are observations, not speed promises; warm embedded images are much faster than remote images. No extra production parse is introduced.

**Remaining limitations revealed by testing:** a broader whole-app browser run reached an unrelated video-conversion timeout and was stopped; the entire browser suite is **not claimed green**. The original near-5-MiB single-paragraph/soft-break fixture also showed severe parsing cost (over 120 seconds in the browser; a Node probe was stopped at 30 seconds). No lower document cap or parser rewrite was introduced. The byte-limit validation test now isolates ingestion with inert padding, while the separate 300-heading fixtures test real long-document layout. Very large individual paragraphs remain a performance limitation; splitting notes into topics/paragraphs is recommended. The 15-second export deadline covers resources **after rendering**, not synchronous Markdown parsing.

To reproduce with an installed Chromium:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npx playwright test \
  tests/browser/markdown.spec.js tests/browser/profiles.spec.js \
  tests/browser/preflight.spec.js tests/browser/offline.spec.js \
  tests/browser/print-quality.spec.js --workers=2
# Optional PDF-content inspection after those tests:
python -m pip install pymupdf
python tests/inspect-print-pdfs.py
```

PDFs/screenshots/timing JSON stay in ignored `test-results/`; browser binaries, runtime libraries, and inspection packages are not repository dependencies. Dynamic headers, exact page-count prediction, TOC page numbers, PDF-engine replacement and other excluded features remain deferred.

### Tests

```bash
npm test                    # Unit tests: video engine, fixtures, Markdown, PWA (precache inventory, service worker, client, icons)
npx playwright install chromium
npm run test:e2e             # Fresh production build + Chromium browser checks
npm run build               # Production build (also generates dist/sw.js and finalises dist/manifest.json)
```

Use Node.js 20+ for the browser-test tooling. The browser suite builds the app and starts an isolated preview server on port 4173; keep that port free. It covers video uploads, drag/drop, validation, queue management, FPS, progress, real PDF downloads (header/page-count/page-size verification), cancellation, corrupt-file failures, limit guards, mobile layout, themes, Markdown uploads, live editing, print requests, multi-page PDFs, image timeouts, and the PWA: first-use offline Markdown with math fonts, offline video workspace, install-prompt handling (synthetic `beforeinstallprompt` events, not an OS install), Chromium manifest/installability checks, registration failures, and real multi-tab service-worker updates (`tests/browser/offline.spec.js`, `pwa.spec.js`, `pwa-update.spec.js`).

For an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when running the browser tests.

**E2E video fixtures:** no binary fixtures are committed. Tests encode small MP4s inside Chromium at runtime (WebCodecs VP9/AVC + a minimal MP4 muxer for exact durations, MP4 MediaRecorder as fallback) and verify each fixture by real decoding before use. The muxer's byte layout is additionally validated in Node (`tests/mp4-muxer.test.js`).

## 🚀 Setup Instructions

### Installation

```bash
npm install
npm run dev
```

Browser mein `http://localhost:3000` kholo

## 📱 PWA Installation & Offline

Full details (architecture, deployment headers, sub-directory hosting, release checklist): **[docs/PWA.md](docs/PWA.md)**.

### Desktop (Chrome/Edge):
1. Deployed (HTTPS) app kholo
2. *App status* panel mein **Install PDF Lab** button dikhe to click karo (button tabhi aata hai jab browser install allow karta hai)
3. Ya address bar ka install icon / browser menu → *Install PDF Lab* (Edge: *Apps → Install this site as an app*)

### Mobile (Android, Chrome):
1. App kholo
2. Menu (⋮) → *Add to Home screen* ya *Install app*

### iPhone / iPad (Safari):
1. Safari mein app kholo
2. *Share* → *Add to Home Screen* (iOS 16.4+; Safari kabhi automatic install prompt nahi deta)

### Mac (Safari):
*File → Add to Dock*. Firefox desktop web apps install nahi karta — site normal tarah chalti hai.

### Offline kaise kaam karta hai
- Pehli online visit pe service worker poora release download karke verify karta hai (SHA-256). Strip “Offline ready” dikhaye tab hi offline promise hai — “Preparing offline…” ya “Offline unavailable” ka matlab abhi nahi (details “i” button mein).
- Offline cache sirf app files rakhta hai: videos, frames, Markdown notes, attached images, exported PDFs kabhi save nahi hote; unsaved notes tab close hone pe chale jaate hain. Notes ke remote images ko internet chahiye.
- Updates background mein download hote hain aur **sab** PDF Lab tabs/app windows band karke dobara kholne ke baad hi lagte hain. App kabhi khud reload nahi karta.
- Service worker sirf production build (`npm run build`) mein, secure origin (HTTPS ya `localhost`) pe register hota hai. Deploy karte waqt poora `dist/` (generated `dist/sw.js` samet) ek saath publish karo — `pwa/sw.template.js` source template hai, deploy nahi hota.

## 📖 Kaise Use Kare

1. **Multiple videos select karo** (max 20)
2. **FPS select karo** (1-6)
3. **Paper size chuno** (A4 / US Letter) aur labels on/off karo
4. **Videos list check karo** - unwanted videos remove kar sakte ho
5. **"Generate PDF" click karo** ( Cancel anytime with **Cancel conversion**)
6. **Progress dekho** - video-by-video aur frame-by-frame
7. **PDF download karo** - sabhi videos ke frames ek PDF mein!

## 🛠️ Tech Stack

- **Frontend:** React + Vite
- **Video Processing:** HTML5 Video/Canvas APIs (no backend, no FFmpeg)
- **Video PDF Generation:** jsPDF
- **Markdown Rendering:** unified, remark, rehype, KaTeX, and highlight.js
- **Markdown PDF Generation:** Native browser print engine
- **PWA:** Service Worker + Web Manifest

## 💡 Tips

- **Chhoti videos se start karo** testing ke liye
- **1-2 FPS kaafi hai** most cases mein
- **Video order matter karta hai** - queue order hi PDF order hai
- **Remove button use karo** agar galti se koi video select ho gayi
- **Same video dobara add karne pe** duplicate skip ho jayega with a notice

## 🌐 Browser Requirements & Known Limitations

- **Chromium/Chrome/Edge (primary target):** full support — tested via Playwright, including first-use offline Markdown + math fonts, manifest installability, and real service-worker updates. Installation itself was exercised with synthetic `beforeinstallprompt` events, not through the operating system.
- **Firefox:** expected to work (standard Video/Canvas APIs, `seeked`/`loadedmetadata`); not covered by automated browser tests in this repo.
- **Safari:** expected to work for typical H.264 MP4s; `toDataURL` JPEG and iframe sandboxing are supported, but Safari-specific seek quirks and Add-to-Home-Screen/Add-to-Dock behaviour are **not** verified here (Safari never fires `beforeinstallprompt`; the in-app help explains the manual route).
- **Mobile Chromium:** layout is responsive and verified at 390 px; heavy conversions are memory-constrained on phones — prefer short clips and low FPS.
- Very long videos, exotic codecs (HEVC/VP9-in-MP4 playback varies by browser), and DRM-protected files are outside the supported envelope and fail with explicit errors.
- Non-Latin filenames in frame labels degrade gracefully (`?` placeholders) because PDFs use built-in Latin-1 fonts.
- The service worker caches exactly the files of the shipped release (shell, scripts, styles, KaTeX fonts, manifest, icons) — never your uploaded videos or frames, Markdown notes, attached or remote images, or exported PDFs.

## 🔒 Privacy

- ✅ Tumhari videos **kabhi server pe upload nahi hoti**
- ✅ Sab processing **browser mein hoti hai**
- ✅ **Zero cloud storage**
- ✅ **Complete privacy**

Enjoy! 🎉
