import { useEffect } from 'react'
import { useUiStore } from '../../store/uiStore'
import { plainKeyAllowed } from '../layout/shortcuts'

export const HELP_DIALOG_ID = 'help'

export const openHelp = (): void => useUiStore.getState().openDialog(HELP_DIALOG_ID)

/** `?` opens the Help dialog, except where it is a character being typed (a field, a menu) or another dialog is open. */
export function useHelpKey(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '?' || !plainKeyAllowed(e)) return
      e.preventDefault()
      openHelp()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
