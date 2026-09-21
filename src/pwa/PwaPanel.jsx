import { useId } from 'react'
import { PHASE } from './serviceWorkerClient.js'
import { usePwa } from './usePwa.js'
import './pwa.css'

const UNAVAILABLE_TEXT = {
  unsupported: 'Offline use is not supported by this browser.',
  insecure: 'Offline use needs a secure (HTTPS) connection.',
  development: 'Offline use is available in production builds only.',
}

export function describeOffline(worker) {
  switch (worker.phase) {
    case PHASE.READY:
      return `Works offline · release ${worker.version ? worker.version.slice(0, 8) : 'ready'}`
    case PHASE.PENDING:
      return 'Preparing offline files…'
    case PHASE.INCOMPLETE:
      return 'Offline files are incomplete — reload while online to finish setup.'
    case PHASE.FAILED:
      return 'Offline setup failed — PDF Lab still works online.'
    case PHASE.LEGACY:
      return 'Offline setup finishes after you close all PDF Lab tabs and reopen it.'
    case PHASE.UNAVAILABLE:
    default:
      return UNAVAILABLE_TEXT[worker.reason] || UNAVAILABLE_TEXT.unsupported
  }
}

export default function PwaPanel() {
  const { online, worker, install, promptInstall } = usePwa()
  const headingId = useId()
  const offlineText = describeOffline(worker)
  const showInstall = install.canPrompt && !install.installed && !install.standalone

  return (
    <section className="pwa-panel panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="pwa-heading">App status</h2>
      <div className="pwa-row">
        <p className="pwa-status" aria-live="polite">
          <span className={`pwa-dot ${online ? 'pwa-dot-online' : 'pwa-dot-offline'}`} aria-hidden="true" />
          <span className="pwa-connectivity">{online ? 'Online' : 'Offline'}</span>
          <span className="pwa-separator" aria-hidden="true">·</span>
          <span className="pwa-offline-text">{offlineText}</span>
        </p>
        <div className="pwa-actions">
          {showInstall && (
            <button type="button" className="pwa-install-btn" onClick={promptInstall} disabled={install.prompting}>
              {install.prompting ? 'Opening install prompt…' : 'Install PDF Lab'}
            </button>
          )}
          <details className="pwa-help">
            <summary>Install &amp; offline help</summary>
            <div className="pwa-help-body">
              <h3>Install PDF Lab</h3>
              <ul>
                <li><strong>Chrome / Edge (desktop):</strong> click the install icon at the right end of the address bar, or open the browser menu (three dots) and choose <em>Install PDF Lab</em> (in Edge: <em>Apps</em>, then <em>Install this site as an app</em>).</li>
                <li><strong>Chrome (Android):</strong> open the menu (three dots), then <em>Add to Home screen</em> or <em>Install app</em>.</li>
                <li><strong>iPhone / iPad (Safari):</strong> tap <em>Share</em>, then <em>Add to Home Screen</em>. On iOS 16.4 and later, other browsers offer the same option in their Share menu.</li>
                <li><strong>Safari (Mac):</strong> open the <em>File</em> menu, then <em>Add to Dock</em>.</li>
                <li><strong>Firefox (desktop):</strong> installing web apps is not supported; PDF Lab keeps working as a website.</li>
              </ul>
              <h3>Working offline</h3>
              <p>Once setup is complete, the whole app — video converter, Markdown editor and bundled math fonts — loads without internet. Offline caching stores the app only: it never saves your videos, Markdown notes, images or exported PDFs, and unsaved notes are lost when a tab closes. Remote images in Markdown still need internet, and clearing site data removes the offline files.</p>
              <h3>Updates</h3>
              <p>New releases download in the background and take effect only after every PDF Lab tab and installed app window has been closed. PDF Lab never reloads a page on its own.</p>
            </div>
          </details>
        </div>
      </div>
      <div className="pwa-live" aria-live="polite">
        {worker.updateWaiting && (
          <div className="pwa-update">
            <strong>Update ready.</strong> A new version of PDF Lab has been downloaded. To switch: save or export your work, close <strong>all</strong> PDF Lab tabs and installed app windows, then reopen it. Nothing reloads on its own.
          </div>
        )}
        {worker.updateFailed && !worker.updateWaiting && (
          <p className="pwa-message">A newer version could not be downloaded; you are still on the current one. It will be retried on the next start.</p>
        )}
        {install.message && <p className="pwa-message">{install.message}</p>}
      </div>
    </section>
  )
}
