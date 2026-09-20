import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { MAX_VIDEOS } from './video/constants.js'
import { isCancellation, toVideoError } from './video/errors.js'
import { convertVideosToPdf } from './video/videoProcessing.js'
import { mergeIntoQueue } from './video/videoValidation.js'
import ConversionProgress from './video/ConversionProgress.jsx'
import FrameController from './video/FrameController.jsx'
import VideoQueue from './video/VideoQueue.jsx'
import VideoUploader from './video/VideoUploader.jsx'

const MarkdownConverter = lazy(() => import('./MarkdownConverter'))

const THEME_KEY = 'theme'
/** Minimum frames AND milliseconds between progress re-renders (Phase 11). */
const PROGRESS_FRAME_STEP = 5
const PROGRESS_MIN_INTERVAL_MS = 120
const SUCCESS_RESET_DELAY_MS = 2200

function readInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Private-mode storage can throw; fall through to OS preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function App() {
  const [mode, setMode] = useState('video')
  const [markdownOpened, setMarkdownOpened] = useState(false)
  const [markdownBusy, setMarkdownBusy] = useState(false)
  const [files, setFiles] = useState([])
  const [fps, setFps] = useState(1)
  const [paper, setPaper] = useState('A4')
  const [includeLabels, setIncludeLabels] = useState(true)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [currentVideo, setCurrentVideo] = useState(0)
  const [totalFrames, setTotalFrames] = useState(0)
  const [processedFrames, setProcessedFrames] = useState(0)
  const [theme, setTheme] = useState('light')

  const abortRef = useRef(null)
  const progressThrottleRef = useRef({ frames: 0, at: 0 })
  const successTimeoutRef = useRef(null)
  const errorRef = useRef(null)
  const generateRef = useRef(null)

  useEffect(() => {
    const initialTheme = readInitialTheme()
    setTheme(initialTheme)
    document.documentElement.setAttribute('data-theme', initialTheme)
  }, [])

  // A delayed success reset must never wipe a NEW queue or fire after unmount.
  useEffect(() => () => clearTimeout(successTimeoutRef.current), [])

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(nextTheme)
    try {
      localStorage.setItem(THEME_KEY, nextTheme)
    } catch {
      // Theme still applies for this session.
    }
    document.documentElement.setAttribute('data-theme', nextTheme)
  }

  const handlePickedFiles = (incoming) => {
    if (loading || incoming.length === 0) return
    clearTimeout(successTimeoutRef.current)
    try {
      const merged = mergeIntoQueue(files, incoming)
      setFiles(merged.files)
      if (merged.rejected.length > 0) {
        const first = merged.rejected[0].error.message
        const extra = merged.rejected.length > 1 ? ` (${merged.rejected.length - 1} more file(s) also skipped.)` : ''
        const kept = merged.accepted.length > 0
          ? ` ${merged.accepted.length} valid video(s) were queued.`
          : ''
        setError(`${first}${extra}${kept}`)
        setNotice('')
      } else if (merged.duplicates > 0 && merged.accepted.length === 0) {
        setError('')
        setNotice('Those videos are already in the queue — nothing new was added.')
      } else {
        setError('')
        setNotice(
          merged.duplicates > 0
            ? `${merged.accepted.length} video(s) queued (${merged.duplicates} duplicate(s) skipped).`
            : '',
        )
      }
      if (merged.rejected.length > 0) {
        requestAnimationFrame(() => errorRef.current?.focus?.({ preventScroll: false }))
      }
    } catch (err) {
      const videoError = toVideoError(err)
      setError(videoError.message)
      setNotice('')
      requestAnimationFrame(() => errorRef.current?.focus?.({ preventScroll: false }))
    }
  }

  const removeFile = (index) =>
    setFiles((prevFiles) => prevFiles.filter((_, i) => i !== index))

  const handleCancel = () => {
    abortRef.current?.abort()
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (loading) return

    if (files.length === 0) {
      setError('Choose at least one .mp4 video first!')
      requestAnimationFrame(() => errorRef.current?.focus?.({ preventScroll: false }))
      return
    }

    clearTimeout(successTimeoutRef.current)
    const controller = new AbortController()
    abortRef.current = controller
    progressThrottleRef.current = { frames: 0, at: 0 }

    setLoading(true)
    setProgress('Reading video metadata…')
    setNotice('')
    setError('')
    setCurrentVideo(0)
    setTotalFrames(0)
    setProcessedFrames(0)

    // High-frequency progress flows through a ref; React re-renders at most
    // every PROGRESS_FRAME_STEP frames / PROGRESS_MIN_INTERVAL_MS — plus a
    // guaranteed final 100% update — so conversion never janks the UI.
    const handleProgress = ({ processedFrames: done, totalFrames: total, videoIndex, videoCount, fileName }) => {
      const throttle = progressThrottleRef.current
      const now = performance.now()
      const isFinal = done >= total
      setCurrentVideo(videoIndex)
      if (total > 0) setTotalFrames(total)
      if (isFinal || (done - throttle.frames >= PROGRESS_FRAME_STEP && now - throttle.at >= PROGRESS_MIN_INTERVAL_MS)) {
        throttle.frames = done
        throttle.at = now
        setProcessedFrames(done)
        if (!isFinal && fileName) {
          setProgress(`Video ${videoIndex}/${videoCount}: ${fileName} — frame ${done}/${total}…`)
        }
      }
      if (isFinal) {
        setProcessedFrames(total)
      }
    }

    try {
      const { pdf, totalFrames: rendered, perVideo } = await convertVideosToPdf(files, {
        fps,
        paper,
        includeLabels,
        signal: controller.signal,
        onProgress: handleProgress,
      })

      // Cancellation/failure paths throw before this point, so reaching here
      // with rendered frames means a complete PDF — never a partial download.
      setProcessedFrames(rendered)
      setTotalFrames(rendered)
      setProgress('Preparing your PDF download…')
      pdf.save(`merged-videos-${Date.now()}.pdf`)

      const summary = perVideo.map((entry) => `${entry.fileName} (${entry.frameCount})`).join(', ')
      setProgress(`✅ ${rendered} frames from ${perVideo.length} video(s) downloaded! 🎉 [${summary}]`)

      successTimeoutRef.current = setTimeout(() => {
        setProgress('')
        setNotice('')
        setFiles([])
        setCurrentVideo(0)
        setTotalFrames(0)
        setProcessedFrames(0)
      }, SUCCESS_RESET_DELAY_MS)
    } catch (err) {
      const videoError = toVideoError(err)
      if (isCancellation(videoError)) {
        // Cancellation is user intent, not an error: idle UI, queue kept.
        setProgress('')
        setNotice('Conversion cancelled. Your queue is unchanged — tweak settings and retry anytime.')
        setCurrentVideo(0)
        setTotalFrames(0)
        setProcessedFrames(0)
        requestAnimationFrame(() => generateRef.current?.focus?.({ preventScroll: false }))
      } else {
        console.error(`[video-to-pdf] ${videoError.code}`, {
          message: videoError.message,
          fileName: videoError.fileName,
          cause: videoError.cause,
        })
        setError(videoError.message)
        setProgress('')
        setCurrentVideo(0)
        setTotalFrames(0)
        setProcessedFrames(0)
        requestAnimationFrame(() => errorRef.current?.focus?.({ preventScroll: false }))
      }
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }

  const totalSizeInMb = useMemo(
    () => (files.reduce((acc, file) => acc + file.size, 0) / (1024 * 1024)).toFixed(2),
    [files],
  )

  return (
    <div className="app-shell">
      <header className="hero-header panel">
        <div>
          <p className="meta">Performance-optimized converter</p>
          <h1>🎥 PDF Lab</h1>
          <p className="headline">Convert videos and Markdown into beautiful PDFs</p>
        </div>
        <button type="button" className="theme-btn" onClick={toggleTheme}>
          {theme === 'light' ? 'Switch Dark' : 'Switch Light'}
        </button>
      </header>

      <nav className="converter-tabs" aria-label="Conversion mode">
        <button type="button" aria-pressed={mode === 'video'} disabled={markdownBusy} onClick={() => setMode('video')}>Video to PDF</button>
        <button type="button" aria-pressed={mode === 'markdown'} disabled={loading} onClick={() => { setMarkdownOpened(true); setMode('markdown') }}>Markdown to PDF</button>
      </nav>

      <div className="markdown-mode" hidden={mode !== 'markdown'}>
        <Suspense fallback={<p role="status">Loading Markdown converter…</p>}>
          {markdownOpened && <MarkdownConverter onBusyChange={setMarkdownBusy} />}
        </Suspense>
      </div>

      <div className="video-workspace" hidden={mode !== 'video'}>
        <section className="kpi-grid" aria-label="Conversion summary">
          <article className="kpi panel"><span>Videos</span><strong>{files.length}/{MAX_VIDEOS}</strong></article>
          <article className="kpi panel"><span>Total Size</span><strong>{totalSizeInMb} MB</strong></article>
          <article className="kpi panel"><span>FPS</span><strong>{fps}</strong></article>
          <article className="kpi panel"><span>Engine</span><strong>{loading ? 'Active' : 'Idle'}</strong></article>
        </section>

        <form onSubmit={handleSubmit} className="layout-grid">
          <VideoUploader disabled={loading} onFiles={handlePickedFiles} />

          <FrameController
            fps={fps}
            paper={paper}
            includeLabels={includeLabels}
            disabled={loading}
            onFpsChange={setFps}
            onPaperChange={setPaper}
            onIncludeLabelsChange={setIncludeLabels}
          >
            {loading && totalFrames > 0 && (
              <ConversionProgress
                processedFrames={processedFrames}
                totalFrames={totalFrames}
                currentVideo={currentVideo}
                videoCount={files.length}
              />
            )}

            {!loading ? (
              <button ref={generateRef} type="submit" className="primary-btn" disabled={files.length === 0}>
                Generate PDF
              </button>
            ) : (
              <button type="button" className="cancel-btn" onClick={handleCancel}>
                Cancel conversion
              </button>
            )}
          </FrameController>

          <VideoQueue files={files} disabled={loading} onRemove={removeFile} />

          {(progress || notice || error) && (
            <section className="feedback-panel panel" aria-label="Conversion messages">
              {progress && <div className="notice ok" role="status">{progress}</div>}
              {notice && !progress && <div className="notice info" role="status">{notice}</div>}
              {error && <div ref={errorRef} className="notice fail" role="alert" tabIndex={-1}>{error}</div>}
            </section>
          )}
        </form>
      </div>
    </div>
  )
}

export default App
