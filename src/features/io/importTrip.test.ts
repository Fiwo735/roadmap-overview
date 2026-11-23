import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../components/toast'
import { encodePolyline } from '../../lib/polyline'
import { legRouteKey } from '../../lib/routeKey'
import { createTrip } from '../../lib/trip'
import { serializeTripFile } from '../../lib/tripFile'
import { stringifyTripFile } from '../../lib/tripFileIo'
import { RECENT_TRIPS_KEY, readRecentTrips, useRecentStore } from '../../store/recentTrips'
import { useRouteStore } from '../../store/routeStore'
import { clearHistory, useTripStore } from '../../store/tripStore'
import type { LegRoute, Trip } from '../../types/trip'
import { useConfirmStore } from './confirm'
import {
  installTrip,
  keepOpenTrip,
  offerLinkedTrip,
  openLinkedTrip,
  openTripText,
  restoreRecentTrip,
} from './importTrip'

class MemoryStorage {
  data = new Map<string, string>()
  /** Everything is refused, like a full quota (or blocked storage). */
  full = false
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.full) throw new Error('QuotaExceededError')
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
}

let storage: MemoryStorage

const trip = () => useTripStore.getState().trip
const toasts = () => useToastStore.getState().toasts
const recentTitles = () => readRecentTrips().map((e) => e.file.trip.title)

/** Berlin → Prague → Vienna, with a route for the first leg. */
function sampleFile(title = 'Summer') {
  const t: Trip = {
    id: `trip-${title}`,
    title,
    places: [
      { id: 'a', name: 'Berlin', lat: 52.52, lng: 13.405, day: 0 },
      { id: 'b', name: 'Prague', lat: 50.0755, lng: 14.4378, day: 1 },
      { id: 'c', name: 'Vienna', lat: 48.2082, lng: 16.3738, day: 2 },
    ],
    legs: [
      { id: 'l1', fromId: 'a', toId: 'b', mode: 'drive', via: [] },
      { id: 'l2', fromId: 'b', toId: 'c', mode: 'drive', via: [] },
    ],
  }
  const [a, b] = t.places
  const route: LegRoute = {
    key: legRouteKey(a, b, t.legs[0]),
    geometry: encodePolyline([a, { lat: 51.3, lng: 14 }, b]),
    distanceM: 350_000,
    durationS: 12_000,
    source: 'osrm',
  }
  return { trip: t, route, file: serializeTripFile(t, { l1: route }) }
}

/** Put a trip of the user's own into the stores, the way editing does. */
function openOwnTrip(title = 'Mine') {
  const store = useTripStore.getState()
  store.setTitle(title)
  store.addPlace({ name: 'Lyon', lat: 45.76, lng: 4.83 })
  store.addPlace({ name: 'Annecy', lat: 45.9, lng: 6.13 })
  return trip()
}

/** Answer the question `askToConfirm` raised (there is no dialog in these tests). */
function answer(confirmed: boolean) {
  const request = useConfirmStore.getState().request
  if (!request) throw new Error('nothing was asked')
  useConfirmStore.setState({ request: null })
  request.resolve(confirmed)
  return request
}

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  // No map in these tests: the fit after an import waits for one, frame by frame.
  vi.stubGlobal('requestAnimationFrame', () => 0)
  useTripStore.setState({ trip: createTrip() })
  clearHistory()
  useRouteStore.getState().clear()
  useRecentStore.setState({ entries: [] })
  useConfirmStore.setState({ request: null })
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('installTrip', () => {
  it('replaces the trip in one undoable step and seeds the routes by key', () => {
    const { trip: t, route, file } = sampleFile()
    installTrip(file)

    expect(trip()).toEqual(t)
    expect(useRouteStore.getState().routes).toEqual({ [route.key]: route })
    expect(useTripStore.temporal.getState().pastStates).toHaveLength(1)

    useTripStore.temporal.getState().undo()
    expect(trip().places).toEqual([])
  })

  it('has the routes in the store before the trip changes, so nothing asks the router for them', () => {
    const { route, file } = sampleFile()
    let seenAtChange: string[] = []
    const unsubscribe = useTripStore.subscribe(() => {
      seenAtChange = Object.keys(useRouteStore.getState().routes)
    })
    installTrip(file)
    unsubscribe()
    expect(seenAtChange).toEqual([route.key])
  })

  it('works for a file without routes', () => {
    const { trip: t } = sampleFile()
    installTrip(serializeTripFile(t))
    expect(trip()).toEqual(t)
    expect(useRouteStore.getState().routes).toEqual({})
  })
})

describe('keepOpenTrip', () => {
  it('puts a trip with places in the recent trips, with the routes it has', () => {
    const mine = openOwnTrip()
    const route: LegRoute = {
      key: legRouteKey(mine.places[0], mine.places[1], mine.legs[0]),
      geometry: encodePolyline([mine.places[0], mine.places[1]]),
      distanceM: 160_000,
      durationS: 7_000,
      source: 'osrm',
    }
    useRouteStore.getState().setRoute(route)

    expect(keepOpenTrip()).toBe('kept')
    const [kept] = readRecentTrips()
    expect(kept.file.trip).toEqual(mine)
    expect(Object.values(kept.file.routes ?? {})).toEqual([route])
  })

  it('has nothing to keep for an empty trip, or when the same trip comes back', () => {
    expect(keepOpenTrip()).toBe('nothing')
    const mine = openOwnTrip()
    expect(keepOpenTrip(mine)).toBe('nothing')
    expect(readRecentTrips()).toEqual([])
  })

  it('says so when the trip cannot be stored', () => {
    openOwnTrip()
    storage.full = true
    expect(keepOpenTrip()).toBe('failed')
  })
})

describe('openTripText', () => {
  it('opens a valid file and offers to undo', async () => {
    const { trip: t, file } = sampleFile('Summer')
    await expect(openTripText(stringifyTripFile(file), 'summer.trip.json')).resolves.toBe(true)
    expect(trip()).toEqual(t)
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]).toMatchObject({ kind: 'success', message: 'Opened “Summer” (3 places).' })

    toasts()[0].action?.onClick()
    expect(trip().places).toEqual([])
  })

  it('puts the trip it replaces in the recent trips', async () => {
    const mine = openOwnTrip()
    await openTripText(stringifyTripFile(sampleFile().file), 'a.json')
    expect(readRecentTrips().map((e) => e.file.trip)).toEqual([mine])
    expect(useRecentStore.getState().entries.map((e) => e.title)).toEqual(['Mine'])
  })

  it('calls a trip without a title by the placeholder the title field shows', async () => {
    await openTripText(stringifyTripFile(sampleFile('').file), 'x.json')
    expect(toasts()[0].message).toBe('Opened “Untitled trip” (3 places).')
  })

  it('leaves the trip alone and says why when the file is not usable', async () => {
    const mine = openOwnTrip()

    await expect(openTripText('not json', 'bad.json')).resolves.toBe(false)
    await expect(openTripText('{"format":"roadmap-overview/trip","version":2,"trip":{}}', 'new.json')).resolves.toBe(false)
    expect(trip()).toBe(mine)
    expect(readRecentTrips()).toEqual([])
    expect(toasts().map((t) => [t.kind, t.message])).toEqual([
      ['error', 'Could not open bad.json. This is not a trip file: it is not valid JSON.'],
      ['error', 'Could not open new.json. This trip was saved by a newer version of Roadmap Overview.'],
    ])
  })

  it('mentions what was repaired', async () => {
    const broken = JSON.parse(stringifyTripFile(sampleFile().file))
    broken.trip.places[1].lat = 'north'
    await openTripText(JSON.stringify(broken), 'x.json')
    expect(trip().places.map((p) => p.name)).toEqual(['Berlin', 'Vienna'])
    expect(toasts()[0].message).toContain('The file had problems that were repaired: Place 2 has missing or invalid coordinates')
  })

  it('asks before replacing a trip that cannot be kept, and does nothing when the answer is no', async () => {
    const mine = openOwnTrip()
    storage.full = true
    const opening = openTripText(stringifyTripFile(sampleFile().file), 'a.json')
    await vi.waitFor(() => expect(useConfirmStore.getState().request).not.toBeNull())
    expect(trip()).toBe(mine)

    const question = answer(false)
    expect(question.title).toBe('Replace the open trip?')
    expect(question.description).toContain('no room to keep a copy of “Mine”')
    await expect(opening).resolves.toBe(false)
    expect(trip()).toBe(mine)
    expect(toasts()).toHaveLength(0)
  })

  it('replaces it after the user confirmed', async () => {
    openOwnTrip()
    storage.full = true
    const opening = openTripText(stringifyTripFile(sampleFile().file), 'a.json')
    await vi.waitFor(() => expect(useConfirmStore.getState().request).not.toBeNull())
    answer(true)
    await expect(opening).resolves.toBe(true)
    expect(trip().title).toBe('Summer')
  })
})

describe('openLinkedTrip', () => {
  it('opens a link on an empty trip without keeping anything', () => {
    const { trip: t, file } = sampleFile()
    openLinkedTrip(file, [], { atStart: true })
    expect(trip()).toEqual(t)
    expect(readRecentTrips()).toEqual([])
    expect(toasts()[0]).toMatchObject({ kind: 'success', message: 'Opened “Summer” (3 places).' })
    expect(toasts()[0].action).toBeUndefined()
    // Start-up: nothing to walk back into.
    expect(useTripStore.temporal.getState().pastStates).toHaveLength(0)
  })

  it('keeps the open trip and offers to restore it', () => {
    const mine = openOwnTrip()
    openLinkedTrip(sampleFile().file, [])
    expect(trip().places).toHaveLength(3)
    expect(readRecentTrips().map((e) => e.file.trip)).toEqual([mine])

    const [notice] = toasts()
    expect(notice.message).toBe('Opened “Summer” (3 places). Your previous trip was kept.')
    expect(notice.action?.label).toBe('Restore previous trip')
  })

  it('restoring brings the trip back and keeps the linked one in the list', async () => {
    const mine = openOwnTrip()
    const { trip: linked, file } = sampleFile()
    openLinkedTrip(file, [])

    toasts()[0].action?.onClick()
    await vi.waitFor(() => expect(trip()).toEqual(mine))
    expect(recentTitles()).toEqual(['Summer'])
    expect(readRecentTrips()[0].file.trip).toEqual(linked)
    expect(toasts().at(-1)?.message).toBe('Restored “Mine” (2 places).')
  })

  it('a second link does not push the user’s own trip out of reach', async () => {
    const mine = openOwnTrip()
    openLinkedTrip(sampleFile('Link A').file, [])
    openLinkedTrip(sampleFile('Link B').file, [])
    expect(trip().title).toBe('Link B')
    expect(recentTitles()).toEqual(['Link A', 'Mine'])

    // "Restore previous trip" on the second link's toast gives the newest, Link A ...
    toasts().at(-1)?.action?.onClick()
    await vi.waitFor(() => expect(trip().title).toBe('Link A'))
    expect(recentTitles()).toEqual(['Link B', 'Mine'])
    // ... and Mine is still there to be picked from the list.
    await restoreRecentTrip(readRecentTrips()[1].id)
    expect(trip()).toEqual(mine)
    expect(recentTitles()).toEqual(['Link A', 'Link B'])
  })

  it('does not keep a copy of the trip that is being opened again', () => {
    const { file } = sampleFile()
    installTrip(file)
    openLinkedTrip(file, [])
    expect(readRecentTrips()).toEqual([])
    expect(toasts()[0].action).toBeUndefined()
  })

  it('does not replace a trip it cannot keep: a toast asks, and its action opens the link', () => {
    const mine = openOwnTrip()
    storage.full = true
    openLinkedTrip(sampleFile().file, [], { atStart: true })

    expect(trip()).toBe(mine)
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0].message).toContain('no room to keep a copy of your open trip')
    expect(toasts()[0].action?.label).toBe('Open linked trip anyway')

    toasts()[0].action?.onClick()
    expect(trip().title).toBe('Summer')
    expect(toasts().at(-1)?.message).toBe('Opened “Summer” (3 places).')
  })
})

describe('offerLinkedTrip', () => {
  it('asks first, and opens the trip (keeping the edited one) only from the toast', () => {
    const mine = openOwnTrip()
    offerLinkedTrip(sampleFile().file, [], 'trips.example')
    expect(trip()).toBe(mine)
    expect(toasts()[0].message).toBe(
      'Open the linked trip “Summer” from trips.example? It replaces the trip you are editing, which stays in Recent trips.',
    )

    toasts()[0].action?.onClick()
    expect(trip().title).toBe('Summer')
    expect(recentTitles()).toEqual(['Mine'])
  })
})

describe('restoreRecentTrip', () => {
  it('says so when there is nothing to restore', async () => {
    await restoreRecentTrip()
    expect(toasts()[0]).toMatchObject({ kind: 'error', message: 'There is no previous trip to restore.' })
  })

  it('swaps: the open trip goes into the list in place of the restored one', async () => {
    const mine = openOwnTrip()
    await openTripText(stringifyTripFile(sampleFile().file), 'a.json')
    expect(recentTitles()).toEqual(['Mine'])

    await restoreRecentTrip()
    expect(trip()).toEqual(mine)
    expect(recentTitles()).toEqual(['Summer'])
    expect(storage.data.get(RECENT_TRIPS_KEY)).toBeDefined()

    // One undoable step.
    toasts().at(-1)?.action?.onClick()
    expect(trip().title).toBe('Summer')
  })

  it('asks first when the open trip cannot be kept', async () => {
    openOwnTrip()
    await openTripText(stringifyTripFile(sampleFile().file), 'a.json')
    storage.full = true
    const restoring = restoreRecentTrip()
    await vi.waitFor(() => expect(useConfirmStore.getState().request).not.toBeNull())
    answer(false)
    await restoring
    expect(trip().title).toBe('Summer')
  })
})
