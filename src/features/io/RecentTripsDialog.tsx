import { useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { IconButton } from '../../components/IconButton'
import { describeAge } from '../../lib/recentTrips'
import { removeRecentTrip, useRecentStore } from '../../store/recentTrips'
import { restoreRecentTrip } from './importTrip'
import './io.css'

interface RecentTripsDialogProps {
  open: boolean
  onClose: () => void
}

/** The trips that were replaced (newest first), each with "Restore" and "Forget". */
export function RecentTripsDialog({ open, onClose }: RecentTripsDialogProps) {
  const entries = useRecentStore((s) => s.entries)
  const now = useRecentStore((s) => s.loadedAt)

  // Another tab may have changed the list since this page last looked; the ages count from then.
  useEffect(() => {
    if (open) useRecentStore.getState().refresh()
  }, [open])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Recent trips"
      description="Trips that were replaced in this browser, newest first. Restoring one keeps the trip you have open in this list."
    >
      {entries.length === 0 ? (
        <p className="recent-empty" data-testid="recent-empty">
          Nothing here yet. A trip lands here when you open a file, a link or the sample, or start a new trip.
        </p>
      ) : (
        <ul className="recent-list" data-testid="recent-list">
          {entries.map((entry) => {
            const title = entry.title || 'Untitled trip'
            return (
              <li key={entry.id} className="recent-row" data-testid="recent-trip">
                <div className="recent-row__text">
                  <span className="recent-row__title">{title}</span>
                  <span className="recent-row__meta">
                    {entry.placeCount} place{entry.placeCount === 1 ? '' : 's'} · saved {describeAge(entry.savedAt, now)}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Restore ${title}`}
                  onClick={() => {
                    onClose()
                    void restoreRecentTrip(entry.id)
                  }}
                >
                  Restore
                </Button>
                <IconButton
                  label={`Forget ${title}`}
                  size="sm"
                  icon={<Trash2 size={16} />}
                  onClick={() => removeRecentTrip(entry.id)}
                />
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}
