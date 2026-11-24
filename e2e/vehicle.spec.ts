import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
// Loads the typing of `window.__ROADMAP__.ride`.
import type {} from '../src/features/ride/rideStore'
import { createTrip, syncLegs } from '../src/lib/trip'
import { serializeTripFile } from '../src/lib/tripFile'
import type { TripFile } from '../src/types/trip'
import { expect, placeInput, test, type App } from './fixtures'

// lz-string is a CommonJS package: Node's ESM loader only exposes it through require.
const lz = createRequire(import.meta.url)('lz-string') as typeof import('lz-string')

/** Where the browser remembers the vehicle chosen last (a new trip starts with it). */
const PREFERENCE_KEY = 'roadmap-overview:vehicle'
const preference = (page: Page) => page.evaluate((key) => localStorage.getItem(key), PREFERENCE_KEY)

const rideButton = (page: Page) => page.getByTestId('ride-button')
const vehicleButton = (page: Page) => page.getByTestId('vehicle-button')
const panel = (page: Page) => page.getByTestId('vehicle-panel')
const option = (page: Page, kind: string) => page.locator(`[data-testid="vehicle-option"][data-kind="${kind}"]`)
const swatch = (page: Page, color: string) => page.locator(`[data-testid="vehicle-color"][data-color="${color}"]`)
const van = (page: Page) => page.getByTestId('ride-vehicle')
const connector = (page: Page, i: number) => page.getByTestId('leg-connector').nth(i)

async function openPicker(page: Page) {
  await vehicleButton(page).click()
  await expect(panel(page)).toBeVisible()
}

/** Open the picker and choose a vehicle by clicking its card; the panel stays open for the colour. */
async function choose(page: Page, kind: string) {
  if (!(await panel(page).isVisible())) await openPicker(page)
  await option(page, kind).click()
  await expect(option(page, kind)).toHaveAttribute('aria-checked', 'true')
}

async function openTrip(page: Page, app: App, ...names: string[]) {
  await app.goto()
  await app.addPlaces(...names)
  for (let i = 0; i + 1 < names.length; i++) await expect(connector(page, i)).toHaveAttribute('data-status', 'ok')
  await page.getByTestId('fit-trip').click()
  await app.settle()
}

/** Start the ride, hold it at `time` seconds (a deterministic moment). */
async function rideAt(page: Page, app: App, time = 0) {
  await rideButton(page).click()
  await expect(page.getByTestId('ride-hud')).toBeVisible()
  await app.settle()
  await page.evaluate((t) => {
    const ride = window.__ROADMAP__!.ride!
    ride.pause()
    ride.seek(t)
  }, time)
}

const tripVehicle = async (app: App) => (await app.trip()).vehicle

/** Save through the File menu and parse the downloaded file. */
async function savedFile(page: Page): Promise<TripFile> {
  const downloading = page.waitForEvent('download')
  await page.getByTestId('file-menu').click()
  await page.getByRole('menuitem', { name: 'Save as JSON' }).click()
  return JSON.parse(await readFile((await (await downloading).path())!, 'utf8')) as TripFile
}

test.describe('the vehicle picker', () => {
  test('sits beside the Ride button, and the campervan is what a trip starts with', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await expect(vehicleButton(page)).toBeVisible()
    await expect(vehicleButton(page)).toHaveAccessibleName('Choose vehicle (currently Campervan)')
    await expect(rideButton(page)).toHaveAccessibleName('Ride')
    // Joined to the Ride button, to its right.
    const [ride, chevron] = await Promise.all([rideButton(page).boundingBox(), vehicleButton(page).boundingBox()])
    expect(Math.abs(chevron!.x - (ride!.x + ride!.width))).toBeLessThan(2)
    expect(chevron!.height).toBeCloseTo(ride!.height, 0)
    await vehicleButton(page).hover()
    await expect(page.locator('.tooltip')).toHaveText('Vehicle: Campervan')
    await rideButton(page).hover()
    await expect(page.locator('.tooltip')).toHaveText('Ride the route day by day. Vehicle: Campervan')
    expect(await tripVehicle(app)).toBeUndefined()
    await rideAt(page, app)
    await expect(van(page)).toHaveAttribute('data-vehicle-kind', 'campervan')
  })

  test('opens a panel with every vehicle, and the Iveco Daily is named as the black van it is', async ({ page, app }) => {
    await app.goto()
    await openPicker(page)
    await expect(vehicleButton(page)).toHaveAttribute('aria-expanded', 'true')
    const kinds = await page.locator('[data-testid="vehicle-option"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))
    expect(kinds).toEqual(['campervan', 'iveco-daily', 'retro-bus', 'motorhome', 'caravan', 'offroad'])
    await expect(option(page, 'iveco-daily')).toContainText('Iveco Daily (black)')
    await expect(option(page, 'campervan')).toHaveAttribute('aria-checked', 'true')
    // Each card shows its picture.
    for (const kind of kinds) await expect(option(page, kind!).locator('svg')).toBeVisible()
    // The chosen vehicle holds focus when the panel opens.
    await expect(option(page, 'campervan')).toBeFocused()
  })

  test('choosing the Iveco Daily puts it in the trip and the ride shows it', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await choose(page, 'iveco-daily')
    expect(await tripVehicle(app)).toEqual({ kind: 'iveco-daily' })
    await expect(vehicleButton(page)).toHaveAttribute('data-vehicle-kind', 'iveco-daily')
    await expect(vehicleButton(page)).toHaveAccessibleName('Choose vehicle (currently Iveco Daily (black))')
    await page.keyboard.press('Escape')
    await rideButton(page).hover()
    await expect(page.locator('.tooltip').filter({ hasText: 'Ride the route' })).toHaveText('Ride the route day by day. Vehicle: Iveco Daily (black)')

    await rideAt(page, app, 0.6 + 1.2)
    await expect(panel(page)).toHaveCount(0)
    await expect(van(page)).toHaveAttribute('data-vehicle', 'drive')
    await expect(van(page)).toHaveAttribute('data-vehicle-kind', 'iveco-daily')
    await expect(van(page)).toHaveAttribute('data-vehicle-color', '#15181d')
    await expect(van(page).locator('svg.ride-art')).toBeVisible()
    await expect(van(page).locator('.ride-wheel')).toHaveCount(2)
    // The day tag still travels with it.
    await expect(page.getByTestId('ride-day-tag')).toBeVisible()
  })

  test('every vehicle can ride, each with its own picture', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const pictures = new Set<string>()
    for (const kind of ['campervan', 'iveco-daily', 'retro-bus', 'motorhome', 'caravan', 'offroad']) {
      await app.page.evaluate((k) => window.__ROADMAP__!.trip.getState().setVehicle(k as never), kind)
      await rideAt(page, app, 0.6 + 1.2)
      await expect(van(page)).toHaveAttribute('data-vehicle-kind', kind)
      pictures.add(await van(page).innerHTML())
      await page.getByTestId('ride-close').click()
      await expect(page.getByTestId('ride-hud')).toHaveCount(0)
    }
    expect(pictures.size).toBe(6)
  })

  test('is one undo step, and undo and redo bring the vehicles back', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const before = (await app.history()).past
    await choose(page, 'iveco-daily')
    expect((await app.history()).past).toBe(before + 1)
    await choose(page, 'offroad')
    expect((await app.history()).past).toBe(before + 2)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)

    await page.getByTestId('undo').click()
    expect(await tripVehicle(app)).toEqual({ kind: 'iveco-daily' })
    await rideAt(page, app)
    await expect(van(page)).toHaveAttribute('data-vehicle-kind', 'iveco-daily')
    await page.getByTestId('ride-close').click()

    await page.getByTestId('undo').click()
    expect(await tripVehicle(app)).toBeUndefined()
    await page.getByTestId('redo').click()
    expect(await tripVehicle(app)).toEqual({ kind: 'iveco-daily' })
  })

  test('choosing the vehicle that is already chosen records nothing', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openPicker(page)
    const before = (await app.history()).past
    await option(page, 'campervan').click()
    expect((await app.history()).past).toBe(before)
  })

  test('survives a reload', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await choose(page, 'iveco-daily')
    await page.waitForTimeout(700) // autosave
    expect((await app.savedFile())?.trip.vehicle).toEqual({ kind: 'iveco-daily' })
    await page.reload()
    await app.ready()
    expect(await tripVehicle(app)).toEqual({ kind: 'iveco-daily' })
    await expect(vehicleButton(page)).toHaveAttribute('data-vehicle-kind', 'iveco-daily')
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await rideAt(page, app)
    await expect(van(page)).toHaveAttribute('data-vehicle-kind', 'iveco-daily')
  })

  test('is in the saved JSON file', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    expect((await savedFile(page)).trip).not.toHaveProperty('vehicle')
    await choose(page, 'iveco-daily')
    await page.keyboard.press('Escape')
    expect((await savedFile(page)).trip.vehicle).toEqual({ kind: 'iveco-daily' })
  })

  test('travels in a share link, and the link opens with it', async ({ page, app, context, mocks }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openTrip(page, app, 'Lyon', 'Annecy')
    await choose(page, 'retro-bus')
    await swatch(page, '#d4382c').click()
    await page.keyboard.press('Escape')
    const trip = await app.trip()
    expect(trip.vehicle).toEqual({ kind: 'retro-bus', color: '#d4382c' })

    await page.getByTestId('file-menu').click()
    await page.getByRole('menuitem', { name: 'Copy share link' }).click()
    const link = await page.evaluate(() => navigator.clipboard.readText())
    const carried = lz.decompressFromEncodedURIComponent(new URL(link).hash.replace(/^#trip=/, ''))
    expect((JSON.parse(carried!) as TripFile).trip.vehicle).toEqual({ kind: 'retro-bus', color: '#d4382c' })

    // A fresh page: empty storage, then the link.
    await page.goto('about:blank')
    await page.addInitScript(() => {
      if (location.protocol === 'about:' || sessionStorage.getItem('e2e-fresh-storage')) return
      localStorage.clear()
      sessionStorage.setItem('e2e-fresh-storage', '1')
    })
    mocks.osrm.requests.length = 0
    await page.goto(link)
    await app.ready()
    expect(await tripVehicle(app)).toEqual({ kind: 'retro-bus', color: '#d4382c' })
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await rideAt(page, app)
    await expect(van(page)).toHaveAttribute('data-vehicle-kind', 'retro-bus')
    await expect(van(page)).toHaveAttribute('data-vehicle-color', '#d4382c')
  })

  test('a link with a damaged vehicle opens with the campervan and says what was repaired', async ({ page, app }) => {
    await app.goto()
    const file = {
      format: 'roadmap-overview/trip',
      version: 1,
      exportedAt: new Date().toISOString(),
      trip: { id: 'damaged', title: 'Damaged', places: [{ id: 'a', name: 'Lyon', lat: 45.76, lng: 4.83, day: 0 }], legs: [], vehicle: { kind: 'hovercraft', color: 12 } },
    }
    await page.evaluate((hash) => (location.hash = hash), '#trip=' + lz.compressToEncodedURIComponent(JSON.stringify(file)))
    await expect(page.getByTestId('toast').first()).toContainText('is not known; the campervan is used')
    expect((await app.trip()).title).toBe('Damaged')
    expect(await tripVehicle(app)).toBeUndefined()
  })

  test('New trip starts with the vehicle chosen last, and undo brings the old trip back', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await choose(page, 'retro-bus')
    await swatch(page, '#d4382c').click()
    await page.keyboard.press('Escape')
    expect(JSON.parse((await preference(page))!)).toEqual({ kind: 'retro-bus', color: '#d4382c' })
    // The trip that is open now has another vehicle (set without the picker): the new trip still gets the remembered one.
    await page.evaluate(() => window.__ROADMAP__!.trip.getState().setVehicle('offroad'))
    const mine = await app.trip()

    await page.getByTestId('file-menu').click()
    await page.getByRole('menuitem', { name: 'New trip' }).click()
    await page.getByRole('button', { name: 'New trip' }).click()
    await expect.poll(async () => (await app.trip()).places.length).toBe(0)
    expect(await tripVehicle(app)).toEqual({ kind: 'retro-bus', color: '#d4382c' })
    await expect(vehicleButton(page)).toHaveAccessibleName('Choose vehicle (currently Retro camper bus)')
    // Starting the new trip was one step: undo gives the old trip back, with its own vehicle.
    await page.getByTestId('undo').click()
    expect(await app.trip()).toEqual(mine)
    expect(await tripVehicle(app)).toEqual({ kind: 'offroad' })
  })

  test('the Daily chosen once is the Daily of the next new trip, also after a reload', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await choose(page, 'iveco-daily')
    await page.keyboard.press('Escape')
    await page.getByTestId('file-menu').click()
    await page.getByRole('menuitem', { name: 'New trip' }).click()
    await page.getByRole('button', { name: 'New trip' }).click()
    await expect.poll(async () => (await app.trip()).places.length).toBe(0)
    expect(await tripVehicle(app)).toEqual({ kind: 'iveco-daily' })

    await page.reload()
    await app.ready()
    expect(await tripVehicle(app)).toEqual({ kind: 'iveco-daily' })
    await app.addPlaces('Lyon', 'Annecy')
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    await rideAt(page, app)
    await expect(van(page)).toHaveAttribute('data-vehicle-kind', 'iveco-daily')
  })

  test('only a choice in the picker changes what is remembered: not undo, not opening a trip', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await choose(page, 'iveco-daily')
    await page.keyboard.press('Escape')
    await page.getByTestId('undo').click()
    expect(await tripVehicle(app)).toBeUndefined()
    expect(JSON.parse((await preference(page))!)).toEqual({ kind: 'iveco-daily' })

    // Choosing the default campervan again forgets it.
    await choose(page, 'campervan')
    await page.keyboard.press('Escape')
    expect(await preference(page)).toBeNull()
    await page.getByTestId('file-menu').click()
    await page.getByRole('menuitem', { name: 'New trip' }).click()
    await page.getByRole('button', { name: 'New trip' }).click()
    await expect.poll(async () => (await app.trip()).places.length).toBe(0)
    expect(await tripVehicle(app)).toBeUndefined()
  })

  test('a first visit starts with it too, but a saved trip, a file or a link keeps its own vehicle', async ({ page, app }) => {
    const prefer = () => page.addInitScript((key) => localStorage.setItem(key, '{"kind":"iveco-daily"}'), PREFERENCE_KEY)
    await prefer()
    await app.goto()
    expect(await tripVehicle(app)).toEqual({ kind: 'iveco-daily' })
    // Setting the first trip up is not something to undo.
    expect((await app.history()).past).toBe(0)

    // A trip that was saved without a vehicle is restored as it was.
    const lyon = { id: 'p0', ...placeInput('Lyon'), day: 0 }
    const saved = createTrip({ id: 'saved', title: 'Saved', places: [lyon], legs: syncLegs([lyon], []) })
    await page.evaluate(
      ([key, text]) => localStorage.setItem(key, text),
      ['roadmap-overview:v1:current', JSON.stringify(serializeTripFile(saved))] as const,
    )
    await page.reload()
    await app.ready()
    expect((await app.trip()).title).toBe('Saved')
    expect(await tripVehicle(app)).toBeUndefined()

    // So is a link's trip.
    const file = { ...serializeTripFile(createTrip({ id: 'linked', title: 'Linked', places: [lyon], legs: [] })), routes: undefined }
    await page.evaluate((hash) => (location.hash = hash), '#trip=' + lz.compressToEncodedURIComponent(JSON.stringify(file)))
    await expect.poll(async () => (await app.trip()).title).toBe('Linked')
    expect(await tripVehicle(app)).toBeUndefined()
  })

  test('the sample trip gets the remembered vehicle when it has none of its own', async ({ page, app }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '{"kind":"offroad","color":"#d4382c"}'), PREFERENCE_KEY)
    await app.goto()
    await page.getByTestId('file-menu').click()
    await page.getByRole('menuitem', { name: 'Load sample trip' }).click()
    await expect.poll(async () => (await app.trip()).places.length).toBe(12)
    expect(await tripVehicle(app)).toEqual({ kind: 'offroad', color: '#d4382c' })
  })
})

test.describe('body colour', () => {
  test('a colour swatch recolours the vehicle, in the trip and on the ride, as one undo step', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await choose(page, 'motorhome')
    // The vehicle's own colour is the checked swatch.
    await expect(swatch(page, '#ffffff')).toHaveAttribute('aria-checked', 'true')
    const before = (await app.history()).past
    await swatch(page, '#ee7a2f').click()
    await expect(swatch(page, '#ee7a2f')).toHaveAttribute('aria-checked', 'true')
    expect(await tripVehicle(app)).toEqual({ kind: 'motorhome', color: '#ee7a2f' })
    expect((await app.history()).past).toBe(before + 1)
    // The picture in the card follows.
    expect(await option(page, 'motorhome').locator('svg').innerHTML()).toContain('#ee7a2f')
    expect(await option(page, 'caravan').locator('svg').innerHTML()).not.toContain('#ee7a2f')

    await page.keyboard.press('Escape')
    await rideAt(page, app)
    await expect(van(page)).toHaveAttribute('data-vehicle-color', '#ee7a2f')
    expect(await van(page).innerHTML()).toContain('#ee7a2f')
    await page.getByTestId('ride-close').click()

    await page.getByTestId('undo').click()
    expect(await tripVehicle(app)).toEqual({ kind: 'motorhome' })
  })

  test('choosing the vehicle\'s own colour again leaves no colour in the trip', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await choose(page, 'retro-bus')
    await swatch(page, '#d4382c').click()
    expect(await tripVehicle(app)).toEqual({ kind: 'retro-bus', color: '#d4382c' })
    await swatch(page, '#2a9d9d').click()
    expect(await tripVehicle(app)).toEqual({ kind: 'retro-bus' })
  })

  test('another vehicle starts in its own colour', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await choose(page, 'caravan')
    await swatch(page, '#d4382c').click()
    await choose(page, 'offroad')
    expect(await tripVehicle(app)).toEqual({ kind: 'offroad' })
    await expect(swatch(page, '#3f9560')).toHaveAttribute('aria-checked', 'true')
  })

  test('a custom colour is one undo step however the browser reports it, and shows as the chosen swatch', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await choose(page, 'campervan')
    const before = (await app.history()).past
    const custom = page.getByTestId('vehicle-color-custom')
    await custom.fill('#123456')
    await expect.poll(() => tripVehicle(app)).toEqual({ kind: 'campervan', color: '#123456' })
    expect((await app.history()).past).toBe(before + 1)
    await expect(page.locator('.vehicle-swatch--custom')).toHaveAttribute('data-checked', 'true')
    for (const c of ['#ffffff', '#15181d', '#d4382c']) await expect(swatch(page, c)).toHaveAttribute('aria-checked', 'false')
    await expect(custom).toHaveValue('#123456')
  })

  test('the Daily has no colours to choose: it says so', async ({ page, app }) => {
    await app.goto()
    await choose(page, 'iveco-daily')
    await expect(page.getByTestId('vehicle-color')).toHaveCount(0)
    await expect(page.getByTestId('vehicle-color-custom')).toHaveCount(0)
    await expect(page.getByTestId('vehicle-colors-note')).toContainText('fixed colour')
  })
})

test.describe('using the picker', () => {
  test('arrow keys move, Enter chooses, Escape closes and gives the focus back', async ({ page, app }) => {
    await app.goto()
    await vehicleButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(panel(page)).toBeVisible()
    await expect(option(page, 'campervan')).toBeFocused()
    // Moving does not choose.
    await page.keyboard.press('ArrowRight')
    await expect(option(page, 'iveco-daily')).toBeFocused()
    expect(await tripVehicle(app)).toBeUndefined()
    await page.keyboard.press('ArrowDown')
    await expect(option(page, 'motorhome')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(option(page, 'retro-bus')).toBeFocused()
    await page.keyboard.press('Enter')
    expect(await tripVehicle(app)).toEqual({ kind: 'retro-bus' })
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(vehicleButton(page)).toBeFocused()
  })

  test('Tab walks from the vehicles to the colours and out of the panel, which closes', async ({ page, app }) => {
    await app.goto()
    await openPicker(page)
    await page.keyboard.press('Tab')
    await expect(page.locator('[data-testid="vehicle-color"][aria-checked="true"]')).toBeFocused()
    await expect(panel(page)).toBeVisible()
    // The custom colour is the last stop.
    await page.getByTestId('vehicle-color-custom').focus()
    await page.keyboard.press('Tab')
    await expect(panel(page)).toHaveCount(0)
  })

  test('a click outside closes it, the button toggles it', async ({ page, app }) => {
    await app.goto()
    await openPicker(page)
    await page.mouse.click(700, 600)
    await expect(panel(page)).toHaveCount(0)
    await openPicker(page)
    await vehicleButton(page).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(vehicleButton(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('the panel stays inside the window, in both themes', async ({ page, app }) => {
    await app.goto()
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByTestId('theme-toggle').click()
      await openPicker(page)
      const box = (await panel(page).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(1440)
      expect(box.y + box.height).toBeLessThanOrEqual(900)
      // All ten colour choices fit on one row.
      const swatches = await page.locator('.vehicle-swatch').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
      expect(new Set(swatches).size).toBe(1)
      await page.keyboard.press('Escape')
    }
  })

  test('fits a phone: the top bar does not overflow and the panel stays on screen', async ({ page, app }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    await app.goto()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const bar = await page.locator('.topbar').evaluate((el) => [...el.querySelectorAll('button, input')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => r.right))
    expect(Math.max(...bar)).toBeLessThanOrEqual(390)
    await openPicker(page)
    const box = (await panel(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await choose(page, 'offroad')
    expect(await tripVehicle(app)).toEqual({ kind: 'offroad' })
  })
})

test.describe('locking', () => {
  test('is disabled during a ride, with the reason, and comes back after', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await choose(page, 'iveco-daily')
    await page.keyboard.press('Escape')
    await rideAt(page, app)
    await expect(vehicleButton(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(vehicleButton(page)).toHaveAccessibleDescription(/Close the ride/)
    await vehicleButton(page).hover()
    await expect(page.locator('.tooltip')).toHaveText(/Close the ride \(Esc\) to change the vehicle/)
    await vehicleButton(page).click({ force: true })
    await expect(panel(page)).toHaveCount(0)
    expect(await tripVehicle(app)).toEqual({ kind: 'iveco-daily' })

    await page.getByTestId('ride-close').click()
    await expect(vehicleButton(page)).not.toHaveAttribute('aria-disabled', 'true')
    await openPicker(page)
  })

  test('is disabled in presentation mode, with the reason', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await page.getByTestId('present-toggle').click()
    await expect(vehicleButton(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(vehicleButton(page)).toHaveAccessibleDescription(/Leave presentation mode/)
    await vehicleButton(page).hover()
    await expect(page.locator('.tooltip')).toHaveText(/Leave presentation mode \(Esc\) to change the vehicle/)
    await vehicleButton(page).click({ force: true })
    await expect(panel(page)).toHaveCount(0)
    // The ride itself is still there to watch.
    await expect(rideButton(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(vehicleButton(page)).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('closes when a ride starts or presentation mode begins while it is open', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openPicker(page)
    await rideButton(page).click()
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    await expect(panel(page)).toHaveCount(0)
    await page.getByTestId('ride-close').click()

    await openPicker(page)
    await page.keyboard.press('p')
    await expect(page.locator('.app')).toHaveAttribute('data-presenting', 'true')
    await expect(panel(page)).toHaveCount(0)
  })

  test('a vehicle that arrives while a ride runs (a replaced trip) shows at once', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await rideAt(page, app, 0.6 + 1.2)
    await expect(van(page)).toHaveAttribute('data-vehicle-kind', 'campervan')
    await page.evaluate(() => {
      const store = window.__ROADMAP__!.trip
      store.setState({ trip: { ...store.getState().trip, vehicle: { kind: 'offroad' } } })
    })
    await expect(van(page)).toHaveAttribute('data-vehicle-kind', 'offroad')
  })
})

test.describe('on the road and off it', () => {
  test('ferries keep the ferry whatever the vehicle, and the van is back on the road', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await choose(page, 'iveco-daily')
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      const s = window.__ROADMAP__!.trip.getState()
      s.updateLeg(s.trip.legs[0].id, { mode: 'ferry' })
    })
    await rideAt(page, app, 0.6 + 1.2)
    await expect(van(page)).toHaveAttribute('data-vehicle', 'ferry')
    await expect(van(page)).toHaveAttribute('data-vehicle-kind', 'ferry')
    await page.evaluate(() => window.__ROADMAP__!.ride!.seek(0.6 + 2.5 + 1.2))
    await expect(van(page)).toHaveAttribute('data-vehicle', 'drive')
    await expect(van(page)).toHaveAttribute('data-vehicle-kind', 'iveco-daily')
  })

  test('faces west going west, mirrored and never rotated, with the chosen vehicle', async ({ page, app }) => {
    await openTrip(page, app, 'Zurich', 'Annecy')
    await choose(page, 'iveco-daily')
    await page.keyboard.press('Escape')
    await rideAt(page, app, 0.6 + 1.2)
    await expect(van(page)).toHaveAttribute('data-vehicle-kind', 'iveco-daily')
    await expect(van(page)).toHaveAttribute('data-facing', 'west')
    await expect.poll(() => van(page).evaluate((el) => getComputedStyle(el).transform)).toMatch(/^matrix\(-1, 0, 0, 1,/)
  })

  test('draws at the size the ride always used, whichever vehicle', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    for (const kind of ['campervan', 'offroad', 'caravan']) {
      await page.evaluate((k) => window.__ROADMAP__!.trip.getState().setVehicle(k as never), kind)
      await rideAt(page, app, 0.6 + 1.2)
      const box = (await van(page).boundingBox())!
      expect(box.width).toBeCloseTo(56, 0)
      expect(box.height).toBeCloseTo(35, 0)
      await page.getByTestId('ride-close').click()
    }
  })
})
