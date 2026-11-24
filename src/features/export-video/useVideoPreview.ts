import { useEffect, useRef, useState } from 'react'
import { isAbortError } from '../../lib/requestQueue'
import { PREVIEW_DEBOUNCE_MS, previewScaleFor } from '../export-image/usePreview'
import { videoSize } from './options'
import { prepareVideoScene, type VideoScene, type VideoSceneParams } from './scene'

/** What the preview needs of the scene's parameters: everything but how big it is drawn and what to do on the way. */
export type VideoPreviewParams = Omit<VideoSceneParams, 'scale' | 'signal' | 'onTiles' | 'retryFailedTiles'>

export type VideoPreviewState =
  | { status: 'idle' }
  /** Preparing for the first time. */
  | { status: 'rendering' }
  /** A scene is showing and a newer one is on its way. */
  | { status: 'updating'; scene: VideoScene }
  | { status: 'ready'; scene: VideoScene }
  | { status: 'error'; message: string }

/**
 * Prepare the video's scene at preview size whenever `params` change (debounced; one that is overtaken is aborted), so the dialog
 * can draw any frame of it at once. Tiles come from the shared client, so changing the switches asks the tile server for nothing new.
 * A scene that is replaced is let go of (its drawing then does nothing).
 */
export function useVideoPreview(params: VideoPreviewParams | null): VideoPreviewState {
  const [last, setLast] = useState<{ params: VideoPreviewParams; scene?: VideoScene; error?: string } | null>(null)
  const latest = useRef<VideoScene | null>(null)
  const shown = useRef(false)

  useEffect(() => {
    if (!params) return
    const controller = new AbortController()
    const timer = setTimeout(
      async () => {
        const { width, height } = videoSize(params.options.preset)
        try {
          const scene = await prepareVideoScene({ ...params, scale: previewScaleFor(width, height), signal: controller.signal })
          if (controller.signal.aborted) {
            scene.dispose()
            return
          }
          const previous = latest.current
          latest.current = scene
          shown.current = true
          setLast({ params, scene })
          previous?.dispose()
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
  }, [params])

  useEffect(
    () => () => {
      latest.current?.dispose()
      latest.current = null
    },
    [],
  )

  if (!params) return { status: 'idle' }
  if (last?.params === params) return last.error !== undefined ? { status: 'error', message: last.error } : { status: 'ready', scene: last.scene as VideoScene }
  return last?.scene ? { status: 'updating', scene: last.scene } : { status: 'rendering' }
}
