import type { LatLng } from '../types/trip'
import { EARTH_RADIUS_M } from './geo'

const toRad = (deg: number) => (deg * Math.PI) / 180

/**
 * Distance in metres from `point` to the polyline through `path` (to its single point when the path
 * has one; Infinity when it is empty). Uses a local flat projection around `point`, which is exact
 * enough for "which line is nearest" at any zoom a map click can come from.
 */
export function distanceToPathM(point: LatLng, path: readonly LatLng[]): number {
  if (path.length === 0) return Infinity
  const cosLat = Math.cos(toRad(point.lat))
  const project = (p: LatLng) => {
    // Wrap the longitude difference so the antimeridian does not split a path.
    const dLng = ((((p.lng - point.lng) % 360) + 540) % 360) - 180
    return { x: toRad(dLng) * cosLat * EARTH_RADIUS_M, y: toRad(p.lat - point.lat) * EARTH_RADIUS_M }
  }
  let best = Infinity
  let a = project(path[0])
  if (path.length === 1) return Math.hypot(a.x, a.y)
  for (let i = 1; i < path.length; i++) {
    const b = project(path[i])
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    // The point is the origin: parameter of its projection onto a→b, clamped to the segment.
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / len2))
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy))
    a = b
  }
  return best
}

/**
 * Where to insert a new place at `point` so it lands between the two consecutive places whose leg
 * passes nearest to it: the index into `places` (1 … n-1). `legPath(i)` may supply the real route
 * geometry of leg i (places[i] → places[i+1]); without it the straight segment is used. With fewer
 * than two places there is no leg, so the place is appended.
 */
export function insertIndexNear(
  places: readonly LatLng[],
  point: LatLng,
  legPath?: (legIndex: number) => readonly LatLng[] | undefined,
): number {
  if (places.length < 2) return places.length
  let bestLeg = 0
  let bestDistance = Infinity
  for (let i = 0; i + 1 < places.length; i++) {
    const path = legPath?.(i)
    const d = distanceToPathM(point, path && path.length >= 2 ? path : [places[i], places[i + 1]])
    if (d < bestDistance) {
      bestDistance = d
      bestLeg = i
    }
  }
  return bestLeg + 1
}
