import { describe, expect, it } from 'vitest'
import { creditAlpha, creditEndHoldS, CREDIT_OPENING_S, daysPerSecond, END_S, FPS, frameClock, INTRO_S, MAX_VIDEO_S, MIN_RIDE_S, paceFrame, planSchedule } from './schedule'

describe('planSchedule', () => {
  it('makes a fixed length exactly that long: the holds, and the ride in between', () => {
    for (const length of ['15', '30', '60'] as const) {
      const s = planSchedule(length, 37.5)
      expect(s.duration).toBe(Number(length))
      expect(s.frames).toBe(Number(length) * FPS)
      expect(s.intro).toBe(INTRO_S)
      expect(s.end).toBe(END_S)
      expect(s.ride).toBeCloseTo(Number(length) - INTRO_S - END_S)
      expect(s.capped).toBe(false)
    }
  })

  it('plays the ride at its own pace for "ride pace": the timeline in seconds, plus the holds', () => {
    const s = planSchedule('ride', 35)
    expect(s.ride).toBeCloseTo(35, 1)
    expect(s.duration).toBeCloseTo(35 + INTRO_S + END_S, 1)
    expect(s.timelineS).toBe(35)
    expect(s.capped).toBe(false)
  })

  it('never makes the ride shorter than a few seconds, whatever the timeline', () => {
    expect(planSchedule('ride', 2.5).ride).toBeCloseTo(MIN_RIDE_S, 1)
    expect(planSchedule('ride', 0).ride).toBeCloseTo(MIN_RIDE_S, 1)
    expect(planSchedule('ride', Number.NaN).ride).toBeCloseTo(MIN_RIDE_S, 1)
  })

  it('caps the length, so a 400-day trip is not a 20-minute video', () => {
    const s = planSchedule('ride', 1200)
    expect(s.duration).toBeLessThanOrEqual(MAX_VIDEO_S + 1 / FPS)
    expect(s.duration).toBeGreaterThan(MAX_VIDEO_S - 1)
    expect(s.capped).toBe(true)
    expect(s.timelineS).toBe(1200)
    expect(planSchedule('ride', MAX_VIDEO_S - INTRO_S - END_S).capped).toBe(false)
  })

  it('has a whole number of frames, and its duration is frames / fps', () => {
    for (const t of [3.3, 17.77, 41.12]) {
      const s = planSchedule('ride', t)
      expect(Number.isInteger(s.frames)).toBe(true)
      expect(s.duration).toBeCloseTo(s.frames / FPS, 9)
      expect(s.intro + s.ride + s.end).toBeCloseTo(s.duration, 9)
    }
  })
})

describe('frameClock', () => {
  const s = planSchedule('30', 40)

  it('holds on the start for the first second', () => {
    for (const i of [0, 1, FPS - 1]) {
      const c = frameClock(s, i)
      expect(c).toMatchObject({ phase: 'intro', rideTime: 0, rideProgress: 0 })
    }
    expect(frameClock(s, FPS).phase).toBe('ride')
  })

  it('plays the whole timeline across the ride, at a steady pace', () => {
    const first = frameClock(s, FPS)
    expect(first.rideTime).toBe(0)
    const mid = frameClock(s, FPS + Math.round((s.ride * FPS) / 2))
    expect(mid.rideTime).toBeCloseTo(20, 0)
    const lastRide = frameClock(s, s.frames - END_S * FPS - 1)
    expect(lastRide.phase).toBe('ride')
    expect(lastRide.rideTime).toBeGreaterThan(39)
    expect(lastRide.rideTime).toBeLessThan(40)
    // Steady: equal steps between frames.
    const a = frameClock(s, FPS + 10).rideTime
    const b = frameClock(s, FPS + 11).rideTime
    const c = frameClock(s, FPS + 12).rideTime
    expect(b - a).toBeCloseTo(c - b, 9)
  })

  it('holds on the finished trip for the last seconds, ending on the very last frame', () => {
    const c = frameClock(s, s.frames - END_S * FPS)
    expect(c).toMatchObject({ phase: 'end', rideTime: 40, rideProgress: 1 })
    expect(frameClock(s, s.frames - 1)).toMatchObject({ phase: 'end', rideTime: 40 })
  })

  it('clamps frames outside the video', () => {
    expect(frameClock(s, -5).index).toBe(0)
    expect(frameClock(s, 99_999).index).toBe(s.frames - 1)
  })

  it('counts time from the start of the video', () => {
    expect(frameClock(s, 45).time).toBeCloseTo(1.5)
  })
})

describe('daysPerSecond', () => {
  it('says how hurried the ride is', () => {
    const s = planSchedule('15', 30)
    expect(daysPerSecond(s, 20)).toBeCloseTo(20 / s.ride)
    expect(daysPerSecond(s, 0)).toBe(0)
  })
})

describe('the OpenStreetMap credit', () => {
  const s = planSchedule('60', 60)

  it('is fully visible from the first frame for the first five seconds (the interactive-map rule)', () => {
    expect(creditAlpha(0, s)).toBe(1)
    expect(creditAlpha(2.5, s)).toBe(1)
    expect(creditAlpha(CREDIT_OPENING_S, s)).toBe(1)
  })

  it('then fades out and stays out while the map moves', () => {
    expect(creditAlpha(CREDIT_OPENING_S + 0.3, s)).toBeGreaterThan(0)
    expect(creditAlpha(CREDIT_OPENING_S + 0.3, s)).toBeLessThan(1)
    expect(creditAlpha(CREDIT_OPENING_S + 1, s)).toBe(0)
    expect(creditAlpha(30, s)).toBe(0)
  })

  it('comes back for the end hold and stays to the last frame', () => {
    const endStart = s.intro + s.ride
    expect(creditAlpha(endStart - 1, s)).toBe(0)
    expect(creditAlpha(endStart + 0.4, s)).toBe(1)
    expect(creditAlpha(s.duration - 1 / FPS, s)).toBe(1)
  })

  it('is on screen long enough to be read on the end hold', () => {
    expect(creditEndHoldS(s)).toBeGreaterThanOrEqual(2.5)
    // Counted frame by frame: the credit is fully opaque for as long as it says.
    const full = Array.from({ length: s.frames }, (_, i) => i / FPS).filter((t) => t > s.intro + s.ride && creditAlpha(t, s) === 1)
    expect(full.length / FPS).toBeGreaterThanOrEqual(creditEndHoldS(s) - 0.1)
  })

  it('is never missing in a video so short that the two windows meet', () => {
    const short = planSchedule('ride', 2.5) // the shortest video there is: 8 s
    expect(short.duration).toBeLessThan(CREDIT_OPENING_S + 4)
    for (let i = 0; i < short.frames; i++) expect(creditAlpha(i / FPS, short)).toBeGreaterThan(0)
  })

  it('is visible at the start and at the end of every length', () => {
    for (const length of ['15', '30', '60', 'ride'] as const) {
      const sch = planSchedule(length, 25)
      expect(creditAlpha(0, sch)).toBe(1)
      expect(creditAlpha((sch.frames - 1) / FPS, sch)).toBe(1)
    }
  })
})

describe('paceFrame (the real-time recorder)', () => {
  const s = { fps: 30, frames: 240 }

  it('waits until a frame is due, then draws that frame', () => {
    expect(paceFrame(s, 30, 0)).toEqual({ waitMs: 1000, index: 30 })
    expect(paceFrame(s, 30, 400)).toEqual({ waitMs: 600, index: 30 })
    expect(paceFrame(s, 30, 1000)).toEqual({ waitMs: 0, index: 30 })
  })

  it('skips the frames that have gone by when drawing falls behind, so the video keeps its pace', () => {
    // Frame 30 was due at 1 s; it is 1.5 s in: draw the frame of that moment.
    expect(paceFrame(s, 30, 1500)).toEqual({ waitMs: 0, index: 45 })
    expect(paceFrame(s, 10, 1999)).toEqual({ waitMs: 0, index: 59 })
  })

  it('never goes backwards or beyond the last frame', () => {
    expect(paceFrame(s, 100, 3400)).toEqual({ waitMs: 0, index: 102 })
    expect(paceFrame(s, 5, 60_000)).toEqual({ waitMs: 0, index: 239 })
    expect(paceFrame(s, 239, 7970)).toEqual({ waitMs: 0, index: 239 })
  })
})
