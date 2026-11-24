import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../components/toast'
import { bytesToBase64 } from '../../lib/photos'
import { createTrip } from '../../lib/trip'
import { parseTripFile, serializeTripFile } from '../../lib/tripFile'
import { createMemoryPhotoStore, PhotoStoreError, setPhotoStore, type PhotoRecord, type PhotoStore } from '../../services/photoDb'
import type { Place, TripFile } from '../../types/trip'
import { discardPhotos, storePhotosOf, tripFileBlob } from './photoFile'

// The browser decodes JPEGs; here one is undecodable when its last byte is 0, and "decodes" to (100 + last byte) x 50 otherwise.
const decoded = vi.hoisted(() => ({ calls: 0 }))
vi.mock('./processImage', () => ({
  describeJpeg: async (blob: Blob) => {
    decoded.calls++
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const tag = bytes[bytes.length - 1]
    if (tag === 0) throw new Error('cannot decode')
    return { blob, thumb: new Blob(['thumb']), width: 100 + tag, height: 50 }
  },
}))

/** A JPEG that only has what the code looks at: the start marker, a frame header declaring `width` x `height`, and `tag` as its last byte. */
const jpeg = (tag: number, width = 100, height = 50) =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00, tag])
const good = (n: number) => jpeg(n)
const stored = (id: string, bytes: Uint8Array<ArrayBuffer>, width = 100, height = 50): PhotoRecord => ({
  id,
  blob: new Blob([bytes]),
  thumb: new Blob(['thumb']),
  width,
  height,
  createdAt: 1,
})
const embedded = (bytes: Uint8Array, width = 100, height = 50) => ({ mime: 'image/jpeg' as const, data: bytesToBase64(bytes), width, height })
const place = (id: string, ids: string[]): Place => ({ id, name: id, lat: 45, lng: 5, day: 0, photos: ids.map((p) => ({ id: p, width: 100, height: 50 })) })

let photos: ReturnType<typeof createMemoryPhotoStore>

beforeEach(() => {
  photos = createMemoryPhotoStore()
  setPhotoStore(photos)
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  setPhotoStore(null)
})

describe('tripFileBlob', () => {
  it('embeds the bytes of the photos the trip refers to, in the order of the places', async () => {
    await photos.put([stored('a', good(1)), stored('b', good(2), 300, 200), stored('unused', good(3))])
    const trip = createTrip({ id: 't', places: [place('p1', ['b']), place('p2', ['a'])] })
    const { blob, missing } = await tripFileBlob(serializeTripFile(trip))
    expect(missing).toBe(0)
    expect(blob.type).toBe('application/json')
    const file = JSON.parse(await blob.text()) as TripFile
    expect(Object.keys(file.photos!)).toEqual(['b', 'a'])
    expect(file.photos!.b).toEqual({ mime: 'image/jpeg', data: bytesToBase64(good(2)), width: 300, height: 200 })
    expect(file.trip).toEqual(trip)
    // What was written is a file the app opens again.
    const reread = parseTripFile(file)
    expect(reread.ok && reread.warnings).toEqual([])
  })

  it('leaves out photos this browser no longer has, together with their references', async () => {
    await photos.put([stored('a', good(1))])
    const trip = createTrip({ id: 't', places: [place('p1', ['a', 'gone']), place('p2', ['gone2'])] })
    const { blob, missing } = await tripFileBlob(serializeTripFile(trip))
    expect(missing).toBe(2)
    const file = JSON.parse(await blob.text()) as TripFile
    expect(Object.keys(file.photos!)).toEqual(['a'])
    expect(file.trip.places[0].photos?.map((p) => p.id)).toEqual(['a'])
    expect(file.trip.places[1]).not.toHaveProperty('photos')
  })

  it('a photo whose bytes cannot be read counts as missing; the save still produces a file', async () => {
    await photos.put([stored('ok', good(1)), stored('broken', good(2))])
    const broken = photos.records.get('broken')!
    broken.blob.slice = () => ({ arrayBuffer: () => Promise.reject(new Error('NotReadableError')) }) as unknown as Blob
    const trip = createTrip({ id: 't', places: [place('p1', ['ok', 'broken']), place('p2', ['broken'])] })
    const { blob, missing } = await tripFileBlob(serializeTripFile(trip))
    expect(missing).toBe(1)
    const file = JSON.parse(await blob.text()) as TripFile
    expect(Object.keys(file.photos!)).toEqual(['ok'])
    expect(file.trip.places[0].photos?.map((p) => p.id)).toEqual(['ok'])
    expect(file.trip.places[1]).not.toHaveProperty('photos')
    const reread = parseTripFile(file)
    expect(reread.ok && reread.warnings).toEqual([])
  })

  it('a store that fails counts everything as missing instead of failing the save', async () => {
    const broken: PhotoStore = { ...photos, get: async () => Promise.reject(new PhotoStoreError('no', 'failed')) }
    setPhotoStore(broken)
    const { blob, missing } = await tripFileBlob(serializeTripFile(createTrip({ places: [place('p', ['a'])] })))
    expect(missing).toBe(1)
    expect(JSON.parse(await blob.text())).not.toHaveProperty('photos')
  })

  it('a trip without photos is the plain pretty-printed file', async () => {
    const file = serializeTripFile(createTrip({ id: 't', places: [{ id: 'p', name: 'P', lat: 1, lng: 1, day: 0 }] }))
    const { blob, missing } = await tripFileBlob(file)
    expect(missing).toBe(0)
    expect(await blob.text()).toBe(`${JSON.stringify(file, null, 2)}\n`)
  })
})

describe('storePhotosOf', () => {
  const fileWith = (ids: string[], photos: TripFile['photos']): TripFile => ({ ...serializeTripFile(createTrip({ id: 't', places: [place('p', ids)] })), photos })

  it('stores the embedded photos with their thumbnails and hands back a file without bytes', async () => {
    const { file, notes } = await storePhotosOf(fileWith(['a', 'b'], { a: embedded(good(1)), b: embedded(good(2)) }))
    expect(notes).toEqual([])
    expect(file).not.toHaveProperty('photos')
    expect(file.trip.places[0].photos?.map((p) => p.id)).toEqual(['a', 'b'])
    expect([...photos.records.keys()]).toEqual(['a', 'b'])
    const record = photos.records.get('b')!
    expect(record.blob.type).toBe('image/jpeg')
    expect(new Uint8Array(await record.blob.arrayBuffer())).toEqual(good(2))
    // Size and thumbnail come from the decoded picture, not from what the file claims.
    expect([record.width, record.height]).toEqual([102, 50])
    expect(await record.thumb.text()).toBe('thumb')
  })

  it('leaves out damaged photos and the references to them, and says how many', async () => {
    const notJpeg = new Uint8Array([0xff, 0x00, 0xff, 5])
    const { file, notes } = await storePhotosOf(fileWith(['a', 'bad', 'bad2'], { a: embedded(good(1)), bad: embedded(notJpeg), bad2: embedded(jpeg(0)) }))
    expect(file.trip.places[0].photos?.map((p) => p.id)).toEqual(['a'])
    expect(notes).toEqual(['2 photos in the file were damaged or too large and were left out.'])
    expect([...photos.records.keys()]).toEqual(['a'])
  })

  it('refuses a photo that declares more pixels than may be decoded, before anything is decoded', async () => {
    decoded.calls = 0
    const bomb = embedded(jpeg(5, 20_000, 3_000)) // wider than any photo may be
    const heavy = embedded(jpeg(6, 9_000, 8_000)) // 72 megapixels
    const fine = embedded(jpeg(7, 9_000, 6_000)) // 54 megapixels: allowed (it is shrunk when decoded)
    const { file, notes } = await storePhotosOf(fileWith(['bomb', 'heavy', 'fine'], { bomb, heavy, fine }))
    expect(decoded.calls).toBe(1)
    expect(file.trip.places[0].photos?.map((p) => p.id)).toEqual(['fine'])
    expect(notes).toEqual(['2 photos in the file were damaged or too large and were left out.'])
    expect([...photos.records.keys()]).toEqual(['fine'])
  })

  it('the references get the size the stored photo really has, not the one the file claimed', async () => {
    const { file } = await storePhotosOf(fileWith(['a'], { a: embedded(jpeg(7, 4000, 3000), 4000, 3000) }))
    // The "decoder" says 107 x 50: that is what the reference says afterwards (and what was stored).
    expect(file.trip.places[0].photos).toEqual([{ id: 'a', width: 107, height: 50 }])
    expect([photos.records.get('a')!.width, photos.records.get('a')!.height]).toEqual([107, 50])
  })

  it('says which photos it newly stored, so that they can be taken out again', async () => {
    await photos.put([stored('old', good(5))])
    const { added } = await storePhotosOf(fileWith(['old', 'new1', 'new2'], { old: embedded(good(1)), new1: embedded(good(2)), new2: embedded(good(3)) }))
    expect(added).toEqual(['new1', 'new2'])
    expect([...photos.records.keys()].sort()).toEqual(['new1', 'new2', 'old'])
    await discardPhotos(added)
    expect([...photos.records.keys()]).toEqual(['old'])
    await discardPhotos([])
  })

  it('discarding is best effort', async () => {
    setPhotoStore({ ...photos, delete: async () => Promise.reject(new Error('IndexedDB is gone')) })
    await expect(discardPhotos(['x'])).resolves.toBeUndefined()
  })

  it('references to photos that are neither embedded nor stored are dropped; stored ones stay', async () => {
    await photos.put([stored('here', good(9))])
    const { file, notes } = await storePhotosOf(fileWith(['here', 'nowhere'], undefined))
    expect(file.trip.places[0].photos?.map((p) => p.id)).toEqual(['here'])
    expect(notes).toEqual(['1 photo was not in the file or in this browser and was left out.'])
  })

  it('a photo that is stored already is kept as it is', async () => {
    await photos.put([stored('a', good(5))])
    await storePhotosOf(fileWith(['a'], { a: embedded(good(1)) }))
    expect(new Uint8Array(await photos.records.get('a')!.blob.arrayBuffer())).toEqual(good(5))
  })

  it('a trip without photos passes through untouched (just without a photos key)', async () => {
    const plain = serializeTripFile(createTrip({ id: 't', places: [{ id: 'p', name: 'P', lat: 1, lng: 1, day: 0 }] }))
    const { file, notes } = await storePhotosOf(plain)
    expect(file).toEqual(plain)
    expect(notes).toEqual([])
  })

  it('when the storage fails the trip still opens, without the references, with the reason', async () => {
    setPhotoStore({ ...photos, put: async () => Promise.reject(new PhotoStoreError('This browser has no room left for photos.', 'quota')), has: async () => new Set() })
    const { file, notes } = await storePhotosOf(fileWith(['a'], { a: embedded(good(1)) }))
    expect(file.trip.places[0]).not.toHaveProperty('photos')
    expect(notes).toEqual(['This browser has no room left for photos.'])
  })

  it('shows a progress toast for a big file and takes it away again', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `ph${i}`)
    const embeddedAll = Object.fromEntries(ids.map((id, i) => [id, embedded(good(i + 1))]))
    let during = 0
    const unsubscribe = useToastStore.subscribe((s) => (during = Math.max(during, s.toasts.length)))
    await storePhotosOf(fileWith(ids, embeddedAll))
    unsubscribe()
    expect(during).toBe(1)
    expect(useToastStore.getState().toasts).toEqual([])
  })
})
