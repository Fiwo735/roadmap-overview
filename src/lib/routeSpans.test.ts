import { describe, expect, it } from 'vitest'
import type { LatLng, RouteSpan } from '../types/trip'
import doverCalais from './fixtures/osrm-dover-calais.json'
import { pathLengthM } from './geo'
import { decodePolyline, decodePolylineUncached, encodePolyline } from './polyline'
import { simplifyPath } from './simplify'
import { areValidSpans, simplifyWithSpans, spansFromSteps, splitSpans } from './routeSpans'

/** A straight run of `n + 1` points from a to b. */
const run = (a: LatLng, b: LatLng, n: number): LatLng[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ lat: a.lat + ((b.lat - a.lat) * i) / n, lng: a.lng + ((b.lng - a.lng) * i) / n }))

const step = (mode: string, points: LatLng[], distance: number, duration: number) => ({
  mode,
  distance,
  duration,
  geometry: encodePolyline(points),
})

const hirtshals = { lat: 57.5887, lng: 9.9597 }
const port = { lat: 57.5972, lng: 9.9741 }
const arrival = { lat: 58.1362, lng: 7.9922 }
const kristiansand = { lat: 58.1466, lng: 7.9956 }

/** What OSRM sends for Hirtshals → Kristiansand: a drive to the port, the ferry, a drive on the other side. */
const FERRY_STEPS = [
  step('driving', run(hirtshals, port, 12), 1500, 120),
  step('ferry', [port, { lat: 57.9, lng: 9 }, arrival], 140_000, 11_000),
  step('driving', run(arrival, kristiansand, 6), 1300, 110),
  step('driving', [kristiansand, kristiansand], 0, 0),
]

describe('spansFromSteps', () => {
  it('splits a route into driven and ferry stretches that share their boundary points', () => {
    const result = spansFromSteps(FERRY_STEPS)!
    expect(result.spans.map((s) => s.mode)).toEqual(['drive', 'ferry', 'drive'])
    expect(result.spans[0].from).toBe(0)
    expect(result.spans[0].to).toBe(result.spans[1].from)
    expect(result.spans[1].to).toBe(result.spans[2].from)
    expect(result.spans[2].to).toBe(result.path.length - 1)
    expect(areValidSpans(result.spans, result.path.length)).toBe(true)

    // Each boundary is the real port on its side, and the shared point is stored once.
    const [drive1, ferry, drive2] = result.spans
    expect(result.path[ferry.from]).toEqual(port)
    expect(result.path[ferry.to]).toEqual(arrival)
    expect(result.path).toHaveLength(13 + 2 + 6)
    expect(drive1.to - drive1.from).toBe(12)
    expect(drive2.to - drive2.from).toBe(6)
  })

  it("carries each stretch's own distance and duration, with a step of no length folded into its neighbour", () => {
    const [drive1, ferry, drive2] = spansFromSteps(FERRY_STEPS)!.spans
    expect([drive1.distanceM, drive1.durationS]).toEqual([1500, 120])
    expect([ferry.distanceM, ferry.durationS]).toEqual([140_000, 11_000])
    expect([drive2.distanceM, drive2.durationS]).toEqual([1300, 110])
  })

  it('merges consecutive steps of one kind, also across the legs of a multi-stop route', () => {
    const a = { lat: 50, lng: 5 }
    const b = { lat: 50.1, lng: 5.1 }
    const c = { lat: 50.2, lng: 5.2 }
    const result = spansFromSteps([
      step('driving', run(a, b, 3), 10, 1),
      step('driving', run(b, c, 3), 20, 2),
      step('ferry', run(c, { lat: 50.3, lng: 5.3 }, 2), 30, 3),
    ])!
    expect(result.spans).toEqual([
      { mode: 'drive', from: 0, to: 6, distanceM: 30, durationS: 3 },
      { mode: 'ferry', from: 6, to: 8, distanceM: 30, durationS: 3 },
    ])
  })

  it('treats every non-ferry mode as driving (shuttle trains, …)', () => {
    const a = { lat: 51, lng: 1 }
    const result = spansFromSteps([
      step('driving', run(a, { lat: 51.1, lng: 1 }, 2), 1, 1),
      step('train', run({ lat: 51.1, lng: 1 }, { lat: 51.2, lng: 1 }, 2), 1, 1),
      step('ferry', run({ lat: 51.2, lng: 1 }, { lat: 51.3, lng: 1 }, 2), 1, 1),
    ])!
    expect(result.spans.map((s) => s.mode)).toEqual(['drive', 'ferry'])
  })

  it('has nothing to say about a route without a ferry, and gives up on steps it cannot read', () => {
    expect(spansFromSteps([step('driving', run(hirtshals, port, 4), 100, 10)])).toBeNull()
    expect(spansFromSteps([])).toBeNull()
    expect(spansFromSteps([{ mode: 'ferry' }])).toBeNull()
    expect(spansFromSteps([{ mode: 'ferry', geometry: 'not a polyline!!' }])).toBeNull()
    expect(spansFromSteps([null as never])).toBeNull()
  })

  it('is exact enough to decode the same geometry the router sent', () => {
    const { path } = spansFromSteps(FERRY_STEPS)!
    expect(decodePolyline(encodePolyline(path))).toHaveLength(path.length)
  })
})

describe('a real OSRM answer (Dover to Calais through the Eurotunnel shuttle, which OSRM models as a ferry)', () => {
  const route = doverCalais.routes[0]
  const overview = decodePolylineUncached(route.geometry)
  const traced = spansFromSteps(route.legs[0].steps)!

  it('finds the crossing between two driven stretches', () => {
    expect(traced.spans.map((s) => s.mode)).toEqual(['drive', 'ferry', 'drive'])
    expect(areValidSpans(traced.spans, traced.path.length)).toBe(true)
    expect([traced.spans[1].distanceM, traced.spans[1].durationS]).toEqual([59_241, 2_089.4])
    // The metrics of the stretches add up to the route's own.
    expect(traced.spans.reduce((sum, s) => sum + s.distanceM, 0)).toBeCloseTo(route.distance, 0)
    expect(traced.spans.reduce((sum, s) => sum + s.durationS, 0)).toBeCloseTo(route.duration, 0)
  })

  it('traces exactly the overview geometry, so the spans can be applied to either', () => {
    expect(traced.path).toHaveLength(overview.length)
    expect(pathLengthM(traced.path)).toBeCloseTo(pathLengthM(overview), 3)
  })

  it('keeps the crossing intact through simplification, which cuts the point count a lot', () => {
    const simple = simplifyWithSpans(traced.path, traced.spans, 12)
    expect(simple.path.length).toBeLessThan(traced.path.length / 3)
    expect(areValidSpans(simple.spans, simple.path.length)).toBe(true)
    const [, ferry] = simple.spans
    expect(simple.path[ferry.from]).toEqual(traced.path[traced.spans[1].from])
    expect(simple.path[ferry.to]).toEqual(traced.path[traced.spans[1].to])
  })
})

describe('simplifyWithSpans', () => {
  // A dense drive, a ferry with a gentle bend, a dense drive: far more points than a 12 m tolerance needs.
  const dense = spansFromSteps([
    step('driving', run(hirtshals, port, 200), 1500, 120),
    step('ferry', run(port, arrival, 50), 140_000, 11_000),
    step('driving', run(arrival, kristiansand, 200), 1300, 110),
  ])!

  it('keeps every way-of-travel change and renumbers the spans to the shorter path', () => {
    const result = simplifyWithSpans(dense.path, dense.spans, 12)
    expect(result.path.length).toBeLessThan(dense.path.length / 10)
    expect(result.spans.map((s) => s.mode)).toEqual(['drive', 'ferry', 'drive'])
    expect(areValidSpans(result.spans, result.path.length)).toBe(true)
    expect(result.path[result.spans[1].from]).toEqual(port)
    expect(result.path[result.spans[1].to]).toEqual(arrival)
    expect(result.path[0]).toEqual(hirtshals)
    expect(result.path[result.path.length - 1]).toEqual(kristiansand)
  })

  it('leaves the metrics of the spans alone', () => {
    const result = simplifyWithSpans(dense.path, dense.spans, 12)
    expect(result.spans.map((s) => [s.distanceM, s.durationS])).toEqual(dense.spans.map((s) => [s.distanceM, s.durationS]))
  })

  it('simplifies each span on its own: a bend at a boundary survives plain simplification of the whole', () => {
    // Drive east, then the ferry turns back at a shallow angle right after the boundary: whole-path
    // Douglas-Peucker would drop the boundary point (it is inside the 12 m corridor), per-span keeps it.
    const west = { lat: 50, lng: 5 }
    const joint = { lat: 50, lng: 5.1 }
    const far = { lat: 50.00005, lng: 5.2 }
    const path = [...run(west, joint, 10), ...run(joint, far, 10).slice(1)]
    const spans: RouteSpan[] = [
      { mode: 'drive', from: 0, to: 10, distanceM: 1, durationS: 1 },
      { mode: 'ferry', from: 10, to: 20, distanceM: 1, durationS: 1 },
    ]
    expect(simplifyPath(path, 12)).toEqual([west, far])
    const result = simplifyWithSpans(path, spans, 12)
    expect(result.path).toEqual([west, joint, far])
    expect(result.spans.map((s) => [s.from, s.to])).toEqual([
      [0, 1],
      [1, 2],
    ])
  })

  it('is plain simplification when there are no spans', () => {
    const result = simplifyWithSpans(run(hirtshals, port, 100), [], 12)
    expect(result.spans).toEqual([])
    expect(result.path).toEqual([hirtshals, port])
  })
})

describe('areValidSpans', () => {
  const ok: RouteSpan[] = [
    { mode: 'drive', from: 0, to: 3, distanceM: 1, durationS: 1 },
    { mode: 'ferry', from: 3, to: 5, distanceM: 1, durationS: 1 },
  ]
  it('accepts spans that cover the geometry end to end', () => {
    expect(areValidSpans(ok, 6)).toBe(true)
  })
  it('takes anything: input that is not a list of spans is just invalid', () => {
    for (const junk of [undefined, null, 5, 'spans', {}, [null], [undefined], [[]], [5]]) expect(areValidSpans(junk, 6)).toBe(false)
  })
  it.each([
    ['none at all', [], 6],
    ['a geometry longer than the spans', ok, 7],
    ['a gap between spans', [ok[0], { ...ok[1], from: 4 }], 6],
    ['spans that do not start at the first point', [{ ...ok[0], from: 1 }, ok[1]], 6],
    ['an empty span', [{ ...ok[0], to: 0 }], 1],
    ['a fractional index', [{ ...ok[0], to: 2.5 }, { ...ok[1], from: 2.5 }], 6],
    ['an unknown mode', [{ ...ok[0], mode: 'train' as never }, ok[1]], 6],
    ['a negative duration', [ok[0], { ...ok[1], durationS: -1 }], 6],
    ['a non-finite distance', [ok[0], { ...ok[1], distanceM: Infinity }], 6],
  ])('rejects %s', (_label, spans, count) => {
    expect(areValidSpans(spans, count as number)).toBe(false)
  })
})

describe('splitSpans', () => {
  it('returns the whole path as one main part without spans', () => {
    const path = run(hirtshals, port, 3)
    expect(splitSpans(path, undefined)).toEqual({ main: [path], ferry: [] })
  })

  it('cuts ferry stretches out of the path, boundaries shared', () => {
    const { path, spans } = spansFromSteps(FERRY_STEPS)!
    const { main, ferry } = splitSpans(path, spans)
    expect(main).toHaveLength(2)
    expect(ferry).toHaveLength(1)
    expect(ferry[0][0]).toEqual(port)
    expect(ferry[0][ferry[0].length - 1]).toEqual(arrival)
    expect(main[0][main[0].length - 1]).toEqual(ferry[0][0])
  })
})
