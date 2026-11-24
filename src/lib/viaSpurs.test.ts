import { describe, expect, it } from 'vitest'
import type { LatLng, RouteSpan } from '../types/trip'
import spurWindow from './fixtures/osrm-via-spur.json'
import { haversineM, pathLengthM } from './geo'
import { distanceToPathM } from './nearest'
import { decodePolylineUncached } from './polyline'
import { MAX_SPUR_ARM_M, trimViaSpurs } from './viaSpurs'

/** Points every `stepM` metres along the corner points (a road drawn with plenty of vertices). */
function road(corners: readonly LatLng[], stepM = 20): LatLng[] {
  const out: LatLng[] = [corners[0]]
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1]
    const b = corners[i]
    const n = Math.max(1, Math.round(haversineM(a, b) / stepM))
    for (let k = 1; k <= n; k++) out.push({ lat: a.lat + ((b.lat - a.lat) * k) / n, lng: a.lng + ((b.lng - a.lng) * k) / n })
  }
  return out
}

/** About `m` metres north / east of a point (small distances only). */
const north = (p: LatLng, m: number): LatLng => ({ lat: p.lat + m / 111_195, lng: p.lng })
const east = (p: LatLng, m: number): LatLng => ({ lat: p.lat, lng: p.lng + m / (111_195 * Math.cos((p.lat * Math.PI) / 180)) })

const west0 = { lat: 45.6, lng: 5.2 }
const junction = east(west0, 1500)
const east0 = east(west0, 3000)

/** A main road with a side road leaving it at `junction` and running `armM` north to a dead end. */
function withStub(armM: number): { path: LatLng[]; tip: LatLng } {
  const tip = north(junction, armM)
  const there = road([west0, junction, tip])
  const back = road([tip, junction, east0]).slice(1)
  return { path: [...there, ...back], tip }
}

/** Does the path turn round anywhere (a U-turn over one vertex)? Vertices closer than 1 m are ignored. */
function hasReversal(path: readonly LatLng[]): boolean {
  const pts = path.filter((p, i) => i === 0 || haversineM(path[i - 1], p) > 1)
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const cos = Math.cos((b.lat * Math.PI) / 180)
    const ux = (b.lng - a.lng) * cos
    const uy = b.lat - a.lat
    const vx = (c.lng - b.lng) * cos
    const vy = c.lat - b.lat
    if (ux * vx + uy * vy < -0.9 * Math.hypot(ux, uy) * Math.hypot(vx, vy)) return true
  }
  return false
}

describe('trimViaSpurs', () => {
  it('cuts the out-and-back stub that ends at the via point and keeps the rest of the line', () => {
    const { path, tip } = withStub(400)
    expect(hasReversal(path)).toBe(true)
    const trimmed = trimViaSpurs(path, [tip])

    expect(hasReversal(trimmed.path)).toBe(false)
    // Both arms (2 × 400 m) are gone, nothing else is.
    expect(trimmed.removedM).toBeGreaterThan(780)
    expect(trimmed.removedM).toBeLessThan(820)
    expect(pathLengthM(trimmed.path)).toBeCloseTo(pathLengthM(path) - trimmed.removedM, -1)
    // The line still runs the main road from end to end and no longer goes near the dead end.
    expect(trimmed.path[0]).toEqual(path[0])
    expect(trimmed.path[trimmed.path.length - 1]).toEqual(path[path.length - 1])
    expect(distanceToPathM(tip, trimmed.path)).toBeGreaterThan(380)
    expect(distanceToPathM(junction, trimmed.path)).toBeLessThan(2)
    expect(pathLengthM(trimmed.path)).toBeCloseTo(3000, -1)
  })

  it('works on a real OSRM answer: a via point snapped onto a dead-end road (349 m each way)', () => {
    const path = decodePolylineUncached(spurWindow.geometry)
    expect(hasReversal(path)).toBe(true)
    const trimmed = trimViaSpurs(path, [spurWindow.via])

    expect(hasReversal(trimmed.path)).toBe(false)
    expect(trimmed.removedM).toBeGreaterThan(680)
    expect(trimmed.removedM).toBeLessThan(720)
    expect(trimmed.path[0]).toEqual(path[0])
    expect(trimmed.path[trimmed.path.length - 1]).toEqual(path[path.length - 1])
    // What is left is the road the route came in on and left by: it keeps a line to either end.
    expect(pathLengthM(trimmed.path)).toBeCloseTo(pathLengthM(path) - trimmed.removedM, -1)
  })

  it('leaves a via point on the road alone', () => {
    const path = road([west0, junction, east0])
    const via = east(west0, 700)
    expect(trimViaSpurs(path, [via])).toEqual({ path, spans: undefined, removedM: 0 })
  })

  it('leaves a U-turn between two different roads alone (nothing runs back over itself)', () => {
    const outward = road([west0, junction, north(junction, 600)])
    const side = east(north(junction, 600), 80)
    const back = road([north(junction, 600), side, east(junction, 80), east0]).slice(1)
    const path = [...outward, ...back]
    const trimmed = trimViaSpurs(path, [north(junction, 600)])
    expect(trimmed.path).toEqual(path)
    expect(trimmed.removedM).toBe(0)
  })

  it('leaves a stub that was driven to on purpose (longer than a kilometre each way)', () => {
    const { path, tip } = withStub(MAX_SPUR_ARM_M + 300)
    expect(trimViaSpurs(path, [tip]).path).toEqual(path)
  })

  it('leaves a short driveway-sized stub alone', () => {
    const { path, tip } = withStub(20)
    expect(trimViaSpurs(path, [tip]).path).toEqual(path)
  })

  it('never cuts into the start of the route: a stub that begins at the first point stays', () => {
    const tip = north(west0, 300)
    const path = [...road([west0, tip]), ...road([tip, west0, east0]).slice(1)]
    expect(trimViaSpurs(path, [tip]).path).toEqual(path)
  })

  it('only looks at the via points it is given (a dead-end destination is no stub)', () => {
    const { path } = withStub(400)
    expect(trimViaSpurs(path, []).path).toEqual(path)
    expect(trimViaSpurs(path, [east0]).path).toEqual(path)
  })

  it('trims each via point in turn, on the path as it is by then', () => {
    const first = withStub(300)
    const secondJunction = east(west0, 2400)
    const secondTip = north(secondJunction, 250)
    const there = road([west0, junction, first.tip])
    const mid = road([first.tip, junction, secondJunction, secondTip]).slice(1)
    const end = road([secondTip, secondJunction, east0]).slice(1)
    const path = [...there, ...mid, ...end]
    const trimmed = trimViaSpurs(path, [first.tip, secondTip])
    expect(hasReversal(trimmed.path)).toBe(false)
    expect(trimmed.removedM).toBeGreaterThan(1080)
    expect(trimmed.removedM).toBeLessThan(1120)
    expect(pathLengthM(trimmed.path)).toBeCloseTo(3000, -1)
  })

  it('moves ferry spans to the new indices and refuses a cut with a span boundary inside it', () => {
    const { path, tip } = withStub(400)
    const last = path.length - 1
    const ferryFrom = last - 20
    const driveM = pathLengthM(path.slice(0, ferryFrom + 1))
    const spans: RouteSpan[] = [
      { mode: 'drive', from: 0, to: ferryFrom, distanceM: driveM, durationS: 3600 },
      { mode: 'ferry', from: ferryFrom, to: last, distanceM: 400, durationS: 600 },
    ]
    const trimmed = trimViaSpurs(path, [tip], spans)
    const newLast = trimmed.path.length - 1
    // The drive stretch lost the stub (800 m and its share of the time), the ferry is as it was.
    const [drive, ferry] = trimmed.spans!
    expect(drive).toMatchObject({ mode: 'drive', from: 0, to: newLast - 20 })
    expect(drive.distanceM).toBeCloseTo(driveM - trimmed.removedM, 0)
    expect(drive.durationS).toBeCloseTo((3600 * drive.distanceM) / driveM, 0)
    expect(ferry).toEqual({ ...spans[1], from: newLast - 20, to: newLast })
    // The ferry still starts at the same place on the road.
    expect(trimmed.path[newLast - 20]).toEqual(path[ferryFrom])

    // A boundary on the stub itself: the cut would lose it, so the path is kept as it is.
    const apex = path.findIndex((p) => haversineM(p, tip) < 1)
    const inside: RouteSpan[] = [
      { mode: 'drive', from: 0, to: apex - 5, distanceM: 1, durationS: 1 },
      { mode: 'ferry', from: apex - 5, to: last, distanceM: 1, durationS: 1 },
    ]
    const kept = trimViaSpurs(path, [tip], inside)
    expect(kept.path).toEqual(path)
    expect(kept.spans).toEqual(inside)
  })

  it('does not modify its inputs', () => {
    const { path, tip } = withStub(400)
    const copy = path.map((p) => ({ ...p }))
    const spans: RouteSpan[] = [{ mode: 'drive', from: 0, to: path.length - 1, distanceM: 1, durationS: 1 }]
    trimViaSpurs(path, [tip], spans)
    expect(path).toEqual(copy)
    expect(spans[0].to).toBe(path.length - 1)
  })
})
