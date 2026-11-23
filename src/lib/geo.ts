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
