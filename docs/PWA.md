# PDF Lab as a Progressive Web App

PDF Lab (`PDF Lab — Video & Markdown to PDF`) can be installed from the browser
and, once its offline files are ready, works without a network connection:
video frame extraction, the Markdown editor with KaTeX math, and PDF export all
run locally. This document describes how that is built, what it deliberately
does **not** do, how to deploy it safely, and how to verify a release.

Everything described here lives in:

| Path | Role |
| --- | --- |
| `public/manifest.json` | Web app manifest (identity, icons, colours). `id` is finalised at build time. |
| `public/icons/` | Generated PNG/SVG icons referenced by the manifest and `index.html`. |
| `branding/pdf-lab-icon.png` | 1024 × 1024 design master for the icon (kept out of `public/` and the build). |
| `scripts/render-icons.mjs`, `scripts/lib/png.js` | Pure-Node renderer: resamples the master into every icon size (`npm run icons`); shared PNG codec. |
| `pwa/sw.template.js` | Service worker **source template**. Never deploy it as is. |
| `pwa/precache.js` | Build-time inventory: content hashes, release version, worker rendering, manifest id. |
| `pwa/vitePlugin.js` | Vite plugin that writes `dist/sw.js` and finalises `dist/manifest.json` on every production build. |
| `src/pwa/` | Page-side code: registration/update client, install prompt controller, `usePwa` hook, `PwaPanel` UI, theme colour sync. |
| `tests/pwa-*.test.js`, `tests/service-worker.test.js` | Node tests (inventory, worker behaviour, client state machine, icons). |
| `tests/browser/offline.spec.js`, `pwa.spec.js`, `pwa-update.spec.js` | Chromium tests against the real production build. |

## Sources this design follows

The implementation was checked against the current guidance on these pages
(read September 2026):

- MDN, *Making PWAs installable* — Chromium installability criteria (`name`/`short_name`, 192 **and** 512 px icons, `start_url`, `display`, HTTPS or `localhost`), Safari/iOS and Firefox behaviour, `beforeinstallprompt` being Chromium-only.
  <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable>
- MDN, manifest `id` reference — `id` is resolved against the origin of `start_url`; a stable, root-relative id keeps an installed app updatable.
  <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id>
- web.dev, *Adaptive icon support in PWAs with maskable icons* — safe zone is the centred circle with radius 40 % of the icon width; maskable icons need an opaque background; do not combine `"any maskable"` in one entry.
  <https://web.dev/articles/maskable-icon>
- web.dev, *The service worker lifecycle* — a failed install discards the new worker and keeps the current one; a new worker waits until the old one controls zero clients (a refresh never releases it); avoid `skipWaiting()` when you need a single consistent version; delete old caches in `activate`; call `registration.update()` from long-lived pages; never rename the worker script.
  <https://web.dev/articles/service-worker-lifecycle>
- MDN `beforeinstallprompt`, web.dev *Installation prompt* and *How to provide your own in-app install experience* — `preventDefault()`, stash the event, reveal a button, call `prompt()` from a user gesture, read `userChoice`, the event is single-use, listen for `appinstalled`, detect an installed window with `matchMedia('(display-mode: standalone)')`/`navigator.standalone`.
  <https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event>,
  <https://web.dev/learn/pwa/installation-prompt>, <https://web.dev/articles/customize-install>

## Identity and icons

- `name`: `PDF Lab — Video & Markdown to PDF`, `short_name`: `PDF Lab`, `lang: en`, `display: standalone`, no `orientation` member (phones and tablets may rotate freely; the layout is responsive).
- `theme_color` / `background_color`: `#0e2442` (the measured background colour of the icon master) so the splash screen and title bar match the icon exactly. The page's `<meta name="theme-color">` follows the light/dark app theme at runtime (`src/pwa/themeColor.js`).
- `start_url` and `scope` are `./`, relative to the manifest, so a build with a different Vite `base` (see *Sub-directory hosting*) keeps working without editing the manifest.
- `id` is rewritten at build time by the plugin: for an absolute base it becomes that base (`/` for the default root deployment, `/lab/` for `base: '/lab/'`); for a relative base (`./`) the member is omitted and browsers fall back to the resolved `start_url`. The previous manifest had no `id`, so browsers used the resolved `start_url` (`/`) — the new explicit `id: "/"` is the **same identity**, and existing installations update in place rather than becoming a second app.
- Icons (all real PNGs resampled from the single master `branding/pdf-lab-icon.png`; `tests/pwa-icons.test.js` re-renders them from the master and compares bytes, then verifies dimensions, opacity, safe zone, colours, and manifest references):

  | File | Size | Purpose |
  | --- | --- | --- |
  | `icons/icon-192.png`, `icons/icon-512.png` | 192², 512² | manifest `purpose: "any"` |
  | `icons/icon-512-maskable.png` | 512² | manifest `purpose: "maskable"`, artwork inside the centred safe circle (radius 40 % of width), opaque navy padding |
  | `icons/apple-touch-icon.png` | 180² | `<link rel="apple-touch-icon">` for iOS/iPadOS home screens |
  | `icons/favicon-32.png`, `icons/favicon-16.png` | 32², 16² | browser tab icons (cropped in a little further so the play symbol still reads) |

  The artwork is a light folded document with an amber play symbol on an opaque deep-navy background — no lettering or emoji, so it stays legible at 16 px and under any mask shape. `"any"` and `"maskable"` are separate entries; the maskable file is not used as the regular icon (its extra padding would look small in launchers that do not mask).
- The in-app header shows the same icon and name, and `index.html` carries matching `<title>`, `description`, `application-name`, `apple-mobile-web-app-title`, and icon links.

The master itself is one generated image made from the design brief above (light folded document, amber play symbol, solid deep navy, no lettering); it was checked for a uniform opaque background and an artwork radius that fits the maskable safe zone after a 0.916× shrink. To change the icon: replace `branding/pdf-lab-icon.png` (square, solid background, artwork centred), run `npm run icons`, run `npm test`, and update the manifest colours if the background changed (the test reports the mismatch).

## Offline architecture

### What the build produces

`vite build` (through `pwa/vitePlugin.js`, which runs on every production build, including a plain `npx vite build`) does two things after Vite writes `dist/`:

1. Finalises `dist/manifest.json` (`id`, see above).
2. Creates a **precache inventory** of *every* file in `dist/` except `sw.js`, source maps, and dot-files: relative URL, SHA-256 hash, size, and whether the file is an immutable hashed asset (`assets/*-<hash>.*`). The inventory is sorted; the **release version** is the first 16 hex characters of the SHA-256 digest over all `url + hash` pairs. Two builds of identical sources therefore produce a byte-identical `dist/sw.js`, and any content change anywhere in the release changes the version. The worker is written to `dist/sw.js` from `pwa/sw.template.js` by replacing the single `__PDF_LAB_BUILD__` placeholder with that inventory.

The inventory covers the HTML shell, every JS/CSS chunk (including the lazily loaded Markdown converter chunks and their vendor code), the bundled KaTeX fonts (`woff2`/`woff`/`ttf`), the manifest, and all icons — the *whole shipped app*. `tests/pwa-precache.test.js` runs a real build into a temporary directory and asserts that every file in the output is listed, that no non-shipped file is listed, and that the version changes when content changes and stays identical otherwise.

The **built `dist/sw.js` is the deployable worker**. The template in `pwa/` is not in `public/`, so it can never be published by accident; if it were served, it would have no inventory and could not work offline.

### Install: whole release or nothing

On `install` the worker opens the cache `pdf-lab::<scope path>::<version>` and downloads every inventory entry (six at a time). Each download is verified: a non-2xx response or a SHA-256 mismatch aborts the install. Unhashed files (`index.html`, manifest, icons) are fetched with `cache: 'no-cache'` so a stale HTTP-cached shell cannot be paired with a newer release's assets; hashed assets may come from the HTTP cache because their names encode their content. Verified bytes are stored as clean `Response` objects, which also avoids the "redirected response" problem on hosts that redirect `/index.html` to `/`.

If anything fails — a file missing after a partial deployment, storage quota exhausted, `caches.open` rejected in a private-browsing mode — the worker deletes its own cache and lets the install fail. The browser then discards this worker and **keeps the previous working release**; nothing is ever half-replaced. Online use is unaffected because the page never depends on the worker for anything.

### Fetch: strict boundaries

The worker answers only:

- same-origin `GET` requests whose path is in the inventory — cache-first with a network fallback that self-heals the cache entry when it is missing;
- in-scope navigations for non-file paths — served from the precached `index.html` shell (single-page app routing).

Everything else passes straight through to the network and is **never cached**: uploaded videos and the frames extracted from them, Markdown documents and attached images (they live only in memory), remote images referenced from notes, any API call, cross-origin requests, Vite dev modules, source maps, and arbitrary URLs. There is no runtime caching strategy and therefore no way for user content to end up in Cache Storage. If the network is unavailable and a request is not part of the release, the request fails exactly as it would without a worker — external images in notes need a connection.

### Activate: scoped cleanup

On `activate` the worker deletes caches whose name starts with `pdf-lab::<its own scope path>::` and whose version differs from its own, plus the pre-2025 `video-to-pdf-*` caches — but only when running at the root scope, which is where that old worker lived. Caches of other apps on the same origin, or of a PDF Lab deployment under a different path, are never touched. It then calls `clients.claim()` so a first-time install can report readiness without a reload; existing pages are **not** reloaded.

### Readiness is measured, not assumed

The page never announces "works offline" merely because a worker is registered. `src/pwa/serviceWorkerClient.js` asks the *controlling* worker for a status report (`postMessage({type:'pdf-lab:status'})`, answered over a `MessageChannel`). The worker counts its inventory entries in its cache and replies `complete: true/false` together with its version. Only `complete: true` from an active controller produces `Offline ready`. The strip shows a short state; the "i" button next to it opens the full explanation (including the release id), and the `.pwa-panel` element carries `data-phase` and `data-release` attributes for tests and support. Other outcomes are reported truthfully:

| Panel text | Meaning |
| --- | --- |
| `Preparing offline…` | Registration or first install in progress. |
| `Offline ready` | Active worker confirmed every file of its release is cached (release id in the info tip and `data-release`). |
| `Offline incomplete` | The report came back incomplete (for example after storage eviction). When online the client first asks the worker once to repair (`pdf-lab:repair`, which refetches and verifies the missing files) and only shows this text if that fails. |
| `Offline unavailable` (`data-phase="failed"`; the tip says "Offline setup failed … still works online") | Registration rejected (404, wrong MIME type, blocked by policy) or the install was discarded. |
| `Offline after restart` | An old worker that does not speak the status protocol (the previous `video-to-pdf-` worker) is still in control. |
| `Offline use is available in production builds only.` / `… needs a secure (HTTPS) connection.` / `… is not supported by this browser.` | The worker is not registered at all — see the next section. |

### When the worker is registered

`serviceWorkerAvailability()` enables registration only when all of these hold: `import.meta.env.PROD` (never in `vite dev`, whose modules are not a deployable release), `window.isSecureContext` (HTTPS or `localhost`), and `navigator.serviceWorker` exists. The registration URL is `${import.meta.env.BASE_URL}sw.js` with `scope: BASE_URL`, so a sub-directory build registers in its own directory. Storage or registration errors are caught and shown in the panel; they never break the converters.

## Installation

- **Chromium browsers (Chrome, Edge, Brave, Opera, Samsung Internet, Android WebView-based browsers):** when the browser decides the app is installable it fires `beforeinstallprompt`. The app calls `preventDefault()`, keeps the event, and only then shows the **Install PDF Lab** button. The prompt is triggered exclusively by clicking that button; the result (`accepted`/`dismissed`), errors (a prompt that throws, or a second call on the single-use event), and the `appinstalled` event are all handled and reflected in the panel. The button is never shown inside a standalone/installed window (`display-mode: standalone`/`fullscreen`/`minimal-ui`/`window-controls-overlay`, or `navigator.standalone` on iOS), and it disappears after installation.
- **Manual routes** (shown in the strip’s "i" tip, *Offline use & installing*): the address-bar install icon or *Install PDF Lab* in the Chrome/Edge menu; Safari on macOS 14+ *File → Add to Dock*; iPhone/iPad Safari *Share → Add to Home Screen* (iOS/iPadOS 16.4+; Apple platforms never fire `beforeinstallprompt`); Firefox desktop has no install feature and Firefox for Android uses *Add to Home screen*. These are documented from the sources above; **they were not exercised on real Android or iOS devices as part of this work.**
- An installed app is identified by the manifest `id`; deploying new builds updates the installed app rather than creating a new one.

## Safe updates (no lost work)

Design rules, verified by `tests/browser/pwa-update.spec.js` against real Chromium:

1. The worker never calls `skipWaiting()` and never posts a "reload" message; the page never calls `location.reload()`. A new release installs its complete cache beside the current one and then **waits**.
2. While the previous worker still controls at least one tab or installed window, that release keeps serving all of them. Closing one tab (or refreshing) changes nothing; only after **every** PDF Lab tab and app window has closed does the new worker activate, delete the previous cache, and serve the next launch. This is what browsers do by default; the app simply does not override it.
3. Every open tab shows an accessible (`aria-live="polite"`) notice as soon as a new release is waiting: *Update ready. … save or export your work, close all PDF Lab tabs and installed app windows, then reopen it. Nothing reloads on its own.* Unsaved Markdown, queued videos, and running conversions are untouched.
4. Update checks happen on startup (`registration.update()` after registration) and when the tab returns to the foreground (`visibilitychange` → `visible`), throttled to one check per five minutes; the browser adds its own checks on navigation. There is no polling.
5. If the new release fails to install (missing file, storage problem), the panel says *A newer version could not be downloaded; you are still on the current one*, the current release keeps working — offline too — and the next start retries.

## HTTPS, headers, and MIME types

Service workers and installation require a **secure context**: serve over HTTPS (or `http://localhost` for local testing). The Vite dev server never registers the worker.

Recommended response headers:

| Path | `Cache-Control` | Notes |
| --- | --- | --- |
| `/sw.js` | `no-cache` (or `max-age=0, must-revalidate`) | Browsers cap worker-script caching at 24 h, but immediate updates need revalidation. Serve as `text/javascript`. A wrong type (for example `text/html` from a SPA fallback) makes registration fail — the strip then shows *Offline unavailable*. |
| `/index.html`, `/` | `no-cache` | The worker refetches the shell with `no-cache` during install; the HTTP layer must honour that. |
| `/manifest.json` | `no-cache` or short `max-age` | `application/manifest+json` preferred; `application/json` also works. Same-origin, no credentials needed. |
| `/assets/*` | `public, max-age=31536000, immutable` | File names contain content hashes. |
| `/icons/*` | days–weeks | Unhashed; the worker revalidates them on install anyway. |

MIME types that must be right: `.js` → `text/javascript`, `.css` → `text/css`, `.json` → `application/json` (or `application/manifest+json` for the manifest), `.woff2` → `font/woff2`, `.png` → `image/png`, `.svg` → `image/svg+xml`. Strict `Content-Security-Policy` deployments must allow `worker-src 'self'` (or `script-src 'self'`), `manifest-src 'self'`, and `connect-src 'self'` so the worker can fetch the release.

Do not add a `Service-Worker-Allowed` header or serve the worker from a CDN origin: the worker must be same-origin and located at the app's base path so its default scope covers the app.

## Deployment: atomic, complete releases

The worker verifies every file of a release against the hashes baked into `dist/sw.js`, so a deployment must publish **the entire `dist/` directory of one build** together:

- Never deploy a subset (for example only `index.html` and `sw.js`) and never mix files from two builds. If a listed file is missing or differs, the install fails safely and users stay on the previous release — safe, but the update never arrives until a complete deploy lands.
- Prefer atomic deploys (upload to a new directory/release and switch, as Netlify, Vercel, Cloudflare Pages, GitHub Pages, and S3+CloudFront invalidation do). With rsync-style uploads, upload `assets/` and `icons/` first, then `index.html` and `manifest.json`, and `sw.js` last.
- Keep old hashed assets available for a short overlap if you can; the worker of the previous release only reads them when a cache entry was evicted (self-heal).
- Deploy the generated `dist/sw.js` from that same build — not `pwa/sw.template.js`, and not a `sw.js` copied from an earlier build.
- Do not rename `sw.js` or move it; browsers only update a worker registered at the same URL.

## Sub-directory hosting

Set Vite's `base` to the deployment path, e.g. `vite build --base=/lab/` or `base: '/lab/'` in `vite.config.js`. Then:

- `index.html` links, `manifest.json` (`start_url`, `scope`, icons) and the inventory are relative, so they resolve under `/lab/` automatically;
- the plugin sets `id` to `/lab/`;
- the page registers `/lab/sw.js` with scope `/lab/`, and the worker names its cache `pdf-lab::/lab/::<version>` and cleans up only that prefix;
- nothing in the app uses hard-coded root paths (`tests/pwa-precache.test.js` builds with `base: '/lab/'` to check this).

A relative base (`./`) also works for the files themselves, but then the manifest `id` is omitted (the absolute path is unknown at build time) and installed apps are identified by the resolved `start_url` instead. Choose an absolute base for installed apps whenever the deploy path is known.

## Privacy and storage boundaries

- Cache Storage contains exactly the files of the shipped release — the same public files any visitor downloads. It never contains videos, extracted frames, Markdown text, attached images, remote images, or exported PDFs. Nothing is sent anywhere; there is no analytics or sync.
- The app does not persist user documents at all: closing the tab discards unsaved notes and queued videos. "Offline ready" means the *application* is available offline, not that your files are saved — the info tip says so explicitly.
- Storage failures (quota, private mode, disabled storage) only disable offline use; they never block online use.
- Cache names are prefixed with `pdf-lab::<scope>::` and only those are ever deleted by the app.

## Verifying a release (checklist)

Automated (run before every release):

```bash
npm test                                   # inventory, worker, client, icons, Markdown, video engine
npm run build                              # must log “[pdf-lab-pwa] sw.js: release … files precached”
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npx playwright test \
  tests/browser/offline.spec.js tests/browser/pwa.spec.js tests/browser/pwa-update.spec.js
```

`offline.spec.js` proves the critical path: visit only the video workspace online, wait for *Offline ready*, go offline, reload, open the Markdown converter for the first time, and render the sample with the bundled KaTeX fonts. `pwa.spec.js` checks the install-prompt flow with synthetic `beforeinstallprompt` events (this is not an operating-system installation), Chromium's manifest parse and installability report (`Page.getAppManifest`, `Page.getInstallabilityErrors`), the 390 px layout with the info tip open, and print hiding. `pwa-update.spec.js` exercises real worker updates: two tabs with unsaved notes, a waiting release, one tab closed, activation only after the last tab closes, a broken release being discarded, and a real 404 for `sw.js`.

Manual, on real devices (not covered by automation):

1. Open the deployed HTTPS URL in Chrome desktop. DevTools → *Application → Manifest*: no warnings, `id` shows the deployment path, the maskable preview keeps the artwork inside the circle. *Application → Service workers*: status *activated and is running*, source `sw.js`. *Application → Cache storage*: one `pdf-lab::…` cache with the number of files the build logged.
2. Confirm the strip reads *Offline ready* (release id in the "i" tip), tick *Offline* in DevTools, reload, open Markdown, load the sample: math renders with the bundled fonts.
3. Install from the panel button (Chrome/Edge) and check the installed window has no install button, the title bar uses the navy theme, and the icon looks right in the OS launcher.
4. Android Chrome: install from the browser menu or the prompt, check the adaptive icon on the home screen and the splash screen colours. iPhone/iPad Safari: *Share → Add to Home Screen*, then launch from the home screen and verify offline use after a first online visit (Safari evicts storage of unused sites after a period of inactivity; that is a platform policy).
5. Deploy a second build, return to an open tab (or reopen it): the *Update ready* notice appears; nothing reloads; after closing every tab and window and reopening, the new release version shows in the panel and the old cache is gone.
6. Print/export from the Markdown converter once while installed to confirm the panel is absent from printed output.

Known limitations of the automated verification in this repository: the browser tests run in headless Chromium only (Firefox and Safari behaviour is documented from the sources, not measured), installation is exercised through synthetic events rather than the operating system, and native print dialogs are not driven.
