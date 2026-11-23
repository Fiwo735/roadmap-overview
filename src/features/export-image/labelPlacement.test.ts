import { describe, expect, it } from 'vitest'
import type { Rect } from './geometry'
import { placeLabels, type LabelRequest } from './labelPlacement'

const bounds: Rect = { x: 0, y: 0, width: 1000, height: 600 }
const options = { bounds, offset: 6, gap: 2 }
const req = (id: string, x: number, y: number, width = 100): LabelRequest => ({ id, anchor: { x, y }, radius: 15, width, height: 22 })

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('placeLabels', () => {
  it('puts a label to the right of its marker, clear of it, vertically centred', () => {
    const [label] = [...placeLabels([req('a', 300, 300)], options).values()]
    expect(label.side).toBe('right')
    expect(label.rect).toEqual({ x: 300 + 15 + 6, y: 300 - 11, width: 100, height: 22 })
  })

  it('flips to the left at the right edge of the image', () => {
    const [label] = [...placeLabels([req('a', 950, 300)], options).values()]
    expect(label.side).toBe('left')
    expect(label.rect.x + label.rect.width).toBeLessThanOrEqual(950 - 15)
  })

  it('goes above or below when neither side has room', () => {
    // A tall, narrow image: 100 px label does not fit left or right of a marker in the middle.
    const narrow: Rect = { x: 0, y: 0, width: 120, height: 600 }
    const [label] = [...placeLabels([req('a', 60, 300)], { ...options, bounds: narrow }).values()]
    expect(label.side).toBe('top')
    expect(label.rect.x).toBeCloseTo(10)
  })

  it('keeps clear of obstacles', () => {
    const card: Rect = { x: 320, y: 280, width: 200, height: 100 }
    const placed = placeLabels([req('a', 300, 300)], { ...options, obstacles: [card] })
    const label = placed.get('a')
    expect(label?.side).not.toBe('right')
    expect(label && overlap(label.rect, card)).toBeFalsy()
  })

  it('never lets a label cover a marker, its own or another', () => {
    const requests = [req('a', 300, 300), req('b', 440, 300), req('c', 300, 340)]
    const placed = placeLabels(requests, options)
    for (const label of placed.values()) {
      for (const r of requests) {
        const dx = Math.max(label.rect.x - r.anchor.x, 0, r.anchor.x - (label.rect.x + label.rect.width))
        const dy = Math.max(label.rect.y - r.anchor.y, 0, r.anchor.y - (label.rect.y + label.rect.height))
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(r.radius)
      }
    }
  })

  it('never lets two labels overlap, and serves the earlier request first', () => {
    // Two stops one above the other: both want the right-hand side, the first one gets it.
    const placed = placeLabels([req('first', 300, 300, 200), req('second', 300, 316, 200)], options)
    const [first, second] = [placed.get('first'), placed.get('second')]
    expect(first?.side).toBe('right')
    expect(second?.side).toBe('left')
    expect(first && second && overlap(first.rect, second.rect)).toBe(false)
  })

  it('leaves a label out when it fits nowhere', () => {
    const tiny: Rect = { x: 0, y: 0, width: 60, height: 40 }
    expect(placeLabels([req('a', 30, 20, 200)], { ...options, bounds: tiny }).size).toBe(0)
  })

  it('keeps every label inside the bounds', () => {
    const requests = Array.from({ length: 30 }, (_, i) => req(`p${i}`, 20 + ((i * 97) % 960), 20 + ((i * 53) % 560), 80 + (i % 5) * 20))
    for (const { rect } of placeLabels(requests, options).values()) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(1000)
      expect(rect.y + rect.height).toBeLessThanOrEqual(600)
    }
  })
})
