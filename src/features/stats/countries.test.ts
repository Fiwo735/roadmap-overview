import { beforeAll, describe, expect, it } from 'vitest'
import type { LatLng } from '../../types/trip'
import { codesAlong, countriesOfTrip, SAMPLE_STEP_M } from './countries'
import { createCountryIndex, type CountryIndex, type CountryShape } from './countryIndex'
import { samplePath } from './samplePath'
import { legRoutesOf, makeTrip, place } from './testHelpers'
import { createWorldIndex } from './worldIndex'

const square = (west: number, south: number, east: number, north: number) => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
]

/** Two countries side by side along lng 10 with a 22 km strip of sea between B and C. */
const synthetic = createCountryIndex([
  { code: 'AA', name: 'Alpha', polygons: [[square(0, 0, 10, 10)]] },
  { code: 'BB', name: 'Beta', polygons: [[square(10, 0, 20, 10)]] },
  { code: 'CC', name: 'Gamma', polygons: [[square(20.2, 0, 30, 10)]] },
] satisfies CountryShape[])

/** A west–east path along latitude 5 between two longitudes (1° of longitude is ~111 km there). */
const along = (fromLng: number, ...lngs: number[]): LatLng[] => [fromLng, ...lngs].map((lng) => ({ lat: 5, lng }))

describe('codesAlong', () => {
  it('lists the countries a road runs through, in order', () => {
    expect(codesAlong(synthetic, along(5, 15))).toEqual(['AA', 'BB'])
    expect(codesAlong(synthetic, along(15, 5))).toEqual(['BB', 'AA'])
  })

  it('ignores a short dip across a border (under three samples)', () => {
    // 0.01° east of the border is ~1.1 km: out and back is 2.2 km, at most two 2 km samples.
    expect(codesAlong(synthetic, along(9, 10.01, 9))).toEqual(['AA'])
  })

  it('counts a stretch that is long enough, even when the road comes back', () => {
    // 0.05° is ~5.5 km out and back: about five samples in a row.
    expect(codesAlong(synthetic, along(9, 10.05, 9))).toEqual(['AA', 'BB'])
  })

  it('needs the samples to be consecutive: scattered ones do not add up', () => {
    // Four short dips into B, each too brief to hold three samples.
    const dips = [9, 10.01, 9, 10.01, 9, 10.01, 9, 10.01, 9]
    expect(codesAlong(synthetic, along(...(dips as [number, ...number[]])))).toEqual(['AA'])
  })

  it('does not let a stretch in no country (sea, coastline noise) break a run', () => {
    expect(codesAlong(synthetic, along(5, 25))).toEqual(['AA', 'BB', 'CC'])
  })

  it('samples every 2 km', () => {
    expect(SAMPLE_STEP_M).toBe(2_000)
  })
})

describe('countriesOfTrip (world boundaries)', () => {
  let world: CountryIndex
  beforeAll(() => {
    world = createWorldIndex()
  })

  const stops = {
    Berlin: place('Berlin', 52.517, 13.3889),
    Prague: place('Prague', 50.0875, 14.4213),
    Vienna: place('Vienna', 48.2084, 16.3725),
    Munich: place('Munich', 48.1371, 11.5754),
    Milan: place('Milan', 45.4641, 9.1919),
    Lyon: place('Lyon', 45.7578, 4.832),
    Zurich: place('Zurich', 47.3744, 8.541),
    Lisbon: place('Lisbon', 38.7077, -9.1365),
    Dover: place('Dover', 51.1279, 1.3134),
    Calais: place('Calais', 50.9513, 1.8587),
    Hirtshals: place('Hirtshals', 57.5887, 9.9597),
    Kristiansand: place('Kristiansand', 58.1466, 7.9956),
    Pristina: place('Pristina', 42.667, 21.166),
    Kyrenia: place('Kyrenia', 35.34, 33.32),
  }

  /** Codes of a trip whose road legs run straight between the places (densely sampled, like a routed polyline). */
  const codesOf = (places: ReturnType<typeof place>[], patches: Record<number, object> = {}, routed = true) => {
    const trip = makeTrip(places, patches)
    const routes: Record<number, { points: LatLng[] }> = {}
    if (routed) trip.legs.forEach((_, i) => (routes[i] = { points: samplePath([places[i], places[i + 1]], 500) }))
    return countriesOfTrip(world, trip.places, legRoutesOf(trip, routes)).map((c) => c.code)
  }

  it('Berlin → Prague → Vienna visits Germany, Czechia, Austria in that order', () => {
    const trip = makeTrip([stops.Berlin, stops.Prague, stops.Vienna])
    const routes = { 0: { points: samplePath([stops.Berlin, stops.Prague], 500) }, 1: { points: samplePath([stops.Prague, stops.Vienna], 500) } }
    expect(countriesOfTrip(world, trip.places, legRoutesOf(trip, routes))).toEqual([
      { code: 'DE', name: 'Germany' },
      { code: 'CZ', name: 'Czechia' },
      { code: 'AT', name: 'Austria' },
    ])
  })

  it('lists the order of first visit, not of the alphabet or of the trip length', () => {
    expect(codesOf([stops.Vienna, stops.Prague, stops.Berlin])).toEqual(['AT', 'CZ', 'DE'])
  })

  it('adds a country the road only passes through', () => {
    expect(codesOf([stops.Munich, stops.Milan])).toEqual(['DE', 'AT', 'CH', 'IT'])
    expect(codesOf([stops.Lyon, stops.Zurich])).toEqual(['FR', 'CH'])
  })

  it('only counts the places while their legs are not routed yet', () => {
    expect(codesOf([stops.Munich, stops.Milan], {}, false)).toEqual(['DE', 'IT'])
  })

  it('counts a place the boundaries put in the sea for the nearest coast', () => {
    expect(codesOf([stops.Dover, stops.Calais], { 0: { mode: 'ferry' } })).toEqual(['GB', 'FR'])
    expect(codesOf([stops.Lisbon, stops.Hirtshals], { 0: { mode: 'flight' } })).toEqual(['PT', 'DK'])
  })

  it('takes nothing from the drawn line of a hand-drawn leg beyond its places', () => {
    // The straight Munich → Milan line crosses Austria and Switzerland; drawn by hand it adds neither.
    for (const patch of [{ mode: 'flight' }, { mode: 'train' }, { mode: 'drive', straight: true }]) {
      expect(codesOf([stops.Munich, stops.Milan], { 0: patch })).toEqual(['DE', 'IT'])
    }
    expect(codesOf([stops.Hirtshals, stops.Kristiansand], { 0: { mode: 'ferry' } })).toEqual(['DK', 'NO'])
    // A straight Vienna → Venice train line passes Slovenia, a road does not need to.
    const venice = place('Venice', 45.4408, 12.3155)
    expect(codesOf([stops.Vienna, venice], { 0: { mode: 'train' } })).toEqual(['AT', 'IT'])
  })

  it('counts the countries of the via points the user put on a hand-drawn leg, in order', () => {
    const innsbruck = { lat: 47.2692, lng: 11.4041 }
    const chur = { lat: 46.85, lng: 9.53 }
    expect(codesOf([stops.Munich, stops.Milan], { 0: { mode: 'train', via: [innsbruck] } })).toEqual(['DE', 'AT', 'IT'])
    expect(codesOf([stops.Munich, stops.Milan], { 0: { mode: 'flight', via: [innsbruck, chur] } })).toEqual(['DE', 'AT', 'CH', 'IT'])
    // A via point out at sea, far from any coast, is in no country.
    expect(codesOf([stops.Hirtshals, stops.Kristiansand], { 0: { mode: 'ferry', via: [{ lat: 58.0, lng: 9.0 }] } })).toEqual(['DK', 'NO'])
  })

  it('does not count the via points of a road leg that is not routed yet', () => {
    const innsbruck = { lat: 47.2692, lng: 11.4041 }
    expect(codesOf([stops.Munich, stops.Milan], { 0: { via: [innsbruck] } }, false)).toEqual(['DE', 'IT'])
  })

  it('leaves out the ferry stretches of a drive leg but keeps the driven ones', () => {
    // A leg Munich → Milan whose middle (the Austrian and Swiss part) is marked as a ferry stretch.
    const trip = makeTrip([stops.Munich, stops.Milan])
    const points = samplePath([stops.Munich, stops.Milan], 500)
    const last = points.length - 1
    const [start, end] = [Math.floor(last * 0.1), Math.floor(last * 0.92)]
    const spans = [
      { mode: 'drive' as const, from: 0, to: start, distanceM: 1, durationS: 1 },
      { mode: 'ferry' as const, from: start, to: end, distanceM: 1, durationS: 1 },
      { mode: 'drive' as const, from: end, to: last, distanceM: 1, durationS: 1 },
    ]
    const infos = legRoutesOf(trip, { 0: { points, spans } })
    expect(countriesOfTrip(world, trip.places, infos).map((c) => c.code)).toEqual(['DE', 'IT'])
  })

  it('knows places in Kosovo and Northern Cyprus, which have no ISO code in the boundaries', () => {
    expect(countriesOfTrip(world, [stops.Pristina], [])).toEqual([{ code: 'XK', name: 'Kosovo' }])
    expect(countriesOfTrip(world, [stops.Kyrenia], [])).toEqual([{ code: 'CY', name: 'Cyprus' }])
  })

  it('has no countries without places, and none for a place at sea', () => {
    expect(countriesOfTrip(world, [], [])).toEqual([])
    expect(countriesOfTrip(world, [place('sea', 45, -30)], [])).toEqual([])
  })

  it('is fast on a 5 000 km trip (and quicker still the second time)', () => {
    const waypoints: LatLng[] = [
      { lat: 38.7077, lng: -9.1365 }, // Lisbon
      { lat: 40.4, lng: -3.7 }, // Madrid
      { lat: 48.8589, lng: 2.32 }, // Paris
      { lat: 52.517, lng: 13.3889 }, // Berlin
      { lat: 52.23, lng: 21.01 }, // Warsaw
      { lat: 55.75, lng: 37.62 }, // Moscow
      { lat: 59.93, lng: 30.33 }, // Saint Petersburg
      { lat: 60.17, lng: 24.94 }, // Helsinki
    ]
    // A polyline point every 300 m, about what OSRM's simplified geometry has.
    const points = samplePath(waypoints, 300)
    const trip = makeTrip([place('start', waypoints[0].lat, waypoints[0].lng), place('end', 60.17, 24.94)])
    const infos = legRoutesOf(trip, { 0: { points } })

    const started = performance.now()
    const codes = countriesOfTrip(world, trip.places, infos).map((c) => c.code)
    const first = performance.now() - started
    const again = performance.now()
    countriesOfTrip(world, trip.places, infos)
    const second = performance.now() - again

    console.info(`${points.length} points (~${Math.round((points.length * 0.3))} km): ${codes.join(' ')} in ${first.toFixed(0)} ms, then ${second.toFixed(2)} ms`)
    expect(codes).toEqual(['PT', 'ES', 'FR', 'BE', 'LU', 'DE', 'PL', 'BY', 'RU', 'FI'])
    expect(first).toBeLessThan(1_000)
    expect(second).toBeLessThan(first / 5 + 5)
  })
})
