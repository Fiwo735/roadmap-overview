import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { IconButton } from './IconButton'
import { useModalStack } from './portal'
import { useToastStore, type ToastItemData } from './toast'
import './Toast.css'

const ICONS = {
  info: <Info size={18} />,
  success: <CircleCheck size={18} />,
  error: <CircleAlert size={18} />,
}

function ToastItem({ toast }: { toast: ToastItemData }) {
  const dismiss = useToastStore((s) => s.dismiss)
  const [paused, setPaused] = useState(false)
  const remaining = useRef(toast.duration)

  useEffect(() => {
    if (toast.duration === 0 || paused) return
    const startedAt = Date.now()
    const timer = setTimeout(() => dismiss(toast.id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current -= Date.now() - startedAt
    }
  }, [paused, toast.id, toast.duration, dismiss])

  return (
    <div
      className={`toast toast--${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      data-testid="toast"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast__icon" aria-hidden="true">
        {ICONS[toast.kind]}
      </span>
      <span className="toast__message">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            toast.action?.onClick()
            dismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <IconButton label="Dismiss" icon={<X size={16} />} size="sm" onClick={() => dismiss(toast.id)} />
    </div>
  )
}

/**
 * Renders the queue filled by `toast.info/success/error(...)`. Mount once, near the app root.
 * While a modal dialog is open the region is portalled into it, otherwise toasts would sit
 * beneath the dialog's backdrop and be unreachable.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const modal = useModalStack((s) => s.stack.at(-1) ?? null)
  return createPortal(
    <div className="toast-host" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>,
    modal ?? document.body,
  )
}
