import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePolyline } from '../lib/polyline'
import { createTrip } from '../lib/trip'
import { serializeTripFile } from '../lib/tripFile'
import { useToastStore } from '../components/toast'
import { CORRUPT_TRIP_KEY, CURRENT_TRIP_KEY, restoreSavedTrip, startAutosave } from './persistence'
import { useRouteStore } from './routeStore'
import { clearHistory, useTripStore } from './tripStore'

class MemoryStorage {
  data = new Map<string, string>()
  throwOnSet = false
  /** Values longer than this are refused, like a nearly full quota. */
  maxLength = Infinity
  setItemCalls = 0
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.setItemCalls++
    if (this.throwOnSet || value.length > this.maxLength) throw new Error('QuotaExceededError')
    this.data.set(key, value)
  }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  useTripStore.setState({ trip: createTrip() })
  clearHistory()
  useRouteStore.getState().clear()
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('restoreSavedTrip', () => {
  it('reports "none" when nothing is saved', () => {
    expect(restoreSavedTrip()).toBe('none')
  })

  it('loads the saved trip with a clean history', () => {
    const trip = createTrip({
      title: 'Saved',
      places: [
        { id: 'a', name: 'A', lat: 1, lng: 1, day: 0 },
        { id: 'b', name: 'B', lat: 2, lng: 2, day: 1 },
      ],
    })
    trip.legs = [{ id: 'l1', fromId: 'a', toId: 'b', mode: 'ferry', via: [] }]
    storage.setItem(CURRENT_TRIP_KEY, JSON.stringify(serializeTripFile(trip)))

    expect(restoreSavedTrip()).toBe('restored')
    expect(useTripStore.getState().trip).toEqual(trip)
    expect(useTripStore.temporal.getState().pastStates).toHaveLength(0)
  })

  it('restores cached routes whose key still matches', () => {
    const trip = createTrip({
      places: [
        { id: 'a', name: 'A', lat: 1, lng: 1, day: 0 },
        { id: 'b', name: 'B', lat: 2, lng: 2, day: 1 },
      ],
    })
    trip.legs = [{ id: 'l1', fromId: 'a', toId: 'b', mode: 'drive', via: [] }]
    const key = 'drive;1.00000,1.00000;2.00000,2.00000'
    const geometry = encodePolyline([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ])
    const route = { key, geometry, distanceM: 160_000, durationS: 5, source: 'osrm' as const }
    storage.setItem(CURRENT_TRIP_KEY, JSON.stringify(serializeTripFile(trip, { l1: route })))

    restoreSavedTrip()
    expect(useRouteStore.getState().routes[key]).toEqual(route)
  })

  it.each([
    ['broken JSON', '{"format": '],
    ['the wrong shape', '{"hello": "world"}'],
    ['a different version', '{"format":"roadmap-overview/trip","version":99,"trip":{}}'],
  ])('keeps the default trip and a backup copy for %s', (_label, raw) => {
    storage.setItem(CURRENT_TRIP_KEY, raw)
    expect(restoreSavedTrip()).toBe('corrupt')
    expect(useTripStore.getState().trip.places).toEqual([])
    expect(storage.getItem(CORRUPT_TRIP_KEY)).toBe(raw)
  })

  it('survives storage that throws on read', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('SecurityError')
      },
    })
    expect(restoreSavedTrip()).toBe('none')
  })

  it('survives a missing localStorage', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(restoreSavedTrip()).toBe('none')
  })
})

describe('startAutosave', () => {
  let listeners: Record<string, () => void>

  beforeEach(() => {
    vi.useFakeTimers()
    listeners = {}
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: () => void) => (listeners[type] = fn),
      removeEventListener: () => {},
    })
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' })
  })

  const saved = () => {
    const raw = storage.getItem(CURRENT_TRIP_KEY)
    return raw ? JSON.parse(raw).trip : null
  }

  it('saves once, shortly after a burst of edits', () => {
    const stop = startAutosave(500)
    useTripStore.getState().setTitle('A')
    useTripStore.getState().setTitle('B')
    expect(saved()).toBeNull()
    vi.advanceTimersByTime(499)
    expect(saved()).toBeNull()
    vi.advanceTimersByTime(2)
    expect(saved().title).toBe('B')
    stop()
  })

  it('flushes immediately when the page is hidden', () => {
    const stop = startAutosave(500)
    useTripStore.getState().setTitle('Quick')
    listeners.pagehide()
    expect(saved().title).toBe('Quick')
    stop()
  })

  it('does not write when only unrelated state changes', () => {
    const stop = startAutosave(500)
    useRouteStore.getState().setStatus('k', 'loading')
    vi.advanceTimersByTime(1000)
    expect(saved()).toBeNull()
    stop()
  })

  it('shows one error toast and keeps running when storage rejects writes', () => {
    const stop = startAutosave(100)
    storage.throwOnSet = true
    useTripStore.getState().setTitle('X')
    vi.advanceTimersByTime(200)
    useTripStore.getState().setTitle('Y')
    vi.advanceTimersByTime(200)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0].kind).toBe('error')
    stop()
  })

  it('a page-hide flush still tries even during a backoff', () => {
    const stop = startAutosave(100)
    storage.throwOnSet = true
    useTripStore.getState().setTitle('X')
    vi.advanceTimersByTime(200)
    storage.throwOnSet = false
    useTripStore.getState().setTitle('Final')
    listeners.pagehide()
    expect(JSON.parse(storage.getItem(CURRENT_TRIP_KEY)!).trip.title).toBe('Final')
    stop()
  })

  it('retries once without the cached routes when the quota is exceeded', () => {
    const a = { lat: 1, lng: 1 }
    const b = { lat: 2, lng: 2 }
    const key = 'drive;1.00000,1.00000;2.00000,2.00000'
    const stop = startAutosave(100)
    useTripStore.getState().addPlace({ name: 'A', ...a })
    useTripStore.getState().addPlace({ name: 'B', ...b })
    useRouteStore.getState().setRoute({
      key,
      geometry: encodePolyline([a, b]) + 'x'.repeat(5000),
      distanceM: 1,
      durationS: 1,
      source: 'osrm',
    })
    storage.maxLength = 3000
    vi.advanceTimersByTime(200)

    const file = JSON.parse(storage.getItem(CURRENT_TRIP_KEY)!)
    expect(file.trip.places.map((p: { name: string }) => p.name)).toEqual(['A', 'B'])
    expect(file.routes).toEqual({})
    expect(useToastStore.getState().toasts).toHaveLength(0)

    // Later saves skip the routes straight away instead of failing first.
    const calls = storage.setItemCalls
    useTripStore.getState().setTitle('Next')
    vi.advanceTimersByTime(200)
    expect(storage.setItemCalls).toBe(calls + 1)
    stop()
  })

  it('backs off while storage keeps failing: one toast, few serialisations', () => {
    const stringify = vi.spyOn(JSON, 'stringify')
    const stop = startAutosave(100)
    storage.throwOnSet = true
    for (let i = 0; i < 50; i++) {
      useTripStore.getState().setTitle(`T${i}`)
      vi.advanceTimersByTime(300)
    }
    expect(useToastStore.getState().toasts).toHaveLength(1)
    // 15 s of failing edits: the first save tried twice (with and without routes), then backed off.
    expect(stringify.mock.calls.length).toBeLessThanOrEqual(4)
    expect(storage.setItemCalls).toBeLessThanOrEqual(4)

    // Once the backoff has passed (and storage works again) the latest state is saved.
    storage.throwOnSet = false
    vi.advanceTimersByTime(31_000)
    expect(JSON.parse(storage.getItem(CURRENT_TRIP_KEY)!).trip.title).toBe('T49')
    stringify.mockRestore()
    stop()
  })

  it('stops saving after the returned stop function is called', () => {
    const stop = startAutosave(100)
    stop()
    useTripStore.getState().setTitle('Late')
    vi.advanceTimersByTime(500)
    expect(saved()).toBeNull()
  })
})
