import { beforeEach, describe, expect, it } from 'vitest'
import { createTrip } from '../../lib/trip'
import { clearHistory, useTripStore } from '../../store/tripStore'
import { resetLegShape, setFollowRoads, setLegDurationMin, setLegLabel, setLegMode } from './legActions'

const trip = () => useTripStore.getState().trip
const leg = () => trip().legs[0]
const history = () => useTripStore.temporal.getState().pastStates.length

beforeEach(() => {
  useTripStore.setState({ trip: createTrip() })
  useTripStore.getState().addPlace({ name: 'A', lat: 45, lng: 5 })
  useTripStore.getState().addPlace({ name: 'B', lat: 46, lng: 6 })
  clearHistory()
})

describe('leg editor actions', () => {
  it('each change is one undo step, and one that changes nothing is none', () => {
    setLegMode(leg().id, 'ferry')
    expect(history()).toBe(1)
    setLegMode(leg().id, 'ferry')
    expect(history()).toBe(1)
    setLegDurationMin(leg().id, 90)
    setLegLabel(leg().id, 'Ferry')
    expect(history()).toBe(3)
    useTripStore.temporal.getState().undo()
    expect(leg().label).toBeUndefined()
    useTripStore.temporal.getState().undo()
    expect(leg().durationMin).toBeUndefined()
    useTripStore.temporal.getState().undo()
    expect(leg().mode).toBe('drive')
  })

  it('"follow roads" is the opposite of the straight flag', () => {
    setFollowRoads(leg().id, false)
    expect(leg().straight).toBe(true)
    setFollowRoads(leg().id, true)
    expect(leg()).not.toHaveProperty('straight')
  })

  it('leaving "drive" drops the straight flag in the same step, and undo brings both back', () => {
    setFollowRoads(leg().id, false)
    clearHistory()
    setLegMode(leg().id, 'train')
    expect(leg().mode).toBe('train')
    expect(leg()).not.toHaveProperty('straight')
    expect(history()).toBe(1)
    useTripStore.temporal.getState().undo()
    expect(leg()).toMatchObject({ mode: 'drive', straight: true })
  })

  describe('via points across the two kinds of leg', () => {
    const via = [{ lat: 45.5, lng: 5.5 }]
    const withVia = (patch: Partial<ReturnType<typeof leg>> = {}) => {
      useTripStore.getState().updateLeg(leg().id, { via, ...patch })
      clearHistory()
    }

    it('are dropped, in the same undo step, when a road-routed leg becomes hand-drawn — and come back with undo', () => {
      withVia()
      setLegMode(leg().id, 'ferry')
      expect(leg()).toMatchObject({ mode: 'ferry', via: [] })
      expect(history()).toBe(1)
      useTripStore.temporal.getState().undo()
      expect(leg()).toMatchObject({ mode: 'drive', via })
    })

    it('are dropped when a hand-drawn leg goes back to following roads', () => {
      withVia({ mode: 'flight' })
      setLegMode(leg().id, 'drive')
      expect(leg()).toMatchObject({ mode: 'drive', via: [] })
      expect(history()).toBe(1)
      useTripStore.temporal.getState().undo()
      expect(leg()).toMatchObject({ mode: 'flight', via })
    })

    it('are kept when switching among hand-drawn kinds (ferry, train, flight, a straight drive)', () => {
      withVia({ mode: 'ferry' })
      setLegMode(leg().id, 'train')
      setLegMode(leg().id, 'flight')
      expect(leg().via).toEqual(via)
      withVia({ mode: 'drive', straight: true })
      setLegMode(leg().id, 'ferry')
      expect(leg()).toMatchObject({ mode: 'ferry', via })
      expect(leg()).not.toHaveProperty('straight')
    })

    it('"Follow roads" crosses the two kinds as well: switching it either way drops them (undo restores)', () => {
      withVia()
      setFollowRoads(leg().id, false)
      expect(leg()).toMatchObject({ straight: true, via: [] })
      useTripStore.temporal.getState().undo()
      expect(leg()).toMatchObject({ via })
      expect(leg()).not.toHaveProperty('straight')

      withVia({ straight: true })
      setFollowRoads(leg().id, true)
      expect(leg()).toMatchObject({ via: [] })
      expect(leg()).not.toHaveProperty('straight')
      expect(history()).toBe(1)
    })

    it('stay when nothing changes kind (the same mode again, "Follow roads" already on)', () => {
      withVia()
      setLegMode(leg().id, 'drive')
      setFollowRoads(leg().id, true)
      expect(leg().via).toEqual(via)
      expect(history()).toBe(0)
    })
  })

  it('sets and clears the duration override; nonsense is ignored', () => {
    setLegDurationMin(leg().id, 150)
    expect(leg().durationMin).toBe(150)
    setLegDurationMin(leg().id, 0)
    setLegDurationMin(leg().id, Number.NaN)
    expect(leg().durationMin).toBe(150)
    setLegDurationMin(leg().id, undefined)
    expect(leg()).not.toHaveProperty('durationMin')
  })

  it('trims the label and an empty one clears it', () => {
    setLegLabel(leg().id, '  Pont-Aven  ')
    expect(leg().label).toBe('Pont-Aven')
    setLegLabel(leg().id, '   ')
    expect(leg()).not.toHaveProperty('label')
  })

  it('"reset shape" clears the via points', () => {
    useTripStore.getState().addVia(leg().id, 0, { lat: 45.5, lng: 5.5 })
    clearHistory()
    resetLegShape(leg().id)
    expect(leg().via).toEqual([])
    expect(history()).toBe(1)
    resetLegShape(leg().id)
    expect(history()).toBe(1)
  })
})
