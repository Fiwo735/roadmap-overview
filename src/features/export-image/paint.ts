import type { BadgeSpot } from '../../lib/legBadges'
import { CASING_EDGE, haloDash, MODES } from '../../lib/modes'
import type { LatLng } from '../../types/trip'
import type { CardLayout } from './card'
import type { CardTheme } from './cardTheme'
import type { Point, Rect, TileGrid, TileRef } from './geometry'
import { iconPaths, type IconId } from './icons'
import type { LegsPlan, LineStyle } from './legDrawing'
import { LEGEND_ICON_SIZE, LEGEND_SAMPLE, type LegendLayout } from './legend'
import type { PlacedLabel } from './labelPlacement'
import { creditBaseline, CREDIT_FONT, CREDIT_HALO_WIDTH, CREDIT_PAD_X, IMAGE_CREDIT_TEXT, type CreditCorner } from './attribution'
import { MARKER_BORDER, MARKER_RADIUS, MODE_BADGE_ICON, MODE_BADGE_RADIUS, markerFont, markerFontSize, type PillLayout } from './markers'
import { font } from './typography'

// Canvas painters. Each one expects the context to be scaled so that one unit is one logical pixel of
// the image (`scale` canvas pixels), and takes `u`, how much bigger than on screen everything map-like
// is drawn (`uiScaleFor`). Shadows are the exception: canvas ignores the transform for them.

export interface PaintScale {
  /** Canvas pixels per logical pixel. */
  scale: number
  /** The UI scale factor. */
  u: number
}

const MARKER_COLOR = MODES.drive.color
const LABEL_BACKGROUND = 'rgba(255, 255, 255, 0.94)'
const LABEL_TEXT = '#18212f'
const LABEL_DAY_TEXT = '#5b6678'
const CREDIT_HALO = 'rgba(255, 255, 255, 0.85)'
const MAP_SHADOW = 'rgba(15, 23, 42, 0.45)'

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]): void {
  const [tl, tr, br, bl] = typeof r === 'number' ? [r, r, r, r] : r
  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y)
  ctx.arcTo(x + w, y, x + w, y + tr, tr)
  ctx.lineTo(x + w, y + h - br)
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br)
  ctx.lineTo(x + bl, y + h)
  ctx.arcTo(x, y + h, x, y + h - bl, bl)
  ctx.lineTo(x, y + tl)
  ctx.arcTo(x, y, x + tl, y, tl)
  ctx.closePath()
}

const path2d = new Map<string, Path2D>()
function outline(d: string): Path2D {
  let p = path2d.get(d)
  if (!p) {
    p = new Path2D(d)
    path2d.set(d, p)
  }
  return p
}

/** Stroke an icon (24 × 24 outlines) into the square at (x, y) of `size`. */
export function paintIcon(ctx: CanvasRenderingContext2D, icon: IconId, x: number, y: number, size: number, color: string, strokeWidth = 2): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = color
  ctx.lineWidth = strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const d of iconPaths(icon)) ctx.stroke(outline(d))
  ctx.restore()
}

// ---- Map ----------------------------------------------------------------------------------------

/** The land colour of the standard OSM style, behind tiles that did not load. */
export const MAP_BACKGROUND = '#f2efe9'

/**
 * Draw the tiles. The canvas is used at its own pixel scale so every tile lands on whole pixels (a
 * fractional scale would leave hairline seams between neighbours).
 */
export function paintTiles(
  ctx: CanvasRenderingContext2D,
  grid: TileGrid,
  refs: readonly TileRef[],
  imageOf: (ref: TileRef) => CanvasImageSource | undefined,
  scale: number,
): void {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  for (const ref of refs) {
    const image = imageOf(ref)
    if (!image) continue
    const x0 = Math.floor((ref.ix * grid.tileSize - grid.left) * scale)
    const y0 = Math.floor((ref.iy * grid.tileSize - grid.top) * scale)
    const x1 = Math.ceil(((ref.ix + 1) * grid.tileSize - grid.left) * scale)
    const y1 = Math.ceil(((ref.iy + 1) * grid.tileSize - grid.top) * scale)
    ctx.drawImage(image, x0, y0, x1 - x0, y1 - y0)
  }
  ctx.restore()
}

type Project = (p: LatLng) => Point

function tracePath(ctx: CanvasRenderingContext2D, points: readonly LatLng[], project: Project): void {
  ctx.beginPath()
  let last: Point | null = null
  points.forEach((p, i) => {
    const at = project(p)
    // Points closer than half a pixel to the last one add nothing to the line: long routes have tens of thousands.
    if (last && i < points.length - 1 && Math.hypot(at.x - last.x, at.y - last.y) < 0.5) return
    if (last) ctx.lineTo(at.x, at.y)
    else ctx.moveTo(at.x, at.y)
    last = at
  })
}

function strokeStretches(ctx: CanvasRenderingContext2D, stretches: readonly (readonly LatLng[])[], style: LineStyle, project: Project, u: number): void {
  ctx.save()
  ctx.strokeStyle = style.color
  ctx.globalAlpha = style.opacity
  ctx.lineWidth = style.weight * u
  ctx.lineCap = style.cap
  ctx.lineJoin = 'round'
  ctx.setLineDash(style.dashArray.map((d) => d * u))
  ctx.lineDashOffset = style.dashOffset * u
  for (const stretch of stretches) {
    if (stretch.length < 2) continue
    tracePath(ctx, stretch, project)
    ctx.stroke()
  }
  ctx.restore()
}

/** All casings first, then all lines, so a casing never covers the line of the leg before it (as on the map's panes). */
export function paintLegs(ctx: CanvasRenderingContext2D, plan: LegsPlan, project: Project, u: number): void {
  for (const part of plan.parts) if (part.casing) strokeStretches(ctx, part.stretches, part.casing, project, u)
  for (const part of plan.parts) strokeStretches(ctx, part.stretches, part.line, project, u)
}

function discWithRing(ctx: CanvasRenderingContext2D, at: Point, radius: number, border: number, fill: string, { scale, u }: PaintScale): void {
  ctx.save()
  ctx.shadowColor = MAP_SHADOW
  ctx.shadowBlur = 4 * u * scale
  ctx.shadowOffsetY = 1 * u * scale
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(at.x, at.y, radius - border, 0, Math.PI * 2)
  ctx.fill()
}

/** The ferry / train / plane discs on the lines. */
export function paintModeBadges(ctx: CanvasRenderingContext2D, spots: readonly BadgeSpot[], project: Project, paint: PaintScale): void {
  const { u } = paint
  for (const spot of spots) {
    const at = project(spot.at)
    discWithRing(ctx, at, MODE_BADGE_RADIUS * u, MARKER_BORDER * u, MODES[spot.mode].color, paint)
    const size = MODE_BADGE_ICON * u
    paintIcon(ctx, spot.mode, at.x - size / 2, at.y - size / 2, size, '#ffffff', 2.25)
  }
}

export interface MarkerSpot {
  at: Point
  number: number
}

/** The numbered place markers. */
export function paintMarkers(ctx: CanvasRenderingContext2D, markers: readonly MarkerSpot[], paint: PaintScale): void {
  const { u } = paint
  for (const { at, number } of markers) {
    discWithRing(ctx, at, MARKER_RADIUS * u, MARKER_BORDER * u, MARKER_COLOR, paint)
    const text = String(number)
    ctx.save()
    ctx.translate(at.x, at.y)
    ctx.scale(u, u)
    ctx.font = markerFont(text.length)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(text, 0, markerFontSize(text.length) * 0.36)
    ctx.restore()
  }
}

export interface LabelSpot {
  placed: PlacedLabel
  pill: PillLayout
}

/** The name labels: a white pill with the name and, when day numbers are on, the day. */
export function paintLabels(ctx: CanvasRenderingContext2D, labels: readonly LabelSpot[], { scale, u }: PaintScale): void {
  for (const { placed, pill } of labels) {
    const { x, y, width, height } = placed.rect
    ctx.save()
    ctx.shadowColor = 'rgba(15, 23, 42, 0.35)'
    ctx.shadowBlur = 3 * u * scale
    ctx.shadowOffsetY = 1 * u * scale
    ctx.fillStyle = LABEL_BACKGROUND
    roundedRect(ctx, x, y, width, height, height / 2)
    ctx.fill()
    ctx.restore()
    ctx.save()
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.08)'
    ctx.lineWidth = u
    roundedRect(ctx, x, y, width, height, height / 2)
    ctx.stroke()
    ctx.translate(x, y)
    ctx.scale(u, u)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    const baseline = pill.height / 2 + 12 * 0.36
    ctx.font = pill.nameFont
    ctx.fillStyle = LABEL_TEXT
    ctx.fillText(pill.name, pill.nameX, baseline)
    if (pill.day) {
      ctx.font = pill.dayFont
      ctx.fillStyle = LABEL_DAY_TEXT
      ctx.fillText(pill.day, pill.dayX, baseline)
    }
    ctx.restore()
  }
}

// ---- Cards --------------------------------------------------------------------------------------

export function paintBox(ctx: CanvasRenderingContext2D, w: number, h: number, radius: number | [number, number, number, number], theme: CardTheme, { scale, u }: PaintScale, shadow = true): void {
  ctx.save()
  if (shadow) {
    ctx.shadowColor = theme.shadow
    ctx.shadowBlur = 14 * u * scale
    ctx.shadowOffsetY = 4 * u * scale
  }
  ctx.fillStyle = theme.surface
  roundedRect(ctx, 0, 0, w, h, radius)
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.strokeStyle = theme.border
  ctx.lineWidth = 1
  roundedRect(ctx, 0.5, 0.5, w - 1, h - 1, typeof radius === 'number' ? Math.max(0, radius - 0.5) : radius)
  ctx.stroke()
  ctx.restore()
}

/** The title/statistics card, its top-left corner at `at` (logical pixels). `flags` maps country codes to their loaded image. */
export function paintCard(ctx: CanvasRenderingContext2D, layout: CardLayout, at: Point, theme: CardTheme, flags: ReadonlyMap<string, CanvasImageSource>, paint: PaintScale): void {
  ctx.save()
  ctx.translate(at.x, at.y)
  ctx.scale(paint.u, paint.u)
  paintBox(ctx, layout.width, layout.height, 12, theme, paint)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (const op of layout.ops) {
    if (op.type === 'box') {
      ctx.fillStyle = theme[op.fill]
      roundedRect(ctx, op.x, op.y, op.width, op.height, op.radius)
      ctx.fill()
      if (op.stroke) {
        ctx.strokeStyle = theme[op.stroke]
        ctx.lineWidth = 1
        roundedRect(ctx, op.x + 0.5, op.y + 0.5, op.width - 1, op.height - 1, op.radius - 0.5)
        ctx.stroke()
      }
    } else if (op.type === 'text') {
      ctx.font = op.font
      ctx.fillStyle = theme[op.color]
      ctx.fillText(op.text, op.x, op.baseline)
    } else if (op.type === 'icon') {
      paintIcon(ctx, op.icon, op.x, op.y, op.size, theme[op.color], 2)
    } else {
      paintFlag(ctx, op.code, op.x, op.y, op.width, op.height, theme, flags.get(op.code))
    }
  }
  ctx.restore()
}

function paintFlag(ctx: CanvasRenderingContext2D, code: string, x: number, y: number, w: number, h: number, theme: CardTheme, image: CanvasImageSource | undefined): void {
  ctx.save()
  roundedRect(ctx, x, y, w, h, 3)
  ctx.clip()
  ctx.fillStyle = theme.surface3
  ctx.fillRect(x, y, w, h)
  let drawn = false
  if (image) {
    try {
      ctx.drawImage(image, x, y, w, h)
      drawn = true
    } catch {
      // An image the browser cannot draw: the country code stands in for the flag.
    }
  }
  if (!drawn) {
    ctx.font = font(700, 10)
    ctx.fillStyle = theme.textMuted
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(code, x + w / 2, y + h / 2 + 3.6)
  }
  ctx.restore()
  ctx.save()
  ctx.strokeStyle = theme.borderStrong
  ctx.lineWidth = 1
  roundedRect(ctx, x - 0.5, y - 0.5, w + 1, h + 1, 3.5)
  ctx.stroke()
  ctx.restore()
}

/** The mode legend, its top-left corner at `at`. */
export function paintLegend(ctx: CanvasRenderingContext2D, layout: LegendLayout, legendFont: string, at: Point, theme: CardTheme, paint: PaintScale): void {
  ctx.save()
  ctx.translate(at.x, at.y)
  ctx.scale(paint.u, paint.u)
  paintBox(ctx, layout.width, layout.height, 8, theme, paint)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (const row of layout.rows) {
    const meta = MODES[row.mode]
    const cy = row.y + 8
    const x1 = row.sampleX + 2
    const x2 = row.sampleX + LEGEND_SAMPLE.width - 2
    const halo = meta.dashArray ? haloDash(meta.dashArray) : null
    const dashes = meta.dashArray ? meta.dashArray.split(/\s+/).map(Number) : []
    if (meta.casing) {
      ctx.save()
      ctx.strokeStyle = meta.casing
      ctx.lineWidth = meta.weight + 2 * CASING_EDGE
      ctx.lineCap = halo ? 'butt' : 'round'
      if (halo) {
        ctx.setLineDash(halo.dashArray.split(/\s+/).map(Number))
        ctx.lineDashOffset = halo.dashOffset
      }
      ctx.beginPath()
      ctx.moveTo(x1, cy)
      ctx.lineTo(x2, cy)
      ctx.stroke()
      ctx.restore()
    }
    ctx.save()
    ctx.strokeStyle = meta.color
    ctx.lineWidth = meta.weight
    ctx.lineCap = meta.dashArray ? 'butt' : 'round'
    ctx.setLineDash(dashes)
    ctx.beginPath()
    ctx.moveTo(x1, cy)
    ctx.lineTo(x2, cy)
    ctx.stroke()
    ctx.restore()
    paintIcon(ctx, row.mode, row.iconX, cy - LEGEND_ICON_SIZE / 2, LEGEND_ICON_SIZE, theme.textMuted, 2.25)
    ctx.font = legendFont
    ctx.fillStyle = theme.text
    ctx.fillText(row.label, row.textX, row.baseline)
  }
  ctx.restore()
}

/**
 * The OpenStreetMap credit, small in the corner `rect` is flush with: no plate, a soft light halo behind the
 * letters so they read on any tiles (the tiles are always the light standard style, in either app theme).
 */
export function paintCredit(ctx: CanvasRenderingContext2D, rect: Rect, corner: CreditCorner, { u }: PaintScale): void {
  const right = corner.endsWith('right')
  ctx.save()
  ctx.translate(rect.x, rect.y)
  ctx.scale(u, u)
  ctx.font = CREDIT_FONT
  ctx.textAlign = right ? 'right' : 'left'
  ctx.textBaseline = 'alphabetic'
  const x = right ? rect.width / u - CREDIT_PAD_X : CREDIT_PAD_X
  ctx.lineJoin = 'round'
  ctx.lineWidth = CREDIT_HALO_WIDTH
  ctx.strokeStyle = CREDIT_HALO
  ctx.strokeText(IMAGE_CREDIT_TEXT, x, creditBaseline)
  ctx.fillStyle = LABEL_TEXT
  ctx.fillText(IMAGE_CREDIT_TEXT, x, creditBaseline)
  ctx.restore()
}
