import { describe, expect, it } from 'vitest'
import {
  COLOR_PRESETS,
  DEFAULT_VEHICLE_KIND,
  VEHICLES,
  VEHICLE_KINDS,
  canonicalVehicle,
  darken,
  isDarkBody,
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

  it('keeps the stored ids but shows new names: kind campervan is the Car, kind iveco-daily the Campervan', () => {
    expect(DEFAULT_VEHICLE_KIND).toBe('campervan')
    expect(VEHICLES.campervan.label).toBe('Car')
    expect(VEHICLES['iveco-daily'].label).toBe('Campervan')
    expect(VEHICLE_KINDS.map((k) => VEHICLES[k].label)).toEqual(['Car', 'Campervan', 'Retro camper bus', 'Motorhome', 'Car with caravan', '4×4 with roof tent'])
    for (const kind of VEHICLE_KINDS) expect(VEHICLES[kind].label).not.toMatch(/iveco|daily/i)
  })

  it('draws the Campervan black unless another colour is chosen, and its black is a preset', () => {
    expect(VEHICLES['iveco-daily'].defaultColor).toBe('#15181d')
    expect(luminance(VEHICLES['iveco-daily'].defaultColor)).toBeLessThan(0.15)
    expect(COLOR_PRESETS).toContainEqual({ value: VEHICLES['iveco-daily'].defaultColor, label: 'Black' })
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

describe('isDarkBody', () => {
  it('is true for black and other dark colours, which need a halo on dark ground', () => {
    for (const color of ['#000000', '#15181d', '#1a2a6c', '#4a0d0d', '#123456']) expect(isDarkBody(color)).toBe(true)
  })

  it('is false for light and mid-tone colours', () => {
    for (const color of ['#ffffff', '#c5ccd6', '#d4382c', '#f0c230', '#2f6fd1', '#3f9560', '#808080']) expect(isDarkBody(color)).toBe(false)
  })

  it('finds only black among the presets', () => {
    expect(COLOR_PRESETS.filter((c) => isDarkBody(c.value)).map((c) => c.label)).toEqual(['Black'])
  })
})

describe('resolveVehicle', () => {
  it('is the white car (kind campervan) when there is no vehicle', () => {
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

  it('is black for the Campervan, and any colour can be chosen for it', () => {
    expect(resolveVehicle({ kind: 'iveco-daily' })).toEqual({ kind: 'iveco-daily', color: '#15181d' })
    expect(resolveVehicle({ kind: 'iveco-daily', color: '#FF0000' })).toEqual({ kind: 'iveco-daily', color: '#ff0000' })
    expect(resolveVehicle({ kind: 'iveco-daily', color: 'nonsense' })).toEqual({ kind: 'iveco-daily', color: '#15181d' })
  })
})

describe('canonicalVehicle', () => {
  it('is nothing for the default campervan, however it is spelled', () => {
    expect(canonicalVehicle('campervan')).toBeUndefined()
    expect(canonicalVehicle('campervan', '#FFFFFF')).toBeUndefined()
    expect(canonicalVehicle('campervan', 'garbage')).toBeUndefined()
    expect(canonicalVehicle('campervan', null)).toBeUndefined()
  })

  it('drops a colour that is the vehicle\'s own, or not a colour', () => {
    expect(canonicalVehicle('retro-bus', VEHICLES['retro-bus'].defaultColor)).toEqual({ kind: 'retro-bus' })
    expect(canonicalVehicle('offroad', 'nope')).toEqual({ kind: 'offroad' })
  })

  it('stores the Campervan\'s own black as nothing and any other colour as #rrggbb', () => {
    expect(canonicalVehicle('iveco-daily')).toEqual({ kind: 'iveco-daily' })
    expect(canonicalVehicle('iveco-daily', '#15181d')).toEqual({ kind: 'iveco-daily' })
    expect(canonicalVehicle('iveco-daily', '#15181D')).toEqual({ kind: 'iveco-daily' })
    expect(canonicalVehicle('iveco-daily', '#ff0000')).toEqual({ kind: 'iveco-daily', color: '#ff0000' })
    expect(canonicalVehicle('iveco-daily', '#FFF')).toEqual({ kind: 'iveco-daily', color: '#ffffff' })
  })

  it('keeps a black Car, which is not its own colour', () => {
    expect(canonicalVehicle('campervan', '#15181d')).toEqual({ kind: 'campervan', color: '#15181d' })
  })

  it('keeps a chosen colour as #rrggbb', () => {
    expect(canonicalVehicle('campervan', '#D4382C')).toEqual({ kind: 'campervan', color: '#d4382c' })
    expect(canonicalVehicle('caravan', '#fff')).toEqual({ kind: 'caravan', color: '#ffffff' })
  })
})

describe('labels and equality', () => {
  it('names the vehicle', () => {
    expect(vehicleLabel(undefined)).toBe('Car')
    expect(vehicleLabel({ kind: 'campervan' })).toBe('Car')
    expect(vehicleLabel({ kind: 'iveco-daily' })).toBe('Campervan')
    expect(vehicleLabel({ kind: 'iveco-daily', color: '#ff0000' })).toBe('Campervan')
  })

  it('compares what the ride would draw, not how it is written', () => {
    expect(sameVehicle(undefined, { kind: 'campervan' })).toBe(true)
    expect(sameVehicle(undefined, { kind: 'campervan', color: '#ffffff' })).toBe(true)
    expect(sameVehicle({ kind: 'iveco-daily', color: '#15181D' }, { kind: 'iveco-daily' })).toBe(true)
    expect(sameVehicle({ kind: 'iveco-daily', color: '#ff0000' }, { kind: 'iveco-daily' })).toBe(false)
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
    expect(parseVehicle({ kind: 'iveco-daily', color: '#D4382C' }, warnings)).toEqual({ kind: 'iveco-daily', color: '#d4382c' })
    expect(parseVehicle({ kind: 'iveco-daily', color: '#15181d' }, warnings)).toEqual({ kind: 'iveco-daily' })
    expect(parseVehicle({ kind: 'motorhome', color: '#D4382C' }, warnings)).toEqual({ kind: 'motorhome', color: '#d4382c' })
    expect(parseVehicle({ kind: 'campervan', color: '#ffffff' }, warnings)).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('falls back to the default vehicle for an unknown kind and says so, naming it as the picker does', () => {
    const warnings: string[] = []
    expect(parseVehicle({ kind: 'hovercraft', color: '#ff0000' }, warnings)).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('hovercraft')
    expect(warnings[0]).toContain('the car is used')
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
    expect(warnings[0]).toContain('the car is used')
  })

  it('keeps an absurdly long kind out of the warning', () => {
    const warnings: string[] = []
    parseVehicle({ kind: 'x'.repeat(5000) }, warnings)
    expect(warnings[0].length).toBeLessThan(200)
  })
})
