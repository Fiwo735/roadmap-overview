import { describe, expect, it } from 'vitest'
import type { LegRoute, Trip } from '../types/trip'
import { encodePolyline } from './polyline'
import { legRouteKey } from './routeKey'
import { collectLegRoutes, parseTripFile, serializeTripFile } from './tripFile'

function sampleTrip(): Trip {
  return {
    id: 't1',
    title: 'Summer',
    subtitle: 'Alps and back',
    startDate: '2026-07-04',
    places: [
      { id: 'a', name: 'Berlin', lat: 52.52, lng: 13.405, day: 0, address: 'Berlin, Germany' },
      { id: 'b', name: 'Prague', lat: 50.0755, lng: 14.4378, day: 1, customName: true, note: 'Beer' },
      { id: 'c', name: 'Vienna', lat: 48.2082, lng: 16.3738, day: 3 },
    ],
    legs: [
      { id: 'l1', fromId: 'a', toId: 'b', mode: 'drive', via: [{ lat: 51, lng: 14 }], durationMin: 240 },
      { id: 'l2', fromId: 'b', toId: 'c', mode: 'train', via: [], label: 'Railjet' },
    ],
  }
}

/** A plausible route for a leg of `sampleTrip()`: its two places with a point in between. */
function route(key: string, trip: Trip = sampleTrip(), legIndex = 0): LegRoute {
  const a = trip.places[legIndex]
  const b = trip.places[legIndex + 1]
  const mid = { lat: (a.lat + b.lat) / 2 + 0.1, lng: (a.lng + b.lng) / 2 }
  return { key, geometry: encodePolyline([a, mid, b]), distanceM: 1000, durationS: 60, source: 'osrm' }
}

function keyOf(trip: Trip, legIndex: number): string {
  return legRouteKey(trip.places[legIndex], trip.places[legIndex + 1], trip.legs[legIndex])
}

/** A trip file as parsed from JSON text; `routes` may hold deliberately malformed entries. */
function fileFor(trip: Trip, routes?: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(serializeTripFile(trip, routes as Record<string, LegRoute>)))
}

function ok(input: unknown) {
  const res = parseTripFile(input)
  if (!res.ok) throw new Error(`expected ok, got: ${res.error}`)
  return res
}

describe('serializeTripFile / parseTripFile round trip', () => {
  it('round-trips a trip with routes', () => {
    const trip = sampleTrip()
    const key = keyOf(trip, 0)
    const res = ok(fileFor(trip, { l1: route(key) }))
    expect(res.file.trip).toEqual(trip)
    expect(res.file.routes).toEqual({ l1: route(key) })
    expect(res.warnings).toEqual([])
  })

  it('writes the format header', () => {
    const file = serializeTripFile(sampleTrip())
    expect(file.format).toBe('roadmap-overview/trip')
    expect(file.version).toBe(1)
    expect(Number.isNaN(Date.parse(file.exportedAt))).toBe(false)
  })

  it('omits routes that belong to no current leg', () => {
    expect(serializeTripFile(sampleTrip(), { ghost: route('x') }).routes).toEqual({})
  })
})

describe('parseTripFile structure checks', () => {
  it.each([
    ['null', null],
    ['a string', 'hello'],
    ['an array', []],
    ['an object without format', { trip: sampleTrip() }],
    ['a wrong format', { format: 'other', version: 1, trip: sampleTrip() }],
  ])('rejects %s', (_label, input) => {
    expect(parseTripFile(input).ok).toBe(false)
  })

  it('rejects unknown versions with a helpful message', () => {
    const newer = parseTripFile({ ...fileFor(sampleTrip()), version: 2 })
    expect(newer).toEqual({ ok: false, error: expect.stringContaining('newer version') })
    expect(parseTripFile({ ...fileFor(sampleTrip()), version: 'x' }).ok).toBe(false)
  })

  it('rejects a file without trip data', () => {
    expect(parseTripFile({ format: 'roadmap-overview/trip', version: 1 }).ok).toBe(false)
  })

  it('rejects a file without a places list', () => {
    const file = fileFor(sampleTrip())
    file.trip.places = 'nope'
    expect(parseTripFile(file).ok).toBe(false)
  })
})

describe('parseTripFile drops invalid places instead of rejecting the file', () => {
  it.each([
    ['missing lat', { id: 'x', name: 'X', lng: 1, day: 0 }],
    ['NaN lat (null after JSON)', { id: 'x', name: 'X', lat: null, lng: 1, day: 0 }],
    ['string lng', { id: 'x', name: 'X', lat: 1, lng: '1', day: 0 }],
    ['lat out of range', { id: 'x', name: 'X', lat: 91, lng: 1, day: 0 }],
    ['lng out of range', { id: 'x', name: 'X', lat: 1, lng: 181, day: 0 }],
    ['non-object place', 42],
    ['null place', null],
  ])('a place with %s is dropped, the rest survives', (_label, bad) => {
    const file = fileFor(sampleTrip())
    file.trip.places.splice(1, 0, bad)
    const res = ok(file)
    expect(res.file.trip.places.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(res.warnings.some((w) => w.startsWith('Place 2'))).toBe(true)
    expect(res.file.trip.legs).toHaveLength(2)
    expect(res.file.trip.legs.map((l) => l.id)).toEqual(['l1', 'l2'])
  })

  it('re-syncs legs around a dropped place', () => {
    const file = fileFor(sampleTrip())
    file.trip.places[1].lat = null // Prague
    const res = ok(file)
    expect(res.file.trip.places.map((p) => p.id)).toEqual(['a', 'c'])
    expect(res.file.trip.legs).toHaveLength(1)
    expect(res.file.trip.legs[0]).toMatchObject({ fromId: 'a', toId: 'c', mode: 'drive', via: [] })
    expect(res.warnings.some((w) => w.includes('2 legs') || w.includes('leg'))).toBe(true)
  })

  it('can end up with an empty trip without failing', () => {
    const file = fileFor(sampleTrip())
    for (const p of file.trip.places) p.lat = 'x'
    const res = ok(file)
    expect(res.file.trip.places).toEqual([])
    expect(res.file.trip.legs).toEqual([])
    expect(res.file.trip.title).toBe('Summer')
  })

  it('defaults a missing or non-string name to an empty string with a warning', () => {
    const file = fileFor(sampleTrip())
    delete file.trip.places[0].name
    file.trip.places[1].name = 7
    const res = ok(file)
    expect(res.file.trip.places.map((p) => p.name)).toEqual(['', '', 'Vienna'])
    expect(res.warnings.filter((w) => w.includes('no name'))).toHaveLength(2)
  })
})

describe('parseTripFile normalisation', () => {
  it('rounds and clamps days to integers >= 0', () => {
    const file = fileFor(sampleTrip())
    file.trip.places[0].day = -3
    file.trip.places[1].day = 1.6
    file.trip.places[2].day = 400
    const res = ok(file)
    expect(res.file.trip.places.map((p) => p.day)).toEqual([0, 2, 400])
    expect(res.warnings.length).toBe(2)
  })

  it('assigns default days when missing, following the append rule', () => {
    const file = fileFor(sampleTrip())
    for (const p of file.trip.places) delete p.day
    const res = ok(file)
    expect(res.file.trip.places.map((p) => p.day)).toEqual([0, 1, 2])
  })

  it('drops non-string optional fields and empty strings', () => {
    const file = fileFor(sampleTrip())
    file.trip.places[0].address = 7
    file.trip.places[0].note = ''
    file.trip.places[0].customName = 'yes'
    const place = ok(file).file.trip.places[0]
    expect(place).not.toHaveProperty('address')
    expect(place).not.toHaveProperty('note')
    expect(place).not.toHaveProperty('customName')
  })

  it('assigns fresh ids to duplicate or missing place ids', () => {
    const file = fileFor(sampleTrip())
    file.trip.places[1].id = 'a'
    delete file.trip.places[2].id
    const res = ok(file)
    const ids = res.file.trip.places.map((p) => p.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe('a')
    expect(res.file.trip.legs).toHaveLength(2)
  })

  it('defaults an unknown leg mode to drive', () => {
    const file = fileFor(sampleTrip())
    file.trip.legs[1].mode = 'teleport'
    const res = ok(file)
    expect(res.file.trip.legs[1].mode).toBe('drive')
    expect(res.warnings.some((w) => w.includes('unknown mode'))).toBe(true)
  })

  it('drops invalid via points and bad leg fields', () => {
    const file = fileFor(sampleTrip())
    file.trip.legs[0].via = [{ lat: 51, lng: 14 }, { lat: 'x', lng: 1 }, null, { lat: 95, lng: 0 }]
    file.trip.legs[0].durationMin = -5
    file.trip.legs[1].straight = true
    const res = ok(file)
    const [l1, l2] = res.file.trip.legs
    expect(l1.via).toEqual([{ lat: 51, lng: 14 }])
    expect(l1).not.toHaveProperty('durationMin')
    expect(l2).not.toHaveProperty('straight')
    expect(res.warnings.filter((w) => w.includes('via point'))).toHaveLength(3)
    expect(res.warnings.some((w) => w.includes('invalid duration'))).toBe(true)
  })

  it('re-syncs legs: drops orphans, adds missing, repairs order', () => {
    const file = fileFor(sampleTrip())
    file.trip.legs = [
      { id: 'l2', fromId: 'b', toId: 'c', mode: 'ferry', via: [] },
      { id: 'zz', fromId: 'a', toId: 'c', mode: 'flight', via: [] },
      { id: 'bad' },
    ]
    const res = ok(file)
    const { legs, places } = res.file.trip
    // 'zz' (a -> c) joins no neighbours, 'bad' is malformed: both are reported.
    expect(res.warnings.some((w) => w.includes('did not join neighbouring places'))).toBe(true)
    expect(res.warnings.some((w) => w.includes('malformed'))).toBe(true)
    expect(legs).toHaveLength(2)
    expect(legs[0]).toMatchObject({ fromId: 'a', toId: 'b', mode: 'drive', via: [] })
    expect(legs[1]).toMatchObject({ id: 'l2', fromId: 'b', toId: 'c', mode: 'ferry' })
    legs.forEach((leg, i) => {
      expect(leg.fromId).toBe(places[i].id)
      expect(leg.toId).toBe(places[i + 1].id)
    })
  })

  it('accepts a trip without legs and builds them', () => {
    const file = fileFor(sampleTrip())
    delete file.trip.legs
    expect(ok(file).file.trip.legs).toHaveLength(2)
  })

  it('handles an empty trip', () => {
    const res = ok(fileFor({ id: 't', title: '', places: [], legs: [] }))
    expect(res.file.trip.places).toEqual([])
    expect(res.file.trip.legs).toEqual([])
    expect(res.file.trip.title).toBe('')
  })

  it('ignores an invalid startDate and non-string subtitle', () => {
    const file = fileFor(sampleTrip())
    file.trip.startDate = '2026-02-30'
    file.trip.subtitle = 3
    const { trip } = ok(file).file
    expect(trip).not.toHaveProperty('startDate')
    expect(trip).not.toHaveProperty('subtitle')
  })

  it('does not mutate its input', () => {
    const file = fileFor(sampleTrip())
    const copy = JSON.parse(JSON.stringify(file))
    ok(file)
    expect(file).toEqual(copy)
  })
})

describe('parseTripFile routes', () => {
  it('keeps only routes whose key matches the recomputed key, without complaint', () => {
    const trip = sampleTrip()
    const res = ok(fileFor(trip, { l1: route(keyOf(trip, 0)), l2: route('stale-key', trip, 1) }))
    expect(Object.keys(res.file.routes ?? {})).toEqual(['l1'])
    expect(res.warnings).toEqual([])
  })

  it('drops malformed routes with a warning', () => {
    const trip = sampleTrip()
    const key = keyOf(trip, 0)
    const file = fileFor(trip, { l1: route(key) })
    file.routes.l1.distanceM = 'far'
    expect(ok(file).file.routes).toEqual({})
    file.routes.l1 = { ...route(key), source: 'google' }
    const res = ok(file)
    expect(res.file.routes).toEqual({})
    expect(res.warnings.some((w) => w.startsWith('Leg 1'))).toBe(true)
  })

  it.each([
    ['NaN distance (null after JSON)', { distanceM: null }],
    ['negative distance', { distanceM: -1 }],
    ['negative duration', { durationS: -60 }],
    ['non-numeric duration', { durationS: '60' }],
  ])('drops a route with %s', (_label, patch) => {
    const trip = sampleTrip()
    const file = fileFor(trip, { l1: { ...route(keyOf(trip, 0)), ...patch } })
    const res = ok(file)
    expect(res.file.routes).toEqual({})
    expect(res.warnings.some((w) => w.includes('saved route'))).toBe(true)
  })

  it.each([
    ['an empty string', ''],
    ['garbage text', 'this is not a polyline!!'],
    ['a single point', '_p~iF~ps|U'],
    ['an out-of-range decode', '~~~~~~~~~~~~~~~~~~~~~~~~'],
    ['a non-string', 12],
  ])('drops a route whose geometry is %s so it is re-derived', (_label, geometry) => {
    const trip = sampleTrip()
    const file = fileFor(trip, { l1: { ...route(keyOf(trip, 0)), geometry } })
    const res = ok(file)
    expect(res.file.routes).toEqual({})
    expect(res.warnings.some((w) => w.startsWith('Leg 1') && w.includes('saved route'))).toBe(true)
  })

  it('drops a route that does not start and end near its places', () => {
    const trip = sampleTrip()
    const [a, b] = trip.places
    const far = (p: { lat: number; lng: number }) => ({ lat: p.lat + 1, lng: p.lng }) // ~111 km off
    const startsWrong = { ...route(keyOf(trip, 0)), geometry: encodePolyline([far(a), b]) }
    const endsWrong = { ...route(keyOf(trip, 0)), geometry: encodePolyline([a, far(b)]) }
    for (const bad of [startsWrong, endsWrong]) {
      const res = ok(fileFor(trip, { l1: bad }))
      expect(res.file.routes).toEqual({})
      expect(res.warnings.some((w) => w.includes('does not connect'))).toBe(true)
    }
  })

  it('accepts endpoints snapped a few km to the road network', () => {
    const trip = sampleTrip()
    const [a, b] = trip.places
    const snapped = { ...route(keyOf(trip, 0)), geometry: encodePolyline([{ lat: a.lat + 0.02, lng: a.lng }, b]) }
    expect(Object.keys(ok(fileFor(trip, { l1: snapped })).file.routes ?? {})).toEqual(['l1'])
  })

  it('tolerates a missing or non-object routes field, and ids like __proto__', () => {
    const file = fileFor(sampleTrip())
    delete file.routes
    expect(ok(file).file.routes).toEqual({})
    file.routes = 'x'
    expect(ok(file).file.routes).toEqual({})
    file.trip.legs[0].id = '__proto__'
    file.routes = {}
    const res = ok(file)
    expect(res.file.routes).toEqual({})
    expect(res.warnings).toEqual([])
  })
})

describe('collectLegRoutes', () => {
  it('maps the route cache back to the current legs by leg id', () => {
    const trip = sampleTrip()
    const k1 = keyOf(trip, 0)
    const collected = collectLegRoutes(trip, { [k1]: route(k1), other: route('other') })
    expect(collected).toEqual({ l1: route(k1) })
  })
})
