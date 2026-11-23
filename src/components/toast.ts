import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItemData {
  id: number
  kind: ToastKind
  message: string
  /** Auto-dismiss delay in ms; 0 keeps the toast until dismissed. */
  duration: number
  action?: ToastAction
}

export interface ToastOptions {
  duration?: number
  action?: ToastAction
}

interface ToastState {
  toasts: ToastItemData[]
  push: (kind: ToastKind, message: string, options?: ToastOptions) => number
  dismiss: (id: number) => void
}

const MAX_VISIBLE = 4
let nextId = 1

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (kind, message, options = {}) => {
    const id = nextId++
    const duration = options.duration ?? (kind === 'error' ? 7000 : 4000)
    const item: ToastItemData = { id, kind, message, duration, action: options.action }
    set((s) => ({ toasts: [...s.toasts, item].slice(-MAX_VISIBLE) }))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Show a message from anywhere (components, stores, services): `toast.error('Routing failed')`. */
export const toast = {
  info: (message: string, options?: ToastOptions) => useToastStore.getState().push('info', message, options),
  success: (message: string, options?: ToastOptions) => useToastStore.getState().push('success', message, options),
  error: (message: string, options?: ToastOptions) => useToastStore.getState().push('error', message, options),
  dismiss: (id: number) => useToastStore.getState().dismiss(id),
}
