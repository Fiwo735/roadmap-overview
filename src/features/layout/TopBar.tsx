import { PanelLeft } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useUiStore } from '../../store/uiStore'
import { ExportImageButton } from '../export-image/ExportImageButton'
import { HelpButton } from '../help/HelpButton'
import { HelpDialog } from '../help/HelpDialog'
import { FileMenu } from '../io/FileMenu'
import { PresentationButton } from '../presentation/PresentationButton'
import { RideButton } from '../ride/RideButton'
import { ThemeToggle } from '../theme/ThemeToggle'
import { Logo } from './Logo'
import { TopBarOverflow } from './TopBarOverflow'
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
        {/* Hidden in presentation mode (editing), and on phones, where TopBarOverflow holds them. */}
        <div className="topbar__collapsible topbar__history">
          <UndoRedoButtons />
          <span className="topbar__divider" aria-hidden="true" />
        </div>
        <RideButton />
        <ExportImageButton />
        <FileMenu />
        <div className="topbar__collapsible">
          <span className="topbar__divider" aria-hidden="true" />
          <PresentationButton />
          <HelpButton />
          <ThemeToggle />
        </div>
        <TopBarOverflow />
      </div>
      <HelpDialog />
    </header>
  )
}
