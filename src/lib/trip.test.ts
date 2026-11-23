import { describe, expect, it } from 'vitest'
import type { Leg } from '../types/trip'
import { defaultDayAt, effectiveDays, isCalendarDate, isLegMode, normalizeDay, parseDay, parseDurationMin, syncLegs } from './trip'

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

describe('parseDay', () => {
  it.each([
    ['0', 0],
    ['7', 7],
    [' 12 ', 12],
    ['007', 7],
    ['999999999999999', 999_999_999_999_999],
  ])('accepts %j', (text, expected) => {
    expect(parseDay(text)).toBe(expected)
  })

  it.each(['', ' ', 'abc', '-1', '+3', '2.5', '1e3', '3 days', '1000000000000000', '٣'])('rejects %j', (text) => {
    expect(parseDay(text)).toBeNull()
  })
})

describe('parseDurationMin', () => {
  it.each([
    ['3', '40', 220],
    ['0', '45', 45],
    ['', '30', 30],
    ['2', '', 120],
    [' 1 ', ' 5 ', 65],
    ['0', '90', 90],
    ['999', '59', 59_999],
  ])('hours %j, minutes %j -> %i minutes', (hours, minutes, expected) => {
    expect(parseDurationMin(hours, minutes)).toBe(expected)
  })

  it.each([
    ['0', '0'],
    ['', ''],
    ['-1', '10'],
    ['1.5', '0'],
    ['1', '2.5'],
    ['a', '10'],
    ['1', 'x'],
    ['10000', '0'],
    ['1e2', '0'],
    ['1000', '0'],
  ])('rejects hours %j, minutes %j', (hours, minutes) => {
    expect(parseDurationMin(hours, minutes)).toBeNull()
  })
})

describe('effectiveDays', () => {
  it('never goes back in time', () => {
    expect(effectiveDays([place('a', 5), place('b', 3), place('c', 4), place('d', 9), place('e', 0)])).toEqual([5, 5, 5, 9, 9])
  })

  it('is the typed days when they are in order, and empty for no places', () => {
    expect(effectiveDays([place('a', 0), place('b', 1), place('c', 1)])).toEqual([0, 1, 1])
    expect(effectiveDays([])).toEqual([])
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

  it('builds on the previous place\'s effective day, not its typed day', () => {
    // Typed [0, 1, 0]: the third stop is effectively on day 1, so the next one is day 2.
    const places = [place('a', 0), place('b', 1), place('c', 0)]
    expect(defaultDayAt(places, 3)).toBe(2)
    // Inserted after the out-of-order stop (before a later one) it shares that effective day (1), not its typed 0.
    expect(defaultDayAt([...places, place('d', 4)], 3)).toBe(1)
    // Inserted after the second stop (day 1), before the out-of-order one.
    expect(defaultDayAt(places, 2)).toBe(1)
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
