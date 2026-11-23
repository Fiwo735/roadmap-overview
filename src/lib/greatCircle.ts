import type { LatLng } from '../types/trip'
import { haversineM } from './geo'

/** How many steps one arc is drawn with (a smooth curve at any zoom a trip is viewed at). */
export const ARC_SEGMENTS = 64

const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

/**
 * The great circle (shortest line on the globe) from `a` to `b` as `segments + 1` points, endpoints
 * included exactly. Longitudes are continuous (they may leave ±180 when the arc crosses the
 * antimeridian) so Leaflet draws one line instead of one that jumps across the world. Coincident
 * and (nearly) antipodal points have no well-defined arc and give the straight pair.
 */
export function greatCirclePath(a: LatLng, b: LatLng, segments: number = ARC_SEGMENTS): LatLng[] {
  const start: LatLng = { lat: a.lat, lng: a.lng }
  const end: LatLng = { lat: b.lat, lng: b.lng }
  const angle = haversineM(a, b) / 6_371_008.8
  if (!(segments >= 2) || angle < 1e-9 || Math.sin(angle) < 1e-6) return [start, end]

  const [lat1, lng1, lat2, lng2] = [toRad(a.lat), toRad(a.lng), toRad(b.lat), toRad(b.lng)]
  const out: LatLng[] = [start]
  let lastLng = a.lng
  const unwrap = (lng: number) => lng + 360 * Math.round((lastLng - lng) / 360)
  for (let i = 1; i < segments; i++) {
    const f = i / segments
    const wa = Math.sin((1 - f) * angle) / Math.sin(angle)
    const wb = Math.sin(f * angle) / Math.sin(angle)
    const x = wa * Math.cos(lat1) * Math.cos(lng1) + wb * Math.cos(lat2) * Math.cos(lng2)
    const y = wa * Math.cos(lat1) * Math.sin(lng1) + wb * Math.cos(lat2) * Math.sin(lng2)
    const z = wa * Math.sin(lat1) + wb * Math.sin(lat2)
    lastLng = unwrap(toDeg(Math.atan2(y, x)))
    out.push({ lat: toDeg(Math.atan2(z, Math.hypot(x, y))), lng: lastLng })
  }
  out.push({ lat: end.lat, lng: unwrap(end.lng) })
  return out
}

/** A smooth line through all `points`: a great-circle arc between each consecutive pair. */
export function greatCirclePathThrough(points: readonly LatLng[], segments: number = ARC_SEGMENTS): LatLng[] {
  const out: LatLng[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    // Continue from where the previous arc ended, which keeps longitudes continuous across via points.
    const from = out.length > 0 ? out[out.length - 1] : points[i]
    const arc = greatCirclePath(from, points[i + 1], segments)
    out.push(...(out.length > 0 ? arc.slice(1) : arc))
  }
  return out
}
