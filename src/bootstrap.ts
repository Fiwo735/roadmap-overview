import { toast } from './components/toast'
import { getMap } from './features/map/mapInstance'
import { initTheme } from './features/theme/theme'
import { restoreSavedTrip, startAutosave } from './store/persistence'
import { useRouteStore } from './store/routeStore'
import { useTripStore } from './store/tripStore'
import { useUiStore } from './store/uiStore'
import type {} from './types/debug'

/** Selection and hover ids that no longer exist (after undo, delete, import) must not linger. */
function keepSelectionValid(): void {
  useTripStore.subscribe((state, prev) => {
    if (state.trip === prev.trip) return
    const places = new Set(state.trip.places.map((p) => p.id))
    const legs = new Set(state.trip.legs.map((l) => l.id))
    const ui = useUiStore.getState()
    const next: Partial<ReturnType<typeof useUiStore.getState>> = {}
    if (ui.selectedPlaceId && !places.has(ui.selectedPlaceId)) next.selectedPlaceId = null
    if (ui.hoveredPlaceId && !places.has(ui.hoveredPlaceId)) next.hoveredPlaceId = null
    if (ui.expandedPlaceId && !places.has(ui.expandedPlaceId)) next.expandedPlaceId = null
    if (ui.renamingPlaceId && !places.has(ui.renamingPlaceId)) next.renamingPlaceId = null
    if (ui.selectedLegId && !legs.has(ui.selectedLegId)) next.selectedLegId = null
    if (ui.hoveredLegId && !legs.has(ui.hoveredLegId)) next.hoveredLegId = null
    if (Object.keys(next).length > 0) useUiStore.setState(next)
  })
}

/** Everything that must be in place before the first render: theme, saved trip, autosave, debug hook. */
export function bootstrap(): void {
  initTheme()

  if (restoreSavedTrip() === 'corrupt') {
    toast.error('Your last trip could not be restored, so a new one was started.')
  }
  startAutosave()
  keepSelectionValid()

  if (import.meta.env.DEV) {
    window.__ROADMAP__ = { trip: useTripStore, ui: useUiStore, routes: useRouteStore, getMap }
  }
}
