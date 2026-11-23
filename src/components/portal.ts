import { create } from 'zustand'

/**
 * Where to portal floating UI (menus, tooltips) opened from `anchor`. Inside a modal dialog the rest
 * of the page is inert and painted beneath the dialog, so floating UI must live inside it.
 */
export function portalTarget(anchor: Element | null | undefined): HTMLElement {
  return anchor?.closest<HTMLElement>('dialog') ?? document.body
}

/** The modal dialogs currently open (innermost last). The toast region follows the last one. */
export const useModalStack = create<{
  stack: HTMLDialogElement[]
  add: (dialog: HTMLDialogElement) => void
  remove: (dialog: HTMLDialogElement) => void
}>()((set) => ({
  stack: [],
  add: (dialog) => set((s) => (s.stack.includes(dialog) ? s : { stack: [...s.stack, dialog] })),
  remove: (dialog) => set((s) => (s.stack.includes(dialog) ? { stack: s.stack.filter((d) => d !== dialog) } : s)),
}))
