import { ToastHost } from './components/Toast'
import { useHelpKey } from './features/help/helpActions'
import { Sidebar } from './features/layout/Sidebar'
import { TopBar } from './features/layout/TopBar'
import { useUndoRedoShortcuts } from './features/layout/shortcuts'
import { MapView } from './features/map/MapView'
import { usePresentationKeys } from './features/presentation/usePresentationKeys'
import { usePresentationStore } from './features/presentation/presentationStore'
import './features/layout/layout.css'

export function App() {
  useUndoRedoShortcuts()
  useHelpKey()
  usePresentationKeys()
  // Presentation mode hides the sidebar and the editing tools (layout.css).
  const presenting = usePresentationStore((s) => s.on)
  return (
    <div className="app" data-presenting={presenting || undefined}>
      <TopBar />
      <div className="app__body">
        <Sidebar />
        <main className="map-pane" aria-label="Map">
          <MapView />
        </main>
      </div>
      <ToastHost />
    </div>
  )
}
