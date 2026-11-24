import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { haversineM } from '../src/lib/geo'
import { distanceToPathM } from '../src/lib/nearest'
import { decodePolyline } from '../src/lib/polyline'
import { expect, test, type App } from './fixtures'

// F10: the via points of a reshaped route are invisible by default and only show while the leg is worked on.

const spurAnswer = JSON.parse(readFileSync('src/lib/fixtures/osrm-via-spur.json', 'utf8')) as { geometry: string; via: { lat: number; lng: number } }

const connector = (page: Page, i: number) => page.getByTestId('leg-connector').nth(i)
const ghost = (page: Page) => page.locator('.via-point--ghost')
const viaPoints = (page: Page) => page.locator('.via-point:not(.via-point--ghost)')
const SHOWN = '1'
const HIDDEN = '0'

async function openTrip(page: Page, app: App, ...names: string[]) {
  await app.goto()
  await app.addPlaces(...names)
  for (let i = 0; i + 1 < names.length; i++) await expect(connector(page, i)).toHaveAttribute('data-status', 'ok')
  await page.getByTestId('fit-trip').click()
  await app.settle()
}

/** A page position on leg `index`'s routed line, `fraction` of the way along it. */
async function onLeg(app: App, index: number, fraction = 0.5) {
  const path = await app.legPath(index)
  const at = path[Math.floor(path.length * fraction)]
  return { ...(await app.screenPoint(at.lat, at.lng)), latlng: at }
}

const center = async (loc: Locator) => {
  const box = (await loc.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Move onto a line (the handle shows), press, drag in steps and release. */
async function dragFromLine(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x + 10, from.y + 10)
  await page.mouse.move(from.x, from.y, { steps: 3 })
  await expect(ghost(page)).toBeVisible()
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

/** Reshape leg 0 once (a drag out of its middle) and wait until the new route is in. Returns the pointer's spot. */
async function reshape(page: Page, app: App) {
  const mid = await onLeg(app, 0)
  const drop = { x: mid.x + 10, y: mid.y - 130 }
  await dragFromLine(page, mid, drop)
  await expect(viaPoints(page)).toHaveCount(1)
  await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
  return drop
}

/** Some corner of the map with nothing on it. */
const awayFromTheRoute = { x: 1300, y: 140 }

test.describe('via-point handles appear only while the leg is being worked on', () => {
  test('after reshaping by dragging the line shows no circle: it is hidden at once and fades in only on hover', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const before = await app.history()
    const drop = await reshape(page, app)
    const handle = viaPoints(page).first()

    // The drop was one gesture and left the leg selected, but the line is plain: no circle, though the
    // pointer still rests where the new via point is.
    expect((await app.history()).past).toBe(before.past + 1)
    expect((await app.ui()).selectedLegId).toBe((await app.trip()).legs[0].id)
    await expect(handle).toHaveCSS('opacity', HIDDEN)
    await page.waitForTimeout(400)
    await expect(page.locator('.via-tooltip')).toHaveCount(0)
    await expect(page.locator('path[data-role="route-line"]').first()).toBeVisible()

    // The pointer leaves: still hidden. Back on the line, away from the handle: the leg's handles show.
    await page.mouse.move(drop.x + 150, drop.y + 150, { steps: 4 })
    await expect(handle).toHaveCSS('opacity', HIDDEN)
    const spot = await onLeg(app, 0, 0.2)
    const there = await center(handle)
    expect(Math.hypot(spot.x - there.x, spot.y - there.y)).toBeGreaterThan(60)
    await page.mouse.move(spot.x + 12, spot.y + 12)
    await page.mouse.move(spot.x, spot.y, { steps: 3 })
    await expect(handle).toHaveCSS('opacity', SHOWN)
    await expect(ghost(page)).toBeVisible()

    // Off the line again: they fade out.
    await page.mouse.move(awayFromTheRoute.x, awayFromTheRoute.y, { steps: 4 })
    await expect(handle).toHaveCSS('opacity', HIDDEN)
    await expect(ghost(page)).toHaveCount(0)
  })

  test('selecting the leg does not show the handles on a device with hover', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await reshape(page, app)
    await page.mouse.move(awayFromTheRoute.x, awayFromTheRoute.y, { steps: 4 })
    const legId = (await app.trip()).legs[0].id
    await page.evaluate((id) => window.__ROADMAP__!.ui.getState().selectLeg(id), legId)
    await expect(connector(page, 0)).toHaveAttribute('data-selected', 'true')
    await page.waitForTimeout(500)
    await expect(viaPoints(page).first()).toHaveCSS('opacity', HIDDEN)
    // Hovering its connector in the sidebar is not hovering the line either.
    await connector(page, 0).hover()
    await page.waitForTimeout(500)
    await expect(viaPoints(page).first()).toHaveCSS('opacity', HIDDEN)
  })

  test('the pointer on the handle itself shows it, with its tooltip; once it is away the handle goes again', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await reshape(page, app)
    await page.mouse.move(awayFromTheRoute.x, awayFromTheRoute.y, { steps: 4 })
    const handle = viaPoints(page).first()
    await expect(handle).toHaveCSS('opacity', HIDDEN)

    const at = await center(handle)
    await page.mouse.move(at.x + 25, at.y + 25)
    await page.mouse.move(at.x, at.y, { steps: 3 })
    await expect(handle).toHaveCSS('opacity', SHOWN)
    await expect(page.locator('.via-tooltip')).toHaveText('Drag to change route · double-click to remove')
    await page.mouse.move(awayFromTheRoute.x, awayFromTheRoute.y, { steps: 4 })
    await expect(handle).toHaveCSS('opacity', HIDDEN)
  })

  test('the handles show while a line is being dragged and fade out again after the drop', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await reshape(page, app)
    await page.mouse.move(awayFromTheRoute.x, awayFromTheRoute.y, { steps: 4 })
    await expect(viaPoints(page).first()).toHaveCSS('opacity', HIDDEN)

    // A second reshape elsewhere on the line: the first via point shows meanwhile, wherever the pointer is.
    const late = await onLeg(app, 0, 0.85)
    await page.mouse.move(late.x + 10, late.y + 10)
    await page.mouse.move(late.x, late.y, { steps: 3 })
    await expect(ghost(page)).toBeVisible()
    await page.mouse.down()
    await page.mouse.move(late.x + 20, late.y + 140, { steps: 10 })
    await expect(page.locator('.leaflet-container')).toHaveClass(/is-reshaping/)
    await expect(viaPoints(page).first()).toHaveCSS('opacity', SHOWN)
    await page.mouse.up()

    await expect.poll(async () => (await app.trip()).legs[0].via.length).toBe(2)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await expect(viaPoints(page)).toHaveCount(2)
    for (const i of [0, 1]) await expect(viaPoints(page).nth(i)).toHaveCSS('opacity', HIDDEN)
  })

  test('a handle can still be dragged to move the via point, and double-clicked away', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await reshape(page, app)
    await page.mouse.move(awayFromTheRoute.x, awayFromTheRoute.y, { steps: 4 })
    const handle = viaPoints(page).first()
    const [old] = (await app.trip()).legs[0].via
    const history = await app.history()
    const requests = mocks.osrm.requests.length

    // Moving onto the (invisible) handle shows it; dragging it moves the point, as one undo step.
    const at = await center(handle)
    await page.mouse.move(at.x + 20, at.y + 20)
    await page.mouse.move(at.x, at.y, { steps: 3 })
    await expect(handle).toHaveCSS('opacity', SHOWN)
    await page.mouse.down()
    await page.mouse.move(at.x + 50, at.y - 20, { steps: 6 })
    await expect(handle).toHaveCSS('opacity', SHOWN)
    await page.mouse.up()
    await expect.poll(async () => (await app.trip()).legs[0].via[0]).not.toEqual(old)
    expect((await app.history()).past).toBe(history.past + 1)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await expect.poll(() => mocks.osrm.requests.length).toBe(requests + 1)
    // ... and it is a plain line again once the pointer is away.
    await page.mouse.move(awayFromTheRoute.x, awayFromTheRoute.y, { steps: 4 })
    await expect(handle).toHaveCSS('opacity', HIDDEN)

    // Removing it works the same way: hover, double-click.
    await handle.dblclick()
    await expect.poll(async () => (await app.trip()).legs[0].via).toEqual([])
    await expect(viaPoints(page)).toHaveCount(0)
  })

  test('keyboard focus on a handle shows the leg\'s handles, and Delete removes the focused one', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const legId = (await app.trip()).legs[0].id
    const path = await app.legPath(0)
    await page.evaluate(
      ([id, a, b]) => {
        const { addVia } = window.__ROADMAP__!.trip.getState()
        addVia(id, 0, a)
        addVia(id, 1, b)
      },
      [legId, path[Math.floor(path.length * 0.3)], path[Math.floor(path.length * 0.7)]] as const,
    )
    await expect(viaPoints(page)).toHaveCount(2)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    for (const i of [0, 1]) await expect(viaPoints(page).nth(i)).toHaveCSS('opacity', HIDDEN)

    // Tab from the map into the first handle: both of the leg's handles show.
    await page.locator('.leaflet-container').focus()
    await page.keyboard.press('Tab')
    await expect(viaPoints(page).first()).toBeFocused()
    for (const i of [0, 1]) await expect(viaPoints(page).nth(i)).toHaveCSS('opacity', SHOWN)
    // The ring shows which one has the focus.
    await expect(viaPoints(page).first().locator('.via-dot')).toHaveCSS('box-shadow', /0px 0px 0px 4px/)

    // Delete takes the focused (second) handle away, and its focus with it: the other one is not kept shown.
    await page.keyboard.press('Tab')
    await expect(viaPoints(page).nth(1)).toBeFocused()
    await page.keyboard.press('Delete')
    await expect.poll(async () => (await app.trip()).legs[0].via.length).toBe(1)
    await expect(viaPoints(page)).toHaveCount(1)
    await expect(viaPoints(page).first()).toHaveCSS('opacity', HIDDEN)
  })

  test('a handle that is rebuilt while it has the keyboard focus keeps the focus, and lets go of the leg when it is left', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const legId = (await app.trip()).legs[0].id
    // A ferry leg keeps its via points when it becomes a train; the new colour rebuilds the handle.
    await page.evaluate((id) => {
      const trip = window.__ROADMAP__!.trip
      trip.getState().updateLeg(id, { mode: 'ferry' })
      trip.getState().addVia(id, 0, { lat: 45.84, lng: 5.5 })
    }, legId)
    await expect(viaPoints(page)).toHaveCount(1)
    await page.locator('.leaflet-container').focus()
    await page.keyboard.press('Tab')
    await expect(viaPoints(page).first()).toBeFocused()
    await expect(viaPoints(page).first()).toHaveCSS('opacity', SHOWN)

    await page.evaluate((id) => window.__ROADMAP__!.trip.getState().updateLeg(id, { mode: 'train' }), legId)
    await expect(viaPoints(page).first().locator('.via-dot')).toHaveCSS('border-top-color', 'rgb(124, 58, 237)')
    await expect(viaPoints(page).first()).toBeFocused()
    await expect(viaPoints(page).first()).toHaveCSS('opacity', SHOWN)

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expect(viaPoints(page).first()).toHaveCSS('opacity', HIDDEN)
  })

  test('right after a drop the invisible handle is only the line: right-click opens the map menu, double-click keeps it, a click selects the leg', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const drop = await reshape(page, app)
    const legId = (await app.trip()).legs[0].id
    const via = async () => (await app.trip()).legs[0].via
    await expect(viaPoints(page).first()).toHaveCSS('opacity', HIDDEN)

    // A double-click meant for the map (or the line) does not remove it ...
    await page.mouse.dblclick(drop.x, drop.y)
    await page.waitForTimeout(300)
    expect(await via()).toHaveLength(1)
    // ... a right-click opens the map's menu instead of silently removing it ...
    await page.mouse.click(drop.x, drop.y, { button: 'right' })
    await expect(page.getByRole('menu', { name: 'Map actions' })).toBeVisible()
    expect(await via()).toHaveLength(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    // ... and a click is a click on the line: it selects the leg.
    await page.evaluate(() => window.__ROADMAP__!.ui.getState().selectLeg(null))
    await page.mouse.click(drop.x, drop.y)
    await expect.poll(async () => (await app.ui()).selectedLegId).toBe(legId)
    expect(await via()).toHaveLength(1)

    // Once the pointer has been away and is back, it is a handle again.
    await page.mouse.move(drop.x + 150, drop.y + 150, { steps: 4 })
    await page.mouse.move(drop.x + 20, drop.y + 20, { steps: 2 })
    await page.mouse.move(drop.x, drop.y, { steps: 3 })
    await expect(viaPoints(page).first()).toHaveCSS('opacity', SHOWN)
    await page.mouse.dblclick(drop.x, drop.y)
    await expect.poll(via).toEqual([])
  })

  test('presentation mode never shows them, not even with the pointer on the line', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await reshape(page, app)
    await page.keyboard.press('p')
    await app.settle()
    const mid = await onLeg(app, 0, 0.2)
    await page.mouse.move(mid.x + 12, mid.y + 12)
    await page.mouse.move(mid.x, mid.y, { steps: 3 })
    await expect(viaPoints(page).first()).toBeHidden()
    await expect(ghost(page)).toBeHidden()
    const legId = (await app.trip()).legs[0].id
    await page.evaluate((id) => window.__ROADMAP__!.ui.getState().selectLeg(id), legId)
    await expect(viaPoints(page).first()).toBeHidden()
  })

  test('a ride never shows them', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await reshape(page, app)
    await page.getByTestId('ride-button').click()
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    await app.settle()
    const legId = (await app.trip()).legs[0].id
    await page.evaluate((id) => window.__ROADMAP__!.ui.getState().selectLeg(id), legId)
    await expect(viaPoints(page).first()).toBeHidden()
    // The handles are back, hidden, when the ride is closed.
    await page.getByTestId('ride-close').click()
    await expect(viaPoints(page).first()).toBeAttached()
    await expect(viaPoints(page).first()).toBeVisible()
    await expect(viaPoints(page).first()).toHaveCSS('opacity', HIDDEN)
  })
})

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true })

  test('the selected leg shows its handles (there is no hover to find them by), the others stay hidden and untouchable', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    const trip = await app.trip()
    for (const [i, leg] of trip.legs.entries()) {
      const path = await app.legPath(i)
      await page.evaluate(([id, at]) => window.__ROADMAP__!.trip.getState().addVia(id, 0, at), [leg.id, path[Math.floor(path.length / 2)]] as const)
    }
    await expect(viaPoints(page)).toHaveCount(2)
    for (const i of [0, 1]) await expect(connector(page, i)).toHaveAttribute('data-status', 'ok')
    const select = (id: string | null) => page.evaluate((legId) => window.__ROADMAP__!.ui.getState().selectLeg(legId), id)

    await expect(viaPoints(page).nth(0)).toHaveCSS('opacity', HIDDEN)
    await expect(viaPoints(page).nth(1)).toHaveCSS('opacity', HIDDEN)
    await expect(viaPoints(page).nth(0)).toHaveCSS('pointer-events', 'none')

    await select(trip.legs[0].id)
    await expect(viaPoints(page).nth(0)).toHaveCSS('opacity', SHOWN)
    await expect(viaPoints(page).nth(0)).not.toHaveCSS('pointer-events', 'none')
    await expect(viaPoints(page).nth(1)).toHaveCSS('opacity', HIDDEN)
    await expect(viaPoints(page).nth(1)).toHaveCSS('pointer-events', 'none')

    await select(trip.legs[1].id)
    await expect(viaPoints(page).nth(0)).toHaveCSS('opacity', HIDDEN)
    await expect(viaPoints(page).nth(1)).toHaveCSS('opacity', SHOWN)

    await select(null)
    await expect(viaPoints(page).nth(1)).toHaveCSS('opacity', HIDDEN)
  })

  test('a via point of the selected leg can be dragged by touch', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const [leg] = (await app.trip()).legs
    const path = await app.legPath(0)
    await page.evaluate(([id, at]) => window.__ROADMAP__!.trip.getState().addVia(id, 0, at), [leg.id, path[Math.floor(path.length / 2)]] as const)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await page.evaluate((id) => window.__ROADMAP__!.ui.getState().selectLeg(id), leg.id)
    const handle = viaPoints(page).first()
    await expect(handle).toHaveCSS('opacity', SHOWN)
    const [old] = (await app.trip()).legs[0].via

    const at = await center(handle)
    const client = await page.context().newCDPSession(page)
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
      client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
    await touch('touchStart', at.x, at.y)
    for (let step = 1; step <= 6; step++) await touch('touchMove', at.x + step * 8, at.y - step * 6)
    await touch('touchEnd', at.x + 48, at.y - 36)
    await expect.poll(async () => (await app.trip()).legs[0].via[0]).not.toEqual(old)
    expect((await app.trip()).legs[0].via).toHaveLength(1)
  })
})

test.describe('a smooth line through the via points', () => {
  // A real OSRM answer (see src/lib/fixtures/osrm-via-spur.json): the via point was dropped beside a road
  // and snapped onto a dead end, so the router drove 349 m in and the same 349 m back out.
  const route = decodePolyline(spurAnswer.geometry)
  const start = route[0]
  const end = route[route.length - 1]
  const tip = spurAnswer.via

  test('the stub at a via point is cut out of the line, and its handle rests on the line', async ({ page, app }) => {
    await page.route('https://router.project-osrm.org/**', (fulfill) =>
      fulfill.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          code: 'Ok',
          routes: [{ geometry: spurAnswer.geometry, distance: 20_000, duration: 1_200, legs: [] }],
          waypoints: [start, tip, end].map((p) => ({ location: [p.lng, p.lat], distance: 20, name: '' })),
        }),
      }),
    )
    await app.goto()
    await page.evaluate(
      ([a, b, via]) => {
        const store = window.__ROADMAP__!.trip
        store.getState().addPlace({ name: 'Start', lat: a.lat, lng: a.lng })
        store.getState().addPlace({ name: 'End', lat: b.lat, lng: b.lng })
        store.getState().addVia(store.getState().trip.legs[0].id, 0, via)
      },
      [start, end, { lat: tip.lat + 0.0004, lng: tip.lng + 0.0006 }] as const,
    )
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await page.getByTestId('fit-trip').click()
    await app.settle()

    // The stored route has lost the dead end (and with it the 2 × 349 m) ...
    const cached = await app.legRoute(0)
    const path = decodePolyline(cached.geometry)
    expect(distanceToPathM(tip, path)).toBeGreaterThan(250)
    expect(cached.distanceM).toBeGreaterThan(19_250)
    expect(cached.distanceM).toBeLessThan(19_350)
    // ... while the trip still holds the via point where it was dropped.
    const [stored] = (await app.trip()).legs[0].via
    expect(haversineM(stored, { lat: tip.lat + 0.0004, lng: tip.lng + 0.0006 })).toBeLessThan(1)

    // Its handle is drawn on the line (to the pixel: a pixel is 10-15 m here), not out in the field where the point is stored.
    const at = await center(viaPoints(page).first())
    const drawn = await app.latLngAt(at.x, at.y)
    expect(distanceToPathM(drawn, path)).toBeLessThan(25)
    expect(haversineM(drawn, stored)).toBeGreaterThan(200)
  })
})
