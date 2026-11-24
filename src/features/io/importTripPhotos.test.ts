import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../components/toast'
import { bytesToBase64 } from '../../lib/photos'
import { createTrip } from '../../lib/trip'
import { serializeTripFile } from '../../lib/tripFile'
import { createMemoryPhotoStore, setPhotoStore } from '../../services/photoDb'
import { clearHistory, useTripStore } from '../../store/tripStore'
import type { TripFile } from '../../types/trip'
import { usePresentationStore } from '../presentation/presentationStore'
import { useConfirmStore } from './confirm'
import { MAX_PICKED_TRIP_FILE_BYTES, offerLinkedTrip, openLinkedTrip, openTripFileFromDisk, openTripText } from './importTrip'

vi.mock('../photos/processImage', () => ({
  describeJpeg: async (blob: Blob) => ({ blob, thumb: new Blob(['thumb']), width: 64, height: 48 }),
}))

class MemoryStorage {
  data = new Map<string, string>()
  /** Everything is refused, like a full quota. */
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

const toasts = () => useToastStore.getState().toasts
const messages = () => toasts().map((t) => t.message)
let photos: ReturnType<typeof createMemoryPhotoStore>
let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  // Installing a trip waits for the map (there is none here) with animation frames.
  vi.stubGlobal('requestAnimationFrame', () => 0)
  photos = createMemoryPhotoStore()
  setPhotoStore(photos)
  useTripStore.setState({ trip: createTrip() })
  clearHistory()
  useToastStore.setState({ toasts: [] })
  useConfirmStore.setState({ request: null })
  usePresentationStore.setState({ on: false })
})

afterEach(() => {
  setPhotoStore(null)
  vi.unstubAllGlobals()
})

/** A JPEG that has only what the code looks at: a frame header (64 x 48) and a last byte. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0, 48, 0, 64, 0x01, 0x01, 0x11, 0x00, 1])

function fileWithPhotos(title = 'With photos'): TripFile {
  const trip = createTrip({
    id: 't1',
    title,
    places: [{ id: 'p1', name: 'Lyon', lat: 45.76, lng: 4.84, day: 0, photos: [{ id: 'ph_1', width: 64, height: 48 }, { id: 'ph_gone', width: 64, height: 48 }] }],
  })
  return { ...serializeTripFile(trip), photos: { ph_1: { mime: 'image/jpeg', data: bytesToBase64(JPEG), width: 64, height: 48 } } }
}

function openOwnTrip() {
  useTripStore.getState().replaceTrip(createTrip({ id: 'mine', title: 'Mine', places: [{ id: 'a', name: 'Berlin', lat: 52.5, lng: 13.4, day: 0 }, { id: 'b', name: 'Prague', lat: 50.1, lng: 14.4, day: 1 }] }))
  clearHistory()
}

describe('opening a trip file that carries photos', () => {
  it('stores the photos before the trip is installed, and mentions what had to be left out', async () => {
    let storedWhenInstalled = -1
    const unsubscribe = useTripStore.subscribe(() => {
      storedWhenInstalled = photos.records.size
    })
    expect(await openTripText(JSON.stringify(fileWithPhotos()), 'with-photos.trip.json')).toBe(true)
    unsubscribe()
    // The bytes were there when the trip became the open one.
    expect(storedWhenInstalled).toBe(1)
    expect([...photos.records.keys()]).toEqual(['ph_1'])
    expect(useTripStore.getState().trip.places[0].photos?.map((p) => p.id)).toEqual(['ph_1'])
    expect(messages()[0]).toContain('Opened “With photos” (1 place).')
    expect(messages()[0]).toContain('1 photo was not in the file or in this browser and was left out.')
  })

  it('takes the photos it stored out again when the user says no to replacing the open trip', async () => {
    openOwnTrip()
    await photos.put([{ id: 'ph_1', blob: new Blob(['mine']), thumb: new Blob(['t']), width: 1, height: 1, createdAt: 1 }])
    // Another trip's photo that this file also uses stays, because it was not this call's to put there.
    const file = fileWithPhotos()
    file.photos!.ph_2 = file.photos!.ph_1
    file.trip.places[0].photos!.push({ id: 'ph_2', width: 64, height: 48 })
    storage.full = true // no room to keep a copy of the open trip: the user is asked
    const opening = openTripText(JSON.stringify(file), 'with-photos.trip.json')
    await vi.waitFor(() => expect(useConfirmStore.getState().request).not.toBeNull())
    expect([...photos.records.keys()].sort()).toEqual(['ph_1', 'ph_2'])
    useConfirmStore.getState().request!.resolve(false)
    useConfirmStore.setState({ request: null })
    await expect(opening).resolves.toBe(false)
    expect([...photos.records.keys()]).toEqual(['ph_1'])
    expect(useTripStore.getState().trip.title).toBe('Mine')
  })

  it('takes them out again, and says why, when editing was locked while the file was read', async () => {
    const file = fileWithPhotos()
    const opening = openTripText(JSON.stringify(file), 'late.trip.json')
    usePresentationStore.setState({ on: true })
    await expect(opening).resolves.toBe(false)
    expect(photos.records.size).toBe(0)
    expect(messages()).toEqual(['late.trip.json was not opened. Leave presentation mode (Esc) first, then try again.'])
    expect(useTripStore.getState().trip.places).toHaveLength(0)
  })

  it('a picked file may be far bigger than a trip fetched from an address (photos make it big), but not endless', async () => {
    expect(MAX_PICKED_TRIP_FILE_BYTES).toBe(150 * 1024 * 1024)
    const huge = { name: 'huge.trip.json', size: MAX_PICKED_TRIP_FILE_BYTES + 1, text: async () => '{}' } as unknown as File
    await openTripFileFromDisk(huge)
    expect(messages()).toEqual(['Could not open huge.trip.json. The file is too large to be a trip.'])

    const text = vi.fn(async () => JSON.stringify(fileWithPhotos()))
    const big = { name: 'big.trip.json', size: 60 * 1024 * 1024, text } as unknown as File
    await openTripFileFromDisk(big)
    expect(text).toHaveBeenCalled()
    expect(useTripStore.getState().trip.title).toBe('With photos')
  })
})

describe('a linked trip file with photos (?src=)', () => {
  it('stores the photos when it is opened, and only then', async () => {
    openLinkedTrip(fileWithPhotos(), [])
    await vi.waitFor(() => expect(useTripStore.getState().trip.title).toBe('With photos'))
    expect([...photos.records.keys()]).toEqual(['ph_1'])
    expect(useTripStore.getState().trip.places[0].photos?.map((p) => p.id)).toEqual(['ph_1'])
    expect(messages()[0]).toContain('Opened “With photos” (1 place).')
    expect(messages()[0]).toContain('1 photo was not in the file or in this browser and was left out.')
  })

  it('an offer that is never accepted leaves nothing stored; accepting it stores them', async () => {
    openOwnTrip()
    offerLinkedTrip(fileWithPhotos(), [], 'example.org')
    expect(photos.records.size).toBe(0)
    expect(useTripStore.getState().trip.title).toBe('Mine')

    toasts()[0].action?.onClick()
    await vi.waitFor(() => expect(useTripStore.getState().trip.title).toBe('With photos'))
    expect([...photos.records.keys()]).toEqual(['ph_1'])
  })

  it('a link that cannot be opened because the open trip cannot be kept stores nothing until its action is used', async () => {
    openOwnTrip()
    storage.full = true
    openLinkedTrip(fileWithPhotos(), [])
    expect(photos.records.size).toBe(0)
    expect(useTripStore.getState().trip.title).toBe('Mine')
    toasts()[0].action?.onClick()
    await vi.waitFor(() => expect(useTripStore.getState().trip.title).toBe('With photos'))
    expect([...photos.records.keys()]).toEqual(['ph_1'])
  })
})
