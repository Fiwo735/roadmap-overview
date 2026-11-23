import { haversineM, isLat, isLng } from './geo'

/** The parts of a Nominatim `jsonv2` result (search or reverse) this app reads. */
export interface RawNominatimResult {
  lat?: string | number
  lon?: string | number
  name?: string
  display_name?: string
  address?: Record<string, string | undefined>
  addresstype?: string
  type?: string
}

/** A geocoder hit in the shape the app uses everywhere. */
export interface GeoResult {
  lat: number
  lng: number
  /** Short form for the list and the map label, e.g. "Lyon". */
  name: string
  /** Full description (Nominatim's `display_name`), e.g. "Lyon, Métropole de Lyon, Rhône, France". */
  address: string
  countryCode?: string
  /** What kind of place it is ("city", "village", …), when Nominatim says. */
  kind?: string
}

/** Address parts tried, in order, when a result has no `name` of its own. */
const SHORT_NAME_KEYS = [
  'city',
  'town',
  'village',
  'hamlet',
  'suburb',
  'municipality',
  'county',
  'state',
] as const

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Short form of a result: its own name, else the most specific settlement/area in its address,
 * else the first segment of the full description.
 */
export function shortName(raw: RawNominatimResult): string {
  const own = clean(raw.name)
  if (own) return own
  for (const key of SHORT_NAME_KEYS) {
    const value = clean(raw.address?.[key])
    if (value) return value
  }
  return clean(raw.display_name?.split(',')[0])
}

/** Address parts that name the settlement a point lies in, most specific first. */
const SETTLEMENT_KEYS = ['city', 'town', 'village', 'hamlet', 'municipality'] as const

/**
 * Short form for a reverse-geocoded point: the settlement it lies in (a dropped pin in central
 * Munich is "Munich", not the quarter's name), else the usual `shortName`. Search results keep
 * `shortName` as is, so a campsite found by name stays named after itself.
 */
export function settlementName(raw: RawNominatimResult): string {
  for (const key of SETTLEMENT_KEYS) {
    const value = clean(raw.address?.[key])
    if (value) return value
  }
  return shortName(raw)
}

export interface ToGeoResultOptions {
  /** Name the result after its settlement (reverse geocoding) instead of the place's own name. */
  settlement?: boolean
}

/** Convert a raw result; null when it has no usable coordinates. */
export function toGeoResult(raw: RawNominatimResult, { settlement = false }: ToGeoResultOptions = {}): GeoResult | null {
  const lat = Number(raw.lat)
  const lng = Number(raw.lon)
  if (raw.lat === undefined || raw.lon === undefined || !isLat(lat) || !isLng(lng)) return null
  const name = settlement ? settlementName(raw) : shortName(raw)
  const result: GeoResult = { lat, lng, name, address: clean(raw.display_name) || name }
  const countryCode = clean(raw.address?.country_code)
  if (countryCode) result.countryCode = countryCode.toLowerCase()
  const kind = clean(raw.addresstype) || clean(raw.type)
  if (kind) result.kind = kind
  return result
}

/** The description without its leading short name ("Métropole de Lyon, Rhône, France"), for a secondary line. */
export function regionLine(result: Pick<GeoResult, 'name' | 'address'>): string {
  const prefix = `${result.name}, `
  return result.address.startsWith(prefix) ? result.address.slice(prefix.length) : result.address
}

/** Search hits closer together than this, with the same name and region, are the same place. */
const DUPLICATE_RADIUS_M = 5_000

/**
 * Drop repeated hits for one place (Nominatim often returns a town's boundary and its centre node
 * as two identical-looking rows): same short name, same region line and nearly the same spot. The
 * better-ranked (earlier) hit stays.
 */
export function dedupeResults(results: readonly GeoResult[]): GeoResult[] {
  const kept: GeoResult[] = []
  for (const r of results) {
    const same = kept.some(
      (k) => k.name === r.name && regionLine(k) === regionLine(r) && haversineM(k, r) <= DUPLICATE_RADIUS_M,
    )
    if (!same) kept.push(r)
  }
  return kept
}
