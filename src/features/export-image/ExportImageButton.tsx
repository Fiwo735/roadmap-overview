import { useRef } from 'react'
import { ImageDown } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useUiStore } from '../../store/uiStore'
import { ExportDialog } from './ExportDialog'

export const EXPORT_DIALOG_ID = 'export-image'

// Top bar slot: opens the dialog that renders the trip map as a PNG (feature F7). The dialog exists
// only while it is open, so its statistics and previews cost nothing the rest of the time.
export function ExportImageButton() {
  const open = useUiStore((s) => s.openDialogId === EXPORT_DIALOG_ID)
  const openDialog = useUiStore((s) => s.openDialog)
  const closeDialog = useUiStore((s) => s.closeDialog)
  const trigger = useRef<HTMLButtonElement>(null)

  return (
    <>
      <IconButton
        ref={trigger}
        label="Export image"
        tooltip="Render an image of the map"
        icon={<ImageDown size={18} />}
        aria-haspopup="dialog"
        onClick={() => openDialog(EXPORT_DIALOG_ID)}
        data-testid="export-image-button"
      />
      {open ? (
        <ExportDialog
          onClose={() => {
            closeDialog()
            // The dialog is gone from the page, so the browser cannot return the focus itself.
            setTimeout(() => trigger.current?.focus(), 0)
          }}
        />
      ) : null}
    </>
  )
}
