import { modesInUse } from '../../lib/legModes'
import { abortError } from '../../lib/requestQueue'
import { effectiveDays } from '../../lib/trip'
import { tileClient, tileUrl, type TileClient } from '../../services/tiles'
import type { LatLng, Trip } from '../../types/trip'
import { displayName } from '../places/names'
import type { LegRouteInfo } from '../routing/legRoutes'
import type { TripStats } from '../stats/computeStats'
import { creditClearSides, IMAGE_CREDIT_TEXT, layoutCredit, placeCredit, PNG_COPYRIGHT_KEYWORD, PNG_COPYRIGHT_TEXT, type CreditMode } from './attribution'
import { buildCardContent, layoutCard, type CountriesStatus } from './card'
import { CARD_THEMES, type CardThemeName } from './cardTheme'
import { ensureFonts } from './fonts'
import { loadFlagImage } from './flagImages'
import { chooseTileGrid, createProjector, fitViewport, tilesOf, type Obstacle, type Rect } from './geometry'
import { placeLabels, type LabelRequest } from './labelPlacement'
import { layoutLegend, LEGEND_FONT } from './legend'
import { planLegs } from './legDrawing'
import { layoutPill, MARKER_RADIUS } from './markers'
import { LARGE_IMAGE_HINT, uiScaleFor } from './options'
import { addPngText } from './pngText'
import { unwrapTrip } from './unwrap'
import {
  MAP_BACKGROUND,
  paintCard,
  paintCredit,
  paintLabels,
  paintLegend,
  paintLegs,
  paintMarkers,
  paintModeBadges,
  paintTiles,
  type LabelSpot,
  type PaintScale,
} from './paint'

/** The most tiles one image may ask the tile server for; the zoom of the tiles is lowered to stay within it. */
export const MAX_TILES = 300

export interface RenderProgress {
  phase: 'tiles' | 'drawing'
  done: number
  total: number
}

export interface TripImageOptions {
  trip: Pick<Trip, 'title' | 'subtitle' | 'startDate' | 'places'>
  /** The legs with their routes, from `getLegRoutes()` / `useLegRoutes()`. */
  legs: readonly LegRouteInfo[]
  /** `computeTripStats(...)` of the same trip, with its countries. */
  stats: TripStats
  countriesStatus?: CountriesStatus
  /** Logical size of the image: the layout is made for it and 1× output has exactly these pixels. */
  width: number
  height: number
  /** Canvas pixels per logical pixel: 1 or 2 for the real thing, less for a preview. */
  scale: number
  /** The title and statistics card. */
  card: boolean
  labels: boolean
  days: boolean
  legend: boolean
  /**
   * Where the OpenStreetMap credit goes. Required: a picture of OSM tiles needs one, either drawn in it ('image') or
   * posted beside it ('beside'; the caller then owes the user that caption). See `attribution.ts`.
   */
  credit: CreditMode
  /** Colours of the card and legend. */
  theme: CardThemeName
  maxTiles?: number
  /** Ask again for tiles that failed a moment ago (an explicit download), instead of leaving a gap at once. */
  retryFailedTiles?: boolean
  signal?: AbortSignal
  onProgress?: (progress: RenderProgress) => void
  /** Where tiles come from (the shared client by default). */
  tiles?: TileClient<CanvasImageSource>
}

export interface TripImageResult {
  canvas: HTMLCanvasElement
  /** Pixel size of the canvas. */
  width: number
  height: number
  tiles: { total: number; failed: number; zoom: number }
  /** Places whose name had no room anywhere on the image. */
  hiddenLabels: number
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

/**
 * Draw the trip on a new canvas: OSM tiles fitted to the places and routes, the legs in their mode
 * styles, numbered markers with name labels, the title/statistics card, the legend and, when asked
 * for, the small OpenStreetMap credit. A tile that cannot be loaded leaves a gap (the result says how many); only an abort
 * or a browser that cannot make the canvas is an error.
 */
export async function renderTripImage(options: TripImageOptions): Promise<TripImageResult> {
  const { trip, legs, stats, width, height, signal, onProgress } = options
  const theme = CARD_THEMES[options.theme]
  throwIfAborted(signal)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * options.scale))
  canvas.height = Math.max(1, Math.round(height * options.scale))
  const scale = canvas.width / width
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(LARGE_IMAGE_HINT)

  const size = { width, height }
  const u = uiScaleFor(size)
  const paint: PaintScale = { scale, u }
  const { places } = trip
  const eff = effectiveDays(places)

  // Text first: sizes depend on the fonts being loaded.
  const content = options.card ? buildCardContent(trip, stats, options.countriesStatus ?? 'ready') : null
  await ensureFonts([
    ...places.map((p) => displayName(p.name)),
    content ? [content.title, content.subtitle, content.dateRange, content.hint ?? '', ...content.tiles.flatMap((t) => [t.label, t.value])].join(' ') : '',
    'Day 0123456789 km min — … ' + (options.credit === 'image' ? IMAGE_CREDIT_TEXT : '') + ' Drive Ferry Train Flight',
  ])
  throwIfAborted(signal)
  const measure = (font: string, text: string) => {
    ctx.font = font
    return ctx.measureText(text).width
  }

  // Overlays, in logical pixels, in the corners (as on the map).
  const margin = 20 * u
  const cardLayout = content ? layoutCard(content, measure) : null
  const cardRect: Rect | null = cardLayout ? { x: margin, y: margin, width: cardLayout.width * u, height: cardLayout.height * u } : null
  const legendModes = options.legend ? modesInUse(legs) : []
  const legendLayout = legendModes.length > 1 ? layoutLegend(legendModes, measure) : null
  const legendRect: Rect | null = legendLayout
    ? { x: margin, y: height - margin - legendLayout.height * u, width: legendLayout.width * u, height: legendLayout.height * u }
    : null
  const credit = options.credit === 'image' ? placeCredit(size, layoutCredit(measure), u, [cardRect, legendRect].filter((r): r is Rect => r !== null)) : null

  // The view: everything visible, clear of the card, the legend and the credit.
  const obstacles: Obstacle[] = []
  if (cardRect) obstacles.push({ rect: cardRect, clear: ['right', 'below'] })
  if (legendRect) obstacles.push({ rect: legendRect, clear: ['right', 'above'] })
  if (credit) obstacles.push({ rect: credit.rect, clear: creditClearSides(credit.corner) })
  const drawn = unwrapTrip(places, legs)
  const lines = [...drawn.places.map((p): LatLng[] => [p]), ...drawn.legs.map((l) => l.coords)]
  const view = fitViewport({ points: lines.flat(), lines, size, padding: 56 * u, obstacles, gap: 20 * u })
  const project = createProjector(view)

  // Tiles (capped) and flags, in parallel.
  const grid = chooseTileGrid(view, scale, options.maxTiles ?? MAX_TILES)
  const refs = tilesOf(grid)
  const flagCodes = content && options.countriesStatus !== 'loading' ? content.countries.map((c) => c.code) : []
  const flagImages = new Map<string, CanvasImageSource>()
  const flagsLoaded = Promise.all(
    flagCodes.map(async (code) => {
      const image = await loadFlagImage(code, signal) // the card falls back to the country code
      if (image) flagImages.set(code, image)
    }),
  )
  const fetched = await (options.tiles ?? tileClient).fetchTiles(refs, {
    signal,
    retryFailed: options.retryFailedTiles,
    onProgress: (done, total) => onProgress?.({ phase: 'tiles', done, total }),
  })
  await flagsLoaded
  throwIfAborted(signal)
  onProgress?.({ phase: 'drawing', done: 0, total: 1 })

  // Labels need the markers' positions.
  const markers = drawn.places.map((place, i) => ({ at: project(place), number: i + 1 }))
  const pills = new Map<string, ReturnType<typeof layoutPill>>()
  const requests: LabelRequest[] = []
  if (options.labels) {
    for (const i of labelOrder(places.length)) {
      const pill = layoutPill(displayName(places[i].name), options.days ? `Day ${eff[i]}` : undefined, measure)
      pills.set(places[i].id, pill)
      requests.push({ id: places[i].id, anchor: markers[i].at, radius: MARKER_RADIUS * u, width: pill.width * u, height: pill.height * u })
    }
  }
  const placed = placeLabels(requests, {
    bounds: { x: 8 * u, y: 8 * u, width: width - 16 * u, height: height - 16 * u },
    obstacles: [cardRect, legendRect, credit?.rect ?? null].filter((r): r is Rect => r !== null),
    offset: 6 * u,
    gap: 3 * u,
  })
  const labelSpots: LabelSpot[] = []
  for (const request of requests) {
    const spot = placed.get(request.id)
    const pill = pills.get(request.id)
    if (spot && pill) labelSpots.push({ placed: spot, pill })
  }

  // Paint, bottom to top.
  ctx.fillStyle = MAP_BACKGROUND
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  paintTiles(ctx, grid, refs, (ref) => fetched.images.get(tileUrl(ref)), scale)
  ctx.save()
  ctx.scale(scale, scale)
  const plan = planLegs(drawn.legs)
  paintLegs(ctx, plan, project, u)
  paintModeBadges(ctx, plan.badges, project, paint)
  paintMarkers(ctx, markers, paint)
  paintLabels(ctx, labelSpots, paint)
  if (cardLayout && cardRect) paintCard(ctx, cardLayout, cardRect, theme, flagImages, paint)
  if (legendLayout && legendRect) paintLegend(ctx, legendLayout, LEGEND_FONT, legendRect, theme, paint)
  if (credit) paintCredit(ctx, credit.rect, credit.corner, paint)
  ctx.restore()

  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    tiles: { total: fetched.total, failed: fetched.failed, zoom: grid.z },
    hiddenLabels: requests.length - placed.size,
  }
}

/** The canvas as a PNG file, with the OpenStreetMap copyright in its metadata whichever way the visible credit goes. */
export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error(LARGE_IMAGE_HINT)
  const png = addPngText(new Uint8Array(await blob.arrayBuffer()), PNG_COPYRIGHT_KEYWORD, PNG_COPYRIGHT_TEXT)
  return new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' })
}
