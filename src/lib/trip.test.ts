import { describe, expect, it } from 'vitest'
import type { Leg } from '../types/trip'
import { defaultDayAt, isCalendarDate, isLegMode, normalizeDay, syncLegs } from './trip'

const place = (id: string, day = 0) => ({ id, day })
const leg = (id: string, fromId: string, toId: string): Leg => ({ id, fromId, toId, mode: 'drive', via: [] })

describe('normalizeDay', () => {
  it.each([
    [0, 0],
    [3, 3],
    [2.5, 3],
    [2.4, 2],
    [-7, 0],
    [NaN, 0],
    [Infinity, 0],
    ['4', 0],
    [undefined, 0],
    [1000, 1000],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeDay(input)).toBe(expected)
  })
})

describe('defaultDayAt', () => {
  it('is 0 for the first place and for inserts at the start', () => {
    expect(defaultDayAt([], 0)).toBe(0)
    expect(defaultDayAt([place('a', 4)], 0)).toBe(0)
  })

  it('is previous + 1 when appending, previous when inserting in the middle', () => {
    const places = [place('a', 0), place('b', 2), place('c', 5)]
    expect(defaultDayAt(places, 3)).toBe(6)
    expect(defaultDayAt(places, 1)).toBe(0)
    expect(defaultDayAt(places, 2)).toBe(2)
  })
})

describe('syncLegs', () => {
  it('returns the very same array when nothing changes', () => {
    const legs = [leg('l1', 'a', 'b')]
    expect(syncLegs([place('a'), place('b')], legs)).toBe(legs)
  })

  it('reuses adjacent pairs, creates missing ones, drops the rest', () => {
    const legs = [leg('l1', 'a', 'b'), leg('l2', 'b', 'c')]
    const next = syncLegs([place('a'), place('b'), place('x'), place('c')], legs, () => 'new')
    expect(next.map((l) => [l.id, l.fromId, l.toId])).toEqual([
      ['l1', 'a', 'b'],
      ['new', 'b', 'x'],
      ['new', 'x', 'c'],
    ])
    expect(next[0]).toBe(legs[0])
  })

  it('yields no legs for fewer than two places', () => {
    expect(syncLegs([place('a')], [leg('l1', 'a', 'b')])).toEqual([])
    expect(syncLegs([], [])).toEqual([])
  })

  it('never reuses one leg twice', () => {
    const dup = [leg('l1', 'a', 'b'), leg('l1', 'a', 'b')]
    const next = syncLegs([place('a'), place('b')], dup)
    expect(next).toHaveLength(1)
  })
})

describe('isLegMode / isCalendarDate', () => {
  it('knows the modes', () => {
    expect(isLegMode('ferry')).toBe(true)
    expect(isLegMode('boat')).toBe(false)
    expect(isLegMode(3)).toBe(false)
  })

  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isCalendarDate('2026-07-04')).toBe(true)
    expect(isCalendarDate('2028-02-29')).toBe(true)
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('4/7/2026')).toBe(false)
    expect(isCalendarDate('')).toBe(false)
  })
})
