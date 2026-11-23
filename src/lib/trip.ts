import type { Leg, LegMode, Place, Trip } from '../types/trip'
import { isLat, isLng, isValidLatLng } from './geo'
import { newId } from './id'
import { MODE_ORDER } from './modes'

export const DEFAULT_TRIP_TITLE = 'My campervan trip'

export function isLegMode(value: unknown): value is LegMode {
  return typeof value === 'string' && (MODE_ORDER as readonly string[]).includes(value)
}

export function createTrip(overrides: Partial<Trip> = {}): Trip {
  return { id: newId('t'), title: DEFAULT_TRIP_TITLE, places: [], legs: [], ...overrides }
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

/** Day of travel: an integer ≥ 0. Anything non-numeric becomes 0. */
export function normalizeDay(day: unknown): number {
  if (typeof day !== 'number' || !Number.isFinite(day)) return 0
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(day)))
}

/**
 * Default `day` for a place inserted at `index` (see ARCHITECTURE.md "Days"): appended places
 * continue on the next day, places inserted in the middle share the previous place's day.
 */
export function defaultDayAt(places: readonly Pick<Place, 'day'>[], index: number): number {
  if (places.length === 0 || index <= 0) return 0
  const previous = places[Math.min(index, places.length) - 1]
  return index >= places.length ? previous.day + 1 : previous.day
}

/**
 * Re-derive `legs` from `places` so that the invariant in types/trip.ts holds. A leg is re-used
 * (same object) when its (fromId, toId) pair is still adjacent; otherwise a default drive leg is
 * created. Returns `legs` itself when nothing changed, so callers can skip no-op updates.
 */
export function syncLegs(
  places: readonly Pick<Place, 'id'>[],
  legs: readonly Leg[],
  makeId: () => string = () => newId('l'),
): Leg[] {
  const byPair = new Map<string, Leg>()
  for (const leg of legs) byPair.set(`${leg.fromId}\u0000${leg.toId}`, leg)

  const next: Leg[] = []
  const used = new Set<string>()
  for (let i = 0; i + 1 < places.length; i++) {
    const fromId = places[i].id
    const toId = places[i + 1].id
    const existing = byPair.get(`${fromId}\u0000${toId}`)
    if (existing && !used.has(existing.id)) {
      used.add(existing.id)
      next.push(existing)
    } else {
      next.push({ id: makeId(), fromId, toId, mode: 'drive', via: [] })
    }
  }
  const unchanged = next.length === legs.length && next.every((leg, i) => leg === legs[i])
  return unchanged ? (legs as Leg[]) : next
}

export type PlacePatch = Partial<Omit<Place, 'id'>>
export type LegPatch = Partial<Omit<Leg, 'id' | 'fromId' | 'toId'>>

/**
 * Reduce an update to values that keep a Place valid, dropping the rest: required fields (name,
 * lat, lng, day) are never deleted or set to junk, and a coordinate update with any invalid half is
 * dropped as a whole so a place is never moved to half a position. Optional fields (address, note,
 * customName) are cleared by `undefined` or an empty value. Unknown keys, including `id`, are ignored.
 */
export function sanitizePlacePatch(patch: PlacePatch): PlacePatch {
  const out: PlacePatch = {}
  const coordsValid = (patch.lat === undefined || isLat(patch.lat)) && (patch.lng === undefined || isLng(patch.lng))
  if (coordsValid) {
    if (patch.lat !== undefined) out.lat = patch.lat
    if (patch.lng !== undefined) out.lng = patch.lng
  }
  if (typeof patch.name === 'string') out.name = patch.name
  if (typeof patch.day === 'number' && Number.isFinite(patch.day)) out.day = normalizeDay(patch.day)
  for (const key of ['address', 'note'] as const) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value === undefined || value === '') out[key] = undefined
    else if (typeof value === 'string') out[key] = value
  }
  if ('customName' in patch) {
    if (patch.customName === true) out.customName = true
    else if (patch.customName === false || patch.customName === undefined) out.customName = undefined
  }
  return out
}

/** Same idea for legs: invalid modes, via lists, durations and flags are ignored; copies via points. */
export function sanitizeLegPatch(patch: LegPatch): LegPatch {
  const out: LegPatch = {}
  if (isLegMode(patch.mode)) out.mode = patch.mode
  if (Array.isArray(patch.via) && patch.via.every(isValidLatLng)) {
    out.via = patch.via.map((p) => ({ lat: p.lat, lng: p.lng }))
  }
  if ('straight' in patch) {
    if (patch.straight === true) out.straight = true
    else if (patch.straight === false || patch.straight === undefined) out.straight = undefined
  }
  if ('durationMin' in patch) {
    const d = patch.durationMin
    if (d === undefined) out.durationMin = undefined
    else if (typeof d === 'number' && Number.isFinite(d) && d > 0) out.durationMin = d
  }
  if ('label' in patch) {
    const l = patch.label
    if (l === undefined || l === '') out.label = undefined
    else if (typeof l === 'string') out.label = l
  }
  return out
}
