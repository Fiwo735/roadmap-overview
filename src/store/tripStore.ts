import { temporal } from 'zundo'
import { create, useStore } from 'zustand'
import type { LatLng, Leg, Place, Trip, VehicleKind } from '../types/trip'
import { isLat, isLng, isValidLatLng } from '../lib/geo'
import { newId } from '../lib/id'
import { capForTrip } from '../lib/photos'
import {
  createTrip,
  defaultDayAt,
  isCalendarDate,
  normalizeDay,
  sanitizeLegPatch,
  sanitizePlacePatch,
  syncLegs,
  type LegPatch,
  type PlacePatch,
} from '../lib/trip'
import { canonicalVehicle, isVehicleKind, sameVehicle } from '../lib/vehicles'
import { withPreferredVehicle } from './vehiclePreference'

/** Fields a caller provides for a new place; `day` defaults per ARCHITECTURE.md. */
export type NewPlace = Pick<Place, 'name' | 'lat' | 'lng'> &
  Partial<Pick<Place, 'address' | 'day' | 'customName' | 'note'>>

export type { LegPatch, PlacePatch }

export interface TripState {
  trip: Trip

  setTitle: (title: string) => void
  /** Empty string or undefined clears the subtitle. */
  setSubtitle: (subtitle: string | undefined) => void
  /** YYYY-MM-DD; empty string or undefined clears it, malformed values are ignored. */
  setStartDate: (date: string | undefined) => void
  /**
   * The vehicle that rides the road stretches, with an optional `#rrggbb` body colour. The default
   * campervan (and a vehicle's own colour) is stored as nothing; an unknown kind or a bad colour is ignored.
   */
  setVehicle: (kind: VehicleKind, color?: string) => void

  /**
   * Insert a place (appended unless `index` is given) and return its id, or null when the input
   * has non-finite or out-of-range coordinates (nothing is added; a bad place must never reach
   * the saved trip).
   */
  addPlace: (input: NewPlace, index?: number) => string | null
  /**
   * Invalid values are ignored rather than applied: required fields are never deleted by
   * `undefined`, and coordinates only change when valid (see `sanitizePlacePatch`).
   */
  updatePlace: (id: string, patch: PlacePatch) => void
  removePlace: (id: string) => void
  movePlace: (fromIndex: number, toIndex: number) => void

  updateLeg: (id: string, patch: LegPatch) => void
  addVia: (legId: string, index: number, point: LatLng) => void
  moveVia: (legId: string, index: number, point: LatLng) => void
  removeVia: (legId: string, index: number) => void

  /** Swap in a whole trip (import, restore) as ONE undoable step. */
  replaceTrip: (trip: Trip) => void
  /** Start over with an empty trip (with the vehicle the user chose last), as one undoable step. */
  newTrip: () => void
}

/** What the temporal (undo) middleware records. */
interface TripHistorySlice {
  trip: Trip
}

const coord = (p: LatLng): LatLng => ({ lat: p.lat, lng: p.lng })

/** Integer index clamped to [0, max]; non-finite input counts as `max`. */
function clampIndex(index: number | undefined, max: number): number {
  if (index === undefined || !Number.isFinite(index)) return max
  return Math.min(Math.max(0, Math.trunc(index)), max)
}

/** Structural equality for plain JSON-like values (enough to compare via lists). */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const keys = Object.keys(ra)
  return keys.length === Object.keys(rb).length && keys.every((k) => valuesEqual(ra[k], rb[k]))
}

/**
 * Shallow-merge `patch` into `obj`; undefined values delete the key. Returns the same object when
 * nothing changes (values compared structurally), which keeps no-op calls out of the undo history.
 */
function applyPatch<T extends object>(obj: T, patch: Partial<T>): T {
  let next: T | undefined
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key]
    if (value === undefined) {
      if (key in obj) {
        next ??= { ...obj }
        delete next[key]
      }
    } else if (!valuesEqual(obj[key], value)) {
      next ??= { ...obj }
      next[key] = value as T[keyof T]
    }
  }
  return next ?? obj
}

/** The trip with `places` swapped in and `legs` re-synced to them (invariant in types/trip.ts). */
function withSyncedLegs(trip: Trip, places: Place[]): Trip {
  return { ...trip, places, legs: syncLegs(places, trip.legs) }
}

function mapLeg(trip: Trip, legId: string, fn: (leg: Leg) => Leg): Trip | null {
  const i = trip.legs.findIndex((l) => l.id === legId)
  if (i < 0) return null
  const next = fn(trip.legs[i])
  if (next === trip.legs[i]) return null
  const legs = trip.legs.slice()
  legs[i] = next
  return { ...trip, legs }
}

export const useTripStore = create<TripState>()(
  temporal(
    (set) => {
      /** Apply a trip transform; `null` means "nothing to do" and keeps the state untouched. */
      const edit = (fn: (trip: Trip) => Trip | null) =>
        set((state) => {
          const next = fn(state.trip)
          return next && next !== state.trip ? { trip: next } : state
        })

      return {
        trip: createTrip(),

        setTitle: (title) => edit((t) => (typeof title !== 'string' || t.title === title ? null : { ...t, title })),

        setSubtitle: (subtitle) =>
          edit((t) => {
            const value = subtitle || undefined
            if (t.subtitle === value) return null
            const { subtitle: _old, ...rest } = t
            return value === undefined ? rest : { ...rest, subtitle: value }
          }),

        setStartDate: (date) =>
          edit((t) => {
            const value = date || undefined
            if (value !== undefined && !isCalendarDate(value)) return null
            if (t.startDate === value) return null
            const { startDate: _old, ...rest } = t
            return value === undefined ? rest : { ...rest, startDate: value }
          }),

        setVehicle: (kind, color) =>
          edit((t) => {
            if (!isVehicleKind(kind)) return null
            const vehicle = canonicalVehicle(kind, color)
            if (sameVehicle(t.vehicle, vehicle)) return null
            const { vehicle: _old, ...rest } = t
            return vehicle ? { ...rest, vehicle } : rest
          }),

        addPlace: (input, index) => {
          if (!isLat(input.lat) || !isLng(input.lng)) return null
          const id = newId('p')
          edit((t) => {
            const at = clampIndex(index, t.places.length)
            const place: Place = {
              id,
              name: typeof input.name === 'string' ? input.name : '',
              lat: input.lat,
              lng: input.lng,
              day:
                typeof input.day === 'number' && Number.isFinite(input.day)
                  ? normalizeDay(input.day)
                  : defaultDayAt(t.places, at),
            }
            if (typeof input.address === 'string' && input.address) place.address = input.address
            if (input.customName === true) place.customName = true
            if (typeof input.note === 'string' && input.note) place.note = input.note
            const places = t.places.slice()
            places.splice(at, 0, place)
            return withSyncedLegs(t, places)
          })
          return id
        },

        updatePlace: (id, patch) =>
          edit((t) => {
            const i = t.places.findIndex((p) => p.id === id)
            if (i < 0) return null
            const clean = sanitizePlacePatch(patch)
            if (clean.photos) {
              const capped = capForTrip(t, id, clean.photos)
              clean.photos = capped.length > 0 ? capped : undefined
            }
            const next = applyPatch<Place>(t.places[i], clean)
            if (next === t.places[i]) return null
            const places = t.places.slice()
            places[i] = next
            return { ...t, places }
          }),

        removePlace: (id) =>
          edit((t) => {
            if (!t.places.some((p) => p.id === id)) return null
            return withSyncedLegs(
              t,
              t.places.filter((p) => p.id !== id),
            )
          }),

        movePlace: (fromIndex, toIndex) =>
          edit((t) => {
            const n = t.places.length
            if (fromIndex === toIndex) return null
            if (fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n) return null
            const places = t.places.slice()
            const [moved] = places.splice(fromIndex, 1)
            places.splice(toIndex, 0, moved)
            return withSyncedLegs(t, places)
          }),

        updateLeg: (id, patch) =>
          edit((t) => mapLeg(t, id, (leg) => applyPatch<Leg>(leg, sanitizeLegPatch(patch)))),

        addVia: (legId, index, point) =>
          edit((t) =>
            mapLeg(t, legId, (leg) => {
              if (!isValidLatLng(point)) return leg
              const via = leg.via.slice()
              via.splice(clampIndex(index, via.length), 0, coord(point))
              return { ...leg, via }
            }),
          ),

        moveVia: (legId, index, point) =>
          edit((t) =>
            mapLeg(t, legId, (leg) => {
              const old = leg.via[index]
              if (!old || !isValidLatLng(point) || (old.lat === point.lat && old.lng === point.lng)) return leg
              const via = leg.via.slice()
              via[index] = coord(point)
              return { ...leg, via }
            }),
          ),

        removeVia: (legId, index) =>
          edit((t) =>
            mapLeg(t, legId, (leg) => {
              if (index < 0 || index >= leg.via.length) return leg
              return { ...leg, via: leg.via.filter((_, i) => i !== index) }
            }),
          ),

        replaceTrip: (trip) => edit(() => withSyncedLegs(trip, trip.places)),

        newTrip: () => edit(() => withPreferredVehicle(createTrip())),
      }
    },
    {
      partialize: (state): TripHistorySlice => ({ trip: state.trip }),
      limit: 100,
      // Every action returns the same trip object when it changes nothing, so an identity check
      // is enough to keep no-op calls out of the history.
      equality: (past, current) => past.trip === current.trip,
    },
  ),
)

/** One step back/forward. Safe as event handlers (unlike the raw zundo functions, which take a step count). */
export const undo = (): void => useTripStore.temporal.getState().undo()
export const redo = (): void => useTripStore.temporal.getState().redo()

/** Undo/redo as a React hook; subscribes only to what the buttons need. */
export function useHistory() {
  const canUndo = useStore(useTripStore.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useTripStore.temporal, (s) => s.futureStates.length > 0)
  return { undo, redo, canUndo, canRedo }
}

/**
 * Run `fn` without recording undo history: for machine-made follow-ups of a user gesture (e.g. a
 * reverse-geocoded name arriving after a marker drop) that must not become an undo step of their own.
 * Keep `fn` synchronous so no user edit slips into the window.
 */
export function withoutHistory(fn: () => void): void {
  const temporal = useTripStore.temporal.getState()
  const wasTracking = temporal.isTracking
  temporal.pause()
  try {
    fn()
  } finally {
    if (wasTracking) useTripStore.temporal.getState().resume()
  }
}

/** Forget undo/redo history (after restoring a saved trip on start-up). */
export function clearHistory(): void {
  useTripStore.temporal.getState().clear()
}
