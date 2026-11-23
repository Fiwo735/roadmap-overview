import { beforeEach, describe, expect, it } from 'vitest'
import type { LegRoute } from '../types/trip'
import { useRouteStore } from './routeStore'

const s = () => useRouteStore.getState()
const route = (key: string): LegRoute => ({ key, geometry: '', distanceM: 1, durationS: 1, source: 'osrm' })

beforeEach(() => s().clear())

describe('routeStore', () => {
  it('stores a route under its key and clears that key\'s status', () => {
    s().setStatus('a', 'loading')
    s().setStatus('b', 'error')
    s().setRoute(route('a'))
    expect(s().routes.a).toEqual(route('a'))
    expect(s().status).toEqual({ b: 'error' })
  })

  it('sets and clears statuses without needless updates', () => {
    s().setStatus('a', 'loading')
    const before = s().status
    s().setStatus('a', 'loading')
    expect(s().status).toBe(before)
    s().setStatus('a', null)
    expect(s().status).toEqual({})
    const empty = s().status
    s().setStatus('a', null)
    expect(s().status).toBe(empty)
  })

  it('keeps the reason of an error until the status changes', () => {
    s().setStatus('a', 'error', 'No road route')
    expect(s().errors).toEqual({ a: 'No road route' })
    const before = s()
    s().setStatus('a', 'error', 'No road route')
    expect(s()).toBe(before)
    s().setStatus('a', 'loading')
    expect(s().errors).toEqual({})
    s().setStatus('a', 'error')
    expect(s().errors).toEqual({})
    s().setStatus('a', 'error', 'Again')
    s().setStatus('a', null)
    expect(s().errors).toEqual({})
    s().setStatus('b', 'error', 'x')
    s().setRoute(route('b'))
    expect(s().errors).toEqual({})
    s().setStatus('c', 'error', 'y')
    s().clear()
    expect(s().errors).toEqual({})
  })

  it('bulk-loads routes', () => {
    s().setRoutes([route('a'), route('b')])
    expect(Object.keys(s().routes)).toEqual(['a', 'b'])
    const before = s().routes
    s().setRoutes([])
    expect(s().routes).toBe(before)
  })
})
