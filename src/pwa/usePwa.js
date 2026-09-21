import { useCallback, useEffect, useRef, useState } from 'react'
import { createInstallController } from './installPrompt.js'
import { createServiceWorkerClient, PHASE, serviceWorkerAvailability } from './serviceWorkerClient.js'

const BASE_URL = import.meta.env.BASE_URL || '/'

/**
 * Wires the framework-agnostic PWA controllers into React state.
 * Returns connectivity, offline readiness, update and install state.
 */
export function usePwa() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  const [worker, setWorker] = useState(() => ({
    phase: PHASE.PENDING, reason: null, version: null, updateWaiting: false, updateFailed: false, error: null,
  }))
  const [install, setInstall] = useState({ canPrompt: false, installed: false, standalone: false, prompting: false, outcome: null, message: '' })
  const installRef = useRef(null)

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    const availability = serviceWorkerAvailability({
      isProduction: import.meta.env.PROD,
      isSecureContext: window.isSecureContext === true,
      hasServiceWorker: 'serviceWorker' in navigator,
    })
    const client = createServiceWorkerClient({
      container: availability.enabled ? navigator.serviceWorker : null,
      scriptUrl: `${BASE_URL}sw.js`,
      scope: BASE_URL,
      enabled: availability.enabled,
      unavailableReason: availability.reason,
      isOnline: () => navigator.onLine !== false,
      log: (message, error) => console.info(`[pdf-lab-pwa] ${message}`, error ?? ''),
      onChange: (state) => setWorker({ ...state }),
    })
    setWorker({ ...client.getState() })
    client.start()
    const onVisibility = () => client.handleVisibility(document.visibilityState)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      client.destroy()
    }
  }, [])

  useEffect(() => {
    const controller = createInstallController({
      win: window,
      onChange: (state) => setInstall({ ...state }),
      log: (message, error) => console.info(`[pdf-lab-pwa] ${message}`, error ?? ''),
    })
    installRef.current = controller
    setInstall({ ...controller.getState() })
    return () => {
      controller.destroy()
      installRef.current = null
    }
  }, [])

  const promptInstall = useCallback(() => installRef.current?.promptInstall(), [])

  return { online, worker, install, promptInstall }
}
