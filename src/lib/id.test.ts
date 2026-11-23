import { describe, expect, it } from 'vitest'
import { newId } from './id'

describe('newId', () => {
  it('produces distinct ids', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId()))
    expect(ids.size).toBe(2000)
  })

  it('applies the prefix', () => {
    expect(newId('p')).toMatch(/^p_[0-9a-z]{10}$/)
    expect(newId()).toMatch(/^[0-9a-z]{10}$/)
  })
})
