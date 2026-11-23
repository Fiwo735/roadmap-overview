/**
 * Where the app is hosted: Vite's `base` ("/" at a domain root, "/roadmap-overview/" on GitHub Pages).
 * Anything the page asks the server for by a root-relative path (flags, the sample trip) goes through
 * `assetUrl`, so the app keeps working under a sub-path. `base` is a parameter for the tests.
 */
export function assetUrl(path: string, base: string = import.meta.env.BASE_URL): string {
  const root = base.endsWith('/') ? base : `${base}/`
  return root + path.replace(/^\/+/, '')
}
