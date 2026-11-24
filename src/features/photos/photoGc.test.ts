import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GC_TTL_MS } from '../../lib/photos'
import { createTrip } from '../../lib/trip'
import { serializeTripFile } from '../../lib/tripFile'
import { createMemoryPhotoStore, type PhotoRecord } from '../../services/photoDb'
import { CURRENT_TRIP_KEY } from '../../store/persistence'
import { RECENT_TRIPS_KEY } from '../../store/recentTrips'
import { clearHistory, undo, useTripStore } from '../../store/tripStore'
import type { PlacePhoto, Trip } from '../../types/trip'
import { collectPhotoGarbage, protectedPhotoIds, schedulePhotoGc } from './photoGc'

const NOW = 1_700_000_000_000
const OLD = NOW - 24 * 3_600_000

const ref = (id: string): PlacePhoto => ({ id, width: 4, height: 3 })
const record = (id: string, createdAt = OLD): PhotoRecord => ({ id, blob: new Blob(['x']), thumb: new Blob(['t']), width: 4, height: 3, createdAt })

class MemoryStorage {
  data = new Map<string, string>()
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
}

let storage: MemoryStorage
let photos: ReturnType<typeof createMemoryPhotoStore>
let placeId: string

const tripFileText = (trip: Trip) => JSON.stringify(serializeTripFile(trip))
const recentEntry = (id: string, trip: Trip) => ({ id, savedAt: NOW, file: serializeTripFile(trip) })

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  photos = createMemoryPhotoStore()
  useTripStore.setState({ trip: createTrip() })
  placeId = useTripStore.getState().addPlace({ name: 'Lyon', lat: 45, lng: 5 })!
  clearHistory()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function seed(...ids: string[]) {
  await photos.put(ids.map((id) => record(id)))
}

describe('protectedPhotoIds', () => {
  it('is the open trip, its undo and redo history, the autosave slot and every recent trip', () => {
    useTripStore.getState().updatePlace(placeId, { photos: [ref('in-history')] })
    useTripStore.getState().updatePlace(placeId, { photos: [ref('open')] })
    undo() // in-history is open now, `open` is in the redo history
    storage.setItem(CURRENT_TRIP_KEY, tripFileText(createTrip({ places: [{ id: 'p', name: 'X', lat: 1, lng: 1, day: 0, photos: [ref('autosaved')] }] })))
    const old = createTrip({ places: [{ id: 'q', name: 'Y', lat: 1, lng: 1, day: 0, photos: [ref('recent-1'), ref('recent-2')] }] })
    storage.setItem(RECENT_TRIPS_KEY, JSON.stringify([recentEntry('r1', old), { nonsense: true }, recentEntry('r2', createTrip({ places: [{ id: 'z', name: 'Z', lat: 1, lng: 1, day: 0, photos: [ref('recent-3')] }] }))]))
    expect([...protectedPhotoIds()!].sort()).toEqual(['autosaved', 'in-history', 'open', 'recent-1', 'recent-2', 'recent-3'])
  })

  it('also protects what unreadable-looking entries still mention, and gives up when the stored data cannot be read', () => {
    storage.setItem(CURRENT_TRIP_KEY, JSON.stringify({ trip: { places: [{ photos: [{ id: 'half-valid' }] }] } }))
    expect([...protectedPhotoIds()!]).toEqual(['half-valid'])
    storage.setItem(RECENT_TRIPS_KEY, '{ not json')
    expect(protectedPhotoIds()).toBeNull()
  })

  it('works without any storage', () => {
    vi.stubGlobal('localStorage', undefined)
    useTripStore.getState().updatePlace(placeId, { photos: [ref('open')] })
    expect([...protectedPhotoIds()!]).toEqual(['open'])
  })
})

describe('collectPhotoGarbage', () => {
  const LATER = NOW + GC_TTL_MS + 1000

  it('the first sweep only marks the photos nothing refers to; they go once they have stayed so for a week', async () => {
    await seed('open', 'orphan', 'recent', 'history')
    await photos.put([record('young', NOW - 1000)])
    useTripStore.getState().updatePlace(placeId, { photos: [ref('history')] })
    useTripStore.getState().updatePlace(placeId, { photos: [ref('open')] })
    storage.setItem(RECENT_TRIPS_KEY, JSON.stringify([recentEntry('r', createTrip({ places: [{ id: 'q', name: 'Y', lat: 1, lng: 1, day: 0, photos: [ref('recent')] }] }))]))

    expect(await collectPhotoGarbage({ store: photos, now: NOW })).toBe(0)
    expect([...photos.records.keys()].sort()).toEqual(['history', 'open', 'orphan', 'recent', 'young'])
    // Only what nothing refers to is marked, with the time of this sweep.
    expect([...photos.marks.entries()].sort()).toEqual([['orphan', NOW], ['young', NOW]])

    // A day later: still marked, nothing deleted, and the mark keeps its first time.
    expect(await collectPhotoGarbage({ store: photos, now: NOW + 24 * 3_600_000 })).toBe(0)
    expect(photos.marks.get('orphan')).toBe(NOW)

    // A week after the first sweep both are gone; what is in use stays.
    expect(await collectPhotoGarbage({ store: photos, now: LATER })).toBe(2)
    expect([...photos.records.keys()].sort()).toEqual(['history', 'open', 'recent'])
    expect(photos.marks.size).toBe(0)
  })

  it('a photo that is referenced again before the week is over loses its mark and is not deleted', async () => {
    await seed('a', 'b')
    expect(await collectPhotoGarbage({ store: photos, now: NOW })).toBe(0)
    expect(photos.marks.size).toBe(2)

    useTripStore.getState().updatePlace(placeId, { photos: [ref('a')] })
    expect(await collectPhotoGarbage({ store: photos, now: NOW + 3 * 24 * 3_600_000 })).toBe(0)
    expect([...photos.marks.keys()]).toEqual(['b'])

    // Unreferenced again later: its clock starts afresh, so it survives past the first week.
    useTripStore.getState().updatePlace(placeId, { photos: undefined })
    clearHistory()
    const t = NOW + 4 * 24 * 3_600_000
    expect(await collectPhotoGarbage({ store: photos, now: t })).toBe(0)
    expect(photos.marks.get('a')).toBe(t)
    expect(await collectPhotoGarbage({ store: photos, now: LATER })).toBe(1)
    expect([...photos.records.keys()]).toEqual(['a'])
  })

  it('deletes nothing when the stored trips cannot be read, or the store fails', async () => {
    await seed('orphan')
    photos.marks.set('orphan', 0)
    storage.setItem(RECENT_TRIPS_KEY, 'garbage')
    expect(await collectPhotoGarbage({ store: photos, now: LATER })).toBe(0)
    expect(photos.records.size).toBe(1)

    storage.data.clear()
    const broken = { ...photos, list: async () => Promise.reject(new Error('IndexedDB is gone')) }
    expect(await collectPhotoGarbage({ store: broken, now: LATER })).toBe(0)
  })

  it('an empty store costs nothing', async () => {
    expect(await collectPhotoGarbage({ store: photos, now: NOW })).toBe(0)
  })
})

describe('schedulePhotoGc', () => {
  it('sets one timer however often it is asked, and again once that has run', async () => {
    vi.useFakeTimers()
    // The sweep itself finds no IndexedDB here and gives up quietly; what is checked is the timer.
    const timers = vi.spyOn(globalThis, 'setTimeout')
    schedulePhotoGc(1000)
    schedulePhotoGc(1000)
    schedulePhotoGc(1000)
    expect(timers).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1500)
    schedulePhotoGc(1000)
    expect(timers.mock.calls.filter(([, ms]) => ms === 1000)).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1500)
  })
})
