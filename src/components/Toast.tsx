import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { IconButton } from './IconButton'
import { useModalStack, useToastDock } from './portal'
import { toast as showToast, useToastStore, type ToastAction, type ToastItemData } from './toast'
import { useMediaQuery } from './useMediaQuery'
import './Toast.css'

const ICONS = {
  info: <Info size={18} />,
  success: <CircleCheck size={18} />,
  error: <CircleAlert size={18} />,
}

function ToastActionButton({ action, toastId, quiet = false }: { action: ToastAction; toastId: number; quiet?: boolean }) {
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <button
      type="button"
      className={['toast__action', quiet && 'toast__action--quiet'].filter(Boolean).join(' ')}
      onClick={() => {
        const blocked = action.blockedBy?.()
        if (blocked) {
          showToast.info(blocked)
          return
        }
        action.onClick()
        dismiss(toastId)
      }}
    >
      {action.label}
    </button>
  )
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
      {toast.action ? <ToastActionButton action={toast.action} toastId={toast.id} /> : null}
      {toast.secondaryAction ? <ToastActionButton action={toast.secondaryAction} toastId={toast.id} quiet /> : null}
      {toast.dismissible ? <IconButton label="Dismiss" icon={<X size={16} />} size="sm" onClick={() => dismiss(toast.id)} /> : null}
    </div>
  )
}

/**
 * Renders the queue filled by `toast.info/success/error(...)`. Mount once, near the app root.
 * While a modal dialog is open the region is portalled into it, otherwise toasts would sit
 * beneath the dialog's backdrop and be unreachable. Otherwise, on wide screens, it goes into the map's
 * toast dock (bottom-centre of the map, above the ride controls: clear of the title card and the map tools);
 * on phones, and where there is no map, it is fixed to the window.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const modal = useModalStack((s) => s.stack.at(-1) ?? null)
  const dock = useToastDock((s) => s.el)
  const wide = useMediaQuery('(min-width: 768px)')
  const target = modal ?? (wide ? dock : null) ?? document.body
  return createPortal(
    <div className={['toast-host', target === dock && 'toast-host--docked'].filter(Boolean).join(' ')} role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>,
    target,
  )
}
