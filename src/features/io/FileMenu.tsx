import { useEffect, useState } from 'react'
import { ChevronDown, Download, FilePlus, FolderOpen, History, Link2, Sparkles } from 'lucide-react'
import { Button } from '../../components/Button'
import { Menu, type MenuEntry } from '../../components/Menu'
import { toast } from '../../components/toast'
import { useRecentStore } from '../../store/recentTrips'
import { undo, useTripStore } from '../../store/tripStore'
import { shortcutLabel } from '../layout/shortcuts'
import { ConfirmHost } from './ConfirmHost'
import { DropOverlay } from './DropOverlay'
import { RecentTripsDialog } from './RecentTripsDialog'
import { askToConfirm } from './confirm'
import { copyShareLink, saveTripFile } from './exportTrip'
import { useFileShortcuts } from './fileShortcuts'
import { pickTripFile } from './filePicker'
import { keepOpenTrip, loadSampleTrip } from './importTrip'
import './io.css'

function startNewTrip(): void {
  // The user was asked already (a trip with places) and the new trip can be undone: no second question
  // when the recent list cannot take the old one.
  keepOpenTrip()
  useTripStore.getState().newTrip()
  toast.info('Started a new trip.', { action: { label: 'Undo', onClick: undo } })
}

/**
 * Top bar slot: the File menu (new, open, save, share, sample, recent trips) plus everything that goes
 * with it and has no other home — the Ctrl+S / Ctrl+O shortcuts, the confirm dialog (also used when an
 * import would replace a trip that cannot be kept), the recent-trips dialog and the drop overlay.
 */
export function FileMenu() {
  const trip = useTripStore((s) => s.trip)
  const recentCount = useRecentStore((s) => s.entries.length)
  const [showingRecent, setShowingRecent] = useState(false)
  useFileShortcuts()
  useEffect(() => useRecentStore.getState().refresh(), [])

  const placeCount = trip.places.length
  const empty = placeCount === 0
  const askAboutNewTrip = () =>
    void askToConfirm({
      title: 'Start a new trip?',
      description: `“${trip.title || 'Untitled trip'}” and its ${placeCount} place${placeCount === 1 ? '' : 's'} will be replaced by an empty trip. You can undo this afterwards, and the trip stays in Recent trips.`,
      confirmLabel: 'New trip',
    }).then((confirmed) => {
      if (confirmed) startNewTrip()
    })

  const items: MenuEntry[] = [
    { id: 'new', label: 'New trip', icon: <FilePlus size={16} />, onSelect: empty ? startNewTrip : askAboutNewTrip },
    { id: 'open', label: 'Open trip file…', icon: <FolderOpen size={16} />, shortcut: shortcutLabel('O'), onSelect: pickTripFile },
    { id: 'save', label: 'Save as JSON', icon: <Download size={16} />, shortcut: shortcutLabel('S'), disabled: empty, onSelect: saveTripFile },
    { type: 'separator', id: 'sep-share' },
    { id: 'share', label: 'Copy share link', icon: <Link2 size={16} />, disabled: empty, onSelect: () => void copyShareLink() },
    { type: 'separator', id: 'sep-more' },
    { id: 'sample', label: 'Load sample trip', icon: <Sparkles size={16} />, onSelect: () => void loadSampleTrip() },
    { id: 'recent', label: 'Recent trips…', icon: <History size={16} />, disabled: recentCount === 0, onSelect: () => setShowingRecent(true) },
  ]

  return (
    <>
      <Menu
        label="File"
        align="end"
        items={items}
        trigger={(props) => (
          <Button {...props} variant="ghost" aria-label="File" className="file-menu__button" data-testid="file-menu">
            <FolderOpen size={16} />
            <span className="file-menu__label">File</span>
            <ChevronDown size={14} />
          </Button>
        )}
      />
      <RecentTripsDialog open={showingRecent} onClose={() => setShowingRecent(false)} />
      <ConfirmHost />
      <DropOverlay />
    </>
  )
}
