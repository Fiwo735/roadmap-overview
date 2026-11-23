import { displayName, GAZETTEER, HOMONYMS, type GazetteerEntry } from './gazetteer'
import { haversineM } from '../../src/lib/geo'

/** `reverse` answers with the nearest gazetteer place within this radius, else "Unable to geocode". */
export const REVERSE_RADIUS_M = 40_000

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

function address(e: GazetteerEntry): Record<string, string> {
  const a: Record<string, string> = { [e.kind]: e.name }
  if (e.regions.length > 0) a.state = e.regions[e.regions.length - 1]
  if (e.regions.length > 1) a.county = e.regions[0]
  a.country = e.country
  a.country_code = e.countryCode
  return a
}

let nextPlaceId = 100_000

/** One result in Nominatim's `jsonv2` format (lat/lon are strings, as in the real API). */
export function toNominatimResult(e: GazetteerEntry, importance = 0.7) {
  const d = 0.08
  return {
    place_id: nextPlaceId++,
    licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    osm_type: 'relation',
    osm_id: Math.round(Math.abs(e.lat * 1000 + e.lng * 100)),
    lat: String(e.lat),
    lon: String(e.lng),
    category: 'boundary',
    type: 'administrative',
    place_rank: e.kind === 'city' ? 16 : 18,
    importance,
    addresstype: e.kind,
    name: e.name,
    display_name: displayName(e),
    address: address(e),
    boundingbox: [e.lat - d, e.lat + d, e.lng - d * 1.6, e.lng + d * 1.6].map((n) => n.toFixed(7)),
  }
}

function score(e: GazetteerEntry, query: string): number {
  const [head, ...rest] = query.split(',').map(fold)
  const names = [e.name, ...(e.aliases ?? [])].map(fold)
  let s = 0
  if (names.some((n) => n === head)) s = 100
  else if (names.some((n) => n.startsWith(head))) s = 60
  else if (fold(displayName(e)).includes(head)) s = 30
  if (s === 0) return 0
  const hay = fold(displayName(e))
  for (const token of rest) if (token && hay.includes(token)) s += 10
  return s
}

/** `/search?q=…`: free-text match on name, aliases and the rest of the display name. */
export function searchGazetteer(q: string, limit = 10) {
  const query = fold(q)
  if (!query) return []
  const ranked = [...GAZETTEER, ...HOMONYMS]
    .map((e, i) => ({ e, s: score(e, query), i }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
  return ranked.slice(0, limit).map((r, rank) => toNominatimResult(r.e, Math.max(0.2, 0.9 - rank * 0.15)))
}

/** `/reverse?lat=&lon=`: nearest gazetteer place, or Nominatim's error body when nothing is close. */
export function reverseGazetteer(lat: number, lon: number) {
  let best: { e: GazetteerEntry; d: number } | undefined
  for (const e of GAZETTEER) {
    const d = haversineM({ lat, lng: lon }, e)
    if (!best || d < best.d) best = { e, d }
  }
  if (!best || best.d > REVERSE_RADIUS_M) return { error: 'Unable to geocode' }
  return toNominatimResult(best.e)
}
