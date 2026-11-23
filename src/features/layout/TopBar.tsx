import { PanelLeft } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useUiStore } from '../../store/uiStore'
import { ExportImageButton } from '../export-image/ExportImageButton'
import { FileMenu } from '../io/FileMenu'
import { RideButton } from '../ride/RideButton'
import { ThemeToggle } from '../theme/ThemeToggle'
import { Logo } from './Logo'
import { TripTitle } from './TripTitle'
import { UndoRedoButtons } from './UndoRedoButtons'

export function TopBar() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  return (
    <header className="topbar">
      <IconButton
        id="sidebar-toggle"
        className="topbar__menu"
        label="Places"
        tooltip="Show places"
        icon={<PanelLeft size={18} />}
        aria-expanded={sidebarOpen}
        aria-controls="sidebar"
        onClick={toggleSidebar}
        data-testid="sidebar-toggle"
      />
      <div className="brand">
        <Logo />
        <span className="brand__name">Roadmap Overview</span>
      </div>
      <span className="topbar__divider" aria-hidden="true" />
      <TripTitle />
      <div className="topbar__actions">
        <UndoRedoButtons />
        <span className="topbar__divider" aria-hidden="true" />
        <RideButton />
        <ExportImageButton />
        <FileMenu />
        <ThemeToggle />
      </div>
    </header>
  )
}
