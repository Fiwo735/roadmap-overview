/**
 * Link previews (Open Graph, X/Twitter cards) need an absolute image URL, which only the deployment knows: the page
 * can say where the picture is relative to itself, not on which host it is served. `VITE_SITE_URL` at build time is
 * that address (GitHub Pages' `base_url`, which is the owner's custom domain once there is one). Without it the
 * previews keep the path under the app's base, which is right for a local build and wrong only for link scrapers.
 * Used by `vite.config.ts` (the `sitePreview` plugin); pure, so `sitePreview.test.ts` covers it.
 */

/** The site's root as a URL ending in a slash, or `null` when none was given. Anything but http(s) is a mistake. */
export function siteRoot(siteUrl: string | undefined): string | null {
  const text = siteUrl?.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error(`VITE_SITE_URL must be an http(s) URL such as https://example.com/app, got "${text}".`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`VITE_SITE_URL must be an http(s) URL such as https://example.com/app, got "${text}".`)
  }
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

const IMAGE_META = /(<meta\s+(?:property|name)="(?:og:image|twitter:image)"\s+content=")([^"]*)(")/g

/**
 * `html` as Vite made it (asset paths already under `base`): the preview images get their absolute URL on the site,
 * and `og:url` is added. With no site URL the page is returned as it is.
 */
export function withSiteUrl(html: string, siteUrl: string | undefined, base: string): { html: string; url: string | null } {
  const root = siteRoot(siteUrl)
  if (!root) return { html, url: null }
  const absolute = (content: string) => {
    const path = content.startsWith(base) ? content.slice(base.length) : content.replace(/^\/+/, '')
    return new URL(path, root).href
  }
  return { html: html.replace(IMAGE_META, (_all, open: string, content: string, close: string) => open + absolute(content) + close), url: root }
}
