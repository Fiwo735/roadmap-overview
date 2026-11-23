import type { Locator, Page } from '@playwright/test'
import { formatDistance, formatDuration } from '../src/lib/format'
import { haversineM } from '../src/lib/geo'
import { distanceToPathM } from '../src/lib/nearest'
import { createTrip } from '../src/lib/trip'
import { expect, findPlace, placeInput, test, type App, type Mocks } from './fixtures'

const connector = (page: Page, i: number) => page.getByTestId('leg-connector').nth(i)
const ghost = (page: Page) => page.locator('.via-point--ghost')
const viaPoints = (page: Page) => page.locator('.via-point:not(.via-point--ghost)')
const undoButton = (page: Page) => page.getByTestId('undo')
/** The visible (non-hit) route lines. */
const routeLines = (page: Page) => page.locator('path[data-role="route-line"]')
const routeLine = (page: Page, legId: string) => page.locator(`path[data-role="route-line"][data-leg-id="${legId}"]`)

/** Open the app with these places (routed through the mock OSRM) and show them all on the map. */
async function openTrip(page: Page, app: App, ...names: string[]) {
  await app.goto()
  await app.addPlaces(...names)
  for (let i = 0; i + 1 < names.length; i++) await expect(connector(page, i)).toHaveAttribute('data-status', 'ok')
  await page.getByTestId('fit-trip').click()
  await app.settle()
}

/** A point in the middle of leg `index`'s routed line, as page coordinates. */
async function midOfLeg(app: App, index: number) {
  const path = await app.legPath(index)
  const mid = path[Math.floor(path.length / 2)]
  return { ...(await app.screenPoint(mid.lat, mid.lng)), latlng: mid }
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

const center = async (loc: Locator) => {
  const box = (await loc.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const viaCoordsOf = (mocks: Mocks, requestIndex: number) =>
  decodeURIComponent(new URL(mocks.osrm.requests[requestIndex].url).pathname.split('/').pop()!).split(';')

test.describe('road routes and leg summaries', () => {
  test('each leg is routed once through OSRM (politely) and its connector shows distance and time', async ({ page, app, mocks }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy', 'Zurich')
    await expect(page.getByTestId('leg-connector')).toHaveCount(2)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await expect(connector(page, 1)).toHaveAttribute('data-status', 'ok')

    const { routes } = await app.routes()
    expect(Object.keys(routes)).toHaveLength(2)
    for (const i of [0, 1]) {
      const route = await app.legRoute(i)
      expect(route.source).toBe('osrm')
      await expect(connector(page, i).getByTestId('leg-summary-text')).toHaveText(
        `${formatDistance(route.distanceM)} · ${formatDuration(route.durationS)}`,
      )
    }
    expect((await app.trip()).legs.map((l) => l.via)).toEqual([[], []])
    await expect(connector(page, 0).getByTestId('leg-summary')).toHaveAccessibleName(/Drive from Lyon to Annecy: \d+ km · /)

    // One request per leg, from → to, at least a second apart (usage policy) and never in the trip.
    expect(mocks.osrm.requests).toHaveLength(2)
    const [a, b] = mocks.osrm.requests
    expect(b.at - a.at).toBeGreaterThanOrEqual(800)
    const url = new URL(a.url)
    expect(url.pathname).toBe('/route/v1/driving/4.83200,45.75780;6.12890,45.89920')
    expect(Object.fromEntries(url.searchParams)).toEqual({ overview: 'full', geometries: 'polyline', steps: 'true', alternatives: 'false' })
    expect(await app.history()).toEqual({ past: 3, future: 0 })

    // The lines are on the map: casing + line + hit area per leg.
    await expect(routeLines(page)).toHaveCount(2)
    await expect(page.locator('path[data-role="route-casing"]')).toHaveCount(2)
    expect(mocks.blocked).toEqual([])
  })

  test('a leg shows a spinner and a grey dashed placeholder while it is being routed', async ({ page, app, mocks }) => {
    mocks.osrm.delayMs = 1500
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'loading')
    await expect(connector(page, 0)).toContainText('Routing…')
    const line = routeLines(page).first()
    await expect(line).toHaveAttribute('stroke', '#6b7280')
    await expect(line).toHaveAttribute('stroke-dasharray', '6 8')

    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok', { timeout: 10_000 })
    await expect(line).toHaveAttribute('stroke', '#1a73e8')
    await expect(page.locator('path[data-role="route-casing"]').first()).toHaveAttribute('stroke', '#0b4fb3')
  })

  test('requests for legs that are no longer needed never reach the network', async ({ page, app, mocks }) => {
    await app.goto()
    const [, , zurich] = await app.addPlaces('Lyon', 'Annecy', 'Zurich')
    await expect.poll(() => mocks.osrm.requests.length).toBe(1)
    // The second leg is still queued: removing its place drops it before it is ever sent.
    await page.evaluate((id) => window.__ROADMAP__!.trip.getState().removePlace(id), zurich)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await page.waitForTimeout(1500)
    expect(mocks.osrm.requests).toHaveLength(1)
    expect((await app.routes()).status).toEqual({})
  })

  test('routes are cached with the trip: a reload does not ask OSRM again', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await expect.poll(async () => Object.keys((await app.savedFile())?.routes ?? {}).length).toBe(1)
    const requests = mocks.osrm.requests.length
    await page.reload()
    await app.ready()
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await expect(connector(page, 0).getByTestId('leg-summary-text')).toContainText('km')
    await page.waitForTimeout(1200)
    expect(mocks.osrm.requests).toHaveLength(requests)
  })
})

test.describe('re-routing a changed leg', () => {
  test('the previous line stays on the map, faded, until the new route arrives', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const legId = (await app.trip()).legs[0].id
    const line = routeLine(page, legId)
    const casing = page.locator(`path[data-role="route-casing"][data-leg-id="${legId}"]`)
    const oldPath = await line.getAttribute('d')
    expect(oldPath).toBeTruthy()

    mocks.osrm.delayMs = 2500
    const mid = await midOfLeg(app, 0)
    await dragFromLine(page, mid, { x: mid.x, y: mid.y - 120 })
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'loading')
    // Not the grey straight placeholder: the old road, in its own colour, faded.
    await expect(line).toHaveAttribute('stroke', '#1a73e8')
    await expect(line).not.toHaveAttribute('stroke-dasharray', /./)
    await expect(line).toHaveAttribute('d', oldPath!)
    expect(Number(await line.getAttribute('stroke-opacity'))).toBeLessThan(0.6)
    expect(Number(await casing.getAttribute('stroke-opacity'))).toBeLessThan(0.6)
    // The new via handle is already there.
    await expect(viaPoints(page)).toHaveCount(1)

    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok', { timeout: 10_000 })
    await expect(line).toHaveAttribute('stroke-opacity', '1')
    expect(await line.getAttribute('d')).not.toBe(oldPath)
  })

  test('a failed re-route replaces the old line with the red error line; a never-routed leg shows the grey placeholder', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const legId = (await app.trip()).legs[0].id
    const line = routeLine(page, legId)
    mocks.osrm.failWith = 'NoRoute'
    await page.evaluate((id) => window.__ROADMAP__!.trip.getState().addVia(id, 0, { lat: 46.3, lng: 5.5 }), legId)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'error')
    await expect(line).toHaveAttribute('stroke', '#d93025')
    await expect(line).toHaveAttribute('stroke-opacity', '0.95')

    // A leg that was never routed (a new place) starts as the grey placeholder.
    mocks.osrm.failWith = null
    mocks.osrm.delayMs = 2000
    await app.addPlaces('Zurich')
    const second = (await app.trip()).legs[1].id
    await expect(routeLine(page, second)).toHaveAttribute('stroke', '#6b7280')
  })

  test("a user's edit jumps ahead of background routing", async ({ page, app, mocks }) => {
    await app.goto()
    // A freshly opened trip (one replaceTrip, like an import): eight legs, routed one second apart.
    const names = ['Paris', 'Lyon', 'Annecy', 'Zurich', 'Milan', 'Munich', 'Salzburg', 'Vienna', 'Prague']
    await app.setTrip(createTrip({ places: names.map((name, i) => ({ id: `p${i}`, ...placeInput(name), day: i })) }), { clearHistory: true })
    await expect.poll(() => mocks.osrm.requests.length).toBe(1)
    // Reshaping the last leg right away must not wait behind the seven legs still queued.
    const last = (await app.trip()).legs[7].id
    await page.evaluate((id) => window.__ROADMAP__!.trip.getState().addVia(id, 0, { lat: 48.9, lng: 15.9 }), last)
    await expect.poll(() => mocks.osrm.requests.length, { timeout: 5000 }).toBe(2)
    const second = viaCoordsOf(mocks, 1)
    expect(second).toHaveLength(3)
    expect(second[1]).toBe('15.90000,48.90000')
    await expect(connector(page, 7)).toHaveAttribute('data-status', 'ok', { timeout: 5000 })
    // Background legs go on, still one at a time and a second apart.
    await expect.poll(() => mocks.osrm.requests.length, { timeout: 5000 }).toBe(3)
    // (Measured in the mock, so a little jitter is allowed; the exact spacing is unit-tested.)
    const gaps = mocks.osrm.requests.slice(1).map((r, i) => r.at - mocks.osrm.requests[i].at)
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(800)
  })
})

test.describe('failures', () => {
  test('an OSRM error shows the reason, Retry recovers, and nothing was written to the trip', async ({ page, app, mocks }) => {
    mocks.osrm.failWith = 'NoRoute'
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    const c = connector(page, 0)
    await expect(c).toHaveAttribute('data-status', 'error')
    await expect(c).toContainText('No road route between these points')
    await expect(routeLines(page).first()).toHaveAttribute('stroke', '#d93025')
    await expect(routeLines(page).first()).toHaveAttribute('stroke-dasharray', '7 6')
    expect((await app.routes()).status).toMatchObject({ [Object.keys((await app.routes()).status)[0]]: 'error' })
    // No automatic retry loop.
    await page.waitForTimeout(1300)
    expect(mocks.osrm.requests).toHaveLength(1)

    mocks.osrm.failWith = null
    await c.getByTestId('leg-retry').click()
    await expect(c).toHaveAttribute('data-status', 'ok')
    await expect(c.getByTestId('leg-retry')).toBeHidden()
    expect(mocks.osrm.requests).toHaveLength(2)
    await expect(routeLines(page).first()).toHaveAttribute('stroke', '#1a73e8')
    expect((await app.routes()).errors).toEqual({})
  })

  test('other failures read differently, and "Use straight line" ends the wait as one undo step', async ({ page, app, mocks }) => {
    mocks.osrm.failWith = 'http-500'
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    const c = connector(page, 0)
    await expect(c).toContainText('The routing service answered 500')

    const before = await app.history()
    await c.getByTestId('leg-straight').click()
    await expect(c).toHaveAttribute('data-status', 'ok')
    await expect(c.getByTestId('leg-summary-text')).toContainText('straight line')
    expect((await app.trip()).legs[0].straight).toBe(true)
    expect((await app.history()).past).toBe(before.past + 1)

    const { lyon, annecy } = { lyon: findPlace('Lyon'), annecy: findPlace('Annecy') }
    const km = haversineM(lyon, annecy)
    await expect(c.getByTestId('leg-summary-text')).toContainText(formatDistance(km))
    // The straight line is drawn dotted, with no request to the router.
    await expect(routeLines(page).first()).toHaveAttribute('stroke-dasharray', '1 9')
    expect(mocks.osrm.requests).toHaveLength(1)
    // The stale error is gone from the cache.
    expect((await app.routes()).status).toEqual({})

    await undoButton(page).click()
    await expect(c).toHaveAttribute('data-status', 'error')
  })

  test('a network failure is reported too', async ({ page, app, mocks }) => {
    mocks.osrm.failWith = 'network'
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await expect(connector(page, 0)).toContainText('Could not reach the routing service')
  })
})

test.describe('reshaping the route', () => {
  test('hovering a line shows a handle that follows it; dragging it adds a via point and re-routes through it', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    const before = await app.history()
    const requests = mocks.osrm.requests.length
    const mid = await midOfLeg(app, 0)

    // The handle sits on the line and moves with the pointer along it.
    const path = await app.legPath(0)
    const next = await app.screenPoint(path[Math.floor(path.length / 2) + 3].lat, path[Math.floor(path.length / 2) + 3].lng)
    await page.mouse.move(mid.x + 20, mid.y + 20)
    await page.mouse.move(mid.x, mid.y, { steps: 4 })
    await expect(ghost(page)).toBeVisible()
    const distanceTo = async (p: { x: number; y: number }) => {
      const c = await center(ghost(page))
      return Math.hypot(c.x - p.x, c.y - p.y)
    }
    await expect.poll(() => distanceTo(mid)).toBeLessThan(4)
    await page.mouse.move(next.x, next.y, { steps: 4 })
    await expect.poll(() => distanceTo(next)).toBeLessThan(4)
    // Off the line the handle goes away.
    await page.mouse.move(mid.x + 120, mid.y - 120, { steps: 4 })
    await expect(ghost(page)).toHaveCount(0)

    // Drag it out of the line: a dashed preview follows the pointer, nothing is committed yet.
    await page.mouse.move(mid.x, mid.y, { steps: 4 })
    await page.mouse.down()
    const target = { x: mid.x + 10, y: mid.y - 140 }
    await page.mouse.move(target.x, target.y, { steps: 10 })
    await expect(page.locator('.leaflet-ro-route-pane path[stroke-dasharray="2 8"]')).toHaveCount(1)
    await expect(page.locator('.leaflet-container')).toHaveClass(/is-reshaping/)
    expect((await app.trip()).legs[0].via).toEqual([])
    await page.mouse.up()

    await expect(page.locator('.leaflet-ro-route-pane path[stroke-dasharray="2 8"]')).toHaveCount(0)
    await expect.poll(async () => (await app.trip()).legs[0].via.length).toBe(1)
    const dropped = await app.latLngAt(target.x, target.y)
    const [via] = (await app.trip()).legs[0].via
    expect(haversineM(via, dropped)).toBeLessThan(5)
    // One gesture, one undo step; the leg re-routes through the point.
    expect((await app.history()).past).toBe(before.past + 1)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await expect.poll(() => mocks.osrm.requests.length).toBe(requests + 1)
    const coords = viaCoordsOf(mocks, requests)
    expect(coords).toHaveLength(3)
    expect(coords[1]).toBe(`${via.lng.toFixed(5)},${via.lat.toFixed(5)}`)
    expect(distanceToPathM(via, await app.legPath(0))).toBeLessThan(30)
    await expect(viaPoints(page)).toHaveCount(1)
    expect((await app.ui()).selectedLegId).toBe((await app.trip()).legs[0].id)
    // The drag did not leave the place selected or the leg deselected by the click that follows it.
    await page.waitForTimeout(100)
    expect((await app.ui()).selectedLegId).toBe((await app.trip()).legs[0].id)
  })

  test('undo and redo of a via point are instant: the cached routes are used, OSRM is not asked again', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const plain = await app.legPath(0)
    const mid = await midOfLeg(app, 0)
    await dragFromLine(page, mid, { x: mid.x, y: mid.y + 120 })
    await expect.poll(async () => (await app.trip()).legs[0].via.length).toBe(1)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await expect.poll(() => mocks.osrm.requests.length).toBe(2)
    const reshaped = await app.legPath(0)
    expect(reshaped).not.toEqual(plain)

    await undoButton(page).click()
    await expect(viaPoints(page)).toHaveCount(0)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    expect(await app.legPath(0)).toEqual(plain)
    await page.getByTestId('redo').click()
    await expect(viaPoints(page)).toHaveCount(1)
    expect(await app.legPath(0)).toEqual(reshaped)
    await page.waitForTimeout(1300)
    expect(mocks.osrm.requests).toHaveLength(2)
  })

  test('a second drag on the same leg inserts the new via point at the right index', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const mid = await midOfLeg(app, 0)
    await dragFromLine(page, mid, { x: mid.x, y: mid.y - 120 })
    await expect(viaPoints(page)).toHaveCount(1)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    const [first] = (await app.trip()).legs[0].via

    // Grab the new line near the end of the leg: that point goes after the first via point.
    const path = await app.legPath(0)
    const late = path[Math.floor(path.length * 0.85)]
    const lateAt = await app.screenPoint(late.lat, late.lng)
    await dragFromLine(page, lateAt, { x: lateAt.x, y: lateAt.y + 90 })
    await expect.poll(async () => (await app.trip()).legs[0].via.length).toBe(2)
    expect((await app.trip()).legs[0].via[0]).toEqual(first)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    expect(viaCoordsOf(mocks, mocks.osrm.requests.length - 1)).toHaveLength(4)

    // And near the start: before the first one.
    const early = (await app.legPath(0))[Math.floor(path.length * 0.08)]
    const earlyAt = await app.screenPoint(early.lat, early.lng)
    await dragFromLine(page, earlyAt, { x: earlyAt.x, y: earlyAt.y + 70 })
    await expect.poll(async () => (await app.trip()).legs[0].via.length).toBe(3)
    expect((await app.trip()).legs[0].via[1]).toEqual(first)
  })

  test('dragging a via point moves it (one undo step) and re-routes', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const mid = await midOfLeg(app, 0)
    await dragFromLine(page, mid, { x: mid.x, y: mid.y - 100 })
    await expect(viaPoints(page)).toHaveCount(1)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await expect.poll(() => mocks.osrm.requests.length).toBe(2)
    const before = await app.history()
    const [old] = (await app.trip()).legs[0].via

    const handle = await center(viaPoints(page).first())
    await page.mouse.move(handle.x, handle.y)
    await expect(page.locator('.via-tooltip')).toHaveText('Drag to change route · double-click to remove')
    await page.mouse.down()
    await page.mouse.move(handle.x + 40, handle.y - 10, { steps: 4 })
    // Preview while dragging; the trip is untouched until the drop.
    await page.mouse.move(handle.x + 70, handle.y - 30, { steps: 6 })
    await expect(page.locator('.leaflet-ro-route-pane path[stroke-dasharray="2 8"]')).toHaveCount(1)
    expect((await app.trip()).legs[0].via).toEqual([old])
    await page.mouse.up()

    await expect.poll(async () => (await app.trip()).legs[0].via[0]).not.toEqual(old)
    expect((await app.trip()).legs[0].via).toHaveLength(1)
    expect((await app.history()).past).toBe(before.past + 1)
    const moved = (await app.trip()).legs[0].via[0]
    expect(haversineM(moved, await app.latLngAt(handle.x + 70, handle.y - 30))).toBeLessThan(30)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await expect.poll(() => mocks.osrm.requests.length).toBe(3)
    await expect(page.locator('.leaflet-ro-route-pane path[stroke-dasharray="2 8"]')).toHaveCount(0)
  })

  test('double-click and right-click remove a via point; Delete removes a focused one', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const legId = (await app.trip()).legs[0].id
    const path = await app.legPath(0)
    const at = (f: number) => path[Math.floor(path.length * f)]
    await page.evaluate(
      ([id, a, b, c]) => {
        const { addVia } = window.__ROADMAP__!.trip.getState()
        addVia(id, 0, a)
        addVia(id, 1, b)
        addVia(id, 2, c)
      },
      [legId, at(0.25), at(0.5), at(0.75)] as const,
    )
    await expect(viaPoints(page)).toHaveCount(3)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    const [v0, v1, v2] = (await app.trip()).legs[0].via

    await viaPoints(page).nth(1).dblclick()
    await expect.poll(async () => (await app.trip()).legs[0].via).toEqual([v0, v2])
    await expect(viaPoints(page)).toHaveCount(2)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')

    await viaPoints(page).first().click({ button: 'right' })
    await expect.poll(async () => (await app.trip()).legs[0].via).toEqual([v2])
    // The map's own context menu did not open for it.
    await expect(page.getByRole('menu')).toHaveCount(0)

    await viaPoints(page).first().focus()
    await page.keyboard.press('Delete')
    await expect.poll(async () => (await app.trip()).legs[0].via).toEqual([])
    expect(v1).toBeDefined()
    await expect(viaPoints(page)).toHaveCount(0)
  })

  test("right-clicking a line opens the map's own menu, and inserting there lands between the two stops", async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    const mid = await midOfLeg(app, 1)
    await page.mouse.move(mid.x + 10, mid.y + 10)
    await page.mouse.move(mid.x, mid.y, { steps: 3 })
    await page.mouse.click(mid.x, mid.y, { button: 'right' })
    const before = (await app.trip()).places.map((p) => p.id)
    await page.getByRole('menuitem', { name: 'Insert place here' }).click()
    await expect.poll(async () => (await app.trip()).places.length).toBe(4)
    const after = (await app.trip()).places.map((p) => p.id)
    expect([after[0], after[1], after[3]]).toEqual(before)
  })

  test('no handle on a leg that is still routing, and dragging there pans the map as usual', async ({ page, app, mocks }) => {
    mocks.osrm.delayMs = 4000
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await page.getByTestId('fit-trip').click()
    await app.settle()
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'loading')
    const [lyon, annecy] = (await app.trip()).places
    const a = await app.screenPoint(lyon.lat, lyon.lng)
    const b = await app.screenPoint(annecy.lat, annecy.lng)
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }

    await page.mouse.move(mid.x + 12, mid.y + 12)
    await page.mouse.move(mid.x, mid.y, { steps: 4 })
    // Hovering still highlights the leg (sidebar sync), but offers no reshape handle.
    await expect.poll(async () => (await app.ui()).hoveredLegId).toBe((await app.trip()).legs[0].id)
    await expect(ghost(page)).toHaveCount(0)

    const view = await app.mapView()
    await page.mouse.down()
    await page.mouse.move(mid.x - 150, mid.y + 100, { steps: 8 })
    await page.mouse.up()
    const after = await app.mapView()
    expect(Math.abs(after.lng - view.lng) + Math.abs(after.lat - view.lat)).toBeGreaterThan(0.1)
    expect((await app.trip()).legs[0].via).toEqual([])
  })

  test('the map still pans by dragging anywhere away from the route', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const view = await app.mapView()
    const before = await app.history()
    await page.mouse.move(1000, 150)
    await page.mouse.down()
    await page.mouse.move(820, 220, { steps: 8 })
    await page.mouse.up()
    const after = await app.mapView()
    expect(Math.abs(after.lng - view.lng)).toBeGreaterThan(0.05)
    expect((await app.trip()).legs[0].via).toEqual([])
    expect(await app.history()).toEqual(before)
  })

  test('Escape cancels a drag in progress, and the click that ends the press changes no selection', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const legId = (await app.trip()).legs[0].id
    const mid = await midOfLeg(app, 0)
    const before = await app.history()
    await page.mouse.move(mid.x + 10, mid.y + 10)
    await page.mouse.move(mid.x, mid.y, { steps: 3 })
    await page.mouse.down()
    await page.mouse.move(mid.x, mid.y - 100, { steps: 6 })
    await expect(page.locator('.leaflet-ro-route-pane path[stroke-dasharray="2 8"]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('.leaflet-ro-route-pane path[stroke-dasharray="2 8"]')).toHaveCount(0)
    // The button is still down; releasing it on the empty map must not count as a click on it.
    await page.evaluate((id) => window.__ROADMAP__!.ui.getState().selectLeg(id), legId)
    await page.mouse.up()
    await page.waitForTimeout(100)
    expect((await app.ui()).selectedLegId).toBe(legId)
    expect((await app.trip()).legs[0].via).toEqual([])
    expect(await app.history()).toEqual(before)

    // The guard is gone afterwards: a plain click on the empty map deselects as usual.
    await page.mouse.click(1000, 120)
    expect((await app.ui()).selectedLegId).toBeNull()
  })

  test('releasing a line drag over the sidebar cancels it: no via point, no request, nothing selected', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const mid = await midOfLeg(app, 0)
    const before = await app.history()
    const requests = mocks.osrm.requests.length
    const selected = (await app.ui()).selectedLegId
    await page.mouse.move(mid.x + 10, mid.y + 10)
    await page.mouse.move(mid.x, mid.y, { steps: 3 })
    await expect(ghost(page)).toBeVisible()
    await page.mouse.down()
    await page.mouse.move(mid.x - 100, mid.y, { steps: 6 })
    await expect(page.locator('.leaflet-ro-route-pane path[stroke-dasharray="2 8"]')).toHaveCount(1)
    // Over the sidebar the preview is gone: this would be a cancel.
    await page.mouse.move(180, 500, { steps: 8 })
    await expect(page.locator('.leaflet-ro-route-pane path[stroke-dasharray="2 8"]')).toHaveCount(0)
    await expect(ghost(page)).toHaveCount(0)
    await page.mouse.up()

    await page.waitForTimeout(1300)
    expect((await app.trip()).legs[0].via).toEqual([])
    expect(await app.history()).toEqual(before)
    expect(mocks.osrm.requests).toHaveLength(requests)
    expect((await app.ui()).selectedLegId).toBe(selected)
    await expect(page.locator('.leaflet-container')).not.toHaveClass(/is-reshaping/)
    // The press is over: the route reacts to the pointer again.
    await page.mouse.move(mid.x + 10, mid.y + 10)
    await page.mouse.move(mid.x, mid.y, { steps: 3 })
    await expect(ghost(page)).toBeVisible()
  })

  test('releasing a via point over the sidebar cancels the move: it snaps back and nothing changes', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const mid = await midOfLeg(app, 0)
    await dragFromLine(page, mid, { x: mid.x, y: mid.y - 100 })
    await expect(viaPoints(page)).toHaveCount(1)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await expect.poll(() => mocks.osrm.requests.length).toBe(2)
    const before = await app.history()
    const [via] = (await app.trip()).legs[0].via

    const handle = await center(viaPoints(page).first())
    await page.mouse.move(handle.x, handle.y)
    await page.mouse.down()
    await page.mouse.move(handle.x - 60, handle.y, { steps: 5 })
    await expect(page.locator('.leaflet-ro-route-pane path[stroke-dasharray="2 8"]')).toHaveCount(1)
    await page.mouse.move(150, 400, { steps: 10 })
    await expect(page.locator('.leaflet-ro-route-pane path[stroke-dasharray="2 8"]')).toHaveCount(0)
    await page.mouse.up()

    await page.waitForTimeout(1300)
    expect((await app.trip()).legs[0].via).toEqual([via])
    expect(await app.history()).toEqual(before)
    expect(mocks.osrm.requests).toHaveLength(2)
    // The handle is back on the stored via point (the map may have panned while the marker was dragged).
    await app.settle()
    const spot = await app.screenPoint(via.lat, via.lng)
    const back = await center(viaPoints(page).first())
    expect(Math.hypot(back.x - spot.x, back.y - spot.y)).toBeLessThan(2)
  })

  test('starting a line drag commits the field being edited in the sidebar, as any other click would', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const day = page.getByRole('textbox', { name: 'Day of travel for Annecy' })
    await day.fill('4')
    await expect(day).toBeFocused()
    const mid = await midOfLeg(app, 0)
    await page.mouse.move(mid.x + 10, mid.y + 10)
    await page.mouse.move(mid.x, mid.y, { steps: 3 })
    await page.mouse.down()
    await expect(day).not.toBeFocused()
    await expect.poll(async () => (await app.trip()).places[1].day).toBe(4)
    await page.mouse.up()
  })
})

test.describe('hover and selection', () => {
  test('hovering a line highlights its connector and vice versa; clicking selects the leg', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    const trip = await app.trip()
    const second = connector(page, 1)

    // Line → sidebar.
    const mid = await midOfLeg(app, 1)
    await page.mouse.move(mid.x + 10, mid.y + 10)
    await page.mouse.move(mid.x, mid.y, { steps: 3 })
    await expect(second).toHaveAttribute('data-hovered', 'true')
    expect((await app.ui()).hoveredLegId).toBe(trip.legs[1].id)
    await expect(routeLine(page, trip.legs[1].id)).toHaveAttribute('stroke-width', '7')
    await expect(routeLine(page, trip.legs[0].id)).toHaveAttribute('stroke-width', '5')
    await page.mouse.move(mid.x - 200, mid.y - 200, { steps: 3 })
    await expect(second).not.toHaveAttribute('data-hovered', 'true')
    expect((await app.ui()).hoveredLegId).toBeNull()

    // Sidebar → line.
    await connector(page, 0).getByTestId('leg-summary').hover()
    await expect(routeLine(page, trip.legs[0].id)).toHaveAttribute('stroke-width', '7')
    expect((await app.ui()).hoveredLegId).toBe(trip.legs[0].id)

    // Click on the line selects the leg (and not the place); clicking the empty map clears it.
    await page.mouse.click(mid.x, mid.y)
    await expect(second).toHaveAttribute('data-selected', 'true')
    expect((await app.ui()).selectedLegId).toBe(trip.legs[1].id)
    expect((await app.ui()).selectedPlaceId).toBeNull()
    await expect(routeLine(page, trip.legs[1].id)).toHaveAttribute('stroke-width', '9')
    await page.mouse.click(1000, 120)
    expect((await app.ui()).selectedLegId).toBeNull()
    await expect(routeLine(page, trip.legs[1].id)).toHaveAttribute('stroke-width', '5')
  })

  test('clicking a connector selects the leg and fits the map to it', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([40, -3], 5, { animate: false }))
    await connector(page, 1).getByTestId('leg-summary').click()
    const trip = await app.trip()
    expect((await app.ui()).selectedLegId).toBe(trip.legs[1].id)
    await app.settle()
    // The view is on that leg (not on Lyon, nor the whole trip), in the part of the map that the title
    // card leaves free, and shows both its places.
    const path = await app.legPath(1)
    const lats = path.map((p) => p.lat)
    const lngs = path.map((p) => p.lng)
    const middle = await app.screenPoint((Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2)
    const card = (await page.getByTestId('trip-card').boundingBox())!
    expect(middle.x > card.x + card.width || middle.y > card.y + card.height).toBe(true)
    const map = (await page.getByTestId('map-area').boundingBox())!
    expect(Math.abs(middle.x - (map.x + map.width / 2))).toBeLessThan(map.width / 3)
    expect(Math.abs(middle.y - (map.y + map.height / 2))).toBeLessThan(map.height / 3)
    const inside = await page.evaluate(
      (pts) => pts.every((p) => window.__ROADMAP__!.getMap()!.getBounds().contains([p.lat, p.lng])),
      path,
    )
    expect(inside).toBe(true)
  })

  test('selecting a leg on the map scrolls its connector into view in a long list', async ({ page, app }) => {
    await app.goto()
    const names = ['Paris', 'Lyon', 'Annecy', 'Zurich', 'Milan', 'Munich', 'Salzburg', 'Vienna', 'Prague', 'Berlin', 'Hamburg', 'Amsterdam']
    await app.addPlaces(...names)
    // Straight legs need no router, so the long list is ready at once.
    await page.evaluate(() => {
      const { trip, updateLeg } = window.__ROADMAP__!.trip.getState()
      for (const leg of trip.legs) updateLeg(leg.id, { straight: true })
    })
    await page.getByTestId('fit-trip').click()
    await app.settle()
    const last = connector(page, names.length - 2)
    await expect(last).not.toBeInViewport()
    const trip = await app.trip()
    const a = trip.places[names.length - 2]
    const b = trip.places[names.length - 1]
    const at = await app.screenPoint((a.lat + b.lat) / 2, (a.lng + b.lng) / 2)
    await page.mouse.move(at.x + 8, at.y + 8)
    await page.mouse.click(at.x, at.y)
    expect((await app.ui()).selectedLegId).toBe(trip.legs[names.length - 2].id)
    await expect(last).toBeInViewport()
  })
})

test.describe('map tools', () => {
  test('"Fit to trip" shows every place and route point', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([30, 30], 4, { animate: false }))
    await page.getByRole('button', { name: 'Fit to trip' }).click()
    await app.settle()
    const trip = await app.trip()
    const points = [...trip.places, ...(await app.legPath(0)), ...(await app.legPath(1))]
    const inside = await page.evaluate(
      (pts) => {
        const map = window.__ROADMAP__!.getMap()!
        const bounds = map.getBounds()
        return pts.every((p) => bounds.contains([p.lat, p.lng]))
      },
      points,
    )
    expect(inside).toBe(true)
    // …and is not wildly zoomed out.
    expect((await app.mapView()).zoom).toBeGreaterThanOrEqual(7)
  })

  test('"Fit to trip" is disabled for an empty trip', async ({ page, app }) => {
    await app.goto()
    await expect(page.getByRole('button', { name: 'Fit to trip' })).toBeDisabled()
  })

  test('"Show labels" hides and restores the place labels (hovered or selected ones stay)', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const toggle = page.getByRole('button', { name: 'Show labels' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const labels = page.locator('.place-label')
    await expect(labels.first()).toBeVisible()

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect((await app.ui()).showLabels).toBe(false)
    await expect(page.locator('.leaflet-container')).toHaveClass(/hide-place-labels/)
    await expect(labels.first()).toBeHidden()
    await expect(labels.nth(1)).toBeHidden()
    // A selected place keeps its label so the user can tell what they clicked.
    await page.evaluate(() => {
      const { places } = window.__ROADMAP__!.trip.getState().trip
      window.__ROADMAP__!.ui.getState().selectPlace(places[1].id)
    })
    await expect(labels.nth(1)).toBeVisible()
    await expect(labels.first()).toBeHidden()

    await toggle.click()
    await expect(page.locator('.leaflet-container')).not.toHaveClass(/hide-place-labels/)
    await expect(labels.first()).toBeVisible()
  })
})
