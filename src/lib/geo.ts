import type { LatLng } from '../types/trip'

export const EARTH_RADIUS_M = 6_371_008.8

const toRad = (deg: number) => (deg * Math.PI) / 180

export const isLat = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 90
export const isLng = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 180

/** True for an object with finite, in-range `lat` (±90) and `lng` (±180). */
export function isValidLatLng(value: unknown): value is LatLng {
  if (typeof value !== 'object' || value === null) return false
  const { lat, lng } = value as Partial<Record<'lat' | 'lng', unknown>>
  return isLat(lat) && isLng(lng)
}

/** Great-circle distance in metres between two coordinates (haversine). */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Length in metres of the polyline through `points` (0 for fewer than two points). */
export function pathLengthM(points: readonly LatLng[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i])
  return total
}

export interface Bounds {
  south: number
  west: number
  north: number
  east: number
}

/** Smallest lat/lng box containing all points, or null when there are none. */
export function boundsOf(points: readonly LatLng[]): Bounds | null {
  if (points.length === 0) return null
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  for (const p of points) {
    if (p.lat < south) south = p.lat
    if (p.lat > north) north = p.lat
    if (p.lng < west) west = p.lng
    if (p.lng > east) east = p.lng
  }
  return { south, west, north, east }
}

/** Web-Mercator "y" of a latitude (the map is drawn in it, so straight lines on screen are straight in it). */
const mercatorY = (latDeg: number) => Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360))
const latFromMercatorY = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI

/** Leaflet's maps stop at this latitude; beyond it the projection is not defined. */
const MAX_MERCATOR_LAT = 85

/**
 * The point `fraction` (0 … 1) of the way along the polyline through `points`, measured by length
 * (0.5 is the middle of the line, wherever its vertices happen to be). Inside a segment the point is
 * interpolated the way the map draws it — as a straight line on screen — so a badge placed there sits
 * on the drawn line even for a long straight segment. Null for an empty path.
 */
export function pointAlongPath(points: readonly LatLng[], fraction: number): LatLng | null {
  if (points.length === 0) return null
  const total = pathLengthM(points)
  if (points.length === 1 || total === 0) return { lat: points[0].lat, lng: points[0].lng }
  let remaining = Math.min(1, Math.max(0, fraction)) * total
  for (let i = 1; i < points.length; i++) {
    const length = haversineM(points[i - 1], points[i])
    if (remaining <= length && length > 0) {
      const t = remaining / length
      const [a, b] = [points[i - 1], points[i]]
      const lng = a.lng + (b.lng - a.lng) * t
      if (Math.abs(a.lat) > MAX_MERCATOR_LAT || Math.abs(b.lat) > MAX_MERCATOR_LAT) return { lat: a.lat + (b.lat - a.lat) * t, lng }
      const [ya, yb] = [mercatorY(a.lat), mercatorY(b.lat)]
      return { lat: latFromMercatorY(ya + (yb - ya) * t), lng }
    }
    remaining -= length
  }
  const last = points[points.length - 1]
  return { lat: last.lat, lng: last.lng }
}
