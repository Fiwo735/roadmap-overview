import { create } from 'zustand'

export interface ConfirmRequest {
  title: string
  description: string
  confirmLabel: string
  resolve: (confirmed: boolean) => void
}

export const useConfirmStore = create<{ request: ConfirmRequest | null }>()(() => ({ request: null }))

/**
 * Ask the user to confirm something from non-React code: resolves true on the confirm button, false on
 * Cancel, Escape, the close button or the backdrop (and when a newer question replaces this one).
 * `<ConfirmHost />` must be mounted (the File menu does it).
 */
export function askToConfirm(question: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().request?.resolve(false)
    useConfirmStore.setState({ request: { ...question, resolve } })
  })
}
