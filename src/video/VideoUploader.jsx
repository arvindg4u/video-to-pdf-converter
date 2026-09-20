import { useRef, useState } from 'react'
import { MAX_VIDEOS } from './constants.js'
import { ACCEPTED_VIDEO_EXTENSION, ACCEPTED_VIDEO_MIME } from './videoValidation.js'

/**
 * File picker + drag-and-drop zone.
 *
 * Keyboard access is provided by the real "Browse Files" button (a focusable
 * dropzone wrapping a button would nest interactives, which hurts screen
 * readers more than it helps). The dropzone itself is a passive drop target.
 */
export default function VideoUploader({ disabled, onFiles }) {
  const inputRef = useRef(null)
  const [dragActive, setDragActive] = useState(false)

  return (
    <section
      className="upload-panel panel"
      aria-label="Upload videos"
      onDragEnter={(event) => {
        event.preventDefault()
        if (!disabled) setDragActive(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragActive(false)
        if (!disabled) onFiles(Array.from(event.dataTransfer?.files || []))
      }}
    >
      <h2>Upload Matrix</h2>
      <input
        ref={inputRef}
        id="video-upload"
        type="file"
        accept={`${ACCEPTED_VIDEO_EXTENSION},${ACCEPTED_VIDEO_MIME}`}
        multiple
        onChange={(event) => {
          onFiles(Array.from(event.target.files || []))
          // Allow picking the same file twice in a row (dedupe is handled by
          // the queue, which reports it instead of silently ignoring it).
          event.target.value = ''
        }}
        disabled={disabled}
        aria-label="Choose MP4 video files"
      />
      <div className={`drop-zone ${dragActive ? 'active' : ''}`}>
        <p>{dragActive ? 'Drop now 🔥' : 'Drag & Drop .mp4 videos'}</p>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          Browse Files
        </button>
        <small>max {MAX_VIDEOS} files · .mp4 only</small>
      </div>
    </section>
  )
}
