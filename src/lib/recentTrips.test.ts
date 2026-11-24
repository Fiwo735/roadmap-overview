import { describe, expect, it } from 'vitest'
import type { LegRoute, Trip } from '../types/trip'
import { encodePolyline } from './polyline'
import {
  MAX_RECENT_TRIPS,
  addRecent,
  describeAge,
  parseRecentList,
  tripFingerprint,
  withoutRoutes,
  type RecentEntry,
} from './recentTrips'
import { serializeTripFile } from './tripFile'

function trip(title: string, extra: Partial<Trip> = {}): Trip {
  return {
    id: `t-${title}`,
    title,
    places: [
      { id: 'a', name: 'Berlin', lat: 52.52, lng: 13.405, day: 0 },
      { id: 'b', name: 'Prague', lat: 50.0755, lng: 14.4378, day: 1 },
    ],
    legs: [{ id: 'l1', fromId: 'a', toId: 'b', mode: 'train', via: [] }],
    ...extra,
  }
}

const entry = (title: string, savedAt = 1_000, routes: Record<string, LegRoute> = {}): RecentEntry => ({
  id: `r-${title}-${savedAt}`,
  savedAt,
  file: serializeTripFile(trip(title), routes),
})

describe('tripFingerprint', () => {
  it('is the same for equal content, whatever order the keys were written in', () => {
    const a = trip('Summer')
    const b: Trip = {
      legs: [{ via: [], mode: 'train', toId: 'b', fromId: 'a', id: 'l1' }],
      places: [
        { day: 0, lng: 13.405, lat: 52.52, name: 'Berlin', id: 'a' },
        { day: 1, lng: 14.4378, lat: 50.0755, name: 'Prague', id: 'b' },
      ],
      title: 'Summer',
      id: 't-Summer',
    }
    expect(tripFingerprint(a)).toBe(tripFingerprint(b))
  })

  it('differs when anything differs', () => {
    const base = tripFingerprint(trip('Summer'))
    expect(tripFingerprint(trip('Winter'))).not.toBe(base)
    const moved = trip('Summer')
    moved.places[1] = { ...moved.places[1], lat: 50.0756 }
    expect(tripFingerprint(moved)).not.toBe(base)
    expect(tripFingerprint(trip('Summer', { subtitle: 'x' }))).not.toBe(base)
  })

  it('ignores fields that are undefined, like JSON does', () => {
    expect(tripFingerprint(trip('Summer', { subtitle: undefined }))).toBe(tripFingerprint(trip('Summer')))
  })
})

describe('addRecent', () => {
  it('puts the new entry first', () => {
    expect(addRecent([entry('A')], entry('B')).map((e) => e.file.trip.title)).toEqual(['B', 'A'])
  })

  it('replaces an older entry with the same content instead of listing it twice', () => {
    const list = addRecent([entry('A', 1), entry('B', 2)], entry('A', 3))
    expect(list.map((e) => [e.file.trip.title, e.savedAt])).toEqual([
      ['A', 3],
      ['B', 2],
    ])
  })

  it('keeps at most MAX_RECENT_TRIPS, dropping the oldest', () => {
    let list: RecentEntry[] = []
    for (let i = 0; i < MAX_RECENT_TRIPS + 3; i++) list = addRecent(list, entry(`T${i}`, i))
    expect(list).toHaveLength(MAX_RECENT_TRIPS)
    expect(list[0].file.trip.title).toBe(`T${MAX_RECENT_TRIPS + 2}`)
    expect(list.at(-1)?.file.trip.title).toBe('T3')
  })
})

describe('withoutRoutes', () => {
  it('drops the cached routes and nothing else', () => {
    const [a, b] = trip('A').places
    const route: LegRoute = { key: 'k', geometry: encodePolyline([a, b]), distanceM: 1, durationS: 1, source: 'osrm' }
    const full = entry('A', 5, { l1: route })
    const lean = withoutRoutes(full)
    expect(lean.file.routes).toEqual({})
    expect(lean.file.trip).toBe(full.file.trip)
    expect(lean.id).toBe(full.id)
    expect(full.file.routes).toEqual({ l1: route })
  })
})

describe('parseRecentList', () => {
  it('reads entries that went through JSON', () => {
    const list = [entry('A', 2), entry('B', 1)]
    const parsed = parseRecentList(JSON.parse(JSON.stringify(list)))
    expect(parsed.map((e) => [e.id, e.savedAt, e.file.trip.title])).toEqual(list.map((e) => [e.id, e.savedAt, e.file.trip.title]))
  })

  it('skips entries that are not well-formed or do not hold a valid trip file, and keeps the rest', () => {
    const good = JSON.parse(JSON.stringify(entry('Good')))
    const parsed = parseRecentList([
      null,
      'text',
      42,
      { id: '', savedAt: 1, file: good.file },
      { id: 'x', savedAt: 'yesterday', file: good.file },
      { id: 'y', savedAt: 1 },
      { id: 'z', savedAt: 1, file: { format: 'something-else' } },
      { id: 'v', savedAt: 1, file: { ...good.file, version: 2 } },
      good,
    ])
    expect(parsed.map((e) => e.file.trip.title)).toEqual(['Good'])
  })

  it('gives nothing for data that is not a list', () => {
    for (const raw of [null, undefined, {}, 'x', 5]) expect(parseRecentList(raw)).toEqual([])
  })

  it('reads at most the cap', () => {
    const many = Array.from({ length: 12 }, (_, i) => JSON.parse(JSON.stringify(entry(`T${i}`, i))))
    expect(parseRecentList(many)).toHaveLength(MAX_RECENT_TRIPS)
    expect(parseRecentList(many, 2)).toHaveLength(2)
  })
})

describe('describeAge', () => {
  const now = Date.UTC(2027, 5, 20, 12)
  it('speaks in minutes, hours and days', () => {
    expect(describeAge(now - 5_000, now)).toBe('just now')
    expect(describeAge(now + 5_000, now)).toBe('just now')
    expect(describeAge(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(describeAge(now - 3 * 3_600_000 - 1_000, now)).toBe('3 h ago')
    expect(describeAge(now - 86_400_000, now)).toBe('1 day ago')
    expect(describeAge(now - 4 * 86_400_000, now)).toBe('4 days ago')
  })

  it('gives the date after a week', () => {
    // The date is shown in the viewer's time zone, so the test builds noon *local* time (noon UTC is already the next day in Auckland).
    expect(describeAge(new Date(2027, 5, 1, 12).getTime(), now)).toBe('1 Jun 2027')
  })
})
