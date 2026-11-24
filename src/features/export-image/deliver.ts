// Getting the finished PNG out of the page: a download or the clipboard.

/** Offer `blob` to the browser as a file called `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // The download has started by the time a macrotask has passed; the URL is not needed after that.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Whether this browser can put an image on the clipboard (needs a secure context). */
export function canCopyImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.clipboard?.write === 'function'
}

/**
 * Put a PNG on the clipboard, and only the PNG: with text beside the image, text fields and many chat and
 * markdown apps paste the text instead of the picture. The image is passed as a promise so that the
 * clipboard write is started inside the click that asked for it (Safari insists), while the image is
 * still being drawn.
 */
export async function copyPng(png: Promise<Blob>): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

/** Whether plain text can be put on the clipboard (needs a secure context). */
export const canCopyText = (): boolean => typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'

/** Put `text` on the clipboard; false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
