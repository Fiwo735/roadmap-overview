import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VEHICLE_KINDS, VEHICLES } from '../../lib/vehicles'
import type { LegMode } from '../../types/trip'
import { VEHICLE_ANCHOR, VEHICLE_BOX, drawTransport, drawVehicle, shapeCacheSize, transportSvg, vehicleSvg, type VehicleContext } from './vehicles'

const MODES: LegMode[] = ['drive', 'ferry', 'train', 'flight']
const count = (text: string, part: string) => text.split(part).length - 1

describe('vehicleSvg', () => {
  it.each(VEHICLE_KINDS)('draws %s as a well-formed 64 × 40 picture with turning wheels', (kind) => {
    const svg = vehicleSvg({ kind })
    expect(svg.startsWith('<svg class="ride-art"')).toBe(true)
    expect(svg).toContain(`viewBox="0 0 ${VEHICLE_BOX.width} ${VEHICLE_BOX.height}"`)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(count(svg, '<g ')).toBe(count(svg, '</g>'))
    expect(svg).not.toMatch(/NaN|undefined|null|Infinity/)
    expect(count(svg, 'class="ride-wheel"')).toBeGreaterThanOrEqual(2)
    expect(count(svg, '<path')).toBeGreaterThan(10)
    // Every path has data and every attribute is quoted.
    for (const d of svg.matchAll(/ d="([^"]*)"/g)) expect(d[1].length).toBeGreaterThan(4)
  })

  it('draws a different picture for every vehicle', () => {
    const pictures = VEHICLE_KINDS.map((kind) => vehicleSvg({ kind }))
    expect(new Set(pictures).size).toBe(VEHICLE_KINDS.length)
  })

  it('is the campervan when there is no vehicle, or an unusable one', () => {
    expect(vehicleSvg(undefined)).toBe(vehicleSvg({ kind: 'campervan' }))
    expect(vehicleSvg({ kind: 'hovercraft' as never })).toBe(vehicleSvg({ kind: 'campervan' }))
    expect(vehicleSvg({ kind: 'campervan', color: 'blue' })).toBe(vehicleSvg({ kind: 'campervan' }))
  })

  it('paints the body in the chosen colour, in any spelling', () => {
    expect(vehicleSvg({ kind: 'retro-bus', color: '#d4382c' })).toContain('#d4382c')
    expect(vehicleSvg({ kind: 'retro-bus', color: '#D4382C' })).toBe(vehicleSvg({ kind: 'retro-bus', color: '#d4382c' }))
    for (const kind of VEHICLE_KINDS.filter((k) => VEHICLES[k].colorable)) {
      expect(vehicleSvg({ kind, color: '#ff00aa' })).toContain('#ff00aa')
      expect(vehicleSvg({ kind, color: '#ff00aa' })).not.toBe(vehicleSvg({ kind }))
    }
  })

  it('keeps the Daily black whatever colour is asked for', () => {
    expect(vehicleSvg({ kind: 'iveco-daily', color: '#ff00aa' })).toBe(vehicleSvg({ kind: 'iveco-daily' }))
    expect(vehicleSvg({ kind: 'iveco-daily' })).toContain(VEHICLES['iveco-daily'].defaultColor)
    expect(vehicleSvg({ kind: 'iveco-daily' })).not.toContain('#ff00aa')
  })

  it('mirrors for west and never rotates', () => {
    const east = vehicleSvg({ kind: 'iveco-daily' }, 'east')
    const west = vehicleSvg({ kind: 'iveco-daily' }, 'west')
    expect(east).not.toContain('scale(-1 1)')
    expect(west).toContain(`translate(${VEHICLE_BOX.width} 0) scale(-1 1)`)
    expect(west).not.toContain('rotate')
    expect(vehicleSvg({ kind: 'iveco-daily' })).toBe(east)
  })

  it('is stable: the same call gives the same picture', () => {
    expect(vehicleSvg({ kind: 'motorhome', color: '#123456' })).toBe(vehicleSvg({ kind: 'motorhome', color: '#123456' }))
  })

  it('keeps a bounded number of looks however many colours are tried (a drag in the picker)', () => {
    for (let i = 0; i < 300; i++) vehicleSvg({ kind: 'campervan', color: `#${(i * 4099 + 0x100000).toString(16).slice(-6)}` })
    expect(shapeCacheSize()).toBeLessThanOrEqual(24)
    expect(shapeCacheSize()).toBeGreaterThan(0)
    // The look in use is still drawn right after the trial colours are gone.
    expect(vehicleSvg({ kind: 'campervan', color: '#abcdef' })).toContain('#abcdef')
  })
})

describe('transportSvg', () => {
  it('draws the trip\'s vehicle on the road and the ferry, train and plane otherwise', () => {
    const pictures = MODES.map((mode) => transportSvg(mode, { kind: 'iveco-daily' }))
    expect(new Set(pictures).size).toBe(MODES.length)
    expect(transportSvg('drive', { kind: 'iveco-daily' })).toBe(vehicleSvg({ kind: 'iveco-daily' }))
    expect(transportSvg('drive', undefined)).toBe(vehicleSvg(undefined))
  })

  it('leaves ferries, trains and planes as they are, whatever the vehicle', () => {
    for (const mode of ['ferry', 'train', 'flight'] as const) {
      expect(transportSvg(mode, { kind: 'offroad', color: '#ff00aa' })).toBe(transportSvg(mode, undefined))
      expect(count(transportSvg(mode), '<g ')).toBe(count(transportSvg(mode), '</g>'))
    }
    expect(transportSvg('ferry', undefined, 'west')).toContain('scale(-1 1)')
  })
})

// ---- The canvas --------------------------------------------------------------------------------

/** A context that records what it was asked to do (node has no canvas). */
function fakeContext() {
  const calls: Array<[string, ...unknown[]]> = []
  const state: Record<string, unknown> = { globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)', lineJoin: 'miter', lineCap: 'butt' }
  const stack: Array<Record<string, unknown>> = []
  const ctx = new Proxy(
    {},
    {
      get(_t, name: string) {
        if (name in state) return state[name]
        return (...args: unknown[]) => {
          if (name === 'save') stack.push({ ...state })
          if (name === 'restore') Object.assign(state, stack.pop())
          calls.push([name, ...args, name === 'fill' || name === 'stroke' ? { ...state } : undefined].filter((a) => a !== undefined) as [string, ...unknown[]])
        }
      },
      set(_t, name: string, value) {
        state[name] = value
        return true
      },
    },
  ) as unknown as VehicleContext
  return { ctx, calls, state, stack }
}

class FakePath2D {
  readonly d: string
  constructor(d: string) {
    this.d = d
  }
}

describe('drawVehicle', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', FakePath2D)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const named = (calls: Array<[string, ...unknown[]]>, name: string) => calls.filter((c) => c[0] === name)

  it.each(VEHICLE_KINDS)('paints %s: fills and strokes shapes between a balanced save and restore', (kind) => {
    const { ctx, calls, stack } = fakeContext()
    drawVehicle(ctx, { kind }, 100, 80)
    expect(named(calls, 'save').length).toBe(named(calls, 'restore').length)
    expect(stack).toHaveLength(0)
    expect(named(calls, 'fill').length).toBeGreaterThan(8)
    expect(named(calls, 'stroke').length).toBeGreaterThan(4)
    // Every wheel turns on its own: a rotate for each wheel.
    expect(named(calls, 'rotate').length).toBeGreaterThanOrEqual(2)
    for (const [, path] of [...named(calls, 'fill'), ...named(calls, 'stroke')]) expect(path).toBeInstanceOf(FakePath2D)
  })

  it('puts the wheels\' middle at (x, y) and scales the 64-wide box to the width asked for', () => {
    const { ctx, calls } = fakeContext()
    drawVehicle(ctx, undefined, 100, 80, 'east', 128)
    expect(named(calls, 'translate')[0]).toEqual(['translate', 100, 80])
    expect(named(calls, 'scale')[0]).toEqual(['scale', 2, 2])
    expect(named(calls, 'translate')[1]).toEqual(['translate', -VEHICLE_ANCHOR.x, -VEHICLE_ANCHOR.y])
  })

  it('draws 56 px wide unless told otherwise', () => {
    const { ctx, calls } = fakeContext()
    drawVehicle(ctx, undefined, 0, 0)
    expect(named(calls, 'scale')[0]).toEqual(['scale', 56 / 64, 56 / 64])
  })

  it('mirrors for west, with no rotation of the whole picture', () => {
    const { ctx, calls } = fakeContext()
    drawVehicle(ctx, { kind: 'iveco-daily' }, 10, 10, 'west', 64)
    expect(named(calls, 'scale')[0]).toEqual(['scale', -1, 1])
    // The only rotations are the wheels', about their own centres (translate, rotate 0, translate back).
    for (const [, angle] of named(calls, 'rotate')) expect(angle).toBe(0)
  })

  it('turns the wheels by the angle given', () => {
    const { ctx, calls } = fakeContext()
    drawVehicle(ctx, undefined, 0, 0, 'east', 56, { wheelAngle: 1.25 })
    const angles = named(calls, 'rotate').map((c) => c[1])
    expect(angles.length).toBeGreaterThanOrEqual(2)
    expect(new Set(angles)).toEqual(new Set([1.25]))
  })

  it('paints in the vehicle\'s colour', () => {
    const { ctx, calls } = fakeContext()
    drawVehicle(ctx, { kind: 'motorhome', color: '#ff00aa' }, 0, 0)
    const fills = named(calls, 'fill').map((c) => (c[2] as { fillStyle: string }).fillStyle)
    expect(fills).toContain('#ff00aa')
  })

  it('draws the halo only when asked, behind the vehicle, and switches the glow off again', () => {
    const plain = fakeContext()
    drawVehicle(plain.ctx, undefined, 0, 0)
    expect(named(plain.calls, 'fill').some((c) => (c[2] as { shadowBlur: number }).shadowBlur > 0)).toBe(false)

    const haloed = fakeContext()
    drawVehicle(haloed.ctx, undefined, 0, 0, 'east', 56, { halo: true })
    const blurs = named(haloed.calls, 'fill').map((c) => (c[2] as { shadowBlur: number }).shadowBlur)
    expect(blurs[0]).toBeGreaterThan(0)
    expect(blurs[blurs.length - 1]).toBe(0)
    expect(named(haloed.calls, 'fill').length).toBeGreaterThan(named(plain.calls, 'fill').length)
  })

  it('multiplies the caller\'s opacity into every shape, so the whole vehicle can fade, and gives it back', () => {
    const { ctx, calls, state } = fakeContext()
    ctx.globalAlpha = 0.5
    drawVehicle(ctx, { kind: 'iveco-daily' }, 0, 0, 'east', 56, { halo: true })
    const alphas = [...named(calls, 'fill'), ...named(calls, 'stroke')].map((c) => (c[2] as { globalAlpha: number }).globalAlpha)
    expect(alphas.length).toBeGreaterThan(10)
    // Never more opaque than the caller asked for; shapes with an opacity of their own are fainter still.
    expect(Math.max(...alphas)).toBeCloseTo(0.5)
    expect(Math.min(...alphas)).toBeLessThan(0.5)
    expect(alphas.every((a) => a > 0 && a <= 0.5 + 1e-9)).toBe(true)
    expect(state.globalAlpha).toBe(0.5)

    const full = fakeContext()
    drawVehicle(full.ctx, { kind: 'iveco-daily' }, 0, 0)
    const opaque = [...named(full.calls, 'fill'), ...named(full.calls, 'stroke')].map((c) => (c[2] as { globalAlpha: number }).globalAlpha)
    expect(Math.max(...opaque)).toBe(1)
    // Half the opacity everywhere, nothing else changed.
    expect(alphas.length).toBeGreaterThanOrEqual(opaque.length)
  })

  it('leaves the context\'s styles as it found them, even when drawing fails', () => {
    const { ctx, state, stack } = fakeContext()
    drawVehicle(ctx, { kind: 'caravan' }, 5, 5, 'west', 40, { halo: true, wheelAngle: 2 })
    expect(state).toMatchObject({ globalAlpha: 1, lineWidth: 1, shadowBlur: 0, lineJoin: 'miter', lineCap: 'butt', fillStyle: '#000', strokeStyle: '#000' })
    expect(stack).toHaveLength(0)

    const broken = fakeContext()
    const ctx2 = new Proxy(broken.ctx, {
      get: (t, name: string) => (name === 'fill' ? () => { throw new Error('boom') } : Reflect.get(t, name)),
    })
    expect(() => drawVehicle(ctx2, undefined, 0, 0)).toThrow('boom')
    expect(broken.stack).toHaveLength(0)
  })

  it('draws ferries, trains and planes, and the trip\'s vehicle on the road', () => {
    for (const mode of MODES) {
      const { ctx, calls } = fakeContext()
      drawTransport(ctx, mode, { kind: 'offroad' }, 0, 0, 'west', 56)
      expect(named(calls, 'fill').length).toBeGreaterThan(5)
    }
    const a = fakeContext()
    const b = fakeContext()
    drawTransport(a.ctx, 'drive', { kind: 'offroad' }, 0, 0)
    drawVehicle(b.ctx, { kind: 'offroad' }, 0, 0)
    expect(a.calls).toEqual(b.calls)
  })

  it('makes one Path2D per shape and reuses it for the next frame', () => {
    const made: string[] = []
    vi.stubGlobal(
      'Path2D',
      class {
        constructor(d: string) {
          made.push(d)
        }
      },
    )
    const { ctx } = fakeContext()
    drawVehicle(ctx, { kind: 'offroad', color: '#abcdef' }, 0, 0)
    const first = made.length
    expect(first).toBeGreaterThan(10)
    drawVehicle(ctx, { kind: 'offroad', color: '#abcdef' }, 50, 50, 'west')
    expect(made.length).toBe(first)
  })
})
