import { haversineM } from '../../src/lib/geo'
import { encodePolyline } from '../../src/lib/polyline'
import type { LatLng } from '../../src/types/trip'

/** Real roads are longer than the crow flies; the fake uses this factor for distance. */
export const ROAD_FACTOR = 1.25
export const DRIVE_SPEED_KMH = 75

export class OsrmError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}

/** Parse the `{lng,lat;lng,lat;…}` path segment of an OSRM route request. */
export function parseCoordinates(segment: string): LatLng[] {
  const points = decodeURIComponent(segment)
    .split(';')
    .map((pair) => {
      const [lng, lat] = pair.split(',').map(Number)
      return { lat, lng }
    })
  const valid = points.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  if (points.length < 2 || !valid) throw new OsrmError('InvalidQuery')
  if (points.length > 100) throw new OsrmError('TooBig')
  return points
}

/** Deterministic pseudo-random phase from the segment endpoints, so a route looks the same each run. */
function phaseOf(a: LatLng, b: LatLng): number {
  return ((Math.abs(a.lat * 131 + a.lng * 71 + b.lat * 29 + b.lng * 13) * 1000) % 628) / 100
}

/**
 * A polyline from `a` to `b` with a gentle sideways wiggle that vanishes at both ends, so the
 * line passes exactly through the requested coordinates.
 */
export function wigglePath(a: LatLng, b: LatLng): LatLng[] {
  const distKm = haversineM(a, b) / 1000
  const steps = Math.min(90, Math.max(8, Math.ceil(distKm / 4)))
  const dLat = b.lat - a.lat
  const dLng = b.lng - a.lng
  const len = Math.hypot(dLat, dLng) || 1
  // Unit normal in degree space; amplitude ~1.8% of the segment length.
  const nLat = -dLng / len
  const nLng = dLat / len
  const amp = len * 0.018
  const phase = phaseOf(a, b)
  const out: LatLng[] = []
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    const wiggle = Math.sin(Math.PI * t) * (0.7 * Math.sin(6 * Math.PI * t + phase) + 0.3 * Math.sin(17 * t + phase))
    out.push({ lat: a.lat + dLat * t + nLat * amp * wiggle, lng: a.lng + dLng * t + nLng * amp * wiggle })
  }
  out[0] = { ...a }
  out[out.length - 1] = { ...b }
  return out
}

export interface FakeRouteOptions {
  geometries?: 'polyline' | 'geojson'
  overview?: 'full' | 'simplified' | 'false'
}

/** An OSRM `/route/v1/driving` response (code "Ok") through `points`, with one leg per segment. */
export function fakeRoute(points: LatLng[], options: FakeRouteOptions = {}) {
  const full: LatLng[] = []
  const legs = []
  let distance = 0
  let duration = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const path = wigglePath(points[i], points[i + 1])
    full.push(...(i === 0 ? path : path.slice(1)))
    const legDistance = Math.round(haversineM(points[i], points[i + 1]) * ROAD_FACTOR * 10) / 10
    const legDuration = Math.round((legDistance / 1000 / DRIVE_SPEED_KMH) * 3600 * 10) / 10
    distance += legDistance
    duration += legDuration
    legs.push({ steps: [], summary: '', weight: legDuration, duration: legDuration, distance: legDistance })
  }
  distance = Math.round(distance * 10) / 10
  duration = Math.round(duration * 10) / 10

  const geometry =
    options.geometries === 'geojson'
      ? { type: 'LineString', coordinates: full.map((p) => [p.lng, p.lat]) }
      : encodePolyline(full)

  const route: Record<string, unknown> = {
    weight_name: 'routability',
    weight: duration,
    duration,
    distance,
    legs,
  }
  if (options.overview !== 'false') route.geometry = geometry

  return {
    code: 'Ok',
    routes: [route],
    waypoints: points.map((p, i) => ({
      hint: `mock-hint-${i}`,
      distance: 3.2,
      name: '',
      location: [p.lng, p.lat],
    })),
  }
}
