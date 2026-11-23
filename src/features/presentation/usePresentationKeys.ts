import { useEffect } from 'react'
import { isTextEntry, plainKeyAllowed } from '../layout/shortcuts'
import { exitPresentation, togglePresentation } from './presentationStore'

/** `P` toggles presentation mode, Escape leaves it (when nothing else — a ride, a menu, a field — used the key). */
export function usePresentationKeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The read-only trip title may hold the focus: Escape is not its own then.
        const readOnly = e.target instanceof HTMLInputElement && e.target.readOnly
        if (e.defaultPrevented || document.querySelector('dialog[open]') || (isTextEntry(e.target) && !readOnly)) return
        exitPresentation()
      } else if ((e.key === 'p' || e.key === 'P') && !e.shiftKey && plainKeyAllowed(e)) {
        e.preventDefault()
        togglePresentation()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
