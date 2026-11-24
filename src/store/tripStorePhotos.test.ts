import { beforeEach, describe, expect, it } from 'vitest'
import { createTrip } from '../lib/trip'
import { MAX_PHOTOS_PER_PLACE, MAX_PHOTOS_PER_TRIP } from '../lib/photos'
import type { PlacePhoto } from '../types/trip'
import { clearHistory, redo, undo, useTripStore } from './tripStore'

const s = () => useTripStore.getState()
const past = () => useTripStore.temporal.getState().pastStates.length
const photo = (id: string, extra: Partial<PlacePhoto> = {}): PlacePhoto => ({ id, width: 40, height: 30, ...extra })

beforeEach(() => {
  useTripStore.setState({ trip: createTrip() })
  clearHistory()
})

function twoPlaces(): [string, string] {
  return [s().addPlace({ name: 'A', lat: 45, lng: 5 })!, s().addPlace({ name: 'B', lat: 46, lng: 6 })!]
}

describe('photos on a place', () => {
  it('updatePlace sets, changes and clears the references: one undo step each', () => {
    const [a] = twoPlaces()
    clearHistory()
    s().updatePlace(a, { photos: [photo('1'), photo('2')] })
    expect(s().trip.places[0].photos).toEqual([photo('1'), photo('2')])
    expect(past()).toBe(1)

    s().updatePlace(a, { photos: [photo('2'), photo('1')] })
    expect(s().trip.places[0].photos?.map((p) => p.id)).toEqual(['2', '1'])
    expect(past()).toBe(2)

    // The same list again changes nothing, and adds no step.
    s().updatePlace(a, { photos: [photo('2'), photo('1')] })
    expect(past()).toBe(2)

    s().updatePlace(a, { photos: undefined })
    expect(s().trip.places[0]).not.toHaveProperty('photos')
    s().updatePlace(a, { photos: [] })
    expect(past()).toBe(3)

    undo()
    expect(s().trip.places[0].photos?.map((p) => p.id)).toEqual(['2', '1'])
    undo()
    undo()
    expect(s().trip.places[0]).not.toHaveProperty('photos')
    redo()
    expect(s().trip.places[0].photos?.map((p) => p.id)).toEqual(['1', '2'])
  })

  it('an empty list removes the key', () => {
    const [a] = twoPlaces()
    s().updatePlace(a, { photos: [photo('1')] })
    s().updatePlace(a, { photos: [] })
    expect(s().trip.places[0]).not.toHaveProperty('photos')
  })

  it('refuses nonsense and cleans what it takes', () => {
    const [a] = twoPlaces()
    s().updatePlace(a, { photos: [photo('1'), photo('1'), { id: '', width: 1, height: 1 }, { id: 'x', width: -1, height: 2 }] as PlacePhoto[] })
    expect(s().trip.places[0].photos).toEqual([photo('1')])
    // A place holds at most 50.
    s().updatePlace(a, { photos: Array.from({ length: 80 }, (_, i) => photo(`m${i}`)) })
    expect(s().trip.places[0].photos).toHaveLength(MAX_PHOTOS_PER_PLACE)
  })

  it('a trip holds at most 300 photos over all its places', () => {
    const ids = Array.from({ length: 7 }, (_, i) => s().addPlace({ name: `P${i}`, lat: 40 + i, lng: 5 })!)
    for (const [i, id] of ids.entries()) s().updatePlace(id, { photos: Array.from({ length: 50 }, (_, n) => photo(`p${i}_${n}`)) })
    const total = () => s().trip.places.reduce((sum, p) => sum + (p.photos?.length ?? 0), 0)
    expect(total()).toBe(MAX_PHOTOS_PER_TRIP)
    expect(s().trip.places[6].photos).toBeUndefined()
    // Making room elsewhere makes room here.
    s().updatePlace(ids[0], { photos: undefined })
    s().updatePlace(ids[6], { photos: Array.from({ length: 50 }, (_, n) => photo(`late_${n}`)) })
    expect(s().trip.places[6].photos).toHaveLength(50)
    expect(total()).toBe(MAX_PHOTOS_PER_TRIP)
  })

  it('moving or editing the place keeps its photos; deleting it takes them', () => {
    const [a, b] = twoPlaces()
    s().updatePlace(a, { photos: [photo('1')] })
    s().updatePlace(a, { name: 'Renamed', lat: 47 })
    s().movePlace(0, 1)
    expect(s().trip.places.find((p) => p.id === a)?.photos).toEqual([photo('1')])
    s().removePlace(a)
    expect(s().trip.places.map((p) => p.id)).toEqual([b])
    undo()
    expect(s().trip.places.find((p) => p.id === a)?.photos).toEqual([photo('1')])
  })
})
