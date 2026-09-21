function formatSizeMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Deterministic queue: selection order is preserved, duplicates are never
 * added (see mergeIntoQueue), and each row names its file for removal.
 */
export default function VideoQueue({ files, disabled, onRemove }) {
  return (
    <section className="queue-panel panel" aria-label="Video queue">
      <h2>Queue</h2>
      {files.length === 0 ? (
        <p className="muted">Queue is empty.</p>
      ) : (
        <ul className="queue-list" aria-label={`${files.length} videos queued`}>
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="queue-item">
              <div>
                <p>{index + 1}. {file.name}</p>
                <small>{formatSizeMb(file.size)}</small>
              </div>
              {!disabled && (
                <button
                  type="button"
                  className="remove-btn"
                  aria-label={`Remove ${file.name} from queue`}
                  onClick={() => onRemove(index)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
