import { Presentation } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { togglePresentation, usePresentationStore } from './presentationStore'

/** Top bar: show the trip without the editing tools (the sidebar, handles, menus). A toggle, also on `P`. */
export function PresentationButton() {
  const on = usePresentationStore((s) => s.on)
  return (
    <IconButton
      label="Presentation mode"
      tooltip={on ? 'Leave presentation mode (P or Esc)' : 'Presentation mode (P): hide the editing tools'}
      icon={<Presentation size={18} />}
      aria-pressed={on}
      onClick={togglePresentation}
      data-testid="present-toggle"
    />
  )
}
