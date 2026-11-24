import { useEffect, useRef } from 'react'
import { ImageDown } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useUiStore } from '../../store/uiStore'
import { videoDebug } from '../export-video/debug'
import { ExportDialog } from './ExportDialog'
import { EXPORT_DIALOG_ID, openExportDialog, useExportTab } from './exportTab'

export { EXPORT_DIALOG_ID }

// Top bar slot: opens the dialog that renders the trip map as a PNG (feature F7) or the ride as a video (F13, its Video tab;
// the ride's controls open it there too). The dialog exists only while it is open, so its statistics and previews cost
// nothing the rest of the time.
export function ExportImageButton() {
  const open = useUiStore((s) => s.openDialogId === EXPORT_DIALOG_ID)
  const closeDialog = useUiStore((s) => s.closeDialog)
  const trigger = useRef<HTMLButtonElement>(null)

  // Dev builds: tests and humans can draw a frame of the video, or render a small one, through `window.__ROADMAP__.video`.
  useEffect(() => {
    if (import.meta.env.DEV && window.__ROADMAP__) window.__ROADMAP__.video = videoDebug
  }, [])

  return (
    <>
      <IconButton
        ref={trigger}
        label="Export image"
        tooltip="Render an image or a video of the trip"
        icon={<ImageDown size={18} />}
        aria-haspopup="dialog"
        onClick={() => openExportDialog('image')}
        data-testid="export-image-button"
      />
      {open ? (
        <ExportDialog
          onClose={() => {
            const { returnFocusTo } = useExportTab.getState()
            closeDialog()
            // The dialog is gone from the page, so the browser cannot return the focus itself: to whatever opened it, else this button.
            setTimeout(() => (returnFocusTo?.isConnected ? returnFocusTo : trigger.current)?.focus(), 0)
          }}
        />
      ) : null}
    </>
  )
}
