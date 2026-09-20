/**
 * Accessible conversion progress. Never renders partial state: the parent
 * only mounts it while a conversion is running with a known total.
 */
export default function ConversionProgress({
  processedFrames,
  totalFrames,
  currentVideo,
  videoCount,
}) {
  const percent = totalFrames > 0
    ? Math.min(100, Math.round((processedFrames / totalFrames) * 100))
    : 0

  return (
    <div className="live-progress">
      <div
        className="bar"
        role="progressbar"
        aria-label="Video conversion progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${processedFrames} of ${totalFrames} frames, video ${currentVideo} of ${videoCount}`}
      >
        <div className="fill" style={{ width: `${percent}%` }} />
      </div>
      <p aria-hidden="true">
        {percent}% • Video {currentVideo}/{videoCount} • {processedFrames}/{totalFrames} frames
      </p>
    </div>
  )
}
