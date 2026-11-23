import { describe, expect, it } from 'vitest'
import { assetUrl } from './assetUrl'

describe('assetUrl', () => {
  it('joins a path onto the base', () => {
    expect(assetUrl('flags/de.svg', '/')).toBe('/flags/de.svg')
    expect(assetUrl('flags/de.svg', '/roadmap-overview/')).toBe('/roadmap-overview/flags/de.svg')
  })

  it('copes with a base without a trailing slash and a path with a leading one', () => {
    expect(assetUrl('/samples/a.json', '/roadmap-overview')).toBe('/roadmap-overview/samples/a.json')
    expect(assetUrl('samples/a.json', '/')).toBe('/samples/a.json')
  })

  it('uses the build base by default', () => {
    expect(assetUrl('x')).toBe(`${import.meta.env.BASE_URL}x`)
  })
})
