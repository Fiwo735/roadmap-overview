import type { LatLng, Leg, LegRoute, Place, Trip, TripFile } from '../types/trip'
import { haversineM, isValidLatLng } from './geo'
import { newId } from './id'
import { decodePolylineUncached } from './polyline'
import { legRouteKey } from './routeKey'
import { areValidSpans } from './routeSpans'
import { DEFAULT_TRIP_TITLE, defaultDayAt, isCalendarDate, isLegMode, normalizeDay, syncLegs } from './trip'

export const TRIP_FILE_FORMAT = 'roadmap-overview/trip'
export const TRIP_FILE_VERSION = 1

export type ParseTripFileResult =
  | {
      ok: true
      file: TripFile
      /** Non-fatal repairs that were applied, for the UI to mention if it wants to. */
      warnings: string[]
    }
  | { ok: false; error: string }

/** Build the on-disk / share / autosave representation. `routes` is keyed by LEG ID. */
export function serializeTripFile(trip: Trip, routesByLegId: Record<string, LegRoute> = {}): TripFile {
  const legIds = new Set(trip.legs.map((l) => l.id))
  const routes: Record<string, LegRoute> = {}
  for (const [legId, route] of Object.entries(routesByLegId)) {
    if (legIds.has(legId)) routes[legId] = route
  }
  return {
    format: TRIP_FILE_FORMAT,
    version: TRIP_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    trip,
    routes,
  }
}

/** Pick the cached routes that belong to the trip's current legs, keyed by leg id. */
export function collectLegRoutes(trip: Trip, routesByKey: Record<string, LegRoute>): Record<string, LegRoute> {
  const placesById = new Map(trip.places.map((p) => [p.id, p]))
  const out: Record<string, LegRoute> = {}
  for (const leg of trip.legs) {
    const from = placesById.get(leg.fromId)
    const to = placesById.get(leg.toId)
    if (!from || !to) continue
    const route = routesByKey[legRouteKey(from, to, leg)]
    if (route) out[leg.id] = route
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Parsing

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

function parseLatLng(v: unknown): LatLng | null {
  return isValidLatLng(v) ? { lat: v.lat, lng: v.lng } : null
}

class FileError extends Error {}

function parsePlaces(raw: unknown, warnings: string[]): Place[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new FileError('"trip.places" must be a list.')
  const places: Place[] = []
  const seen = new Set<string>()
  raw.forEach((item, i) => {
    const label = `Place ${i + 1}`
    // One bad place must not cost the user the whole trip: drop it and keep the rest.
    if (!isRecord(item)) {
      warnings.push(`${label} was not an object and was dropped.`)
      return
    }
    const coords = parseLatLng(item)
    if (!coords) {
      warnings.push(`${label} has missing or invalid coordinates and was dropped.`)
      return
    }
    if (typeof item.name !== 'string') warnings.push(`${label} had no name; it was left blank.`)

    let id = nonEmptyString(item.id) ? item.id : ''
    if (!id || seen.has(id)) {
      id = newId('p')
      warnings.push(`${label} had a missing or duplicate id; a new one was assigned.`)
    }
    seen.add(id)

    let day: number
    if (isFiniteNumber(item.day)) {
      day = normalizeDay(item.day)
      if (day !== item.day) warnings.push(`${label}: day ${item.day} was changed to ${day}.`)
    } else {
      day = defaultDayAt(places, places.length)
      warnings.push(`${label} had no valid day; it was set to ${day}.`)
    }

    const place: Place = { id, name: typeof item.name === 'string' ? item.name : '', lat: coords.lat, lng: coords.lng, day }
    if (typeof item.address === 'string' && item.address) place.address = item.address
    if (item.customName === true) place.customName = true
    if (typeof item.note === 'string' && item.note) place.note = item.note
    places.push(place)
  })
  return places
}

function parseVia(raw: unknown, warnings: string[], label: string): LatLng[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    warnings.push(`${label}: via points were not a list and were dropped.`)
    return []
  }
  const via: LatLng[] = []
  for (const item of raw) {
    const point = parseLatLng(item)
    if (point) via.push(point)
    else warnings.push(`${label}: an invalid via point was dropped.`)
  }
  return via
}

function parseLegs(raw: unknown, warnings: string[]): Leg[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    warnings.push('"trip.legs" was not a list; legs were reset.')
    return []
  }
  const legs: Leg[] = []
  const seen = new Set<string>()
  raw.forEach((item, i) => {
    const label = `Leg ${i + 1}`
    if (!isRecord(item) || !nonEmptyString(item.fromId) || !nonEmptyString(item.toId)) {
      warnings.push(`${label} was malformed and was dropped.`)
      return
    }
    let mode: Leg['mode'] = 'drive'
    if (isLegMode(item.mode)) {
      mode = item.mode
    } else {
      warnings.push(`${label} had an unknown mode and was changed to drive.`)
    }
    let id = nonEmptyString(item.id) ? item.id : ''
    if (!id || seen.has(id)) id = newId('l')
    seen.add(id)

    const leg: Leg = { id, fromId: item.fromId, toId: item.toId, mode, via: parseVia(item.via, warnings, label) }
    if (item.straight === true && mode === 'drive') leg.straight = true
    if (isFiniteNumber(item.durationMin) && item.durationMin > 0) leg.durationMin = item.durationMin
    else if (item.durationMin !== undefined) warnings.push(`${label}: an invalid duration was dropped.`)
    if (typeof item.label === 'string' && item.label) leg.label = item.label
    legs.push(leg)
  })
  return legs
}

/** OSRM snaps endpoints to the nearest road, so only reject routes that start/end far away. */
const MAX_ENDPOINT_GAP_M = 25_000
/** Longest geometry string worth decoding; real full-overview routes are far shorter. */
const MAX_GEOMETRY_CHARS = 2_000_000

type RouteCheck = { route: LegRoute; note?: string } | { problem: string }

/** Validate a cached route against the leg it claims to belong to. */
function parseRoute(raw: unknown, from: LatLng, to: LatLng): RouteCheck {
  if (!isRecord(raw)) return { problem: 'is not an object' }
  const { key, geometry, distanceM, durationS, source } = raw
  if (!nonEmptyString(key)) return { problem: 'has no key' }
  if (source !== 'osrm' && source !== 'manual') return { problem: 'has an unknown source' }
  if (!isFiniteNumber(distanceM) || distanceM < 0 || !isFiniteNumber(durationS) || durationS < 0) {
    return { problem: 'has an invalid distance or duration' }
  }
  if (typeof geometry !== 'string' || geometry.length > MAX_GEOMETRY_CHARS) {
    return { problem: 'has no usable geometry' }
  }
  const points = decodePolylineUncached(geometry)
  if (points.length < 2 || !points.every(isValidLatLng)) return { problem: 'has an invalid geometry' }
  if (haversineM(points[0], from) > MAX_ENDPOINT_GAP_M || haversineM(points[points.length - 1], to) > MAX_ENDPOINT_GAP_M) {
    return { problem: 'does not connect its two places' }
  }
  const route: LegRoute = { key, geometry, distanceM, durationS, source }
  // The ferry stretches only decorate the line: when they do not fit the geometry the route is
  // still good, it just draws as one piece (and says so).
  if (raw.spans !== undefined) {
    if (!areValidSpans(raw.spans, points.length)) return { route, note: 'its ferry sections were invalid and were ignored' }
    route.spans = raw.spans.map(({ mode, from, to, distanceM: d, durationS: t }) => ({ mode, from, to, distanceM: d, durationS: t }))
  }
  return { route }
}

function parseTrip(raw: unknown, warnings: string[]): Trip {
  if (!isRecord(raw)) throw new FileError('The file has no trip data.')
  const places = parsePlaces(raw.places, warnings)
  const parsedLegs = parseLegs(raw.legs, warnings)
  const legs = syncLegs(places, parsedLegs)
  const orphans = parsedLegs.filter((leg) => !legs.includes(leg)).length
  if (orphans > 0) {
    warnings.push(`${orphans} leg${orphans === 1 ? '' : 's'} did not join neighbouring places and ${orphans === 1 ? 'was' : 'were'} dropped.`)
  }
  const trip: Trip = {
    id: nonEmptyString(raw.id) ? raw.id : newId('t'),
    title: typeof raw.title === 'string' ? raw.title : DEFAULT_TRIP_TITLE,
    places,
    legs,
  }
  if (typeof raw.subtitle === 'string' && raw.subtitle) trip.subtitle = raw.subtitle
  if (typeof raw.startDate === 'string' && isCalendarDate(raw.startDate)) trip.startDate = raw.startDate
  return trip
}

/**
 * Validate and normalise untrusted input (a parsed JSON file, localStorage, a share link).
 * Only data that cannot be a trip at all (wrong format/version, no places list) returns
 * `{ ok: false }`. Everything else is repaired and reported in `warnings`: an invalid place is
 * dropped (its legs re-synced) rather than costing the whole trip. Cached routes are kept only
 * when their key matches the key recomputed from the trip and their geometry is sane (decodes,
 * stays in range, ends near the leg's places), so stale or corrupt geometry is re-derived instead.
 */
export function parseTripFile(input: unknown): ParseTripFileResult {
  if (!isRecord(input) || input.format !== TRIP_FILE_FORMAT) {
    return { ok: false, error: 'This is not a Roadmap Overview trip file.' }
  }
  if (input.version !== TRIP_FILE_VERSION) {
    return {
      ok: false,
      error:
        typeof input.version === 'number' && input.version > TRIP_FILE_VERSION
          ? 'This trip was saved by a newer version of Roadmap Overview.'
          : 'This trip file has an unsupported version.',
    }
  }

  const warnings: string[] = []
  try {
    const trip = parseTrip(input.trip, warnings)

    const routes: Record<string, LegRoute> = {}
    if (isRecord(input.routes)) {
      const placesById = new Map(trip.places.map((p) => [p.id, p]))
      trip.legs.forEach((leg, i) => {
        if (!Object.hasOwn(input.routes as object, leg.id)) return
        const raw = (input.routes as Record<string, unknown>)[leg.id]
        const from = placesById.get(leg.fromId)
        const to = placesById.get(leg.toId)
        if (!from || !to) return
        // A different key just means the cache is stale (the leg changed): re-derive it quietly.
        if (isRecord(raw) && raw.key !== legRouteKey(from, to, leg)) return
        const checked = parseRoute(raw, from, to)
        if ('route' in checked) {
          routes[leg.id] = checked.route
          if (checked.note) warnings.push(`Leg ${i + 1}: the saved route ${checked.note}.`)
        } else {
          warnings.push(`Leg ${i + 1}: the saved route ${checked.problem}; it will be calculated again.`)
        }
      })
    }

    const exportedAt =
      typeof input.exportedAt === 'string' && !Number.isNaN(Date.parse(input.exportedAt))
        ? input.exportedAt
        : new Date().toISOString()

    return {
      ok: true,
      warnings,
      file: { format: TRIP_FILE_FORMAT, version: TRIP_FILE_VERSION, exportedAt, trip, routes },
    }
  } catch (err) {
    if (err instanceof FileError) return { ok: false, error: err.message }
    throw err
  }
}
