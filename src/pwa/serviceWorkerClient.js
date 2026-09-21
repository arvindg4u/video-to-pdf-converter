/**
 * Page-side service worker lifecycle for PDF Lab.
 *
 * Responsibilities:
 *   - register the worker only when enabled (production + secure origin),
 *   - report a truthful offline status: "ready" only after the ACTIVE worker
 *     confirms that its precache holds the complete release,
 *   - surface a waiting update without ever reloading or forcing activation,
 *   - check for updates at startup and when the app returns to the foreground.
 *
 * It is framework-agnostic and injectable so the state machine can be unit
 * tested in Node with fake registrations.
 */

export const UPDATE_CHECK_MIN_INTERVAL_MS = 5 * 60 * 1000
export const STATUS_REPLY_TIMEOUT_MS = 4000

/** Offline readiness phases shown to the user. */
export const PHASE = Object.freeze({
  UNAVAILABLE: 'unavailable', // no worker support / insecure origin / dev build
  PENDING: 'pending', // registering or installing the first release
  READY: 'ready', // active worker confirmed a complete cache
  INCOMPLETE: 'incomplete', // active worker answered but files are missing
  FAILED: 'failed', // registration or first install failed
  LEGACY: 'legacy', // active worker is an older release that cannot report
})

export function createServiceWorkerClient({
  container,
  scriptUrl,
  scope,
  enabled = true,
  unavailableReason = null,
  isOnline = () => true,
  now = () => Date.now(),
  schedule = (callback, ms) => setTimeout(callback, ms),
  cancel = (handle) => clearTimeout(handle),
  createChannel = () => new MessageChannel(),
  statusTimeoutMs = STATUS_REPLY_TIMEOUT_MS,
  minUpdateIntervalMs = UPDATE_CHECK_MIN_INTERVAL_MS,
  log = () => {},
  onChange = () => {},
} = {}) {
  let state = {
    phase: enabled ? PHASE.PENDING : PHASE.UNAVAILABLE,
    reason: enabled ? null : unavailableReason,
    version: null,
    updateWaiting: false,
    updateFailed: false,
    lastCheckedAt: null,
    error: null,
  }
  let registration = null
  let repairAttempted = false
  let destroyed = false
  const cleanups = []

  function update(patch) {
    const next = { ...state, ...patch }
    const changed = Object.keys(next).some((key) => next[key] !== state[key])
    state = next
    if (changed && !destroyed) onChange(state)
  }

  function listen(target, type, handler) {
    if (!target || typeof target.addEventListener !== 'function') return
    target.addEventListener(type, handler)
    cleanups.push(() => target.removeEventListener(type, handler))
  }

  async function start() {
    if (!enabled) return state
    if (!container || typeof container.register !== 'function') {
      update({ phase: PHASE.UNAVAILABLE, reason: 'unsupported' })
      return state
    }
    try {
      registration = await container.register(scriptUrl, { scope, updateViaCache: 'none' })
    } catch (error) {
      log('registration failed', error)
      update({ phase: PHASE.FAILED, error: messageOf(error) })
      return state
    }
    if (destroyed) return state
    if (!registration || typeof registration.update !== 'function') {
      // Some automation/enterprise setups resolve register() without a
      // registration (Playwright's "block" mode does). Treat it as a failure.
      registration = null
      update({ phase: PHASE.FAILED, error: 'Service worker registration was blocked by the browser.' })
      return state
    }

    listen(registration, 'updatefound', () => trackInstalling(registration.installing))
    listen(container, 'controllerchange', () => {
      // Never reload here: unsaved notes or a running conversion would be lost.
      refreshStatus()
    })

    if (registration.installing) trackInstalling(registration.installing)
    if (registration.waiting && registration.active) update({ updateWaiting: true })
    await refreshStatus()
    await checkForUpdates('startup')
    return state
  }

  function trackInstalling(worker) {
    if (!worker) return
    const hadActive = Boolean(registration.active)
    let reachedInstalled = false
    if (!hadActive) update({ phase: PHASE.PENDING })
    const onState = () => {
      if (worker.state === 'installed') {
        reachedInstalled = true
        if (hadActive) update({ updateWaiting: true })
      } else if (worker.state === 'activated') {
        refreshStatus()
      } else if (worker.state === 'redundant') {
        if (!reachedInstalled) {
          if (hadActive) {
            log('update failed to install; current release stays available')
            update({ updateFailed: true })
          } else {
            update({ phase: PHASE.FAILED, error: 'Offline setup failed: a required file could not be downloaded or verified.' })
          }
        }
        worker.removeEventListener('statechange', onState)
      }
    }
    listen(worker, 'statechange', onState)
  }

  /** Asks the active worker whether its cache is complete. */
  async function refreshStatus() {
    if (!registration || destroyed) return
    const worker = registration.active
    if (!worker) {
      if (state.phase !== PHASE.FAILED) update({ phase: PHASE.PENDING })
      return
    }
    const report = await ask(worker, { type: 'pdf-lab:status' })
    if (destroyed) return
    if (!report) {
      // An older worker (or one that crashed) cannot vouch for its cache.
      update({ phase: PHASE.LEGACY, version: null })
      return
    }
    if (report.complete) {
      update({ phase: PHASE.READY, version: report.version, error: null })
      return
    }
    if (!repairAttempted && isOnline()) {
      repairAttempted = true
      const repaired = await ask(worker, { type: 'pdf-lab:repair' }, statusTimeoutMs * 8)
      if (destroyed) return
      if (repaired && repaired.complete) {
        update({ phase: PHASE.READY, version: repaired.version, error: null })
        return
      }
    }
    update({ phase: PHASE.INCOMPLETE, version: report.version, error: report.error || null })
  }

  function ask(worker, message, timeoutMs = statusTimeoutMs) {
    return new Promise((resolve) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        cancel(timer)
        resolve(value)
      }
      const timer = schedule(() => finish(null), timeoutMs)
      try {
        const channel = createChannel()
        channel.port1.onmessage = (event) => finish(event.data)
        worker.postMessage(message, [channel.port2])
      } catch (error) {
        log('status request failed', error)
        finish(null)
      }
    })
  }

  /** Startup + foreground update checks, throttled for tab switching. */
  async function checkForUpdates(reason = 'manual', { force = false } = {}) {
    if (!registration || destroyed) return false
    const last = state.lastCheckedAt
    if (!force && last !== null && now() - last < minUpdateIntervalMs) return false
    update({ lastCheckedAt: now() })
    try {
      await registration.update()
      return true
    } catch (error) {
      // Offline or transient network failure: the current release keeps working.
      log(`update check (${reason}) skipped`, error)
      return false
    }
  }

  function handleVisibility(visibilityState) {
    if (visibilityState === 'visible') checkForUpdates('foreground')
  }

  function destroy() {
    destroyed = true
    while (cleanups.length) cleanups.pop()()
  }

  return {
    start,
    checkForUpdates,
    refreshStatus,
    handleVisibility,
    destroy,
    getState: () => state,
  }
}

/** Decides whether the worker may be registered at all. */
export function serviceWorkerAvailability({ isProduction, isSecureContext, hasServiceWorker }) {
  if (!hasServiceWorker) return { enabled: false, reason: 'unsupported' }
  if (!isSecureContext) return { enabled: false, reason: 'insecure' }
  if (!isProduction) return { enabled: false, reason: 'development' }
  return { enabled: true, reason: null }
}

function messageOf(error) {
  return error && error.message ? error.message : String(error)
}
