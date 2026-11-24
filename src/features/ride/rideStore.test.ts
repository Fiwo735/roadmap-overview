import { beforeEach, describe, expect, it } from 'vitest'
import { encodePolyline } from '../../lib/polyline'
import { legRouteKey } from '../../lib/routeKey'
import { createTrip } from '../../lib/trip'
import { useRouteStore } from '../../store/routeStore'
import { clearHistory, useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import {
  closeRide,
  isEditingLocked,
  isRiding,
  pauseRide,
  playRide,
  restartRide,
  rideAvailabilityFor,
  rideSample,
  seekRide,
  setRideFollow,
  setRideSpeed,
  startRide,
  stepRideDay,
  timelineFor,
  toggleRide,
  useRideStore,
} from './rideStore'
import { getLegRoutes } from '../routing/legRoutes'
import { REST_DAY_S, TRAVEL_DAY_S } from './timeline'

const trip = () => useTripStore.getState()
const ride = () => useRideStore.getState()

/** Places joined by ferry legs: those need no router, so the trip is rideable without any route in the store. */
function seedTrip(count = 3) {
  for (let i = 0; i < count; i++) trip().addPlace({ name: `P${i}`, lat: 45 + i, lng: 5 + i })
  trip().trip.legs.forEach((leg) => trip().updateLeg(leg.id, { mode: 'ferry' }))
}

beforeEach(() => {
  closeRide()
  useTripStore.setState({ trip: createTrip() })
  clearHistory()
  useRouteStore.getState().clear()
  useUiStore.setState({ selectedPlaceId: null, selectedLegId: null, expandedPlaceId: null, renamingPlaceId: null, sidebarOpen: false })
})

describe('rideAvailabilityFor', () => {
  it('needs two places and routes that are not loading', () => {
    expect(rideAvailabilityFor(0, [])).toMatchObject({ ok: false })
    expect(rideAvailabilityFor(1, [])).toMatchObject({ ok: false, reason: expect.stringMatching(/two places/) })
    expect(rideAvailabilityFor(3, ['ok', 'loading'])).toMatchObject({ ok: false, reason: expect.stringMatching(/loading/) })
    expect(rideAvailabilityFor(3, ['ok', 'ok'])).toEqual({ ok: true })
    // A leg that failed to route rides its straight placeholder.
    expect(rideAvailabilityFor(3, ['ok', 'error'])).toEqual({ ok: true })
  })
})

describe('starting and closing', () => {
  it('does not start with fewer than two places', () => {
    expect(startRide()).toBe(false)
    trip().addPlace({ name: 'A', lat: 1, lng: 1 })
    expect(startRide()).toBe(false)
    expect(isRiding()).toBe(false)
  })

  it('does not start while a road leg is still being routed', () => {
    trip().addPlace({ name: 'A', lat: 45, lng: 5 })
    trip().addPlace({ name: 'B', lat: 46, lng: 6 })
    expect(startRide()).toBe(false)
  })

  it('starts playing from the beginning with a timeline, and clears what the locked sidebar would keep open', () => {
    seedTrip()
    const [first] = trip().trip.places
    const [leg] = trip().trip.legs
    useUiStore.setState({ selectedPlaceId: first.id, selectedLegId: null, expandedPlaceId: first.id, sidebarOpen: true })
    useUiStore.getState().selectLeg(leg.id)
    expect(startRide()).toBe(true)
    expect(isRiding()).toBe(true)
    expect(ride()).toMatchObject({ active: true, playing: true, time: 0, placeIndex: 0 })
    expect(ride().timeline?.placeCount).toBe(3)
    expect(useUiStore.getState()).toMatchObject({
      selectedPlaceId: null,
      selectedLegId: null,
      expandedPlaceId: null,
      renamingPlaceId: null,
      sidebarOpen: false,
    })
    // Starting again changes nothing.
    const { timeline } = ride()
    expect(startRide()).toBe(true)
    expect(ride().timeline).toBe(timeline)
  })

  it('rides a road leg along its routed geometry once the route is there', () => {
    trip().addPlace({ name: 'A', lat: 45, lng: 5 })
    trip().addPlace({ name: 'B', lat: 46, lng: 6 })
    const { places, legs } = trip().trip
    const key = legRouteKey(places[0], places[1], legs[0])
    const road = [
      { lat: 45, lng: 5 },
      { lat: 45.9, lng: 5.1 },
      { lat: 46, lng: 6 },
    ]
    useRouteStore.getState().setRoute({ key, geometry: encodePolyline(road), distanceM: 160_000, durationS: 6000, source: 'osrm' })
    expect(startRide()).toBe(true)
    expect(ride().timeline?.totalDistanceM).toBe(160_000)
    seekRide(REST_DAY_S + TRAVEL_DAY_S / 2)
    const sample = rideSample(ride().timeline!, ride().time)
    expect(sample.distanceM).toBeCloseTo(80_000, -2)
  })

  it('closing resets everything', () => {
    seedTrip()
    startRide()
    seekRide(2)
    closeRide()
    expect(ride()).toMatchObject({ active: false, playing: false, time: 0, timeline: null, placeIndex: 0 })
    expect(isRiding()).toBe(false)
  })

  it('locks editing exactly while a ride is on', () => {
    seedTrip()
    expect(isEditingLocked()).toBe(false)
    startRide()
    expect(isEditingLocked()).toBe(true)
    closeRide()
    expect(isEditingLocked()).toBe(false)
  })

  it('closed by the user, the view from before comes back; closed by a trip change, it does not', () => {
    seedTrip()
    startRide()
    expect(ride().keepView).toBe(false)
    closeRide()
    expect(ride().keepView).toBe(false)

    startRide()
    trip().replaceTrip(createTrip())
    expect(ride()).toMatchObject({ active: false, keepView: true })
    // A new ride starts afresh.
    seedTrip()
    startRide()
    expect(ride().keepView).toBe(false)

    trip().removePlace(trip().trip.places[0].id)
    trip().removePlace(trip().trip.places[0].id)
    expect(ride()).toMatchObject({ active: false, keepView: true })

    seedTrip(3)
    startRide()
    closeRide({ keepView: true })
    expect(ride().keepView).toBe(true)
  })
})

describe('controls', () => {
  beforeEach(() => {
    seedTrip()
    startRide()
  })

  it('pauses, plays and toggles', () => {
    pauseRide()
    expect(ride().playing).toBe(false)
    playRide()
    expect(ride().playing).toBe(true)
    toggleRide()
    expect(ride().playing).toBe(false)
    toggleRide()
    expect(ride().playing).toBe(true)
  })

  it('seeks, clamped to the timeline, and keeps the place reached in step', () => {
    const { duration } = ride().timeline!
    seekRide(duration * 10)
    expect(ride().time).toBe(duration)
    expect(ride().placeIndex).toBe(2)
    seekRide(-4)
    expect(ride().time).toBe(0)
    expect(ride().placeIndex).toBe(0)
    seekRide(REST_DAY_S + TRAVEL_DAY_S + 0.1)
    expect(ride().placeIndex).toBe(1)
  })

  it('steps by day: next, previous, and to the very end after the last day', () => {
    pauseRide()
    stepRideDay(1)
    expect(rideSample(ride().timeline!, ride().time)).toMatchObject({ day: 1, legIndex: 0 })
    stepRideDay(1)
    expect(rideSample(ride().timeline!, ride().time).day).toBe(2)
    stepRideDay(1)
    expect(ride().time).toBe(ride().timeline!.duration)
    stepRideDay(-1)
    expect(rideSample(ride().timeline!, ride().time).day).toBe(1)
    stepRideDay(-1)
    stepRideDay(-1)
    expect(ride().time).toBe(0)
  })

  it('plays from the start when played at the end, and restart plays from the start', () => {
    seekRide(ride().timeline!.duration)
    pauseRide()
    playRide()
    expect(ride()).toMatchObject({ playing: true, time: 0 })
    seekRide(3)
    pauseRide()
    restartRide()
    expect(ride()).toMatchObject({ playing: true, time: 0 })
  })

  it('remembers speed and follow', () => {
    setRideSpeed(4)
    setRideFollow(true)
    expect(ride()).toMatchObject({ speed: 4, follow: true })
    // Both survive a restart and a new ride (a session preference).
    closeRide()
    startRide()
    expect(ride()).toMatchObject({ speed: 4, follow: true })
    setRideSpeed(1)
    setRideFollow(false)
  })

  it('ignores controls when no ride is on', () => {
    closeRide()
    playRide()
    seekRide(3)
    stepRideDay(1)
    expect(ride()).toMatchObject({ active: false, playing: false, time: 0 })
  })
})

describe('the trip changing under a ride', () => {
  beforeEach(() => {
    seedTrip()
    startRide()
    pauseRide()
  })

  it('carries on from the same time with a rebuilt timeline when a place changes', () => {
    seekRide(REST_DAY_S + TRAVEL_DAY_S + 0.5)
    const before = ride().timeline
    trip().updatePlace(trip().trip.places[1].id, { name: 'Renamed' })
    // A name does not change the legs: nothing to rebuild.
    expect(ride().timeline).toBe(before)

    trip().updatePlace(trip().trip.places[1].id, { lat: 45.5 })
    expect(ride().active).toBe(true)
    expect(ride().timeline).not.toBe(before)
    expect(ride().time).toBeCloseTo(REST_DAY_S + TRAVEL_DAY_S + 0.5)
  })

  it('ends when the trip is replaced by another one', () => {
    trip().replaceTrip(createTrip())
    expect(ride().active).toBe(false)
  })

  it('ends when too few places are left', () => {
    trip().removePlace(trip().trip.places[0].id)
    expect(ride().active).toBe(true)
    trip().removePlace(trip().trip.places[0].id)
    expect(ride().active).toBe(false)
  })
})

describe('timelineFor', () => {
  it('is the timeline the ride plays: the same days, legs and duration', () => {
    seedTrip(4)
    const { places, startDate } = trip().trip
    const timeline = timelineFor(places, getLegRoutes(), startDate)
    expect(timeline).not.toBeNull()
    startRide()
    expect(ride().timeline?.duration).toBe(timeline?.duration)
    expect(ride().timeline?.slots.length).toBe(timeline?.slots.length)
  })

  it('is null for a trip with nothing to ride: fewer than two places, or legs that do not match the places', () => {
    seedTrip(3)
    const { places } = trip().trip
    expect(timelineFor(places.slice(0, 1), getLegRoutes().slice(0, 0))).toBeNull()
    expect(timelineFor(places, getLegRoutes().slice(0, 1))).toBeNull()
  })
})
