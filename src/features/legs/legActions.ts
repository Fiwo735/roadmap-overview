import type { Leg, LegMode } from '../../types/trip'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import { getMap } from '../map/mapInstance'
import { needsRouter } from '../routing/legRoutes'
import { fitMapToLeg } from '../routing/mapFit'

/**
 * What the leg editor can change. Each call is one undo step (and does nothing when it would change
 * nothing). `straight` only means something for drive legs, so it is dropped when the mode leaves
 * 'drive' and a leg that comes back to 'drive' follows roads again.
 *
 * Via points mean something different on a road-routed leg (the road is forced through them) and on a
 * hand-drawn one (the line is drawn through them), so they do not survive a switch between the two
 * kinds — undo brings them back with the rest of the step. Switching among hand-drawn kinds (ferry,
 * train, flight, a straight drive) keeps them.
 */
function change(legId: string, mode: LegMode, straight: boolean): void {
  const store = useTripStore.getState()
  const leg: Leg | undefined = store.trip.legs.find((l) => l.id === legId)
  if (!leg) return
  const next = { mode, straight: straight ? true : undefined }
  const crossesKinds = needsRouter(leg) !== needsRouter(next)
  store.updateLeg(legId, { ...next, ...(crossesKinds ? { via: [] } : {}) })
}

export const setLegMode = (legId: string, mode: LegMode): void => change(legId, mode, false)

/** "Follow roads" off is a straight drive; on again goes back to the road route. */
export const setFollowRoads = (legId: string, follow: boolean): void => change(legId, 'drive', !follow)

/** `undefined` goes back to the routed or estimated duration. */
export const setLegDurationMin = (legId: string, minutes: number | undefined): void =>
  useTripStore.getState().updateLeg(legId, { durationMin: minutes })

/** An empty label clears it. */
export const setLegLabel = (legId: string, label: string): void =>
  useTripStore.getState().updateLeg(legId, { label: label.trim() || undefined })

/** Forget the shaping points: the leg goes back to its plain route. */
export const resetLegShape = (legId: string): void => useTripStore.getState().updateLeg(legId, { via: [] })

/**
 * Fit the map to the leg. Below the sidebar breakpoint the slide-over covers the map, so it closes to
 * show it (selecting a leg leaves it open, because its editor is in there).
 */
export function showLegOnMap(legId: string): void {
  fitMapToLeg(legId)
  if (getMap() && window.matchMedia('(max-width: 767px)').matches) useUiStore.getState().setSidebarOpen(false)
}
