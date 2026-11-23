import { beforeEach, describe, expect, it } from 'vitest'
import { decodeCacheSize, decodePolyline, encodePolyline } from './polyline'

// The canonical example from Google's polyline documentation.
const GOOGLE_ENCODED = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
const GOOGLE_POINTS = [
  { lat: 38.5, lng: -120.2 },
  { lat: 40.7, lng: -120.95 },
  { lat: 43.252, lng: -126.453 },
]

describe('polyline', () => {
  it('encodes with precision 5', () => {
    expect(encodePolyline(GOOGLE_POINTS)).toBe(GOOGLE_ENCODED)
  })

  it('decodes to LatLng objects', () => {
    expect(decodePolyline(GOOGLE_ENCODED)).toEqual(GOOGLE_POINTS)
  })

  it('round-trips arbitrary coordinates to 5 decimals', () => {
    const pts = [
      { lat: 52.52001, lng: 13.40495 },
      { lat: -33.86882, lng: 151.20929 },
      { lat: 0, lng: -0.00001 },
    ]
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts)
  })

  it('handles an empty polyline', () => {
    expect(encodePolyline([])).toBe('')
    expect(decodePolyline('')).toEqual([])
  })
})

describe('decode cache', () => {
  beforeEach(() => {
    // Flush the memo so size assertions are independent of earlier tests.
    for (let i = 0; i < 400; i++) decodePolyline(encodePolyline([{ lat: i / 1000, lng: 0 }]))
  })

  it('returns the same (frozen) array for repeated decodes', () => {
    const a = decodePolyline(GOOGLE_ENCODED)
    const b = decodePolyline(GOOGLE_ENCODED)
    expect(b).toBe(a)
    expect(Object.isFrozen(a)).toBe(true)
  })

  it('never grows beyond its size cap', () => {
    for (let i = 0; i < 1000; i++) decodePolyline(encodePolyline([{ lat: i / 100, lng: 1 }]))
    expect(decodeCacheSize()).toBeLessThanOrEqual(300)
    expect(decodeCacheSize()).toBeGreaterThan(0)
  })

  it('keeps recently used entries when evicting', () => {
    const keep = decodePolyline(GOOGLE_ENCODED)
    for (let i = 0; i < 299; i++) {
      decodePolyline(encodePolyline([{ lat: i / 100, lng: 2 }]))
      decodePolyline(GOOGLE_ENCODED)
    }
    expect(decodePolyline(GOOGLE_ENCODED)).toBe(keep)
  })
})
