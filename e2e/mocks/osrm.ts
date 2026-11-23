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
  /** Include each leg's steps (`steps=true`), which is where a ferry crossing shows up. */
  steps?: boolean
}

/**
 * Where the mocked road ends at the crossing between Dover and Calais, on each side. The real OSRM
 * demo server answers this pair with a "ferry"-mode step too (the Eurotunnel shuttle, Folkestone ⇄
 * Coquelles); the Hirtshals ⇄ Kristiansand ferry it does not use (it drives around, 1 370 km).
 */
export const FERRY_PORTS = {
  dover: { lat: 51.0953, lng: 1.1355 },
  calais: { lat: 50.9279, lng: 1.797 },
} as const

/** The crossing takes 35 minutes (the real one: 2 089 s) and is not subject to the road factor. */
export const FERRY_DURATION_S = 2_090
const NEAR_PORT_M = 25_000

/** Which end of the Dover ⇄ Calais crossing (if any) a point belongs to. */
function ferryEnd(p: LatLng): keyof typeof FERRY_PORTS | null {
  for (const end of ['dover', 'calais'] as const) {
    if (haversineM(p, FERRY_PORTS[end]) < NEAR_PORT_M) return end
  }
  return null
}

interface FakeStep {
  mode: 'driving' | 'ferry'
  path: LatLng[]
  distance: number
  duration: number
}

const roundTenth = (n: number) => Math.round(n * 10) / 10

function driveStep(a: LatLng, b: LatLng): FakeStep {
  const distance = roundTenth(haversineM(a, b) * ROAD_FACTOR)
  return { mode: 'driving', path: wigglePath(a, b), distance, duration: roundTenth((distance / 1000 / DRIVE_SPEED_KMH) * 3600) }
}

/**
 * The steps of one leg: a plain drive, or — between the Dover and the Calais area, in
 * either direction — a drive to the port, the ferry and a drive on from the other port.
 */
function legSteps(a: LatLng, b: LatLng): FakeStep[] {
  const from = ferryEnd(a)
  const to = ferryEnd(b)
  if (!from || !to || from === to) return [driveStep(a, b)]
  const portA = FERRY_PORTS[from]
  const portB = FERRY_PORTS[to]
  const crossing = [{ ...portA }, { lat: (portA.lat + portB.lat) / 2, lng: (portA.lng + portB.lng) / 2 }, { ...portB }]
  return [
    driveStep(a, portA),
    { mode: 'ferry', path: crossing, distance: roundTenth(haversineM(portA, portB)), duration: FERRY_DURATION_S },
    driveStep(portB, b),
  ]
}

/** An OSRM `/route/v1/driving` response (code "Ok") through `points`, with one leg per segment. */
export function fakeRoute(points: LatLng[], options: FakeRouteOptions = {}) {
  const full: LatLng[] = []
  const legs = []
  let distance = 0
  let duration = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const steps = legSteps(points[i], points[i + 1])
    // Each step starts where the one before ended: the shared point is only listed once.
    for (const step of steps) full.push(...(full.length === 0 ? step.path : step.path.slice(1)))
    const legDistance = roundTenth(steps.reduce((sum, st) => sum + st.distance, 0))
    const legDuration = roundTenth(steps.reduce((sum, st) => sum + st.duration, 0))
    distance += legDistance
    duration += legDuration
    legs.push({
      steps: options.steps
        ? steps.map((st) => ({
            mode: st.mode,
            distance: st.distance,
            duration: st.duration,
            weight: st.duration,
            name: '',
            geometry: encodePolyline(st.path),
            maneuver: { type: 'turn', location: [st.path[0].lng, st.path[0].lat] },
            intersections: [],
          }))
        : [],
      summary: '',
      weight: legDuration,
      duration: legDuration,
      distance: legDistance,
    })
  }
  distance = roundTenth(distance)
  duration = roundTenth(duration)

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
