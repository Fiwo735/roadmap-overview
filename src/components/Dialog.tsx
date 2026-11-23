import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'
import { useModalStack } from './portal'
import './Dialog.css'

interface DialogProps {
  open: boolean
  /** Called on Escape, the close button and backdrop clicks. The parent must then set `open` false. */
  onClose: () => void
  title: string
  description?: string
  size?: 'sm' | 'md' | 'lg'
  /** Buttons row, right-aligned under the content. */
  footer?: ReactNode
  children?: ReactNode
}

/** Modal dialog on the native <dialog> element: focus trap, Escape and inert background for free. */
export function Dialog({ open, onClose, title, description, size = 'md', footer, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descId = useId()

  const downOnBackdrop = useRef(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!open) {
      if (dialog.open) dialog.close()
      return
    }
    if (!dialog.open) dialog.showModal()
    // Lets the toast region move into the dialog, the only place a modal's user can reach.
    useModalStack.getState().add(dialog)
    return () => useModalStack.getState().remove(dialog)
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${size}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      // Fires for Escape and for our own close() below; `open` is already false for the latter.
      onClose={(e) => {
        useModalStack.getState().remove(e.currentTarget)
        if (open) onClose()
      }}
      // The dialog element has no padding, so a pointer event that lands on it is on the backdrop.
      // Closing needs the press AND the click there: a text selection dragged from inside the
      // dialog and released over the backdrop also "clicks" the dialog element but must not close it.
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        const closing = downOnBackdrop.current && e.target === e.currentTarget
        downOnBackdrop.current = false
        if (closing) onClose()
      }}
    >
      {open ? (
        <div className="dialog__panel">
          <header className="dialog__header">
            <h2 id={titleId} className="dialog__title">
              {title}
            </h2>
            <IconButton label="Close" icon={<X size={18} />} size="sm" onClick={onClose} />
          </header>
          {description ? (
            <p id={descId} className="dialog__description">
              {description}
            </p>
          ) : null}
          <div className="dialog__body">{children}</div>
          {footer ? <footer className="dialog__footer">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  )
}
