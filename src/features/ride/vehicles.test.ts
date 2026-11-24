import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VEHICLE_KINDS, VEHICLES } from '../../lib/vehicles'
import type { LegMode } from '../../types/trip'
import { VEHICLE_ANCHOR, VEHICLE_BOX, VEHICLE_DRAW_WIDTH, drawTransport, drawVehicle, pictureBox, shapeCacheSize, transportSvg, vehicleSvg, type VehicleContext } from './vehicles'

const MODES: LegMode[] = ['drive', 'ferry', 'train', 'flight']
const count = (text: string, part: string) => text.split(part).length - 1

describe('vehicleSvg', () => {
  it.each(VEHICLE_KINDS)('draws %s as a well-formed picture, 40 units high, with turning wheels', (kind) => {
    const svg = vehicleSvg({ kind })
    expect(svg.startsWith('<svg class="ride-art"')).toBe(true)
    expect(svg).toContain(`viewBox="0 0 ${pictureBox('drive', { kind }).width} ${VEHICLE_BOX.height}"`)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(count(svg, '<g ')).toBe(count(svg, '</g>'))
    expect(svg).not.toMatch(/NaN|undefined|null|Infinity/)
    expect(count(svg, 'class="ride-wheel"')).toBeGreaterThanOrEqual(2)
    expect(count(svg, '<path')).toBeGreaterThan(10)
    // Every path has data and every attribute is quoted.
    for (const d of svg.matchAll(/ d="([^"]*)"/g)) expect(d[1].length).toBeGreaterThan(4)
  })

  it.each(VEHICLE_KINDS)('draws %s at the same scale as every other vehicle: 56 / 64 px per unit, 35 px high', (kind) => {
    const svg = vehicleSvg({ kind })
    const units = +/viewBox="0 0 ([\d.]+) 40"/.exec(svg)![1]
    expect(+/ width="([\d.]+)"/.exec(svg)![1]).toBeCloseTo((units * VEHICLE_DRAW_WIDTH) / VEHICLE_BOX.width, 2)
    expect(+/ height="([\d.]+)"/.exec(svg)![1]).toBeCloseTo(35, 5)
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
    for (const kind of VEHICLE_KINDS) {
      expect(vehicleSvg({ kind, color: '#ff00aa' })).toContain('#ff00aa')
      expect(vehicleSvg({ kind, color: '#ff00aa' })).not.toBe(vehicleSvg({ kind }))
    }
  })


  it('mirrors for west and never rotates', () => {
    const east = vehicleSvg({ kind: 'iveco-daily' }, 'east')
    const west = vehicleSvg({ kind: 'iveco-daily' }, 'west')
    expect(east).not.toContain('scale(-1 1)')
    expect(west).toContain(`translate(${pictureBox('drive', { kind: 'iveco-daily' }).width} 0) scale(-1 1)`)
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

describe('the Campervan (kind iveco-daily)', () => {
  const own = VEHICLES['iveco-daily'].defaultColor
  const van = (color?: string) => vehicleSvg({ kind: 'iveco-daily', color })

  it('is black by default and takes any colour', () => {
    expect(own).toBe('#15181d')
    expect(van()).toContain(`fill="${own}"`)
    expect(van()).toBe(van(own))
    expect(van('#ff00aa')).toContain('fill="#ff00aa"')
    expect(van('#ff00aa')).not.toContain(`fill="${own}"`)
    expect(van('#FF00AA')).toBe(van('#ff00aa'))
  })

  it('paints the body only: the colour is the one fill that changes between colours of the same brightness', () => {
    // Two dark and two light colours share their highlights, so swapping the colour text swaps nothing else.
    expect(van('#7a1010').replaceAll('#7a1010', own)).toBe(van())
    expect(van('#f4f1e8').replaceAll('#f4f1e8', '#c5ccd6')).toBe(van('#c5ccd6'))
    expect(van('#ff00aa').match(/#ff00aa/g)).toHaveLength(1)
  })

  it('keeps glass, wheels and lights as they are in every colour', () => {
    for (const color of [undefined, '#ffffff', '#d4382c', '#2f6fd1']) {
      const svg = van(color)
      for (const part of ['#1b2638', '#0b0d10', '#aab2be', '#f3f4f6', '#dc2626']) expect(svg).toContain(part)
      expect(count(svg, 'class="ride-wheel"')).toBe(2)
    }
  })

  it('has the highlights of a dark body on black and the creases of a light one on white', () => {
    expect(van()).toContain('stroke="#ffffff"')
    expect(van('#ffffff')).not.toContain('stroke="#ffffff"')
  })

  /** The extent of absolute path data (M, H, V, L, Q). */
  function extent(d: string) {
    const xs: number[] = []
    const ys: number[] = []
    for (const [, cmd, args] of d.matchAll(/([MHVLQZ])([^MHVLQZ]*)/g)) {
      const v = args.trim().split(/[\s,]+/).filter(Boolean).map(Number)
      if (cmd === 'H') xs.push(v[0])
      else if (cmd === 'V') ys.push(v[0])
      else if (cmd === 'M' || cmd === 'L') {
        xs.push(v[0])
        ys.push(v[1])
      } else if (cmd === 'Q') {
        xs.push(v[2])
        ys.push(v[3])
      }
    }
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
  }

  const wheelsOf = (svg: string) =>
    [...svg.matchAll(/class="ride-wheel" style="transform-origin:([\d.]+)px ([\d.]+)px"><path d="M([\d.]+) [\d.]+a([\d.]+)/g)]
      .map((m) => ({ cx: +m[1], cy: +m[2], r: +m[4] }))
      .sort((a, b) => a.cx - b.cx)

  it('is long: wider than the standard box, at the standard scale, and centred on its anchor', () => {
    const box = pictureBox('drive', { kind: 'iveco-daily' })
    expect(box.height).toBe(VEHICLE_BOX.height)
    expect(box.width).toBeGreaterThanOrEqual(78)
    expect(box.width).toBeLessThanOrEqual(84)
    const svg = van()
    expect(svg).toContain(`viewBox="0 0 ${box.width} 40"`)
    expect(svg).toContain(`style="--units:${box.width}"`)
    expect(svg).toContain(`width="${(box.width * 56) / 64}" height="35"`)
    // The body is centred in its box, so the marker's centre (the anchor) is the van's centre and mirroring stays in place.
    const { left, right } = extent(/<path d="([^"]+)" fill="#15181d"/.exec(svg)![1])
    expect((left + right) / 2).toBeCloseTo(box.width / 2, 0)
  })

  it('is a real L4: a long wheelbase and a long tail, about 2.5 times as long as it is high', () => {
    const svg = van('#7a1010')
    const body = extent(/<path d="([^"]+)" fill="#7a1010"/.exec(svg)![1])
    const [rear, front] = wheelsOf(svg)
    expect(rear && front).toBeTruthy()
    const wheelbase = front.cx - rear.cx
    const tailBeyondTyre = rear.cx - rear.r - body.left
    // As long a wheelbase as the old van had (36) or longer, and a tail of about a quarter of it or more beyond the rear tyre
    // (the old tail was about 0.14 of its wheelbase).
    expect(wheelbase).toBeGreaterThanOrEqual(40)
    expect(tailBeyondTyre).toBeGreaterThanOrEqual(wheelbase * 0.25)
    expect(tailBeyondTyre).toBeGreaterThan(body.right - (front.cx + front.r))
    // Overall length against height (roof to the ground under the wheels).
    const ratio = (body.right - body.left) / (rear.cy + rear.r - body.top)
    expect(ratio).toBeGreaterThanOrEqual(2.4)
    expect(ratio).toBeLessThanOrEqual(2.6)
  })

  it('keeps its wheels on the line and everything inside its box', () => {
    const svg = van('#7a1010')
    const box = pictureBox('drive', { kind: 'iveco-daily' })
    const body = extent(/<path d="([^"]+)" fill="#7a1010"/.exec(svg)![1])
    expect(body.left).toBeGreaterThanOrEqual(0)
    expect(body.right).toBeLessThanOrEqual(box.width)
    const wheels = wheelsOf(svg)
    expect(wheels).toHaveLength(2)
    // The standard van's wheels stand on the same line.
    const [car] = wheelsOf(vehicleSvg({ kind: 'campervan' }))
    for (const w of wheels) expect(w.cy + w.r).toBeCloseTo(car.cy + car.r, 0)
    expect(wheels[0].cy + wheels[0].r).toBeCloseTo(36.8, 1)
  })
})

describe('pictureBox', () => {
  it('is the standard 64 × 40 for every vehicle but the Campervan, and for the ferry, train and plane', () => {
    for (const kind of VEHICLE_KINDS.filter((k) => k !== 'iveco-daily')) expect(pictureBox('drive', { kind })).toEqual(VEHICLE_BOX)
    expect(pictureBox('drive', undefined)).toEqual(VEHICLE_BOX)
    for (const mode of ['ferry', 'train', 'flight'] as const) expect(pictureBox(mode, { kind: 'iveco-daily' })).toEqual(VEHICLE_BOX)
    expect(pictureBox('drive', { kind: 'iveco-daily' }).width).toBeGreaterThan(VEHICLE_BOX.width)
  })

  it('does not depend on the colour', () => {
    expect(pictureBox('drive', { kind: 'iveco-daily', color: '#ff00aa' })).toEqual(pictureBox('drive', { kind: 'iveco-daily' }))
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

  it('draws the long Campervan at the same scale, centred on its own anchor, so it comes out wider', () => {
    const { ctx, calls } = fakeContext()
    drawVehicle(ctx, { kind: 'iveco-daily' }, 100, 80, 'east', 128)
    expect(named(calls, 'translate')[0]).toEqual(['translate', 100, 80])
    expect(named(calls, 'scale')[0]).toEqual(['scale', 2, 2])
    expect(named(calls, 'translate')[1]).toEqual(['translate', -pictureBox('drive', { kind: 'iveco-daily' }).width / 2, -VEHICLE_ANCHOR.y])
    // Mirrored, the middle stays where it is.
    const west = fakeContext()
    drawVehicle(west.ctx, { kind: 'iveco-daily' }, 100, 80, 'west', 128)
    expect(named(west.calls, 'scale')[0]).toEqual(['scale', -2, 2])
    expect(named(west.calls, 'translate')[1]).toEqual(named(calls, 'translate')[1])
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

  it('draws the halo when asked, behind the vehicle, and switches the glow off again', () => {
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

  describe('the halo left to itself', () => {
    const glows = (draw: (ctx: VehicleContext) => void): boolean => {
      const { ctx, calls } = fakeContext()
      draw(ctx)
      return named(calls, 'fill').some((c) => (c[2] as { shadowBlur: number }).shadowBlur > 0)
    }

    it('lights a dark body, so a black campervan stays visible on dark tiles', () => {
      expect(glows((ctx) => drawVehicle(ctx, { kind: 'iveco-daily' }, 0, 0))).toBe(true)
      expect(glows((ctx) => drawVehicle(ctx, { kind: 'iveco-daily', color: '#1a2a6c' }, 0, 0))).toBe(true)
      expect(glows((ctx) => drawVehicle(ctx, { kind: 'retro-bus', color: '#15181d' }, 0, 0))).toBe(true)
      expect(glows((ctx) => drawTransport(ctx, 'drive', { kind: 'iveco-daily' }, 0, 0))).toBe(true)
    })

    it('leaves a light or coloured body alone', () => {
      expect(glows((ctx) => drawVehicle(ctx, undefined, 0, 0))).toBe(false)
      expect(glows((ctx) => drawVehicle(ctx, { kind: 'iveco-daily', color: '#ffffff' }, 0, 0))).toBe(false)
      expect(glows((ctx) => drawVehicle(ctx, { kind: 'iveco-daily', color: '#d4382c' }, 0, 0))).toBe(false)
    })

    it('does not light a ferry, train or plane, whatever the trip\'s vehicle', () => {
      for (const mode of ['ferry', 'train', 'flight'] as const) expect(glows((ctx) => drawTransport(ctx, mode, { kind: 'iveco-daily' }, 0, 0))).toBe(false)
    })

    it('obeys the caller: true and false force it either way', () => {
      expect(glows((ctx) => drawVehicle(ctx, { kind: 'iveco-daily' }, 0, 0, 'east', 56, { halo: false }))).toBe(false)
      expect(glows((ctx) => drawVehicle(ctx, undefined, 0, 0, 'east', 56, { halo: true }))).toBe(true)
      expect(glows((ctx) => drawTransport(ctx, 'ferry', undefined, 0, 0, 'east', 56, { halo: true }))).toBe(true)
      expect(glows((ctx) => drawTransport(ctx, 'drive', { kind: 'iveco-daily' }, 0, 0, 'east', 56, { halo: false }))).toBe(false)
    })
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
