import type { LatLng } from '../../types/trip'
import type { CardTheme } from '../export-image/cardTheme'
import type { Point } from '../export-image/geometry'
import type { LineStyle } from '../export-image/legDrawing'
import { paintBox, paintIcon, type PaintScale } from '../export-image/paint'
import { font } from '../export-image/typography'
import type { DayPanelLayout } from './hud'

// Canvas painters of the video's own pieces (the card, legend, markers, labels and credit are the image export's). Like
// those, each expects a context whose unit is one logical pixel, and `u`, how much bigger than on screen things are drawn.

/** Stop halos: the green of the ride's rings (ride.css `.ride-halo`). */
const HALO_GREEN = '#16a34a'
const HALO_RADIUS = 23
const HALO_BORDER = 3
const HALO_APPEAR_S = 0.28
const HALO_PULSE_S = 1.6
const HALO_PULSE_SPREAD = 14

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/** The day panel, its top-left corner at `at`. */
export function paintDayPanel(ctx: CanvasRenderingContext2D, layout: DayPanelLayout, at: Point, theme: CardTheme, paint: PaintScale): void {
  ctx.save()
  ctx.translate(at.x, at.y)
  ctx.scale(paint.u, paint.u)
  paintBox(ctx, layout.width, layout.height, 14, theme, paint)
  ctx.textBaseline = 'alphabetic'
  for (const op of layout.ops) {
    if (op.type === 'text') {
      ctx.font = op.font
      ctx.fillStyle = op.color
      ctx.textAlign = op.align ?? 'left'
      ctx.fillText(op.text, op.x, op.baseline)
    } else if (op.type === 'icon') {
      paintIcon(ctx, op.icon, op.x, op.y, op.size, op.color, 2.25)
    } else if (op.type === 'disc') {
      ctx.fillStyle = op.fill
      ctx.beginPath()
      ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = op.fill
      ctx.beginPath()
      ctx.roundRect(op.x, op.y, op.width, op.height, op.radius)
      ctx.fill()
    }
  }
  ctx.restore()
}

/**
 * The green ring under a reached stop's badge. `sinceS` is how long ago the vehicle got there (it grows in over a moment);
 * `pulse` (seconds into the video) makes a ring ripple outwards while the vehicle is parked there.
 */
export function paintStopHalo(ctx: CanvasRenderingContext2D, at: Point, u: number, sinceS: number, pulse: number | null): void {
  const appear = smooth(sinceS / HALO_APPEAR_S)
  if (appear <= 0) return
  ctx.save()
  const r = (HALO_RADIUS - HALO_BORDER / 2) * u * (0.7 + 0.3 * appear)
  ctx.globalAlpha *= appear
  ctx.fillStyle = 'rgba(22, 163, 74, 0.2)'
  ctx.strokeStyle = HALO_GREEN
  ctx.lineWidth = HALO_BORDER * u
  ctx.beginPath()
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  if (pulse !== null) {
    const phase = (pulse % HALO_PULSE_S) / HALO_PULSE_S
    const spread = HALO_PULSE_SPREAD * u * (1 - (1 - phase) ** 2)
    ctx.globalAlpha *= 0.55 * (1 - phase)
    ctx.lineWidth = spread
    ctx.beginPath()
    ctx.arc(at.x, at.y, HALO_RADIUS * u + spread / 2, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

const TAG_FONT = font(650, 11)

/** The "Day N" tag that rides above the vehicle, centred on `x` with its bottom edge at `bottom` (the ride's `.ride-day-tag`). */
export function paintDayTag(ctx: CanvasRenderingContext2D, text: string, x: number, bottom: number, { scale, u }: PaintScale): void {
  ctx.save()
  ctx.translate(x, bottom)
  ctx.scale(u, u)
  ctx.font = TAG_FONT
  const width = Math.ceil(ctx.measureText(text).width) + 16
  ctx.shadowColor = 'rgba(15, 23, 42, 0.3)'
  ctx.shadowBlur = 6 * u * scale
  ctx.shadowOffsetY = 2 * u * scale
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(-width / 2, -18, width, 18, 9)
  ctx.fill()
  ctx.shadowColor = 'rgba(0, 0, 0, 0)'
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.18)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = '#18212f'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, 0, -5.2)
  ctx.restore()
}

/** Stroke a prepared path (its points in the pixels of the background) in a style meant for screen pixels, under a camera that scales by `f`. */
export function strokeBackgroundPath(ctx: CanvasRenderingContext2D, path: Path2D, style: LineStyle, u: number, f: number, alpha = 1): void {
  ctx.save()
  const k = u / f
  ctx.strokeStyle = style.color
  ctx.globalAlpha *= style.opacity * alpha
  ctx.lineWidth = style.weight * k
  ctx.lineCap = style.cap
  ctx.lineJoin = 'round'
  ctx.setLineDash(style.dashArray.map((d) => d * k))
  ctx.lineDashOffset = style.dashOffset * k
  ctx.stroke(path)
  ctx.restore()
}

/** A line through `stretches` as a `Path2D` of the points `project` gives; points closer than half a pixel to the last one add nothing. */
export function buildPath(stretches: readonly (readonly LatLng[])[], project: (p: LatLng) => Point): Path2D {
  const path = new Path2D()
  for (const stretch of stretches) {
    if (stretch.length < 2) continue
    let last: Point | null = null
    stretch.forEach((p, i) => {
      const at = project(p)
      if (last && i < stretch.length - 1 && Math.hypot(at.x - last.x, at.y - last.y) < 0.5) return
      if (last) path.lineTo(at.x, at.y)
      else path.moveTo(at.x, at.y)
      last = at
    })
  }
  return path
}
