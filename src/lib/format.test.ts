import { describe, expect, it } from 'vitest'
import { formatDistance, formatDuration } from './format'

describe('formatDistance', () => {
  it.each([
    [0, '0 m'],
    [850, '850 m'],
    [999.4, '999 m'],
    [999.5, '1 km'],
    [999.6, '1 km'],
    [1000, '1 km'],
    [1234, '1.2 km'],
    [9949, '9.9 km'],
    [9960, '10 km'],
    [12_500, '13 km'],
    [850_400, '850 km'],
    [1_234_000, '1 234 km'],
    [12_345_678, '12 346 km'],
  ])('%d m -> %s', (m, expected) => {
    expect(formatDistance(m)).toBe(expected)
  })

  it('renders invalid input as an em dash', () => {
    expect(formatDistance(NaN)).toBe('—')
    expect(formatDistance(-5)).toBe('—')
    expect(formatDistance(Infinity)).toBe('—')
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0 min'],
    [29, '0 min'],
    [45 * 60, '45 min'],
    [59 * 60 + 40, '1 h'],
    [60 * 60, '1 h'],
    [3 * 3600 + 40 * 60, '3 h 40 min'],
    [23 * 3600 + 59 * 60, '23 h 59 min'],
    [24 * 3600, '1 d'],
    [2 * 86400 + 5 * 3600, '2 d 5 h'],
    [2 * 86400 + 5 * 3600 + 29 * 60, '2 d 5 h'],
    [2 * 86400 + 23 * 3600 + 40 * 60, '3 d'],
  ])('%d s -> %s', (s, expected) => {
    expect(formatDuration(s)).toBe(expected)
  })

  it('renders invalid input as an em dash', () => {
    expect(formatDuration(NaN)).toBe('—')
    expect(formatDuration(-1)).toBe('—')
  })
})
