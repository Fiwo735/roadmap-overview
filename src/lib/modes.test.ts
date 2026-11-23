import { describe, expect, it } from 'vitest'
import { CASING_EDGE, haloDash, MODES } from './modes'

describe('haloDash', () => {
  it('grows each dash by the edge at both ends, shrinks the gaps to match and starts the pattern early', () => {
    expect(haloDash('10 8', 2)).toEqual({ dashArray: '14 4', dashOffset: 2 })
    expect(haloDash('2 7', 2)).toEqual({ dashArray: '6 3', dashOffset: 2 })
  })

  it('keeps the pattern period (dash + gap) so the halo stays aligned with its dashes', () => {
    for (const mode of ['ferry', 'train'] as const) {
      const [dash, gap] = MODES[mode].dashArray!.split(' ').map(Number)
      const [haloDashLength, haloGap] = haloDash(MODES[mode].dashArray!)!.dashArray.split(' ').map(Number)
      expect(haloDashLength + haloGap).toBe(dash + gap)
      expect(haloDashLength).toBe(dash + 2 * CASING_EDGE)
    }
  })

  it('never closes a gap completely, and gives up (solid casing) on patterns it cannot read', () => {
    expect(haloDash('4 2', 2)).toEqual({ dashArray: '8 1', dashOffset: 2 })
    for (const bad of ['', '5', '1 2 3', 'a b', '0 4', '-1 4']) expect(haloDash(bad)).toBeNull()
  })

  it('dashed modes are cased in white, so the halo reads on any tile; solid drive keeps its dark outline', () => {
    expect(MODES.ferry.casing).toBe('#ffffff')
    expect(MODES.train.casing).toBe('#ffffff')
    expect(MODES.flight.casing).toBeNull()
    expect(MODES.drive.casing).toBe('#0b4fb3')
  })
})
