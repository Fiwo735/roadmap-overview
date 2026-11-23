import type { Locator, Page } from '@playwright/test'
import { formatDistance, formatDuration } from '../src/lib/format'
import { computeManualRoute } from '../src/lib/manualRoute'
import { decodePolyline } from '../src/lib/polyline'
import { MODES, STRAIGHT_DRIVE_DASH } from '../src/lib/modes'
import { expect, findPlace, test, type App } from './fixtures'
import { FERRY_DURATION_S, FERRY_PORTS } from './mocks/osrm'

const connector = (page: Page, i: number) => page.getByTestId('leg-connector').nth(i)
const summary = (page: Page, i: number) => connector(page, i).getByTestId('leg-summary')
const summaryText = (page: Page, i: number) => connector(page, i).getByTestId('leg-summary-text')
const editor = (page: Page) => page.getByTestId('leg-editor')
const modeRadio = (page: Page, name: string) => editor(page).getByRole('radio', { name })
const hours = (page: Page) => page.getByTestId('leg-duration-h')
const minutes = (page: Page) => page.getByTestId('leg-duration-min')
const label = (page: Page) => page.getByTestId('leg-label-input')
const legLine = (page: Page, legId: string, role = 'route-line') => page.locator(`path[data-role="${role}"][data-leg-id="${legId}"]`)
const badges = (page: Page, legId?: string) => page.locator(legId ? `.leg-badge[data-leg-id="${legId}"]` : '.leg-badge')
const legend = (page: Page) => page.getByTestId('map-legend')
const ghost = (page: Page) => page.locator('.via-point--ghost')
/** What Leaflet draws for a polyline with no points (the ferry pieces of a leg without a crossing). */
const EMPTY_PATH = 'M0 0'

/** The places' coordinates in the gazetteer, for expected values. */
const at = (name: string) => {
  const { lat, lng } = findPlace(name)
  return { lat, lng }
}

/** Open the app with these places, wait until every road leg is routed and show them all. */
async function openTrip(page: Page, app: App, ...names: string[]) {
  await app.goto()
  await app.addPlaces(...names)
  for (let i = 0; i + 1 < names.length; i++) await expect(connector(page, i)).toHaveAttribute('data-status', 'ok')
  await page.getByTestId('fit-trip').click()
  await app.settle()
}

/** Select leg `i` from the sidebar, which opens its editor. */
async function openEditor(page: Page, i: number) {
  await summary(page, i).click()
  await expect(editor(page)).toBeVisible()
}

const legId = async (app: App, i: number) => (await app.trip()).legs[i].id
const leg = async (app: App, i: number) => (await app.trip()).legs[i]

const center = async (loc: Locator) => {
  const box = (await loc.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test.describe('the leg editor', () => {
  test('selecting a leg opens its editor under the summary; Escape, another leg and a click elsewhere close it', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await expect(editor(page)).toHaveCount(0)
    await summary(page, 0).click()
    await expect(editor(page)).toHaveCount(1)
    await expect(connector(page, 0).getByTestId('leg-editor')).toBeVisible()
    await expect(summary(page, 0)).toHaveAttribute('aria-expanded', 'true')
    await expect(modeRadio(page, 'Drive')).toBeChecked()
    await expect(page.getByTestId('leg-follow-roads')).toBeVisible()

    // Another leg takes the editor over.
    await summary(page, 1).click()
    await expect(editor(page)).toHaveCount(1)
    await expect(connector(page, 1).getByTestId('leg-editor')).toBeVisible()

    // Escape closes it and leaves the focus on the summary.
    await page.keyboard.press('Escape')
    await expect(editor(page)).toHaveCount(0)
    expect((await app.ui()).selectedLegId).toBeNull()
    await expect(summary(page, 1)).toBeFocused()

    // A click elsewhere in the sidebar closes it too; so does Escape typed in one of its fields.
    await openEditor(page, 0)
    await page.getByRole('heading', { name: 'Places' }).click()
    await expect(editor(page)).toHaveCount(0)
    await openEditor(page, 0)
    await label(page).fill('half typed')
    await label(page).press('Escape')
    await expect(editor(page)).toHaveCount(0)
    expect((await leg(app, 0)).label).toBeUndefined()

    // Selecting the line on the map opens it as well, and a click on the empty map closes it.
    const id = await legId(app, 0)
    await page.mouse.click(1000, 120)
    // Selecting the leg from the sidebar flew the map to it: wait for that before aiming at the line.
    await app.settle()
    const path = await app.legPath(0)
    const mid = await app.screenPoint(path[Math.floor(path.length / 2)].lat, path[Math.floor(path.length / 2)].lng)
    await page.mouse.move(mid.x + 12, mid.y + 12)
    await page.mouse.click(mid.x, mid.y)
    expect((await app.ui()).selectedLegId).toBe(id)
    await expect(connector(page, 0).getByTestId('leg-editor')).toBeVisible()
    await page.mouse.click(1000, 120)
    await expect(editor(page)).toHaveCount(0)
  })

  test('the collapsed connector shows the mode icon, the label, the distance and the duration', async ({ page, app }) => {
    await openTrip(page, app, 'Portsmouth', 'Santander')
    await openEditor(page, 0)
    await modeRadio(page, 'Ferry').click()
    await label(page).fill('Brittany Ferries · Portsmouth → Santander')
    await label(page).press('Enter')
    await page.getByRole('heading', { name: 'Places' }).click()
    await expect(editor(page)).toHaveCount(0)

    const route = computeManualRoute(at('Portsmouth'), [], at('Santander'), 'ferry')
    await expect(connector(page, 0)).toHaveAttribute('data-mode', 'ferry')
    await expect(connector(page, 0).getByTestId('leg-label')).toHaveText('Brittany Ferries · Portsmouth → Santander')
    await expect(summaryText(page, 0)).toHaveText(`${formatDistance(route.distanceM)} · ${formatDuration(route.durationS)}`)
    await expect(summary(page, 0)).toHaveAccessibleName(/^Ferry from Portsmouth to Santander \(Brittany Ferries · Portsmouth → Santander\): /)
    // The mode icon takes the mode's colour.
    await expect(connector(page, 0).locator('.leg-summary__icon')).toHaveCSS('border-top-color', 'rgb(8, 145, 178)')
  })

  test('switching to Ferry draws a dashed line with a ship badge and an estimated duration; undo restores the drive', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Portsmouth', 'Santander')
    const id = await legId(app, 0)
    const requests = mocks.osrm.requests.length
    const roadSummary = await summaryText(page, 0).textContent()
    await expect(legLine(page, id)).toHaveAttribute('stroke', MODES.drive.color)
    await expect(badges(page)).toHaveCount(0)

    const before = await app.history()
    await openEditor(page, 0)
    await modeRadio(page, 'Ferry').click()
    expect((await leg(app, 0)).mode).toBe('ferry')
    expect(await app.history()).toEqual({ past: before.past + 1, future: 0 })

    const estimate = computeManualRoute(at('Portsmouth'), [], at('Santander'), 'ferry')
    await expect(legLine(page, id)).toHaveAttribute('stroke', MODES.ferry.color)
    await expect(legLine(page, id)).toHaveAttribute('stroke-dasharray', MODES.ferry.dashArray!)
    await expect(legLine(page, id, 'route-casing')).toHaveAttribute('stroke', MODES.ferry.casing!)
    await expect(badges(page, id)).toHaveCount(1)
    await expect(badges(page, id)).toHaveAttribute('data-mode', 'ferry')
    await expect(summaryText(page, 0)).toHaveText(`${formatDistance(estimate.distanceM)} · ${formatDuration(estimate.durationS)}`)
    await expect(page.getByTestId('leg-duration-hint')).toHaveText('Estimated from the distance')
    const totalMin = Math.round(estimate.durationS / 60)
    await expect(hours(page)).toHaveValue(String(Math.floor(totalMin / 60)))
    await expect(minutes(page)).toHaveValue(String(totalMin % 60))
    // The ferry needs no router: nothing was asked of OSRM.
    expect(mocks.osrm.requests).toHaveLength(requests)

    // Undo (the editor stays open on the selected leg) brings the road back from the cache.
    await page.getByTestId('undo').click()
    expect((await leg(app, 0)).mode).toBe('drive')
    await expect(legLine(page, id)).toHaveAttribute('stroke', MODES.drive.color)
    await expect(badges(page)).toHaveCount(0)
    await expect(summaryText(page, 0)).toHaveText(roadSummary!)
    await expect(modeRadio(page, 'Drive')).toBeChecked()
    await page.getByTestId('redo').click()
    expect((await leg(app, 0)).mode).toBe('ferry')
    await expect(badges(page, id)).toHaveCount(1)
    expect(mocks.osrm.requests).toHaveLength(requests)
  })

  test('the arrow keys only move the focus; Enter or Space chooses (no steps or requests on the way)', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const id = await legId(app, 0)
    const requests = mocks.osrm.requests.length
    await openEditor(page, 0)
    const before = await app.history()
    await modeRadio(page, 'Drive').focus()
    // Walk over every option: nothing is chosen, so nothing is recorded or routed.
    await page.keyboard.press('ArrowRight')
    await expect(modeRadio(page, 'Ferry')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(modeRadio(page, 'Flight')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(modeRadio(page, 'Drive')).toBeFocused()
    await page.keyboard.press('End')
    await expect(modeRadio(page, 'Flight')).toBeFocused()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    await expect(modeRadio(page, 'Flight')).toBeFocused()
    expect((await leg(app, 0)).mode).toBe('drive')
    await expect(modeRadio(page, 'Drive')).toBeChecked()
    expect(await app.history()).toEqual(before)
    expect(mocks.osrm.requests).toHaveLength(requests)
    // The tab stop follows the focus while it is in the group.
    await expect(modeRadio(page, 'Flight')).toHaveAttribute('tabindex', '0')
    await expect(modeRadio(page, 'Drive')).toHaveAttribute('tabindex', '-1')

    // Enter and Space choose, one step each.
    await page.keyboard.press('Enter')
    expect((await leg(app, 0)).mode).toBe('flight')
    await expect(modeRadio(page, 'Flight')).toBeChecked()
    await expect(legLine(page, id)).toHaveAttribute('stroke', MODES.flight.color)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Space')
    expect((await leg(app, 0)).mode).toBe('train')
    await expect(legLine(page, id)).toHaveAttribute('stroke', MODES.train.color)
    await expect(legLine(page, id)).toHaveAttribute('stroke-dasharray', MODES.train.dashArray!)
    await expect(badges(page, id)).toHaveAttribute('data-mode', 'train')
    expect(await app.history()).toEqual({ past: before.past + 2, future: 0 })

    // Back out of the group, the tab stop is the chosen option again.
    await page.keyboard.press('Tab')
    await expect(modeRadio(page, 'Train')).toHaveAttribute('tabindex', '0')
    await expect(modeRadio(page, 'Ferry')).toHaveAttribute('tabindex', '-1')
  })

  test('switching between a road route and a hand-drawn kind drops the via points in the same step; among hand-drawn kinds they stay', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const id = await legId(app, 0)
    const via = [{ lat: 45.95, lng: 5.5 }]
    await page.evaluate(([legId, points]) => window.__ROADMAP__!.trip.getState().updateLeg(legId, { via: points }), [id, via] as const)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await openEditor(page, 0)
    await expect(page.getByTestId('leg-reset-shape')).toBeVisible()
    const requests = mocks.osrm.requests.length
    const before = await app.history()

    // Road → ferry: the shaping points of the road go, as part of the one step.
    await modeRadio(page, 'Ferry').click()
    expect(await leg(app, 0)).toMatchObject({ mode: 'ferry', via: [] })
    expect(await app.history()).toEqual({ past: before.past + 1, future: 0 })
    await expect(page.getByTestId('leg-reset-shape')).toHaveCount(0)
    await expect(page.locator('.via-point:not(.via-point--ghost)')).toHaveCount(0)

    // Shape the ferry, then switch among hand-drawn kinds: the point stays.
    const bend = { lat: 46.2, lng: 5.3 }
    await page.evaluate(([legId, point]) => window.__ROADMAP__!.trip.getState().addVia(legId, 0, point), [id, bend] as const)
    await modeRadio(page, 'Train').click()
    await modeRadio(page, 'Flight').click()
    expect((await leg(app, 0)).via).toEqual([bend])
    // Hand-drawn → road: gone again.
    await modeRadio(page, 'Drive').click()
    expect(await leg(app, 0)).toMatchObject({ mode: 'drive', via: [] })

    // Undo brings the bend back with the flight, and the original road back with the first switch.
    await page.getByTestId('undo').click()
    expect(await leg(app, 0)).toMatchObject({ mode: 'flight', via: [bend] })
    for (let i = 0; i < 4; i++) await page.getByTestId('undo').click()
    expect(await leg(app, 0)).toMatchObject({ mode: 'drive', via })
    // All of that came from the route cache: the road with its via point was not asked for again.
    expect(mocks.osrm.requests).toHaveLength(requests)
  })

  test('"Follow roads" drops the via points as well, either way', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const id = await legId(app, 0)
    await page.evaluate((legId) => window.__ROADMAP__!.trip.getState().updateLeg(legId, { via: [{ lat: 45.95, lng: 5.5 }] }), id)
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await openEditor(page, 0)
    await page.getByTestId('leg-follow-roads').click()
    expect(await leg(app, 0)).toMatchObject({ straight: true, via: [] })
    await page.evaluate((legId) => window.__ROADMAP__!.trip.getState().addVia(legId, 0, { lat: 45.9, lng: 5.2 }), id)
    await page.getByTestId('leg-follow-roads').click()
    expect(await leg(app, 0)).toMatchObject({ via: [] })
    expect((await leg(app, 0)).straight).toBeUndefined()
  })

  test('"Show on map" fits the map to the leg', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await openEditor(page, 1)
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([40, -3], 5, { animate: false }))
    await editor(page).getByTestId('leg-show-on-map').click()
    await app.settle()
    const path = await app.legPath(1)
    const inside = await page.evaluate((pts) => pts.every((p) => window.__ROADMAP__!.getMap()!.getBounds().contains([p.lat, p.lng])), path)
    expect(inside).toBe(true)
    expect((await app.mapView()).zoom).toBeGreaterThanOrEqual(7)
    // Desktop: the sidebar is a column of its own, and the leg stays selected with its editor open.
    await expect(editor(page)).toBeVisible()
    expect((await app.ui()).selectedLegId).toBe(await legId(app, 1))
  })

  test('Escape in another field of the page belongs to that field: the open editor stays', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await openEditor(page, 0)
    const selected = (await app.ui()).selectedLegId

    // The day field of a place (focused by keyboard, a click would close the editor).
    const day = page.getByRole('textbox', { name: 'Day of travel for Annecy' })
    await day.focus()
    await day.fill('7')
    await day.press('Escape')
    await expect(day).toHaveValue('1')
    await expect(editor(page)).toBeVisible()

    // The name of a place being renamed.
    await page.evaluate(() => {
      const { places } = window.__ROADMAP__!.trip.getState().trip
      window.__ROADMAP__!.ui.getState().renamePlace(places[2].id)
    })
    const rename = page.getByTestId('place-rename-input')
    await expect(rename).toBeFocused()
    await rename.press('Escape')
    await expect(rename).toHaveCount(0)
    await expect(editor(page)).toBeVisible()

    // The trip title, and the box that adds a place.
    const title = page.getByRole('textbox', { name: 'Trip title' })
    await title.focus()
    await title.press('Escape')
    await expect(editor(page)).toBeVisible()
    const add = page.getByTestId('add-search').getByRole('combobox')
    await add.focus()
    await add.press('Escape')
    await expect(editor(page)).toBeVisible()
    expect((await app.ui()).selectedLegId).toBe(selected)

    // With the focus on the page itself (no field), Escape still closes it.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Escape')
    await expect(editor(page)).toHaveCount(0)
  })

  test('a flight is drawn as an arc, a train and a ferry as straight lines', async ({ page, app }) => {
    await openTrip(page, app, 'Lisbon', 'Berlin')
    const id = await legId(app, 0)
    await openEditor(page, 0)

    const sagitta = async () => {
      const [a, b] = [await app.screenPoint(at('Lisbon').lat, at('Lisbon').lng), await app.screenPoint(at('Berlin').lat, at('Berlin').lng)]
      const m = await center(badges(page, id))
      // Distance of the badge (the middle of the line) from the straight chord between the two places.
      return Math.abs((b.x - a.x) * (a.y - m.y) - (a.x - m.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y)
    }

    await modeRadio(page, 'Train').click()
    await expect(badges(page, id)).toHaveCount(1)
    expect(await sagitta()).toBeLessThan(3)
    const straightPoints = ((await legLine(page, id).getAttribute('d')) ?? '').split('L').length

    await modeRadio(page, 'Flight').click()
    await expect(badges(page, id)).toHaveAttribute('data-mode', 'flight')
    expect(await sagitta()).toBeGreaterThan(12)
    const arcPoints = ((await legLine(page, id).getAttribute('d')) ?? '').split('L').length
    expect(straightPoints).toBeLessThanOrEqual(3)
    // (Leaflet drops vertices within a pixel of the line, so far fewer than the 65 of the geometry remain.)
    expect(arcPoints).toBeGreaterThan(5)

    // The distance is measured along the arc and the duration is the flight estimate.
    const flight = computeManualRoute(at('Lisbon'), [], at('Berlin'), 'flight')
    await expect(summaryText(page, 0)).toHaveText(`${formatDistance(flight.distanceM)} · ${formatDuration(flight.durationS)}`)
  })

  test('the duration can be overridden in hours and minutes (one undo step) and reset to the estimate', async ({ page, app }) => {
    await openTrip(page, app, 'Portsmouth', 'Santander')
    await openEditor(page, 0)
    await modeRadio(page, 'Ferry').click()
    const estimate = computeManualRoute(at('Portsmouth'), [], at('Santander'), 'ferry')
    await expect(page.getByTestId('leg-duration-reset')).toHaveCount(0)

    // Hours, Tab, minutes, Enter: still one step, committed when focus leaves both boxes or on Enter.
    const before = await app.history()
    await hours(page).fill('30')
    await page.keyboard.press('Tab')
    await expect(minutes(page)).toBeFocused()
    expect((await leg(app, 0)).durationMin).toBeUndefined()
    await minutes(page).fill('15')
    await minutes(page).press('Enter')
    expect((await leg(app, 0)).durationMin).toBe(30 * 60 + 15)
    expect(await app.history()).toEqual({ past: before.past + 1, future: 0 })
    await expect(summaryText(page, 0)).toHaveText(`${formatDistance(estimate.distanceM)} · ${formatDuration((30 * 60 + 15) * 60)}`)
    await expect(page.getByTestId('leg-duration-hint')).toHaveText(`Estimate: ${formatDuration(estimate.durationS)}`)

    // More than 59 minutes is fine; it is shown normalised.
    await minutes(page).fill('90')
    await minutes(page).press('Enter')
    expect((await leg(app, 0)).durationMin).toBe(30 * 60 + 90)
    await expect(hours(page)).toHaveValue('31')
    await expect(minutes(page)).toHaveValue('30')

    // Nonsense reverts without touching the trip.
    const mark = await app.history()
    for (const [h, m] of [['x', '5'], ['0', '0'], ['', '']]) {
      await hours(page).fill(h)
      await minutes(page).fill(m)
      await minutes(page).press('Enter')
      await expect(hours(page)).toHaveValue('31')
    }
    expect(await app.history()).toEqual(mark)

    // Reset to the estimate is one step, and undo brings the override back.
    await page.getByTestId('leg-duration-reset').click()
    expect((await leg(app, 0)).durationMin).toBeUndefined()
    await expect(summaryText(page, 0)).toHaveText(`${formatDistance(estimate.distanceM)} · ${formatDuration(estimate.durationS)}`)
    await expect(page.getByTestId('leg-duration-reset')).toHaveCount(0)
    await page.getByTestId('undo').click()
    expect((await leg(app, 0)).durationMin).toBe(30 * 60 + 90)
  })

  test('a drive leg shows the routed time and can be overridden too', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openEditor(page, 0)
    const route = await app.legRoute(0)
    await expect(page.getByTestId('leg-duration-hint')).toHaveText('Driving time from the route')
    await expect(hours(page)).toHaveValue(String(Math.floor(Math.round(route.durationS / 60) / 60)))
    await hours(page).fill('5')
    await hours(page).press('Enter')
    expect((await leg(app, 0)).durationMin).toBe(5 * 60 + (Math.round(route.durationS / 60) % 60))
    // Leaving the box without a change is not an edit.
    const mark = await app.history()
    await hours(page).focus()
    await minutes(page).focus()
    await page.getByRole('heading', { name: 'Places' }).click()
    expect(await app.history()).toEqual(mark)
  })

  test('the label is saved on Enter or blur, shows in the sidebar and can be cleared (each one undo step)', async ({ page, app }) => {
    await openTrip(page, app, 'Portsmouth', 'Santander')
    await openEditor(page, 0)
    await expect(label(page)).toHaveAttribute('placeholder', 'e.g. Brittany Ferries · Portsmouth → Santander')
    const before = await app.history()
    await label(page).fill('Pont-Aven')
    await label(page).press('Enter')
    expect((await leg(app, 0)).label).toBe('Pont-Aven')
    await expect(connector(page, 0).getByTestId('leg-label')).toHaveText('Pont-Aven')
    expect(await app.history()).toEqual({ past: before.past + 1, future: 0 })

    await label(page).fill('  Pont-Aven II ')
    await page.getByRole('heading', { name: 'Places' }).click()
    expect((await leg(app, 0)).label).toBe('Pont-Aven II')

    await openEditor(page, 0)
    await label(page).fill('')
    await label(page).press('Enter')
    expect((await leg(app, 0)).label).toBeUndefined()
    await expect(connector(page, 0).getByTestId('leg-label')).toHaveCount(0)
    expect((await app.history()).past).toBe(before.past + 3)
  })

  test('"Follow roads" off draws a dotted straight line without asking OSRM; on again uses the cached road', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const id = await legId(app, 0)
    const roadSummary = await summaryText(page, 0).textContent()
    const requests = mocks.osrm.requests.length
    await openEditor(page, 0)
    const follow = page.getByTestId('leg-follow-roads')
    await expect(follow).toHaveAttribute('aria-checked', 'true')

    const before = await app.history()
    await follow.click()
    await expect(follow).toHaveAttribute('aria-checked', 'false')
    expect((await leg(app, 0)).straight).toBe(true)
    expect(await app.history()).toEqual({ past: before.past + 1, future: 0 })
    await expect(legLine(page, id)).toHaveAttribute('stroke-dasharray', STRAIGHT_DRIVE_DASH)
    const straight = computeManualRoute(at('Lyon'), [], at('Annecy'), 'drive')
    await expect(summaryText(page, 0)).toContainText(formatDistance(straight.distanceM))
    await expect(summaryText(page, 0)).toContainText('straight line')
    // A straight line has two points: the SVG path is a single segment.
    expect(((await legLine(page, id).getAttribute('d')) ?? '').split('L')).toHaveLength(2)
    expect(mocks.osrm.requests).toHaveLength(requests)

    await follow.click()
    await expect(follow).toHaveAttribute('aria-checked', 'true')
    expect((await leg(app, 0)).straight).toBeUndefined()
    await expect(summaryText(page, 0)).toHaveText(roadSummary!)
    expect(mocks.osrm.requests).toHaveLength(requests)

    // The switch is for drives only, and leaving 'drive' forgets it.
    await follow.click()
    await modeRadio(page, 'Train').click()
    await expect(follow).toHaveCount(0)
    expect((await leg(app, 0)).straight).toBeUndefined()
    await modeRadio(page, 'Drive').click()
    await expect(follow).toHaveAttribute('aria-checked', 'true')
  })
})

test.describe('reshaping a manual leg', () => {
  test('dragging a ferry line adds a via point at once, with no routing; Reset shape and undo take it back', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Portsmouth', 'Santander')
    const id = await legId(app, 0)
    await openEditor(page, 0)
    await modeRadio(page, 'Ferry').click()
    await expect(page.getByTestId('leg-reset-shape')).toHaveCount(0)
    const requests = mocks.osrm.requests.length
    const flat = computeManualRoute(at('Portsmouth'), [], at('Santander'), 'ferry')

    // Grab the line a third of the way along (away from the badge in the middle) and pull it sideways.
    const a = await app.screenPoint(at('Portsmouth').lat, at('Portsmouth').lng)
    const b = await app.screenPoint(at('Santander').lat, at('Santander').lng)
    const onLine = { x: a.x + (b.x - a.x) * 0.3, y: a.y + (b.y - a.y) * 0.3 }
    await page.mouse.move(onLine.x + 12, onLine.y + 12)
    await page.mouse.move(onLine.x, onLine.y, { steps: 3 })
    await expect(ghost(page)).toBeVisible()
    const before = await app.history()
    await page.mouse.down()
    await page.mouse.move(onLine.x + 150, onLine.y, { steps: 10 })
    await page.mouse.up()

    await expect.poll(async () => (await leg(app, 0)).via.length).toBe(1)
    expect(await app.history()).toEqual({ past: before.past + 1, future: 0 })
    // Instant: the leg stays 'ok', no request, and the longer way round shows in the summary.
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    expect(mocks.osrm.requests).toHaveLength(requests)
    const via = (await leg(app, 0)).via[0]
    const bent = computeManualRoute(at('Portsmouth'), [via], at('Santander'), 'ferry')
    expect(bent.distanceM).toBeGreaterThan(flat.distanceM)
    await expect(summaryText(page, 0)).toHaveText(`${formatDistance(bent.distanceM)} · ${formatDuration(bent.durationS)}`)
    await expect(legLine(page, id)).toHaveAttribute('stroke', MODES.ferry.color)
    expect(((await legLine(page, id).getAttribute('d')) ?? '').split('L')).toHaveLength(3)

    // Reset shape clears the via points (one step); undo puts the point back.
    await expect(page.getByTestId('leg-reset-shape')).toBeVisible()
    await page.getByTestId('leg-reset-shape').click()
    expect((await leg(app, 0)).via).toEqual([])
    await expect(page.getByTestId('leg-reset-shape')).toHaveCount(0)
    await expect(summaryText(page, 0)).toHaveText(`${formatDistance(flat.distanceM)} · ${formatDuration(flat.durationS)}`)
    await page.getByTestId('undo').click()
    expect((await leg(app, 0)).via).toHaveLength(1)
    expect(mocks.osrm.requests).toHaveLength(requests)
  })

  test('a flight keeps bending as an arc through a dragged point', async ({ page, app }) => {
    await openTrip(page, app, 'Lisbon', 'Berlin')
    const id = await legId(app, 0)
    await openEditor(page, 0)
    await modeRadio(page, 'Flight').click()
    await expect(badges(page, id)).toHaveCount(1)
    const line = legLine(page, id)

    // A point of the arc well away from the badge in its middle.
    const arc = decodePolyline(computeManualRoute(at('Lisbon'), [], at('Berlin'), 'flight').geometry)
    const grab = await app.screenPoint(arc[Math.round(arc.length * 0.7)].lat, arc[Math.round(arc.length * 0.7)].lng)
    await page.mouse.move(grab.x + 14, grab.y + 14)
    await page.mouse.move(grab.x, grab.y, { steps: 3 })
    await expect(ghost(page)).toBeVisible()
    await page.mouse.down()
    await page.mouse.move(grab.x, grab.y - 120, { steps: 10 })
    await page.mouse.up()

    await expect.poll(async () => (await leg(app, 0)).via.length).toBe(1)
    // Two arcs now, through the point that was dragged out; the summary measures along them.
    const bent = computeManualRoute(at('Lisbon'), (await leg(app, 0)).via, at('Berlin'), 'flight')
    await expect(summaryText(page, 0)).toHaveText(`${formatDistance(bent.distanceM)} · ${formatDuration(bent.durationS)}`)
    expect(((await line.getAttribute('d')) ?? '').split('L').length).toBeGreaterThan(4)
    expect(bent.distanceM).toBeGreaterThan(computeManualRoute(at('Lisbon'), [], at('Berlin'), 'flight').distanceM)
  })
})

test.describe('badges and legend', () => {
  test('clicking a badge selects its leg and opens the editor', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await openEditor(page, 1)
    await modeRadio(page, 'Train').click()
    await page.getByRole('heading', { name: 'Places' }).click()
    await expect(editor(page)).toHaveCount(0)

    const id = await legId(app, 1)
    await badges(page, id).click()
    expect((await app.ui()).selectedLegId).toBe(id)
    await expect(connector(page, 1).getByTestId('leg-editor')).toBeVisible()
    // Hovering it highlights the leg like the line does.
    await page.mouse.move(5, 500)
    await badges(page, id).hover()
    await expect(connector(page, 1)).toHaveAttribute('data-hovered', 'true')
  })

  test('the legend appears when the trip uses more than one mode, lists them, and follows undo', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await expect(legend(page)).toHaveCount(0)

    await openEditor(page, 1)
    await modeRadio(page, 'Train').click()
    await expect(legend(page)).toBeVisible()
    await expect(legend(page).locator('li')).toHaveText(['Drive', 'Train'])
    await modeRadio(page, 'Flight').click()
    await expect(legend(page).locator('li')).toHaveText(['Drive', 'Flight'])
    await openEditor(page, 0)
    await modeRadio(page, 'Ferry').click()
    await expect(legend(page).locator('li')).toHaveText(['Ferry', 'Flight'])

    // Bottom-left, above the scale.
    const legendBox = (await legend(page).boundingBox())!
    const scaleBox = (await page.locator('.leaflet-control-scale').boundingBox())!
    expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(scaleBox.y)
    expect(legendBox.x).toBeLessThan(scaleBox.x + 40)

    await page.getByTestId('undo').click()
    await page.getByTestId('undo').click()
    await page.getByTestId('undo').click()
    await expect(legend(page)).toHaveCount(0)
  })

  test('the legend is themed: readable in the dark theme too', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await openEditor(page, 0)
    await modeRadio(page, 'Ferry').click()
    await expect(legend(page)).toBeVisible()
    const light = await legend(page).evaluate((el) => getComputedStyle(el).backgroundColor)
    await page.getByRole('button', { name: /dark|theme/i }).first().click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const dark = await legend(page).evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(dark).not.toBe(light)
  })
})

test.describe('ferry crossings inside a drive route', () => {
  test('an OSRM route with a ferry step draws the ferry stretch in the ferry style, with a badge and a legend', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Dover', 'Calais')
    const id = await legId(app, 0)

    // The request asked for steps, and the cached route carries the spans.
    expect(new URL(mocks.osrm.requests[0].url).searchParams.get('steps')).toBe('true')
    const route = await app.legRoute(0)
    expect(route.spans?.map((s) => s.mode)).toEqual(['drive', 'ferry', 'drive'])
    expect(route.spans![1].durationS).toBe(FERRY_DURATION_S)
    expect(route.durationS).toBeGreaterThan(FERRY_DURATION_S)

    // The driven stretches are drive blue, the crossing is a dashed ferry line over its own casing.
    await expect(legLine(page, id)).toHaveAttribute('stroke', MODES.drive.color)
    await expect(legLine(page, id, 'route-ferry-line')).toHaveAttribute('stroke', MODES.ferry.color)
    await expect(legLine(page, id, 'route-ferry-line')).toHaveAttribute('stroke-dasharray', MODES.ferry.dashArray!)
    await expect(legLine(page, id, 'route-ferry-casing')).toHaveAttribute('stroke', MODES.ferry.casing!)
    await expect(badges(page, id)).toHaveCount(1)
    await expect(badges(page, id)).toHaveAttribute('data-mode', 'ferry')
    // The leg is still a drive leg: its summary says so, adds the crossing, and the time includes it.
    await expect(connector(page, 0)).toHaveAttribute('data-mode', 'drive')
    await expect(connector(page, 0).getByTestId('leg-ferry-tag')).toHaveText('incl. ferry')
    await expect(summaryText(page, 0)).toContainText(formatDuration(route.durationS))
    // Ferry spans count towards the legend although no leg is a ferry leg.
    await expect(legend(page)).toBeVisible()
    await expect(legend(page).locator('li')).toHaveText(['Drive', 'Ferry'])

    // The badge sits in the middle of the crossing, between the two ports.
    const badge = await center(badges(page, id))
    const [from, to] = await Promise.all([app.screenPoint(FERRY_PORTS.dover.lat, FERRY_PORTS.dover.lng), app.screenPoint(FERRY_PORTS.calais.lat, FERRY_PORTS.calais.lng)])
    expect(Math.abs(badge.x - (from.x + to.x) / 2)).toBeLessThan(12)
    expect(Math.abs(badge.y - (from.y + to.y) / 2)).toBeLessThan(12)

    // Hover and selection restyle both pieces.
    await openEditor(page, 0)
    await expect(page.getByTestId('leg-duration-hint')).toHaveText('Travel time from the route (incl. ferry)')
    await expect(legLine(page, id, 'route-ferry-line')).toHaveAttribute('stroke-width', String(MODES.ferry.weight + 4))
    await expect(legLine(page, id)).toHaveAttribute('stroke-width', String(MODES.drive.weight + 4))
  })

  test('the ferry stretch survives a reload without asking OSRM again, and a plain drive has none', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Dover', 'Calais')
    await expect(connector(page, 1)).toHaveAttribute('data-status', 'ok')
    const trip = await app.trip()
    await expect(legLine(page, trip.legs[0].id, 'route-ferry-line')).toHaveAttribute('d', EMPTY_PATH)
    await expect(badges(page, trip.legs[0].id)).toHaveCount(0)
    await expect(connector(page, 0).getByTestId('leg-ferry-tag')).toHaveCount(0)
    await expect.poll(async () => Object.keys((await app.savedFile())?.routes ?? {}).length).toBe(2)
    const requests = mocks.osrm.requests.length

    await page.reload()
    await app.ready()
    await expect(connector(page, 1)).toHaveAttribute('data-status', 'ok')
    await expect(badges(page, trip.legs[1].id)).toHaveCount(1)
    await expect(legLine(page, trip.legs[1].id, 'route-ferry-line')).toHaveAttribute('stroke', MODES.ferry.color)
    await page.waitForTimeout(1200)
    expect(mocks.osrm.requests).toHaveLength(requests)
  })

  test('switching a ferry-crossing drive leg to Ferry and back keeps the cached spans', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Dover', 'Calais')
    const id = await legId(app, 0)
    const requests = mocks.osrm.requests.length
    await openEditor(page, 0)
    await modeRadio(page, 'Ferry').click()
    // As a whole-leg ferry there are no pieces: one dashed line, and no separate crossing.
    await expect(legLine(page, id, 'route-ferry-line')).toHaveAttribute('d', EMPTY_PATH)
    await expect(legLine(page, id)).toHaveAttribute('stroke', MODES.ferry.color)
    await expect(badges(page, id)).toHaveCount(1)
    await modeRadio(page, 'Drive').click()
    await expect(legLine(page, id, 'route-ferry-line')).not.toHaveAttribute('d', EMPTY_PATH)
    await expect(legLine(page, id)).toHaveAttribute('stroke', MODES.drive.color)
    expect(mocks.osrm.requests).toHaveLength(requests)
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('selecting a leg keeps the slide-over open for its editor; "Show on map" closes it and shows the leg', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy', 'Zurich')
    await page.getByTestId('sidebar-toggle').click()
    await expect(connector(page, 1)).toHaveAttribute('data-status', 'ok')
    await summary(page, 1).click()
    await expect(editor(page)).toBeVisible()
    expect((await app.ui()).sidebarOpen).toBe(true)

    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([40, -3], 5, { animate: false }))
    await editor(page).getByTestId('leg-show-on-map').click()
    await expect.poll(async () => (await app.ui()).sidebarOpen).toBe(false)
    await app.settle()
    const path = await app.legPath(1)
    const inside = await page.evaluate((pts) => pts.every((p) => window.__ROADMAP__!.getMap()!.getBounds().contains([p.lat, p.lng])), path)
    expect(inside).toBe(true)
    // The leg is still selected: reopening the slide-over shows its editor.
    expect((await app.ui()).selectedLegId).toBe(await legId(app, 1))
    await page.getByTestId('sidebar-toggle').click()
    await expect(editor(page)).toBeVisible()
  })
})
