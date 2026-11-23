import type { Locator, Page } from '@playwright/test'
import { expect, findPlace, test, type App } from './fixtures'

/** Page coordinates (client pixels) of a map position at the current view. */
async function screenPoint(page: Page, lat: number, lng: number) {
  return page.evaluate(
    ([la, ln]) => {
      const map = window.__ROADMAP__!.getMap()!
      const p = map.latLngToContainerPoint([la, ln])
      const box = map.getContainer().getBoundingClientRect()
      return { x: box.left + p.x, y: box.top + p.y }
    },
    [lat, lng],
  )
}

const marker = (page: Page, n: number) => page.locator('.place-marker').filter({ hasText: new RegExp(`^${n}$`) })
const label = (page: Page, text: string) => page.locator('.place-label', { hasText: text })
const rows = (page: Page) => page.getByTestId('place-item')
const rowOf = (page: Page, name: string) => rows(page).filter({ has: page.getByTestId('place-name').getByText(name, { exact: true }) })
const names = async (app: App) => (await app.trip()).places.map((p) => p.name)

/** Type a query into a search box and press Enter. */
async function search(box: Locator, query: string) {
  await box.fill(query)
  await box.press('Enter')
}

/** Drag with the real mouse in small steps (dnd-kit and Leaflet both want movement, not a teleport). */
async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x, from.y + Math.sign(to.y - from.y) * 8, { steps: 2 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

const center = async (loc: Locator) => {
  const box = (await loc.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test.describe('empty state and adding places by search', () => {
  test('an empty trip shows a hint; places added by search appear in the list and on the map', async ({ page, app, mocks }) => {
    await app.goto()
    await expect(page.getByTestId('places-empty')).toContainText('right-click the map')
    await expect(page.getByTestId('places-count')).toHaveText('0')

    const add = page.getByRole('combobox', { name: 'Add a place' })
    for (const name of ['Lyon', 'Annecy', 'Zurich']) {
      await search(add, name)
      await page.getByRole('option', { name: new RegExp(`^${name}`) }).first().click()
      await expect(add).toHaveValue('')
    }

    await expect(page.getByTestId('places-empty')).toBeHidden()
    await expect(page.getByTestId('places-count')).toHaveText('3')
    await expect(rows(page)).toHaveCount(3)
    await expect(page.getByTestId('place-name')).toHaveText(['Lyon', 'Annecy', 'Zurich'])
    await expect(page.getByTestId('leg-connector')).toHaveCount(2)

    const trip = await app.trip()
    expect(trip.places.map((p) => p.day)).toEqual([0, 1, 2])
    expect(trip.places[0]).toMatchObject({ name: 'Lyon', address: expect.stringContaining('France') })
    expect(trip.places[0].customName).toBeUndefined()
    expect(trip.legs).toHaveLength(2)

    // Numbered markers with a permanent label each.
    for (const [i, name] of ['Lyon', 'Annecy', 'Zurich'].entries()) {
      await expect(marker(page, i + 1)).toBeVisible()
      await expect(label(page, name)).toBeVisible()
    }

    // Searches only ever ran on submit (3), at least ~1 s apart, as the usage policy asks.
    expect(mocks.nominatim.requests).toHaveLength(3)
    const gaps = mocks.nominatim.requests.slice(1).map((r, i) => r.at - mocks.nominatim.requests[i].at)
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(900)
    expect(mocks.blocked).toEqual([])
  })

  test('typing alone never searches; results are keyboard navigable and the empty and error states show', async ({ page, app, mocks }) => {
    await app.goto()
    const add = page.getByRole('combobox', { name: 'Add a place' })

    await add.pressSequentially('Par', { delay: 30 })
    await page.waitForTimeout(1300)
    expect(mocks.nominatim.requests).toHaveLength(0)

    await add.pressSequentially('is')
    await add.press('Enter')
    const options = page.getByRole('option')
    await expect(options).toHaveCount(2)
    await expect(options.first()).toContainText('Paris')
    await expect(options.first()).toContainText('France')
    await expect(options.nth(1)).toContainText('United States')

    // ArrowDown twice + ArrowUp lands on the first; Enter picks it.
    await add.press('ArrowDown')
    await add.press('ArrowDown')
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
    await add.press('ArrowUp')
    await expect(options.first()).toHaveAttribute('aria-selected', 'true')
    await add.press('ArrowDown')
    await add.press('Enter')
    await expect.poll(() => names(app)).toEqual(['Paris'])
    expect((await app.trip()).places[0].lat).toBeCloseTo(33.66, 1)

    await search(add, 'Atlantis')
    await expect(page.getByText('No places found for “Atlantis”')).toBeVisible()

    mocks.nominatim.failWith = 'http-500'
    await search(add, 'Lyon')
    await expect(page.getByText('Search failed')).toBeVisible()
    mocks.nominatim.failWith = null
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('option').first()).toContainText('Lyon')

    // Escape closes the results.
    await add.press('Escape')
    await expect(page.getByRole('option')).toHaveCount(0)
  })

  test('the first place of a trip is flown to; picking from search selects it', async ({ page, app }) => {
    await app.goto()
    const add = page.getByRole('combobox', { name: 'Add a place' })
    await search(add, 'Zurich')
    await page.getByRole('option', { name: /^Zurich/ }).click()
    const zurich = findPlace('Zurich')
    await expect.poll(async () => Math.abs((await app.mapView()).lat - zurich.lat)).toBeLessThan(0.05)
    await expect.poll(async () => (await app.mapView()).zoom).toBeGreaterThanOrEqual(10)
    const [place] = (await app.trip()).places
    expect((await app.ui()).selectedPlaceId).toBe(place.id)
    await expect(marker(page, 1)).toHaveClass(/is-selected/)
  })

  test('editing the query after a search makes Enter search again, not pick a hovered stale result', async ({ page, app, mocks }) => {
    await app.goto()
    const add = page.getByRole('combobox', { name: 'Add a place' })
    await search(add, 'Paris')
    const options = page.getByRole('option')
    await expect(options).toHaveCount(2)
    await options.nth(1).hover()
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')

    await add.fill('Lyon')
    await expect(options).toHaveCount(0)
    await add.press('Enter')
    await expect(options.first()).toContainText('Lyon')
    expect((await app.trip()).places).toHaveLength(0)

    const queries = mocks.nominatim.requests.map((r) => new URL(r.url).searchParams.get('q'))
    expect(queries).toEqual(['Paris', 'Lyon'])
  })

  test('searches are biased towards the visible map area (viewbox, never bounded)', async ({ page, app, mocks }) => {
    await app.goto()
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([50, 10], 5, { animate: false }))
    const add = page.getByRole('combobox', { name: 'Add a place' })
    await search(add, 'Dover')
    await expect(page.getByRole('option').first()).toBeVisible()
    const params = new URL(mocks.nominatim.requests[0].url).searchParams
    const [west, north, east, south] = params.get('viewbox')!.split(',').map(Number)
    expect(west).toBeLessThan(10)
    expect(east).toBeGreaterThan(10)
    expect(south).toBeLessThan(50)
    expect(north).toBeGreaterThan(50)
    expect(params.has('bounded')).toBe(false)
  })

  test('a place added far from the current view is brought into view', async ({ page, app }) => {
    await app.goto()
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([60, 10], 6, { animate: false }))
    const add = page.getByRole('combobox', { name: 'Add a place' })
    await search(add, 'Lisbon')
    await page.getByRole('option', { name: /^Lisbon/ }).click()
    const lisbon = findPlace('Lisbon')
    await expect
      .poll(() =>
        page.evaluate(
          ([la, ln]) => window.__ROADMAP__!.getMap()!.getBounds().contains([la, ln]),
          [lisbon.lat, lisbon.lng],
        ),
      )
      .toBe(true)
  })
})

test.describe('sorting', () => {
  test('dragging a row by its handle reorders the places as one undo step', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy', 'Zurich')
    await expect(rows(page)).toHaveCount(3)
    const before = await app.history()

    const grip = rowOf(page, 'Lyon').getByTestId('place-grip')
    const target = await center(rowOf(page, 'Zurich'))
    await dragBetween(page, await center(grip), { x: target.x, y: target.y + 10 })

    await expect.poll(() => names(app)).toEqual(['Annecy', 'Zurich', 'Lyon'])
    await expect(page.getByTestId('place-name')).toHaveText(['Annecy', 'Zurich', 'Lyon'])
    // Markers follow the new numbering.
    await expect(marker(page, 3)).toBeVisible()
    const after = await app.history()
    expect(after.past).toBe(before.past + 1)
    const trip = await app.trip()
    expect(trip.legs.map((l) => [l.fromId, l.toId])).toEqual([
      [trip.places[0].id, trip.places[1].id],
      [trip.places[1].id, trip.places[2].id],
    ])

    // Undo and redo go through the top bar as well as the keyboard.
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => names(app)).toEqual(['Lyon', 'Annecy', 'Zurich'])
    await expect(page.getByTestId('place-name')).toHaveText(['Lyon', 'Annecy', 'Zurich'])
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect.poll(() => names(app)).toEqual(['Annecy', 'Zurich', 'Lyon'])
  })

  test('a plain click on the handle does not reorder, and the connectors hide while dragging', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy', 'Zurich')
    await expect(rows(page)).toHaveCount(3)
    const before = await app.history()
    await rowOf(page, 'Lyon').getByTestId('place-grip').click()
    expect(await app.history()).toEqual(before)
    expect(await names(app)).toEqual(['Lyon', 'Annecy', 'Zurich'])

    const grip = await center(rowOf(page, 'Annecy').getByTestId('place-grip'))
    await page.mouse.move(grip.x, grip.y)
    await page.mouse.down()
    await page.mouse.move(grip.x, grip.y + 30, { steps: 5 })
    await expect(page.getByTestId('place-list')).toHaveAttribute('data-dragging', 'true')
    await expect(page.getByTestId('leg-connector').first()).toHaveCSS('opacity', '0')
    await page.mouse.up()
    await expect(page.getByTestId('place-list')).not.toHaveAttribute('data-dragging')
    await expect(page.getByTestId('leg-connector').first()).toHaveCSS('opacity', '1')
  })

  test('rows can be reordered with the keyboard', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy', 'Zurich')
    const grip = rowOf(page, 'Annecy').getByTestId('place-grip')
    // dnd-kit narrates every step in a live region (see `announcements` in PlacesPanel). Waiting for
    // the sentence is waiting for dnd-kit's own state: the next key is only sent once the previous
    // one has been processed, whatever the machine's speed (a drop that races the move would find
    // the row still "over" itself and change nothing).
    const status = page.locator('[id^="DndLiveRegion"]')
    await grip.focus()
    await page.keyboard.press('Space')
    // (The pick-up sentence is replaced at once by this one: dnd-kit reports the row as over itself.)
    await expect(status).toHaveText('Annecy is over position 2 of 3.')
    await expect(page.getByTestId('place-list')).toHaveAttribute('data-dragging', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(status).toHaveText('Annecy is over position 3 of 3.')
    await page.keyboard.press('Space')
    await expect(status).toHaveText('Annecy dropped at position 3 of 3.')
    await expect.poll(() => names(app)).toEqual(['Lyon', 'Zurich', 'Annecy'])
  })
})

test.describe('day field', () => {
  test('commits on blur or Enter as one undo step; invalid input reverts; arrows step', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy', 'Zurich')
    const day = (name: string) => rowOf(page, name).getByRole('textbox', { name: /^Day of travel/ })
    await expect(day('Zurich')).toHaveValue('2')
    await expect(rowOf(page, 'Annecy').getByTestId('day-field')).toContainText('Day')

    const before = await app.history()
    await day('Annecy').fill('7')
    await day('Annecy').press('Enter')
    await expect.poll(async () => (await app.trip()).places[1].day).toBe(7)
    expect((await app.history()).past).toBe(before.past + 1)

    // Blur commits too, and there is no upper bound.
    await day('Zurich').fill('1000')
    await page.getByTestId('places-panel').getByRole('heading', { name: 'Places' }).click()
    await expect.poll(async () => (await app.trip()).places[2].day).toBe(1000)

    // Invalid input reverts without touching the trip.
    const mark = await app.history()
    for (const bad of ['abc', '-3', '2.5', '']) {
      await day('Lyon').fill(bad)
      await day('Lyon').press('Enter')
      await expect(day('Lyon')).toHaveValue('0')
    }
    expect(await app.history()).toEqual(mark)

    // Arrow keys step the field; Enter commits; going below 0 is not possible; Escape reverts.
    await day('Lyon').focus()
    await day('Lyon').press('ArrowUp')
    await day('Lyon').press('ArrowUp')
    await expect(day('Lyon')).toHaveValue('2')
    await day('Lyon').press('Enter')
    await expect.poll(async () => (await app.trip()).places[0].day).toBe(2)
    await day('Lyon').focus()
    await day('Lyon').press('ArrowDown')
    await day('Lyon').press('ArrowDown')
    await day('Lyon').press('ArrowDown')
    await expect(day('Lyon')).toHaveValue('0')
    await day('Lyon').press('Escape')
    await expect(day('Lyon')).toHaveValue('2')
    expect((await app.trip()).places[0].day).toBe(2)
  })

  test('a day changed underneath a focused field shows the new value', async ({ page, app }) => {
    await app.goto()
    const [, annecyId] = await app.addPlaces('Lyon', 'Annecy')
    const input = rowOf(page, 'Annecy').getByRole('textbox', { name: /^Day of travel/ })
    await input.focus()
    await expect(input).toHaveValue('1')
    // Untouched field: an outside change (undo, another edit) shows at once.
    await page.evaluate((id) => window.__ROADMAP__!.trip.getState().updatePlace(id, { day: 3 }), annecyId)
    await expect(input).toHaveValue('3')
    // A typed draft that the saved value moves away from is dropped, not committed over it.
    await input.fill('9')
    await page.evaluate((id) => window.__ROADMAP__!.trip.getState().updatePlace(id, { day: 4 }), annecyId)
    await expect(input).toHaveValue('4')
    await input.blur()
    expect((await app.trip()).places[1].day).toBe(4)
  })

  test('a day earlier than the previous stop is flagged with an explanation', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy', 'Zurich')
    const field = (name: string) => rowOf(page, name).getByTestId('day-field')
    for (const name of ['Lyon', 'Annecy', 'Zurich']) await expect(field(name)).not.toHaveAttribute('data-warning')

    const input = rowOf(page, 'Zurich').getByRole('textbox', { name: /^Day of travel/ })
    await input.fill('0')
    await input.press('Enter')
    await expect(field('Zurich')).toHaveAttribute('data-warning', 'true')
    await expect(field('Annecy')).not.toHaveAttribute('data-warning')
    await expect(field('Zurich')).toContainText('earlier than the previous stop (day 1)')

    await field('Zurich').hover()
    await expect(page.locator('.tooltip')).toContainText('counts as day 1')

    // Fixing the day (or undoing) clears the flag.
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(field('Zurich')).not.toHaveAttribute('data-warning')
  })
})

test.describe('classic map search on a row', () => {
  test('clicking a row expands it with the name selected; picking a result replaces the place', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    // Pretend Annecy was named by hand: picking a result makes it machine-named again.
    const [, annecyId] = (await app.trip()).places.map((p) => p.id)
    await page.evaluate((id) => window.__ROADMAP__!.trip.getState().updatePlace(id, { customName: true, name: 'Camp' }), annecyId)

    await rowOf(page, 'Camp').getByTestId('place-main').click()
    const input = page.getByRole('combobox', { name: /Search a new location for Camp/ })
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('Camp')
    expect(await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 4])
    await expect(page.getByTestId('place-address')).toContainText('Annecy, Haute-Savoie')
    expect((await app.ui()).expandedPlaceId).toBe(annecyId)

    // Only one row is expanded at a time.
    await rowOf(page, 'Lyon').getByTestId('place-main').click()
    await expect(page.getByTestId('place-panel')).toHaveCount(1)
    expect((await app.ui()).expandedPlaceId).not.toBe(annecyId)
    await rowOf(page, 'Camp').getByTestId('place-main').click()

    const before = await app.history()
    await search(input, 'Paris')
    await expect(page.getByRole('option')).toHaveCount(2)
    await page.getByRole('option').first().click()

    const paris = findPlace('Paris')
    const place = (await app.trip()).places[1]
    expect(place).toMatchObject({ id: annecyId, name: 'Paris', lat: paris.lat, lng: paris.lng, day: 1 })
    expect(place.address).toContain('Île-de-France')
    expect(place.customName).toBeUndefined()
    expect((await app.history()).past).toBe(before.past + 1)

    // The panel closes, the place is selected and the map flies there.
    await expect(page.getByTestId('place-panel')).toHaveCount(0)
    expect((await app.ui()).expandedPlaceId).toBeNull()
    expect((await app.ui()).selectedPlaceId).toBe(annecyId)
    await expect.poll(async () => Math.abs((await app.mapView()).lat - paris.lat)).toBeLessThan(0.2)
    await expect.poll(async () => (await app.mapView()).zoom).toBeGreaterThanOrEqual(10)
  })

  test('using the expanded row\'s own menu does not collapse it', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await rowOf(page, 'Lyon').getByTestId('place-main').click()
    await expect(page.getByTestId('place-panel')).toBeVisible()

    await rowOf(page, 'Lyon').getByRole('button', { name: 'Actions for Lyon' }).click()
    await page.getByRole('menuitem', { name: 'Zoom to' }).click()
    await expect.poll(async () => (await app.mapView()).zoom).toBeGreaterThanOrEqual(10)
    await expect(page.getByTestId('place-panel')).toBeVisible()
    expect((await app.ui()).expandedPlaceId).toBe((await app.trip()).places[0].id)

    // Another row's menu is outside this row: it does collapse.
    await rowOf(page, 'Annecy').getByRole('button', { name: 'Actions for Annecy' }).click()
    await page.getByRole('menuitem', { name: 'Zoom to' }).click()
    await expect(page.getByTestId('place-panel')).toHaveCount(0)
  })

  test('Escape and clicking elsewhere collapse the row', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await rowOf(page, 'Lyon').getByTestId('place-main').click()
    await expect(page.getByTestId('place-panel')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('place-panel')).toHaveCount(0)
    await expect(rowOf(page, 'Lyon').getByTestId('place-main')).toBeFocused()

    await rowOf(page, 'Lyon').getByTestId('place-main').click()
    await expect(page.getByTestId('place-panel')).toBeVisible()
    await page.mouse.click(900, 400) // the map
    await expect(page.getByTestId('place-panel')).toHaveCount(0)

    // Clicking the expanded row's own header toggles it.
    await rowOf(page, 'Lyon').getByTestId('place-main').click()
    await rowOf(page, 'Lyon').getByTestId('place-main').click()
    await expect(page.getByTestId('place-panel')).toHaveCount(0)
  })

  test('renaming inline marks the name as custom; Escape cancels', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await rowOf(page, 'Lyon').getByRole('button', { name: 'Actions for Lyon' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const input = page.getByTestId('place-rename-input')
    await expect(input).toBeFocused()
    await input.fill('Home base')
    await input.press('Enter')
    await expect(page.getByTestId('place-name').first()).toHaveText('Home base')
    expect((await app.trip()).places[0]).toMatchObject({ name: 'Home base', customName: true })
    await expect(label(page, 'Home base')).toBeVisible()

    // From the expanded row too; Escape throws the edit away.
    await rowOf(page, 'Annecy').getByTestId('place-main').click()
    await page.getByRole('button', { name: 'Rename' }).click()
    await expect(page.getByTestId('place-panel')).toHaveCount(0)
    await page.getByTestId('place-rename-input').fill('Nope')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('place-rename-input')).toHaveCount(0)
    expect((await app.trip()).places[1].name).toBe('Annecy')
  })

  test('the row menu zooms to a place and deletes it', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy', 'Zurich')
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([50, 10], 4, { animate: false }))
    await rowOf(page, 'Zurich').getByRole('button', { name: 'Actions for Zurich' }).click()
    await page.getByRole('menuitem', { name: 'Zoom to' }).click()
    const zurich = findPlace('Zurich')
    await expect.poll(async () => Math.abs((await app.mapView()).lat - zurich.lat)).toBeLessThan(0.05)
    await expect.poll(async () => (await app.mapView()).zoom).toBeGreaterThanOrEqual(10)

    await rowOf(page, 'Annecy').getByRole('button', { name: 'Actions for Annecy' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect.poll(() => names(app)).toEqual(['Lyon', 'Zurich'])
    await expect(rows(page)).toHaveCount(2)
    await expect(page.locator('.place-marker')).toHaveCount(2)
    expect((await app.trip()).legs).toHaveLength(1)
  })
})

test.describe('map markers', () => {
  test('hover and selection are shared between rows and markers', async ({ page, app }) => {
    await app.goto()
    const ids = await app.addPlaces('Lyon', 'Annecy', 'Zurich')
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([46.5, 6.5], 6, { animate: false }))

    await rowOf(page, 'Annecy').hover()
    await expect(marker(page, 2)).toHaveClass(/is-hovered/)
    await expect(label(page, 'Annecy')).toHaveClass(/is-hovered/)
    await expect(marker(page, 1)).not.toHaveClass(/is-hovered/)

    await marker(page, 3).hover()
    await expect(rowOf(page, 'Zurich').locator('.place-card')).toHaveAttribute('data-hovered', 'true')
    expect((await app.ui()).hoveredPlaceId).toBe(ids[2])

    await marker(page, 1).click()
    expect((await app.ui()).selectedPlaceId).toBe(ids[0])
    await expect(marker(page, 1)).toHaveClass(/is-selected/)
    await expect(rowOf(page, 'Lyon').locator('.place-card')).toHaveAttribute('data-selected', 'true')

    // Clicking empty map clears the selection.
    await page.mouse.click(1300, 150)
    await expect(marker(page, 1)).not.toHaveClass(/is-selected/)
    expect((await app.ui()).selectedPlaceId).toBeNull()
  })

  test('labels of crowded stops give way to each other until there is room', async ({ page, app }) => {
    await app.goto()
    await page.evaluate(() => {
      const s = window.__ROADMAP__!.trip.getState()
      s.addPlace({ name: 'North Gate', lat: 45.7678, lng: 4.842 })
      s.addPlace({ name: 'Middle Gate', lat: 45.7628, lng: 4.837 })
      s.addPlace({ name: 'South Gate', lat: 45.7578, lng: 4.832 })
      s.addPlace({ name: 'Far Away', lat: 46.5, lng: 6.5 })
      window.__ROADMAP__!.getMap()!.setView([46.1, 5.6], 7, { animate: false })
    })
    // Three stops on the same spot: the first label goes right of the cluster, the next one left,
    // and there is no room for the third.
    await expect(label(page, 'North Gate')).toBeVisible()
    await expect(label(page, 'Far Away')).toBeVisible()
    await expect(label(page, 'Middle Gate')).toBeVisible()
    await expect(label(page, 'South Gate')).toBeHidden()
    // Pointing at the stop shows its label anyway.
    await marker(page, 3).hover()
    await expect(label(page, 'South Gate')).toBeVisible()
    await page.mouse.move(1300, 700)
    await expect(label(page, 'South Gate')).toBeHidden()

    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([45.7628, 4.837], 15, { animate: false }))
    for (const name of ['North Gate', 'Middle Gate', 'South Gate']) await expect(label(page, name)).toBeVisible()
  })

  test('clicking a marker scrolls its row into view', async ({ page, app }) => {
    await app.goto()
    await page.evaluate(() => {
      const s = window.__ROADMAP__!.trip.getState()
      for (let i = 0; i < 14; i++) s.addPlace({ name: `Stop ${i + 1}`, lat: 46 + i * 0.1, lng: 5 + i * 0.1 })
      window.__ROADMAP__!.getMap()!.setView([46.65, 5.65], 9, { animate: false })
    })
    const scroller = page.locator('.sidebar__scroll')
    await expect(scroller).toBeVisible()
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

    const last = rowOf(page, 'Stop 14')
    await expect(last).not.toBeInViewport({ ratio: 0.5 })
    await marker(page, 14).click()
    await expect(last).toBeInViewport({ ratio: 1 })
  })

  test('dragging a marker moves the place (one undo step) and renames it without another step', async ({ page, app, mocks }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.fitBounds([[45, 1], [47, 7]], { animate: false }))
    const lyon = findPlace('Lyon')
    const paris = findPlace('Paris')
    // Paris lies outside this view: drop Lyon on a spot 12 km from Paris's centre instead, off to the north-west.
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.fitBounds([[45, 1], [49.5, 7]], { animate: false }))
    const from = await center(marker(page, 1))
    const to = await screenPoint(page, paris.lat + 0.05, paris.lng - 0.05)
    const before = await app.history()

    await dragBetween(page, from, to)

    await expect.poll(async () => (await app.trip()).places[0].name).toBe('Paris')
    const place = (await app.trip()).places[0]
    expect(place.lat).toBeCloseTo(paris.lat + 0.05, 1)
    expect(place.lng).toBeCloseTo(paris.lng - 0.05, 1)
    expect(place.address).toContain('Île-de-France')
    expect(place.customName).toBeUndefined()
    expect(mocks.nominatim.requests.filter((r) => r.url.includes('/reverse'))).toHaveLength(1)
    expect(mocks.nominatim.requests.find((r) => r.url.includes('/reverse'))!.url).toContain('zoom=14')
    // Move + name arrive as ONE history entry.
    expect((await app.history()).past).toBe(before.past + 1)
    await expect(label(page, 'Paris')).toBeVisible()

    await page.getByRole('button', { name: 'Undo' }).click()
    const undone = (await app.trip()).places[0]
    expect(undone).toMatchObject({ name: 'Lyon', lat: lyon.lat, lng: lyon.lng })
    await expect(marker(page, 1)).toBeVisible()
    await page.getByRole('button', { name: 'Redo' }).click()
    expect((await app.trip()).places[0]).toMatchObject({ name: 'Paris' })
  })

  test('a hand-named place keeps its name when its marker is dragged', async ({ page, app, mocks }) => {
    await app.goto()
    const [id] = await app.addPlaces('Lyon')
    await page.evaluate((i) => window.__ROADMAP__!.trip.getState().updatePlace(i, { name: 'Home', customName: true }), id)
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([45.76, 4.83], 10, { animate: false }))
    const from = await center(marker(page, 1))
    await dragBetween(page, from, { x: from.x + 120, y: from.y + 60 })
    await expect.poll(async () => (await app.trip()).places[0].lat).not.toBeCloseTo(findPlace('Lyon').lat, 3)
    expect((await app.trip()).places[0].name).toBe('Home')
    expect(mocks.nominatim.requests).toHaveLength(0)
  })

  test('a late name is dropped when the place changed meanwhile', async ({ page, app, mocks }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([45.76, 4.83], 10, { animate: false }))
    mocks.nominatim.delayMs = 600
    const from = await center(marker(page, 1))
    await dragBetween(page, from, { x: from.x + 100, y: from.y + 50 })
    await expect.poll(async () => (await app.trip()).places[0].lat).not.toBeCloseTo(findPlace('Lyon').lat, 3)
    // Rename it by hand before the geocoder answers: its answer must not overwrite that.
    const [place] = (await app.trip()).places
    await page.evaluate((id) => window.__ROADMAP__!.trip.getState().updatePlace(id, { name: 'Mine', customName: true }), place.id)
    await expect.poll(() => mocks.nominatim.requests.length).toBe(1)
    await page.waitForTimeout(1000)
    expect((await app.trip()).places[0].name).toBe('Mine')
  })
})

test.describe('map context menus', () => {
  test('right-click adds a place here, named by reverse geocoding, as one undo step', async ({ page, app, mocks }) => {
    await app.goto()
    const lyon = findPlace('Lyon')
    await page.evaluate(([la, ln]) => window.__ROADMAP__!.getMap()!.setView([la, ln], 9, { animate: false }), [lyon.lat, lyon.lng])
    mocks.nominatim.delayMs = 400
    const at = await screenPoint(page, lyon.lat + 0.1, lyon.lng + 0.1)
    await page.mouse.click(at.x, at.y, { button: 'right' })

    const menu = page.getByRole('menu', { name: 'Map actions' })
    await expect(menu).toBeVisible()
    // Only one place exists, so there is no leg to insert into.
    await expect(page.getByRole('menuitem', { name: 'Insert place here' })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Add place here' }).click()
    await expect(menu).toBeHidden()

    // First the provisional name, then the real one.
    await expect(page.getByTestId('place-name')).toHaveText('Dropped pin')
    await expect(page.getByTestId('place-name')).toHaveText('Lyon')
    const trip = await app.trip()
    expect(trip.places).toHaveLength(1)
    expect(trip.places[0].lat).toBeCloseTo(lyon.lat + 0.1, 1)
    expect(trip.places[0].address).toContain('Métropole de Lyon')
    expect((await app.history()).past).toBe(1)

    await page.getByRole('button', { name: 'Undo' }).click()
    expect((await app.trip()).places).toHaveLength(0)
    await page.getByRole('button', { name: 'Redo' }).click()
    expect((await app.trip()).places[0].name).toBe('Lyon')
  })

  test('Insert place here splices into the leg whose line passes nearest', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy', 'Zurich')
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.fitBounds([[45, 4], [48, 9]], { animate: false }))
    // Next to the Annecy → Zurich leg's middle, far from Lyon → Annecy.
    const a = findPlace('Annecy')
    const z = findPlace('Zurich')
    const at = await screenPoint(page, (a.lat + z.lat) / 2 + 0.15, (a.lng + z.lng) / 2 + 0.2)
    await page.mouse.click(at.x, at.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Insert place here' }).click()

    await expect(rows(page)).toHaveCount(4)
    const trip = await app.trip()
    // Inserted between Annecy and Zurich, sharing the previous stop's day.
    expect(trip.places[0].name).toBe('Lyon')
    expect(trip.places[1].name).toBe('Annecy')
    expect(trip.places[3].name).toBe('Zurich')
    expect(trip.places[2].lat).toBeGreaterThan(46)
    expect(trip.places.map((p) => p.day)).toEqual([0, 1, 1, 2])
    expect(trip.legs).toHaveLength(3)
  })

  test('menus close on Escape, outside click and map movement; right-click on a marker renames or deletes', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([45.8, 5.5], 8, { animate: false }))
    const empty = { x: 1300, y: 200 }

    const open = () => page.mouse.click(empty.x, empty.y, { button: 'right' })
    const menu = page.getByRole('menu', { name: 'Map actions' })
    await open()
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    await open()
    await expect(menu).toBeVisible()
    await page.mouse.click(900, 600)
    await expect(menu).toBeHidden()

    await open()
    await expect(menu).toBeVisible()
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.panBy([100, 0], { animate: false }))
    await expect(menu).toBeHidden()

    // Keyboard: the first item is focused, arrows move.
    await open()
    await expect(page.getByRole('menuitem', { name: 'Add place here' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Insert place here' })).toBeFocused()
    await page.keyboard.press('Escape')

    // Right-click on a marker: Rename / Delete.
    await marker(page, 1).click({ button: 'right' })
    const markerMenu = page.getByRole('menu', { name: 'Place actions' })
    await expect(markerMenu.getByRole('menuitem')).toHaveText(['Rename', 'Delete'])
    await markerMenu.getByRole('menuitem', { name: 'Rename' }).click()
    await expect(page.getByTestId('place-rename-input')).toBeFocused()
    await page.getByTestId('place-rename-input').fill('Start')
    await page.keyboard.press('Enter')
    expect((await app.trip()).places[0]).toMatchObject({ name: 'Start', customName: true })

    await marker(page, 2).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect.poll(() => names(app)).toEqual(['Start'])
    await expect(page.locator('.place-marker')).toHaveCount(1)
  })
})

test.describe('focus and touch', () => {
  test('the map menu gives focus back to where it was, on Escape and after an action', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([45.8, 5.5], 8, { animate: false }))
    const mapBox = page.locator('.leaflet-container')
    const open = () => page.mouse.click(1300, 200, { button: 'right' })

    await open()
    await expect(page.getByRole('menuitem', { name: 'Add place here' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name: 'Map actions' })).toBeHidden()
    await expect(mapBox).toBeFocused()

    await open()
    await page.getByRole('menuitem', { name: 'Add place here' }).click()
    await expect(rows(page)).toHaveCount(3)
    await expect(mapBox).toBeFocused()
  })

  test('only a mouse sets the hover state; touch pointers (and their compatibility mouse events) do not', async ({ page, app }) => {
    await app.goto()
    const ids = await app.addPlaces('Lyon', 'Annecy')
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([45.8, 5.5], 8, { animate: false }))
    const card = rowOf(page, 'Lyon').locator('.place-card')
    const pin = marker(page, 2)

    // What a tap produces: pointer events of type touch, then compatibility mouse events.
    await card.dispatchEvent('pointerover', { pointerType: 'touch', bubbles: true })
    await pin.dispatchEvent('pointerover', { pointerType: 'touch', bubbles: true })
    await pin.dispatchEvent('mouseover', { bubbles: true })
    await page.waitForTimeout(100)
    expect((await app.ui()).hoveredPlaceId).toBeNull()
    await expect(pin).not.toHaveClass(/is-hovered/)

    // Control: the same events from a mouse do set it.
    await pin.dispatchEvent('pointerover', { pointerType: 'mouse', bubbles: true })
    await pin.dispatchEvent('mouseover', { bubbles: true })
    await expect(pin).toHaveClass(/is-hovered/)
    expect((await app.ui()).hoveredPlaceId).toBe(ids[1])
    await card.dispatchEvent('pointerover', { pointerType: 'mouse', bubbles: true })
    await expect.poll(async () => (await app.ui()).hoveredPlaceId).toBe(ids[0])
  })
})
