import { describe, expect, it } from 'vitest'
import type { LegRoute, Trip } from '../types/trip'
import { pathLengthM } from './geo'
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
  // Roads are a little longer than the line drawn for them.
  const distanceM = Math.round(pathLengthM([a, mid, b]) * 1.05)
  return { key, geometry: encodePolyline([a, mid, b]), distanceM, durationS: 60, source: 'osrm' }
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

  describe('ferry spans', () => {
    // route() draws a-mid-b: three points.
    const spans = [
      { mode: 'drive', from: 0, to: 1, distanceM: 400, durationS: 30 },
      { mode: 'ferry', from: 1, to: 2, distanceM: 600, durationS: 30 },
    ]

    it('keeps the spans of a saved route (and nothing else it was not given)', () => {
      const trip = sampleTrip()
      const res = ok(fileFor(trip, { l1: { ...route(keyOf(trip, 0)), spans } }))
      expect(res.file.routes?.l1.spans).toEqual(spans)
      expect(res.warnings).toEqual([])
      expect(ok(fileFor(trip, { l1: route(keyOf(trip, 0)) })).file.routes?.l1).not.toHaveProperty('spans')
    })

    it.each([
      ['not a list', 'ferry'],
      ['empty', []],
      ['not covering the whole geometry', [spans[0]]],
      ['overlapping', [spans[0], { ...spans[1], from: 0 }]],
      ['out of the geometry', [spans[0], { ...spans[1], to: 9 }]],
      ['an unknown mode', [{ ...spans[0], mode: 'train' }, spans[1]]],
      ['carrying bad numbers', [spans[0], { ...spans[1], distanceM: -5 }]],
      ['containing things that are not spans', [null, 5, 'ferry', [spans[0]]]],
      ['missing their numbers', [{ mode: 'drive' }, { mode: 'ferry' }]],
    ])('keeps the route but drops spans that are %s, with a warning', (_label, bad) => {
      const trip = sampleTrip()
      const res = ok(fileFor(trip, { l1: { ...route(keyOf(trip, 0)), spans: bad } }))
      expect(res.file.routes?.l1).toBeDefined()
      expect(res.file.routes?.l1).not.toHaveProperty('spans')
      expect(res.warnings.some((w) => w.startsWith('Leg 1') && w.includes('ferry sections'))).toBe(true)
    })
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

describe('parseTripFile limits', () => {
  const manyPlaces = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Stop ${i}`, lat: 40 + (i % 20), lng: 5 + (i % 30), day: i }))

  it('refuses a trip with more than 500 places, saying how many it has', () => {
    const tooMany = { ...fileFor(sampleTrip()), trip: { id: 't', title: 'Huge', places: manyPlaces(501), legs: [] } }
    expect(parseTripFile(tooMany)).toEqual({
      ok: false,
      error: 'This trip has 501 places; Roadmap Overview opens at most 500.',
    })
  })

  it('still opens exactly 500', () => {
    const file = { ...fileFor(sampleTrip()), trip: { id: 't', title: 'Big', places: manyPlaces(500), legs: [] } }
    const parsed = parseTripFile(file)
    expect(parsed.ok && parsed.file.trip.places).toHaveLength(500)
    expect(parsed.ok && parsed.file.trip.legs).toHaveLength(499)
  })

  it('keeps the first 50 via points of a leg and says the rest were dropped', () => {
    const trip = sampleTrip()
    const via = Array.from({ length: 60 }, (_, i) => ({ lat: 52 + i / 100, lng: 14 }))
    trip.legs[0].via = via
    const parsed = parseTripFile(fileFor(trip))
    expect(parsed.ok && parsed.file.trip.legs[0].via).toEqual(via.slice(0, 50))
    expect(parsed.ok && parsed.warnings).toEqual(['Leg 1: only the first 50 via points were kept.'])
  })

  it('counts only valid via points towards the 50', () => {
    const trip = sampleTrip()
    const raw = fileFor(trip)
    const good = Array.from({ length: 50 }, (_, i) => ({ lat: 52 + i / 100, lng: 14 }))
    raw.trip.legs[0].via = [{ lat: 'x', lng: 1 }, ...good]
    const parsed = parseTripFile(raw)
    expect(parsed.ok && parsed.file.trip.legs[0].via).toEqual(good)
    expect(parsed.ok && parsed.warnings).toEqual(['Leg 1: an invalid via point was dropped.'])
  })
})

describe('parseTripFile: a route\'s distance must fit its geometry', () => {
  /** The first leg's route with its distance replaced, parsed through JSON like a real file. */
  function parseWithDistance(distanceM: number) {
    const trip = sampleTrip()
    const real = route(keyOf(trip, 0), trip)
    return parseTripFile(fileFor(trip, { l1: { ...real, distanceM } })) as Extract<ReturnType<typeof parseTripFile>, { ok: true }>
  }

  it('accepts the distance of the geometry, and anything between half and three times it', () => {
    const trip = sampleTrip()
    const real = route(keyOf(trip, 0), trip)
    const line = pathLengthM([trip.places[0], { lat: 52.52 / 2 + 50.0755 / 2 + 0.1, lng: (13.405 + 14.4378) / 2 }, trip.places[1]])
    for (const distanceM of [real.distanceM, line * 0.51, line * 2.9]) {
      const parsed = parseWithDistance(distanceM)
      expect(parsed.file.routes?.l1?.distanceM).toBe(distanceM)
      expect(parsed.warnings).toEqual([])
    }
  })

  it('drops a forged distance, however it is wrong, and asks for the route again', () => {
    const trip = sampleTrip()
    const line = route(keyOf(trip, 0), trip).distanceM
    for (const distanceM of [5, 0, line * 0.3, line * 3.5, 9_000_000_000]) {
      const parsed = parseWithDistance(distanceM)
      expect(parsed.file.routes).toEqual({})
      expect(parsed.warnings).toEqual(['Leg 1: the saved route has a distance that does not match its geometry; it will be calculated again.'])
    }
  })

  it('lets a geometry that does not move claim only a short distance', () => {
    const trip = sampleTrip()
    trip.places[1] = { ...trip.places[1], lat: trip.places[0].lat, lng: trip.places[0].lng }
    const key = keyOf(trip, 0)
    const there = { lat: trip.places[0].lat, lng: trip.places[0].lng }
    const base = { key, geometry: encodePolyline([there, there]), durationS: 1, source: 'osrm' as const }
    expect(parseTripFile(fileFor(trip, { l1: { ...base, distanceM: 0 } }))).toMatchObject({ ok: true, file: { routes: { l1: {} } } })
    const forged = parseTripFile(fileFor(trip, { l1: { ...base, distanceM: 50_000 } }))
    expect(forged.ok && forged.file.routes).toEqual({})
  })
})

describe('parseTripFile: the vehicle', () => {
  const withVehicle = (vehicle: unknown) => {
    const file = fileFor(sampleTrip())
    file.trip.vehicle = vehicle
    return file
  }

  it('has none when the file has none (the default campervan)', () => {
    const res = ok(fileFor(sampleTrip()))
    expect(res.file.trip).not.toHaveProperty('vehicle')
    expect(res.warnings).toEqual([])
  })

  it('round-trips a vehicle with and without a colour', () => {
    const daily = { ...sampleTrip(), vehicle: { kind: 'iveco-daily' as const } }
    expect(ok(fileFor(daily)).file.trip).toEqual(daily)
    const red = { ...sampleTrip(), vehicle: { kind: 'retro-bus' as const, color: '#d4382c' } }
    const res = ok(fileFor(red))
    expect(res.file.trip).toEqual(red)
    expect(res.warnings).toEqual([])
  })

  it('writes the vehicle into the file', () => {
    const trip = { ...sampleTrip(), vehicle: { kind: 'iveco-daily' as const } }
    expect(serializeTripFile(trip).trip.vehicle).toEqual({ kind: 'iveco-daily' })
  })

  it('reads the default campervan as no vehicle, and normalises the colour', () => {
    expect(ok(withVehicle({ kind: 'campervan' })).file.trip).not.toHaveProperty('vehicle')
    expect(ok(withVehicle({ kind: 'offroad', color: '#3F9560' })).file.trip.vehicle).toEqual({ kind: 'offroad' })
    expect(ok(withVehicle({ kind: 'offroad', color: '#ABCDEF' })).file.trip.vehicle).toEqual({ kind: 'offroad', color: '#abcdef' })
  })

  it('uses the campervan for an unknown kind, with a warning', () => {
    const res = ok(withVehicle({ kind: 'hovercraft' }))
    expect(res.file.trip).not.toHaveProperty('vehicle')
    expect(res.warnings.some((w) => w.includes('hovercraft'))).toBe(true)
  })

  it("uses the vehicle's own colour for a bad one, with a warning, and keeps the kind", () => {
    const res = ok(withVehicle({ kind: 'motorhome', color: 'rgb(1,2,3)' }))
    expect(res.file.trip.vehicle).toEqual({ kind: 'motorhome' })
    expect(res.warnings.some((w) => /colour/.test(w))).toBe(true)
  })

  it.each([['a string', 'iveco-daily'], ['a list', []], ['a number', 7]])('uses the campervan when the vehicle is %s', (_label, vehicle) => {
    const res = ok(withVehicle(vehicle))
    expect(res.file.trip).not.toHaveProperty('vehicle')
    expect(res.warnings).toHaveLength(1)
  })
})
