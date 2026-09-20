# 🎬 PDF Lab — Video & Markdown to PDF

**Video Frames • Markdown Study Notes • 100% Browser-Based • PWA Support**

Ek saath 20 videos ke frames ko ek single PDF mein merge karo!

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
npm test                    # Markdown rendering, sanitization, and service worker
npx playwright install chromium
npm run test:e2e             # Fresh production build + Chromium browser checks
npm run build               # Production build
```

Use Node.js 20+ for the browser-test tooling. The browser suite builds the app and starts an isolated preview server on port 4173; keep that port free. It covers uploads, live editing, print requests, multi-page PDFs, image timeouts, mobile layout, and cached offline use.

For an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when running the browser tests.

## ✨ Video Features

- ✅ **Multiple Videos Support** - Up to 20 videos ek saath upload karo
- ✅ **Single Merged PDF** - Sabhi videos ke frames ek PDF mein
- ✅ **PWA Support** - App ki tarah install karo
- ✅ **Offline Support** - Ek baar load hone ke baad offline kaam karega
- ✅ **Progress Tracking** - Real-time progress bar with stats
- ✅ **Video Info** - Har frame pe video name aur timestamp
- ✅ **Remove Videos** - Upload ke baad bhi videos remove kar sakte ho

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
3. **Videos list check karo** - unwanted videos remove kar sakte ho
4. **"Merge & Generate PDF" click karo**
5. **Progress dekho** - video-by-video aur frame-by-frame
6. **PDF download karo** - sabhi videos ke frames ek PDF mein!

## 🎯 Features Details

### Multiple Videos
- Maximum 20 videos ek saath
- Total size limit: Browser memory dependent
- Har video ka naam aur timestamp PDF mein show hoga

### Progress Tracking
- Current video number
- Total frames vs processed frames
- Percentage completion
- Real-time progress bar

### PWA Benefits
- Desktop/mobile pe install karo
- Offline kaam karega
- Fast loading
- Native app jaisa experience

## 🛠️ Tech Stack

- **Frontend:** React + Vite
- **Video Processing:** HTML5 Canvas API
- **Video PDF Generation:** jsPDF
- **Markdown Rendering:** unified, remark, rehype, KaTeX, and highlight.js
- **Markdown PDF Generation:** Native browser print engine
- **PWA:** Service Worker + Web Manifest

## 💡 Tips

- **Chhoti videos se start karo** testing ke liye
- **1-2 FPS kaafi hai** most cases mein
- **Video order matter karta hai** - jo pehle select karoge wo pehle PDF mein aayega
- **Remove button use karo** agar galti se koi video select ho gayi
- **Progress bar dekho** kitna time lagega estimate karne ke liye

## 🔒 Privacy

- ✅ Tumhari videos **kabhi server pe upload nahi hoti**
- ✅ Sab processing **browser mein hoti hai**
- ✅ **Zero cloud storage**
- ✅ **Complete privacy**

Enjoy! 🎉