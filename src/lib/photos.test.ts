import { describe, expect, it } from 'vitest'
import type { Place, PlacePhoto, TripFile } from '../types/trip'
import {
  GC_TTL_MS,
  MAX_CAPTION_LENGTH,
  MAX_PHOTOS_PER_PLACE,
  MAX_PHOTOS_PER_TRIP,
  base64Chunks,
  base64ToBytes,
  bytesToBase64,
  capForTrip,
  cleanPhoto,
  cleanPhotoList,
  describeProblems,
  fitWithin,
  isHeic,
  isJpegBase64,
  looksLikeImage,
  movePhoto,
  photoIdsInRawFile,
  photoIdsOfTrip,
  photoSlotsLeft,
  planBatch,
  planGarbage,
  readJpegSize,
  tripFileTextParts,
  tripPhotoCount,
  withoutMissingPhotos,
  withoutPhotos,
  withPhotoSizes,
} from './photos'
import { decodeShareHash, encodeShareHash } from './shareLink'
import { parseTripFile, serializeTripFile } from './tripFile'
import { createTrip } from './trip'

const photo = (id: string, extra: Partial<PlacePhoto> = {}): PlacePhoto => ({ id, width: 40, height: 30, ...extra })
const place = (id: string, photos?: PlacePhoto[]): Place => ({ id, name: id, lat: 45, lng: 5, day: 0, ...(photos ? { photos } : {}) })

describe('fitWithin', () => {
  it('scales the long edge down to the limit and keeps the proportions', () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 })
    expect(fitWithin(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 })
    expect(fitWithin(6000, 6000, 320)).toEqual({ width: 320, height: 320 })
  })

  it('never enlarges', () => {
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(2048, 100, 2048)).toEqual({ width: 2048, height: 100 })
  })

  it('keeps at least one pixel on the short edge and survives nonsense sizes', () => {
    expect(fitWithin(20_000, 5, 2048)).toEqual({ width: 2048, height: 1 })
    expect(fitWithin(0, 100, 2048)).toEqual({ width: 1, height: 1 })
    expect(fitWithin(Number.NaN, 100, 2048)).toEqual({ width: 1, height: 1 })
  })

  it('rounds to whole pixels', () => {
    const { width, height } = fitWithin(3001, 2001, 2048)
    expect(Number.isInteger(width) && Number.isInteger(height)).toBe(true)
    expect(width).toBe(2048)
  })
})

describe('photo references', () => {
  it('cleanPhoto keeps a good reference and trims nothing it should not', () => {
    expect(cleanPhoto({ id: 'ph_1', width: 800, height: 600, caption: 'Sunset', extra: 1 })).toEqual({ id: 'ph_1', width: 800, height: 600, caption: 'Sunset' })
    expect(cleanPhoto({ id: 'ph_1', width: 800, height: 600, caption: '   ' })).toEqual({ id: 'ph_1', width: 800, height: 600 })
    expect(cleanPhoto({ id: 'ph_1', width: 800, height: 600, caption: 'x'.repeat(MAX_CAPTION_LENGTH + 50) })!.caption).toHaveLength(MAX_CAPTION_LENGTH)
  })

  it('cleanPhoto rejects what cannot be a reference', () => {
    for (const bad of [null, 'ph_1', [], {}, { id: '', width: 1, height: 1 }, { id: 5, width: 1, height: 1 }, { id: 'a', width: 0, height: 5 }, { id: 'a', width: 1.5, height: 5 }, { id: 'a', width: 5, height: 99_999 }, { id: 'a', width: '5', height: 5 }, { id: 'x'.repeat(101), width: 1, height: 1 }]) {
      expect(cleanPhoto(bad)).toBeNull()
    }
  })

  it('cleanPhotoList drops repeated ids and unusable entries, and caps the list', () => {
    const { photos, dropped } = cleanPhotoList([photo('a'), photo('a'), { nope: 1 }, photo('b')])
    expect(photos.map((p) => p.id)).toEqual(['a', 'b'])
    expect(dropped).toBe(2)
    const many = Array.from({ length: MAX_PHOTOS_PER_PLACE + 5 }, (_, i) => photo(`p${i}`))
    expect(cleanPhotoList(many).photos).toHaveLength(MAX_PHOTOS_PER_PLACE)
    expect(cleanPhotoList('nope').photos).toEqual([])
    expect(cleanPhotoList(undefined)).toEqual({ photos: [], dropped: 0 })
  })

  it('counts and collects the ids of a trip', () => {
    const trip = { places: [place('a', [photo('1'), photo('2')]), place('b'), place('c', [photo('2'), photo('3')])] }
    expect(tripPhotoCount(trip)).toBe(4)
    expect([...photoIdsOfTrip(trip)].sort()).toEqual(['1', '2', '3'])
  })

  it('photoSlotsLeft is the tighter of the per-place and per-trip limits', () => {
    expect(photoSlotsLeft(0, 0)).toBe(MAX_PHOTOS_PER_PLACE)
    expect(photoSlotsLeft(30, 30)).toBe(20)
    expect(photoSlotsLeft(10, MAX_PHOTOS_PER_TRIP - 3)).toBe(3)
    expect(photoSlotsLeft(MAX_PHOTOS_PER_PLACE, 60)).toBe(0)
    expect(photoSlotsLeft(0, MAX_PHOTOS_PER_TRIP + 10)).toBe(0)
  })

  it('capForTrip leaves room for the photos of the other places', () => {
    const others = Array.from({ length: MAX_PHOTOS_PER_TRIP - 10 }, (_, i) => photo(`o${i}`))
    const trip = { places: [place('a', others.slice(0, 50)), place('b', others.slice(50, 100)), place('c', others.slice(100, 150)), place('d', others.slice(150, 200)), place('e', others.slice(200, 250)), place('f', others.slice(250)), place('mine', [photo('m1')])] }
    expect(tripPhotoCount(trip)).toBe(MAX_PHOTOS_PER_TRIP - 9)
    const wanted = Array.from({ length: 30 }, (_, i) => photo(`new${i}`))
    // 290 elsewhere: only 10 more fit, this place's own old photos do not count against it.
    expect(capForTrip(trip, 'mine', wanted)).toHaveLength(10)
    expect(capForTrip(trip, 'mine', wanted.slice(0, 4))).toHaveLength(4)
  })

  it('movePhoto moves one place earlier or later and stays put at the ends', () => {
    const list = ['a', 'b', 'c'].map((id) => photo(id))
    expect(movePhoto(list, 0, 1).map((p) => p.id)).toEqual(['b', 'a', 'c'])
    expect(movePhoto(list, 2, -1).map((p) => p.id)).toEqual(['a', 'c', 'b'])
    expect(movePhoto(list, 0, -1).map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(movePhoto(list, 2, 1).map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(movePhoto(list, -1, 1).map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(list.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('trip files without (some) photos', () => {
  const file = (): TripFile => ({
    ...serializeTripFile(createTrip({ places: [place('a', [photo('1'), photo('2')]), place('b', [photo('3')]), place('c')] })),
    photos: { '1': { mime: 'image/jpeg', data: '/9j/AAAA', width: 40, height: 30 } },
  })

  it('withoutPhotos removes the bytes and every reference', () => {
    const plain = withoutPhotos(file())
    expect(plain).not.toHaveProperty('photos')
    expect(plain.trip.places.every((p) => p.photos === undefined)).toBe(true)
    // Nothing else changes, and a trip that had no photos is returned as it was.
    expect(plain.trip.places.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    const without = serializeTripFile(createTrip({ places: [place('x')] }))
    expect(withoutPhotos(without)).toEqual(without)
  })

  it('withoutMissingPhotos keeps the references that have bytes, counts the others and removes empty lists', () => {
    const { file: pruned, missing } = withoutMissingPhotos(file(), new Set(['1', '3']))
    expect(missing).toBe(1)
    expect(pruned.trip.places[0].photos).toEqual([photo('1')])
    expect(pruned.trip.places[1].photos).toEqual([photo('3')])
    const none = withoutMissingPhotos(file(), new Set())
    expect(none.missing).toBe(3)
    expect(none.file.trip.places.every((p) => !('photos' in p))).toBe(true)
    const all = file()
    expect(withoutMissingPhotos(all, new Set(['1', '2', '3']))).toEqual({ file: all, missing: 0 })
  })

  it('share links carry neither references nor bytes', () => {
    const decoded = decodeShareHash(encodeShareHash(file(), { present: true }))
    expect(decoded.ok).toBe(true)
    const text = JSON.stringify(decoded.ok ? decoded.data : null)
    expect(text).not.toContain('photos')
    expect(text).not.toContain('/9j/')
    // The trip itself is all there.
    const reread = parseTripFile(decoded.ok ? decoded.data : null)
    expect(reread.ok && reread.file.trip.places.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('what is an image, and what to do with a batch of files', () => {
  it('looksLikeImage goes by type, or by name when the type is blank', () => {
    expect(looksLikeImage({ name: 'a.jpg', type: 'image/jpeg' })).toBe(true)
    expect(looksLikeImage({ name: 'a', type: 'image/webp' })).toBe(true)
    expect(looksLikeImage({ name: 'IMG_1.HEIC', type: '' })).toBe(true)
    expect(looksLikeImage({ name: 'a.txt', type: 'text/plain' })).toBe(false)
    expect(looksLikeImage({ name: 'a.json', type: '' })).toBe(false)
    expect(looksLikeImage({ name: 'logo.svg', type: 'image/svg+xml' })).toBe(false)
  })

  it('isHeic by type or name', () => {
    expect(isHeic({ name: 'a.heic', type: '' })).toBe(true)
    expect(isHeic({ name: 'a', type: 'image/heif' })).toBe(true)
    expect(isHeic({ name: 'a.jpg', type: 'image/jpeg' })).toBe(false)
  })

  const f = (name: string, size = 1000, type = 'image/jpeg') => ({ name, size, type })

  it('planBatch accepts images in order and rejects the rest with a reason', () => {
    const plan = planBatch([f('a.jpg'), f('notes.txt', 10, 'text/plain'), f('empty.jpg', 0), f('huge.jpg', 31 * 1024 * 1024), f('b.png', 5, 'image/png')], 10)
    expect(plan.accepted).toEqual([0, 4])
    expect(plan.rejected).toEqual([
      { index: 1, name: 'notes.txt', problem: 'not-image' },
      { index: 2, name: 'empty.jpg', problem: 'empty' },
      { index: 3, name: 'huge.jpg', problem: 'too-large' },
    ])
    // The limit is 30 MB: exactly 30 is fine.
    expect(planBatch([f('edge.jpg', 30 * 1024 * 1024)], 1).accepted).toEqual([0])
  })

  it('planBatch stops at the free slots', () => {
    const plan = planBatch([f('1.jpg'), f('2.jpg'), f('3.jpg')], 2)
    expect(plan.accepted).toEqual([0, 1])
    expect(plan.rejected).toEqual([{ index: 2, name: '3.jpg', problem: 'no-room' }])
    expect(planBatch([f('1.jpg')], 0).accepted).toEqual([])
  })

  it('describeProblems names the first file and counts the others', () => {
    expect(describeProblems([])).toBe('')
    expect(describeProblems([{ name: 'a.heic', problem: 'heic' }])).toBe('a.heic is a HEIC photo, which this browser cannot read (convert it to JPEG first).')
    const several = describeProblems([
      { name: 'a.txt', problem: 'not-image' },
      { name: 'b.jpg', problem: 'unreadable' },
      { name: 'c.jpg', problem: 'unreadable' },
    ])
    expect(several).toBe('3 files were not added. a.txt is not an image; 2 others had problems too.')
    expect(describeProblems([{ name: 'a', problem: 'empty' }, { name: 'b', problem: 'empty' }])).toContain('1 other had a problem too')
  })
})

describe('garbage selection', () => {
  const now = 10_000_000_000
  const day = 24 * 3_600_000
  const photo = (id: string, unreferencedSince?: number) => ({ id, createdAt: now - 30 * day, ...(unreferencedSince === undefined ? {} : { unreferencedSince }) })

  it('only marks a photo the first time nothing refers to it: nothing is deleted yet', () => {
    const plan = planGarbage([photo('used'), photo('orphan'), { id: 'new', createdAt: now }], new Set(['used']), now)
    expect(plan).toEqual({ mark: ['orphan', 'new'], clear: [], delete: [] })
  })

  it('deletes a photo that has stayed unreferenced for the whole delay, not before', () => {
    const keep = new Set<string>()
    const stored = [photo('just-short', now - GC_TTL_MS + 1), photo('exactly', now - GC_TTL_MS), photo('long', now - 30 * day), photo('recent', now - day)]
    expect(planGarbage(stored, keep, now)).toEqual({ mark: [], clear: [], delete: ['exactly', 'long'] })
    // The delay is a parameter (tests, and anything that wants it shorter).
    expect(planGarbage(stored, keep, now, day)).toEqual({ mark: [], clear: [], delete: ['just-short', 'exactly', 'long', 'recent'] })
    expect(GC_TTL_MS).toBe(7 * day)
  })

  it('a photo that is referenced again loses its mark, whatever its age', () => {
    const plan = planGarbage([photo('back', now - 30 * day), photo('fine'), photo('gone', now - 30 * day)], new Set(['back', 'fine']), now)
    expect(plan).toEqual({ mark: [], clear: ['back'], delete: ['gone'] })
  })

  it('a clock that was set back, or a mark from the future, never deletes anything', () => {
    expect(planGarbage([photo('x', now + 10 * day)], new Set(), now).delete).toEqual([])
    expect(planGarbage([photo('x', now - 30 * day)], new Set(), now - 60 * day).delete).toEqual([])
  })

  it('an empty store, and a store where everything is in use, need nothing', () => {
    expect(planGarbage([], new Set(), now)).toEqual({ mark: [], clear: [], delete: [] })
    expect(planGarbage([photo('a'), photo('b')], new Set(['a', 'b']), now)).toEqual({ mark: [], clear: [], delete: [] })
  })

  it('photoIdsInRawFile reads what it can from stored data and never throws', () => {
    expect(photoIdsInRawFile({ trip: { places: [{ photos: [{ id: 'a' }, { id: 5 }, null, { id: 'b' }] }, null, { photos: 'x' }, {}] } })).toEqual(['a', 'b'])
    for (const junk of [null, undefined, 3, 'x', [], {}, { trip: null }, { trip: { places: 'x' } }]) expect(photoIdsInRawFile(junk)).toEqual([])
  })
})

describe('embedding in a trip file', () => {
  it('isJpegBase64 wants JPEG-looking base64 of a sane size', () => {
    expect(isJpegBase64('/9j/4AAQSkZJRg==')).toBe(true)
    expect(isJpegBase64('iVBORw0KGgo=')).toBe(false) // a PNG
    expect(isJpegBase64('/9j/ not base64!')).toBe(false)
    expect(isJpegBase64('/9j/')).toBe(false)
    expect(isJpegBase64(12)).toBe(false)
    expect(isJpegBase64('/9j/' + 'A'.repeat(14_000_000))).toBe(false)
  })

  it('base64 helpers round-trip arbitrary bytes, also big ones', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 31 + 7) % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
    expect(bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('/9j/')
  })

  it('base64Chunks joins to the base64 of the whole blob, whatever the chunk size', async () => {
    const bytes = Uint8Array.from({ length: 10_007 }, (_, i) => (i * 13) % 256)
    const whole = bytesToBase64(bytes)
    for (const size of [3, 300, 3000, 9999 - (9999 % 3)]) {
      let joined = ''
      for await (const chunk of base64Chunks(new Blob([bytes]), size)) joined += chunk
      expect(joined).toBe(whole)
    }
  })

  it('tripFileTextParts is the pretty-printed file with a photos object, and parses back', async () => {
    const trip = createTrip({ id: 't1', title: 'T', places: [place('a', [photo('ph_1', { width: 2, height: 3, caption: 'Hi "there"' }), photo('ph_2')])] })
    const file = serializeTripFile(trip)
    const jpeg1 = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5, 6, 7])
    const jpeg2 = new Uint8Array([0xff, 0xd8, 0xff, 9])
    const { parts, skipped } = await tripFileTextParts(file, [
      { id: 'ph_1', width: 2, height: 3, blob: new Blob([jpeg1]) },
      { id: 'ph_2', width: 40, height: 30, blob: new Blob([jpeg2]) },
    ])
    expect(skipped).toEqual([])
    const text = parts.join('')
    expect(text.endsWith('\n  }\n}\n')).toBe(true)
    const parsed = JSON.parse(text) as TripFile
    expect(parsed.trip).toEqual(trip)
    expect(Object.keys(parsed.photos!)).toEqual(['ph_1', 'ph_2'])
    expect(parsed.photos!.ph_1).toEqual({ mime: 'image/jpeg', data: bytesToBase64(jpeg1), width: 2, height: 3 })
    expect(base64ToBytes(parsed.photos!.ph_2.data)).toEqual(jpeg2)
    // And the parser of the app takes it, keeping the photos that a place refers to.
    const reread = parseTripFile(parsed)
    expect(reread.ok && Object.keys(reread.file.photos ?? {})).toEqual(['ph_1', 'ph_2'])
    expect(reread.ok && reread.warnings).toEqual([])
  })

  it('without photos the text is exactly what stringifyTripFile writes', async () => {
    const file = serializeTripFile(createTrip({ id: 't1', places: [place('a')] }))
    const { parts, skipped } = await tripFileTextParts(file, [])
    expect(parts.join('')).toBe(`${JSON.stringify(file, null, 2)}\n`)
    expect(skipped).toEqual([])
  })

  it('a photo whose bytes cannot be read is left out together with its references, and the rest is written', async () => {
    const trip = createTrip({ id: 't1', places: [place('a', [photo('ok'), photo('broken')]), place('b', [photo('broken')])] })
    const unreadable = new Blob(['x'])
    unreadable.slice = () => ({ arrayBuffer: () => Promise.reject(new Error('NotReadableError')) }) as unknown as Blob
    const { parts, skipped } = await tripFileTextParts(serializeTripFile(trip), [
      { id: 'ok', width: 40, height: 30, blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])]) },
      { id: 'broken', width: 40, height: 30, blob: unreadable },
    ])
    expect(skipped).toEqual(['broken'])
    const parsed = JSON.parse(parts.join('')) as TripFile
    expect(Object.keys(parsed.photos!)).toEqual(['ok'])
    expect(parsed.trip.places[0].photos?.map((p) => p.id)).toEqual(['ok'])
    expect(parsed.trip.places[1]).not.toHaveProperty('photos')
    // Every photo unreadable: no photos object at all, and the text is still the plain file.
    const none = await tripFileTextParts(serializeTripFile(trip), [{ id: 'broken', width: 40, height: 30, blob: unreadable }])
    expect(none.skipped).toEqual(['broken'])
    expect(JSON.parse(none.parts.join(''))).not.toHaveProperty('photos')
  })
})

describe('what a JPEG says it decodes to', () => {
  /** A minimal JPEG header: SOI, an APP0 segment, a DQT-like segment, then the frame header of the given kind. */
  function jpegHeader(width: number, height: number, sof = 0xc0, extra: number[][] = []): Uint8Array {
    const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]
    const frame = [0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]
    return Uint8Array.from([0xff, 0xd8, ...app0, ...extra.flat(), ...frame, 0xff, 0xda, 0x00, 0x02])
  }

  it('reads the size from the frame header, whatever else comes first', () => {
    expect(readJpegSize(jpegHeader(4000, 3000))).toEqual({ width: 4000, height: 3000 })
    // Progressive (SOF2) and an extra comment segment in front.
    expect(readJpegSize(jpegHeader(65535, 65535, 0xc2, [[0xff, 0xfe, 0x00, 0x05, 0x61, 0x62, 0x63]]))).toEqual({ width: 65535, height: 65535 })
    expect(readJpegSize(jpegHeader(1, 2))).toEqual({ width: 1, height: 2 })
  })

  it('does not take a Huffman table, or the start of the scan, for a frame header', () => {
    const dht = [0xff, 0xc4, 0x00, 0x04, 0x00, 0x00]
    expect(readJpegSize(jpegHeader(800, 600, 0xc0, [dht]))).toEqual({ width: 800, height: 600 })
    const noFrame = Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00, 0x00])
    expect(readJpegSize(noFrame)).toBeNull()
  })

  it('gives null for what is not a JPEG, is cut off or declares nothing', () => {
    expect(readJpegSize(new Uint8Array())).toBeNull()
    expect(readJpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(readJpegSize(jpegHeader(800, 600).subarray(0, 24))).toBeNull()
    expect(readJpegSize(jpegHeader(0, 600))).toBeNull()
    expect(readJpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00]))).toBeNull()
  })
})

describe('references that say what the bytes are', () => {
  it('withPhotoSizes sets the sizes of the photos it is told about, and returns the same file when nothing changes', () => {
    const file = serializeTripFile(createTrip({ places: [place('a', [photo('1', { width: 9000, height: 6000, caption: 'Big' }), photo('2')]), place('b')] }))
    const fixed = withPhotoSizes(file, new Map([['1', { width: 2048, height: 1365 }], ['other', { width: 1, height: 1 }]]))
    expect(fixed.trip.places[0].photos).toEqual([{ id: '1', width: 2048, height: 1365, caption: 'Big' }, photo('2')])
    expect(fixed.trip.places[1]).toBe(file.trip.places[1])
    expect(withPhotoSizes(file, new Map())).toBe(file)
    expect(withPhotoSizes(file, new Map([['2', { width: 40, height: 30 }]]))).toBe(file)
  })
})
