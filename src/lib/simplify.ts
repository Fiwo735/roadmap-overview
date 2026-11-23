import type { LatLng } from '../types/trip'
import { EARTH_RADIUS_M } from './geo'

const toRad = (deg: number) => (deg * Math.PI) / 180

/**
 * Douglas–Peucker line simplification: drops every vertex that lies within `toleranceM` metres of
 * the line through its kept neighbours. The first and last point are always kept. Distances are
 * measured in a flat projection around the path's mean latitude, which is exact enough for the
 * tolerances routing needs (tens of metres). The input is not modified.
 */
export function simplifyPath(points: readonly LatLng[], toleranceM: number): LatLng[] {
  const n = points.length
  if (n <= 2 || !(toleranceM > 0)) return points.slice()

  const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / n
  const kx = toRad(1) * Math.cos(toRad(meanLat)) * EARTH_RADIUS_M
  const ky = toRad(1) * EARTH_RADIUS_M
  // Longitudes are unwrapped step by step so a path that crosses the antimeridian stays in one piece.
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  xs[0] = points[0].lng * kx
  ys[0] = points[0].lat * ky
  for (let i = 1; i < n; i++) {
    const dLng = ((((points[i].lng - points[i - 1].lng) % 360) + 540) % 360) - 180
    xs[i] = xs[i - 1] + dLng * kx
    ys[i] = points[i].lat * ky
  }

  const distanceToSegment = (i: number, a: number, b: number): number => {
    const dx = xs[b] - xs[a]
    const dy = ys[b] - ys[a]
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((xs[i] - xs[a]) * dx + (ys[i] - ys[a]) * dy) / len2))
    return Math.hypot(xs[i] - (xs[a] + t * dx), ys[i] - (ys[a] + t * dy))
  }

  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  // Explicit stack: a route of tens of thousands of points would overflow the call stack.
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number]
    let farthest = -1
    let farthestDistance = toleranceM
    for (let i = lo + 1; i < hi; i++) {
      const d = distanceToSegment(i, lo, hi)
      if (d > farthestDistance) {
        farthestDistance = d
        farthest = i
      }
    }
    if (farthest < 0) continue
    keep[farthest] = 1
    stack.push([lo, farthest], [farthest, hi])
  }

  return points.filter((_, i) => keep[i] === 1)
}
