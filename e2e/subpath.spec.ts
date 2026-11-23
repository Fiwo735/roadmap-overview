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
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(240_000)
  execFileSync('npx', ['vite', 'build', `--base=${BASE}`, '--outDir', OUT_DIR, '--emptyOutDir'], { stdio: 'pipe', timeout: 200_000 })
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
  expect(await page.locator('link[rel="icon"]').getAttribute('href')).toBe(`${BASE}favicon.svg`)
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
