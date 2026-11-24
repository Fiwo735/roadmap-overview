import { describe, expect, it } from 'vitest'
import { estimateRemainingS, formatClock, formatRemaining, overallProgress } from './progress'

describe('overallProgress', () => {
  it('runs from 0 to 1 through the three phases, never backwards', () => {
    expect(overallProgress({ phase: 'map', done: 0, total: 0 })).toBe(0)
    expect(overallProgress({ phase: 'map', done: 10, total: 20 })).toBeGreaterThan(0)
    const mapDone = overallProgress({ phase: 'map', done: 20, total: 20 })
    const framesStart = overallProgress({ phase: 'frames', done: 0, total: 900 })
    expect(framesStart).toBeCloseTo(mapDone)
    const mid = overallProgress({ phase: 'frames', done: 450, total: 900 })
    const framesDone = overallProgress({ phase: 'frames', done: 900, total: 900 })
    const finishing = overallProgress({ phase: 'finishing', done: 0, total: 1 })
    expect(mid).toBeGreaterThan(framesStart)
    expect(framesDone).toBeGreaterThan(mid)
    expect(finishing).toBeCloseTo(framesDone)
    expect(overallProgress({ phase: 'finishing', done: 1, total: 1 })).toBe(1)
  })

  it('stays inside 0 … 1 whatever the counts', () => {
    expect(overallProgress({ phase: 'frames', done: 5000, total: 900 })).toBeLessThanOrEqual(1)
    expect(overallProgress({ phase: 'frames', done: -3, total: 900 })).toBeGreaterThanOrEqual(0)
    expect(overallProgress({ phase: 'frames', done: 3, total: 0 })).toBeGreaterThanOrEqual(0)
  })
})

describe('estimateRemainingS', () => {
  it('is the time per frame so far times the frames left', () => {
    expect(estimateRemainingS(250, 1000, 5000)).toBeCloseTo(15)
    expect(estimateRemainingS(900, 900, 30_000)).toBe(0)
  })

  it('has nothing to say at first, then a second of work is enough to go by', () => {
    expect(estimateRemainingS(0, 1000, 0)).toBeNull()
    expect(estimateRemainingS(3, 1000, 200)).toBeNull()
    expect(estimateRemainingS(30, 1000, 400)).toBeNull() // 3 % is not yet 5 %, and not yet a second
    expect(estimateRemainingS(60, 1000, 400)).not.toBeNull() // a twentieth done
    expect(estimateRemainingS(30, 1000, 1500)).not.toBeNull() // a second of work
  })
})

describe('formatRemaining', () => {
  it('says what it knows in rounded, plain words', () => {
    expect(formatRemaining(null)).toBe('Estimating the time left…')
    expect(formatRemaining(2)).toBe('Less than 5 seconds left')
    expect(formatRemaining(23)).toBe('About 25 seconds left')
    expect(formatRemaining(120)).toBe('About 2 minutes left')
    expect(formatRemaining(75)).toBe('About 75 seconds left')
    expect(formatRemaining(95)).toBe('About 2 minutes left')
  })
})

describe('formatClock', () => {
  it('writes a length as m:ss', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(7.4)).toBe('0:07')
    expect(formatClock(30)).toBe('0:30')
    expect(formatClock(90)).toBe('1:30')
    expect(formatClock(-4)).toBe('0:00')
  })
})
