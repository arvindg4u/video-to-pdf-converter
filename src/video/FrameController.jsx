import { MAX_FPS, MIN_FPS } from './constants.js'
import InfoTip from '../ui/InfoTip.jsx'

/**
 * Frame extraction settings: FPS slider, PDF paper size (shared concept with
 * Markdown mode), and the optional per-frame filename/timestamp label.
 * Action buttons + live progress are injected as children so App keeps
 * ownership of the conversion lifecycle.
 */
export default function FrameController({
  fps,
  paper,
  includeLabels,
  disabled,
  onFpsChange,
  onPaperChange,
  onIncludeLabelsChange,
  children,
}) {
  return (
    <section className="controls-panel panel" aria-label="Frame settings">
      <div className="panel-title">
        <h2>Frame settings</h2>
        <InfoTip label="Frame settings">
          <p><strong>Frames per second</strong> sets how many frames are captured from every second of video, at exact, predictable timestamps. 1–2 fps is enough for most lectures; higher values make longer PDFs.</p>
          <p><strong>Paper size</strong> applies to every page; frames keep their aspect ratio and are never cropped.</p>
          <p><strong>Labels</strong> print the filename and timestamp on a contrast bar under each frame.</p>
        </InfoTip>
      </div>

      <label htmlFor="fps-select">Frames per second: <strong>{fps}</strong></label>
      <input
        id="fps-select"
        type="range"
        min={MIN_FPS}
        max={MAX_FPS}
        step={1}
        value={fps}
        onChange={(event) => onFpsChange(Number(event.target.value))}
        className="fps-slider"
        disabled={disabled}
        aria-valuetext={`${fps} frames per second`}
      />
      <div className="scale" aria-hidden="true">
        {Array.from({ length: MAX_FPS - MIN_FPS + 1 }, (_, i) => (
          <span key={MIN_FPS + i}>{MIN_FPS + i}</span>
        ))}
      </div>

      <div className="setting-row">
        <label htmlFor="video-paper">Paper size</label>
        <select
          id="video-paper"
          value={paper}
          onChange={(event) => onPaperChange(event.target.value)}
          disabled={disabled}
        >
          <option value="A4">A4</option>
          <option value="Letter">US Letter</option>
        </select>
      </div>

      <div className="setting-row setting-check">
        <input
          id="video-labels"
          type="checkbox"
          checked={includeLabels}
          onChange={(event) => onIncludeLabelsChange(event.target.checked)}
          disabled={disabled}
        />
        <label htmlFor="video-labels">Show filename + timestamp</label>
      </div>

      {children}
    </section>
  )
}
