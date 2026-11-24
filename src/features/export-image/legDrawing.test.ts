import { describe, expect, it } from 'vitest'
import { CASING_EDGE, haloDash, MODES, STRAIGHT_DRIVE_DASH } from '../../lib/modes'
import { ERROR_COLOR, LOADING_COLOR } from '../routing/legStyle'
import { legRoutesOf, makeTrip, place } from '../stats/testHelpers'
import { planLegParts, planLegs } from './legDrawing'

const a = place('a', 45, 5)
const b = place('b', 46, 6)
const c = place('c', 47, 7)

describe('planLegs', () => {
  it('draws a routed drive leg as the drive line over a darker casing', () => {
    const trip = makeTrip([a, b])
    const plan = planLegs(legRoutesOf(trip, { 0: {} }))
    expect(plan.parts).toHaveLength(1)
    const [part] = plan.parts
    expect(part.line).toMatchObject({ color: MODES.drive.color, weight: MODES.drive.weight, dashArray: [], cap: 'round' })
    expect(part.casing).toMatchObject({ color: MODES.drive.casing, weight: MODES.drive.weight + 2 * CASING_EDGE })
    expect(part.stretches).toHaveLength(1)
    expect(part.stretches[0].length).toBeGreaterThanOrEqual(2)
    expect(plan.badges).toEqual([]) // a drive leg has no badge
  })

  it('draws ferry and train legs dashed, with a dashed white halo and a badge in the middle', () => {
    const trip = makeTrip([a, b, c], { 0: { mode: 'ferry' }, 1: { mode: 'train' } })
    const plan = planLegs(legRoutesOf(trip))
    const [ferry, train] = plan.parts
    expect(ferry.line).toMatchObject({ color: MODES.ferry.color, dashArray: [10, 8], cap: 'butt' })
    const halo = haloDash(MODES.ferry.dashArray as string)
    expect(ferry.casing).toMatchObject({ color: '#ffffff', dashArray: halo?.dashArray.split(' ').map(Number), dashOffset: halo?.dashOffset })
    expect(train.line).toMatchObject({ color: MODES.train.color, dashArray: [2, 7] })
    expect(plan.badges.map((s) => s.mode)).toEqual(['ferry', 'train'])
  })

  it('draws a flight without a casing, as an arc', () => {
    const far = place('far', 10, 100)
    const trip = makeTrip([a, far], { 0: { mode: 'flight' } })
    const plan = planLegs(legRoutesOf(trip))
    expect(plan.parts[0].casing).toBeNull()
    expect(plan.parts[0].line).toMatchObject({ color: MODES.flight.color, dashArray: [6, 8] })
    expect(plan.parts[0].stretches[0].length).toBeGreaterThan(10) // the great-circle arc, not two points
    expect(plan.badges.map((s) => s.mode)).toEqual(['flight'])
  })

  it('draws a straight drive leg dotted', () => {
    const trip = makeTrip([a, b], { 0: { straight: true } })
    const [part] = planLegs(legRoutesOf(trip)).parts
    expect(part.line).toMatchObject({ color: MODES.drive.color, dashArray: STRAIGHT_DRIVE_DASH.split(' ').map(Number), cap: 'round' })
    expect(part.casing).toBeNull()
  })

  it('draws the ferry crossings inside a drive route in the ferry style, with a badge each', () => {
    const trip = makeTrip([a, b])
    const points = [a, { lat: 45.3, lng: 5.3 }, { lat: 45.6, lng: 5.6 }, b]
    const plan = planLegs(
      legRoutesOf(trip, {
        0: {
          points,
          spans: [
            { mode: 'drive', from: 0, to: 1, distanceM: 1, durationS: 1 },
            { mode: 'ferry', from: 1, to: 2, distanceM: 1, durationS: 1 },
            { mode: 'drive', from: 2, to: 3, distanceM: 1, durationS: 1 },
          ],
        },
      }),
    )
    expect(plan.parts).toHaveLength(2)
    const [drive, ferry] = plan.parts
    expect(drive.line.color).toBe(MODES.drive.color)
    expect(drive.stretches).toHaveLength(2)
    expect(ferry.line.color).toBe(MODES.ferry.color)
    expect(ferry.stretches).toEqual([[points[1], points[2]]])
    expect(plan.badges.map((s) => s.mode)).toEqual(['ferry'])
  })

  it('shows a leg that is not routed yet as the grey placeholder and a failed one in red, without badges', () => {
    const trip = makeTrip([a, b, c], { 1: { mode: 'ferry' } })
    const loading = planLegs(legRoutesOf(trip, {}, []))
    expect(loading.parts[0].line).toMatchObject({ color: LOADING_COLOR, dashArray: [6, 8] })
    expect(loading.parts[0].casing).toBeNull()
    expect(loading.parts[0].stretches).toEqual([[a, b].map(({ lat, lng }) => ({ lat, lng }))])
    const failed = planLegs(legRoutesOf(trip, {}, [0]))
    expect(failed.parts[0].line.color).toBe(ERROR_COLOR)
    // The ferry leg is hand-drawn, so it is always known, and keeps its badge.
    expect(failed.badges.map((s) => s.mode)).toEqual(['ferry'])
  })
})

describe('planLegParts', () => {
  const coords = [a, b]

  it('draws one leg the way planLegs does', () => {
    const trip = makeTrip([a, b])
    const [info] = legRoutesOf(trip, { 0: {} })
    const parts = planLegParts({ mode: 'drive', straight: false, status: 'ok', coords: info.coords })
    expect(parts).toEqual(planLegs([info]).parts)
  })

  it('draws the heavier style of a selected leg, which the ride\'s trail uses', () => {
    const [plain] = planLegParts({ mode: 'drive', straight: false, status: 'ok', coords })
    const [trail] = planLegParts({ mode: 'drive', straight: false, status: 'ok', coords }, true)
    expect(trail.line.weight).toBe(plain.line.weight + 4)
    expect(trail.casing?.weight).toBe((plain.casing?.weight ?? 0) + 4)
  })

  it('draws the ferry stretches of a drive leg in the ferry style, and a leg not routed yet as the placeholder', () => {
    const points = [a, { lat: 45.3, lng: 5.3 }, { lat: 45.6, lng: 5.6 }, b]
    const spans = [
      { mode: 'drive' as const, from: 0, to: 1, distanceM: 1, durationS: 1 },
      { mode: 'ferry' as const, from: 1, to: 2, distanceM: 1, durationS: 1 },
      { mode: 'drive' as const, from: 2, to: 3, distanceM: 1, durationS: 1 },
    ]
    const parts = planLegParts({ mode: 'drive', straight: false, status: 'ok', coords: points, spans })
    expect(parts.map((p) => p.line.color)).toEqual([MODES.drive.color, MODES.ferry.color])
    const [loading] = planLegParts({ mode: 'drive', straight: false, status: 'loading', coords })
    expect(loading.line.color).toBe(LOADING_COLOR)
  })
})
