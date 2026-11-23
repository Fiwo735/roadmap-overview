import { describe, expect, it } from 'vitest'
import { dedupeResults, regionLine, settlementName, shortName, toGeoResult, type GeoResult } from './geoResult'

describe('shortName', () => {
  it('prefers the result name', () => {
    expect(shortName({ name: 'Camping Les Pins', address: { village: 'Saint-Jean' }, display_name: 'x, y' })).toBe(
      'Camping Les Pins',
    )
  })

  it('falls back through the address keys in priority order', () => {
    const keys = ['city', 'town', 'village', 'hamlet', 'suburb', 'municipality', 'county', 'state']
    for (let i = 0; i < keys.length; i++) {
      // Every key from i on is present: the first of them wins.
      const address = Object.fromEntries(keys.slice(i).map((k) => [k, `${k} name`]))
      expect(shortName({ name: '', address, display_name: 'Rue 5, Somewhere' })).toBe(`${keys[i]} name`)
    }
  })

  it('ignores blank names and address values', () => {
    expect(shortName({ name: '   ', address: { city: ' ', town: 'Annecy' } })).toBe('Annecy')
  })

  it('uses the first segment of the display name as a last resort', () => {
    expect(shortName({ name: '', address: { road: 'Rue de la Paix' }, display_name: 'Rue de la Paix, Paris, France' })).toBe(
      'Rue de la Paix',
    )
    expect(shortName({})).toBe('')
  })
})

describe('toGeoResult', () => {
  const lyon = {
    lat: '45.7578137',
    lon: '4.8320114',
    name: 'Lyon',
    display_name: 'Lyon, Métropole de Lyon, Auvergne-Rhône-Alpes, France',
    address: { city: 'Lyon', country: 'France', country_code: 'FR' },
    addresstype: 'city',
    type: 'administrative',
  }

  it('parses string coordinates and optional fields', () => {
    expect(toGeoResult(lyon)).toEqual({
      lat: 45.7578137,
      lng: 4.8320114,
      name: 'Lyon',
      address: 'Lyon, Métropole de Lyon, Auvergne-Rhône-Alpes, France',
      countryCode: 'fr',
      kind: 'city',
    })
  })

  it('omits optional fields that are missing and falls back to the name for the address', () => {
    expect(toGeoResult({ lat: 1, lon: 2, name: 'Nowhere' })).toEqual({ lat: 1, lng: 2, name: 'Nowhere', address: 'Nowhere' })
  })

  it('rejects missing, non-numeric and out-of-range coordinates', () => {
    expect(toGeoResult({ name: 'x' })).toBeNull()
    expect(toGeoResult({ lat: 'abc', lon: '1' })).toBeNull()
    expect(toGeoResult({ lat: '95', lon: '1' })).toBeNull()
    expect(toGeoResult({ lat: '1', lon: '181' })).toBeNull()
  })
})

describe('regionLine', () => {
  it('drops the leading short name', () => {
    expect(regionLine({ name: 'Lyon', address: 'Lyon, Métropole de Lyon, France' })).toBe('Métropole de Lyon, France')
  })

  it('keeps the whole address when it does not start with the name', () => {
    expect(regionLine({ name: 'Lyon', address: '1 Rue X, Rhône, France' })).toBe('1 Rue X, Rhône, France')
    expect(regionLine({ name: 'Lyon', address: 'Lyon' })).toBe('Lyon')
  })
})

describe('settlementName / reverse results', () => {
  // A right-click in central Munich: Nominatim names the quarter, the address has the city.
  const munich = {
    lat: '48.1374',
    lon: '11.5755',
    name: 'Graggenauerviertel',
    display_name: 'Graggenauerviertel, Altstadt-Lehel, München, Bayern, Deutschland',
    address: { suburb: 'Graggenauerviertel', city_district: 'Altstadt-Lehel', city: 'München', country_code: 'de' },
    addresstype: 'quarter',
  }

  it('prefers the settlement over the quarter for reverse results, but not for search results', () => {
    expect(toGeoResult(munich, { settlement: true })?.name).toBe('München')
    expect(toGeoResult(munich)?.name).toBe('Graggenauerviertel')
    expect(toGeoResult(munich, { settlement: true })?.address).toContain('Graggenauerviertel')
  })

  it('walks city, town, village, hamlet, municipality, then falls back to the usual short name', () => {
    const keys = ['city', 'town', 'village', 'hamlet', 'municipality']
    for (let i = 0; i < keys.length; i++) {
      const address = Object.fromEntries(keys.slice(i).map((k) => [k, `${k} name`]))
      expect(settlementName({ name: 'Some quarter', address: { suburb: 'Quarter', ...address } })).toBe(`${keys[i]} name`)
    }
    expect(settlementName({ name: 'Camping Les Pins', address: { county: 'Var' } })).toBe('Camping Les Pins')
    expect(settlementName({ name: '', address: { suburb: 'Quarter', county: 'Var' } })).toBe('Quarter')
  })
})

describe('dedupeResults', () => {
  const hit = (over: Partial<GeoResult>): GeoResult => ({
    lat: 45.8992,
    lng: 6.1289,
    name: 'Annecy',
    address: 'Annecy, Haute-Savoie, France',
    ...over,
  })

  it('drops a repeat of the same place and keeps the first', () => {
    const first = hit({})
    const repeat = hit({ lat: 45.9, lng: 6.13 })
    expect(dedupeResults([first, repeat])).toEqual([first])
  })

  it('keeps hits that differ in name, region or position', () => {
    const results = [
      hit({}),
      hit({ name: 'Annecy-le-Vieux', address: 'Annecy-le-Vieux, Haute-Savoie, France' }),
      hit({ address: 'Annecy, Somewhere Else, France' }),
      hit({ lat: 46.5, lng: 6.5 }), // same label, 70 km away
    ]
    expect(dedupeResults(results)).toHaveLength(4)
  })

  it('keeps the order and handles empty input', () => {
    expect(dedupeResults([])).toEqual([])
    const a = hit({ name: 'A', address: 'A, X' })
    const b = hit({ name: 'B', address: 'B, X' })
    expect(dedupeResults([a, b, a])).toEqual([a, b])
  })
})
