import { ToastHost } from './components/Toast'
import { Sidebar } from './features/layout/Sidebar'
import { TopBar } from './features/layout/TopBar'
import { useUndoRedoShortcuts } from './features/layout/shortcuts'
import { MapView } from './features/map/MapView'
import './features/layout/layout.css'

export function App() {
  useUndoRedoShortcuts()
  return (
    <div className="app">
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
