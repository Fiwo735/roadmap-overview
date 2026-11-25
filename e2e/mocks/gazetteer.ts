/**
 * Small gazetteer of places a European road trip might use. It backs the Nominatim mock and
 * lets specs add places by name without typing in the UI.
 * Coordinates are real (city-centre level), rounded to 4 decimals.
 */
export interface GazetteerEntry {
  name: string
  lat: number
  lng: number
  country: string
  countryCode: string
  /** 'city' | 'town' | 'village' (decides the `address` key Nominatim would use). */
  kind: 'city' | 'town' | 'village'
  /** Administrative areas between the place and the country, most specific first. */
  regions: string[]
  /** Other spellings accepted by search ("München"). */
  aliases?: string[]
}

export const GAZETTEER: readonly GazetteerEntry[] = [
  { name: 'Berlin', lat: 52.517, lng: 13.3889, country: 'Germany', countryCode: 'de', kind: 'city', regions: ['Berlin'] },
  { name: 'Prague', lat: 50.0875, lng: 14.4213, country: 'Czechia', countryCode: 'cz', kind: 'city', regions: ['Hlavní město Praha'], aliases: ['Praha'] },
  { name: 'Vienna', lat: 48.2084, lng: 16.3725, country: 'Austria', countryCode: 'at', kind: 'city', regions: ['Wien'], aliases: ['Wien'] },
  { name: 'Munich', lat: 48.1371, lng: 11.5754, country: 'Germany', countryCode: 'de', kind: 'city', regions: ['Bavaria'], aliases: ['München'] },
  { name: 'Salzburg', lat: 47.7981, lng: 13.0465, country: 'Austria', countryCode: 'at', kind: 'city', regions: ['Salzburg'] },
  { name: 'Ljubljana', lat: 46.05, lng: 14.5069, country: 'Slovenia', countryCode: 'si', kind: 'city', regions: ['Ljubljana'] },
  { name: 'Lyon', lat: 45.7578, lng: 4.832, country: 'France', countryCode: 'fr', kind: 'city', regions: ['Métropole de Lyon', 'Auvergne-Rhône-Alpes'] },
  { name: 'Annecy', lat: 45.8992, lng: 6.1289, country: 'France', countryCode: 'fr', kind: 'city', regions: ['Haute-Savoie', 'Auvergne-Rhône-Alpes'] },
  { name: 'Paris', lat: 48.8589, lng: 2.32, country: 'France', countryCode: 'fr', kind: 'city', regions: ['Île-de-France'] },
  { name: 'Amsterdam', lat: 52.3731, lng: 4.8925, country: 'Netherlands', countryCode: 'nl', kind: 'city', regions: ['North Holland'] },
  { name: 'Copenhagen', lat: 55.6867, lng: 12.5701, country: 'Denmark', countryCode: 'dk', kind: 'city', regions: ['Capital Region of Denmark'], aliases: ['København'] },
  { name: 'Hirtshals', lat: 57.5887, lng: 9.9597, country: 'Denmark', countryCode: 'dk', kind: 'town', regions: ['Hjørring Municipality', 'North Denmark Region'] },
  { name: 'Kristiansand', lat: 58.1466, lng: 7.9956, country: 'Norway', countryCode: 'no', kind: 'city', regions: ['Agder'] },
  { name: 'Bergen', lat: 60.3943, lng: 5.3259, country: 'Norway', countryCode: 'no', kind: 'city', regions: ['Vestland'] },
  { name: 'Oslo', lat: 59.9133, lng: 10.7389, country: 'Norway', countryCode: 'no', kind: 'city', regions: ['Oslo'] },
  { name: 'Dover', lat: 51.1279, lng: 1.3134, country: 'United Kingdom', countryCode: 'gb', kind: 'town', regions: ['Kent', 'England'] },
  { name: 'Calais', lat: 50.9513, lng: 1.8587, country: 'France', countryCode: 'fr', kind: 'city', regions: ['Pas-de-Calais', 'Hauts-de-France'] },
  { name: 'Portsmouth', lat: 50.8058, lng: -1.0872, country: 'United Kingdom', countryCode: 'gb', kind: 'city', regions: ['Hampshire', 'England'] },
  { name: 'Santander', lat: 43.4623, lng: -3.81, country: 'Spain', countryCode: 'es', kind: 'city', regions: ['Cantabria'] },
  { name: 'Barcelona', lat: 41.3825, lng: 2.1769, country: 'Spain', countryCode: 'es', kind: 'city', regions: ['Barcelona', 'Catalonia'] },
  { name: 'Hamburg', lat: 53.5503, lng: 10.0006, country: 'Germany', countryCode: 'de', kind: 'city', regions: ['Hamburg'] },
  { name: 'Rotterdam', lat: 51.9244, lng: 4.4777, country: 'Netherlands', countryCode: 'nl', kind: 'city', regions: ['South Holland'] },
  { name: 'Zurich', lat: 47.3744, lng: 8.541, country: 'Switzerland', countryCode: 'ch', kind: 'city', regions: ['Zurich'], aliases: ['Zürich'] },
  { name: 'Milan', lat: 45.4641, lng: 9.1919, country: 'Italy', countryCode: 'it', kind: 'city', regions: ['Milan', 'Lombardy'], aliases: ['Milano'] },
  { name: 'Lisbon', lat: 38.7077, lng: -9.1365, country: 'Portugal', countryCode: 'pt', kind: 'city', regions: ['Lisbon'], aliases: ['Lisboa'] },
]

/**
 * Extra homonyms that only `search` returns (never `reverse`), so specs can exercise "several
 * results" lists. They sort after the main entry for the same query.
 */
export const HOMONYMS: readonly GazetteerEntry[] = [
  { name: 'Paris', lat: 33.6609, lng: -95.5555, country: 'United States', countryCode: 'us', kind: 'city', regions: ['Lamar County', 'Texas'] },
  { name: 'Dover', lat: 39.1582, lng: -75.5244, country: 'United States', countryCode: 'us', kind: 'city', regions: ['Kent County', 'Delaware'] },
]

export function findPlace(name: string): GazetteerEntry {
  const hit = GAZETTEER.find((e) => e.name.toLowerCase() === name.toLowerCase())
  if (!hit) throw new Error(`Unknown gazetteer place "${name}". Known: ${GAZETTEER.map((e) => e.name).join(', ')}`)
  return hit
}

/** Shape expected by the trip store's `addPlace` and by the Place type. */
export function placeInput(name: string) {
  const e = findPlace(name)
  return { name: e.name, lat: e.lat, lng: e.lng, address: displayName(e) }
}

export function displayName(e: GazetteerEntry): string {
  return [e.name, ...e.regions, e.country].join(', ')
}
