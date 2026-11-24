import type { LegMode, TripVehicle, VehicleKind } from '../../types/trip'
import { createLru } from '../../lib/lru'
import { isDarkBody, lighten, luminance, mixColors, parseColor, resolveVehicle } from '../../lib/vehicles'
import type { Facing } from './camera'

/**
 * The little vehicles of the ride, drawn by hand as shapes in a box 40 units high and, as a rule, 64 wide: side
 * views facing east, with a dark outline and light or saturated bodies so they read on any tile. A vehicle that
 * is longer than the rest (the Campervan) has a wider box, drawn at the same scale per unit. One description serves both the page
 * (`vehicleSvg`: an SVG string for the ride's Leaflet icon and the picker) and a canvas (`drawVehicle`: the
 * same shapes painted with `Path2D`, for the picture and video export), so the two cannot drift apart. This
 * file knows nothing of React or Leaflet.
 *
 * Road stretches show the trip's own vehicle (`TripVehicle`: a kind and a body colour); ferries, trains
 * and flights keep theirs (`transportSvg` / `drawTransport` choose by the stretch's mode). Facing west
 * mirrors the picture, so a vehicle is never upside-down. Wheels carry `class="ride-wheel"` so CSS can spin
 * them while the vehicle moves; on a canvas `wheelAngle` turns them.
 */

export type { Facing }

/**
 * The standard box vehicles are drawn in (SVG user units). Every picture is 40 high; a longer one is wider
 * (`pictureBox`), at the same scale. Sizes in px always mean "this much for the standard 64-unit width".
 */
export const VEHICLE_BOX = { width: 64, height: 40 } as const
/** Where the vehicle touches its line (box units): the middle of the wheels, a little below the middle of the box (`x` is that of the standard box; a wider box has its own middle). */
export const VEHICLE_ANCHOR = { x: 32, y: 30.8 } as const
/** The width the ride draws the standard box at (px): every unit is 56 / 64 px, whatever the picture's own width. */
export const VEHICLE_DRAW_WIDTH = 56

/** Vehicles whose picture is wider than the standard box: the long-wheelbase Campervan, ≈ 2.5 times as long as it is high. */
const WIDE_BOX: Partial<Record<VehicleKind, number>> = { 'iveco-daily': 78 }

// ---- The shape model ----------------------------------------------------------------------------

interface Paint {
  fill?: string
  stroke?: string
  /** Stroke width; 2 by default. */
  sw?: number
  /** Opacity of the whole shape. */
  op?: number
}

interface PathShape extends Paint {
  d: string
  /** Part of the vehicle's outline: the canvas halo is drawn behind these. */
  hull?: boolean
}

/** A wheel: its parts turn together about `spin` (its centre). */
interface WheelShape {
  spin: readonly [number, number]
  parts: readonly PathShape[]
}

type Shape = PathShape | WheelShape

const INK = '#1f2937'
const GLASS = '#bae6fd'
const OUTLINE = { stroke: INK, sw: 2 } as const

/** Short numbers in path data. */
const n = (v: number): number => Math.round(v * 100) / 100

const path = (d: string, paint: Paint = {}, hull = false): PathShape => (hull ? { d, ...paint, hull } : { d, ...paint })

function rect(x: number, y: number, w: number, h: number, r: number, paint: Paint = {}): PathShape {
  const k = Math.min(r, w / 2, h / 2)
  const d = k
    ? `M${n(x + k)} ${n(y)}h${n(w - 2 * k)}a${n(k)} ${n(k)} 0 0 1 ${n(k)} ${n(k)}v${n(h - 2 * k)}a${n(k)} ${n(k)} 0 0 1 ${n(-k)} ${n(k)}h${n(-(w - 2 * k))}a${n(k)} ${n(k)} 0 0 1 ${n(-k)} ${n(-k)}v${n(-(h - 2 * k))}a${n(k)} ${n(k)} 0 0 1 ${n(k)} ${n(-k)}z`
    : `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`
  return path(d, paint)
}

const circle = (cx: number, cy: number, r: number, paint: Paint = {}): PathShape =>
  path(`M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0z`, paint)

/** A line (or several) drawn with the vehicle's outline pen. */
const line = (d: string, stroke: string, sw: number, op?: number): PathShape => path(d, op === undefined ? { stroke, sw } : { stroke, sw, op })

interface WheelStyle {
  tyre?: string
  rim?: string
  /** The hub and the spokes. */
  spoke?: string
  /** Lines through the hub: 1 is a bar, 3 a six-spoke rim. */
  spokes?: number
}

function wheel(cx: number, cy: number, r: number, { tyre = INK, rim = '#e2e8f0', spoke = INK, spokes = 1 }: WheelStyle = {}): WheelShape {
  const reach = spokes > 1 ? 0.46 : 0.8
  let bars = ''
  for (let i = 0; i < spokes; i++) {
    const a = (i * Math.PI) / spokes
    const [dx, dy] = [Math.sin(a) * r * reach, -Math.cos(a) * r * reach]
    bars += `M${n(cx - dx)} ${n(cy - dy)}L${n(cx + dx)} ${n(cy + dy)}`
  }
  const parts = [circle(cx, cy, r, { fill: tyre }), circle(cx, cy, r * 0.45 + (spokes > 1 ? 0.1 * r : 0), { fill: rim }), line(bars, spoke, spokes > 1 ? 1 : 1.2)]
  if (spokes > 1) parts.push(circle(cx, cy, r * 0.13, { fill: spoke }))
  return { spin: [cx, cy], parts }
}

/** `preferred`, unless the body is about that colour (a blue stripe on a blue car), then white or ink. */
function accentFor(body: string, preferred: string): string {
  const [a, b] = [parseColor(body), parseColor(preferred)]
  if (!a || !b) return preferred
  const distance = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
  if (distance > 90) return preferred
  return luminance(body) > 0.5 ? INK : '#ffffff'
}

/** A body colour's lighter or darker tone for roofs and panels: darker for light colours, lighter for dark ones. */
const toneOf = (color: string): string => (luminance(color) > 0.8 ? mixColors(color, '#94a3b8', 0.12) : lighten(color, 0.16))

// ---- Road vehicles -------------------------------------------------------------------------------

/** The original campervan: a white high-top with a coloured stripe. */
function campervan(color: string): Shape[] {
  const body = 'M5 30V14.5Q5 10 9.5 10H37.5L51 20.5Q59 21.5 60.5 26V30Z'
  return [
    path(body, { fill: color, ...OUTLINE }, true),
    path('M14 10V7.2Q14 5 16.2 5H31.8Q34 5 34 7.2V10', { fill: toneOf(color), ...OUTLINE }),
    path('M5.5 21H55Q59 21.5 60.5 25.5V28H5.5Z', { fill: accentFor(color, '#ef6c3a') }),
    path(body, OUTLINE),
    path('M9.5 12.5H31V19H9.5Z', { fill: GLASS, stroke: INK, sw: 1.6 }),
    path('M36 12.5H37.5L47 19H36Z', { fill: GLASS, stroke: INK, sw: 1.6 }),
    line('M33.5 12v17', INK, 1.4),
    rect(58, 22.5, 3, 3.2, 1.2, { fill: '#fde047', stroke: INK, sw: 1.2 }),
    rect(3.4, 22.5, 2.6, 3.4, 1, { fill: '#dc2626', stroke: INK, sw: 1.2 }),
    path('M57 30h5v2.2h-5Z', { fill: INK }),
    wheel(17.5, 30.5, 6.2),
    wheel(47.5, 30.5, 6.2),
  ]
}

/** Move absolute path data (M, L, H, Q with upper-case commands) right by `dx`; relative commands and arcs are left alone. */
function shiftX(d: string, dx: number): string {
  return d.replace(/([MLHQ])([^A-Za-z]*)/g, (_m, cmd: string, args: string) => {
    const nums = args.trim().split(/[\s,]+/).filter(Boolean).map(Number)
    const moved = nums.map((v, i) => (cmd === 'H' || i % 2 === 0 ? n(v + dx) : v))
    return cmd + moved.join(' ')
  })
}

const shifted = (shape: PathShape, dx: number): PathShape => ({ ...shape, d: shiftX(shape.d, dx) })

/** The Campervan's cab and nose are the former van's, moved this far forward; the longer cargo box fills the gap behind them. */
const VAN_STRETCH = 14

/**
 * The Campervan (kind `iveco-daily`): a long (L4-style) high-roof van, black unless coloured: long wheelbase
 * AND a long tail, so the picture is wider than the standard box (78 units, ≈ 2.5 times as long as the body is
 * high). The cab keeps its look (short steep bonnet, big upright windscreen, A-pillar mirror, dark tinted
 * glass), the sliding door sits behind it and the body runs on past the rear axle by about a third of the
 * wheelbase, carrying two tinted side windows and a roof vent. Only the body is `color`; glass, tyres and rims,
 * lamps, trim and the vent keep their own colours. Highlights and creases switch between light and dark with
 * the body, so a near-black body keeps its shape (pale roof edge, door lines, a crease, the arches) and a white
 * one does too; no badges.
 */
function longVan(color: string): Shape[] {
  const edge = '#05070a'
  const trim = '#39414d'
  const tint = '#1b2638'
  const dx = VAN_STRETCH
  const [rear, front] = [22, 50.2 + dx]
  const body = `M3 31V12Q3 8 7 8H${n(44.6 + dx)}Q${n(46.6 + dx)} 8 ${n(47.7 + dx)} 9.8L${n(53.2 + dx)} 21Q${n(54 + dx)} 22.6 ${n(55.7 + dx)} 23.1L${n(59.6 + dx)} 24.3Q${n(61.7 + dx)} 24.9 ${n(61.7 + dx)} 27V31Z`
  const dark = luminance(color) < 0.5
  const [crease, creaseOp] = dark ? ['#ffffff', 1] : ['#0f172a', 0.55]
  const arch = (cx: number) => path(`M${n(cx - 8.2)} 31.2V30.5A8.2 8.2 0 0 1 ${n(cx + 8.2)} 30.5V31.2Z`, { fill: edge })
  const archRim = (cx: number) => line(`M${n(cx - 8.2)} 30.5A8.2 8.2 0 0 1 ${n(cx + 8.2)} 30.5`, '#6b7686', 0.9, 0.85)
  const glint = (x: number) => path(`M${x} 12.6H${n(x + 3.1)}L${n(x + 1)} 18.4H${n(x - 1.2)}V17.2Z`, { fill: '#ffffff', op: 0.13 })
  return [
    // The roof vent, behind the body so the roof line overlaps its foot.
    rect(15, 5.8, 11.6, 3, 1.1, { fill: '#c3cad4', stroke: edge, sw: 1 }),
    path(body, { fill: color, stroke: edge, sw: 2 }, true),
    // The plastic skirt along the bottom and the edge of the roof.
    path(`M3.6 28.4H${n(61.1 + dx)}V30.8H3.6Z`, { fill: '#262b33' }),
    line(`M6.6 9.5H${n(44.4 + dx)}Q${n(46 + dx)} 9.5 ${n(47 + dx)} 10.8`, crease, 1, 0.42 * creaseOp),
    line(`M4.2 21.4H${n(53.4 + dx)}`, crease, 0.8, 0.16 * creaseOp),
    // Two tinted side windows behind the door, then the cab: dark tinted glass. The windscreen is the slanted front edge.
    rect(9.4, 12.2, 13.4, 6.6, 1.4, { fill: tint, stroke: edge, sw: 1 }),
    glint(11.6),
    rect(26.6, 12.2, 11.4, 6.6, 1.4, { fill: tint, stroke: edge, sw: 1 }),
    glint(28.6),
    shifted(path('M38.9 11.4H46.7Q47.2 11.4 47.5 11.9L51.7 20.6H38.9Z', { fill: tint, stroke: edge, sw: 1 }), dx),
    shifted(path('M41 11.8H43.9L40.6 20.2H38.9V19.6Z', { fill: '#ffffff', op: 0.17 }), dx),
    // The sliding door, whose front edge is the cab door's rear edge.
    path(`M${n(38.2 + dx - 11.4)} 29.4V12.4Q${n(38.2 + dx - 11.4)} 10.9 ${n(38.2 + dx - 9.9)} 10.9H${n(38.2 + dx)}V29.4`, { stroke: dark ? '#5b6573' : '#334155', sw: 0.8, op: 0.9 }),
    rect(34 + dx, 19.6, 2.8, 1.2, 0.6, { fill: '#8b95a3' }),
    // The big mirror at the A-pillar.
    shifted(path('M52.9 15.4H55.4Q56.4 15.4 56.4 16.4V19.5Q56.4 20.5 55.4 20.5H53.5Z', { fill: '#0d0f13', stroke: '#6b7686', sw: 0.8 }), dx),
    // Lamps and bumpers.
    rect(58.8 + dx, 25.4, 3.3, 2.4, 1, { fill: '#f3f4f6', stroke: edge, sw: 1 }),
    rect(55.2 + dx, 29, 7.5, 2.8, 1.2, { fill: trim, stroke: edge, sw: 1 }),
    rect(3.1, 12.4, 2.1, 8.4, 0.9, { fill: '#dc2626', stroke: edge, sw: 0.8 }),
    rect(1.6, 29, 6, 2.8, 1.2, { fill: trim, stroke: edge, sw: 1 }),
    arch(rear),
    archRim(rear),
    arch(front),
    archRim(front),
    wheel(rear, 30.5, 6.3, { tyre: '#0b0d10', rim: '#aab2be', spoke: '#5b6573', spokes: 3 }),
    wheel(front, 30.5, 6.3, { tyre: '#0b0d10', rim: '#aab2be', spoke: '#5b6573', spokes: 3 }),
  ]
}

/** A split-screen style camper bus: rounded, two-tone, a row of windows, round headlamp, chrome bumpers. */
function retroBus(color: string): Shape[] {
  const cream = '#f6efdc'
  const chrome = '#e5e7eb'
  const body = 'M4.5 31V15Q4.5 8.5 11 8H47Q52.5 8 54.4 12.5L58.6 22.5Q60.3 26 60.3 29V31Z'
  return [
    path(body, { fill: cream, ...OUTLINE }, true),
    path('M4.5 31V22H54.6L59.4 24.6Q60.3 26.5 60.3 29V31Z', { fill: color }),
    path(body, OUTLINE),
    line('M4.8 22H58.8', accentFor(color, '#ffffff'), 1.2, 0.9),
    path('M7.5 11.6H17V19H7.5Z', { fill: GLASS, stroke: INK, sw: 1.5 }),
    path('M19.5 11.6H29.5V19H19.5Z', { fill: GLASS, stroke: INK, sw: 1.5 }),
    path('M32 11.6H38V19H32Z', { fill: GLASS, stroke: INK, sw: 1.5 }),
    path('M40.5 11.6H47.2Q48.7 11.6 49.4 13L52.4 19H40.5Z', { fill: GLASS, stroke: INK, sw: 1.5 }),
    line('M39 10V30', INK, 1.4),
    circle(59.4, 22.6, 2, { fill: '#fde68a', stroke: INK, sw: 1.2 }),
    rect(2.5, 24, 2.4, 3.2, 1, { fill: '#dc2626', stroke: INK, sw: 1.2 }),
    rect(57.2, 29.4, 5.4, 2, 0.9, { fill: chrome, stroke: INK, sw: 1.2 }),
    rect(1.8, 29.4, 5.4, 2, 0.9, { fill: chrome, stroke: INK, sw: 1.2 }),
    path('M9.6 31.2V30.4A6.8 6.8 0 0 1 23.2 30.4V31.2Z', { fill: INK }),
    path('M40.4 31.2V30.4A6.8 6.8 0 0 1 54 30.4V31.2Z', { fill: INK }),
    wheel(16.4, 30.9, 5.8, { rim: chrome }),
    wheel(47.2, 30.9, 5.8, { rim: chrome }),
  ]
}

/** A coachbuilt motorhome: the box body and the over-cab "Luton" bed above a lower cab. */
function motorhome(color: string): Shape[] {
  const body = 'M3 31V10.8Q3 7.8 6 7.8H55.6Q59.6 7.8 59.6 11.6V17.6H56.2Q55.6 17.6 55.9 18.2L58.4 24.3L61 25.2Q62.1 25.6 62.1 27V31Z'
  return [
    path(body, { fill: color, ...OUTLINE }, true),
    path('M20 7.8V6.4Q20 5.5 21 5.5H28Q29 5.5 29 6.4V7.8', { fill: toneOf(color), ...OUTLINE }),
    path('M3.5 22.8H43.8L41.2 26.6H3.5Z', { fill: accentFor(color, '#1e5fd0') }),
    path(body, OUTLINE),
    rect(11.5, 11.6, 15.5, 7.4, 1.6, { fill: GLASS, stroke: INK, sw: 1.6 }),
    path('M33 10.8H41.6V29.4H33Z', { fill: toneOf(color), stroke: INK, sw: 1.4 }),
    rect(35.2, 13.2, 4.2, 5.4, 1, { fill: GLASS, stroke: INK, sw: 1.2 }),
    path('M45.6 18.9H55.1L57.2 23.8H45.6Z', { fill: GLASS, stroke: INK, sw: 1.6 }),
    line('M44.8 18.4V29.6', INK, 1.4),
    rect(60.2, 25.6, 2.6, 2.8, 1, { fill: '#fde047', stroke: INK, sw: 1.2 }),
    rect(3.2, 12.2, 2.2, 4.6, 0.9, { fill: '#dc2626', stroke: INK, sw: 1.1 }),
    path('M57.5 29.4h5.5v2.4h-5.5Z', { fill: INK }),
    wheel(15.4, 30.5, 6.2),
    wheel(51.2, 30.5, 6.2),
  ]
}

/** A car towing a single-axle caravan: the car carries the chosen colour, the caravan its stripe. */
function carWithCaravan(color: string): Shape[] {
  const van = 'M2 30V15.2Q2 10.6 6.6 10.6H28.6Q32.4 10.6 34.4 13.8L36.6 18.2V30Z'
  const car = 'M39.4 32.2V25.4Q39.4 23.4 41.4 23L45 22.4L47 18.6Q48 15 51 15H54.6Q56.4 15 57.6 16.6L60.2 21.8L61.6 22.6Q62.8 23.2 62.8 25.4V32.2Z'
  return [
    path(van, { fill: '#ffffff', ...OUTLINE }, true),
    path('M14.5 10.6V9.2Q14.5 8.4 15.3 8.4H22.5Q23.3 8.4 23.3 9.2V10.6', { fill: '#f1f5f9', ...OUTLINE }),
    path('M2.5 23.6H36.2V27H2.5Z', { fill: accentFor('#ffffff', color) }),
    path(van, OUTLINE),
    rect(8, 14.4, 15, 6.4, 1.4, { fill: GLASS, stroke: INK, sw: 1.5 }),
    path('M26.6 14.6H31.2L33.6 18.4H26.6Z', { fill: GLASS, stroke: INK, sw: 1.4 }),
    rect(1.4, 20.6, 2.2, 3.2, 0.9, { fill: '#dc2626', stroke: INK, sw: 1.1 }),
    line('M36.6 29.6H41', INK, 2.4),
    path(car, { fill: color, ...OUTLINE }, true),
    path('M47.2 22L48.8 18.2Q49.4 16.8 50.8 16.8H54.2Q55.2 16.8 55.8 17.8L58.2 22Z', { fill: GLASS, stroke: INK, sw: 1.3 }),
    line('M52.6 16.9V21.8', INK, 1.1),
    rect(60.6, 23.6, 2.4, 2.2, 0.9, { fill: '#fde047', stroke: INK, sw: 1.1 }),
    rect(39, 24, 1.8, 2.4, 0.7, { fill: '#dc2626', stroke: INK, sw: 1 }),
    wheel(17.6, 31.6, 5.1),
    wheel(45.4, 31.6, 5.1),
    wheel(57, 31.6, 5.1),
  ]
}

/** A tall, boxy 4×4 on big tyres with a folded roof tent on a roof rack and a spare wheel on the back. */
function offroad(color: string): Shape[] {
  const body = 'M8.6 28.4V17.4Q8.6 15 11 15H38.6Q40.4 15 41.4 16.2L46.2 21.8Q46.9 22.5 48 22.5H58.4Q60.8 22.5 60.8 25V28.4Z'
  const arch = (cx: number) => path(`M${n(cx - 8.6)} 29.8V29.7A8.6 8.6 0 0 1 ${n(cx + 8.6)} 29.7V29.8Z`, { fill: INK })
  return [
    // Roof rack, then the folded tent with its straps; the snorkel up the windscreen pillar.
    line('M14 13.2V15M26.5 13.2V15M37 13.2V15', INK, 1.6),
    rect(10.6, 6.6, 31.2, 7, 2.6, { fill: '#6f6a5c', ...OUTLINE }),
    line('M13.4 9.6H38.8', '#d9cfae', 1.1, 0.85),
    line('M19.6 7.4V13M32 7.4V13', INK, 1, 0.7),
    line('M44.2 18.6V11.8', INK, 1.5),
    path(body, { fill: color, ...OUTLINE }, true),
    path('M12.2 17.6H22.4V22H12.2Z', { fill: GLASS, stroke: INK, sw: 1.5 }),
    path('M25.2 17.6H37.8Q38.8 17.6 39.4 18.4L41.4 22H25.2Z', { fill: GLASS, stroke: INK, sw: 1.5 }),
    line('M23.8 16.4V27.6', INK, 1.4),
    rect(58.6 - 0.2, 24, 2.6, 2.2, 0.9, { fill: '#fde047', stroke: INK, sw: 1.1 }),
    path('M57.4 27.4h4.6v2.2h-4.6Z', { fill: INK }),
    circle(5.2, 21.6, 4.2, { fill: INK }),
    circle(5.2, 21.6, 1.7, { fill: '#cbd5e1' }),
    arch(20),
    arch(50.2),
    wheel(20, 29.9, 6.8, { rim: '#cbd5e1', spokes: 3 }),
    wheel(50.2, 29.9, 6.8, { rim: '#cbd5e1', spokes: 3 }),
  ]
}

// ---- Ferry, train and plane ----------------------------------------------------------------------

const FERRY: Shape[] = [
  path('M4 25H60L53.5 34.5H11Z', { fill: '#0e7490', ...OUTLINE }, true),
  line('M7.5 29.5H57', '#ffffff', 2),
  path('M15 25V17.5H45V25', { fill: '#ffffff', ...OUTLINE }),
  path('M21 17.5V11H39V17.5', { fill: '#f1f5f9', ...OUTLINE }),
  path('M29 11V5H36V11', { fill: '#ef6c3a', ...OUTLINE }),
  line('M29 7.5H36', INK, 1.6),
  ...[
    [19, 19.6, 4.4, 3.2],
    [26, 19.6, 4.4, 3.2],
    [33, 19.6, 4.4, 3.2],
    [40, 19.6, 2.6, 3.2],
    [24.5, 13.2, 4.4, 2.8],
    [31.5, 13.2, 4.4, 2.8],
  ].map(([x, y, w, h]) => rect(x, y, w, h, 0.8, { fill: GLASS, stroke: INK, sw: 1.2 })),
  line('M2 37.6q4-3 8 0t8 0t8 0t8 0t8 0t8 0t8 0t6 0', '#0891b2', 2.4),
]

const TRAIN: Shape[] = [
  path('M4 12.5H47Q59.5 12.5 61 25V31H4Z', { fill: '#7c3aed', ...OUTLINE }, true),
  line('M4 25.5H61', '#ffffff', 2.4),
  rect(8, 16, 7, 6, 1.2, { fill: GLASS, stroke: INK, sw: 1.4 }),
  rect(18, 16, 7, 6, 1.2, { fill: GLASS, stroke: INK, sw: 1.4 }),
  rect(28, 16, 7, 6, 1.2, { fill: GLASS, stroke: INK, sw: 1.4 }),
  path('M38.5 16H46Q52 16 55.5 22H38.5Z', { fill: GLASS, stroke: INK, sw: 1.4 }),
  line('M24 12.5 28 6.8H38L42 12.5M28 6.8H38', INK, 1.6),
  rect(57.2, 26.4, 2.4, 2.4, 0.8, { fill: '#fde047' }),
  line('M0 38H64', INK, 1.6),
  wheel(14, 33.6, 3.8),
  wheel(25, 33.6, 3.8),
  wheel(44, 33.6, 3.8),
  wheel(55, 33.6, 3.8),
]

const PLANE: Shape[] = [
  path('M6 20.5 3.5 8.5H10.5L18.5 18.5Z', { fill: '#db2777', ...OUTLINE }),
  path('M6.5 22Q6.5 17.2 15 17H49Q60.5 17 62.5 21.8Q60.5 26.6 49 26.6H15Q6.5 26.6 6.5 22Z', { fill: '#ffffff', ...OUTLINE }, true),
  path('M27.5 24 21 35.5H29.5L42 24Z', { fill: '#db2777', ...OUTLINE }),
  path('M26 20.5 20 9.5H27.5L38 19.5Z', { fill: '#f472b6', ...OUTLINE }),
  ...[
    [14, 19.4],
    [20, 19.4],
    [30, 19.4],
    [36, 19.4],
  ].map(([x, y]) => rect(x, y, 3.6, 3, 1, { fill: GLASS, stroke: INK, sw: 1.2 })),
  path('M51 19.2Q57.5 19.2 59.2 21.8H51Z', { fill: GLASS, stroke: INK, sw: 1.2 }),
  rect(32, 26, 9, 3.4, 1.7, { fill: '#e2e8f0', stroke: INK, sw: 1.4 }),
]

/** What is drawn: the shapes and the width of the box they are drawn in (units). */
interface Art {
  shapes: readonly Shape[]
  width: number
}

const standard = (shapes: readonly Shape[]): Art => ({ shapes, width: VEHICLE_BOX.width })

const ROAD: Record<VehicleKind, (color: string) => Shape[]> = {
  campervan,
  'iveco-daily': longVan,
  'retro-bus': retroBus,
  motorhome,
  caravan: carWithCaravan,
  offroad,
}

const OTHER: Record<Exclude<LegMode, 'drive'>, Art> = { ferry: standard(FERRY), train: standard(TRAIN), flight: standard(PLANE) }

/** Most vehicle looks kept at once: a colour being dragged in the picker makes a new one per step, and only the latest matter. */
const SHAPE_CACHE_LIMIT = 24
const cache = createLru<string, Art>(SHAPE_CACHE_LIMIT)

/** How many looks are cached (for tests). */
export const shapeCacheSize = (): number => cache.size

/** The picture of the trip's vehicle (`vehicle` as the trip stores it; anything unusable is the default vehicle). */
function roadArt(vehicle: TripVehicle | undefined): Art {
  const { kind, color } = resolveVehicle(vehicle)
  const key = `${kind}|${color}`
  let art = cache.get(key)
  if (!art) {
    art = { shapes: ROAD[kind](color), width: WIDE_BOX[kind] ?? VEHICLE_BOX.width }
    cache.set(key, art)
  }
  return art
}

function artFor(mode: LegMode, vehicle: TripVehicle | undefined): Art {
  return mode === 'drive' ? roadArt(vehicle) : OTHER[mode]
}

/**
 * The box (units) the picture of a stretch of `mode` is drawn in: always as high as the standard box, as wide
 * as the standard box or, for a long vehicle, wider. The anchor is the middle of it (`x = width / 2`) at
 * `VEHICLE_ANCHOR.y`; one unit is `width / 64` px when a picture is drawn at `width` px (a picture of 78 units
 * at 56 is 68 px wide).
 */
export function pictureBox(mode: LegMode, vehicle?: TripVehicle): { width: number; height: number } {
  return { width: artFor(mode, vehicle).width, height: VEHICLE_BOX.height }
}

// ---- As SVG ----------------------------------------------------------------------------------------

function pathSvg(s: PathShape): string {
  let out = `<path d="${s.d}" fill="${s.fill ?? 'none'}"`
  if (s.stroke) out += ` stroke="${s.stroke}" stroke-width="${s.sw ?? 2}" stroke-linejoin="round" stroke-linecap="round"`
  if (s.op !== undefined) out += ` opacity="${s.op}"`
  return out + '/>'
}

function shapeSvg(s: Shape): string {
  if (!('spin' in s)) return pathSvg(s)
  return `<g class="ride-wheel" style="transform-origin:${s.spin[0]}px ${s.spin[1]}px">${s.parts.map(pathSvg).join('')}</g>`
}

function svgOf({ shapes, width }: Art, facing: Facing): string {
  const inner = shapes.map(shapeSvg).join('')
  const art = facing === 'west' ? `<g transform="translate(${width} 0) scale(-1 1)">${inner}</g>` : inner
  const unit = VEHICLE_DRAW_WIDTH / VEHICLE_BOX.width
  // A picture wider than the standard box says so (`--units`), so the CSS can centre it on its anchor and size it in the picker.
  const wide = width === VEHICLE_BOX.width ? '' : ` style="--units:${width}"`
  return `<svg class="ride-art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${VEHICLE_BOX.height}" width="${n(width * unit)}" height="${VEHICLE_BOX.height * unit}"${wide} aria-hidden="true">${art}</svg>`
}

/** The trip's vehicle as an SVG string (56 × 35 px by default, wider for a long vehicle), facing east or, mirrored, west. */
export function vehicleSvg(vehicle?: TripVehicle, facing: Facing = 'east'): string {
  return svgOf(roadArt(vehicle), facing)
}

/** What carries the traveller on a stretch of `mode`: the trip's vehicle on the road, a ferry, train or plane otherwise. */
export function transportSvg(mode: LegMode, vehicle?: TripVehicle, facing: Facing = 'east'): string {
  return svgOf(artFor(mode, vehicle), facing)
}

// ---- On a canvas -------------------------------------------------------------------------------------

/** The 2D context of a canvas or an offscreen canvas. */
export type VehicleContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface DrawOptions {
  /** How far the wheels have turned (radians). */
  wheelAngle?: number
  /**
   * A soft white glow round the outline, like the ride's on the map: lifts the vehicle off busy or dark
   * ground. Left out, it is automatic: on for a road vehicle with a dark body (a black campervan vanishes on
   * dark tiles without it), off otherwise. `true` and `false` force it.
   */
  halo?: boolean
}

const paths = new WeakMap<PathShape, Path2D>()
const path2d = (s: PathShape): Path2D => {
  let p = paths.get(s)
  if (!p) {
    p = new Path2D(s.d)
    paths.set(s, p)
  }
  return p
}

/** `alpha` is the context's own opacity when drawing began: a shape's opacity multiplies it, so a caller can fade the whole vehicle. */
function paintShape(ctx: VehicleContext, s: PathShape, alpha: number): void {
  const p = path2d(s)
  ctx.globalAlpha = alpha * (s.op ?? 1)
  if (s.fill) {
    ctx.fillStyle = s.fill
    ctx.fill(p)
  }
  if (s.stroke) {
    ctx.strokeStyle = s.stroke
    ctx.lineWidth = s.sw ?? 2
    ctx.stroke(p)
  }
}

function drawShapes(ctx: VehicleContext, { shapes, width: box }: Art, x: number, y: number, facing: Facing, width: number, wheelAngle: number, halo: boolean): void {
  const scale = width / VEHICLE_BOX.width
  const alpha = ctx.globalAlpha
  ctx.save()
  try {
    ctx.translate(x, y)
    ctx.scale(facing === 'west' ? -scale : scale, scale)
    ctx.translate(-box / 2, -VEHICLE_ANCHOR.y)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    if (halo) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.95)'
      ctx.shadowBlur = Math.max(2, width / 16)
      for (const s of shapes) if (!('spin' in s) && s.hull) paintShape(ctx, s, alpha)
      ctx.shadowColor = 'rgba(0, 0, 0, 0)'
      ctx.shadowBlur = 0
    }
    for (const s of shapes) {
      if (!('spin' in s)) {
        paintShape(ctx, s, alpha)
        continue
      }
      ctx.save()
      ctx.translate(s.spin[0], s.spin[1])
      ctx.rotate(wheelAngle)
      ctx.translate(-s.spin[0], -s.spin[1])
      for (const part of s.parts) paintShape(ctx, part, alpha)
      ctx.restore()
    }
  } finally {
    ctx.restore()
  }
}

/**
 * Paint the trip's vehicle on a canvas, as `vehicleSvg` draws it. `(x, y)` is where it touches its line
 * (the middle of its wheels and of its picture, in the canvas's current coordinates); `width` is how wide the
 * standard 64 × 40 box is drawn (the ride uses 56), so every vehicle has the same scale and a long one comes out
 * wider than `width` (`pictureBox` says by how much). The context's `globalAlpha` fades the whole vehicle (the shapes with their own
 * opacity multiply it). A dark body gets the halo by itself (see `DrawOptions.halo`). Its transform, alpha, shadow and
 * line styles are left as they were. Needs `Path2D` (every browser, and workers).
 */
export function drawVehicle(
  ctx: VehicleContext,
  vehicle: TripVehicle | undefined,
  x: number,
  y: number,
  facing: Facing = 'east',
  width = VEHICLE_DRAW_WIDTH,
  options: DrawOptions = {},
): void {
  drawShapes(ctx, roadArt(vehicle), x, y, facing, width, options.wheelAngle ?? 0, options.halo ?? isDarkBody(resolveVehicle(vehicle).color))
}

/** Like `drawVehicle`, for a stretch of `mode`: the trip's vehicle on the road, a ferry, train or plane otherwise. */
export function drawTransport(
  ctx: VehicleContext,
  mode: LegMode,
  vehicle: TripVehicle | undefined,
  x: number,
  y: number,
  facing: Facing = 'east',
  width = VEHICLE_DRAW_WIDTH,
  options: DrawOptions = {},
): void {
  const halo = options.halo ?? (mode === 'drive' && isDarkBody(resolveVehicle(vehicle).color))
  drawShapes(ctx, artFor(mode, vehicle), x, y, facing, width, options.wheelAngle ?? 0, halo)
}
