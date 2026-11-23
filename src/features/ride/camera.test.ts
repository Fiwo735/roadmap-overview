import { describe, expect, it } from 'vitest'
import { comfortBox, glideOffset, insideBox, inView, medianOf, nextFacing } from './camera'

describe('comfortBox', () => {
  it('is the middle of the view, short of the controls at the bottom', () => {
    const box = comfortBox(1000, 800, 180)
    expect(box.left).toBeCloseTo(300)
    expect(box.right).toBeCloseTo(700)
    expect(box.top).toBeCloseTo(200)
    expect(box.bottom).toBeCloseTo(800 - 236)
  })

  it('collapses to a line on a view too small for the controls', () => {
    const box = comfortBox(400, 200, 180)
    expect(box.top).toBe(box.bottom)
    expect(box.top).toBeGreaterThan(0)
    expect(box.top).toBeLessThan(200)
  })
})

describe('insideBox', () => {
  const box = { left: 300, top: 200, right: 700, bottom: 600 }

  it('tells inside (edges included) from outside', () => {
    expect(insideBox({ x: 500, y: 400 }, box)).toBe(true)
    expect(insideBox({ x: 300, y: 600 }, box)).toBe(true)
    expect(insideBox({ x: 299, y: 400 }, box)).toBe(false)
    expect(insideBox({ x: 500, y: 601 }, box)).toBe(false)
  })
})

describe('glideOffset', () => {
  const box = { left: 300, top: 200, right: 700, bottom: 600 }
  const after = (van: { x: number; y: number }, ahead: { x: number; y: number }) => {
    const o = glideOffset(van, ahead, box)
    return { x: ahead.x - o.x, y: ahead.y - o.y }
  }

  it('puts a parked van in the middle of the box', () => {
    const van = { x: 750, y: 300 }
    expect(after(van, van)).toEqual({ x: 500, y: 400 })
  })

  it('pans towards the van: the map moves the way the van left the box', () => {
    const o = glideOffset({ x: 750, y: 400 }, { x: 750, y: 400 }, box)
    expect(o.x).toBeGreaterThan(0)
    expect(o.y).toBe(0)
    expect(glideOffset({ x: 100, y: 400 }, { x: 100, y: 400 }, box).x).toBeLessThan(0)
  })

  it('leans a moving van back against its direction of travel, well inside the box', () => {
    // Leaving to the right, 150 px of travel while the map glides.
    const end = after({ x: 700, y: 400 }, { x: 850, y: 400 })
    expect(end.x).toBeLessThan(500)
    expect(end.x).toBeGreaterThan(box.left + 40)
    expect(end.y).toBe(400)
    // Leaving at the bottom, travelling up-left: leans down and right.
    const up = after({ x: 500, y: 600 }, { x: 420, y: 560 })
    expect(up.x).toBeGreaterThan(500)
    expect(up.y).toBeGreaterThan(400)
    expect(insideBox(up, box)).toBe(true)
  })

  it('never lets a very fast van end beyond the lean limit', () => {
    const end = after({ x: 700, y: 400 }, { x: 5000, y: 400 })
    expect(end.x).toBeCloseTo(500 - 0.6 * 200)
    expect(insideBox(end, box)).toBe(true)
  })

  it('copes with a box collapsed to a line', () => {
    const line = { left: 300, top: 300, right: 700, bottom: 300 }
    const o = glideOffset({ x: 500, y: 450 }, { x: 540, y: 450 }, line)
    expect(Number.isFinite(o.x) && Number.isFinite(o.y)).toBe(true)
    expect(450 - o.y).toBe(300)
  })

  it('leaves a gap of whole box widths between glides for a van at screen speed', () => {
    // A van crossing 3 px a frame needs ~(0.6 + 1) * 200 / 3 frames to come back out of the box.
    const end = after({ x: 700, y: 400 }, { x: 700 + 3 * 60, y: 400 })
    const framesToExit = (box.right - end.x) / 3
    expect(framesToExit).toBeGreaterThan(60)
  })
})

describe('inView', () => {
  it('tells inside from outside', () => {
    expect(inView({ x: 10, y: 10 }, 100, 100)).toBe(true)
    expect(inView({ x: -1, y: 10 }, 100, 100)).toBe(false)
    expect(inView({ x: 10, y: 101 }, 100, 100)).toBe(false)
  })
})

describe('medianOf', () => {
  it('picks the middle value, the lower one of two, and nothing from nothing', () => {
    expect(medianOf([9, 3, 7])).toBe(7)
    expect(medianOf([8, 6, 10, 12])).toBe(8)
    expect(medianOf([5])).toBe(5)
    expect(medianOf([])).toBeNull()
  })
})

describe('nextFacing', () => {
  it('starts out facing the way it heads', () => {
    expect(nextFacing(null, 80)).toBe('east')
    expect(nextFacing(null, 280)).toBe('west')
    expect(nextFacing(null, 0)).toBe('east')
  })

  it('never turns for a heading near the vertical, only once clearly the other way', () => {
    expect(nextFacing('east', 350)).toBe('east')
    expect(nextFacing('east', 190)).toBe('east')
    expect(nextFacing('east', 260)).toBe('west')
    expect(nextFacing('west', 10)).toBe('west')
    expect(nextFacing('west', 170)).toBe('west')
    expect(nextFacing('west', 100)).toBe('east')
  })

  it('does not flip-flop on a road that wiggles about north', () => {
    let facing = nextFacing(null, 95)
    const flips: string[] = []
    for (const h of [10, 355, 5, 350, 8, 359, 12, 345, 3]) {
      const next = nextFacing(facing, h)
      if (next !== facing) flips.push(next)
      facing = next
    }
    expect(flips).toEqual([])
  })
})
