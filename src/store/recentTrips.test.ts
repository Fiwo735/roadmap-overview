import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_RECENT_TRIPS } from '../lib/recentTrips'
import { encodePolyline } from '../lib/polyline'
import { legRouteKey } from '../lib/routeKey'
import { createTrip } from '../lib/trip'
import type { LegRoute, Trip } from '../types/trip'
import {
  RECENT_TRIPS_KEY,
  findRecentTrip,
  pushRecentTrip,
  readRecentTrips,
  removeRecentTrip,
  useRecentStore,
} from './recentTrips'
import { useRouteStore } from './routeStore'

class MemoryStorage {
  data = new Map<string, string>()
  /** Values longer than this are refused, like a nearly full quota. */
  maxLength = Infinity
  /** ... and so are values this says no to. */
  refuse: (value: string) => boolean = () => false
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (value.length > this.maxLength || this.refuse(value)) throw new Error('QuotaExceededError')
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
}

let storage: MemoryStorage

function tripNamed(title: string): Trip {
  return createTrip({
    id: `t-${title}`,
    title,
    places: [
      { id: 'a', name: 'Lyon', lat: 45.76, lng: 4.83, day: 0 },
      { id: 'b', name: 'Annecy', lat: 45.9, lng: 6.13, day: 1 },
    ],
    legs: [{ id: 'l1', fromId: 'a', toId: 'b', mode: 'drive', via: [] }],
  })
}

/** A cached route for the trip's only leg; `padding` bulks it up. */
function routeOf(trip: Trip, padding = 0): LegRoute {
  const [a, b] = trip.places
  return {
    key: legRouteKey(a, b, trip.legs[0]),
    geometry: encodePolyline([a, { lat: 45.85, lng: 5.5 }, b]),
    distanceM: 120_000,
    durationS: 5_000,
    source: 'osrm',
    spans: padding ? [{ mode: 'drive', from: 0, to: 2, distanceM: 1, durationS: 1 }] : undefined,
  }
}

const titles = () => readRecentTrips().map((e) => e.file.trip.title)

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  useRouteStore.getState().clear()
  useRecentStore.setState({ entries: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pushRecentTrip', () => {
  it('stores the trip with its cached routes, newest first, and updates the summaries', () => {
    const a = tripNamed('A')
    useRouteStore.getState().setRoute(routeOf(a))
    expect(pushRecentTrip(a, 1_000)).toBe(true)
    expect(pushRecentTrip(tripNamed('B'), 2_000)).toBe(true)

    expect(titles()).toEqual(['B', 'A'])
    expect(readRecentTrips()[1].file.routes).toEqual({ l1: routeOf(a) })
    expect(useRecentStore.getState().entries).toEqual([
      expect.objectContaining({ title: 'B', placeCount: 2, savedAt: 2_000 }),
      expect.objectContaining({ title: 'A', placeCount: 2, savedAt: 1_000 }),
    ])
  })

  it('lists a trip once however often it is put away, and keeps at most five', () => {
    for (let i = 0; i < 3; i++) pushRecentTrip(tripNamed('Same'))
    expect(titles()).toEqual(['Same'])
    for (let i = 0; i < 8; i++) pushRecentTrip(tripNamed(`T${i}`))
    expect(titles()).toEqual(['T7', 'T6', 'T5', 'T4', 'T3'])
    expect(titles()).toHaveLength(MAX_RECENT_TRIPS)
  })

  it('drops the routes when they do not fit, keeping every trip', () => {
    const a = tripNamed('A')
    pushRecentTrip(a)
    pushRecentTrip(tripNamed('B'))
    const c = tripNamed('C')
    useRouteStore.getState().setRoute(routeOf(c))
    // The quota takes trips, but not geometry.
    storage.refuse = (value) => value.includes('"geometry"')

    expect(pushRecentTrip(c)).toBe(true)
    expect(titles()).toEqual(['C', 'B', 'A'])
    expect(readRecentTrips().map((e) => e.file.routes)).toEqual([{}, {}, {}])
  })

  it('then drops the oldest trips until the newest fits', () => {
    for (const title of ['A', 'B', 'C', 'D']) pushRecentTrip(tripNamed(title))
    // Room for two trips only.
    storage.refuse = (value) => (JSON.parse(value) as unknown[]).length > 2

    expect(pushRecentTrip(tripNamed('E'))).toBe(true)
    expect(titles()).toEqual(['E', 'D'])
  })

  it('reports failure, and leaves the stored list alone, when not even the newest fits', () => {
    pushRecentTrip(tripNamed('A'))
    const before = storage.getItem(RECENT_TRIPS_KEY)
    storage.maxLength = 10
    expect(pushRecentTrip(tripNamed('B'))).toBe(false)
    expect(storage.getItem(RECENT_TRIPS_KEY)).toBe(before)
    expect(titles()).toEqual(['A'])
  })

  it('reports failure when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(pushRecentTrip(tripNamed('A'))).toBe(false)
    expect(readRecentTrips()).toEqual([])
  })
})

describe('reading', () => {
  it('only returns entries that parse; the others are left out', () => {
    pushRecentTrip(tripNamed('Good'))
    const list = JSON.parse(storage.getItem(RECENT_TRIPS_KEY)!)
    storage.setItem(
      RECENT_TRIPS_KEY,
      JSON.stringify([{ id: 'bad', savedAt: 1, file: { format: 'nope' } }, 'junk', ...list]),
    )
    expect(titles()).toEqual(['Good'])
    useRecentStore.getState().refresh()
    expect(useRecentStore.getState().entries.map((e) => e.title)).toEqual(['Good'])
  })

  it('survives unreadable stored data', () => {
    storage.setItem(RECENT_TRIPS_KEY, '{"not": "a list"')
    expect(readRecentTrips()).toEqual([])
    storage.setItem(RECENT_TRIPS_KEY, '{"not": "a list"}')
    expect(readRecentTrips()).toEqual([])
  })

  it('finds an entry by id, or the newest', () => {
    pushRecentTrip(tripNamed('A'))
    pushRecentTrip(tripNamed('B'))
    const [newest, older] = readRecentTrips()
    expect(findRecentTrip()?.id).toBe(newest.id)
    expect(findRecentTrip(older.id)?.file.trip.title).toBe('A')
    expect(findRecentTrip('nope')).toBeNull()
  })
})

describe('removeRecentTrip', () => {
  it('forgets one entry, and the storage slot once the list is empty', () => {
    pushRecentTrip(tripNamed('A'))
    pushRecentTrip(tripNamed('B'))
    const [b, a] = readRecentTrips()
    removeRecentTrip(b.id)
    expect(titles()).toEqual(['A'])
    expect(useRecentStore.getState().entries.map((e) => e.title)).toEqual(['A'])
    removeRecentTrip(a.id)
    expect(storage.getItem(RECENT_TRIPS_KEY)).toBeNull()
    expect(useRecentStore.getState().entries).toEqual([])
  })
})
