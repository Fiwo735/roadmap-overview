import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import type { TripFile } from '../src/types/trip'
import { expect, test, type App } from './fixtures'

// lz-string is a CommonJS package: Node's ESM loader only exposes it through require.
const lz = createRequire(import.meta.url)('lz-string') as typeof import('lz-string')

const sampleFile = (): TripFile => JSON.parse(readFileSync('public/samples/hamburg-fjords.trip.json', 'utf8')) as TripFile

const toggle = (page: Page) => page.getByTestId('present-toggle')
const sidebar = (page: Page) => page.getByTestId('sidebar')
const app$ = (page: Page) => page.locator('.app')
const fileMenu = (page: Page) => page.getByTestId('file-menu')
const marker = (page: Page, i: number) => page.locator('.place-marker').nth(i)

/** The sample trip (12 places, routes included, notes on some places) laid out on the map. */
async function openSample(page: Page, app: App, path = '/') {
  await app.seedSavedTrip(sampleFile())
  await app.goto(path)
  await page.getByTestId('fit-trip').click()
  await app.settle()
}

const isPresenting = (page: Page) => app$(page).evaluate((el) => el.getAttribute('data-presenting') === 'true')

test.describe('presentation mode', () => {
  test('the toggle hides the sidebar and the editing buttons and gives the map the whole width', async ({ page, app }) => {
    await openSample(page, app)
    await expect(sidebar(page)).toBeVisible()
    await expect(page.getByTestId('undo')).toBeVisible()
    const before = (await page.getByTestId('map-area').boundingBox())!
    expect(before.x).toBe(360)

    await toggle(page).click()
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
    expect(await isPresenting(page)).toBe(true)
    await expect(sidebar(page)).toBeHidden()
    await expect(page.getByTestId('undo')).toBeHidden()
    await expect(page.getByTestId('redo')).toBeHidden()
    const after = (await page.getByTestId('map-area').boundingBox())!
    expect(after.x).toBe(0)
    expect(after.width).toBe(1440)
    // The map, the title card and the ride stay. Travel times read in hours, never days.
    await expect(page.getByTestId('trip-card')).toBeVisible()
    await expect(page.getByTestId('stat-driving-value')).toHaveText('34 h 28 min')
    await expect(page.getByTestId('ride-button')).toBeVisible()
    await expect(page.getByTestId('map-tools')).toBeVisible()
    await expect(page.locator('.place-marker')).toHaveCount(12)
    // The whole trip is in view again in the wider map.
    await app.settle()
    const view = await page.evaluate(() => {
      const map = window.__ROADMAP__!.getMap()!
      const size = map.getSize()
      return window.__ROADMAP__!.trip.getState().trip.places.map((p) => {
        const at = map.latLngToContainerPoint([p.lat, p.lng])
        return at.x >= 0 && at.y >= 0 && at.x <= size.x && at.y <= size.y
      })
    })
    expect(view.every(Boolean)).toBe(true)

    await toggle(page).click()
    await expect(sidebar(page)).toBeVisible()
    await expect(page.getByTestId('undo')).toBeVisible()
    expect((await page.getByTestId('map-area').boundingBox())!.x).toBe(360)
  })

  test('P toggles it, Escape leaves it, and P is just a letter in a text field', async ({ page, app }) => {
    await openSample(page, app)
    await page.keyboard.press('p')
    expect(await isPresenting(page)).toBe(true)
    await page.keyboard.press('Escape')
    expect(await isPresenting(page)).toBe(false)
    await page.keyboard.press('Shift+P')
    expect(await isPresenting(page)).toBe(false)

    // Typing a p in the trip title does not toggle anything.
    await page.getByTestId('trip-title').click()
    await page.keyboard.type('Pp')
    expect(await isPresenting(page)).toBe(false)
    await page.keyboard.press('Escape')
    // Nor does Ctrl+P (print), and nor does a letter typed into a menu.
    await page.keyboard.press('Control+p')
    expect(await isPresenting(page)).toBe(false)
    await fileMenu(page).click()
    await page.keyboard.press('p')
    expect(await isPresenting(page)).toBe(false)
    await page.keyboard.press('Escape')

    // Escape in the title (a field) belongs to the field; it does not leave the mode.
    await page.keyboard.press('p')
    expect(await isPresenting(page)).toBe(true)
    await page.getByTestId('trip-title').focus()
    await page.keyboard.press('Escape')
    expect(await isPresenting(page)).toBe(false)
  })

  test('?present opens straight into it, a reload stays in it, leaving takes it out of the address', async ({ page, app }) => {
    await openSample(page, app, '/?present')
    expect(await isPresenting(page)).toBe(true)
    await expect(sidebar(page)).toBeHidden()
    expect((await page.getByTestId('map-area').boundingBox())!.x).toBe(0)

    await page.reload()
    await app.ready()
    expect(await isPresenting(page)).toBe(true)

    await page.keyboard.press('Escape')
    expect(await isPresenting(page)).toBe(false)
    expect(new URL(page.url()).search).toBe('')
    await page.reload()
    await app.ready()
    expect(await isPresenting(page)).toBe(false)
  })

  test('a link with &present after the trip opens it in presentation mode', async ({ page, app }) => {
    const file = sampleFile()
    const { routes: _routes, ...withoutRoutes } = file
    const hash = '#trip=' + lz.compressToEncodedURIComponent(JSON.stringify(withoutRoutes))
    await app.goto('/' + hash + '&present')
    expect(await isPresenting(page)).toBe(true)
    expect((await app.trip()).places).toHaveLength(12)
    await expect(sidebar(page)).toBeHidden()
    // The hash is gone (a reload must not import it again), the wish for presentation stays in the query.
    expect(new URL(page.url()).hash).toBe('')
    expect(new URL(page.url()).searchParams.has('present')).toBe(true)

    // The same link without it opens the trip as usual.
    await page.goto('about:blank')
    await page.addInitScript(() => {
      if (location.protocol === 'about:' || sessionStorage.getItem('e2e-fresh')) return
      localStorage.clear()
      sessionStorage.setItem('e2e-fresh', '1')
    })
    await page.goto('/' + hash)
    await app.ready()
    expect(await isPresenting(page)).toBe(false)
    await expect(sidebar(page)).toBeVisible()
  })

  test('a link pasted into the open page presents too', async ({ page, app }) => {
    await app.goto()
    const { routes: _routes, ...withoutRoutes } = sampleFile()
    const hash = '#trip=' + lz.compressToEncodedURIComponent(JSON.stringify(withoutRoutes))
    await page.evaluate((h) => {
      location.hash = h + '&present'
    }, hash)
    await expect.poll(async () => (await app.trip()).places.length).toBe(12)
    expect(await isPresenting(page)).toBe(true)
  })

  test('"Copy presentation link" makes a link that opens in presentation mode', async ({ page, app, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openSample(page, app)
    await fileMenu(page).click()
    await page.getByRole('menuitem', { name: 'Copy presentation link' }).click()
    await expect(page.getByTestId('toast')).toContainText('Presentation link copied to the clipboard.')
    const link = await page.evaluate(() => navigator.clipboard.readText())
    expect(link).toMatch(/#trip=[A-Za-z0-9+$-]+&present$/)
    // The ordinary link stays ordinary.
    await fileMenu(page).click()
    await page.getByRole('menuitem', { name: 'Copy share link' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain('&present')

    const other = await context.newPage()
    await other.goto(link)
    await other.waitForFunction(() => window.__ROADMAP__?.getMap() != null)
    expect(await isPresenting(other)).toBe(true)
    await expect(other.getByTestId('sidebar')).toBeHidden()
    await expect(other.locator('.place-marker')).toHaveCount(12)
  })

  test('the trip cannot be edited: no dragging, menus, reshaping, undo, renaming or opening other trips', async ({ page, app }) => {
    let chooserOpened = false
    page.on('filechooser', () => (chooserOpened = true))
    await openSample(page, app)
    await page.keyboard.press('p')
    expect(await isPresenting(page)).toBe(true)
    await app.settle()
    const before = await app.trip()
    const history = await app.history()

    // A marker cannot be dragged, and right-clicking it or the map opens no menu.
    const box = (await marker(page, 1).boundingBox())!
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 60, y + 40, { steps: 6 })
    await page.mouse.up()
    expect((await app.trip()).places[1]).toEqual(before.places[1])
    await page.mouse.click(x, y, { button: 'right' })
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.mouse.click(1100, 500, { button: 'right' })
    await expect(page.getByRole('menu')).toHaveCount(0)

    // A route line offers no handle and cannot be bent.
    const path = await app.legPath(0)
    const mid = await app.screenPoint(path[Math.floor(path.length / 2)].lat, path[Math.floor(path.length / 2)].lng)
    await page.mouse.move(mid.x, mid.y)
    await page.mouse.move(mid.x + 1, mid.y)
    await expect(page.locator('.via-dot')).toHaveCount(0)
    await page.mouse.down()
    await page.mouse.move(mid.x + 80, mid.y + 20, { steps: 6 })
    await page.mouse.up()
    expect((await app.trip()).legs).toEqual(before.legs)

    // Undo, the keyboard, the title (top bar and card) and the other file actions are off.
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+y')
    await page.getByTestId('trip-title').click()
    await expect(page.getByTestId('trip-title')).toHaveAttribute('readonly', '')
    await page.keyboard.type('X')
    await page.getByTestId('card-title').click({ force: true })
    await expect(page.getByTestId('card-title-input')).toHaveCount(0)
    await expect(page.getByTestId('card-title')).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByTestId('card-subtitle')).toBeVisible()
    expect(await app.trip()).toEqual(before)
    expect(await app.history()).toEqual(history)

    await fileMenu(page).click()
    for (const name of ['New trip', 'Open trip file…', 'Load sample trip']) {
      await expect(page.getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true')
    }
    // ... while saving and sharing stay.
    for (const name of ['Save as JSON', 'Copy share link', 'Copy presentation link']) {
      await expect(page.getByRole('menuitem', { name })).not.toHaveAttribute('aria-disabled', 'true')
    }
    await page.keyboard.press('Escape')
    // Ctrl+O opens no file picker. (The listener goes in first: Playwright's chooser interception is
    // switched on asynchronously, see io.spec.ts.)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(600)
    expect(chooserOpened).toBe(false)
    // A dropped file is turned away with a hint.
    const data = await page.evaluateHandle((text) => {
      const dt = new DataTransfer()
      dt.items.add(new File([text], 'other.trip.json', { type: 'application/json' }))
      return dt
    }, JSON.stringify({ format: 'roadmap-overview/trip', version: 1, exportedAt: '', trip: { id: 'x', title: 'Other', places: [], legs: [] } }))
    await page.dispatchEvent('body', 'drop', { dataTransfer: data })
    await expect(page.getByTestId('toast').filter({ hasText: 'Leave presentation mode' })).toBeVisible()
    expect((await app.trip()).title).toBe(before.title)
  })

  test('the card shows no prompts for what is empty, and brings back the editing when leaving', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await expect(page.getByTestId('card-subtitle')).toContainText('Add a subtitle')
    await expect(page.getByTestId('start-date')).toContainText('Add dates')
    await page.keyboard.press('p')
    await expect(page.getByTestId('card-subtitle')).toHaveCount(0)
    await expect(page.getByTestId('start-date')).toHaveCount(0)
    await expect(page.getByTestId('card-title')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('card-subtitle')).toContainText('Add a subtitle')
    await expect(page.getByTestId('start-date')).toContainText('Add dates')
    await page.getByTestId('card-title').click()
    await expect(page.getByTestId('card-title-input')).toBeVisible()
  })

  test('markers still show their notes on hover, and the route stays visible without its handles', async ({ page, app }) => {
    const file = sampleFile()
    // A via point on the first leg: drawn as a handle while editing, hidden while presenting.
    file.trip.legs[0].via = [{ lat: 54.2, lng: 9.9 }]
    await app.seedSavedTrip(file)
    await app.goto()
    await page.getByTestId('fit-trip').click()
    await app.settle()
    await expect(page.locator('.via-dot')).toHaveCount(1)
    await page.keyboard.press('p')
    await app.settle()
    await expect(page.locator('.via-dot')).toBeHidden()
    await expect(page.locator('[data-role="route-line"]').first()).toBeVisible()

    const note = file.trip.places[2].note!
    const target = await app.screenPoint(file.trip.places[2].lat, file.trip.places[2].lng)
    await page.mouse.move(target.x, target.y)
    const label = page.locator('.leaflet-tooltip.place-label.is-hovered')
    await expect(label.locator('.place-label__note')).toBeVisible()
    await expect(label.locator('.place-label__note')).toHaveText(note)
  })

  test('exporting an image stays available: it shows the trip, it does not edit it', async ({ page, app }) => {
    await openSample(page, app)
    await page.keyboard.press('p')
    const before = await app.trip()
    await expect(page.getByTestId('export-image-button')).toBeVisible()
    await page.getByTestId('export-image-button').click()
    await expect(page.getByRole('dialog', { name: 'Export image' })).toBeVisible()
    await expect(page.getByTestId('export-preview')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()])
    expect(download.suggestedFilename()).toMatch(/\.png$/)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Export image' })).toBeHidden()
    expect(await isPresenting(page)).toBe(true)
    expect(await app.trip()).toEqual(before)
  })

  test('the ride works in presentation mode; Escape closes the ride first, then the mode', async ({ page, app }) => {
    await openSample(page, app)
    await page.keyboard.press('p')
    await page.getByTestId('ride-button').click()
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('ride-hud')).toBeHidden()
    expect(await isPresenting(page)).toBe(true)
    await page.keyboard.press('Escape')
    expect(await isPresenting(page)).toBe(false)

    // Leaving presentation mode with a ride running keeps the ride's own lock.
    await page.getByTestId('ride-button').click()
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    await page.keyboard.press('p')
    await page.keyboard.press('p')
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    await expect(page.getByTestId('places-panel')).toHaveAttribute('inert', '')
    const box = (await marker(page, 1).boundingBox())!
    const before = (await app.trip()).places[1]
    await page.mouse.move(box.x + 10, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(box.x + 80, box.y + 60, { steps: 5 })
    await page.mouse.up()
    expect((await app.trip()).places[1]).toEqual(before)
  })

  test('on a phone it hides the places button and works from the overflow menu', async ({ page, app }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openSample(page, app)
    await expect(page.getByTestId('sidebar-toggle')).toBeVisible()
    await page.getByTestId('topbar-overflow').click()
    await page.getByRole('menuitem', { name: 'Presentation mode' }).click()
    expect(await isPresenting(page)).toBe(true)
    await expect(page.getByTestId('sidebar-toggle')).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    // Showing the trip as a picture is not editing: the button stays in the bar.
    await expect(page.getByTestId('export-image-button')).toBeVisible()

    await page.getByTestId('topbar-overflow').click()
    // Undo and redo are editing: they are not offered at all.
    await expect(page.getByRole('menuitem', { name: 'Undo' })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Leave presentation mode' }).click()
    expect(await isPresenting(page)).toBe(false)
    await expect(page.getByTestId('sidebar-toggle')).toBeVisible()
  })
})
