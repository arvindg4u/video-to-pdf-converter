/**
 * In-app installation for browsers that expose `beforeinstallprompt`
 * (Chromium-based browsers). Everything else gets manual instructions.
 *
 * - The deferred event is stored and only ever used from an explicit click.
 * - Dismissal, errors and `appinstalled` are handled; the button disappears
 *   once the app is installed or already runs in a standalone window.
 */

export const INSTALL_OUTCOME = Object.freeze({
  ACCEPTED: 'accepted',
  DISMISSED: 'dismissed',
  ERROR: 'error',
})

export function isStandaloneDisplay(win) {
  try {
    if (win.navigator && win.navigator.standalone === true) return true
    if (typeof win.matchMedia !== 'function') return false
    return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']
      .some((mode) => win.matchMedia(`(display-mode: ${mode})`).matches)
  } catch {
    return false
  }
}

export function createInstallController({ win, onChange = () => {}, log = () => {} }) {
  let deferred = null
  let state = {
    canPrompt: false,
    installed: isStandaloneDisplay(win),
    standalone: isStandaloneDisplay(win),
    prompting: false,
    outcome: null,
    message: '',
  }
  const cleanups = []

  function update(patch) {
    state = { ...state, ...patch }
    onChange(state)
  }

  function listen(target, type, handler) {
    if (!target || typeof target.addEventListener !== 'function') return
    target.addEventListener(type, handler)
    cleanups.push(() => target.removeEventListener(type, handler))
  }

  listen(win, 'beforeinstallprompt', (event) => {
    // Keep the browser's mini-infobar away; we offer our own button instead.
    event.preventDefault()
    if (isStandaloneDisplay(win)) return
    deferred = event
    update({ canPrompt: true, outcome: null, message: '' })
  })

  listen(win, 'appinstalled', () => {
    deferred = null
    update({ canPrompt: false, installed: true, prompting: false, outcome: INSTALL_OUTCOME.ACCEPTED, message: 'PDF Lab is installed. Launch it from your home screen, dock, or app list.' })
  })

  if (typeof win.matchMedia === 'function') {
    try {
      const query = win.matchMedia('(display-mode: standalone)')
      listen(query, 'change', () => {
        const standalone = isStandaloneDisplay(win)
        update({ standalone, installed: state.installed || standalone, canPrompt: state.canPrompt && !standalone })
      })
    } catch {
      // Older engines without MediaQueryList events.
    }
  }

  async function promptInstall() {
    const event = deferred
    if (!event || state.prompting) return null
    deferred = null
    update({ prompting: true, canPrompt: false, message: '' })
    try {
      const promptResult = await event.prompt()
      const choice = (await event.userChoice) || promptResult || {}
      const outcome = choice.outcome === 'accepted' ? INSTALL_OUTCOME.ACCEPTED : INSTALL_OUTCOME.DISMISSED
      update({
        prompting: false,
        outcome,
        message: outcome === INSTALL_OUTCOME.ACCEPTED
          ? 'Installing PDF Lab… it will appear with your other apps.'
          : 'Installation dismissed. You can install later from your browser menu — see the help below.',
      })
      return outcome
    } catch (error) {
      log('install prompt failed', error)
      update({
        prompting: false,
        outcome: INSTALL_OUTCOME.ERROR,
        message: 'The install prompt could not be shown. Use your browser menu instead — see the help below.',
      })
      return INSTALL_OUTCOME.ERROR
    }
  }

  function destroy() {
    while (cleanups.length) cleanups.pop()()
  }

  return { promptInstall, destroy, getState: () => state }
}
