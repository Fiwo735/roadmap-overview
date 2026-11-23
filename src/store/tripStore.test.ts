import { beforeEach, describe, expect, it } from 'vitest'
import type { Trip } from '../types/trip'
import { createTrip } from '../lib/trip'
import { clearHistory, redo, undo, useTripStore, withoutHistory } from './tripStore'

const s = () => useTripStore.getState()
const temporal = () => useTripStore.temporal.getState()

const pt = (n: number) => ({ name: `P${n}`, lat: 40 + n, lng: 10 + n })

function seed(count: number): string[] {
  return Array.from({ length: count }, (_, i) => s().addPlace(pt(i))!)
}

function expectInvariant(trip: Trip = s().trip) {
  expect(trip.legs).toHaveLength(Math.max(0, trip.places.length - 1))
  trip.legs.forEach((leg, i) => {
    expect(leg.fromId).toBe(trip.places[i].id)
    expect(leg.toId).toBe(trip.places[i + 1].id)
  })
}

beforeEach(() => {
  useTripStore.setState({ trip: createTrip() })
  clearHistory()
  temporal().resume()
})

describe('places and the legs invariant', () => {
  it('appends places, creating drive legs', () => {
    const [a, b, c] = seed(3)
    const { trip } = s()
    expect(trip.places.map((p) => p.id)).toEqual([a, b, c])
    expect(trip.legs).toHaveLength(2)
    expect(trip.legs[0]).toMatchObject({ fromId: a, toId: b, mode: 'drive', via: [] })
    expectInvariant()
  })

  it('defaults day: 0 for the first, previous + 1 when appended, previous when inserted', () => {
    seed(3)
    expect(s().trip.places.map((p) => p.day)).toEqual([0, 1, 2])
    s().addPlace(pt(9), 1)
    expect(s().trip.places.map((p) => p.day)).toEqual([0, 0, 1, 2])
    s().addPlace(pt(8), 0)
    expect(s().trip.places[0].day).toBe(0)
    const last = s().trip.places.at(-1)!.day
    s().addPlace(pt(7))
    expect(s().trip.places.at(-1)!.day).toBe(last + 1)
  })

  it('defaults from the previous place\'s effective day when days are out of order', () => {
    const [, b, c] = seed(3) // days 0, 1, 2
    s().updatePlace(c, { day: 0 }) // typed [0, 1, 0]: the last stop is effectively on day 1
    s().addPlace(pt(3))
    expect(s().trip.places.map((p) => p.day)).toEqual([0, 1, 0, 2])
    s().addPlace(pt(4), 3) // between the out-of-order stop and the new last one
    expect(s().trip.places.map((p) => p.day)).toEqual([0, 1, 0, 1, 2])
    expect(b).toBeTruthy()
  })

  it('normalises an explicit day to an integer >= 0, using the default for a non-finite one', () => {
    s().addPlace({ ...pt(0), day: -4 })
    s().addPlace({ ...pt(1), day: 2.7 })
    s().addPlace({ ...pt(2), day: NaN })
    expect(s().trip.places.map((p) => p.day)).toEqual([0, 3, 4])
    const id = s().trip.places[0].id
    s().updatePlace(id, { day: 12.2 })
    expect(s().trip.places[0].day).toBe(12)
  })

  it('clamps the insert index', () => {
    seed(2)
    const id = s().addPlace(pt(5), 99)
    expect(s().trip.places.at(-1)!.id).toBe(id)
    const first = s().addPlace(pt(6), -3)
    expect(s().trip.places[0].id).toBe(first)
    expectInvariant()
  })

  it('keeps a leg (and its settings) when its pair stays adjacent after an insert elsewhere', () => {
    const [a, b] = seed(2)
    const legId = s().trip.legs[0].id
    s().updateLeg(legId, { mode: 'ferry', label: 'Night boat' })
    s().addPlace(pt(3)) // append after b
    s().addPlace(pt(4), 0) // insert before a
    const leg = s().trip.legs.find((l) => l.fromId === a && l.toId === b)
    expect(leg).toMatchObject({ id: legId, mode: 'ferry', label: 'Night boat' })
    expectInvariant()
  })

  it('creates a fresh drive leg across the gap when a middle place is removed', () => {
    const [a, b, c] = seed(3)
    s().updateLeg(s().trip.legs[0].id, { mode: 'train' })
    s().removePlace(b)
    expect(s().trip.places.map((p) => p.id)).toEqual([a, c])
    expect(s().trip.legs).toHaveLength(1)
    expect(s().trip.legs[0]).toMatchObject({ fromId: a, toId: c, mode: 'drive', via: [] })
  })

  it('removes the last legs down to none', () => {
    const [a, b] = seed(2)
    s().removePlace(b)
    expect(s().trip.legs).toEqual([])
    s().removePlace(a)
    expect(s().trip.places).toEqual([])
  })

  it('moves places and re-syncs legs', () => {
    const [a, b, c] = seed(3)
    s().movePlace(0, 2)
    expect(s().trip.places.map((p) => p.id)).toEqual([b, c, a])
    expectInvariant()
    // b -> c was adjacent before and after, so that leg survives.
    expect(s().trip.legs[0]).toMatchObject({ fromId: b, toId: c })
  })

  it('ignores moves that do nothing or are out of range', () => {
    seed(3)
    const before = s().trip
    s().movePlace(1, 1)
    s().movePlace(-1, 0)
    s().movePlace(0, 7)
    expect(s().trip).toBe(before)
    expect(temporal().pastStates).toHaveLength(3)
  })

  it('updatePlace merges fields and drops keys set to undefined', () => {
    const [a] = seed(1)
    s().updatePlace(a, { name: 'Lyon', address: 'Lyon, France', customName: true })
    expect(s().trip.places[0]).toMatchObject({ name: 'Lyon', address: 'Lyon, France', customName: true })
    s().updatePlace(a, { address: undefined })
    expect(s().trip.places[0]).not.toHaveProperty('address')
  })

  it('addPlace keeps optional fields only when provided', () => {
    const id = s().addPlace({ ...pt(0), address: 'Somewhere', customName: true, note: 'Hi' })
    expect(s().trip.places[0]).toEqual({
      id,
      name: 'P0',
      lat: 40,
      lng: 10,
      day: 0,
      address: 'Somewhere',
      customName: true,
      note: 'Hi',
    })
    s().addPlace(pt(1))
    expect(s().trip.places[1]).not.toHaveProperty('address')
  })
})

describe('invalid input never reaches the trip', () => {
  const bad = [
    ['NaN lat', { lat: NaN, lng: 1 }],
    ['Infinity lng', { lat: 1, lng: Infinity }],
    ['lat out of range', { lat: 90.5, lng: 1 }],
    ['lng out of range', { lat: 1, lng: -181 }],
    ['string lat', { lat: '5' as unknown as number, lng: 1 }],
    ['undefined lng', { lat: 1, lng: undefined as unknown as number }],
  ] as const

  it.each(bad)('addPlace rejects %s and records nothing', (_label, coords) => {
    seed(1)
    const before = s().trip
    expect(s().addPlace({ name: 'Bad', ...coords })).toBeNull()
    expect(s().trip).toBe(before)
    expect(temporal().pastStates).toHaveLength(1)
  })

  it('addPlace accepts the extreme valid coordinates', () => {
    expect(s().addPlace({ name: 'Pole', lat: -90, lng: 180 })).not.toBeNull()
  })

  it('addPlace falls back to an empty name or default day for junk values', () => {
    seed(2)
    const id = s().addPlace({ lat: 1, lng: 2, name: undefined as unknown as string, day: 'x' as unknown as number })!
    expect(s().trip.places.find((p) => p.id === id)).toMatchObject({ name: '', day: 2 })
  })

  // `undefined` means "not provided" in a patch, so it is covered by the required-fields test below.
  it.each(bad.filter(([label]) => label !== 'undefined lng'))('updatePlace ignores %s', (_label, coords) => {
    const [a] = seed(1)
    const before = s().trip
    s().updatePlace(a, coords)
    expect(s().trip).toBe(before)
  })

  it('updatePlace drops a coordinate update with any invalid half, keeping the rest of the patch', () => {
    const [a] = seed(1)
    s().updatePlace(a, { lat: 10, lng: NaN, name: 'Renamed' })
    expect(s().trip.places[0]).toMatchObject({ name: 'Renamed', lat: 40, lng: 10 })
  })

  it('updatePlace never deletes or corrupts required fields', () => {
    const [a] = seed(1)
    const before = s().trip
    s().updatePlace(a, {
      name: undefined,
      lat: undefined,
      lng: undefined,
      day: undefined,
    })
    s().updatePlace(a, { name: 42 as unknown as string, day: NaN })
    s().updatePlace(a, { id: 'other' } as never)
    expect(s().trip).toBe(before)
    expect(s().trip.places[0]).toMatchObject({ id: a, name: 'P0', lat: 40, lng: 10, day: 0 })
  })

  it('updatePlace still moves a place with valid coordinates and clears optional fields', () => {
    const [a] = seed(1)
    s().updatePlace(a, { lat: -90, lng: 180, note: 'x' })
    expect(s().trip.places[0]).toMatchObject({ lat: -90, lng: 180, note: 'x' })
    s().updatePlace(a, { note: '' })
    expect(s().trip.places[0]).not.toHaveProperty('note')
  })

  it('addVia / moveVia ignore invalid points', () => {
    seed(2)
    const legId = s().trip.legs[0].id
    s().addVia(legId, 0, { lat: NaN, lng: 1 })
    s().addVia(legId, 0, { lat: 1, lng: 200 })
    expect(s().trip.legs[0].via).toEqual([])
    s().addVia(legId, 0, { lat: 1, lng: 1 })
    const before = s().trip
    s().moveVia(legId, 0, { lat: Infinity, lng: 1 })
    expect(s().trip).toBe(before)
  })

  it('updateLeg ignores invalid modes, via lists, durations and undefined required fields', () => {
    seed(2)
    const legId = s().trip.legs[0].id
    const before = s().trip
    s().updateLeg(legId, { mode: 'teleport' as never })
    s().updateLeg(legId, { mode: undefined, via: undefined })
    s().updateLeg(legId, { via: [{ lat: NaN, lng: 0 }] })
    s().updateLeg(legId, { durationMin: -5 })
    s().updateLeg(legId, { durationMin: NaN })
    expect(s().trip).toBe(before)
  })
})

describe('legs and via points', () => {
  it('adds, moves and removes via points', () => {
    seed(2)
    const legId = s().trip.legs[0].id
    s().addVia(legId, 0, { lat: 1, lng: 1 })
    s().addVia(legId, 1, { lat: 3, lng: 3 })
    s().addVia(legId, 1, { lat: 2, lng: 2 })
    expect(s().trip.legs[0].via).toEqual([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
    ])
    s().moveVia(legId, 1, { lat: 2.5, lng: 2.5 })
    expect(s().trip.legs[0].via[1]).toEqual({ lat: 2.5, lng: 2.5 })
    s().removeVia(legId, 0)
    expect(s().trip.legs[0].via).toEqual([
      { lat: 2.5, lng: 2.5 },
      { lat: 3, lng: 3 },
    ])
  })

  it('treats bad indices and unknown legs as no-ops', () => {
    seed(2)
    const legId = s().trip.legs[0].id
    const before = s().trip
    s().moveVia(legId, 3, { lat: 1, lng: 1 })
    s().removeVia(legId, 0)
    s().addVia('nope', 0, { lat: 1, lng: 1 })
    s().updateLeg('nope', { mode: 'ferry' })
    expect(s().trip).toBe(before)
  })

  it('copies via points so callers cannot alias store state', () => {
    seed(2)
    const legId = s().trip.legs[0].id
    const point = { lat: 5, lng: 5, extra: 'x' }
    s().addVia(legId, 0, point)
    expect(s().trip.legs[0].via[0]).toEqual({ lat: 5, lng: 5 })
    expect(s().trip.legs[0].via[0]).not.toBe(point)
  })

  it('updateLeg records no history for a no-op patch, including equal via contents', () => {
    seed(2)
    const legId = s().trip.legs[0].id
    s().updateLeg(legId, { via: [] })
    s().updateLeg(legId, { mode: 'drive', via: [] })
    expect(temporal().pastStates).toHaveLength(2) // only the two addPlace calls

    s().updateLeg(legId, { via: [{ lat: 1, lng: 2 }] })
    expect(temporal().pastStates).toHaveLength(3)
    const before = s().trip
    s().updateLeg(legId, { via: [{ lat: 1, lng: 2 }] })
    s().updateLeg(legId, { straight: undefined, label: '' })
    expect(s().trip).toBe(before)
    expect(temporal().pastStates).toHaveLength(3)
  })

  it('updateLeg changes the mode, straight flag and duration', () => {
    seed(2)
    const legId = s().trip.legs[0].id
    s().updateLeg(legId, { mode: 'flight', durationMin: 95 })
    expect(s().trip.legs[0]).toMatchObject({ mode: 'flight', durationMin: 95 })
    s().updateLeg(legId, { durationMin: undefined, straight: true })
    expect(s().trip.legs[0]).not.toHaveProperty('durationMin')
    expect(s().trip.legs[0].straight).toBe(true)
  })
})

describe('trip metadata', () => {
  it('sets title, subtitle and start date', () => {
    s().setTitle('Norway 2026')
    s().setSubtitle('Fjords')
    s().setStartDate('2026-07-04')
    expect(s().trip).toMatchObject({ title: 'Norway 2026', subtitle: 'Fjords', startDate: '2026-07-04' })
    s().setSubtitle('')
    s().setStartDate(undefined)
    expect(s().trip).not.toHaveProperty('subtitle')
    expect(s().trip).not.toHaveProperty('startDate')
  })

  it('ignores malformed start dates', () => {
    s().setStartDate('2026-07-04')
    s().setStartDate('04/07/2026')
    expect(s().trip.startDate).toBe('2026-07-04')
  })
})

describe('replaceTrip and newTrip', () => {
  it('replaceTrip is a single undoable step and repairs legs', () => {
    seed(2)
    clearHistory()
    const incoming = createTrip({
      id: 'imported',
      title: 'Imported',
      places: [
        { id: 'x', name: 'X', lat: 1, lng: 1, day: 0 },
        { id: 'y', name: 'Y', lat: 2, lng: 2, day: 1 },
        { id: 'z', name: 'Z', lat: 3, lng: 3, day: 2 },
      ],
    })
    const before = s().trip
    s().replaceTrip(incoming)
    expect(s().trip.id).toBe('imported')
    expectInvariant()
    expect(temporal().pastStates).toHaveLength(1)
    undo()
    expect(s().trip).toBe(before)
  })

  it('newTrip resets to an empty trip and can be undone', () => {
    seed(2)
    const before = s().trip
    s().newTrip()
    expect(s().trip.places).toEqual([])
    expect(s().trip.id).not.toBe(before.id)
    undo()
    expect(s().trip).toBe(before)
  })
})

describe('undo / redo history', () => {
  it('records one step per action and restores exactly', () => {
    s().setTitle('A')
    s().setTitle('B')
    expect(temporal().pastStates).toHaveLength(2)
    undo()
    expect(s().trip.title).toBe('A')
    undo()
    expect(s().trip.title).toBe(createTrip().title)
    redo()
    redo()
    expect(s().trip.title).toBe('B')
  })

  it('does not record no-op actions', () => {
    s().setTitle('A')
    const n = temporal().pastStates.length
    s().setTitle('A')
    s().setSubtitle(undefined)
    s().setStartDate(undefined)
    s().updatePlace('missing', { name: 'x' })
    s().removePlace('missing')
    expect(temporal().pastStates).toHaveLength(n)
  })

  it('does not record a no-op updatePlace', () => {
    const [a] = seed(1)
    const n = temporal().pastStates.length
    s().updatePlace(a, { name: 'P0', day: 0 })
    expect(temporal().pastStates).toHaveLength(n)
  })

  it('clears redo history on a new action', () => {
    s().setTitle('A')
    undo()
    expect(temporal().futureStates).toHaveLength(1)
    s().setTitle('B')
    expect(temporal().futureStates).toHaveLength(0)
  })

  it('caps history at 100 steps', () => {
    for (let i = 0; i < 130; i++) s().setTitle(`T${i}`)
    expect(temporal().pastStates).toHaveLength(100)
  })

  it('tracks only the trip', () => {
    s().setTitle('A')
    expect(Object.keys(temporal().pastStates[0])).toEqual(['trip'])
  })

  it('undoes a place insert together with its legs', () => {
    seed(2)
    s().addPlace(pt(3))
    expect(s().trip.legs).toHaveLength(2)
    undo()
    expect(s().trip.places).toHaveLength(2)
    expect(s().trip.legs).toHaveLength(1)
    expectInvariant()
  })
})

describe('withoutHistory', () => {
  it('applies a follow-up change without adding an undo step, and tracking resumes afterwards', () => {
    const [a] = seed(1)
    const before = temporal().pastStates.length
    s().updatePlace(a, { lat: 41, lng: 11 }) // the user's gesture: one step
    withoutHistory(() => s().updatePlace(a, { name: 'Named later' })) // the machine's follow-up
    expect(temporal().pastStates.length).toBe(before + 1)
    expect(s().trip.places[0].name).toBe('Named later')
    expect(temporal().isTracking).toBe(true)

    // Undo goes back over the whole gesture; redo brings the follow-up back with it.
    undo()
    expect(s().trip.places[0]).toMatchObject({ name: 'P0', lat: 40 })
    redo()
    expect(s().trip.places[0]).toMatchObject({ name: 'Named later', lat: 41 })

    s().updatePlace(a, { day: 5 })
    expect(temporal().pastStates.length).toBe(before + 2)
  })

  it('resumes tracking even when the callback throws, and leaves a paused store paused', () => {
    expect(() =>
      withoutHistory(() => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(temporal().isTracking).toBe(true)

    temporal().pause()
    withoutHistory(() => undefined)
    expect(temporal().isTracking).toBe(false)
  })
})
