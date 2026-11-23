import { useEffect } from 'react'
import { CircleHelp, MapPinPlus, Sparkles, X } from 'lucide-react'
import { Button } from '../../components/Button'
import { IconButton } from '../../components/IconButton'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import { loadSampleTrip } from '../io/importTrip'
import { usePresentationStore } from '../presentation/presentationStore'
import { openHelp } from './helpActions'
import { dismissWelcome, useWelcomeStore } from './welcomeStore'

/** Focus the "Add a place…" box (opening the slide-over on a phone first). */
function focusAddBox(): void {
  if (window.matchMedia('(max-width: 767px)').matches) useUiStore.getState().setSidebarOpen(true)
  // After the slide-over has taken the focus itself.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-testid="add-search"] input')?.focus()),
  )
}

/**
 * First visit with an empty trip: a short card on the map pointing at the three ways in (search, the
 * sample trip, Help). Remembered in localStorage; it never comes back once it was dismissed or a trip
 * has had places.
 */
export function WelcomeHint() {
  const seen = useWelcomeStore((s) => s.seen)
  const hasPlaces = useTripStore((s) => s.trip.places.length > 0)
  const presenting = usePresentationStore((s) => s.on)

  // A trip with places (restored, opened, built) means this is no newcomer's empty page any more.
  useEffect(() => {
    if (hasPlaces && !seen) dismissWelcome()
  }, [hasPlaces, seen])

  if (seen || hasPlaces || presenting) return null
  return (
    <section className="welcome-hint" aria-label="Getting started" data-testid="welcome-hint">
      <div className="welcome-hint__head">
        <h2 className="welcome-hint__title">Plan your trip on the map</h2>
        <IconButton size="sm" label="Dismiss" tooltip="Dismiss, don’t show again" icon={<X size={16} />} onClick={dismissWelcome} data-testid="welcome-dismiss" />
      </div>
      <p className="welcome-hint__text">
        Search for your first stop, right-click the map (long-press on a phone) to drop one, or open the sample trip to see what it can do.
      </p>
      <div className="welcome-hint__actions">
        <Button size="sm" variant="primary" icon={<MapPinPlus size={16} />} onClick={focusAddBox}>
          Add a place
        </Button>
        <Button size="sm" variant="secondary" icon={<Sparkles size={16} />} onClick={() => void loadSampleTrip()} data-testid="welcome-sample">
          Sample trip
        </Button>
        <Button size="sm" variant="ghost" icon={<CircleHelp size={16} />} onClick={openHelp}>
          How it works
        </Button>
      </div>
    </section>
  )
}
