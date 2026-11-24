import { describe, expect, it } from 'vitest'
import { latToY, lngToX, tileGrid, pickTileZoom, type Viewport } from '../export-image/geometry'
import {
  cameraOn,
  cardAlpha,
  extentOf,
  FOLLOW_MAX_ZOOM,
  FOLLOW_MIN_GAIN,
  followWeight,
  labelBlend,
  pickFollowZoom,
  planFollowBackground,
  planFollowCamera,
  planStillCamera,
  smoothstep,
  smoothTrack,
} from './camera'
import { FPS, planSchedule } from './schedule'

const size = { width: 1920, height: 1080 }

describe('smoothTrack', () => {
  const still = Array.from({ length: 60 }, () => ({ x: 100, y: 50 }))

  it('leaves a track that does not move where it is', () => {
    for (const p of smoothTrack(still, FPS, 0.5)) expect(p).toEqual({ x: 100, y: 50 })
  })

  it('does not lag behind a steady drive (it is smoothed both ways, so a straight line stays straight)', () => {
    const line = Array.from({ length: 400 }, (_, i) => ({ x: i * 4, y: i * -2 }))
    const out = smoothTrack(line, FPS, 0.5)
    // Away from the two ends the smoothed track is the track itself.
    for (let i = 150; i < 250; i++) {
      expect(out[i].x).toBeCloseTo(line[i].x, 0)
      expect(out[i].y).toBeCloseTo(line[i].y, 0)
    }
  })

  it('turns a jump into a glide that is symmetric about it, without overshooting', () => {
    const step = Array.from({ length: 120 }, (_, i) => ({ x: i < 60 ? 0 : 1000, y: 0 }))
    const out = smoothTrack(step, FPS, 0.4)
    const xs = out.map((p) => p.x)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-9)
    expect(Math.max(...xs)).toBeLessThanOrEqual(1000 + 1e-9)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-9)
    // Half way at the middle of the step: no delay either way.
    expect(xs[59] + xs[60]).toBeCloseTo(1000, -1)
    // It starts moving before the step and has not finished just after it: a glide, not a jump.
    expect(xs[50]).toBeGreaterThan(1)
    expect(xs[65]).toBeLessThan(999)
  })

  it('does not change its input, and copes with tiny tracks', () => {
    const input = [{ x: 1, y: 2 }]
    const out = smoothTrack(input, FPS, 0.5)
    expect(out).toEqual(input)
    expect(out[0]).not.toBe(input[0])
    expect(smoothTrack([], FPS, 0.5)).toEqual([])
    expect(smoothTrack(still, FPS, 0)).toEqual(still)
  })
})

describe('followWeight', () => {
  const s = planSchedule('30', 40)

  it('is 0 while the whole trip is held in view, at both ends', () => {
    expect(followWeight(0, s)).toBe(0)
    expect(followWeight(s.intro, s)).toBe(0)
    expect(followWeight(s.intro + s.ride, s)).toBe(0)
    expect(followWeight(s.duration, s)).toBe(0)
  })

  it('is 1 through the middle of the ride, reached and left in a short ease', () => {
    expect(followWeight(s.intro + s.ride / 2, s)).toBe(1)
    const ramp = Array.from({ length: 31 }, (_, i) => followWeight(s.intro + i / FPS, s))
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThanOrEqual(ramp[i - 1])
    expect(followWeight(s.intro + 0.2, s)).toBeGreaterThan(0)
    expect(followWeight(s.intro + 0.2, s)).toBeLessThan(1)
    expect(followWeight(s.intro + 2, s)).toBe(1)
  })

  it('eases in and out over a third of a very short ride at most', () => {
    const short = planSchedule('ride', 2.5)
    expect(short.ride).toBeLessThan(5)
    const mid = followWeight(short.intro + short.ride / 2, short)
    expect(mid).toBe(1)
  })
})

describe('planFollowCamera', () => {
  const schedule = planSchedule('30', 40)
  const whole = { x: 960, y: 540, zoom: 6 }
  const followZoom = 8
  const focus = { x: 960, y: 480 }
  const frames = schedule.frames
  // A van that crosses the background west to east, steadily, during the ride.
  const van = Array.from({ length: frames }, (_, i) => {
    const t = Math.min(1, Math.max(0, (i / FPS - schedule.intro) / schedule.ride))
    return { x: 1000 + 3000 * t, y: 2000 + 400 * Math.sin(t * 6) }
  })
  const path = planFollowCamera({ schedule, van, whole, followZoom, size, focus })

  it('has one camera per frame', () => {
    expect(path).toHaveLength(frames)
  })

  it('shows the whole trip during the opening and closing holds', () => {
    for (const i of [0, FPS / 2, FPS - 1, frames - 1, frames - FPS * 2]) {
      expect(path[i]).toMatchObject({ x: whole.x, y: whole.y, zoom: whole.zoom, follow: 0 })
    }
  })

  it('zooms to the following zoom and keeps the vehicle near the focus while riding', () => {
    for (let i = Math.round((schedule.intro + 2) * FPS); i < frames - Math.round((schedule.end + 2) * FPS); i += 7) {
      const cam = path[i]
      expect(cam.zoom).toBeCloseTo(followZoom)
      expect(cam.follow).toBeCloseTo(1)
      // Where the vehicle is on screen: its distance from the camera's centre, shifted by where the focus is.
      const screenX = van[i].x - cam.x + size.width / 2
      const screenY = van[i].y - cam.y + size.height / 2
      expect(Math.abs(screenX - focus.x)).toBeLessThanOrEqual(0.2 * size.width + 1e-6)
      expect(Math.abs(screenY - focus.y)).toBeLessThanOrEqual(0.18 * size.height + 1e-6)
    }
  })

  it('moves smoothly: the speed of the camera changes gently from frame to frame', () => {
    const steps = path.slice(1).map((cam, i) => ({ x: cam.x - path[i].x, y: cam.y - path[i].y }))
    let worst = 0
    for (let i = 1; i < steps.length; i++) worst = Math.max(worst, Math.hypot(steps[i].x - steps[i - 1].x, steps[i].y - steps[i - 1].y))
    // (The ease-in and ease-out cover the distance from the whole view to the vehicle: a few pixels per frame, per frame.)
    expect(worst).toBeLessThan(15)
    // On the road itself it keeps the vehicle's pace: ~3000 px over the ride is a few pixels a frame.
    const mid = steps[Math.round(frames / 2)]
    expect(Math.hypot(mid.x, mid.y)).toBeLessThan(10)
  })

  it('keeps the vehicle in frame when it jumps (a flight): the camera follows within the drift allowed', () => {
    const jump = van.map((p, i) => ({ x: p.x + (i > frames / 2 ? 6000 : 0), y: p.y }))
    const cams = planFollowCamera({ schedule, van: jump, whole, followZoom, size, focus })
    for (let i = Math.round(5 * FPS); i < frames - Math.round(6 * FPS); i++) {
      const screenX = jump[i].x - cams[i].x + size.width / 2
      expect(Math.abs(screenX - focus.x)).toBeLessThanOrEqual(0.2 * size.width + 1e-6)
    }
  })

  it('is a camera that never moves for the whole-trip choice', () => {
    const still = planStillCamera(10, whole)
    expect(still).toHaveLength(10)
    for (const cam of still) expect(cam).toEqual({ ...whole, follow: 0 })
  })
})

describe('what fades with the camera', () => {
  it('shows the card only while the whole trip is in view', () => {
    expect(cardAlpha(0)).toBe(1)
    expect(cardAlpha(0.5)).toBe(0)
    expect(cardAlpha(1)).toBe(0)
    expect(cardAlpha(0.25)).toBeGreaterThan(0)
    expect(cardAlpha(0.25)).toBeLessThan(1)
  })

  it('swaps the two sets of names half way, through nothing', () => {
    expect(labelBlend(0)).toEqual({ layout: 'whole', alpha: 1 })
    expect(labelBlend(1)).toEqual({ layout: 'follow', alpha: 1 })
    expect(labelBlend(0.5).alpha).toBe(0)
    expect(labelBlend(0.3).layout).toBe('whole')
    expect(labelBlend(0.7).layout).toBe('follow')
    expect(labelBlend(0.1).alpha).toBeGreaterThan(labelBlend(0.3).alpha)
  })

  it('has a smoothstep that stays inside 0 … 1', () => {
    expect(smoothstep(-1)).toBe(0)
    expect(smoothstep(2)).toBe(1)
    expect(smoothstep(0.5)).toBe(0.5)
  })
})

describe('pickFollowZoom', () => {
  // A day's drive of about 2° by 2°.
  const day = { south: 50, west: 5, north: 52, east: 7 }

  it('is the median zoom that fits a day, never closer than the limit', () => {
    const zoom = pickFollowZoom([day, day, day], size, 100, 4) as number
    expect(zoom).toBeGreaterThan(5)
    expect(zoom).toBeLessThanOrEqual(FOLLOW_MAX_ZOOM)
    const tiny = { south: 50, west: 5, north: 50.001, east: 5.001 }
    expect(pickFollowZoom([tiny], size, 100, 4)).toBe(FOLLOW_MAX_ZOOM)
  })

  it('is at least a whole level closer than the whole trip', () => {
    const wide = { south: 40, west: -10, north: 60, east: 30 }
    expect(pickFollowZoom([wide], size, 100, 5)).toBeGreaterThanOrEqual(6)
  })

  it('takes the middle day rather than the extremes', () => {
    const short = { south: 50, west: 5, north: 50.2, east: 5.2 }
    const long = { south: 40, west: -5, north: 60, east: 25 }
    const z = pickFollowZoom([short, day, long], size, 100, 3) as number
    const zDay = pickFollowZoom([day], size, 100, 3) as number
    expect(z).toBeCloseTo(zDay)
  })

  it('has nothing to follow in a trip that already fills the frame at the closest zoom (two places a metre apart)', () => {
    const metre = { south: 50, west: 5, north: 50.00001, east: 5.00001 }
    expect(pickFollowZoom([metre], size, 100, 15)).toBeNull()
    expect(pickFollowZoom([metre], size, 100, FOLLOW_MAX_ZOOM - FOLLOW_MIN_GAIN + 0.01)).toBeNull()
    expect(pickFollowZoom([metre], size, 100, FOLLOW_MAX_ZOOM - 1)).toBe(FOLLOW_MAX_ZOOM)
  })

  it('has nothing to say about a trip without travel days', () => {
    expect(pickFollowZoom([], size, 100, 4)).toBeNull()
  })
})

describe('planFollowBackground', () => {
  // Hamburg … Malmö: about 12° by 8°.
  const route = [
    { lat: 53.5, lng: 10 },
    { lat: 62.4, lng: 7.3 },
    { lat: 55.6, lng: 13 },
  ]
  const whole: Viewport = { ...size, center: { lat: 58, lng: 9.5 }, zoom: 5.4 }
  const extent = extentOf(route)

  it('covers the whole route with half a frame to spare on every side, and the whole-trip view', () => {
    const plan = planFollowBackground({ extent, whole, size, desiredZoom: 7 })
    expect(plan).not.toBeNull()
    const { view } = plan!
    expect(view.zoom).toBeLessThanOrEqual(7)
    expect(view.zoom).toBeGreaterThanOrEqual(whole.zoom + FOLLOW_MIN_GAIN)
    const left = lngToX(view.center.lng, view.zoom) - view.width / 2
    const top = latToY(view.center.lat, view.zoom) - view.height / 2
    const k = 2 ** view.zoom
    expect(extent.minX * k - left).toBeGreaterThanOrEqual(size.width / 2 - 1)
    expect(left + view.width - extent.maxX * k).toBeGreaterThanOrEqual(size.width / 2 - 1)
    expect(extent.minY * k - top).toBeGreaterThanOrEqual(size.height / 2 - 1)
    expect(top + view.height - extent.maxY * k).toBeGreaterThanOrEqual(size.height / 2 - 1)
    // The whole-trip view, at this zoom, is inside it too.
    const ratio = 2 ** (view.zoom - whole.zoom)
    const wl = lngToX(whole.center.lng, view.zoom) - (whole.width * ratio) / 2 - left
    const wt = latToY(whole.center.lat, view.zoom) - (whole.height * ratio) / 2 - top
    expect(wl).toBeGreaterThanOrEqual(-1)
    expect(wt).toBeGreaterThanOrEqual(-1)
    expect(wl + whole.width * ratio).toBeLessThanOrEqual(view.width + 1)
    expect(wt + whole.height * ratio).toBeLessThanOrEqual(view.height + 1)
  })

  it('stays within the caps on pixels and on tiles, lowering the zoom to do so', () => {
    const plan = planFollowBackground({ extent, whole, size, desiredZoom: 12, maxPixels: 16_000_000, maxTiles: 300 })!
    expect(plan.view.width * plan.view.height).toBeLessThanOrEqual(16_000_000)
    expect(tileGrid(plan.view, pickTileZoom(plan.view.zoom, 1)).count).toBeLessThanOrEqual(300)
    expect(plan.view.zoom).toBeLessThan(12)
    const tight = planFollowBackground({ extent, whole, size, desiredZoom: 9, maxTiles: 120 })!
    expect(tileGrid(tight.view, pickTileZoom(tight.view.zoom, 1)).count).toBeLessThanOrEqual(120)
    expect(tight.view.zoom).toBeLessThanOrEqual(plan.view.zoom)
  })

  it('gives up (the trip is shown whole) when even the least closer zoom does not fit', () => {
    expect(planFollowBackground({ extent, whole, size, desiredZoom: 9, maxPixels: 1_000_000 })).toBeNull()
    expect(planFollowBackground({ extent, whole, size, desiredZoom: whole.zoom + 0.1 })).toBeNull()
  })

  it('puts the whole-trip camera where the whole view lies on the background', () => {
    const plan = planFollowBackground({ extent, whole, size, desiredZoom: 7 })!
    const cam = cameraOn(plan.view, whole)
    expect(cam.zoom).toBe(whole.zoom)
    // The background's own middle is the middle of a view centred there.
    const centred = cameraOn(plan.view, { ...plan.view })
    expect(centred.x).toBeCloseTo(plan.view.width / 2)
    expect(centred.y).toBeCloseTo(plan.view.height / 2)
  })
})
