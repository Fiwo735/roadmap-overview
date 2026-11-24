import { describe, expect, it } from 'vitest'
import {
  COLOR_PRESETS,
  DEFAULT_VEHICLE_KIND,
  VEHICLES,
  VEHICLE_KINDS,
  canonicalVehicle,
  darken,
  isVehicleKind,
  lighten,
  luminance,
  mixColors,
  normalizeColor,
  parseColor,
  parseVehicle,
  resolveVehicle,
  sameVehicle,
  vehicleLabel,
} from './vehicles'

describe('the registry', () => {
  it('lists every kind once, each with a name and a valid default colour', () => {
    expect(new Set(VEHICLE_KINDS).size).toBe(VEHICLE_KINDS.length)
    expect(Object.keys(VEHICLES).sort()).toEqual([...VEHICLE_KINDS].sort())
    for (const kind of VEHICLE_KINDS) {
      expect(VEHICLES[kind].kind).toBe(kind)
      expect(VEHICLES[kind].label.length).toBeGreaterThan(2)
      expect(normalizeColor(VEHICLES[kind].defaultColor)).toBe(VEHICLES[kind].defaultColor)
    }
    expect(new Set(VEHICLE_KINDS.map((k) => VEHICLES[k].label)).size).toBe(VEHICLE_KINDS.length)
  })

  it('has the campervan as the default and the black Iveco Daily with a fixed colour', () => {
    expect(DEFAULT_VEHICLE_KIND).toBe('campervan')
    expect(VEHICLES['iveco-daily'].label).toBe('Iveco Daily (black)')
    expect(luminance(VEHICLES['iveco-daily'].defaultColor)).toBeLessThan(0.15)
    expect(VEHICLES['iveco-daily'].colorable).toBe(false)
  })

  it('offers at least six vehicles and some colour presets', () => {
    expect(VEHICLE_KINDS.length).toBeGreaterThanOrEqual(6)
    expect(COLOR_PRESETS.length).toBeGreaterThanOrEqual(5)
    for (const { value } of COLOR_PRESETS) expect(normalizeColor(value)).toBe(value)
  })

  it('knows its kinds', () => {
    expect(isVehicleKind('offroad')).toBe(true)
    expect(isVehicleKind('submarine')).toBe(false)
    expect(isVehicleKind(undefined)).toBe(false)
    expect(isVehicleKind({})).toBe(false)
  })
})

describe('colours', () => {
  it('parses #rgb and #rrggbb in any case, and nothing else', () => {
    expect(parseColor('#FfA500')).toEqual({ r: 255, g: 165, b: 0 })
    expect(parseColor('#0f8')).toEqual({ r: 0, g: 255, b: 136 })
    for (const bad of ['red', '#12', '#12345', '#1234567', 'ffffff', '#gggggg', '', null, undefined, 42, {}]) {
      expect(parseColor(bad)).toBeNull()
    }
  })

  it('normalises to lower-case #rrggbb', () => {
    expect(normalizeColor('#ABC')).toBe('#aabbcc')
    expect(normalizeColor(' #2F6FD1 ')).toBe('#2f6fd1')
    expect(normalizeColor('blue')).toBeNull()
  })

  it('mixes, lightens and darkens', () => {
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(lighten('#000000', 1)).toBe('#ffffff')
    expect(darken('#ffffff', 1)).toBe('#000000')
    expect(darken('#808080', 0)).toBe('#808080')
  })

  it('measures brightness', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1)
    expect(luminance('#ffff00')).toBeGreaterThan(luminance('#0000ff'))
  })
})

describe('resolveVehicle', () => {
  it('is the white campervan when there is no vehicle', () => {
    expect(resolveVehicle(undefined)).toEqual({ kind: 'campervan', color: '#ffffff' })
    expect(resolveVehicle(null)).toEqual({ kind: 'campervan', color: '#ffffff' })
  })

  it('uses a valid colour, in canonical form, and falls back to the vehicle\'s own', () => {
    expect(resolveVehicle({ kind: 'retro-bus', color: '#D4382C' })).toEqual({ kind: 'retro-bus', color: '#d4382c' })
    expect(resolveVehicle({ kind: 'retro-bus' })).toEqual({ kind: 'retro-bus', color: VEHICLES['retro-bus'].defaultColor })
    expect(resolveVehicle({ kind: 'retro-bus', color: 'nonsense' }).color).toBe(VEHICLES['retro-bus'].defaultColor)
  })

  it('falls back to the campervan for an unknown kind', () => {
    expect(resolveVehicle({ kind: 'hovercraft', color: '#ff0000' })).toEqual({ kind: 'campervan', color: '#ff0000' })
  })

  it('ignores a colour for a vehicle that has only one', () => {
    expect(resolveVehicle({ kind: 'iveco-daily', color: '#ff0000' })).toEqual({ kind: 'iveco-daily', color: VEHICLES['iveco-daily'].defaultColor })
  })
})

describe('canonicalVehicle', () => {
  it('is nothing for the default campervan, however it is spelled', () => {
    expect(canonicalVehicle('campervan')).toBeUndefined()
    expect(canonicalVehicle('campervan', '#FFFFFF')).toBeUndefined()
    expect(canonicalVehicle('campervan', 'garbage')).toBeUndefined()
    expect(canonicalVehicle('campervan', null)).toBeUndefined()
  })

  it('drops a colour that is the vehicle\'s own, or not allowed, or not a colour', () => {
    expect(canonicalVehicle('retro-bus', VEHICLES['retro-bus'].defaultColor)).toEqual({ kind: 'retro-bus' })
    expect(canonicalVehicle('iveco-daily', '#ff0000')).toEqual({ kind: 'iveco-daily' })
    expect(canonicalVehicle('offroad', 'nope')).toEqual({ kind: 'offroad' })
  })

  it('keeps a chosen colour as #rrggbb', () => {
    expect(canonicalVehicle('campervan', '#D4382C')).toEqual({ kind: 'campervan', color: '#d4382c' })
    expect(canonicalVehicle('caravan', '#fff')).toEqual({ kind: 'caravan', color: '#ffffff' })
  })
})

describe('labels and equality', () => {
  it('names the vehicle', () => {
    expect(vehicleLabel(undefined)).toBe('Campervan')
    expect(vehicleLabel({ kind: 'iveco-daily' })).toBe('Iveco Daily (black)')
  })

  it('compares what the ride would draw, not how it is written', () => {
    expect(sameVehicle(undefined, { kind: 'campervan' })).toBe(true)
    expect(sameVehicle(undefined, { kind: 'campervan', color: '#ffffff' })).toBe(true)
    expect(sameVehicle({ kind: 'iveco-daily', color: '#ff0000' }, { kind: 'iveco-daily' })).toBe(true)
    expect(sameVehicle({ kind: 'campervan', color: '#ff0000' }, { kind: 'campervan' })).toBe(false)
    expect(sameVehicle({ kind: 'offroad' }, { kind: 'caravan' })).toBe(false)
  })
})

describe('parseVehicle', () => {
  it('reads nothing as the default, without comment', () => {
    const warnings: string[] = []
    expect(parseVehicle(undefined, warnings)).toBeUndefined()
    expect(parseVehicle(null, warnings)).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('reads a good vehicle in canonical form', () => {
    const warnings: string[] = []
    expect(parseVehicle({ kind: 'iveco-daily' }, warnings)).toEqual({ kind: 'iveco-daily' })
    expect(parseVehicle({ kind: 'motorhome', color: '#D4382C' }, warnings)).toEqual({ kind: 'motorhome', color: '#d4382c' })
    expect(parseVehicle({ kind: 'campervan', color: '#ffffff' }, warnings)).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('falls back to the campervan for an unknown kind and says so', () => {
    const warnings: string[] = []
    expect(parseVehicle({ kind: 'hovercraft', color: '#ff0000' }, warnings)).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('hovercraft')
  })

  it('keeps the kind and drops a bad colour, and says so', () => {
    const warnings: string[] = []
    expect(parseVehicle({ kind: 'retro-bus', color: 'red' }, warnings)).toEqual({ kind: 'retro-bus' })
    expect(parseVehicle({ kind: 'retro-bus', color: 12 }, warnings)).toEqual({ kind: 'retro-bus' })
    expect(warnings).toHaveLength(2)
  })

  it.each([['a string', 'campervan'], ['a number', 3], ['a list', ['campervan']], ['no kind', {}]])('does not choke on %s', (_label, raw) => {
    const warnings: string[] = []
    expect(parseVehicle(raw, warnings)).toBeUndefined()
    expect(warnings).toHaveLength(1)
  })

  it('keeps an absurdly long kind out of the warning', () => {
    const warnings: string[] = []
    parseVehicle({ kind: 'x'.repeat(5000) }, warnings)
    expect(warnings[0].length).toBeLessThan(200)
  })
})
