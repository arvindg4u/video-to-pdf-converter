import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import './infotip.css'

const OPEN_EVENT = 'pdf-lab:infotip-open'

/**
 * "i" toggletip: hint text lives behind a small info button instead of on the
 * screen. Explicit click/tap or Enter/Space opens a non-modal popover; Escape,
 * the close button, a click outside, or opening another tip closes it. Focus
 * stays on the trigger (the popover follows it in DOM order, so Tab reaches
 * the close button). On narrow screens the popover becomes a bottom sheet.
 */
export default function InfoTip({ label, children, className = '' }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const buttonRef = useRef(null)
  const popRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))
    const onOther = (event) => { if (event.detail !== id) setOpen(false) }
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    const onPointer = (event) => {
      if (popRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener(OPEN_EVENT, onOther)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener(OPEN_EVENT, onOther)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open, id])

  // Keep the popover on screen: align it to the trigger's right edge when it
  // would overflow the viewport on the right.
  useLayoutEffect(() => {
    const pop = popRef.current
    if (!open || !pop) return
    pop.dataset.align = 'start'
    const rect = pop.getBoundingClientRect()
    if (rect.right > window.innerWidth - 8) pop.dataset.align = 'end'
  }, [open])

  const close = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  return (
    <span className={`tip ${className}`.trim()}>
      <button
        ref={buttonRef}
        type="button"
        className="tip-btn"
        aria-label={`Info: ${label}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <div ref={popRef} id={id} className="tip-pop" role="dialog" aria-label={label}>
          <div className="tip-head">
            <strong>{label}</strong>
            <button type="button" className="tip-close" aria-label="Close" onClick={close} />
          </div>
          <div className="tip-body">{children}</div>
        </div>
      )}
    </span>
  )
}
