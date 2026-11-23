import { createLru, type Lru } from '../../lib/lru'
import { MODES } from '../../lib/modes'
import type { LatLng, LegRoute, Place } from '../../types/trip'
import type { LegRouteInfo } from '../routing/legRoutes'
import type { CountryIndex } from './countryIndex'
import { samplePath } from './samplePath'

// Framework-free: the statistics card and the image export both call `detectCountries`.

/** A country visited by the trip. `code` is upper-case ISO 3166-1 alpha-2 ("XK" for Kosovo). */
export interface Country {
  code: string
  name: string
}

/** What country detection needs of a leg: `getLegRoutes()` entries satisfy it. */
export type CountryLeg = Pick<LegRouteInfo, 'leg' | 'from' | 'to' | 'route' | 'coords' | 'status'>

/** Route geometry is sampled this often… */
export const SAMPLE_STEP_M = 2_000
/** …and a country counts once this many consecutive samples (≥ ~4–5 km of road) fall inside it. */
export const MIN_RUN_SAMPLES = 3
/** A place the boundaries put in the sea (a harbour, a causeway) counts for land this close. */
export const PLACE_SNAP_M = 10_000

let worldIndex: Promise<CountryIndex> | null = null

/** The boundaries of the world's countries, loaded (as their own chunk) on first use and kept. */
export function loadCountryIndex(): Promise<CountryIndex> {
  worldIndex ??= import('./worldIndex').then(
    (m) => m.createWorldIndex(),
    (error: unknown) => {
      worldIndex = null // a failed download is retried next time
      throw error
    },
  )
  return worldIndex
}

interface Memo {
  places: Lru<string, string | null>
  routes: WeakMap<LegRoute, string[]>
}

const memos = new WeakMap<CountryIndex, Memo>()

function memoOf(index: CountryIndex): Memo {
  let memo = memos.get(index)
  if (!memo) {
    memo = { places: createLru(2_000), routes: new WeakMap() }
    memos.set(index, memo)
  }
  return memo
}

/**
 * The countries a stretch of road runs through, in order: a country counts after `MIN_RUN_SAMPLES`
 * consecutive samples inside it. Samples in no country (sea, coastline noise) neither count nor
 * break a run, so a road hugging a coast still adds up; a road that dips across a border for a
 * moment (fewer than three samples) adds nothing.
 */
export function codesAlong(index: CountryIndex, points: readonly LatLng[]): string[] {
  const out: string[] = []
  let current: string | null = null
  let run = 0
  for (const sample of samplePath(points, SAMPLE_STEP_M)) {
    const code = index.at(sample)
    if (code === null) continue
    run = code === current ? run + 1 : 1
    current = code
    if (run === MIN_RUN_SAMPLES && !out.includes(code)) out.push(code)
  }
  return out
}

/** A leg the user drew by hand (ferry, train, flight, straight drive): a schematic line, not a road. */
const isHandDrawn = (leg: CountryLeg['leg']) => !MODES[leg.mode].routed || leg.straight === true

/** The driven stretches of a road-routed leg: all of its geometry, or what lies outside its ferry spans. */
function drivenStretches({ route, coords }: CountryLeg): (readonly LatLng[])[] {
  if (!route?.spans) return [coords]
  return route.spans.filter((s) => s.mode === 'drive').map((s) => coords.slice(s.from, s.to + 1))
}

function routeCodes(index: CountryIndex, memo: Memo, info: CountryLeg): string[] {
  const { route } = info
  if (info.status !== 'ok' || !route) return [] // the placeholder line of a pending leg is not a route
  let codes = memo.routes.get(route)
  if (!codes) {
    codes = []
    for (const stretch of drivenStretches(info)) for (const code of codesAlong(index, stretch)) if (!codes.includes(code)) codes.push(code)
    memo.routes.set(route, codes)
  }
  return codes
}

function placeCode(index: CountryIndex, memo: Memo, place: LatLng): string | null {
  const key = `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`
  let code = memo.places.get(key)
  if (code === undefined) {
    code = index.near(place, PLACE_SNAP_M)
    memo.places.set(key, code)
  }
  return code
}

/**
 * The countries of a trip, ordered by first visit. A country counts when a place lies in it, or when
 * the geometry of a road-routed drive leg runs through it (see `codesAlong`; outside its ferry
 * spans). Hand-drawn legs (ferry, train, flight, straight drive) are schematic, so the countries
 * their line merely crosses do not count: they contribute their end places and the via points the
 * user put on them (a via point in a country is a deliberate statement that the trip goes there).
 * A road leg that is not routed yet contributes nothing but its places. Results are remembered per
 * position and per route, so a trip that grows pays for the new leg only.
 */
export function countriesOfTrip(index: CountryIndex, places: readonly Place[], legs: readonly CountryLeg[]): Country[] {
  const memo = memoOf(index)
  const legFrom = new Map(legs.map((info) => [info.from.id, info]))
  const codes: string[] = []
  const add = (code: string | null) => {
    if (code && !codes.includes(code)) codes.push(code)
  }
  places.forEach((place, i) => {
    add(placeCode(index, memo, place))
    const info = legFrom.get(place.id)
    if (!info || info.to.id !== places[i + 1]?.id) return
    if (isHandDrawn(info.leg)) info.leg.via.forEach((point) => add(placeCode(index, memo, point)))
    else routeCodes(index, memo, info).forEach(add)
  })
  return codes.map((code) => ({ code, name: index.nameOf(code) }))
}

/** `countriesOfTrip` over the bundled world boundaries (loaded on first use). */
export async function detectCountries(places: readonly Place[], legs: readonly CountryLeg[]): Promise<Country[]> {
  if (places.length === 0) return [] // nothing to look up: do not fetch the boundaries yet
  return countriesOfTrip(await loadCountryIndex(), places, legs)
}
