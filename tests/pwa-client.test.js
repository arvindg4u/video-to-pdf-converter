import test from 'node:test'
import assert from 'node:assert/strict'
import { createServiceWorkerClient, PHASE, serviceWorkerAvailability } from '../src/pwa/serviceWorkerClient.js'
import { createInstallController, INSTALL_OUTCOME, isStandaloneDisplay } from '../src/pwa/installPrompt.js'
import { applyThemeColor, THEME_COLORS } from '../src/pwa/themeColor.js'

/* ------------------------------ test doubles ------------------------------ */

class Emitter {
  constructor() { this.listeners = new Map() }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(handler)
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler) }
  emit(type, event = {}) { for (const handler of Array.from(this.listeners.get(type) || [])) handler(event) }
}

/** A fake ServiceWorker that answers status/repair messages (or stays silent). */
class FakeWorker extends Emitter {
  constructor({ version = 'v1', complete = true, silent = false, repairSucceeds = true, state = 'activated' } = {}) {
    super()
    Object.assign(this, { version, complete, silent, repairSucceeds, state, messages: [] })
  }
  postMessage(message, [port]) {
    this.messages.push(message)
    if (this.silent) return
    const reply = (data) => queueMicrotask(() => port.onmessage({ data }))
    if (message.type === 'pdf-lab:status') reply({ type: 'pdf-lab:status', version: this.version, complete: this.complete })
    if (message.type === 'pdf-lab:repair') {
      if (this.repairSucceeds) this.complete = true
      reply({ type: 'pdf-lab:status', version: this.version, complete: this.complete, repaired: 1 })
    }
  }
}

class FakeRegistration extends Emitter {
  constructor({ active = null, waiting = null, installing = null } = {}) {
    super()
    Object.assign(this, { active, waiting, installing, updateCalls: 0, updateError: null })
  }
  async update() {
    this.updateCalls++
    if (this.updateError) throw this.updateError
  }
}

class FakeContainer extends Emitter {
  constructor(registration, { rejectWith = null } = {}) {
    super()
    Object.assign(this, { registration, rejectWith, registerCalls: [] })
  }
  async register(url, options) {
    this.registerCalls.push({ url, options })
    if (this.rejectWith) throw this.rejectWith
    return this.registration
  }
}

class FakeChannel {
  constructor() {
    this.port1 = { onmessage: null }
    this.port2 = { onmessage: null }
    // Deliver replies posted on port2's peer straight to port1.
    Object.defineProperty(this.port2, 'onmessage', { get: () => this.port1.onmessage })
  }
}

function makeClient(container, overrides = {}) {
  const states = []
  const timers = []
  const client = createServiceWorkerClient({
    container,
    scriptUrl: '/sw.js',
    scope: '/',
    createChannel: () => new FakeChannel(),
    schedule: (callback, ms) => { const handle = { callback, ms, fired: false }; timers.push(handle); return handle },
    cancel: (handle) => { if (handle) handle.cancelled = true },
    statusTimeoutMs: 50,
    onChange: (state) => states.push(state),
    ...overrides,
  })
  const fireTimers = () => { for (const timer of timers.splice(0)) if (!timer.cancelled) { timer.fired = true; timer.callback() } }
  return { client, states, timers, fireTimers }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/* ------------------------------ availability ------------------------------ */

test('the worker is only registered in production builds on secure origins with worker support', () => {
  assert.deepEqual(serviceWorkerAvailability({ isProduction: true, isSecureContext: true, hasServiceWorker: true }), { enabled: true, reason: null })
  assert.deepEqual(serviceWorkerAvailability({ isProduction: false, isSecureContext: true, hasServiceWorker: true }), { enabled: false, reason: 'development' })
  assert.deepEqual(serviceWorkerAvailability({ isProduction: true, isSecureContext: false, hasServiceWorker: true }), { enabled: false, reason: 'insecure' })
  assert.deepEqual(serviceWorkerAvailability({ isProduction: true, isSecureContext: true, hasServiceWorker: false }), { enabled: false, reason: 'unsupported' })
})

test('a disabled client never touches the container and reports why offline use is unavailable', async () => {
  const container = new FakeContainer(new FakeRegistration())
  const { client } = makeClient(container, { enabled: false, unavailableReason: 'insecure' })
  const state = await client.start()
  assert.equal(state.phase, PHASE.UNAVAILABLE)
  assert.equal(state.reason, 'insecure')
  assert.deepEqual(container.registerCalls, [])
})

/* -------------------------------- readiness ------------------------------- */

test('ready only after the active worker confirms a complete cache; startup triggers one update check', async () => {
  const active = new FakeWorker({ version: 'release-a', complete: true })
  const registration = new FakeRegistration({ active })
  const container = new FakeContainer(registration)
  const { client } = makeClient(container)
  const state = await client.start()
  assert.equal(state.phase, PHASE.READY)
  assert.equal(state.version, 'release-a')
  assert.equal(state.updateWaiting, false)
  assert.deepEqual(container.registerCalls[0], { url: '/sw.js', options: { scope: '/', updateViaCache: 'none' } })
  assert.equal(registration.updateCalls, 1, 'startup update check')
})

test('registration failure yields a failed phase without throwing (online use continues)', async () => {
  const container = new FakeContainer(new FakeRegistration(), { rejectWith: new TypeError('Failed to register a ServiceWorker: 404') })
  const { client } = makeClient(container)
  const state = await client.start()
  assert.equal(state.phase, PHASE.FAILED)
  assert.match(state.error, /404/)

  // register() resolving without a registration (blocked by automation/policy).
  const blocked = new FakeContainer(undefined)
  const { client: blockedClient } = makeClient(blocked)
  const blockedState = await blockedClient.start()
  assert.equal(blockedState.phase, PHASE.FAILED)
  assert.match(blockedState.error, /blocked/)
  assert.equal(await blockedClient.checkForUpdates('manual', { force: true }), false)
})

test('a legacy worker that never answers is reported as not ready (no false ready message)', async () => {
  const legacy = new FakeWorker({ silent: true })
  const registration = new FakeRegistration({ active: legacy })
  const { client, fireTimers } = makeClient(new FakeContainer(registration))
  const started = client.start()
  await flush()
  fireTimers() // status reply timeout elapses
  const state = await started
  assert.equal(state.phase, PHASE.LEGACY)
  assert.equal(state.version, null)
})

test('an incomplete cache is repaired once when online; otherwise it stays incomplete', async () => {
  const healable = new FakeWorker({ version: 'r', complete: false, repairSucceeds: true })
  const { client } = makeClient(new FakeContainer(new FakeRegistration({ active: healable })))
  assert.equal((await client.start()).phase, PHASE.READY)
  assert.deepEqual(healable.messages.map((m) => m.type), ['pdf-lab:status', 'pdf-lab:repair'])

  const broken = new FakeWorker({ version: 'r', complete: false, repairSucceeds: false })
  const { client: client2 } = makeClient(new FakeContainer(new FakeRegistration({ active: broken })))
  assert.equal((await client2.start()).phase, PHASE.INCOMPLETE)

  const offlineWorker = new FakeWorker({ version: 'r', complete: false })
  const { client: client3 } = makeClient(new FakeContainer(new FakeRegistration({ active: offlineWorker })), { isOnline: () => false })
  assert.equal((await client3.start()).phase, PHASE.INCOMPLETE)
  assert.deepEqual(offlineWorker.messages.map((m) => m.type), ['pdf-lab:status'], 'no repair attempt while offline')
})

/* --------------------------- first install lifecycle ---------------------- */

test('first install: pending while installing, ready once activated, failed if the install is discarded', async () => {
  const installing = new FakeWorker({ state: 'installing', version: 'first' })
  const registration = new FakeRegistration({ installing })
  const { client, fireTimers } = makeClient(new FakeContainer(registration))
  const started = client.start()
  await flush()
  fireTimers()
  assert.equal((await started).phase, PHASE.PENDING)

  installing.state = 'installed'; installing.emit('statechange')
  registration.installing = null; registration.active = installing
  installing.state = 'activated'; installing.emit('statechange')
  await flush()
  assert.equal(client.getState().phase, PHASE.READY)
  assert.equal(client.getState().version, 'first')
  assert.equal(client.getState().updateWaiting, false, 'a first install is not an "update"')

  // Separate registration whose very first install fails.
  const doomed = new FakeWorker({ state: 'installing' })
  const registration2 = new FakeRegistration({ installing: doomed })
  const { client: client2, fireTimers: fire2 } = makeClient(new FakeContainer(registration2))
  const started2 = client2.start()
  await flush(); fire2(); await started2
  doomed.state = 'redundant'; doomed.emit('statechange')
  assert.equal(client2.getState().phase, PHASE.FAILED)
  assert.match(client2.getState().error, /could not be downloaded or verified/)
})

/* ------------------------------- safe updates ----------------------------- */

test('a new release waits: the notice appears, nothing reloads, the current version stays ready', async () => {
  const active = new FakeWorker({ version: 'old' })
  const registration = new FakeRegistration({ active })
  const container = new FakeContainer(registration)
  const { client } = makeClient(container)
  await client.start()

  const incoming = new FakeWorker({ state: 'installing', version: 'new' })
  registration.installing = incoming
  registration.emit('updatefound')
  incoming.state = 'installed'; registration.waiting = incoming; registration.installing = null
  incoming.emit('statechange')
  await flush()
  const state = client.getState()
  assert.equal(state.updateWaiting, true)
  assert.equal(state.phase, PHASE.READY, 'the running release is still offline-ready')
  assert.equal(state.version, 'old')
  assert.deepEqual(incoming.messages, [], 'the waiting worker is never messaged (no skipWaiting requests)')
})

test('an update that fails to install is reported softly and does not affect readiness', async () => {
  const active = new FakeWorker({ version: 'old' })
  const registration = new FakeRegistration({ active })
  const { client } = makeClient(new FakeContainer(registration))
  await client.start()
  const incoming = new FakeWorker({ state: 'installing' })
  registration.installing = incoming
  registration.emit('updatefound')
  incoming.state = 'redundant'; incoming.emit('statechange')
  const state = client.getState()
  assert.equal(state.updateFailed, true)
  assert.equal(state.updateWaiting, false)
  assert.equal(state.phase, PHASE.READY)
})

test('a waiting worker present at startup is reported immediately', async () => {
  const registration = new FakeRegistration({ active: new FakeWorker({ version: 'old' }), waiting: new FakeWorker({ version: 'new' }) })
  const { client } = makeClient(new FakeContainer(registration))
  assert.equal((await client.start()).updateWaiting, true)
})

test('controllerchange refreshes status without reloading', async () => {
  const active = new FakeWorker({ version: 'a' })
  const registration = new FakeRegistration({ active })
  const container = new FakeContainer(registration)
  const { client } = makeClient(container)
  await client.start()
  registration.active = new FakeWorker({ version: 'b' })
  container.emit('controllerchange')
  await flush()
  assert.equal(client.getState().version, 'b')
})

test('foreground returns trigger an update check, throttled to the minimum interval', async () => {
  let clock = 1_000_000
  const registration = new FakeRegistration({ active: new FakeWorker() })
  const { client } = makeClient(new FakeContainer(registration), { now: () => clock, minUpdateIntervalMs: 60_000 })
  await client.start()
  assert.equal(registration.updateCalls, 1)

  client.handleVisibility('visible')
  await flush()
  assert.equal(registration.updateCalls, 1, 'too soon after startup')

  clock += 61_000
  client.handleVisibility('hidden')
  await flush()
  assert.equal(registration.updateCalls, 1, 'hiding the app does not check')
  client.handleVisibility('visible')
  await flush()
  assert.equal(registration.updateCalls, 2, 'a return to the foreground after the interval checks')

  clock += 61_000
  registration.updateError = new TypeError('Failed to fetch') // offline
  assert.equal(await client.checkForUpdates('foreground'), false)
  assert.equal(client.getState().phase, PHASE.READY, 'a failed check never degrades readiness')
})

test('destroy detaches every listener', async () => {
  const active = new FakeWorker()
  const registration = new FakeRegistration({ active })
  const container = new FakeContainer(registration)
  const { client, states } = makeClient(container)
  await client.start()
  client.destroy()
  const count = states.length
  registration.emit('updatefound')
  container.emit('controllerchange')
  await flush()
  assert.equal(states.length, count)
})

/* ------------------------------ install prompt ---------------------------- */

function fakeWindow({ standalone = false } = {}) {
  const win = new Emitter()
  win.navigator = {}
  const query = new Emitter()
  query.matches = standalone
  win.matchMedia = (mediaQuery) => (mediaQuery === '(display-mode: standalone)' ? query : { matches: false, addEventListener() {}, removeEventListener() {} })
  win.displayQuery = query
  return win
}

function promptEvent({ outcome = 'accepted', fail = false } = {}) {
  return {
    prevented: false,
    preventDefault() { this.prevented = true },
    prompt: async () => { if (fail) throw new Error('prompt() may only be called once') },
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  }
}

test('install button appears only after beforeinstallprompt and installs from an explicit click', async () => {
  const win = fakeWindow()
  const states = []
  const controller = createInstallController({ win, onChange: (state) => states.push(state) })
  assert.equal(controller.getState().canPrompt, false)
  assert.equal(await controller.promptInstall(), null, 'no deferred event → nothing happens')

  const event = promptEvent({ outcome: 'accepted' })
  win.emit('beforeinstallprompt', event)
  assert.equal(event.prevented, true, 'browser mini-infobar suppressed')
  assert.equal(controller.getState().canPrompt, true)

  assert.equal(await controller.promptInstall(), INSTALL_OUTCOME.ACCEPTED)
  assert.equal(controller.getState().canPrompt, false)
  assert.match(controller.getState().message, /Installing PDF Lab/)

  win.emit('appinstalled')
  assert.equal(controller.getState().installed, true)
  assert.match(controller.getState().message, /installed/i)
})

test('dismissal and prompt errors are handled and point to manual help', async () => {
  const win = fakeWindow()
  const controller = createInstallController({ win })
  win.emit('beforeinstallprompt', promptEvent({ outcome: 'dismissed' }))
  assert.equal(await controller.promptInstall(), INSTALL_OUTCOME.DISMISSED)
  assert.match(controller.getState().message, /dismissed/i)
  assert.equal(controller.getState().canPrompt, false, 'a used event cannot be prompted twice')

  win.emit('beforeinstallprompt', promptEvent({ fail: true }))
  assert.equal(controller.getState().canPrompt, true)
  assert.equal(await controller.promptInstall(), INSTALL_OUTCOME.ERROR)
  assert.match(controller.getState().message, /browser menu/i)
})

test('no install offer inside an installed/standalone window', () => {
  const win = fakeWindow({ standalone: true })
  const controller = createInstallController({ win })
  assert.equal(isStandaloneDisplay(win), true)
  win.emit('beforeinstallprompt', promptEvent())
  assert.equal(controller.getState().canPrompt, false)
  assert.equal(controller.getState().standalone, true)

  const iosWin = fakeWindow()
  iosWin.navigator.standalone = true
  assert.equal(isStandaloneDisplay(iosWin), true)

  const browserWin = fakeWindow()
  const browserController = createInstallController({ win: browserWin })
  browserWin.emit('beforeinstallprompt', promptEvent())
  assert.equal(browserController.getState().canPrompt, true)
  browserWin.displayQuery.matches = true
  browserWin.displayQuery.emit('change')
  assert.equal(browserController.getState().canPrompt, false, 'switching into a standalone window hides the offer')
})

test('theme-color meta follows the app theme', () => {
  const metas = []
  const doc = {
    head: { appendChild: (node) => metas.push(node) },
    querySelector: () => metas[0] || null,
    createElement: () => {
      const attrs = {}
      return { setAttribute: (name, value) => { attrs[name] = value }, getAttribute: (name) => attrs[name] }
    },
  }
  assert.equal(applyThemeColor('dark', doc), THEME_COLORS.dark)
  assert.equal(metas[0].getAttribute('content'), THEME_COLORS.dark)
  assert.equal(applyThemeColor('light', doc), THEME_COLORS.light)
  assert.equal(metas.length, 1, 'the existing meta is updated, not duplicated')
  assert.equal(applyThemeColor('sepia', doc), THEME_COLORS.light)
})
