import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_CAPTION_LENGTH } from '../../lib/photos'
import { createTrip } from '../../lib/trip'
import { clearHistory, undo, useTripStore } from '../../store/tripStore'
import { usePresentationStore } from '../presentation/presentationStore'
import { removePhoto, setCaption, shiftPhoto } from './photoActions'

let placeId: string
const ids = () => useTripStore.getState().trip.places[0].photos?.map((p) => p.id)
const past = () => useTripStore.temporal.getState().pastStates.length

beforeEach(() => {
  useTripStore.setState({ trip: createTrip() })
  placeId = useTripStore.getState().addPlace({ name: 'Lyon', lat: 45, lng: 5 })!
  useTripStore.getState().updatePlace(placeId, { photos: ['a', 'b', 'c'].map((id) => ({ id, width: 4, height: 3 })) })
  clearHistory()
  usePresentationStore.setState({ on: false })
})

describe('photo actions', () => {
  it('shiftPhoto moves one photo, one undo step; at the ends it does nothing', () => {
    shiftPhoto(placeId, 'a', 1)
    expect(ids()).toEqual(['b', 'a', 'c'])
    expect(past()).toBe(1)
    shiftPhoto(placeId, 'c', 1)
    shiftPhoto(placeId, 'b', -1)
    expect(past()).toBe(1)
    shiftPhoto(placeId, 'c', -1)
    expect(ids()).toEqual(['b', 'c', 'a'])
    undo()
    expect(ids()).toEqual(['b', 'a', 'c'])
  })

  it('removePhoto removes one photo; the last one takes the key away', () => {
    removePhoto(placeId, 'b')
    expect(ids()).toEqual(['a', 'c'])
    removePhoto(placeId, 'nope')
    expect(past()).toBe(1)
    removePhoto(placeId, 'a')
    removePhoto(placeId, 'c')
    expect(useTripStore.getState().trip.places[0]).not.toHaveProperty('photos')
    expect(past()).toBe(3)
  })

  it('setCaption trims, caps and clears', () => {
    setCaption(placeId, 'b', '  Sunset  ')
    expect(useTripStore.getState().trip.places[0].photos![1].caption).toBe('Sunset')
    setCaption(placeId, 'b', 'Sunset')
    expect(past()).toBe(1)
    setCaption(placeId, 'b', 'x'.repeat(MAX_CAPTION_LENGTH + 20))
    expect(useTripStore.getState().trip.places[0].photos![1].caption).toHaveLength(MAX_CAPTION_LENGTH)
    setCaption(placeId, 'b', '   ')
    expect(useTripStore.getState().trip.places[0].photos![1]).toEqual({ id: 'b', width: 4, height: 3 })
    // Only that photo is touched.
    expect(useTripStore.getState().trip.places[0].photos![0]).toEqual({ id: 'a', width: 4, height: 3 })
  })

  it('does nothing while editing is locked', () => {
    usePresentationStore.setState({ on: true })
    removePhoto(placeId, 'a')
    shiftPhoto(placeId, 'a', 1)
    setCaption(placeId, 'a', 'x')
    expect(ids()).toEqual(['a', 'b', 'c'])
    expect(past()).toBe(0)
  })

  it('ignores a place without photos or one that does not exist', () => {
    removePhoto('nope', 'a')
    shiftPhoto('nope', 'a', 1)
    setCaption('nope', 'a', 'x')
    expect(past()).toBe(0)
  })
})
