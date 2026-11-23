import type { LatLng, RouteSpan } from '../types/trip'
import { haversineM, latFromMercatorY, MAX_MERCATOR_LAT, mercatorY } from './geo'

/** A polyline with its cumulative lengths, so a point at any distance along it is a binary search away. */
export interface PathIndex {
  points: readonly LatLng[]
  /** `cumulative[i]`: metres from `points[0]` to `points[i]` (so `cumulative[0]` is 0). */
  cumulative: readonly number[]
  /** Total length in metres. */
  length: number
}

export interface PathPosition {
  point: LatLng
  /** Index `i` of the segment `points[i] → points[i + 1]` the point lies on (0 for a one-point path). */
  segment: number
}

export function createPathIndex(points: readonly LatLng[]): PathIndex {
  const cumulative: number[] = points.length > 0 ? [0] : []
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + haversineM(points[i - 1], points[i]))
  return { points, cumulative, length: cumulative.at(-1) ?? 0 }
}

/** The segment `i` such that `cumulative[i] ≤ distance` (the last one wins on ties), clamped to the path. */
function segmentAt(index: PathIndex, distance: number): number {
  const { cumulative } = index
  let lo = 0
  let hi = cumulative.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cumulative[mid] <= distance) lo = mid
    else hi = mid - 1
  }
  return Math.max(0, lo)
}

/**
 * The point `distanceM` along the path (clamped to its ends). Inside a segment the point is
 * interpolated the way the map draws the segment, as a straight line on screen (see `pointAlongPath`
 * in geo.ts), so a vehicle sits on the drawn line even on a long straight stretch such as a ferry.
 * Null for an empty path.
 */
export function positionAt(index: PathIndex, distanceM: number): PathPosition | null {
  const { points, cumulative, length } = index
  if (points.length === 0) return null
  if (points.length === 1) return { point: { ...points[0] }, segment: 0 }
  const d = Math.min(length, Math.max(0, distanceM))
  const segment = segmentAt(index, d)
  const [a, b] = [points[segment], points[segment + 1]]
  const span = cumulative[segment + 1] - cumulative[segment]
  const t = span > 0 ? Math.min(1, (d - cumulative[segment]) / span) : 0
  // Exact at the vertices: no round trip through Mercator noise.
  if (t === 0) return { point: { ...a }, segment }
  if (t === 1) return { point: { ...b }, segment }
  const lng = a.lng + (b.lng - a.lng) * t
  const flat = Math.abs(a.lat) > MAX_MERCATOR_LAT || Math.abs(b.lat) > MAX_MERCATOR_LAT
  const lat = flat ? a.lat + (b.lat - a.lat) * t : latFromMercatorY(mercatorY(a.lat) + (mercatorY(b.lat) - mercatorY(a.lat)) * t)
  return { point: { lat, lng }, segment }
}

/**
 * Direction of travel at `distanceM`, in degrees clockwise from the top of the map (0 north, 90 east),
 * measured on screen (Mercator) between the points `windowM` before and after, so a wiggle in the
 * road does not turn the vehicle. Null where there is no direction (an empty or zero-length path).
 */
export function headingAt(index: PathIndex, distanceM: number, windowM = 1500): number | null {
  if (index.length <= 0) return null
  const from = positionAt(index, distanceM - windowM)
  const to = positionAt(index, distanceM + windowM)
  if (!from || !to) return null
  // The shortest way round the antimeridian.
  const dLng = ((((to.point.lng - from.point.lng) % 360) + 540) % 360) - 180
  const dx = (dLng * Math.PI) / 180
  const dy = mercatorY(to.point.lat) - mercatorY(from.point.lat)
  if (dx === 0 && dy === 0) return null
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
}

/**
 * The first `distanceM` of the path as a polyline (its points up to there, then the exact position),
 * plus the spans clipped to it. The clipped spans keep the contract of `LegRoute.spans` for the new,
 * shorter geometry, so `splitSpans` can split the travelled part like the whole route.
 */
export function clipPath(
  index: PathIndex,
  spans: readonly RouteSpan[] | undefined,
  distanceM: number,
): { coords: LatLng[]; spans: RouteSpan[] | undefined } {
  const here = positionAt(index, distanceM)
  if (!here) return { coords: [], spans: undefined }
  const { segment, point } = here
  const coords = index.points.slice(0, segment + 1).map((p) => ({ ...p }))
  coords.push(point)
  if (!spans || spans.length === 0) return { coords, spans: undefined }
  const last = coords.length - 1
  const clipped = spans.filter((s) => s.from < last).map((s) => ({ ...s, to: Math.min(s.to, last) }))
  return { coords, spans: clipped.length > 0 ? clipped : undefined }
}
