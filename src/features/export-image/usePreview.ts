import { useEffect, useRef, useState, type RefObject } from 'react'
import { isAbortError } from '../../lib/requestQueue'
import { renderTripImage, type TripImageOptions } from './renderTripImage'

/** What the preview needs of the render options: everything but how big, and what to do on the way. */
export type PreviewParams = Omit<TripImageOptions, 'scale' | 'signal' | 'onProgress'>

export interface PreviewInfo {
  tilesTotal: number
  tilesFailed: number
  hiddenLabels: number
}

export type PreviewState =
  | { status: 'idle' }
  /** Drawing for the first time. */
  | { status: 'rendering' }
  /** An image is showing and a newer one is on its way. */
  | { status: 'updating'; info: PreviewInfo }
  | { status: 'ready'; info: PreviewInfo }
  | { status: 'error'; message: string }

/** Pause after the last change before the preview is redrawn, so flipping a few switches draws once. */
export const PREVIEW_DEBOUNCE_MS = 250
/** The preview is drawn at most this many pixels on its longer side: cheap, and few tiles. */
export const PREVIEW_MAX_PX = 960

export const previewScaleFor = (width: number, height: number) => Math.min(1, PREVIEW_MAX_PX / Math.max(width, height))

/**
 * Draw `params` into `canvasRef` at preview size whenever they change (debounced; a drawing that is
 * overtaken is aborted). `null` params mean there is nothing to draw yet. Tiles come from the shared
 * client, so redrawing with other switches asks the tile server for nothing new.
 */
export function usePreview(canvasRef: RefObject<HTMLCanvasElement | null>, params: PreviewParams | null): PreviewState {
  // The outcome of the last drawing and the parameters it was drawn for; the state shown is derived from it.
  const [last, setLast] = useState<{ params: PreviewParams; info?: PreviewInfo; error?: string } | null>(null)
  const shown = useRef(false)

  useEffect(() => {
    if (!params) return
    const controller = new AbortController()
    const timer = setTimeout(
      async () => {
        try {
          const result = await renderTripImage({ ...params, scale: previewScaleFor(params.width, params.height), signal: controller.signal })
          const target = canvasRef.current
          if (controller.signal.aborted || !target) return
          target.width = result.width
          target.height = result.height
          target.getContext('2d')?.drawImage(result.canvas, 0, 0)
          shown.current = true
          setLast({ params, info: { tilesTotal: result.tiles.total, tilesFailed: result.tiles.failed, hiddenLabels: result.hiddenLabels } })
        } catch (error) {
          if (isAbortError(error) || controller.signal.aborted) return
          setLast({ params, error: error instanceof Error ? error.message : 'The preview could not be drawn.' })
        }
      },
      shown.current ? PREVIEW_DEBOUNCE_MS : 0,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [canvasRef, params])

  if (!params) return { status: 'idle' }
  if (last?.params === params) return last.error !== undefined ? { status: 'error', message: last.error } : { status: 'ready', info: last.info as PreviewInfo }
  return last?.info ? { status: 'updating', info: last.info } : { status: 'rendering' }
}
