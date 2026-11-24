import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPORT_OPTIONS, exportFilename, isVeryLarge, LARGE_IMAGE_HINT, outputSize, presetOf, sanitizeOptions, SIZE_PRESETS, uiScaleFor } from './options'

describe('size presets', () => {
  it('are the four documented sizes', () => {
    expect(SIZE_PRESETS.map((p) => [p.id, p.width, p.height])).toEqual([
      ['landscape', 1920, 1080],
      ['portrait', 1080, 1350],
      ['square', 1080, 1080],
      ['a4', 3508, 2480],
    ])
  })

  it('turn into pixels with the resolution', () => {
    expect(outputSize('landscape', 1)).toEqual({ width: 1920, height: 1080 })
    expect(outputSize('portrait', 2)).toEqual({ width: 2160, height: 2700 })
    expect(outputSize('a4', 2)).toEqual({ width: 7016, height: 4960 })
  })

  it('scale the drawing with the shorter side, so a print looks like the screen', () => {
    expect(uiScaleFor({ width: 1920, height: 1080 })).toBeCloseTo(1.2)
    expect(uiScaleFor({ width: 1080, height: 1350 })).toBeCloseTo(1.2)
    expect(uiScaleFor({ width: 3508, height: 2480 })).toBeCloseTo(2.756, 3)
    expect(uiScaleFor({ width: 900, height: 2000 })).toBe(1)
  })

  it('fall back to the first preset for an unknown id', () => {
    expect(presetOf('nope' as never).id).toBe('landscape')
  })
})

describe('isVeryLarge', () => {
  it('flags images beyond what iOS Safari can make: more than 4096 × 4096 pixels', () => {
    expect(isVeryLarge({ width: 4096, height: 4096 })).toBe(false)
    expect(isVeryLarge({ width: 4096, height: 4097 })).toBe(true)
    expect(isVeryLarge(outputSize('a4', 2))).toBe(true) // 35 megapixels
    expect(isVeryLarge(outputSize('a4', 1))).toBe(false)
    expect(isVeryLarge(outputSize('portrait', 2))).toBe(false)
    expect(LARGE_IMAGE_HINT).toMatch(/iPhone\/iPad.*1×/)
  })
})

describe('sanitizeOptions', () => {
  it('keeps valid options', () => {
    const options = { preset: 'a4', scale: 2, card: false, labels: false, days: true, legend: false, cardStyle: 'dark', credit: 'image' }
    expect(sanitizeOptions(options)).toEqual(options)
  })

  it('repairs anything else field by field', () => {
    expect(sanitizeOptions(null)).toEqual(DEFAULT_EXPORT_OPTIONS)
    expect(sanitizeOptions('x')).toEqual(DEFAULT_EXPORT_OPTIONS)
    expect(sanitizeOptions({ preset: 'huge', scale: 3, card: 'yes', labels: false, cardStyle: 'pink', credit: 'none' })).toEqual({ ...DEFAULT_EXPORT_OPTIONS, labels: false })
  })

  it('puts the credit beside the image unless told otherwise, and never lets it be switched off', () => {
    expect(DEFAULT_EXPORT_OPTIONS.credit).toBe('beside')
    expect(sanitizeOptions({}).credit).toBe('beside')
    expect(sanitizeOptions({ credit: 'image' }).credit).toBe('image')
    for (const credit of [false, null, 'off', 'none', '', 0]) expect(sanitizeOptions({ credit }).credit).toBe('beside')
  })
})

describe('exportFilename', () => {
  it('slugs the trip title', () => {
    expect(exportFilename('Hamburg to the Norwegian fjords')).toBe('hamburg-to-the-norwegian-fjords.png')
    expect(exportFilename('  Summer 2026!  ')).toBe('summer-2026.png')
  })

  it('drops accents but keeps other scripts', () => {
    expect(exportFilename('Zürich → Genève')).toBe('zurich-geneve.png')
    expect(exportFilename('Поездка по Алтаю')).toBe('поездка-по-алтаю.png')
  })

  it('has a name for titles without letters or digits', () => {
    expect(exportFilename('')).toBe('trip-map.png')
    expect(exportFilename('***')).toBe('trip-map.png')
  })

  it('stays short and never ends in a hyphen before the extension', () => {
    const name = exportFilename('a'.repeat(59) + ' bcd efg')
    expect(name.endsWith('.png')).toBe(true)
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name).not.toMatch(/-\.png$/)
  })
})
