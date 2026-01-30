import { useState, useRef } from 'react'
import { jsPDF } from 'jspdf'
import './App.css'

function App() {
  const [files, setFiles] = useState([])
  const [fps, setFps] = useState(1)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [currentVideo, setCurrentVideo] = useState(0)
  const [totalFrames, setTotalFrames] = useState(0)
  const [processedFrames, setProcessedFrames] = useState(0)

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files)
    
    if (selectedFiles.length > 20) {
      setError('Maximum 20 videos upload kar sakte ho!')
      return
    }

    const validFiles = selectedFiles.filter(file => file.type === 'video/mp4')
    
    if (validFiles.length !== selectedFiles.length) {
      setError('Sirf .mp4 video files upload kar sakte ho!')
    }
    
    if (validFiles.length > 0) {
      setFiles(validFiles)
      setError('')
    }
  }

  const removeFile = (index) => {
    setFiles(files.filter((_, i) => i !== index))
  }

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

  const processVideo = async (file, canvas) => {
    const video = document.createElement('video')
    const videoUrl = URL.createObjectURL(file)
    
    video.src = videoUrl
    video.preload = 'metadata'

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = reject
    })

    const duration = video.duration
    const interval = 1 / fps
    const frameCount = Math.floor(duration * fps)

    if (frameCount === 0) {
      URL.revokeObjectURL(videoUrl)
      throw new Error(`${file.name} bahut chhoti hai!`)
    }

    const frames = []

    for (let i = 0; i < frameCount; i++) {
      const time = i * interval
      await seekToTime(video, time)
      await new Promise(resolve => setTimeout(resolve, 50))
      
      const frameData = captureFrame(video, canvas)
      frames.push({
        data: frameData,
        width: video.videoWidth,
        height: video.videoHeight,
        videoName: file.name,
        timestamp: time.toFixed(2)
      })
      
      setProcessedFrames(prev => prev + 1)
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

      if (estimatedTotalFrames > 1000) {
        throw new Error('Bahut zyada frames! FPS kam karo ya kam videos use karo.')
      }

      for (let i = 0; i < files.length; i++) {
        setCurrentVideo(i + 1)
        setProgress(`Video ${i + 1}/${files.length} process ho rahi hai...`)
        
        const frames = await processVideo(files[i], canvas)
        allFrames.push(...frames)
      }

      setProgress('PDF generate ho rahi hai...')

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px'
      })

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
      }, 3000)

    } catch (err) {
      console.error('Error:', err)
      setError(`Error: ${err.message || 'Kuch galat ho gaya. Phir se try karo!'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <div className="header">
        <h1>🎬 Video to PDF Converter</h1>
        <p className="subtitle">Multiple Videos • Single PDF • 100% Browser-Based</p>
      </div>

      <form onSubmit={handleSubmit} className="form">
        <div className="upload-section">
          <label htmlFor="video-upload" className="upload-label">
            {files.length > 0 ? (
              <div className="file-info">
                <span>📹</span>
                <span>{files.length} video{files.length > 1 ? 's' : ''} selected</span>
                <span className="file-size">
                  {(files.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>
            ) : (
              <div className="upload-placeholder">
                <span>📤</span>
                <span>Videos Upload Karo (.mp4)</span>
                <span className="hint">Maximum 20 videos ek saath</span>
              </div>
            )}
          </label>
          <input
            id="video-upload"
            type="file"
            accept="video/mp4"
            multiple
            onChange={handleFileChange}
            disabled={loading}
          />
        </div>

        {files.length > 0 && (
          <div className="files-list">
            <h3>Selected Videos ({files.length}/20):</h3>
            <div className="files-grid">
              {files.map((file, index) => (
                <div key={index} className="file-item">
                  <span className="file-name">
                    {index + 1}. {file.name}
                  </span>
                  <span className="file-size-small">
                    {(file.size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                  {!loading && (
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="remove-btn"
                      title="Remove"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="fps-section">
          <label htmlFor="fps-select">
            Frames Per Second (FPS): <strong>{fps}</strong>
          </label>
          <input
            id="fps-select"
            type="range"
            min="1"
            max="6"
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
            disabled={loading}
            className="fps-slider"
          />
          <div className="fps-labels">
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
            <span>5</span>
            <span>6</span>
          </div>
        </div>

        {loading && totalFrames > 0 && (
          <div className="progress-details">
            <div className="progress-bar-container">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${(processedFrames / totalFrames) * 100}%` }}
              />
            </div>
            <div className="progress-stats">
              <span>Video: {currentVideo}/{files.length}</span>
              <span>Frames: {processedFrames}/{totalFrames}</span>
              <span>{Math.round((processedFrames / totalFrames) * 100)}%</span>
            </div>
          </div>
        )}

        <button 
          type="submit" 
          disabled={loading || files.length === 0} 
          className="submit-btn"
        >
          {loading ? '⏳ Processing...' : '🚀 Merge & Generate PDF'}
        </button>

        {progress && <div className="progress">{progress}</div>}
        {error && <div className="error">{error}</div>}
      </form>

      <div className="info">
        <p>💡 <strong>Kaise kaam karta hai:</strong></p>
        <ol>
          <li>Multiple .mp4 videos upload karo (max 20)</li>
          <li>FPS select karo (1-6)</li>
          <li>Sabhi videos ke frames ek single PDF mein merge honge</li>
          <li>PDF download karo!</li>
        </ol>
        <div className="features">
          <span className="badge">✅ Multiple Videos</span>
          <span className="badge">✅ Single PDF</span>
          <span className="badge">✅ Zero Server</span>
          <span className="badge">✅ Privacy First</span>
        </div>
      </div>
    </div>
  )
}

export default App