import { lazy, Suspense, useState, type KeyboardEvent } from 'react'
import { Clapperboard, Image } from 'lucide-react'
import { Dialog } from '../../components/Dialog'
import { Spinner } from '../../components/Spinner'
import { setExportTab, useExportTab, type ExportTab } from './exportTab'
import { ImagePanel } from './ImagePanel'
import './export.css'

// The video's drawing and encoding code is only loaded when the Video tab is first opened.
const VideoPanel = lazy(() => import('../export-video/VideoPanel').then((m) => ({ default: m.VideoPanel })))

const TABS: readonly { id: ExportTab; label: string; icon: typeof Image }[] = [
  { id: 'image', label: 'Image', icon: Image },
  { id: 'video', label: 'Video', icon: Clapperboard },
]

/**
 * The dialog behind the top bar's export button: a picture of the trip (the Image tab, F7) or a video of the ride (the Video
 * tab, F13). The tabs share the frame, the title and the footer, where each puts its own buttons (the footer is a slot they portal into).
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const tab = useExportTab((s) => s.tab)
  const busy = useExportTab((s) => s.busy)
  // The footer's buttons belong to the tab shown: the tab renders them into this element.
  const [footer, setFooter] = useState<HTMLElement | null>(null)

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const at = TABS.findIndex((t) => t.id === tab)
    let next = at
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % TABS.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    else return
    e.preventDefault()
    if (busy) return
    setExportTab(TABS[next].id)
    document.getElementById(`export-tab-${TABS[next].id}`)?.focus()
  }

  return (
    <Dialog open onClose={onClose} title="Export image or video" size="xl" footer={<div className="export__footer" ref={setFooter} />}>
      <div className="export-tabs" role="tablist" aria-label="What to export" onKeyDown={onKeyDown}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            id={`export-tab-${id}`}
            type="button"
            role="tab"
            className="export-tab"
            aria-selected={tab === id}
            aria-controls={`export-panel-${id}`}
            aria-disabled={busy && tab !== id ? true : undefined}
            tabIndex={tab === id ? 0 : -1}
            title={busy && tab !== id ? 'Wait until this is done, or cancel it.' : undefined}
            data-testid={`export-tab-${id}`}
            onClick={() => {
              if (!busy) setExportTab(id)
            }}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div id={`export-panel-${tab}`} role="tabpanel" aria-labelledby={`export-tab-${tab}`} className="export-panel">
        {tab === 'image' ? (
          <ImagePanel footer={footer} />
        ) : (
          <Suspense
            fallback={
              <div className="export__loading">
                <Spinner size={20} label="Loading the video tab" />
              </div>
            }
          >
            <VideoPanel footer={footer} />
          </Suspense>
        )}
      </div>
    </Dialog>
  )
}
