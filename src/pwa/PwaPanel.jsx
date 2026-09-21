import { useId } from 'react'
import { PHASE } from './serviceWorkerClient.js'
import { usePwa } from './usePwa.js'
import InfoTip from '../ui/InfoTip.jsx'
import './pwa.css'

/** Short, on-screen state. The full explanation lives in the info tip. */
export function describeOffline(worker) {
  switch (worker.phase) {
    case PHASE.READY: return 'Offline ready'
    case PHASE.PENDING: return 'Preparing offline…'
    case PHASE.INCOMPLETE: return 'Offline incomplete'
    case PHASE.FAILED: return 'Offline unavailable'
    case PHASE.LEGACY: return 'Offline after restart'
    case PHASE.UNAVAILABLE:
    default: return 'Online only'
  }
}

const UNAVAILABLE_REASON = {
  unsupported: 'This browser has no service-worker support, so PDF Lab runs online only.',
  insecure: 'Offline use needs a secure (HTTPS) connection; on this address PDF Lab runs online only.',
  development: 'Offline use is available in production builds only.',
}

/** Truthful long-form explanation of the current offline state. */
export function explainOffline(worker) {
  switch (worker.phase) {
    case PHASE.READY:
      return `The whole app — video converter, Markdown editor and bundled math fonts — is stored on this device (release ${worker.version ? worker.version.slice(0, 8) : 'unknown'}). It keeps working without internet.`
    case PHASE.PENDING:
      return 'PDF Lab is downloading and verifying its files for offline use. Stay online until this finishes; everything already works online.'
    case PHASE.INCOMPLETE:
      return 'Some offline files are missing (for example after the browser cleared storage). Reload while online to complete the set; online use is unaffected.'
    case PHASE.FAILED:
      return `Offline setup failed${worker.error ? ` (${worker.error})` : ''}. PDF Lab still works online; it will try again on the next start.`
    case PHASE.LEGACY:
      return 'An older offline version is still active. Close all PDF Lab tabs and app windows, then reopen it to finish the switch.'
    case PHASE.UNAVAILABLE:
    default:
      return UNAVAILABLE_REASON[worker.reason] || UNAVAILABLE_REASON.unsupported
  }
}

export default function PwaPanel() {
  const { online, worker, install, promptInstall } = usePwa()
  const headingId = useId()
  const showInstall = install.canPrompt && !install.installed && !install.standalone

  return (
    <section
      className="pwa-panel panel"
      aria-labelledby={headingId}
      data-phase={worker.phase}
      data-release={worker.version || ''}
    >
      <h2 id={headingId} className="pwa-heading">App status</h2>
      <div className="pwa-row">
        <p className="pwa-status" aria-live="polite">
          <span className={`pwa-dot ${online ? 'pwa-dot-online' : 'pwa-dot-offline'}`} aria-hidden="true" />
          <span className="pwa-connectivity">{online ? 'Online' : 'Offline'}</span>
          <span className="pwa-separator" aria-hidden="true">·</span>
          <span className="pwa-offline-text">{describeOffline(worker)}</span>
        </p>
        <div className="pwa-actions">
          {showInstall && (
            <button type="button" className="pwa-install-btn" onClick={promptInstall} disabled={install.prompting}>
              {install.prompting ? 'Opening…' : 'Install PDF Lab'}
            </button>
          )}
          <InfoTip label="Offline use & installing" className="pwa-help">
            <p className="pwa-help-state">{explainOffline(worker)}</p>
            <h4>Install PDF Lab</h4>
            <ul>
              <li><strong>Chrome / Edge (desktop):</strong> click the install icon at the right end of the address bar, or open the browser menu (three dots) and choose <em>Install PDF Lab</em> (Edge: <em>Apps</em>, then <em>Install this site as an app</em>).</li>
              <li><strong>Chrome (Android):</strong> menu (three dots), then <em>Add to Home screen</em> or <em>Install app</em>.</li>
              <li><strong>iPhone / iPad (Safari):</strong> tap <em>Share</em>, then <em>Add to Home Screen</em> (iOS 16.4+; other browsers offer the same in their Share menu).</li>
              <li><strong>Safari (Mac):</strong> <em>File</em> menu, then <em>Add to Dock</em>.</li>
              <li><strong>Firefox (desktop):</strong> installing web apps is not supported; PDF Lab keeps working as a website.</li>
            </ul>
            <h4>What offline caching stores</h4>
            <p>Only the app itself. It never saves your videos, Markdown notes, images or exported PDFs; unsaved notes are lost when a tab closes. Remote images in notes still need internet, and clearing site data removes the offline files.</p>
            <h4>Updates</h4>
            <p>New releases download in the background and take effect only after every PDF Lab tab and installed window has been closed. PDF Lab never reloads a page on its own.</p>
          </InfoTip>
        </div>
      </div>
      <div className="pwa-live" aria-live="polite">
        {worker.updateWaiting && (
          <div className="pwa-update">
            <strong>Update ready.</strong> Save or export your work, then close <strong>all</strong> PDF Lab tabs and installed app windows and reopen it. Nothing reloads on its own.
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
