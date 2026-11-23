import polyline from '@mapbox/polyline'
import type { LatLng } from '../types/trip'

const PRECISION = 5
const CACHE_LIMIT = 300

const cache = new Map<string, LatLng[]>()

/** Encode points as a precision-5 polyline (the Google/OSRM format). */
export function encodePolyline(points: readonly LatLng[]): string {
  return polyline.encode(
    points.map((p): [number, number] => [p.lat, p.lng]),
    PRECISION,
  )
}

/**
 * Decode without the memo cache or freezing, for validating untrusted input. Garbage in gives
 * garbage out (possibly NaN or out-of-range values), never an exception.
 */
export function decodePolylineUncached(encoded: string): LatLng[] {
  return polyline.decode(encoded, PRECISION).map(([lat, lng]): LatLng => ({ lat, lng }))
}

/**
 * Decode a precision-5 polyline. Results are memoised (oldest entries evicted beyond a size cap)
 * because the same geometry is decoded on every render, hover and ride frame. The returned array
 * is shared and frozen: copy it before modifying.
 */
export function decodePolyline(encoded: string): LatLng[] {
  const hit = cache.get(encoded)
  if (hit) {
    // Re-insert so Map order tracks recency.
    cache.delete(encoded)
    cache.set(encoded, hit)
    return hit
  }
  const points = Object.freeze(decodePolylineUncached(encoded)) as LatLng[]
  cache.set(encoded, points)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  return points
}

/** Test hook: current memo size. */
export function decodeCacheSize(): number {
  return cache.size
}
