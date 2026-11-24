import { TileLayer, type Coords, type DoneCallback, type LeafletEvent, type TileEvent, type TileLayerOptions } from 'leaflet'
import { isAbortError } from '../../lib/requestQueue'
import { loadSeaTile, type SeaTile } from '../../services/seaTiles'

/** What Leaflet keeps of a tile (`GridLayer._tiles`). */
interface TileRecord {
  el: HTMLElement
  coords: Coords
  loaded?: number
}

/**
 * Leaflet's tile layer, with tiles that are canvases showing the standard OSM tile without the outlines
 * on the sea (`services/seaTiles.ts`) instead of images. Everything else is Leaflet's own: tile grid and
 * URLs, attribution, fading in, keeping old tiles on screen while new ones load, `tileerror` for tiles
 * that cannot be loaded. A tile whose bytes the browser may not read is shown as it comes (`data-tile-source="original"`).
 */
export class SeaTileLayer extends TileLayer {
  private readonly downloads = new WeakMap<HTMLElement, AbortController>()

  constructor(urlTemplate: string, options?: TileLayerOptions) {
    super(urlTemplate, options)
    // A tile the map no longer needs: its download stops once nothing else wants it.
    this.on('tileunload tileabort', (event: LeafletEvent) => this.downloads.get((event as TileEvent).tile)?.abort())
  }

  override createTile(coords: Coords, done: DoneCallback): HTMLElement {
    const tile = document.createElement('canvas')
    tile.setAttribute('role', 'presentation')
    const controller = new AbortController()
    this.downloads.set(tile, controller)
    loadSeaTile(this.getTileUrl(coords), { signal: controller.signal }).then(
      (source) => {
        try {
          show(tile, source)
        } catch (error) {
          done(error instanceof Error ? error : new Error(String(error)), tile)
          return
        }
        done(undefined, tile)
      },
      (error: unknown) => {
        if (isAbortError(error)) return // the tile was dropped
        done(error instanceof Error ? error : new Error(String(error)), tile)
      },
    )
    return tile
  }

  /**
   * Leaflet's version tells loaded tiles of other zooms from loading ones with `img.complete`, which a
   * canvas does not have: it would throw away every old tile the moment the zoom changes.
   */
  protected _abortLoading(): void {
    const tiles = (this as unknown as { _tiles: Record<string, TileRecord> })._tiles
    for (const key of Object.keys(tiles)) {
      const record = tiles[key]
      if (record.coords.z === (this as unknown as { _tileZoom?: number })._tileZoom || record.loaded) continue
      record.el.remove()
      delete tiles[key]
      this.fire('tileabort', { tile: record.el, coords: record.coords })
    }
  }
}

function show(tile: HTMLCanvasElement, source: SeaTile): void {
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height
  tile.width = width
  tile.height = height
  const ctx = tile.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas context')
  ctx.drawImage(source, 0, 0)
  tile.dataset.tileSource = source instanceof HTMLImageElement ? 'original' : 'processed'
}
