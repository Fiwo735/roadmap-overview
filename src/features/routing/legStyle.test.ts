import { describe, expect, it } from 'vitest'
import { CASING_EDGE, haloDash, MODES } from '../../lib/modes'
import { ERROR_COLOR, LOADING_COLOR, legStyle, type LegStyleInput } from './legStyle'

const base: LegStyleInput = { mode: 'drive', straight: false, status: 'ok', hovered: false, selected: false }

describe('legStyle', () => {
  it('draws a routed leg in its mode colour with a darker casing beneath', () => {
    const { line, casing } = legStyle(base)
    expect(line).toMatchObject({ color: MODES.drive.color, weight: MODES.drive.weight })
    expect(casing).toMatchObject({ color: MODES.drive.casing })
    expect(casing!.weight).toBeGreaterThan(line.weight!)
  })

  it('has no casing for modes without one', () => {
    expect(legStyle({ ...base, mode: 'flight' }).casing).toBeNull()
  })

  it('gives dashed modes a light, dashed halo (open gaps) and the solid drive line a dark solid casing', () => {
    for (const mode of ['ferry', 'train'] as const) {
      const { line, casing } = legStyle({ ...base, mode })
      const halo = haloDash(MODES[mode].dashArray!)!
      expect(casing).toMatchObject({ color: '#ffffff', lineCap: 'butt', dashArray: halo.dashArray, dashOffset: String(halo.dashOffset) })
      expect(casing!.weight).toBe(line.weight! + 2 * CASING_EDGE)
    }
    const drive = legStyle(base).casing!
    expect(drive).toMatchObject({ color: MODES.drive.casing, lineCap: 'round' })
    expect(drive.dashArray).toBeUndefined()
    expect(drive.dashOffset).toBeUndefined()
  })

  it('thickens on hover and a little more when selected', () => {
    const plain = legStyle(base).line.weight!
    const hovered = legStyle({ ...base, hovered: true }).line.weight!
    const selected = legStyle({ ...base, selected: true, hovered: true }).line.weight!
    expect(hovered).toBeGreaterThan(plain)
    expect(selected).toBeGreaterThan(hovered)
  })

  it('shows loading as a thin grey dashed line and failure as a red dashed one, never cased', () => {
    const loading = legStyle({ ...base, status: 'loading' })
    expect(loading.casing).toBeNull()
    expect(loading.line).toMatchObject({ color: LOADING_COLOR, dashArray: '6 8' })
    expect(loading.line.weight).toBeLessThan(MODES.drive.weight)
    const error = legStyle({ ...base, status: 'error' })
    expect(error.casing).toBeNull()
    expect(error.line).toMatchObject({ color: ERROR_COLOR })
    expect(error.line.dashArray).toBeTruthy()
  })

  it('draws a straight drive leg dotted, and other modes with their own dashes', () => {
    const straight = legStyle({ ...base, straight: true })
    expect(straight.line).toMatchObject({ color: MODES.drive.color, dashArray: '1 9', lineCap: 'round' })
    expect(straight.casing).toBeNull()
    expect(legStyle({ ...base, mode: 'ferry' }).line.dashArray).toBe(MODES.ferry.dashArray)
  })

  it('clears the dash of a solid line explicitly, so a restyle from dashed to solid does not keep it', () => {
    expect(legStyle(base).line.dashArray).toBeUndefined()
  })

  it("keeps drawing a leg's previous route, faded and in its own style, while the new one loads", () => {
    const fresh = legStyle(base)
    const stale = legStyle({ ...base, status: 'loading', stale: true })
    expect(stale.line.color).toBe(MODES.drive.color)
    expect(stale.line.dashArray).toBeUndefined()
    expect(stale.line.opacity).toBeLessThan(fresh.line.opacity!)
    expect(stale.casing).not.toBeNull()
    expect(stale.casing!.opacity).toBeLessThan(1)
    // Without a previous route it is still the grey placeholder.
    expect(legStyle({ ...base, status: 'loading', stale: false }).line.color).toBe(LOADING_COLOR)
    // A failure is shown as such, previous route or not.
    expect(legStyle({ ...base, status: 'error', stale: true }).line.color).toBe(ERROR_COLOR)
  })
})
