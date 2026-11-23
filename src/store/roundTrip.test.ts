import { beforeEach, describe, expect, it } from 'vitest'
import { createTrip } from '../lib/trip'
import { collectLegRoutes, parseTripFile, serializeTripFile } from '../lib/tripFile'
import { clearHistory, useTripStore } from './tripStore'

const s = () => useTripStore.getState()

/** What autosave and export do: serialise the store's trip, push it through JSON text, parse it back. */
function roundTrip() {
  const trip = s().trip
  const text = JSON.stringify(serializeTripFile(trip, collectLegRoutes(trip, {})))
  return parseTripFile(JSON.parse(text))
}

beforeEach(() => {
  useTripStore.setState({ trip: createTrip() })
  clearHistory()
})

describe('store -> serialize -> parse', () => {
  it('reproduces a trip edited through the store exactly, with no warnings', () => {
    s().addPlace({ name: 'Lyon', lat: 45.76, lng: 4.83, address: 'Lyon, France' })!
    const b = s().addPlace({ name: 'Annecy', lat: 45.9, lng: 6.13 })!
    s().addPlace({ name: 'Zurich', lat: 47.37, lng: 8.54 }, 1)
    s().updateLeg(s().trip.legs[0].id, { mode: 'train', via: [{ lat: 46, lng: 5 }], durationMin: 90 })
    s().updatePlace(b, { note: 'Lake', day: 3 })
    s().movePlace(0, 2)
    s().setTitle('Alps')
    s().setStartDate('2026-07-04')

    const res = roundTrip()
    expect(res.ok && res.file.trip).toEqual(s().trip)
    expect(res.ok && res.warnings).toEqual([])
  })

  it('never lets a non-finite or out-of-range place through the store, so the file stays whole', () => {
    s().addPlace({ name: 'A', lat: 1, lng: 1 })
    const b = s().addPlace({ name: 'B', lat: 2, lng: 2 })!
    s().addPlace({ name: 'NaN', lat: NaN, lng: 3 })
    s().addPlace({ name: 'Inf', lat: 3, lng: Infinity })
    s().addPlace({ name: 'Far', lat: 3, lng: 400 })
    s().updatePlace(b, { lat: NaN })
    s().updatePlace(b, { lng: -Infinity, name: undefined })
    s().addPlace({ name: 'C', lat: 3, lng: 3 })

    const res = roundTrip()
    expect(res.ok && res.file.trip.places.map((p) => p.name)).toEqual(['A', 'B', 'C'])
    expect(res.ok && res.file.trip).toEqual(s().trip)
    expect(res.ok && res.warnings).toEqual([])
  })

  it('still recovers the good places if a bad one got past the store (e.g. written directly)', () => {
    s().addPlace({ name: 'A', lat: 1, lng: 1 })
    s().addPlace({ name: 'B', lat: 2, lng: 2 })
    s().addPlace({ name: 'C', lat: 3, lng: 3 })
    // Bypass the actions on purpose: NaN becomes null in JSON text.
    const trip = s().trip
    useTripStore.setState({
      trip: { ...trip, places: trip.places.map((p) => (p.name === 'B' ? { ...p, lat: NaN, lng: Infinity } : p)) },
    })

    const res = roundTrip()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.file.trip.places.map((p) => p.name)).toEqual(['A', 'C'])
    expect(res.file.trip.legs).toHaveLength(1)
    expect(res.file.trip.legs[0]).toMatchObject({
      fromId: res.file.trip.places[0].id,
      toId: res.file.trip.places[1].id,
    })
    expect(res.warnings.some((w) => w.startsWith('Place 2') && w.includes('dropped'))).toBe(true)
  })
})
