import { Redo2, Undo2 } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useHistory } from '../../store/tripStore'
import { shortcutLabel } from './shortcuts'

export function UndoRedoButtons() {
  const { undo, redo, canUndo, canRedo } = useHistory()
  return (
    <div className="topbar__group" role="group" aria-label="History">
      <IconButton
        label="Undo"
        tooltip={`Undo (${shortcutLabel('Z')})`}
        icon={<Undo2 size={18} />}
        disabled={!canUndo}
        onClick={undo}
        data-testid="undo"
      />
      <IconButton
        label="Redo"
        tooltip={`Redo (${shortcutLabel('Z', true)})`}
        icon={<Redo2 size={18} />}
        disabled={!canRedo}
        onClick={redo}
        data-testid="redo"
      />
    </div>
  )
}
