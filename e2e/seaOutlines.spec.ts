import type { Page } from '@playwright/test'
import { expect, test, type App } from './fixtures'
import { makeSeaTilePng, SEA_TILE } from './mocks/tiles'

// The borders and other outlines the OSM style draws on the sea are hidden (src/lib/seaOutlines.ts), on
// the map and in the exported image. The mocked tile server serves a tile of sea with a boundary and a
// protected area's outline across it, a ferry line, land with a border over it and a label.

const TILE = SEA_TILE
const WATER = [...TILE.water]

/** The RGB of a pixel of the first loaded map tile (every tile is the same picture). */
const tilePixel = (page: Page, x: number, y: number) =>
  page.locator('canvas.leaflet-tile-loaded').first().evaluate((canvas: HTMLCanvasElement, [px, py]) => Array.from(canvas.getContext('2d')!.getImageData(px, py, 1, 1).data).slice(0, 3), [x, y])

async function expectOutlinesHidden(page: Page) {
  await expect.poll(() => page.locator('canvas.leaflet-tile-loaded').count()).toBeGreaterThan(3)
  // What is hidden: the boundary's core and casing, the protected area's outline.
  expect(await tilePixel(page, 30, TILE.borderRow)).toEqual(WATER)
  expect(await tilePixel(page, 30, TILE.borderRow - 1)).toEqual(WATER)
  expect(await tilePixel(page, 130, TILE.borderRow + 1)).toEqual(WATER)
  expect(await tilePixel(page, TILE.outlineColumn, 20)).toEqual(WATER)
  expect(await tilePixel(page, TILE.outlineColumn, 150)).toEqual(WATER)
  // What stays: the ferry line, land and the border on it, the label's halo and its text.
  expect(await tilePixel(page, 30, TILE.ferryRow)).toEqual([...TILE.ferry])
  expect(await tilePixel(page, 200, 180)).toEqual([...TILE.land])
  expect(await tilePixel(page, 200, TILE.landBorderRow)).toEqual([...TILE.landBorder])
  expect(await tilePixel(page, TILE.haloBox.x + 2, TILE.haloBox.y + 2)).toEqual([...TILE.halo])
  expect(await tilePixel(page, TILE.textPixel.x, TILE.textPixel.y)).toEqual([...TILE.text])
}

test.describe('the map without the outlines on the sea', () => {
  test('tiles are drawn without the boundary and the protected area outline, and keep everything else', async ({ page, app, mocks }) => {
    mocks.tiles.png = makeSeaTilePng()
    await app.goto()
    await expectOutlinesHidden(page)
    await expect(page.locator('canvas.leaflet-tile-loaded[data-tile-source="processed"]').first()).toBeVisible()
    expect(mocks.blocked).toEqual([])
  })

  test('also where the browser has no Web Worker: the page does it itself', async ({ page, app, mocks }) => {
    mocks.tiles.png = makeSeaTilePng()
    await page.addInitScript(() => Reflect.deleteProperty(window, 'Worker'))
    await app.goto()
    await expectOutlinesHidden(page)
  })

  test('a tile whose pixels the page may not read is shown as it comes', async ({ page, app, mocks }) => {
    mocks.tiles.png = makeSeaTilePng()
    mocks.tiles.cors = false
    await app.goto()
    const tile = page.locator('canvas.leaflet-tile-loaded').first()
    await expect(tile).toHaveAttribute('data-tile-source', 'original')
    // Not readable (the canvas is tainted), but it is drawn: the page does not show holes.
    expect(await tile.evaluate((canvas: HTMLCanvasElement) => { try { canvas.getContext('2d')!.getImageData(0, 0, 1, 1); return 'readable' } catch { return 'tainted' } })).toBe('tainted')
    expect(await page.locator('.leaflet-tile-loaded').count()).toBeGreaterThan(3)
  })

  test('a server that refuses CORS is asked once per tile after the first picture: the rest are loaded plainly', async ({ page, app, mocks }) => {
    mocks.tiles.png = makeSeaTilePng()
    mocks.tiles.cors = false
    await app.goto()
    await expect.poll(() => page.locator('.leaflet-tile:not(.leaflet-tile-loaded)').count()).toBe(0)
    const asked = mocks.tiles.urls.length
    // Far away, so every tile is a new one.
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.panBy([4000, 0], { animate: false }))
    await expect.poll(() => page.locator('.leaflet-tile:not(.leaflet-tile-loaded)').count()).toBe(0)
    const fresh = mocks.tiles.urls.slice(asked)
    expect(fresh.length).toBeGreaterThan(3)
    expect(new Set(fresh).size).toBe(fresh.length) // one request each
    expect(await page.locator('canvas[data-tile-source="original"].leaflet-tile-loaded').count()).toBeGreaterThan(3)
  })

  test('a worker that never answers leaves no tile blank: the page does them after a few seconds', async ({ page, app, mocks }) => {
    mocks.tiles.png = makeSeaTilePng()
    await page.addInitScript(() => {
      class StuckWorker {
        postMessage() {}
        terminate() {}
      }
      Object.assign(window, { Worker: StuckWorker })
    })
    await app.goto()
    await expectOutlinesHidden(page)
  })

  test('tiles that cannot be loaded are no tiles, as before, and are not asked for again', async ({ page, mocks }) => {
    mocks.tiles.failWith = 'http-500'
    await page.goto('/')
    await page.waitForFunction(() => window.__ROADMAP__?.getMap() != null)
    await expect.poll(() => mocks.tiles.requests).toBeGreaterThan(3)
    const asked = async () => {
      await page.waitForTimeout(500)
      return mocks.tiles.requests
    }
    const first = await asked()
    expect(await asked()).toBe(first)
    expect(await page.locator('.leaflet-tile-loaded').count()).toBe(0)
    await expect(page.getByTestId('sidebar')).toBeVisible()
  })

  test('tiles that were seen once are kept: nothing is downloaded or processed twice when the map comes back', async ({ page, app }) => {
    await page.addInitScript(() => {
      const asked: string[] = []
      Object.assign(window, { __tileFetches: asked })
      const original = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.startsWith('https://tile.openstreetmap.org/')) asked.push(url)
        return original(input, init)
      }
    })
    await app.goto()
    const fetches = () => page.evaluate(() => (window as unknown as { __tileFetches: string[] }).__tileFetches)
    const settle = async () => {
      await expect.poll(() => page.locator('.leaflet-tile:not(.leaflet-tile-loaded)').count()).toBe(0)
      await page.waitForTimeout(200)
    }
    await settle()
    const home = await app.mapView()
    // Far enough away that the first tiles are dropped (Leaflet keeps a ring of tiles around the view), then back.
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.panBy([6000, 0], { animate: false }))
    await settle()
    const away = (await fetches()).length
    expect(away).toBeGreaterThan(0)
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.panBy([-6000, 0], { animate: false }))
    await settle()
    expect((await fetches()).length).toBe(away) // coming back asked for nothing
    expect((await app.mapView()).lng).toBeCloseTo(home.lng, 3)
  })

  test('old tiles stay on screen while the tiles of a new zoom load', async ({ page, app, mocks }) => {
    await app.goto()
    await expect.poll(() => page.locator('.leaflet-tile:not(.leaflet-tile-loaded)').count()).toBe(0)
    mocks.tiles.delayMs = 1500
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setZoom(5)) // animated, like the zoom buttons and the wheel
    await page.waitForTimeout(300)
    // The tiles of the earlier zoom are still there (and still loaded) while the ones for the new zoom are on their way.
    expect(await page.locator('.leaflet-tile:not(.leaflet-tile-loaded)').count()).toBeGreaterThan(3)
    expect(await page.locator('canvas.leaflet-tile-loaded').count()).toBeGreaterThan(3)
    await expect.poll(() => page.locator('.leaflet-tile:not(.leaflet-tile-loaded)').count(), { timeout: 15_000 }).toBe(0)
  })
})

async function openExport(page: Page, app: App) {
  await app.goto()
  await app.addPlaces('Lyon', 'Annecy')
  await expect(page.getByTestId('leg-connector').first()).toHaveAttribute('data-status', 'ok')
  await page.getByTestId('export-image-button').click()
  await expect(page.getByTestId('export-preview')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
}

/** Pixels of the colours between the water and a boundary's purple, whatever is drawn over them: what is left of a boundary on the sea. */
const BOUNDARY_PIXELS = `(r < 168 && Math.abs(r - g) <= 6 && b - g >= 18 && b - g <= 32)`

test.describe('the exported image without the outlines on the sea', () => {
  test('the preview has the tiles, but no boundary on them', async ({ page, app, mocks }) => {
    mocks.tiles.png = makeSeaTilePng()
    await openExport(page, app)
    const count = (predicate: string) =>
      page.getByTestId('export-preview').evaluate((canvas: HTMLCanvasElement, source) => {
        const test = new Function('r', 'g', 'b', `return ${source}`) as (r: number, g: number, b: number) => boolean
        const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
        let n = 0
        for (let i = 0; i < data.length; i += 4) if (test(data[i], data[i + 1], data[i + 2])) n++
        return n
      }, predicate)

    // The tiles are there (sea, land, halos)...
    expect(await count('r === 170 && g === 211 && b === 223')).toBeGreaterThan(1_000)
    expect(await count('r === 242 && g === 239 && b === 233')).toBeGreaterThan(100)
    // ...and nothing of the boundary and the outline across them.
    expect(await count(BOUNDARY_PIXELS)).toBe(0)

    // The same measure finds the boundary in the picture the tile server sends, so it does measure something.
    const unprocessed = await page.evaluate(async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob())
      const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height })
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      let n = 0
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
        if (r < 168 && Math.abs(r - g) <= 6 && b - g >= 18 && b - g <= 32) n++
      }
      return n
    }, mocks.tiles.urls[0])
    expect(unprocessed).toBeGreaterThan(500)
  })
})
