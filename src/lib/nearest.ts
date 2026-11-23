import type { LatLng } from '../types/trip'
import { EARTH_RADIUS_M, haversineM } from './geo'

const toRad = (deg: number) => (deg * Math.PI) / 180

export interface PathProjection {
  /** The point of the path closest to the query point. */
  point: LatLng
  /** Distance in metres from the query point to `point`. */
  distanceM: number
  /** Index `i` of the segment path[i] → path[i + 1] that `point` lies on (0 for a one-point path). */
  segment: number
  /** Metres along the path from its first point to `point`; compares positions on one path. */
  alongM: number
}

/**
 * Project `point` onto the polyline `path`: the nearest point of the line and where it lies along it
 * (null when the path is empty). Uses a local flat projection around `point`, which is exact enough
 * for "which line is nearest" at any zoom a map click can come from. With `fromAlongM` only the part
 * of the path at or after that distance is considered, which keeps a sequence of points in order
 * even where a route passes the same spot twice.
 */
export function nearestOnPath(
  point: LatLng,
  path: readonly LatLng[],
  { fromAlongM = 0 }: { fromAlongM?: number } = {},
): PathProjection | null {
  if (path.length === 0) return null
  const cosLat = Math.cos(toRad(point.lat))
  // Wrap the longitude difference so the antimeridian does not split a path.
  const wrapLng = (dLng: number) => ((((dLng % 360) + 540) % 360) - 180)
  const project = (p: LatLng) => ({
    x: toRad(wrapLng(p.lng - point.lng)) * cosLat * EARTH_RADIUS_M,
    y: toRad(p.lat - point.lat) * EARTH_RADIUS_M,
  })
  if (path.length === 1) {
    const a = project(path[0])
    return { point: path[0], distanceM: Math.hypot(a.x, a.y), segment: 0, alongM: 0 }
  }

  let best: PathProjection | null = null
  let a = project(path[0])
  let cumulative = 0
  for (let i = 1; i < path.length; i++) {
    const b = project(path[i])
    const length = haversineM(path[i - 1], path[i])
    const segmentEnd = cumulative + length
    if (segmentEnd >= fromAlongM) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      // The query point is the origin: parameter of its projection onto a→b, clamped to the segment
      // (and to the part at or after `fromAlongM`).
      const tMin = length > 0 ? Math.max(0, (fromAlongM - cumulative) / length) : 0
      const t = len2 === 0 ? tMin : Math.min(1, Math.max(tMin, -(a.x * dx + a.y * dy) / len2))
      const distanceM = Math.hypot(a.x + t * dx, a.y + t * dy)
      if (!best || distanceM < best.distanceM) {
        const from = path[i - 1]
        const to = path[i]
        best = {
          point: { lat: from.lat + t * (to.lat - from.lat), lng: from.lng + t * wrapLng(to.lng - from.lng) },
          distanceM,
          segment: i - 1,
          alongM: cumulative + t * length,
        }
      }
    }
    cumulative = segmentEnd
    a = b
  }
  if (best) return best
  // `fromAlongM` lies beyond the end of the path: the end is the closest allowed point.
  return { ...(nearestOnPath(point, path.slice(-1)) as PathProjection), segment: path.length - 2, alongM: cumulative }
}

/**
 * Distance in metres from `point` to the polyline through `path` (to its single point when the path
 * has one; Infinity when it is empty).
 */
export function distanceToPathM(point: LatLng, path: readonly LatLng[]): number {
  return nearestOnPath(point, path)?.distanceM ?? Infinity
}

/**
 * Where a point the user grabbed on a leg's line becomes a via point: the index into the leg's
 * existing `via` list (0 … via.length). `path` is the leg's current geometry, which passes through
 * the existing via points in order; each of them is located along it (never earlier than the one
 * before) and the new point goes after those that lie before it.
 */
export function viaInsertIndex(path: readonly LatLng[], via: readonly LatLng[], point: LatLng): number {
  const target = nearestOnPath(point, path)
  if (!target) return via.length
  let index = 0
  let from = 0
  for (const v of via) {
    const located = nearestOnPath(v, path, { fromAlongM: from })
    if (!located || located.alongM > target.alongM) break
    from = located.alongM
    index++
  }
  return index
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
