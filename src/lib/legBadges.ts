import type { LatLng, LegMode, RouteSpan } from '../types/trip'
import { pointAlongPath } from './geo'
import { splitSpans } from './routeSpans'

/** A mode badge to draw on the map: which mode, and where (the middle of the stretch it stands for). */
export interface BadgeSpot {
  mode: LegMode
  at: LatLng
}

/**
 * Where a leg's mode badges go. A ferry, train or flight leg has one badge at the middle of its line;
 * a drive leg has none, except one per ferry crossing its route contains (`spans`).
 */
export function legBadgeSpots(mode: LegMode, coords: readonly LatLng[], spans?: readonly RouteSpan[]): BadgeSpot[] {
  const stretches = mode === 'drive' ? splitSpans(coords, spans).ferry : [coords]
  const stretchMode: LegMode = mode === 'drive' ? 'ferry' : mode
  return stretches.flatMap((stretch) => {
    const at = pointAlongPath(stretch, 0.5)
    return at ? [{ mode: stretchMode, at }] : []
  })
}
