import { describe, expect, it } from 'vitest'
import type { Place, TripFile } from '../types/trip'
import { MAX_PHOTOS_PER_PLACE, MAX_PHOTOS_PER_TRIP } from './photos'
import { createTrip } from './trip'
import { parseTripFile, serializeTripFile } from './tripFile'

const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/'

const place = (id: string, photos?: unknown): Place => ({ id, name: id, lat: 45, lng: 5, day: 0, ...(photos ? { photos } : {}) }) as Place

function fileWith(places: Place[], photos?: unknown): Record<string, unknown> {
  const file = serializeTripFile(createTrip({ id: 't', places })) as unknown as Record<string, unknown>
  return photos === undefined ? file : { ...file, photos }
}

const parse = (input: unknown) => {
  const result = parseTripFile(input)
  if (!result.ok) throw new Error(result.error)
  return result
}

const ref = (id: string) => ({ id, width: 40, height: 30 })
const embedded = (extra: Record<string, unknown> = {}) => ({ mime: 'image/jpeg', data: JPEG, width: 40, height: 30, ...extra })

describe('photos in trip files', () => {
  it('a file without photos parses as before (no photos key anywhere)', () => {
    const { file, warnings } = parse(fileWith([place('a')]))
    expect(warnings).toEqual([])
    expect(file).not.toHaveProperty('photos')
    expect(file.trip.places[0]).not.toHaveProperty('photos')
  })

  it('keeps the references of places, with captions, in order', () => {
    const { file, warnings } = parse(fileWith([place('a', [{ ...ref('1'), caption: 'First' }, ref('2')]), place('b')]))
    expect(warnings).toEqual([])
    expect(file.trip.places[0].photos).toEqual([{ ...ref('1'), caption: 'First' }, ref('2')])
    expect(file.trip.places[1].photos).toBeUndefined()
    // References alone (autosave, recent trips, a file made without bytes) are fine: no `photos` record is made up.
    expect(file.photos).toBeUndefined()
  })

  it('keeps the embedded photos that a place refers to', () => {
    const { file, warnings } = parse(fileWith([place('a', [ref('1'), ref('2')])], { '1': embedded(), '2': embedded({ width: 2048, height: 1024 }) }))
    expect(warnings).toEqual([])
    expect(Object.keys(file.photos!)).toEqual(['1', '2'])
    expect(file.photos!['2']).toEqual({ mime: 'image/jpeg', data: JPEG, width: 2048, height: 1024 })
  })

  it('round-trips through serialize and parse', () => {
    const trip = createTrip({ id: 't', places: [place('a', [ref('1')])] })
    const original: TripFile = { ...serializeTripFile(trip), photos: { '1': { mime: 'image/jpeg', data: JPEG, width: 40, height: 30 } } }
    const { file } = parse(JSON.parse(JSON.stringify(original)))
    expect(file.photos).toEqual(original.photos)
    expect(file.trip).toEqual(trip)
  })

  it('drops embedded photos that are damaged, with one warning', () => {
    const bad = {
      '1': embedded(),
      '2': embedded({ mime: 'image/png' }),
      '3': embedded({ data: 'iVBORw0KGgo=' }), // a PNG's bytes
      '4': embedded({ data: '/9j/ !!' }),
      '5': embedded({ width: 0 }),
      '6': embedded({ height: 99_999 }),
      '7': embedded({ width: '40' }),
      '8': 'nope',
      '9': null,
    }
    const places = [place('a', Object.keys(bad).map(ref))]
    const { file, warnings } = parse(fileWith(places, bad))
    expect(Object.keys(file.photos!)).toEqual(['1'])
    expect(warnings).toEqual(['8 photos in the file were damaged or too large and were left out.'])
    // The references stay: opening decides what to do about them (features/photos/photoFile.ts).
    expect(file.trip.places[0].photos).toHaveLength(9)
  })

  it('drops embedded photos that no place refers to', () => {
    const { file, warnings } = parse(fileWith([place('a', [ref('1')])], { '1': embedded(), stray: embedded() }))
    expect(Object.keys(file.photos!)).toEqual(['1'])
    expect(warnings).toEqual(['1 photo in the file belonged to no place and was left out.'])
  })

  it('ignores a photos value that is not an object', () => {
    for (const junk of ['x', 5, [], null]) {
      const { file, warnings } = parse(fileWith([place('a', [ref('1')])], junk))
      expect(file.photos).toBeUndefined()
      expect(warnings).toEqual(junk === null || Array.isArray(junk) || typeof junk !== 'object' ? ['The photos of the file were not readable and were left out.'] : [])
    }
  })

  it('repairs the references of places: bad ones and repeated ids go, with a warning', () => {
    const { file, warnings } = parse(fileWith([place('a', [ref('1'), ref('1'), { id: '', width: 1, height: 1 }, 'x', ref('2')])]))
    expect(file.trip.places[0].photos).toEqual([ref('1'), ref('2')])
    expect(warnings).toEqual(['Place 1: 3 photo references were invalid and were dropped.'])
    // Nothing usable: the key is not left behind.
    const empty = parse(fileWith([place('a', ['x'])]))
    expect(empty.file.trip.places[0]).not.toHaveProperty('photos')
    // Not a list at all.
    const notList = parse(fileWith([place('a', 'x')]))
    expect(notList.file.trip.places[0]).not.toHaveProperty('photos')
  })

  it('limits a place to 50 photos and a trip to 300, with warnings', () => {
    const many = Array.from({ length: MAX_PHOTOS_PER_PLACE + 3 }, (_, i) => ref(`m${i}`))
    const one = parse(fileWith([place('a', many)]))
    expect(one.file.trip.places[0].photos).toHaveLength(MAX_PHOTOS_PER_PLACE)
    expect(one.warnings[0]).toContain('3 photo references were invalid')

    const places = Array.from({ length: 8 }, (_, p) => place(`p${p}`, Array.from({ length: 45 }, (_, i) => ref(`x${p}_${i}`))))
    const trip = parse(fileWith(places))
    const total = trip.file.trip.places.reduce((sum, p) => sum + (p.photos?.length ?? 0), 0)
    expect(total).toBe(MAX_PHOTOS_PER_TRIP)
    expect(trip.file.trip.places[6].photos).toHaveLength(MAX_PHOTOS_PER_TRIP - 45 * 6)
    expect(trip.file.trip.places[7]).not.toHaveProperty('photos')
    expect(trip.warnings).toContain(`A trip holds at most ${MAX_PHOTOS_PER_TRIP} photos; ${8 * 45 - MAX_PHOTOS_PER_TRIP} were dropped.`)
  })

  it('drops a place’s photos entirely once the trip is full', () => {
    const places = Array.from({ length: 7 }, (_, p) => place(`p${p}`, Array.from({ length: 50 }, (_, i) => ref(`x${p}_${i}`))))
    const { file } = parse(fileWith(places))
    expect(file.trip.places.map((p) => p.photos?.length ?? 0)).toEqual([50, 50, 50, 50, 50, 50, 0])
    expect(file.trip.places[6]).not.toHaveProperty('photos')
  })
})
