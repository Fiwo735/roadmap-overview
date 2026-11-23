import { beforeAll, describe, expect, it } from 'vitest'
import { countryName, featureCode } from './countryData'
import { flagUrl } from './flags'
import { shapesFromTopology } from './worldIndex'
import topology from 'world-atlas/countries-50m.json'
import type { Topology } from 'topojson-specification'

describe('featureCode', () => {
  it('maps ISO numeric ids (as strings, with or without leading zeros, or as numbers)', () => {
    expect(featureCode('276', 'Germany')).toBe('DE')
    expect(featureCode('040', 'Austria')).toBe('AT')
    expect(featureCode('40', undefined)).toBe('AT')
    expect(featureCode(4, undefined)).toBe('AF')
  })

  it('maps the boundary features that have no id by their name', () => {
    expect(featureCode(undefined, 'Kosovo')).toBe('XK')
    expect(featureCode(undefined, 'N. Cyprus')).toBe('CY')
    expect(featureCode(undefined, 'Somaliland')).toBe('SO')
  })

  it('leaves out what is no country', () => {
    expect(featureCode(undefined, 'Siachen Glacier')).toBeNull()
    expect(featureCode(undefined, 'Indian Ocean Ter.')).toBeNull()
    expect(featureCode(undefined, undefined)).toBeNull()
    expect(featureCode('999', 'Nowhere')).toBeNull()
  })
})

describe('countryName', () => {
  it('gives the common English names', () => {
    expect(countryName('DE')).toBe('Germany')
    expect(countryName('CZ')).toBe('Czechia')
    expect(countryName('GB')).toBe('United Kingdom')
    expect(countryName('US')).toBe('United States')
    expect(countryName('XK')).toBe('Kosovo')
  })

  it('falls back to the code', () => {
    expect(countryName('ZZ')).toBe('ZZ')
  })
})

describe('flagUrl', () => {
  it('points at the SVG of the code, whatever its case', () => {
    expect(flagUrl('de')).toBe('/flags/de.svg')
    expect(flagUrl('DE')).toBe('/flags/de.svg')
    expect(flagUrl('XK')).toBe('/flags/xk.svg')
  })

  it('is null for anything that is not a two-letter code', () => {
    expect(flagUrl('')).toBeNull()
    expect(flagUrl('DEU')).toBeNull()
    expect(flagUrl('../x')).toBeNull()
    expect(flagUrl('1a')).toBeNull()
  })
})

describe('the bundled boundaries', () => {
  let codes: string[]
  beforeAll(() => {
    codes = shapesFromTopology(topology as unknown as Topology).map((s) => s.code)
  })

  it('cover every country once, with a name', () => {
    expect(codes).toHaveLength(new Set(codes).size)
    expect(codes.length).toBeGreaterThan(230)
    for (const code of ['DE', 'FR', 'XK', 'US', 'RU', 'CY', 'SO']) expect(codes).toContain(code)
    for (const code of codes) expect(countryName(code)).not.toBe(code)
  })

  it('all have a flag image in flag-icons', () => {
    const files = Object.keys(import.meta.glob('../../../node_modules/flag-icons/flags/4x3/*.svg')).map((path) => path.split('/').pop())
    for (const code of codes) expect(files).toContain(`${code.toLowerCase()}.svg`)
  })
})
