import type { Page } from '@playwright/test'
// Loads the typing of `window.__ROADMAP__.ride`.
import type {} from '../src/features/ride/rideStore'
import { distanceToPathM } from '../src/lib/nearest'
import { createTrip } from '../src/lib/trip'
import { expect, test, type App } from './fixtures'

const rideButton = (page: Page) => page.getByTestId('ride-button')
const hud = (page: Page) => page.getByTestId('ride-hud')
const day = (page: Page) => page.getByTestId('ride-day')
const van = (page: Page) => page.getByTestId('ride-vehicle')
const connector = (page: Page, i: number) => page.getByTestId('leg-connector').nth(i)

/** Open the app with these places (routed through the mock OSRM) and show them all on the map. */
async function openTrip(page: Page, app: App, ...names: string[]) {
  await app.goto()
  await app.addPlaces(...names)
  for (let i = 0; i + 1 < names.length; i++) await expect(connector(page, i)).toHaveAttribute('data-status', 'ok')
  await page.getByTestId('fit-trip').click()
  await app.settle()
}

/** Give the places these days (typed values, in order). */
async function setDays(page: Page, ...days: number[]) {
  await page.evaluate((list) => {
    const store = window.__ROADMAP__!.trip
    store.getState().trip.places.forEach((p, i) => store.getState().updatePlace(p.id, { day: list[i] }))
  }, days)
}

/**
 * Press Ride, wait until the camera has settled (the view is fitted with an animation) and — unless
 * `playing` — hold the ride at its very start, so a test can look at deterministic moments.
 */
async function startRide(page: Page, app: App, { playing = false } = {}) {
  await rideButton(page).click()
  await expect(hud(page)).toBeVisible()
  await app.settle()
  await page.evaluate((play) => {
    const ride = window.__ROADMAP__!.ride!
    ride.pause()
    ride.seek(0)
    if (play) ride.play()
  }, playing)
}

/** Pause and jump to `time` seconds (a deterministic moment of the ride). */
async function seek(page: Page, time: number) {
  await page.evaluate((t) => {
    const ride = window.__ROADMAP__!.ride!
    ride.pause()
    ride.seek(t)
  }, time)
}

const rideState = (page: Page) =>
  page.evaluate(() => {
    const ride = window.__ROADMAP__!.ride!
    const s = ride.store.getState()
    return {
      active: s.active,
      playing: s.playing,
      time: s.time,
      speed: s.speed,
      follow: s.follow,
      placeIndex: s.placeIndex,
      duration: s.timeline?.duration ?? null,
    }
  })

const sample = (page: Page) => page.evaluate(() => window.__ROADMAP__!.ride!.sample()!)

/** How far a parked vehicle stands above its spot (px; see ride.css). */
const PARKED_LIFT = 17

/** Where the vehicle touches the line, in page coordinates (the icon's anchor). */
async function vanAnchor(page: Page) {
  const box = (await van(page).boundingBox())!
  const parked = (await van(page).getAttribute('data-parked')) === 'true'
  return { x: box.x + 28, y: box.y + 27 + (parked ? PARKED_LIFT : 0) }
}

/** Is the drawn vehicle where the ride says it is (within a few pixels, once its short transitions are over)? */
async function expectVanAtSample(page: Page, app: App) {
  await expect
    .poll(async () => {
      const s = await sample(page)
      const expected = await app.screenPoint(s.position.lat, s.position.lng)
      const actual = await vanAnchor(page)
      return Math.hypot(actual.x - expected.x, actual.y - expected.y)
    })
    .toBeLessThan(4)
}

test.describe('the ride button', () => {
  test('is disabled, with the reason, until there are two places', async ({ page, app }) => {
    await app.goto()
    await expect(rideButton(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(rideButton(page)).toContainText('Ride')
    await rideButton(page).hover()
    await expect(page.locator('.tooltip')).toHaveText(/at least two places/i)
    // Playwright's click waits for an enabled control: force it, as a user pressing a greyed-out button would.
    await rideButton(page).click({ force: true })
    await expect(hud(page)).toHaveCount(0)

    await app.addPlaces('Lyon')
    await expect(rideButton(page)).toHaveAttribute('aria-disabled', 'true')
    await app.addPlaces('Annecy')
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await expect(rideButton(page)).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('waits while a route is still loading', async ({ page, app, mocks }) => {
    mocks.osrm.delayMs = 1500
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'loading')
    await expect(rideButton(page)).toHaveAttribute('aria-disabled', 'true')
    await rideButton(page).hover()
    await expect(page.locator('.tooltip')).toHaveText(/still loading/i)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await expect(rideButton(page)).not.toHaveAttribute('aria-disabled', 'true')
  })
})

test.describe('riding', () => {
  test('starts on day 0 with the HUD, the van on the first place, and the day advances as it drives', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await startRide(page, app)
    await expect(rideButton(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(day(page)).toHaveText('Day 0')
    await expect(page.getByTestId('ride-caption')).toHaveText('Starting in Lyon')
    await expect(van(page)).toBeVisible()
    await expect(van(page)).toHaveAttribute('data-vehicle', 'drive')
    await expect(page.getByTestId('ride-play')).toBeFocused()
    await expect(page.getByTestId('ride-distance')).toHaveText('0 m')

    // At 4× the whole trip (rest day + two travel days) takes ~1.4 s.
    await page.getByRole('radio', { name: '4×' }).click()
    await page.getByTestId('ride-play').click()
    await expect(day(page)).toHaveText('Day 1')
    await expect(page.getByTestId('ride-caption')).toHaveText('Lyon → Annecy')
    await expect(day(page)).toHaveText('Day 2')
    await expect(page.getByTestId('ride-caption')).toHaveText('Annecy → Zurich')
    await expect(hud(page)).toHaveAttribute('data-playing', 'false')
    await expect(page.getByTestId('ride-caption')).toHaveText('Arrived in Zurich')
    await expect(hud(page)).toHaveAttribute('data-finished', 'true')
    await expect(page.getByTestId('ride-stop')).toHaveText('Stop 3 of 3')
    // Played to the end: the play button now offers a replay.
    await expect(page.getByTestId('ride-play')).toHaveAttribute('aria-label', 'Replay')
  })

  test('the van moves along the route: in step with the ride, on the line, covering the whole leg', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await startRide(page, app)
    const path = await app.legPath(0)
    // The ride starts with a rest day (0.6 s), then the single leg takes 2.5 s.
    const seen: Array<{ x: number; y: number }> = []
    for (const t of [0.6, 1.2, 1.85, 2.5, 3.1]) {
      await seek(page, t)
      await expectVanAtSample(page, app)
      const s = await sample(page)
      expect(distanceToPathM(s.position, path)).toBeLessThan(30)
      seen.push(await vanAnchor(page))
    }
    // Progress from the first place to the last.
    const xs = seen.map((p) => p.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    expect(xs[4] - xs[0]).toBeGreaterThan(100)
    const s = await sample(page)
    expect(s.placeIndex).toBe(1)
    expect(s.finished).toBe(true)
  })

  test('shows the distance so far, the date when the trip has a start date, and rest days', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await setDays(page, 1, 2, 5)
    await page.evaluate(() => window.__ROADMAP__!.trip.getState().setStartDate('2026-07-30'))
    await startRide(page, app)
    await expect(day(page)).toHaveText('Day 1')
    await expect(page.getByTestId('ride-date')).toHaveText('Thu 30 Jul 2026')

    // Days: 1 (rest, start), 2 (leg 1), 3-4 (rest in Annecy), 5 (leg 2).
    await seek(page, 0.6 + 1.25)
    await expect(day(page)).toHaveText('Day 2')
    await expect(page.getByTestId('ride-date')).toHaveText('Fri 31 Jul 2026')
    await expect(page.getByTestId('ride-caption')).toHaveText('Lyon → Annecy')
    const half = await page.getByTestId('ride-distance').innerText()
    const routeKm = (await app.legRoute(0)).distanceM / 1000
    expect(parseFloat(half.replace(/\s/g, ''))).toBeCloseTo(routeKm / 2, -1)

    await seek(page, 0.6 + 2.5 + 0.3)
    await expect(day(page)).toHaveText('Day 3')
    await expect(page.getByTestId('ride-caption')).toHaveText('Resting in Annecy')
    await expect(page.getByTestId('ride-date')).toHaveText('Sat 1 Aug 2026')
    await seek(page, 0.6 + 2.5 + 0.9)
    await expect(day(page)).toHaveText('Day 4')
    await seek(page, 0.6 + 2.5 + 1.2 + 0.3)
    await expect(day(page)).toHaveText('Day 5')
    await expect(page.getByTestId('ride-caption')).toHaveText('Annecy → Zurich')
    await expect(page.getByTestId('ride-date')).toHaveText('Mon 3 Aug 2026')
  })

  test('faces the way it drives (west when going back), never upside-down', async ({ page, app }) => {
    await openTrip(page, app, 'Zurich', 'Annecy', 'Vienna')
    await startRide(page, app)
    // Zurich → Annecy runs west-south-west, Annecy → Vienna east.
    await seek(page, 0.6 + 1.2)
    await expect(van(page)).toHaveAttribute('data-facing', 'west')
    await seek(page, 0.6 + 2.5 + 1.2)
    await expect(van(page)).toHaveAttribute('data-facing', 'east')
    // Mirrored horizontally at most, never rotated: matrix(±1, 0, 0, 1, …) once the short turn-round is over.
    await expect
      .poll(() => van(page).evaluate((el) => getComputedStyle(el).transform))
      .toMatch(/^(none|matrix\(1, 0, 0, 1,)/)
  })

  test('changes vehicle on a ferry crossing inside a drive leg, and on train and flight legs', async ({ page, app }) => {
    await openTrip(page, app, 'Dover', 'Calais', 'Paris')
    await expect.poll(async () => (await app.legRoute(0)).spans?.some((s) => s.mode === 'ferry')).toBe(true)
    await startRide(page, app)
    const vehicles = new Set<string>()
    for (let t = 0.6; t < 3.1; t += 0.05) {
      await seek(page, t)
      vehicles.add((await sample(page)).mode)
    }
    expect([...vehicles].sort()).toEqual(['drive', 'ferry'])
    // On the crossing the drawn vehicle is the ferry.
    let found = false
    for (let t = 0.6; t < 3.1 && !found; t += 0.05) {
      await seek(page, t)
      found = (await sample(page)).mode === 'ferry'
    }
    await expect(van(page)).toHaveAttribute('data-vehicle', 'ferry')
    await expect(page.getByTestId('ride-vehicle-name')).toHaveText('Ferry')

    await page.getByTestId('ride-close').click()
    await page.evaluate(() => {
      const { trip } = window.__ROADMAP__!.trip.getState()
      window.__ROADMAP__!.trip.getState().updateLeg(trip.legs[1].id, { mode: 'train' })
    })
    await page.evaluate(() => {
      const { trip } = window.__ROADMAP__!.trip.getState()
      window.__ROADMAP__!.trip.getState().updateLeg(trip.legs[0].id, { mode: 'flight' })
    })
    await startRide(page, app)
    const day1 = 0.6 + 1.25
    await seek(page, day1)
    await expect(van(page)).toHaveAttribute('data-vehicle', 'flight')
    await seek(page, day1 + 2.5)
    await expect(van(page)).toHaveAttribute('data-vehicle', 'train')
  })

  test('highlights the trail travelled so far over a dimmed route, and the stops reached', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await startRide(page, app)
    await seek(page, 0.6 + 2.5 + 1.25)
    // Leg 0 is done (trail "done"), leg 1 half way (trail "current").
    await expect(page.locator('path[data-trail="done"][data-role="ride-trail-line"][data-mode="drive"]')).toHaveCount(1)
    expect(await page.locator('path[data-trail="done"][data-role="ride-trail-line"]').first().getAttribute('d')).toMatch(/^M/)
    const lengths = await page.evaluate(() => {
      const len = (trail: string) =>
        document.querySelector<SVGPathElement>(`path[data-trail="${trail}"][data-role="ride-trail-line"][data-mode="drive"]`)!.getTotalLength()
      return { done: len('done'), current: len('current') }
    })
    expect(lengths.done).toBeGreaterThan(50)
    expect(lengths.current).toBeGreaterThan(20)
    // The planned route is dimmed beneath.
    await expect(page.locator('.leaflet-pane.ride-dimmed')).not.toHaveCount(0)
    await expect
      .poll(() => page.locator('.ride-dimmed').first().evaluate((el) => Number(getComputedStyle(el).opacity)))
      .toBeLessThan(0.6)
    // Stops: Lyon and Annecy are reached, Zurich not yet.
    const states = await page.locator('.ride-halo').evaluateAll((els) => els.map((el) => el.getAttribute('data-state')))
    expect(states).toEqual(['reached', 'reached', 'idle'])
    // The sidebar rows show the same.
    await expect(page.locator('.place-card[data-ride="reached"]')).toHaveCount(1)
    await expect(page.getByTestId('place-item').nth(1).locator('.place-card')).toHaveAttribute('data-ride', 'current')
    await seek(page, 0.6 + 2.5 + 2.5)
    await expect(page.locator('.ride-halo[data-state="reached"]')).toHaveCount(3)
    await seek(page, 0.6 + 1.5)
    await expect(page.locator('.place-card[data-ride="reached"]')).toHaveCount(0)
    await expect(page.getByTestId('place-item').nth(0).locator('.place-card')).toHaveAttribute('data-ride', 'current')
  })

  test('the current place is highlighted in the list on a rest day', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await setDays(page, 0, 1, 4)
    await startRide(page, app)
    await seek(page, 0.6 + 2.5 + 0.5)
    await expect(day(page)).toHaveText('Day 2')
    const rows = page.getByTestId('place-item')
    await expect(rows.nth(1).locator('.place-card')).toHaveAttribute('data-ride', 'current')
    await expect(rows.nth(0).locator('.place-card')).toHaveAttribute('data-ride', 'reached')
    await expect(rows.nth(2).locator('.place-card')).not.toHaveAttribute('data-ride', /.+/)
    await expect(page.locator('.ride-halo[data-state="current"]')).toHaveCount(1)
  })
})

test.describe('controls', () => {
  test('pause, play, restart, speed and seeking', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await startRide(page, app)
    const play = page.getByTestId('ride-play')
    await expect(play).toHaveAttribute('aria-label', 'Play')
    await play.click()
    await expect(play).toHaveAttribute('aria-label', 'Pause')
    await play.click()
    await expect(play).toHaveAttribute('aria-label', 'Play')
    const frozen = (await rideState(page)).time
    await page.waitForTimeout(400)
    expect((await rideState(page)).time).toBe(frozen)

    await play.click()
    await expect.poll(async () => (await rideState(page)).time).toBeGreaterThan(frozen + 0.2)
    await play.click()

    // Speed.
    await page.getByRole('radio', { name: '2×' }).click()
    expect((await rideState(page)).speed).toBe(2)
    await expect(page.getByRole('radio', { name: '2×' })).toBeChecked()
    await page.getByRole('radio', { name: '0.5×' }).click()
    expect((await rideState(page)).speed).toBe(0.5)

    // Seeking: dragging the scrubber to the end shows the last day; ticks for each day are drawn.
    await expect(page.getByTestId('ride-tick')).toHaveCount(3)
    const scrub = page.getByTestId('ride-scrub')
    const { duration } = await rideState(page)
    await scrub.fill(String(duration! * 0.5))
    expect((await rideState(page)).time).toBeCloseTo(duration! * 0.5, 2)
    await expect(day(page)).toHaveText('Day 1')
    await scrub.fill(String(duration))
    await expect(day(page)).toHaveText('Day 2')
    // The day also rides along with the vehicle on the map.
    await expect(page.getByTestId('ride-day-tag')).toHaveText('Day 2')
    await expectVanAtSample(page, app)

    // Restart goes back to the beginning and plays.
    await page.getByTestId('ride-restart').click()
    await expect(day(page)).toHaveText('Day 0')
    expect((await rideState(page)).playing).toBe(true)
    await page.getByTestId('ride-play').click()
  })

  test('the scrubber can be dragged with the mouse and the ride carries on from there', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await startRide(page, app, { playing: true })
    const box = (await page.getByTestId('ride-scrub').boundingBox())!
    await page.mouse.move(box.x + 12, box.y + 10)
    await page.mouse.down()
    // Held: paused.
    await expect.poll(async () => (await rideState(page)).playing).toBe(false)
    await page.mouse.move(box.x + box.width * 0.75, box.y + 10, { steps: 6 })
    await expect(day(page)).toHaveText('Day 2')
    await page.mouse.up()
    await expect.poll(async () => (await rideState(page)).playing).toBe(true)
    expect((await rideState(page)).time).toBeGreaterThan(5.6 * 0.6)
  })

  test('releasing the scrubber outside the slider still resumes playback', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await startRide(page, app, { playing: true })
    const box = (await page.getByTestId('ride-scrub').boundingBox())!
    await page.mouse.move(box.x + 12, box.y + 10)
    await page.mouse.down()
    await expect.poll(async () => (await rideState(page)).playing).toBe(false)
    // Drag away over the sidebar and let go there.
    await page.mouse.move(box.x + box.width * 0.6, box.y + 10, { steps: 4 })
    await page.mouse.move(120, 400, { steps: 10 })
    await page.mouse.up()
    await expect.poll(async () => (await rideState(page)).playing).toBe(true)
    // A paused ride stays paused when the scrubber is let go outside too.
    await page.evaluate(() => window.__ROADMAP__!.ride!.pause())
    await page.mouse.move(box.x + 12, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(120, 400, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    expect((await rideState(page)).playing).toBe(false)
  })

  test('keyboard: Space plays and pauses, the arrows step a day (also with the map focused)', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await startRide(page, app)
    await expect(page.getByTestId('ride-play')).toBeFocused()
    await page.keyboard.press('Space')
    await expect.poll(async () => (await rideState(page)).playing).toBe(true)
    await page.keyboard.press('Space')
    await expect.poll(async () => (await rideState(page)).playing).toBe(false)
    await seek(page, 0)

    await page.keyboard.press('ArrowRight')
    await expect(day(page)).toHaveText('Day 1')
    await page.keyboard.press('ArrowRight')
    await expect(day(page)).toHaveText('Day 2')
    await page.keyboard.press('ArrowRight')
    expect((await rideState(page)).time).toBe((await rideState(page)).duration)
    await page.keyboard.press('ArrowLeft')
    await expect(day(page)).toHaveText('Day 1')
    await page.keyboard.press('ArrowLeft')
    await expect(day(page)).toHaveText('Day 0')

    // From the map (focus on the Leaflet container) the same keys apply and do not pan the map.
    await app.settle()
    const before = await app.mapView()
    await page.locator('.leaflet-container').focus()
    await page.keyboard.press('ArrowRight')
    await expect(day(page)).toHaveText('Day 1')
    expect(await app.mapView()).toEqual(before)
    await page.keyboard.press('Space')
    await expect.poll(async () => (await rideState(page)).playing).toBe(true)
  })

  test('Escape closes the ride and gives the focus back to the ride button', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await startRide(page, app)
    await page.keyboard.press('Escape')
    await expect(hud(page)).toHaveCount(0)
    await expect(rideButton(page)).toBeFocused()
    expect((await rideState(page)).active).toBe(false)
    // Escape with no ride on does nothing special.
    await page.keyboard.press('Escape')
    await expect(rideButton(page)).toBeFocused()
  })

  test('the speed buttons keep their own arrow-key behaviour', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await startRide(page, app)
    await seek(page, 0)
    await page.getByRole('radio', { name: '1×' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: '2×' })).toBeFocused()
    await expect(day(page)).toHaveText('Day 0')
  })

  test('close ends the ride and puts everything back', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    const before = await app.mapView()
    await startRide(page, app)
    await page.getByTestId('ride-close').click()
    await expect(hud(page)).toHaveCount(0)
    await expect(van(page)).toHaveCount(0)
    await expect(page.locator('.ride-halo')).toHaveCount(0)
    await expect(page.locator('path[data-role^="ride-trail"]')).toHaveCount(0)
    await expect(page.locator('.leaflet-pane.ride-dimmed')).toHaveCount(0)
    await expect(page.locator('[inert]')).toHaveCount(0)
    await expect(rideButton(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(rideButton(page)).toBeFocused()
    await app.settle()
    const after = await app.mapView()
    expect(after.zoom).toBe(before.zoom)
    expect(Math.abs(after.lat - before.lat)).toBeLessThan(0.01)
    expect(Math.abs(after.lng - before.lng)).toBeLessThan(0.01)
  })

  test('the ride button closes a ride too', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await startRide(page, app)
    await rideButton(page).click()
    await expect(hud(page)).toHaveCount(0)
  })
})

test.describe('editing is disabled while riding', () => {
  test('markers cannot be dragged, the map has no context menu, the list and undo are locked; closing restores them', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    const before = await app.trip()
    const history = await app.history()
    await startRide(page, app)
    await seek(page, 0)

    // The list is read-only.
    await expect(page.getByTestId('places-panel')).toHaveAttribute('inert', '')
    await expect(page.getByTestId('undo')).toBeDisabled()
    await expect(page.getByTestId('redo')).toBeDisabled()
    await page.keyboard.press('Control+z')

    // Dragging a marker only pans the map; nothing in the trip changes.
    const lyon = await app.screenPoint(before.places[0].lat, before.places[0].lng)
    await page.mouse.move(lyon.x, lyon.y)
    await page.mouse.down()
    await page.mouse.move(lyon.x + 90, lyon.y - 60, { steps: 8 })
    await page.mouse.up()
    // A line cannot be reshaped either (no handle, no via point).
    const mid = (await app.legPath(1))[5]
    const on = await app.screenPoint(mid.lat, mid.lng)
    await page.mouse.move(on.x, on.y, { steps: 4 })
    await expect(page.locator('.via-point--ghost')).toHaveCount(0)
    await page.mouse.down()
    await page.mouse.move(on.x + 80, on.y + 80, { steps: 8 })
    await page.mouse.up()
    // Right-click on the map and on a marker: no menu.
    await page.mouse.click(600, 500, { button: 'right' })
    await page.mouse.click(lyon.x, lyon.y, { button: 'right' })
    await expect(page.getByRole('menu')).toHaveCount(0)

    expect(await app.trip()).toEqual(before)
    expect(await app.history()).toEqual(history)
    await expect(page.locator('.leaflet-pane.ride-dimmed')).not.toHaveCount(0)

    // Closing hands everything back.
    await page.getByTestId('ride-close').click()
    await expect(page.getByTestId('places-panel')).not.toHaveAttribute('inert', '')
    await page.mouse.click(600, 500, { button: 'right' })
    await expect(page.getByRole('menu', { name: 'Map actions' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.getByTestId('place-main').first().click()
    await expect(page.getByTestId('place-panel')).toBeVisible()
  })

  test('the trip title is read-only while riding and editable again after', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const title = page.getByTestId('trip-title')
    const before = (await app.trip()).title
    await expect(title).toBeEditable()
    await startRide(page, app)
    await expect(title).toHaveAttribute('readonly', '')
    await title.click()
    await page.keyboard.type('Hijacked')
    await page.keyboard.press('Enter')
    expect((await app.trip()).title).toBe(before)
    await expect(title).toHaveValue(before)

    await page.getByTestId('ride-close').click()
    await expect(title).toBeEditable()
    await title.fill('Alps')
    await page.keyboard.press('Enter')
    expect((await app.trip()).title).toBe('Alps')
  })

  test('a ride ended by another trip leaves the map as whatever replaced the trip left it', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await startRide(page, app)
    // Like opening a file: the new trip is in, and the map is fitted to it in the same breath.
    await page.evaluate((trip) => {
      window.__ROADMAP__!.trip.getState().replaceTrip(trip)
      window.__ROADMAP__!.getMap()!.setView([10, 10], 5, { animate: false })
    }, createTrip())
    await expect(hud(page)).toHaveCount(0)
    await page.waitForTimeout(700)
    const view = await app.mapView()
    expect(view.zoom).toBe(5)
    expect(view.lat).toBeCloseTo(10, 1)
    expect(view.lng).toBeCloseTo(10, 1)
    await expect(page.locator('.leaflet-pane.ride-dimmed')).toHaveCount(0)
  })

  test('an open row, the leg editor and the selection are put away when the ride starts', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await page.getByTestId('leg-summary').first().click()
    await expect(page.getByTestId('leg-editor')).toBeVisible()
    await startRide(page, app)
    await expect(page.getByTestId('leg-editor')).toHaveCount(0)
    const ui = await app.ui()
    expect(ui.selectedLegId).toBeNull()
    expect(ui.expandedPlaceId).toBeNull()
  })

  test('opening another trip ends the ride; a late change to the same trip does not', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await startRide(page, app)
    await seek(page, 3)
    // A name arriving late (reverse geocoding) keeps the ride going, from the same time.
    await page.evaluate(() => {
      const store = window.__ROADMAP__!.trip
      store.getState().updatePlace(store.getState().trip.places[1].id, { name: 'Annecy-le-Vieux' })
    })
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    expect((await rideState(page)).time).toBeCloseTo(3, 1)
    await seek(page, 0.6 + 2.5 + 0.1)
    await expect(page.getByTestId('ride-caption')).toHaveText('Annecy-le-Vieux → Zurich')

    await page.evaluate((trip) => window.__ROADMAP__!.trip.getState().replaceTrip(trip), createTrip())
    await expect(hud(page)).toHaveCount(0)
    expect((await rideState(page)).active).toBe(false)
  })
})

test.describe('camera', () => {
  test('without Follow the whole trip is shown from the start', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([43, 0], 5, { animate: false }))
    await startRide(page, app)
    await app.settle()
    const view = await page.evaluate(() => {
      const map = window.__ROADMAP__!.getMap()!
      const b = map.getBounds()
      return { contains: [[45.7578, 4.832], [45.8992, 6.1289]].map(([la, ln]) => b.contains([la, ln])), zoom: map.getZoom() }
    })
    expect(view.contains).toEqual([true, true])
    expect(view.zoom).toBeGreaterThan(7)
    // Both stops clear the ride controls at the bottom.
    const hudTop = (await hud(page).boundingBox())!.y
    for (const name of ['Lyon', 'Annecy']) {
      const marker = page.locator(`.place-marker`).filter({ hasText: name === 'Lyon' ? '1' : '2' }).first()
      expect((await marker.boundingBox())!.y + 30).toBeLessThan(hudTop)
    }
  })

  test('Follow keeps the van in view at a steady zoom while it drives across the trip', async ({ page, app }) => {
    await openTrip(page, app, 'Paris', 'Lyon', 'Zurich', 'Vienna')
    await startRide(page, app)
    await page.evaluate(() => {
      window.__ROADMAP__!.ride!.pause()
      window.__ROADMAP__!.ride!.setSpeed(2)
    })
    await page.getByTestId('ride-follow').click()
    await expect(page.getByTestId('ride-follow')).toHaveAttribute('aria-pressed', 'true')
    await app.settle()
    const zoom0 = (await app.mapView()).zoom
    expect(zoom0).toBeGreaterThanOrEqual(5)
    await page.evaluate(() => window.__ROADMAP__!.ride!.play())

    const size = await page.evaluate(() => {
      const s = window.__ROADMAP__!.getMap()!.getSize()
      return { x: s.x, y: s.y }
    })
    // Every map move ends in a `moveend` (and makes Leaflet re-clip every line): count them.
    await page.evaluate(() => {
      const w = window as unknown as { __moveends: number }
      w.__moveends = 0
      window.__ROADMAP__!.getMap()!.on('moveend', () => w.__moveends++)
    })
    const zooms = new Set<number>()
    let samples = 0
    for (let i = 0; i < 45; i++) {
      const { playing } = await rideState(page)
      if (!playing) break
      const point = await page.evaluate(() => {
        const map = window.__ROADMAP__!.getMap()!
        const s = window.__ROADMAP__!.ride!.sample()!
        const p = map.latLngToContainerPoint([s.position.lat, s.position.lng])
        // Where the ride controls begin, in the map's own coordinates.
        const hudTop = document.querySelector('.ride-hud')!.getBoundingClientRect().top - map.getContainer().getBoundingClientRect().top
        return { x: p.x, y: p.y, zoom: map.getZoom(), hudTop }
      })
      expect(point.x).toBeGreaterThan(0)
      expect(point.x).toBeLessThan(size.x)
      expect(point.y).toBeGreaterThan(0)
      // In view, and never behind the ride controls.
      expect(point.y).toBeLessThan(point.hudTop)
      zooms.add(point.zoom)
      samples++
      await page.waitForTimeout(250)
    }
    expect(samples).toBeGreaterThan(10)
    // The camera glides now and then; it does not nudge the map every frame (that would be hundreds).
    const moveends = await page.evaluate(() => (window as unknown as { __moveends: number }).__moveends)
    expect(moveends).toBeLessThan(samples)
    // No zoom ping-pong: one zoom level the whole way.
    expect([...zooms]).toEqual([zoom0])
  })

  test('dragging the map takes the camera: Follow turns off and the view stays where it was put', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await startRide(page, app)
    await page.getByTestId('ride-follow').click()
    await app.settle()
    await page.evaluate(() => window.__ROADMAP__!.ride!.pause())
    const box = (await page.locator('.leaflet-container').boundingBox())!
    // Grab open map: right of the title card (top-left), left of the tools, above the HUD.
    const x = box.x + box.width * 0.7
    const y = box.y + box.height * 0.45
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 120, y + 60, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByTestId('ride-follow')).toHaveAttribute('aria-pressed', 'false')
    expect((await rideState(page)).follow).toBe(false)
    await app.settle()
    const view = await app.mapView()
    await page.waitForTimeout(500)
    expect(await app.mapView()).toEqual(view)
  })
})

test.describe('playback behaviour', () => {
  test('pauses while the tab is hidden and carries on when it is shown again', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await startRide(page, app, { playing: true })
    await expect.poll(async () => (await rideState(page)).time).toBeGreaterThan(0.2)
    const setHidden = (hidden: boolean) =>
      page.evaluate((h) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => h })
        document.dispatchEvent(new Event('visibilitychange'))
      }, hidden)
    await setHidden(true)
    await expect.poll(async () => (await rideState(page)).playing).toBe(false)
    const time = (await rideState(page)).time
    await page.waitForTimeout(300)
    expect((await rideState(page)).time).toBe(time)
    await setHidden(false)
    await expect.poll(async () => (await rideState(page)).playing).toBe(true)
    await expect.poll(async () => (await rideState(page)).time).toBeGreaterThan(time + 0.2)
  })

  test('a paused ride stays paused when the tab comes back', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await startRide(page, app)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForTimeout(200)
    expect((await rideState(page)).playing).toBe(false)
  })

  test('with reduced motion the ride steps from day to day instead of moving continuously', async ({ page, app }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich', 'Vienna')
    await startRide(page, app)
    await page.evaluate(() => {
      window.__ROADMAP__!.ride!.setSpeed(4)
      window.__ROADMAP__!.ride!.play()
    })
    const days: number[] = []
    const progress = new Set<number>()
    for (let i = 0; i < 60; i++) {
      const s = await sample(page)
      if (days.at(-1) !== s.day) days.push(s.day)
      progress.add(Math.round(s.legProgress * 100) / 100)
      if (s.finished) break
      await page.waitForTimeout(80)
    }
    // Days come one at a time, in order; the van is only ever seen at the start of its stay or the end of a leg.
    expect(days).toEqual([0, 1, 2, 3])
    expect([...progress].every((p) => p === 0 || p === 1)).toBe(true)
    await expect(page.getByTestId('ride-caption')).toHaveText('Arrived in Vienna')
  })
})
