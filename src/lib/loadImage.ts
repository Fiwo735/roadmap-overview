import { abortError } from './requestQueue'

export interface LoadImageOptions {
  signal?: AbortSignal
  /** Set for images that are drawn on a canvas that is read back afterwards (tiles), or the canvas becomes tainted. */
  crossOrigin?: 'anonymous'
  /** Fails after this long. */
  timeoutMs?: number
}

/**
 * Load an image into an <img> that is not on the page, ready to be drawn on a canvas. Resolves when it
 * has loaded and decoded, rejects when it cannot be loaded, times out or is aborted (an AbortError).
 */
export function loadImage(src: string, { signal, crossOrigin, timeoutMs = 20_000 }: LoadImageOptions = {}): Promise<HTMLImageElement> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const img = new Image()
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (settle: () => void) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      img.onload = null
      img.onerror = null
      settle()
    }
    const onAbort = () =>
      finish(() => {
        img.src = '' // stops the download
        reject(abortError())
      })
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(
      () =>
        finish(() => {
          img.src = ''
          reject(new Error(`Timed out loading ${src}`))
        }),
      timeoutMs,
    )
    img.onload = () => finish(() => resolve(img))
    img.onerror = () => finish(() => reject(new Error(`Could not load ${src}`)))
    if (crossOrigin) img.crossOrigin = crossOrigin
    img.decoding = 'async'
    img.src = src
  })
}
