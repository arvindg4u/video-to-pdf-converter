import { useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import './App.css'

const THEME_KEY = 'theme'
const MAX_VIDEOS = 20
const MAX_FRAMES = 1000
const ACCEPTED_VIDEO_TYPE = 'video/mp4'

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
  const progressRef = useRef(0)

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
    if (selectedFiles.length > MAX_VIDEOS) {
      setError(`Maximum ${MAX_VIDEOS} videos upload kar sakte ho!`)
      return
    }

    const validFiles = selectedFiles.filter((file) => file.type === ACCEPTED_VIDEO_TYPE)

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

  const removeFile = (index) => setFiles((prevFiles) => prevFiles.filter((_, i) => i !== index))

  const seekToTime = (video, time) => {
    return new Promise((resolve) => {
      video.onseeked = () => resolve()
      video.currentTime = time
    })
  }

  const estimateTotalFrames = async (selectedFiles) => {
    let estimated = 0

    for (const file of selectedFiles) {
      const video = document.createElement('video')
      const videoUrl = URL.createObjectURL(file)
      video.src = videoUrl
      video.preload = 'metadata'

      await new Promise((resolve) => {
        video.onloadedmetadata = resolve
      })

      estimated += Math.floor(video.duration * fps)
      URL.revokeObjectURL(videoUrl)
    }

    return estimated
  }

  const addVideoFramesToPdf = async (file, canvas, pdf) => {
    const video = document.createElement('video')
    const videoUrl = URL.createObjectURL(file)
    video.src = videoUrl
    video.preload = 'metadata'

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = reject
    })

    const duration = video.duration
    const frameCount = Math.floor(duration * fps)
    const interval = 1 / fps

    if (frameCount === 0) {
      URL.revokeObjectURL(videoUrl)
      throw new Error(`${file.name} bahut chhoti hai!`)
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')

    for (let i = 0; i < frameCount; i++) {
      const time = i * interval
      await seekToTime(video, time)

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const frameData = canvas.toDataURL('image/jpeg', 0.9)

      pdf.addPage([video.videoWidth, video.videoHeight])
      pdf.addImage(frameData, 'JPEG', 0, 0, video.videoWidth, video.videoHeight)
      pdf.setFontSize(12)
      pdf.setTextColor(255, 255, 255)
      pdf.text(`${file.name} - ${time.toFixed(2)}s`, 10, 20)

      progressRef.current += 1

      if (progressRef.current % 5 === 0 || progressRef.current === totalFrames) {
        setProcessedFrames(progressRef.current)
      }

      if (progressRef.current % 25 === 0) {
        setProgress(`Frames process: ${progressRef.current}/${totalFrames}`)
      }
    }

    URL.revokeObjectURL(videoUrl)
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
    progressRef.current = 0

    try {
      const estimatedTotalFrames = await estimateTotalFrames(files)
      setTotalFrames(estimatedTotalFrames)

      if (estimatedTotalFrames > MAX_FRAMES) {
        throw new Error('Bahut zyada frames! FPS kam karo ya kam videos use karo.')
      }

      const canvas = document.createElement('canvas')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px' })
      pdf.deletePage(1)

      for (let i = 0; i < files.length; i++) {
        setCurrentVideo(i + 1)
        setProgress(`Video ${i + 1}/${files.length} process ho rahi hai...`)
        await addVideoFramesToPdf(files[i], canvas, pdf)
      }

      setProcessedFrames(progressRef.current)
      setProgress('PDF download ho rahi hai...')
      pdf.save(`merged-videos-${Date.now()}.pdf`)

      setProgress(`✅ ${progressRef.current} frames ki PDF successfully download ho gayi! 🎉`)

      setTimeout(() => {
        setProgress('')
        setFiles([])
        setCurrentVideo(0)
        setTotalFrames(0)
        setProcessedFrames(0)
      }, 2200)
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
    if (!totalFrames) return 0
    return Math.round((processedFrames / totalFrames) * 100)
  }, [processedFrames, totalFrames])

  return (
    <div className="app-shell">
      <header className="hero-header panel">
        <div>
          <p className="meta">Performance-optimized converter</p>
          <h1>🎥 PDF Lab</h1>
          <p className="headline">Convert videos to PDF with ease</p>
        </div>
        <button type="button" className="theme-btn" onClick={toggleTheme}>
          {theme === 'light' ? 'Switch Dark' : 'Switch Light'}
        </button>
      </header>

      <section className="kpi-grid">
        <article className="kpi panel"><span>Videos</span><strong>{files.length}/{MAX_VIDEOS}</strong></article>
        <article className="kpi panel"><span>Total Size</span><strong>{totalSizeInMb} MB</strong></article>
        <article className="kpi panel"><span>FPS</span><strong>{fps}</strong></article>
        <article className="kpi panel"><span>Engine</span><strong>{loading ? 'Active' : 'Idle'}</strong></article>
      </section>

      <form onSubmit={handleSubmit} className="layout-grid">
        <section
          className="upload-panel panel"
          onDragEnter={(e) => {
            e.preventDefault()
            if (!loading) setDragActive(true)
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          <h2>Upload Matrix</h2>
          <input
            ref={fileInputRef}
            id="video-upload"
            type="file"
            accept={ACCEPTED_VIDEO_TYPE}
            multiple
            onChange={handleFileChange}
            disabled={loading}
          />
          <div className={`drop-zone ${dragActive ? 'active' : ''}`}>
            <p>{dragActive ? 'Drop now 🔥' : 'Drag & Drop .mp4 videos'}</p>
            <button type="button" className="secondary-btn" onClick={() => fileInputRef.current?.click()} disabled={loading}>
              Browse Files
            </button>
            <small>max {MAX_VIDEOS} files</small>
          </div>
        </section>

        <section className="controls-panel panel">
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

        <section className="queue-panel panel">
          <h2>Queue Lane</h2>
          {files.length === 0 ? (
            <p className="muted">Abhi queue empty hai.</p>
          ) : (
            <div className="queue-list">
              {files.map((file, index) => (
                <article key={`${file.name}-${index}`} className="queue-item">
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

        {(progress || error) && (
          <section className="feedback-panel panel">
            {progress && <div className="notice ok">{progress}</div>}
            {error && <div className="notice fail">{error}</div>}
          </section>
        )}
      </form>
    </div>
  )
}

export default App
