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
- ✅ **PWA Support** - App ki tarah install karo
- ✅ **Offline Support** - Ek baar load hone ke baad offline kaam karega
- ✅ **Progress Tracking** - Real-time progress bar with stats
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

Switch to **Markdown to PDF** to turn a `.md` or `.markdown` file into an academic study-notes PDF. The existing video converter remains available in its own mode.

1. Upload or drag in **one UTF-8 Markdown file (up to 1 MB)**, paste Markdown into the editor, or choose **Try a sample**.
2. Edit your notes and check the live, light-paper preview. Choose a document title and **A4** or **US Letter** paper.
3. Click **Export PDF**. In your browser’s print dialog, select **Save as PDF**. Keep the selected paper size and disable browser headers/footers for a clean result. Enable background graphics if your browser does not preserve the theme’s shading by default.

PDF export uses the browser’s print engine rather than screenshots: text stays selectable, links remain clickable in supporting browsers, and long notes paginate. The preview is continuous; use print preview to check final page breaks. A browser with printing/PDF support is required; mobile print/share options vary.

### Supported Markdown

- CommonMark headings (all six levels), paragraphs, emphasis, strong text, blockquotes, rules, nested ordered/unordered lists, links, images, and inline/fenced code.
- GitHub-flavored tables, alignment, strikethrough, autolinks, and task lists.
- Footnotes, heading anchors, and syntax highlighting for common code languages (unknown languages remain readable plain code).
- Inline math with `$…$` and display math with `$$…$$`, rendered using bundled **KaTeX** fonts. Use fenced blocks for literal code. KaTeX supports a subset of LaTeX, not an entire LaTeX document.
- Safe embedded HTML. Scripts, event handlers, iframes, unsafe URLs, and arbitrary styles are removed. Preview content is isolated in a sandboxed document.

The **Academic study notes** theme includes serif body text, navy section headings, warm blockquotes for key takeaways, shaded tables, highlighted code, generous print margins, and pagination rules. It stays print-friendly even when the application uses dark mode.

**Images & privacy:** Notes are read locally and never uploaded. Images must use absolute HTTP(S) URLs or embedded PNG/JPEG/GIF/WebP base64 data URLs; relative paths to neighboring files cannot be resolved from a dropped Markdown file. Remote images contact their hosts and require network access (HTTPS is recommended). Unavailable images are reported at export. Mermaid diagrams, MDX, citation processors, and other nonstandard Markdown plugins are not supported.

**Offline:** In a production build, visit both converter modes online first so their assets can be cached. Only previously used assets/fonts are available offline; external images are not cached by the app. The Vite development server is not an offline build.

A complete example is available at [`examples/academic-study-notes.md`](examples/academic-study-notes.md).

### Tests

```bash
npm test                    # Unit tests: video engine, fixtures, Markdown, service worker
npx playwright install chromium
npm run test:e2e             # Fresh production build + Chromium browser checks
npm run build               # Production build
```

Use Node.js 20+ for the browser-test tooling. The browser suite builds the app and starts an isolated preview server on port 4173; keep that port free. It covers video uploads, drag/drop, validation, queue management, FPS, progress, real PDF downloads (header/page-count/page-size verification), cancellation, corrupt-file failures, limit guards, mobile layout, themes, Markdown uploads, live editing, print requests, multi-page PDFs, image timeouts, and cached offline use.

For an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when running the browser tests.

**E2E video fixtures:** no binary fixtures are committed. Tests encode small MP4s inside Chromium at runtime (WebCodecs VP9/AVC + a minimal MP4 muxer for exact durations, MP4 MediaRecorder as fallback) and verify each fixture by real decoding before use. The muxer's byte layout is additionally validated in Node (`tests/mp4-muxer.test.js`).

## 🚀 Setup Instructions

### Installation

```bash
npm install
npm run dev
```

Browser mein `http://localhost:3000` kholo

## 📱 PWA Installation

### Desktop (Chrome/Edge):
1. Browser mein app kholo
2. Address bar mein "Install" icon pe click karo
3. Ya Settings → Install app

### Mobile (Android):
1. Browser mein app kholo
2. Menu → "Add to Home Screen"
3. App icon home screen pe aa jayega

### Mobile (iOS):
1. Safari mein app kholo
2. Share button → "Add to Home Screen"

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

- **Chromium/Chrome/Edge (primary target):** full support — tested via Playwright, including offline PWA.
- **Firefox:** expected to work (standard Video/Canvas APIs, `seeked`/`loadedmetadata`); not covered by automated browser tests in this repo.
- **Safari:** expected to work for typical H.264 MP4s; `toDataURL` JPEG and iframe sandboxing are supported, but Safari-specific seek quirks and PWA install behavior are **not** verified here.
- **Mobile Chromium:** layout is responsive and verified at 390 px; heavy conversions are memory-constrained on phones — prefer short clips and low FPS.
- Very long videos, exotic codecs (HEVC/VP9-in-MP4 playback varies by browser), and DRM-protected files are outside the supported envelope and fail with explicit errors.
- Non-Latin filenames in frame labels degrade gracefully (`?` placeholders) because PDFs use built-in Latin-1 fonts.
- The service worker caches the app shell and production assets only — never your uploaded videos, and never remote Markdown images.

## 🔒 Privacy

- ✅ Tumhari videos **kabhi server pe upload nahi hoti**
- ✅ Sab processing **browser mein hoti hai**
- ✅ **Zero cloud storage**
- ✅ **Complete privacy**

Enjoy! 🎉
