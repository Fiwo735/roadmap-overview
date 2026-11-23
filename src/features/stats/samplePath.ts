import { haversineM, latFromMercatorY, MAX_MERCATOR_LAT, mercatorY } from '../../lib/geo'
import type { LatLng } from '../../types/trip'

/** Segments longer than this are interpolated the way the map draws them (straight on screen). */
const MERCATOR_FROM_M = 20_000

function between(a: LatLng, b: LatLng, t: number, lengthM: number): LatLng {
  const lng = a.lng + (b.lng - a.lng) * t
  if (lengthM < MERCATOR_FROM_M || Math.abs(a.lat) > MAX_MERCATOR_LAT || Math.abs(b.lat) > MAX_MERCATOR_LAT) {
    return { lat: a.lat + (b.lat - a.lat) * t, lng }
  }
  const [ya, yb] = [mercatorY(a.lat), mercatorY(b.lat)]
  return { lat: latFromMercatorY(ya + (yb - ya) * t), lng }
}

/**
 * Points along the polyline every `stepM` metres, starting with its first point (so a path of at
 * least `stepM` has samples at 0, step, 2·step, …). Long straight segments (hand-drawn legs) are
 * interpolated in Mercator, i.e. where the line is drawn on the map, not on the great circle.
 */
export function samplePath(points: readonly LatLng[], stepM: number): LatLng[] {
  if (points.length === 0) return []
  const out: LatLng[] = [{ lat: points[0].lat, lng: points[0].lng }]
  let travelled = 0
  let due = stepM
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const length = haversineM(a, b)
    if (length === 0) continue
    while (due <= travelled + length) {
      out.push(between(a, b, (due - travelled) / length, length))
      due += stepM
    }
    travelled += length
  }
  return out
}
