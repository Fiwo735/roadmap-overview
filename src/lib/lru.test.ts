import { describe, expect, it } from 'vitest'
import { createLru } from './lru'

describe('createLru', () => {
  it('evicts the least recently used entry beyond the limit', () => {
    const lru = createLru<string, number>(2)
    lru.set('a', 1)
    lru.set('b', 2)
    lru.get('a') // refresh a, so b is now the oldest
    lru.set('c', 3)
    expect(lru.has('b')).toBe(false)
    expect(lru.get('a')).toBe(1)
    expect(lru.get('c')).toBe(3)
    expect(lru.size).toBe(2)
  })

  it('distinguishes a stored undefined-like value from a miss with has()', () => {
    const lru = createLru<string, null>(2)
    lru.set('x', null)
    expect(lru.has('x')).toBe(true)
    expect(lru.get('x')).toBeNull()
    expect(lru.get('y')).toBeUndefined()
  })

  it('overwrites in place and clears', () => {
    const lru = createLru<string, number>(2)
    lru.set('a', 1)
    lru.set('a', 2)
    expect(lru.size).toBe(1)
    expect(lru.get('a')).toBe(2)
    lru.clear()
    expect(lru.size).toBe(0)
  })

  it('tells onEvict about the values pushed out and replaced, not about the ones cleared', () => {
    const evicted: [string, number][] = []
    const lru = createLru<string, number>(2, (value, key) => evicted.push([key, value]))
    lru.set('a', 1)
    lru.set('b', 2)
    lru.set('c', 3) // pushes a out
    lru.set('b', 20) // replaces
    lru.set('b', 20) // the same value again: nothing leaves
    expect(evicted).toEqual([
      ['a', 1],
      ['b', 2],
    ])
    lru.clear()
    expect(evicted).toHaveLength(2)
  })
})
