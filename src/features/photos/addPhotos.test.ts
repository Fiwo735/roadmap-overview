import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../components/toast'
import { createTrip } from '../../lib/trip'
import { MAX_PHOTOS_PER_PLACE } from '../../lib/photos'
import { createMemoryPhotoStore, PhotoStoreError, type PhotoStore } from '../../services/photoDb'
import { clearHistory, undo, useTripStore } from '../../store/tripStore'
import { usePresentationStore } from '../presentation/presentationStore'
import { addPhotos, usePhotoJobs, type AddPhotosDeps } from './addPhotos'
import { PhotoError, type ProcessedPhoto } from './processImage'

const file = (name: string, type = 'image/jpeg', size = 100): File => new File([new Uint8Array(size).fill(1)], name, { type })
const processed = (width = 640, height = 480): ProcessedPhoto => ({ blob: new Blob(['full']), thumb: new Blob(['thumb']), width, height })

let store: ReturnType<typeof createMemoryPhotoStore>
let placeId: string

function deps(overrides: Partial<AddPhotosDeps> = {}): AddPhotosDeps {
  return { process: async () => processed(), store: () => store, now: () => 1234, ...overrides }
}

const place = () => useTripStore.getState().trip.places[0]
const toastTexts = () => useToastStore.getState().toasts.map((t) => t.message)
const past = () => useTripStore.temporal.getState().pastStates.length

beforeEach(() => {
  store = createMemoryPhotoStore()
  useTripStore.setState({ trip: createTrip() })
  placeId = useTripStore.getState().addPlace({ name: 'Lyon', lat: 45.76, lng: 4.84 })!
  clearHistory()
  useToastStore.setState({ toasts: [] })
  usePresentationStore.setState({ on: false })
  usePhotoJobs.setState({ jobs: {} })
})

describe('addPhotos', () => {
  it('stores every file and adds them all to the place as ONE undo step', async () => {
    const sizes = [processed(800, 600), processed(600, 800), processed(1024, 1024)]
    let n = 0
    await addPhotos(placeId, [file('a.jpg'), file('b.jpg'), file('c.jpg')], deps({ process: async () => sizes[n++] }))
    const photos = place().photos!
    expect(photos.map((p) => [p.width, p.height])).toEqual([
      [800, 600],
      [600, 800],
      [1024, 1024],
    ])
    expect(new Set(photos.map((p) => p.id)).size).toBe(3)
    expect(past()).toBe(1)
    // The bytes are in the store under those ids, with their creation time.
    expect([...store.records.keys()].sort()).toEqual(photos.map((p) => p.id).sort())
    expect(store.records.get(photos[0].id)).toMatchObject({ width: 800, height: 600, createdAt: 1234 })
    expect(toastTexts()).toEqual([])
    // Undo takes the whole batch; the bytes stay for a redo.
    undo()
    expect(place().photos).toBeUndefined()
    expect(store.records.size).toBe(3)
  })

  it('appends to the photos the place has', async () => {
    useTripStore.getState().updatePlace(placeId, { photos: [{ id: 'old', width: 10, height: 10 }] })
    await addPhotos(placeId, [file('a.jpg')], deps())
    expect(place().photos?.map((p) => p.id)).toEqual(['old', expect.stringMatching(/^ph_/)])
  })

  it('reports files that cannot be used in one toast and adds the rest', async () => {
    const process = vi.fn(async (f: File) => {
      if (f.name === 'broken.jpg') throw new PhotoError('unreadable')
      if (f.name === 'x.heic') throw new PhotoError('heic')
      return processed()
    })
    await addPhotos(placeId, [file('notes.txt', 'text/plain'), file('broken.jpg'), file('good.jpg'), file('x.heic', 'image/heic')], deps({ process }))
    expect(place().photos).toHaveLength(1)
    expect(past()).toBe(1)
    // The text file never reached the decoder.
    expect(process.mock.calls.map(([f]) => f.name)).toEqual(['broken.jpg', 'good.jpg', 'x.heic'])
    expect(toastTexts()).toEqual(['3 files were not added. notes.txt is not an image; 2 others had problems too.'])
  })

  it('names the problem when a single file fails, and changes nothing when all fail', async () => {
    await addPhotos(placeId, [file('x.heic', 'image/heic')], deps({ process: async () => Promise.reject(new PhotoError('heic')) }))
    expect(place().photos).toBeUndefined()
    expect(past()).toBe(0)
    expect(toastTexts()).toEqual(['x.heic is a HEIC photo, which this browser cannot read (convert it to JPEG first).'])
  })

  it('an unexpected failure counts as unreadable', async () => {
    await addPhotos(placeId, [file('a.jpg')], deps({ process: async () => Promise.reject(new Error('boom')) }))
    expect(toastTexts()).toEqual(['a.jpg could not be read as an image.'])
  })

  it('stops at the limit of 50 photos for a place and says what did not fit', async () => {
    useTripStore.getState().updatePlace(placeId, { photos: Array.from({ length: MAX_PHOTOS_PER_PLACE - 1 }, (_, i) => ({ id: `o${i}`, width: 4, height: 3 })) })
    clearHistory()
    await addPhotos(placeId, [file('1.jpg'), file('2.jpg'), file('3.jpg')], deps())
    expect(place().photos).toHaveLength(MAX_PHOTOS_PER_PLACE)
    expect(store.records.size).toBe(1)
    expect(toastTexts()[0]).toContain('2 files were not added')
    expect(toastTexts()[0]).toContain('did not fit')
  })

  it('a storage failure ends the batch with its own message, keeping what was stored', async () => {
    let calls = 0
    const failing: PhotoStore = {
      ...store,
      put: async (records, options) => {
        if (++calls === 2) throw new PhotoStoreError('This browser has no room left for photos.', 'quota')
        return store.put(records, options)
      },
    }
    const process = vi.fn(async () => processed())
    await addPhotos(placeId, [file('1.jpg'), file('2.jpg'), file('3.jpg')], deps({ store: () => failing, process }))
    expect(process).toHaveBeenCalledTimes(2)
    expect(place().photos).toHaveLength(1)
    expect(toastTexts()).toEqual(['This browser has no room left for photos.'])
  })

  it('shows progress while it works and clears it afterwards', async () => {
    const seen: string[] = []
    const unsubscribe = usePhotoJobs.subscribe((s) => seen.push(JSON.stringify(s.jobs[placeId] ?? null)))
    await addPhotos(placeId, [file('1.jpg'), file('2.jpg')], deps())
    unsubscribe()
    expect(seen).toEqual(['{"done":0,"total":2}', '{"done":1,"total":2}', '{"done":2,"total":2}', 'null'])
    expect(usePhotoJobs.getState().jobs).toEqual({})
  })

  it('does nothing while editing is locked, and says why', async () => {
    usePresentationStore.setState({ on: true })
    const process = vi.fn(async () => processed())
    await addPhotos(placeId, [file('1.jpg')], deps({ process }))
    expect(process).not.toHaveBeenCalled()
    expect(place().photos).toBeUndefined()
    expect(toastTexts()).toEqual(['Leave presentation mode (Esc) first, then try again.'])
  })

  it('drops the batch when editing gets locked while it is being worked on', async () => {
    const process = async () => {
      usePresentationStore.setState({ on: true })
      return processed()
    }
    await addPhotos(placeId, [file('1.jpg')], deps({ process }))
    expect(place().photos).toBeUndefined()
    expect(toastTexts()[0]).toContain('The photos were not added.')
  })

  it('a place that is deleted meanwhile just ends the batch', async () => {
    const process = async () => {
      useTripStore.getState().removePlace(placeId)
      return processed()
    }
    await addPhotos(placeId, [file('1.jpg')], deps({ process }))
    expect(useTripStore.getState().trip.places).toHaveLength(0)
    expect(toastTexts()).toEqual([])
  })

  it('batches run one after the other', async () => {
    const order: string[] = []
    const slow = async (f: File) => {
      order.push(`start ${f.name}`)
      await new Promise((r) => setTimeout(r, 5))
      order.push(`end ${f.name}`)
      return processed()
    }
    await Promise.all([addPhotos(placeId, [file('a.jpg')], deps({ process: slow })), addPhotos(placeId, [file('b.jpg')], deps({ process: slow }))])
    expect(order).toEqual(['start a.jpg', 'end a.jpg', 'start b.jpg', 'end b.jpg'])
    expect(place().photos).toHaveLength(2)
    expect(past()).toBe(2)
  })

  it('ignores an empty list and an unknown place', async () => {
    await addPhotos(placeId, [], deps())
    await addPhotos('nope', [file('a.jpg')], deps())
    expect(past()).toBe(0)
    expect(store.records.size).toBe(0)
  })
})
