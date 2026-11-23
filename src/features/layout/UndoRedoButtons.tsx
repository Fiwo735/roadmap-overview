import { Redo2, Undo2 } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useHistory } from '../../store/tripStore'
import { useEditingLocked } from '../ride/rideStore'
import { shortcutLabel } from './shortcuts'

export function UndoRedoButtons() {
  const { undo, redo, canUndo, canRedo } = useHistory()
  // History is frozen while editing is locked (a ride is on): the ride is made from the trip as it was when it started.
  const locked = useEditingLocked()
  return (
    <div className="topbar__group" role="group" aria-label="History">
      <IconButton
        label="Undo"
        tooltip={`Undo (${shortcutLabel('Z')})`}
        icon={<Undo2 size={18} />}
        disabled={!canUndo || locked}
        onClick={undo}
        data-testid="undo"
      />
      <IconButton
        label="Redo"
        tooltip={`Redo (${shortcutLabel('Z', true)})`}
        icon={<Redo2 size={18} />}
        disabled={!canRedo || locked}
        onClick={redo}
        data-testid="redo"
      />
    </div>
  )
}
