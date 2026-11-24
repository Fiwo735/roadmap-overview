import { modesInUse } from '../../lib/legModes'
import { clipPath } from '../../lib/pathAlong'
import { abortError } from '../../lib/requestQueue'
import { tileClient, tileUrl, type TileClient } from '../../services/tiles'
import type { LatLng, Trip } from '../../types/trip'
import { displayName } from '../places/names'
import type { LegRouteInfo } from '../routing/legRoutes'
import { nextFacing, type Facing } from '../ride/camera'
import { timelineFor } from '../ride/rideStore'
import { rideCaption } from '../ride/rideText'
import { sampleTimeline, type LegSlot, type RideSample } from '../ride/timeline'
import { drawTransport, VEHICLE_DRAW_WIDTH } from '../ride/vehicles'
import type { TripStats } from '../stats/computeStats'
import { creditClearSides, IMAGE_CREDIT_TEXT, layoutCredit, placeCredit } from '../export-image/attribution'
import { buildCardContent, layoutCard, type CountriesStatus } from '../export-image/card'
import { CARD_THEMES, type CardThemeName } from '../export-image/cardTheme'
import { loadFlagImage } from '../export-image/flagImages'
import { ensureFonts } from '../export-image/fonts'
import { chooseTileGrid, createProjector, fitViewport, tilesOf, type Obstacle, type Point, type Rect, type Size, type Viewport } from '../export-image/geometry'
import { placeLabels, type LabelRequest, type PlacedLabel } from '../export-image/labelPlacement'
import { layoutLegend, LEGEND_FONT } from '../export-image/legend'
import { planLegParts, planLegs, type LegPart } from '../export-image/legDrawing'
import { layoutPill, MARKER_RADIUS, type PillLayout } from '../export-image/markers'
import { uiScaleFor } from '../export-image/options'
import { MAP_BACKGROUND, paintCard, paintCredit, paintLabels, paintLegend, paintMarkers, paintModeBadges, paintTiles, type PaintScale } from '../export-image/paint'
import { unwrapTrip } from '../export-image/unwrap'
import {
  cameraOn,
  cardAlpha,
  extentOf,
  labelBlend,
  MAX_BACKGROUND_TILES,
  pickFollowZoom,
  planFollowBackground,
  planFollowCamera,
  planStillCamera,
  type CameraFrame,
} from './camera'
import { videoCreditScale } from './credit'
import { dayPanelContent, DAY_PANEL_HEIGHT, DAY_PANEL_WIDTH, layoutDayPanel } from './hud'
import { videoSize, type VideoCamera, type VideoOptions } from './options'
import { buildPath, paintDayPanel, paintDayTag, paintStopHalo, strokeBackgroundPath } from './paintVideo'
import { creditAlpha, frameClock, planSchedule, type FrameClock, type FrameInfo, type Schedule } from './schedule'

/**
 * The video's picture, prepared once and then drawn frame by frame (ARCHITECTURE.md → F13). Preparing lays everything out, fetches
 * the tiles and paints the map as one background picture; `draw(ctx, i)` then paints frame `i` of that: a crop of the background
 * under the camera of that frame, with the route, trail, stops, vehicle, card, legend, day panel and credit drawn over it as
 * vectors, so they stay sharp however the camera moves. The same scene serves the preview (a smaller `scale`), the render and tests.
 */

/** How faint the planned route is under the emphasised trail (`.ride-dimmed` in ride.css). */
const DIM_ALPHA = 0.38
/** A parked vehicle stands beside its stop's badge instead of on top of it (ride.css `[data-parked]`). */
const PARKED_LIFT = 17
/** The wheels' period (ride.css `ride-spin`) and the body's bounce (`ride-bob`), in seconds. */
const WHEEL_TURN_S = 0.5
const BOB_PERIOD_S = 0.46
const BOB_PX = 1.5

export interface VideoSceneParams {
  trip: Pick<Trip, 'title' | 'subtitle' | 'startDate' | 'places' | 'vehicle'>
  /** The legs with their routes, from `getLegRoutes()` / `useLegRoutes()`. */
  legs: readonly LegRouteInfo[]
  stats: TripStats
  countriesStatus?: CountriesStatus
  options: VideoOptions
  /** The video's size when it is not the preset's: for tests and the debug hook (a small video is made quickly). */
  size?: Size
  /** Colours of the card, legend and day panel. */
  theme: CardThemeName
  /** Canvas pixels per logical pixel: 1 for the video, less for a preview. */
  scale: number
  signal?: AbortSignal
  /** Tiles loaded so far, of how many. */
  onTiles?: (done: number, total: number) => void
  /** Where tiles come from (the shared client by default). */
  tiles?: TileClient<CanvasImageSource>
  /** Ask again for tiles that failed a moment ago (an explicit render), instead of leaving a gap at once. */
  retryFailedTiles?: boolean
}

export interface VideoScene {
  /** Logical size of the video. */
  width: number
  height: number
  scale: number
  /** Pixel size of a canvas that `draw` fills completely. */
  canvasWidth: number
  canvasHeight: number
  schedule: Schedule
  /** What was planned: a following camera falls back to `'whole'` for a trip it has nothing to follow in. */
  camera: VideoCamera
  /** Why the camera is not the one asked for, as a sentence for the user. */
  cameraNote: string | null
  tiles: { total: number; failed: number; zoom: number }
  /** Place names that had no room anywhere. */
  hiddenLabels: number
  info: (index: number) => FrameInfo
  /** Paint frame `index` on a canvas of `canvasWidth` × `canvasHeight` pixels. */
  draw: (ctx: CanvasRenderingContext2D, index: number) => void
  /** Let go of the big background picture. */
  dispose: () => void
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw abortError()
}

/** First and last stop first, then the others in trip order: the stops that matter most get their labels first. */
function labelOrder(count: number): number[] {
  if (count === 0) return []
  const order = [0]
  if (count > 1) order.push(count - 1)
  for (let i = 1; i < count - 1; i++) order.push(i)
  return order
}

/** Where a place's name goes relative to its marker. */
interface LabelOffset {
  dx: number
  dy: number
  width: number
  height: number
  pill: PillLayout
  side: PlacedLabel['side']
}

/** Greedy placement (`placeLabels`) turned into offsets from each marker, so the names follow their markers wherever the camera puts them. */
function labelOffsets(anchors: readonly Point[], pills: readonly PillLayout[], u: number, bounds: Rect, obstacles: readonly Rect[]): { offsets: (LabelOffset | null)[]; hidden: number } {
  const requests: LabelRequest[] = []
  for (const i of labelOrder(anchors.length)) {
    requests.push({ id: String(i), anchor: anchors[i], radius: MARKER_RADIUS * u, width: pills[i].width * u, height: pills[i].height * u })
  }
  const placed = placeLabels(requests, { bounds, obstacles, offset: 6 * u, gap: 3 * u })
  const offsets = anchors.map((anchor, i): LabelOffset | null => {
    const spot = placed.get(String(i))
    if (!spot) return null
    return { dx: spot.rect.x - anchor.x, dy: spot.rect.y - anchor.y, width: spot.rect.width, height: spot.rect.height, pill: pills[i], side: spot.side }
  })
  return { offsets, hidden: offsets.filter((o) => o === null).length }
}

/** The path of one leg's stretches, per style, ready to stroke. */
interface StyledPath {
  part: LegPart
  path: Path2D
}

const styleKey = (part: LegPart) =>
  `${part.casing?.color ?? '-'}|${part.line.color}|${part.line.weight}|${part.line.dashArray.join(',')}|${part.line.opacity}`

/** The legs already travelled, merged by style into one path each, grown one leg at a time as the ride goes on. */
function createDoneTrail(legPaths: (index: number) => StyledPath[]) {
  const groups = new Map<string, { part: LegPart; path: Path2D }>()
  let count = 0
  return {
    show(completed: number) {
      if (completed < count) {
        groups.clear()
        count = 0
      }
      for (let k = count; k < completed; k++) {
        for (const { part, path } of legPaths(k)) {
          const key = styleKey(part)
          let group = groups.get(key)
          if (!group) {
            group = { part, path: new Path2D() }
            groups.set(key, group)
          }
          group.path.addPath(path)
        }
      }
      count = completed
    },
    groups: () => [...groups.values()],
  }
}

export async function prepareVideoScene(params: VideoSceneParams): Promise<VideoScene> {
  const { trip, legs, stats, options, scale, signal } = params
  throwIfAborted(signal)
  const size = params.size ?? videoSize(options.preset)
  const { width, height } = size
  const u = uiScaleFor(size)
  const creditU = videoCreditScale(size)
  const theme = CARD_THEMES[params.theme]
  const paint: PaintScale = { scale, u }
  const creditPaint: PaintScale = { scale, u: creditU }

  // The same unwrapping as the image: a trip across the date line is one continuous map, the ride timeline is made from it too.
  const drawn = unwrapTrip(trip.places, legs)
  const rideTimeline = timelineFor(drawn.places, drawn.legs, trip.startDate)
  if (!rideTimeline) throw new Error('Add at least two places to render a ride.')
  const timeline = rideTimeline
  const schedule = planSchedule(options.length, timeline.duration)
  const names = drawn.places.map((p) => displayName(p.name))

  // ---- Text: sizes depend on the fonts being loaded.
  const content = options.card ? buildCardContent(trip, stats, params.countriesStatus ?? 'ready') : null
  await ensureFonts([
    ...names,
    content ? [content.title, content.subtitle, content.dateRange, content.hint ?? '', ...content.tiles.flatMap((t) => [t.label, t.value])].join(' ') : '',
    `Day 0123456789 km min — … Starting in Resting in Arrived in → Mon Tue Wed Thu Fri Sat Sun Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec Drive Ferry Train Flight ${IMAGE_CREDIT_TEXT}`,
  ])
  throwIfAborted(signal)
  const measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) throw new Error('This browser cannot draw the video.')
  const measure = (font: string, text: string) => {
    measureCtx.font = font
    return measureCtx.measureText(text).width
  }

  // ---- Overlays, in the corners: the card (top-left), the legend (bottom-left), the day panel (bottom-centre), the credit.
  const margin = 20 * u
  const cardLayout = content ? layoutCard(content, measure) : null
  const cardRect: Rect | null = cardLayout ? { x: margin, y: margin, width: cardLayout.width * u, height: cardLayout.height * u } : null
  const legendModes = options.legend ? modesInUse(legs) : []
  const legendLayout = legendModes.length > 1 ? layoutLegend(legendModes, measure) : null
  const legendRect: Rect | null = legendLayout
    ? { x: margin, y: height - margin - legendLayout.height * u, width: legendLayout.width * u, height: legendLayout.height * u }
    : null
  const panelRect: Rect = { x: (width - DAY_PANEL_WIDTH * u) / 2, y: height - margin - DAY_PANEL_HEIGHT * u, width: DAY_PANEL_WIDTH * u, height: DAY_PANEL_HEIGHT * u }
  const credit = placeCredit(size, layoutCredit(measure), creditU, [cardRect, legendRect, panelRect].filter((r): r is Rect => r !== null))

  // ---- The whole-trip view: everything visible, clear of all of them.
  const obstacles: Obstacle[] = [
    { rect: panelRect, clear: ['above'] },
    { rect: credit.rect, clear: creditClearSides(credit.corner) },
  ]
  if (cardRect) obstacles.push({ rect: cardRect, clear: ['right', 'below'] })
  if (legendRect) obstacles.push({ rect: legendRect, clear: ['right', 'above'] })
  const lines = [...drawn.places.map((p): LatLng[] => [p]), ...drawn.legs.map((l) => l.coords)]
  const points = lines.flat()
  const whole = fitViewport({ points, lines, size, padding: 56 * u, obstacles, gap: 20 * u })

  // ---- The background: the whole view, or (a following camera) a bigger picture the camera crops.
  let background: Viewport = whole
  let camera: VideoCamera = 'whole'
  let cameraNote: string | null = null
  if (options.camera === 'follow') {
    const dayBounds = timeline.slots.flatMap((slot) => (slot.kind === 'travel' && slot.bounds ? [slot.bounds] : []))
    const desired = pickFollowZoom(dayBounds, size, 90 * u, whole.zoom)
    const plan = desired === null ? null : planFollowBackground({ extent: extentOf(points), whole, size, desiredZoom: desired })
    if (plan) {
      background = plan.view
      camera = 'follow'
    } else if (desired === null) {
      cameraNote = 'This trip is so small that the whole of it is already as close as the camera zooms, so there is nothing to follow: the camera shows the whole trip.'
    } else {
      cameraNote = `A map to follow this trip on would need more than ${MAX_BACKGROUND_TILES} tiles or more than a canvas can hold, so the camera shows the whole trip.`
    }
  }
  const project = createProjector(background)

  // ---- Tiles and flags, in parallel.
  const grid = chooseTileGrid(background, scale, MAX_BACKGROUND_TILES)
  const refs = tilesOf(grid)
  const flagCodes = content && params.countriesStatus !== 'loading' ? content.countries.map((c) => c.code) : []
  const flagImages = new Map<string, CanvasImageSource>()
  const flagsLoaded = Promise.all(
    flagCodes.map(async (code) => {
      const image = await loadFlagImage(code, signal)
      if (image) flagImages.set(code, image)
    }),
  )
  const fetched = await (params.tiles ?? tileClient).fetchTiles(refs, { signal, retryFailed: params.retryFailedTiles, onProgress: params.onTiles })
  await flagsLoaded
  throwIfAborted(signal)

  const canvasWidth = Math.max(1, Math.round(width * scale))
  const canvasHeight = Math.max(1, Math.round(height * scale))
  const backdrop = document.createElement('canvas')
  backdrop.width = Math.max(1, Math.round(background.width * scale))
  backdrop.height = Math.max(1, Math.round(background.height * scale))
  const backdropCtx = backdrop.getContext('2d')
  if (!backdropCtx) throw new Error('This browser cannot draw the video.')
  backdropCtx.fillStyle = MAP_BACKGROUND
  backdropCtx.fillRect(0, 0, backdrop.width, backdrop.height)
  paintTiles(backdropCtx, grid, refs, (ref) => fetched.images.get(tileUrl(ref)), scale)

  // ---- What every frame shows.
  const clocks: FrameClock[] = []
  const samples: RideSample[] = []
  const facings: Facing[] = []
  const wheelAngles: number[] = []
  const moving: boolean[] = []
  const van: Point[] = []
  let facing: Facing | null = null
  let wheel = 0
  for (let i = 0; i < schedule.frames; i++) {
    const clock = frameClock(schedule, i)
    const sample = sampleTimeline(timeline, clock.rideTime)
    facing = nextFacing(facing, sample.heading)
    const going = clock.phase === 'ride' && !sample.resting && !sample.finished
    if (going) wheel += (2 * Math.PI) / (WHEEL_TURN_S * schedule.fps)
    clocks.push(clock)
    samples.push(sample)
    facings.push(facing)
    wheelAngles.push(wheel)
    moving.push(going)
    van.push(project(sample.position))
  }

  const wholeCamera = cameraOn(background, whole)
  const cameras: CameraFrame[] =
    camera === 'follow'
      ? planFollowCamera({ schedule, van, whole: wholeCamera, followZoom: background.zoom, size, focus: { x: width / 2, y: (panelRect.y - 10 * u) / 2 } })
      : planStillCamera(schedule.frames, wholeCamera)

  // ---- Geometry in background pixels: the planned route, each leg of the trail, the stops.
  const places = drawn.places.map((p) => project(p))
  const dimPlan = planLegs(drawn.legs)
  const dim: StyledPath[] = dimPlan.parts.map((part) => ({ part, path: buildPath(part.stretches, project) }))
  const legSlots: LegSlot[] = timeline.slots.flatMap((slot) => (slot.kind === 'travel' ? slot.legs : []))
  const trailParts = (slot: LegSlot, coords: readonly LatLng[], spans: LegSlot['spans'] | undefined) =>
    planLegParts({ mode: slot.mode, straight: false, status: 'ok', coords, spans }, true)
  const legPaths = new Map<number, StyledPath[]>()
  const doneTrail = createDoneTrail((k) => {
    let paths = legPaths.get(k)
    if (!paths) {
      const slot = legSlots[k]
      paths = slot ? trailParts(slot, slot.path.points, slot.spans).map((part) => ({ part, path: buildPath(part.stretches, project) })) : []
      legPaths.set(k, paths)
    }
    return paths
  })
  const badges = dimPlan.badges

  // ---- Names: once for the whole view (clear of the card, legend, day panel and credit) and once for the closer zoom.
  const pills = drawn.places.map((p) => layoutPill(displayName(p.name), undefined, measure))
  const toWholeScreen = (b: Point): Point => {
    const f = 2 ** (wholeCamera.zoom - background.zoom)
    return { x: (b.x - wholeCamera.x) * f + width / 2, y: (b.y - wholeCamera.y) * f + height / 2 }
  }
  const labelBounds: Rect = { x: 8 * u, y: 8 * u, width: width - 16 * u, height: height - 16 * u }
  const wholeNames = options.labels
    ? labelOffsets(places.map(toWholeScreen), pills, u, labelBounds, [cardRect, legendRect, panelRect, credit.rect].filter((r): r is Rect => r !== null))
    : { offsets: places.map(() => null), hidden: 0 }
  const followNames =
    options.labels && camera === 'follow'
      ? labelOffsets(places, pills, u, { x: 0, y: 0, width: background.width, height: background.height }, [])
      : wholeNames
  const hiddenLabels = camera === 'follow' ? followNames.hidden : wholeNames.hidden

  // ---- A still camera never moves the map: the backdrop and the planned route are painted once.
  let still: HTMLCanvasElement | null = null
  const stillCamera = cameras[0]
  const paintMap = (ctx: CanvasRenderingContext2D, cam: CameraFrame) => {
    const f = 2 ** (cam.zoom - background.zoom)
    const left = cam.x - width / (2 * f)
    const top = cam.y - height / (2 * f)
    ctx.fillStyle = MAP_BACKGROUND
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(backdrop, left * scale, top * scale, (width / f) * scale, (height / f) * scale, 0, 0, width, height)
    ctx.save()
    ctx.setTransform(scale * f, 0, 0, scale * f, -left * scale * f, -top * scale * f)
    for (const { part, path } of dim) if (part.casing) strokeBackgroundPath(ctx, path, part.casing, u, f, DIM_ALPHA)
    for (const { part, path } of dim) strokeBackgroundPath(ctx, path, part.line, u, f, DIM_ALPHA)
    ctx.restore()
  }
  if (camera === 'whole') {
    still = document.createElement('canvas')
    still.width = canvasWidth
    still.height = canvasHeight
    const stillCtx = still.getContext('2d')
    if (!stillCtx) throw new Error('This browser cannot draw the video.')
    stillCtx.setTransform(scale, 0, 0, scale, 0, 0)
    paintMap(stillCtx, stillCamera)
  }

  const clampIndex = (index: number) => Math.min(schedule.frames - 1, Math.max(0, Math.round(index)))
  const videoSecondsPerTimelineSecond = schedule.timelineS > 0 ? schedule.ride / schedule.timelineS : 0

  let disposed = false
  function draw(ctx: CanvasRenderingContext2D, index: number): void {
    if (disposed) return
    const i = clampIndex(index)
    const cam = cameras[i]
    const clock = clocks[i]
    const sample = samples[i]
    const f = 2 ** (cam.zoom - background.zoom)
    const left = cam.x - width / (2 * f)
    const top = cam.y - height / (2 * f)
    const toScreen = (b: Point): Point => ({ x: (b.x - left) * f, y: (b.y - top) * f })
    const onScreen = (p: Point, pad: number) => p.x > -pad && p.y > -pad && p.x < width + pad && p.y < height + pad

    ctx.save()
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.globalAlpha = 1

    // 1. The map and the planned route, faint.
    if (still) ctx.drawImage(still, 0, 0, width, height)
    else paintMap(ctx, cam)

    // 2. The trail: the legs travelled and the part of the current one, emphasised.
    const completed = sample.legIndex ?? sample.placeIndex
    doneTrail.show(completed)
    ctx.save()
    ctx.setTransform(scale * f, 0, 0, scale * f, -left * scale * f, -top * scale * f)
    const current: StyledPath[] = []
    if (sample.legIndex !== null) {
      const slot = legSlots[sample.legIndex]
      if (slot) {
        const upTo = sample.legProgress * slot.path.length
        const clipped = upTo >= slot.path.length ? { coords: slot.path.points, spans: slot.spans.length > 0 ? slot.spans : undefined } : clipPath(slot.path, slot.spans, upTo)
        for (const part of trailParts(slot, clipped.coords, clipped.spans)) current.push({ part, path: buildPath(part.stretches, project) })
      }
    }
    const trail = [...doneTrail.groups(), ...current]
    for (const { part, path } of trail) if (part.casing) strokeBackgroundPath(ctx, path, part.casing, u, f)
    for (const { part, path } of trail) strokeBackgroundPath(ctx, path, part.line, u, f)
    ctx.restore()

    // 3. The ferry, train and plane badges on the lines (faint like the route), the stops' rings, the markers.
    const screenProject = (p: LatLng) => toScreen(project(p))
    ctx.save()
    ctx.globalAlpha = DIM_ALPHA
    paintModeBadges(ctx, badges, screenProject, paint)
    ctx.restore()
    const markers = places.map((b, k) => ({ at: toScreen(b), number: k + 1 }))
    markers.forEach(({ at }, k) => {
      if (k > sample.placeIndex || !onScreen(at, 40 * u)) return
      const since = k === 0 ? clock.time : (clock.rideTime - timeline.arrivals[k]) * videoSecondsPerTimelineSecond
      paintStopHalo(ctx, at, u, since, sample.resting && k === sample.placeIndex ? clock.time : null)
    })
    paintMarkers(
      ctx,
      markers.filter(({ at }) => onScreen(at, 40 * u)),
      paint,
    )

    // 4. The names.
    const blend = labelBlend(cam.follow)
    if (options.labels && blend.alpha > 0.01) {
      const offsets = (blend.layout === 'follow' ? followNames : wholeNames).offsets
      const spots = markers.flatMap(({ at }, k) => {
        const o = offsets[k]
        if (!o) return []
        const rect = { x: at.x + o.dx, y: at.y + o.dy, width: o.width, height: o.height }
        return onScreen({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, 20 * u) ? [{ placed: { id: String(k), rect, side: o.side }, pill: o.pill }] : []
      })
      ctx.save()
      ctx.globalAlpha = blend.alpha
      paintLabels(ctx, spots, paint)
      ctx.restore()
    }

    // 5. The vehicle, with the day beside it.
    const parked = sample.resting || sample.finished
    const at = toScreen(van[i])
    const bob = moving[i] ? -BOB_PX * u * (0.5 - 0.5 * Math.cos((2 * Math.PI * clock.time) / BOB_PERIOD_S)) : 0
    const vehicleY = at.y + bob - (parked ? PARKED_LIFT * u : 0)
    if (onScreen(at, 120 * u)) {
      drawTransport(ctx, sample.mode, trip.vehicle, at.x, vehicleY, facings[i], VEHICLE_DRAW_WIDTH * u, { wheelAngle: wheelAngles[i], halo: true })
      paintDayTag(ctx, `Day ${sample.day}`, at.x, vehicleY - (27 + 1) * u, paint)
    }

    // 6. Over everything: the card (only while the whole trip is in view), the legend, the day panel and the credit.
    if (cardLayout && cardRect) {
      const alpha = cardAlpha(cam.follow)
      if (alpha > 0.01) {
        ctx.globalAlpha = alpha
        paintCard(ctx, cardLayout, cardRect, theme, flagImages, paint)
        ctx.globalAlpha = 1
      }
    }
    if (legendLayout && legendRect) paintLegend(ctx, legendLayout, LEGEND_FONT, legendRect, theme, paint)
    const caption = rideCaption(sample, names)
    const panel = layoutDayPanel(dayPanelContent(sample, caption, clock.rideProgress), theme, (font, text) => {
      ctx.font = font
      return ctx.measureText(text).width
    })
    paintDayPanel(ctx, panel, panelRect, theme, paint)
    const creditOpacity = creditAlpha(clock.time, schedule)
    if (creditOpacity > 0.005) {
      ctx.globalAlpha = creditOpacity
      paintCredit(ctx, credit.rect, credit.corner, creditPaint)
    }
    ctx.restore()
  }

  return {
    width,
    height,
    scale,
    canvasWidth,
    canvasHeight,
    schedule,
    camera,
    cameraNote,
    tiles: { total: fetched.total, failed: fetched.failed, zoom: grid.z },
    hiddenLabels,
    info(index) {
      const i = clampIndex(index)
      const sample = samples[i]
      return {
        index: i,
        time: clocks[i].time,
        phase: clocks[i].phase,
        day: sample.day,
        date: sample.date ?? null,
        caption: rideCaption(sample, names).text,
        follow: cameras[i].follow,
      }
    },
    draw,
    dispose() {
      disposed = true
      backdrop.width = 0
      backdrop.height = 0
      if (still) {
        still.width = 0
        still.height = 0
      }
    },
  }
}
