import { useEffect } from 'react'
import { isTextEntry } from '../layout/shortcuts'
import { isEditingLocked } from '../ride/rideStore'
import { saveTripFile } from './exportTrip'
import { pickTripFile } from './filePicker'

/**
 * Ctrl/Cmd+S saves the trip as JSON, Ctrl/Cmd+O opens a trip file. The browser's own "save page" and
 * "open file" are always suppressed; the trip action is skipped while a modal dialog is open (the trip
 * behind it must not change under the user).
 */
export function useFileShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const key = e.key.toLowerCase()
      if (key !== 's' && key !== 'o') return
      e.preventDefault()
      if (document.querySelector('dialog[open]')) return
      if (key === 's') {
        // A field being edited (the title, a day) commits when it loses focus: save what the user typed.
        if (isTextEntry(e.target)) (e.target as HTMLElement).blur()
        saveTripFile()
      } else if (!isEditingLocked()) {
        // Opening another trip replaces this one: not while presenting or riding.
        pickTripFile()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
