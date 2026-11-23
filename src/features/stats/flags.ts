// Framework-free: the statistics card shows these in <img>, the image export draws them on a canvas.

/**
 * URL of the 4:3 SVG flag of an ISO 3166-1 alpha-2 code ("de" or "DE"), or null for anything that is
 * not such a code. Windows has no emoji flags, so flags are images from the `flag-icons` package, which
 * `vite.config.ts` serves (dev) and copies (build) to `/flags/<code>.svg`; each file is only requested
 * when something displays it. The SVGs carry a viewBox but no width or height: size the <img> (or the
 * canvas draw call) yourself, 4:3.
 */
export function flagUrl(code: string): string | null {
  if (!/^[A-Za-z]{2}$/.test(code)) return null
  return `${import.meta.env.BASE_URL}flags/${code.toLowerCase()}.svg`
}
