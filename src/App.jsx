import { useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import './App.css'

const THEME_KEY = 'theme'
const MAX_FRAMES = 1000

function App() {
  const [files, setFiles] = useState([])
  const [fps, setFps] = useState(1)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [currentVideo, setCurrentVideo] = useState(0)
  const [totalFrames, setTotalFrames] = useState(0)
  const [processedFrames, setProcessedFrames] = useState(0)
  const [dragActive, setDragActive] = useState(false)
  const [theme, setTheme] = useState('light')
  const fileInputRef = useRef(null)

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_KEY)
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light')
    setTheme(initialTheme)
    document.documentElement.setAttribute('data-theme', initialTheme)
  }, [])

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(nextTheme)
    localStorage.setItem(THEME_KEY, nextTheme)
    document.documentElement.setAttribute('data-theme', nextTheme)
  }

  const validateAndSetFiles = (selectedFiles) => {
    if (selectedFiles.length > 20) {
      setError('Maximum 20 videos upload kar sakte ho!')
      return
    }

    const validFiles = selectedFiles.filter((file) => file.type === 'video/mp4')

    if (validFiles.length !== selectedFiles.length) {
      setError('Sirf .mp4 video files upload kar sakte ho!')
    }

    if (validFiles.length > 0) {
      setFiles(validFiles)
      setError('')
    }
  }

  const handleFileChange = (e) => validateAndSetFiles(Array.from(e.target.files || []))

  const handleDrop = (e) => {
    e.preventDefault()
    setDragActive(false)
    if (!loading) {
      validateAndSetFiles(Array.from(e.dataTransfer.files || []))
    }
  }

  const removeFile = (index) => setFiles(files.filter((_, i) => i !== index))

  const captureFrame = (video, canvas) => {
    const ctx = canvas.getContext('2d')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.95)
  }

  const seekToTime = (video, time) => {
    return new Promise((resolve) => {
      video.onseeked = () => resolve()
      video.currentTime = time
    })
  }

  const addVideoFramesToPdf = async (file, canvas) => {
    const video = document.createElement('video')
    const videoUrl = URL.createObjectURL(file)
    video.src = videoUrl
    video.preload = 'metadata'

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = reject
    })

    const frameCount = Math.floor(video.duration * fps)
    const interval = 1 / fps

    if (frameCount === 0) {
      URL.revokeObjectURL(videoUrl)
      throw new Error(`${file.name} bahut chhoti hai!`)
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const frames = []

    for (let i = 0; i < frameCount; i++) {
      const time = i * interval
      await seekToTime(video, time)
      await new Promise((resolve) => setTimeout(resolve, 40))

      const frameData = captureFrame(video, canvas)
      frames.push({
        data: frameData,
        width: video.videoWidth,
        height: video.videoHeight,
        videoName: file.name,
        timestamp: time.toFixed(2)
      })
      setProcessedFrames((prev) => prev + 1)
    }

    URL.revokeObjectURL(videoUrl)
    return frames
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (files.length === 0) {
      setError('Pehle video files select karo!')
      return
    }

    setLoading(true)
    setProgress('Videos process ho rahi hain...')
    setError('')
    setCurrentVideo(0)
    setProcessedFrames(0)

    try {
      const canvas = document.createElement('canvas')
      const allFrames = []

      let estimatedTotalFrames = 0
      for (const file of files) {
        const video = document.createElement('video')
        const videoUrl = URL.createObjectURL(file)
        video.src = videoUrl
        video.preload = 'metadata'

        await new Promise((resolve) => {
          video.onloadedmetadata = resolve
        })

        estimatedTotalFrames += Math.floor(video.duration * fps)
        URL.revokeObjectURL(videoUrl)
      }

      setTotalFrames(estimatedTotalFrames)

      if (estimatedTotalFrames > MAX_FRAMES) {
        throw new Error('Bahut zyada frames! FPS kam karo ya kam videos use karo.')
      }

      for (let i = 0; i < files.length; i++) {
        setCurrentVideo(i + 1)
        setProgress(`Video ${i + 1}/${files.length} process ho rahi hai...`)
        const frames = await addVideoFramesToPdf(files[i], canvas)
        allFrames.push(...frames)
      }

      setProgress('PDF generate ho rahi hai...')

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px' })
      pdf.deletePage(1)

      for (let i = 0; i < allFrames.length; i++) {
        const frame = allFrames[i]
        pdf.addPage([frame.width, frame.height])
        pdf.addImage(frame.data, 'JPEG', 0, 0, frame.width, frame.height)
        pdf.setFontSize(12)
        pdf.setTextColor(255, 255, 255)
        pdf.text(`${frame.videoName} - ${frame.timestamp}s`, 10, 20)

        if ((i + 1) % 10 === 0) {
          setProgress(`PDF generate ho rahi hai: ${i + 1}/${allFrames.length}`)
        }
      }

      setProgress('PDF download ho rahi hai...')
      pdf.save(`merged-videos-${Date.now()}.pdf`)
      setProgress(`✅ ${allFrames.length} frames ki PDF successfully download ho gayi! 🎉`)

      setTimeout(() => {
        setProgress('')
        setFiles([])
        setCurrentVideo(0)
        setTotalFrames(0)
        setProcessedFrames(0)
      }, 2500)
    } catch (err) {
      console.error('Error:', err)
      setError(`Error: ${err.message || 'Kuch galat ho gaya. Phir se try karo!'}`)
    } finally {
      setLoading(false)
    }
  }

  const totalSizeInMb = useMemo(
    () => (files.reduce((acc, file) => acc + file.size, 0) / (1024 * 1024)).toFixed(2),
    [files]
  )

  const progressPercent = useMemo(() => {
    if (totalFrames === 0) return 0
    return Math.round((processedFrames / totalFrames) * 100)
  }, [processedFrames, totalFrames])

  return (
    <div className="app-shell">
      <header className="hero-header glass-card">
        <div>
          <p className="meta">Performance-first converter</p>
          <h1>🎥 MotionFrames PDF Lab</h1>
          <p className="headline">Naya gradient-based premium interface, faster feel, aur clean multi-device UX.</p>
        </div>
        <button type="button" className="theme-btn" onClick={toggleTheme}>
          {theme === 'light' ? 'Switch Dark' : 'Switch Light'}
        </button>
      </header>

      <section className="kpi-grid">
        <article className="kpi glass-card"><span>Videos</span><strong>{files.length}/20</strong></article>
        <article className="kpi glass-card"><span>Total Size</span><strong>{totalSizeInMb} MB</strong></article>
        <article className="kpi glass-card"><span>FPS</span><strong>{fps}</strong></article>
        <article className="kpi glass-card"><span>Engine</span><strong>{loading ? 'Active' : 'Idle'}</strong></article>
      </section>

      <form onSubmit={handleSubmit} className="layout-grid">
        <section
          className="upload-panel glass-card"
          onDragEnter={(e) => { e.preventDefault(); if (!loading) setDragActive(true) }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          <h2>Upload Matrix</h2>
          <input
            ref={fileInputRef}
            id="video-upload"
            type="file"
            accept="video/mp4"
            multiple
            onChange={handleFileChange}
            disabled={loading}
          />
          <div className={`drop-zone ${dragActive ? 'active' : ''}`}>
            <p>{dragActive ? 'Drop now 🔥' : 'Drag & Drop .mp4 videos'}</p>
            <button type="button" className="secondary-btn" onClick={() => fileInputRef.current?.click()} disabled={loading}>
              Browse Files
            </button>
            <small>max 20 files</small>
          </div>
        </section>

        <section className="controls-panel glass-card">
          <h2>Frame Controller</h2>
          <label htmlFor="fps-select">Frames per second: <strong>{fps}</strong></label>
          <input
            id="fps-select"
            type="range"
            min="1"
            max="6"
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
            className="fps-slider"
            disabled={loading}
          />
          <div className="scale"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span></div>

          {loading && totalFrames > 0 && (
            <div className="live-progress">
              <div className="bar"><div className="fill" style={{ width: `${progressPercent}%` }} /></div>
              <p>{progressPercent}% • Video {currentVideo}/{files.length} • {processedFrames}/{totalFrames} frames</p>
            </div>
          )}

          <button type="submit" className="primary-btn" disabled={loading || files.length === 0}>
            {loading ? 'Processing...' : 'Generate PDF'}
          </button>
        </section>

        <section className="queue-panel glass-card">
          <h2>Queue Lane</h2>
          {files.length === 0 ? (
            <p className="muted">Abhi queue empty hai.</p>
          ) : (
            <div className="queue-list">
              {files.map((file, index) => (
                <article key={index} className="queue-item">
                  <div>
                    <p>{index + 1}. {file.name}</p>
                    <small>{(file.size / (1024 * 1024)).toFixed(1)} MB</small>
                  </div>
                  {!loading && <button type="button" className="remove-btn" onClick={() => removeFile(index)}>✕</button>}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="status-panel glass-card">
          <h2>Pipeline Notes</h2>
          <ul>
            <li>1) Upload videos</li>
            <li>2) Set FPS</li>
            <li>3) Start converter</li>
            <li>4) PDF auto-download</li>
          </ul>
          <div className="tags"><span>Private</span><span>No backend</span><span>Adaptive UI</span></div>
        </section>

        {(progress || error) && (
          <section className="feedback-panel glass-card">
            {progress && <div className="notice ok">{progress}</div>}
            {error && <div className="notice fail">{error}</div>}
          </section>
        )}
      </form>
    </div>
  )
}

export default App
