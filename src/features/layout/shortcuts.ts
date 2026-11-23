import { useEffect } from 'react'
import { redo, undo } from '../../store/tripStore'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** "Ctrl+Z" or "⌘Z" depending on the platform, for tooltips. */
export function shortcutLabel(key: string, shift = false): string {
  return isMac ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`
}

/** Is the event target a field the user types in (where keys such as Escape and Ctrl+Z belong to the field)? */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl+Y redo. Ignored while typing in a field (the browser's
 * own text undo keeps working there) and while a modal dialog is open (the trip behind it must not
 * change under the user).
 */
export function useUndoRedoShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextEntry(e.target)) return
      if (document.querySelector('dialog[open]')) return
      const key = e.key.toLowerCase()
      if (key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (key === 'y' && !e.shiftKey) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
