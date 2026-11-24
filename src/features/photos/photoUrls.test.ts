import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryPhotoStore, setPhotoStore } from '../../services/photoDb'
import { acquirePhotoUrl } from './photoUrls'

let photos: ReturnType<typeof createMemoryPhotoStore>
let created: string[]
let revoked: string[]

beforeEach(() => {
  vi.useFakeTimers()
  photos = createMemoryPhotoStore()
  setPhotoStore(photos)
  created = []
  revoked = []
  let n = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:test/${++n}`
    created.push(url)
    return url
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    revoked.push(url)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  setPhotoStore(null)
})

const record = (id: string) => ({ id, blob: new Blob(['full']), thumb: new Blob(['thumb']), width: 4, height: 3, createdAt: 1 })

describe('photo object URLs', () => {
  it('everyone showing the same photo shares one URL, which is revoked a while after the last one lets go', async () => {
    await photos.put([record('a')])
    const first = acquirePhotoUrl('a', 'thumb')
    const second = acquirePhotoUrl('a', 'thumb')
    const url = await first.url
    expect(await second.url).toBe(url)
    expect(created).toHaveLength(1)

    first.release()
    first.release() // twice is the same as once
    await vi.advanceTimersByTimeAsync(60_000)
    expect(revoked).toEqual([])

    second.release()
    await vi.advanceTimersByTimeAsync(29_000)
    expect(revoked).toEqual([])
    await vi.advanceTimersByTimeAsync(2_000)
    expect(revoked).toEqual([url])
    // Asked for again, it is made again.
    expect(await acquirePhotoUrl('a', 'thumb').url).not.toBe(url)
  })

  it('a photo shown again before the delay is over keeps its URL', async () => {
    await photos.put([record('a')])
    const first = acquirePhotoUrl('a', 'full')
    const url = await first.url
    first.release()
    await vi.advanceTimersByTimeAsync(20_000)
    const again = acquirePhotoUrl('a', 'full')
    expect(await again.url).toBe(url)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(revoked).toEqual([])
    again.release()
  })

  it('the thumbnail and the full photo are separate URLs; a missing photo is null and asked for again next time', async () => {
    await photos.put([record('a')])
    const [thumb, full] = [acquirePhotoUrl('a', 'thumb'), acquirePhotoUrl('a', 'full')]
    expect(await thumb.url).not.toBe(await full.url)

    const gone = acquirePhotoUrl('late', 'thumb')
    expect(await gone.url).toBeNull()
    await photos.put([record('late')])
    const retry = acquirePhotoUrl('late', 'thumb')
    expect(await retry.url).toMatch(/^blob:/)
  })

  it('a store that fails counts as a missing photo', async () => {
    setPhotoStore({ ...photos, get: async () => Promise.reject(new Error('IndexedDB is gone')) })
    expect(await acquirePhotoUrl('never-cached', 'thumb').url).toBeNull()
  })
})
