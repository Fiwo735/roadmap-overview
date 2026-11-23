import { CircleHelp } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { openHelp } from './helpActions'

/** Top bar: opens the Help dialog (how-tos and the keyboard shortcuts). */
export function HelpButton() {
  return (
    <IconButton
      label="Help"
      tooltip="Help and keyboard shortcuts (?)"
      icon={<CircleHelp size={18} />}
      aria-haspopup="dialog"
      onClick={openHelp}
      data-testid="help-button"
    />
  )
}
