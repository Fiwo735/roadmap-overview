import { describe, expect, it } from 'vitest'
import { effectiveDays } from '../../lib/trip'
import { needsRouter } from '../routing/legRoutes'
import { parseTripJson } from '../../lib/tripFileIo'
import text from '../../../public/samples/hamburg-fjords.trip.json?raw'

describe('the bundled sample trip', () => {
  const parsed = parseTripJson(text)

  it('is a valid trip file that needs no repairs', () => {
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.warnings).toEqual([])
  })

  it('is a realistic two-week trip with days, a note or two and one explicit ferry leg', () => {
    if (!parsed.ok) throw new Error(parsed.error)
    const { trip } = parsed.file
    expect(trip.places.length).toBeGreaterThanOrEqual(10)
    const eff = effectiveDays(trip.places)
    expect(eff[eff.length - 1] - eff[0] + 1).toBeGreaterThanOrEqual(14)
    expect(trip.places.filter((p) => p.note).length).toBeGreaterThan(0)
    const ferries = trip.legs.filter((leg) => leg.mode === 'ferry')
    expect(ferries).toHaveLength(1)
    const [leg] = ferries
    const names = [leg.fromId, leg.toId].map((id) => trip.places.find((p) => p.id === id)?.name)
    expect(names).toEqual(['Hirtshals', 'Kristiansand'])
  })

  it('carries a route for every leg that needs the router, so it opens without asking OSRM', () => {
    if (!parsed.ok) throw new Error(parsed.error)
    const { trip, routes } = parsed.file
    const routed = trip.legs.filter(needsRouter)
    expect(routed.length).toBeGreaterThan(0)
    expect(routed.filter((leg) => !routes?.[leg.id]).map((leg) => leg.id)).toEqual([])
  })
})
