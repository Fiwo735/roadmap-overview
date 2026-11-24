import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrip } from '../lib/trip'
import { VEHICLE_PREFERENCE_KEY, preferredVehicle, rememberVehicle, withPreferredVehicle } from './vehiclePreference'

/** A minimal localStorage (node has none). */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

describe('the remembered vehicle', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is nothing until the user has chosen one', () => {
    expect(preferredVehicle()).toBeUndefined()
    const trip = createTrip()
    expect(withPreferredVehicle(trip)).toBe(trip)
  })

  it('remembers a vehicle and a colour, in canonical form', () => {
    rememberVehicle({ kind: 'retro-bus', color: '#D4382C' })
    expect(preferredVehicle()).toEqual({ kind: 'retro-bus', color: '#d4382c' })
    rememberVehicle({ kind: 'iveco-daily' })
    expect(preferredVehicle()).toEqual({ kind: 'iveco-daily' })
    expect(JSON.parse(localStorage.getItem(VEHICLE_PREFERENCE_KEY)!)).toEqual({ kind: 'iveco-daily' })
  })

  it('forgets it when the default campervan is chosen again', () => {
    rememberVehicle({ kind: 'iveco-daily' })
    rememberVehicle(undefined)
    expect(preferredVehicle()).toBeUndefined()
    expect(localStorage.getItem(VEHICLE_PREFERENCE_KEY)).toBeNull()
    rememberVehicle({ kind: 'iveco-daily' })
    rememberVehicle({ kind: 'campervan', color: '#ffffff' })
    expect(preferredVehicle()).toBeUndefined()
  })

  it('gives a trip without a vehicle the remembered one, and leaves a trip that has its own alone', () => {
    rememberVehicle({ kind: 'iveco-daily' })
    const bare = createTrip()
    expect(withPreferredVehicle(bare)).toEqual({ ...bare, vehicle: { kind: 'iveco-daily' } })
    expect(bare).not.toHaveProperty('vehicle')
    const own = createTrip({ vehicle: { kind: 'offroad' } })
    expect(withPreferredVehicle(own)).toBe(own)
  })

  it.each([['not JSON', '{nope'], ['an unknown kind', '{"kind":"hovercraft"}'], ['a string', '"iveco-daily"'], ['a list', '[]']])('ignores %s', (_label, text) => {
    localStorage.setItem(VEHICLE_PREFERENCE_KEY, text)
    expect(preferredVehicle()).toBeUndefined()
  })

  it('repairs a bad colour like a file would', () => {
    localStorage.setItem(VEHICLE_PREFERENCE_KEY, '{"kind":"offroad","color":"red"}')
    expect(preferredVehicle()).toEqual({ kind: 'offroad' })
  })
})

describe('without usable storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('works without localStorage', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => rememberVehicle({ kind: 'iveco-daily' })).not.toThrow()
    expect(preferredVehicle()).toBeUndefined()
  })

  it('works when storage throws', () => {
    const boom = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom })
    expect(() => rememberVehicle({ kind: 'iveco-daily' })).not.toThrow()
    expect(() => rememberVehicle(undefined)).not.toThrow()
    expect(preferredVehicle()).toBeUndefined()
    const trip = createTrip()
    expect(withPreferredVehicle(trip)).toBe(trip)
  })
})
