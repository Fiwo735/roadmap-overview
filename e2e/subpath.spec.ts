import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from './fixtures'

/**
 * The app hosted under a sub-path (GitHub Pages: `https://user.github.io/roadmap-overview/`): the production
 * build is made once with `--base=/roadmap-overview/` and served from the test's own page routes, so the
 * dev server (which serves from `/`) is not involved. Everything the page asks for by an absolute path
 * (the flags, the sample trip, the scripts and styles) has to carry the base.
 */
const BASE = '/roadmap-overview/'
const OUT_DIR = resolve('node_modules/.cache/e2e-subpath')
/** A second build, for a deployment that does not know its address (VITE_SITE_URL unset): the link preview keeps a path. */
const OUT_DIR_PLAIN = resolve('node_modules/.cache/e2e-subpath-plain')
/** What the deploy workflow passes from `actions/configure-pages` (`base_url`: the site's address, with no trailing slash). */
const SITE_URL = 'https://example.test/roadmap-overview'
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(240_000)
  const build = (outDir: string, siteUrl: string) =>
    execFileSync('npx', ['vite', 'build', `--base=${BASE}`, '--outDir', outDir, '--emptyOutDir'], {
      stdio: 'pipe',
      timeout: 200_000,
      env: { ...process.env, VITE_SITE_URL: siteUrl },
    })
  build(OUT_DIR, SITE_URL)
  build(OUT_DIR_PLAIN, '')
})

interface Served {
  /** Paths (below the origin) the page asked this server for. */
  asked: string[]
  /** Asked for, but not in the build. */
  missing: string[]
  /** Local requests outside the sub-path (they would hit the dev server, i.e. nothing of the app). */
  outside: string[]
}

/** Serve the build under BASE for every page of `context`. */
async function serve(context: BrowserContext): Promise<Served> {
  const served: Served = { asked: [], missing: [], outside: [] }
  await context.route(
    (url) => ['127.0.0.1', 'localhost'].includes(url.hostname),
    async (route) => {
      const { pathname } = new URL(route.request().url())
      if (!pathname.startsWith(BASE)) {
        served.outside.push(pathname)
        return route.fulfill({ status: 404, body: 'outside the base' })
      }
      served.asked.push(pathname)
      const relative = normalize(pathname.slice(BASE.length) || 'index.html')
      const file = join(OUT_DIR, relative.endsWith('/') ? `${relative}index.html` : relative)
      if (relative.startsWith('..') || !existsSync(file)) {
        served.missing.push(pathname)
        return route.fulfill({ status: 404, body: 'not found' })
      }
      await route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) })
    },
  )
  return served
}

/** A request made by the page itself (`page.request` would bypass the routes that serve the build under the base). */
const fetched = (page: Page, url: string) =>
  page.evaluate(async (href) => {
    const response = await fetch(href)
    return { status: response.status, type: response.headers.get('content-type'), text: await response.text() }
  }, url)

const ready = async (page: Page) => {
  await expect(page.getByTestId('trip-card')).toBeVisible()
  await page.waitForSelector('.leaflet-tile-loaded')
}

test('the app starts under the sub-path, and every file it needs is found there', async ({ page, context }) => {
  const served = await serve(context)
  await page.goto(BASE)
  await ready(page)
  expect(served.missing).toEqual([])
  expect(served.outside).toEqual([])
  expect(served.asked.some((p) => /\/assets\/.+\.js$/.test(p))).toBe(true)
  // The favicon link carries the base too.
  expect(await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href')).toBe(`${BASE}favicon.svg`)
})

test('the sample trip, the country flags and the share link all use the sub-path', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const served = await serve(context)
  await page.goto(BASE)
  await ready(page)

  await page.getByTestId('file-menu').click()
  await page.getByRole('menuitem', { name: 'Load sample trip' }).click()
  await expect(page.getByTestId('place-item')).toHaveCount(12)
  expect(served.asked).toContain(`${BASE}samples/hamburg-fjords.trip.json`)

  // Flags: images from <base>flags/, and they really loaded.
  const flags = page.getByTestId('country-flag').locator('img')
  await expect(flags.first()).toBeVisible()
  expect(await flags.count()).toBeGreaterThan(1)
  for (const flag of await flags.all()) {
    expect(await flag.getAttribute('src')).toMatch(/^\/roadmap-overview\/flags\/[a-z]{2}\.svg$/)
    await expect.poll(() => flag.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  }

  await page.getByTestId('file-menu').click()
  await page.getByRole('menuitem', { name: 'Copy share link' }).click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(new URL(link).pathname).toBe(BASE)
  expect(link).toContain('#trip=')
  await page.getByTestId('file-menu').click()
  await page.getByRole('menuitem', { name: 'Copy presentation link' }).click()
  const presentation = await page.evaluate(() => navigator.clipboard.readText())
  expect(new URL(presentation).pathname).toBe(BASE)
  expect(presentation).toMatch(/&present$/)

  // The link opens the trip in a fresh page of the same site.
  const other = await context.newPage()
  await other.goto(presentation)
  await expect(other.getByTestId('trip-card')).toBeVisible()
  await expect(other.locator('.place-marker')).toHaveCount(12)
  await expect(other.getByTestId('sidebar')).toBeHidden()

  expect(served.missing).toEqual([])
  expect(served.outside).toEqual([])
})

test('?src= opens a trip file that sits beside the app', async ({ page, context }) => {
  const served = await serve(context)
  await page.goto(`${BASE}?src=samples/hamburg-fjords.trip.json`)
  await expect(page.getByTestId('place-item')).toHaveCount(12)
  expect(served.asked).toContain(`${BASE}samples/hamburg-fjords.trip.json`)
  expect(served.missing).toEqual([])
})

test('the icons, the manifest and the link preview picture are all found under the sub-path', async ({ page, context }) => {
  const served = await serve(context)
  await page.goto(BASE)
  await ready(page)

  // Every icon link carries the base, and so does the manifest.
  const hrefs = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]').evaluateAll((els) => els.map((el) => el.getAttribute('href')))
  expect(hrefs).toEqual([
    `${BASE}favicon-32.png`,
    `${BASE}favicon-16.png`,
    `${BASE}favicon.svg`,
    `${BASE}apple-touch-icon.png`,
    `${BASE}manifest.webmanifest`,
  ])
  // The logo in the top bar is the favicon asset under the base, and it really drew.
  const logo = page.locator('.brand img.logo')
  await expect(logo).toHaveAttribute('src', `${BASE}favicon.svg`)
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)

  // The manifest's icons are relative to it, so they land under the base too, and so does the start page.
  const manifestUrl = new URL(`${BASE}manifest.webmanifest`, page.url())
  const manifestResponse = await fetched(page, manifestUrl.href)
  expect(manifestResponse.status).toBe(200)
  expect(manifestResponse.type).toBe('application/manifest+json')
  const manifest = JSON.parse(manifestResponse.text) as { name: string; start_url: string; scope: string; icons: { src: string; type: string }[] }
  expect(manifest.name).toBe('Vanagram')
  expect(new URL(manifest.start_url, manifestUrl).pathname).toBe(BASE)
  expect(new URL(manifest.scope, manifestUrl).pathname).toBe(BASE)
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3)
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, manifestUrl)
    expect(url.pathname.startsWith(BASE), icon.src).toBe(true)
    const response = await fetched(page, url.href)
    expect(response.status, icon.src).toBe(200)
    expect(response.type).toBe(icon.type)
  }
  for (const path of ['favicon-16.png', 'favicon-32.png', 'favicon.svg', 'apple-touch-icon.png', 'og-image.png']) {
    expect((await fetched(page, `${BASE}${path}`)).status, path).toBe(200)
  }
  expect(served.outside).toEqual([])
})

test('the link preview picture is an absolute URL on the site when the build knows it (the deploy workflow gives it)', async ({ page, context }) => {
  const served = await serve(context)
  await page.goto(BASE)
  await ready(page)
  const content = (selector: string) => page.locator(selector).getAttribute('content')
  const image = `${SITE_URL}/og-image.png`
  expect(await content('meta[property="og:image"]')).toBe(image)
  expect(await content('meta[name="twitter:image"]')).toBe(image)
  expect(await content('meta[property="og:url"]')).toBe(`${SITE_URL}/`)
  expect(await content('meta[name="twitter:card"]')).toBe('summary_large_image')
  // The picture it names exists in the build at the same place under the site's path (the scraper would ask the real host for it).
  const onSite = new URL(image).pathname
  expect(onSite.startsWith(BASE)).toBe(true)
  expect(existsSync(join(OUT_DIR, onSite.slice(BASE.length)))).toBe(true)
  expect(served.missing).toEqual([])
})

test('without a site URL the link preview picture stays a path under the base', () => {
  const html = readFileSync(join(OUT_DIR_PLAIN, 'index.html'), 'utf8')
  expect(html).toContain(`<meta property="og:image" content="${BASE}og-image.png"`)
  expect(html).toContain(`<meta name="twitter:image" content="${BASE}og-image.png"`)
  expect(html).not.toContain('og:url')
  expect(html).toContain(`href="${BASE}favicon.svg"`)
  expect(html).toContain(`href="${BASE}manifest.webmanifest"`)
})
