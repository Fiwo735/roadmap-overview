import type { Page } from '@playwright/test'
import { formatDistance, formatDuration } from '../src/lib/format'
import { computeManualRoute } from '../src/lib/manualRoute'
import { MODES } from '../src/lib/modes'
import { expect, findPlace, test, type App } from './fixtures'

const at = (name: string) => {
  const { lat, lng } = findPlace(name)
  return { lat, lng }
}
const card = (page: Page) => page.getByTestId('trip-card')
const pill = (page: Page) => page.getByTestId('trip-pill')
const value = (page: Page, id: string) => page.getByTestId(`stat-${id}-value`)
const connector = (page: Page, i: number) => page.getByTestId('leg-connector').nth(i)
const flags = (page: Page) => page.getByTestId('country-flag')
const topBarTitle = (page: Page) => page.getByTestId('trip-title')

type Box = { x: number; y: number; width: number; height: number }
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** No place marker lies under the title card (or its pill) or the map tools. */
async function expectMarkersClearOfOverlays(page: Page, only?: number[]) {
  const covers = [await card(page).or(pill(page)).boundingBox(), await page.getByTestId('map-tools').boundingBox()]
  const markers = page.locator('.place-marker')
  const count = await markers.count()
  expect(count).toBeGreaterThan(0)
  for (let i = 0; i < count; i++) {
    const marker = markers.nth(i)
    if (only && !only.includes(Number(await marker.textContent()))) continue
    const box = (await marker.boundingBox())!
    for (const cover of covers) expect(overlap(box, cover!), `marker ${i + 1} at ${JSON.stringify(box)} under ${JSON.stringify(cover)}`).toBe(false)
  }
}

/**
 * Four places at the corners of a box, joined by straight lines (no routing): the first is in the
 * top-left corner of any fit. The box is shaped like the map (`wide`) or like a phone screen.
 */
async function addCornerPlaces(app: App, shape: 'wide' | 'tall' = 'wide') {
  await app.page.evaluate((shape) => {
    const s = window.__ROADMAP__!.trip.getState()
    const [n, south, w, e] = shape === 'wide' ? [58.5, 44, -10, 20] : [53.7, 36, -5, 5]
    for (const [name, lat, lng] of [['NW', n, w], ['NE', n, e], ['SE', south, e], ['SW', south, w]] as const) s.addPlace({ name, lat, lng })
    for (const leg of window.__ROADMAP__!.trip.getState().trip.legs) s.updateLeg(leg.id, { straight: true })
  }, shape)
}

/** Open the app with these places and wait until every leg is routed. */
async function openTrip(page: Page, app: App, ...names: string[]) {
  await app.goto()
  await app.addPlaces(...names)
  for (let i = 0; i + 1 < names.length; i++) await expect(connector(page, i)).toHaveAttribute('data-status', 'ok')
}

test.describe('the title and statistics card', () => {
  test('shows distance, days, stops, driving time and the countries of a trip', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    const [a, b] = [await app.legRoute(0), await app.legRoute(1)]

    await expect(card(page)).toBeVisible()
    await expect(value(page, 'distance')).toHaveText(formatDistance(a.distanceM + b.distanceM))
    await expect(value(page, 'days')).toHaveText('3')
    await expect(value(page, 'stops')).toHaveText('3')
    await expect(value(page, 'driving')).toHaveText(formatDuration(a.durationS + b.durationS))
    // No other mode in use: no ferry/train/flight tiles. No dates set: no range.
    await expect(page.getByTestId('stat-ferry')).toHaveCount(0)
    await expect(page.getByTestId('stat-train')).toHaveCount(0)
    await expect(page.getByTestId('stat-flight')).toHaveCount(0)
    await expect(page.getByTestId('start-date')).toHaveText('Add dates')
    // Everything is routed: nothing is marked as partial.
    await expect(page.getByTestId('stats-status')).toHaveCount(0)
    await expect(card(page)).not.toHaveAttribute('data-partial', 'true')
  })

  test('lists the countries with flags, in the order of the trip, and names them on hover and focus', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')

    await expect(value(page, 'countries')).toHaveText('2')
    await expect(flags(page)).toHaveCount(2)
    await expect(page.getByRole('img', { name: 'France' })).toHaveCount(1) // each flag is an image named after its country
    expect(await flags(page).evaluateAll((els) => els.map((el) => [el.getAttribute('data-code'), el.getAttribute('aria-label')]))).toEqual([
      ['FR', 'France'],
      ['CH', 'Switzerland'],
    ])
    // The flag images really load (from the flag-icons package, served by the app).
    for (const flag of await flags(page).all()) {
      const img = flag.locator('img')
      await expect(img).toHaveAttribute('src', /^\/flags\/(fr|ch)\.svg$/)
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete)).toBe(true)
      const response = await page.request.get((await img.getAttribute('src'))!)
      expect(response.ok()).toBe(true)
      expect(response.headers()['content-type']).toBe('image/svg+xml')
      const box = (await img.boundingBox())!
      expect([box.width, box.height]).toEqual([24, 18])
    }

    await flags(page).first().hover()
    await expect(page.locator('.tooltip')).toHaveText('France')
    await page.mouse.move(700, 700)
    await expect(page.locator('.tooltip')).toBeHidden()

    // By keyboard: from the collapse button, Tab reaches the distance tile (which has a tooltip), then the flags.
    await page.getByTestId('card-collapse').focus()
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('stat-distance')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(flags(page).first()).toBeFocused()
    await expect(page.locator('.tooltip')).toHaveText('France')
    await page.keyboard.press('Tab')
    await expect(page.locator('.tooltip')).toHaveText('Switzerland')
  })

  test('counts a country the road only passes through, and one added by a place', async ({ page, app }) => {
    // The mocked road between Munich and Milan is a wiggly straight line: it crosses Austria and Switzerland.
    await openTrip(page, app, 'Munich', 'Milan')
    await expect(flags(page)).toHaveCount(4)
    expect(await flags(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-code')))).toEqual(['DE', 'AT', 'CH', 'IT'])
    await expect(value(page, 'countries')).toHaveText('4')

    // Remove the second place: the countries follow.
    await app.page.evaluate(() => window.__ROADMAP__!.trip.getState().removePlace(window.__ROADMAP__!.trip.getState().trip.places[1].id))
    await expect(flags(page)).toHaveCount(1)
    await expect(flags(page)).toHaveAttribute('data-code', 'DE')
  })

  test('a hand-drawn leg adds no country its line only crosses, but the via points the user put on it count', async ({ page, app }) => {
    await openTrip(page, app, 'Munich', 'Milan')
    const codes = () => flags(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-code')))
    await expect(flags(page)).toHaveCount(4)
    expect(await codes()).toEqual(['DE', 'AT', 'CH', 'IT'])

    // As a train the straight line through Austria and Switzerland is only a drawing.
    const legId = (await app.trip()).legs[0].id
    await app.page.evaluate((id) => window.__ROADMAP__!.trip.getState().updateLeg(id, { mode: 'train' }), legId)
    await expect(flags(page)).toHaveCount(2)
    expect(await codes()).toEqual(['DE', 'IT'])

    // A point dragged into Austria says the trip goes there.
    await app.page.evaluate((id) => window.__ROADMAP__!.trip.getState().addVia(id, 0, { lat: 47.2692, lng: 11.4041 }), legId)
    await expect(flags(page)).toHaveCount(3)
    expect(await codes()).toEqual(['DE', 'AT', 'IT'])
  })

  test('fetches the country boundaries only once there is a place to look up', async ({ page, app }) => {
    const requested: string[] = []
    page.on('request', (r) => {
      if (/worldIndex|countries-50m/.test(r.url())) requested.push(r.url())
    })
    await app.goto()
    await expect(page.getByTestId('trip-card')).toBeVisible()
    await page.waitForTimeout(300)
    expect(requested).toEqual([])

    await app.addPlaces('Lyon')
    await expect(flags(page)).toHaveCount(1)
    expect(requested.length).toBeGreaterThan(0)
  })

  test('shows a dash instead of a wrong count when the boundaries cannot be downloaded, and recovers', async ({ page, app }) => {
    await page.route(/worldIndex/, (route) => route.abort('failed'))
    await app.goto()
    await app.addPlaces('Lyon')
    await expect(value(page, 'countries')).toHaveText('—')
    await expect(flags(page)).toHaveCount(0)
    await expect(value(page, 'stops')).toHaveText('1')

    // The next change of the trip tries again.
    await page.unroute(/worldIndex/)
    await app.addPlaces('Zurich')
    await expect(value(page, 'countries')).toHaveText('2')
    await expect(flags(page)).toHaveCount(2)
  })

  test('an empty trip shows a hint instead of numbers; one place shows one stop, one day, one country', async ({ page, app }) => {
    await app.goto()
    await expect(card(page)).toContainText('Add places to see distance, days and countries')
    await expect(page.getByTestId('stats')).toHaveCount(0)

    await app.addPlaces('Lyon')
    await expect(page.getByTestId('stats')).toBeVisible()
    await expect(value(page, 'stops')).toHaveText('1')
    await expect(value(page, 'days')).toHaveText('1')
    await expect(page.getByTestId('stat-days')).toContainText('Day')
    await expect(page.getByTestId('stat-distance')).toHaveCount(0)
    await expect(page.getByTestId('stat-driving')).toHaveCount(0)
    await expect(flags(page)).toHaveCount(1)
    await expect(page.getByTestId('stat-countries')).toContainText('Country')
  })

  test('marks the numbers as partial while legs are routing, then settles', async ({ page, app, mocks }) => {
    mocks.osrm.delayMs = 700
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy', 'Zurich')

    await expect(page.getByTestId('stats-status')).toContainText('Routing 2 legs')
    await expect(card(page)).toHaveAttribute('data-partial', 'true')
    await expect(page.getByTestId('stat-distance')).toHaveAttribute('data-partial', 'true')
    await expect(value(page, 'distance')).toHaveText('—')
    // What does not depend on routes is already right, and the countries follow the places.
    await expect(value(page, 'stops')).toHaveText('3')
    await expect(value(page, 'days')).toHaveText('3')
    await expect(flags(page)).toHaveCount(2)

    // The first route arrives: its numbers show, one leg still pending.
    await expect(page.getByTestId('stats-status')).toContainText('Routing 1 leg…')
    const first = await app.legRoute(0)
    await expect(value(page, 'distance')).toHaveText(formatDistance(first.distanceM))

    await expect(page.getByTestId('stats-status')).toHaveCount(0)
    await expect(card(page)).not.toHaveAttribute('data-partial', 'true')
    const second = await app.legRoute(1)
    await expect(value(page, 'distance')).toHaveText(formatDistance(first.distanceM + second.distanceM))
  })

  test('says so when a leg could not be routed, and counts only the routed ones', async ({ page, app, mocks }) => {
    mocks.osrm.failWith = 'NoRoute'
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'error')
    await expect(page.getByTestId('stats-status')).toContainText('1 leg not routed')
    await expect(value(page, 'distance')).toHaveText('—')
    await expect(value(page, 'stops')).toHaveText('2')

    // "Use straight line" makes the leg known: nothing is pending any more.
    await connector(page, 0).getByRole('button', { name: 'Use straight line' }).click()
    await expect(page.getByTestId('stats-status')).toHaveCount(0)
    await expect(value(page, 'distance')).not.toHaveText('—')
  })

  test('shows a time per other mode in use, and breaks the distance down by mode', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await expect(page.getByTestId('stat-ferry')).toHaveCount(0)

    await app.page.evaluate(() => {
      const s = window.__ROADMAP__!.trip.getState()
      s.updateLeg(s.trip.legs[1].id, { mode: 'ferry', durationMin: 150 })
    })
    const drive = await app.legRoute(0)
    await expect(page.getByTestId('stat-ferry')).toBeVisible()
    await expect(value(page, 'ferry')).toHaveText('2 h 30 min')
    await expect(value(page, 'driving')).toHaveText(formatDuration(drive.durationS))
    await expect(page.getByTestId('stat-train')).toHaveCount(0)

    // The distance tile names the breakdown to the mouse (tooltip) and to screen readers.
    const ferryM = computeManualRoute(at('Annecy'), [], at('Zurich'), 'ferry').distanceM
    const breakdown = `${MODES.drive.label} ${formatDistance(drive.distanceM)} · ${MODES.ferry.label} ${formatDistance(ferryM)}`
    await expect(page.getByTestId('stat-distance')).toContainText(breakdown)
    await page.getByTestId('stat-distance').hover()
    await expect(page.locator('.tooltip')).toHaveText(breakdown)
    await expect(value(page, 'distance')).toHaveText(formatDistance(drive.distanceM + ferryM))

    // A flight adds its own tile; with no drive leg left there is no driving tile (not "0 min").
    await app.page.evaluate(() => {
      const s = window.__ROADMAP__!.trip.getState()
      s.updateLeg(s.trip.legs[0].id, { mode: 'flight' })
    })
    await expect(page.getByTestId('stat-flight')).toBeVisible()
    await expect(page.getByTestId('stat-ferry')).toBeVisible()
    await expect(page.getByTestId('stat-driving')).toHaveCount(0)
    await expect(page.getByTestId('stat-distance')).toBeVisible()

    // And back: a drive leg again, the tile is back.
    await app.page.evaluate(() => {
      const s = window.__ROADMAP__!.trip.getState()
      s.updateLeg(s.trip.legs[0].id, { mode: 'drive' })
    })
    await expect(page.getByTestId('stat-driving')).toBeVisible()
  })

  test('a ferry crossing inside a drive route counts as ferry time, also with a duration override', async ({ page, app }) => {
    await openTrip(page, app, 'Dover', 'Calais')
    await expect(page.getByTestId('stat-ferry')).toBeVisible()
    const route = await app.legRoute(0)
    const ferry = route.spans!.find((s) => s.mode === 'ferry')!
    await expect(value(page, 'ferry')).toHaveText(formatDuration(ferry.durationS))
    await expect(value(page, 'driving')).toHaveText(formatDuration(route.durationS - ferry.durationS))

    // The user's duration for the whole leg is shared between road and ferry in the routed proportion.
    await app.page.evaluate(() => {
      const s = window.__ROADMAP__!.trip.getState()
      s.updateLeg(s.trip.legs[0].id, { durationMin: 120 })
    })
    const share = ferry.durationS / route.spans!.reduce((sum, s) => sum + s.durationS, 0)
    await expect(value(page, 'ferry')).toHaveText(formatDuration(7_200 * share))
    await expect(value(page, 'driving')).toHaveText(formatDuration(7_200 * (1 - share)))
  })

  test('the trip length follows the typed days, including out-of-order ones', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await app.page.evaluate(() => {
      const s = window.__ROADMAP__!.trip.getState()
      s.updatePlace(s.trip.places[2].id, { day: 9 })
    })
    await expect(value(page, 'days')).toHaveText('10')
    await app.page.evaluate(() => {
      const s = window.__ROADMAP__!.trip.getState()
      s.updatePlace(s.trip.places[1].id, { day: 12 })
      s.updatePlace(s.trip.places[2].id, { day: 3 })
    })
    // Day 3 after day 12 counts as day 12: 0 … 12.
    await expect(value(page, 'days')).toHaveText('13')
  })
})

test.describe('title, subtitle and dates', () => {
  test('editing the title on the card updates the top bar; one undo step restores it', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const title = page.getByTestId('card-title')
    await expect(title).toHaveText('My campervan trip')
    const before = (await app.history()).past

    await title.click()
    const input = page.getByTestId('card-title-input')
    await expect(input).toBeFocused()
    await input.fill('Alps')
    await input.pressSequentially(' in July')
    // Typing alone changes nothing in the trip: one history entry per edit.
    expect((await app.trip()).title).toBe('My campervan trip')
    await input.press('Enter')

    await expect(title).toHaveText('Alps in July')
    await expect(title).toBeFocused()
    await expect(topBarTitle(page)).toHaveValue('Alps in July')
    expect((await app.trip()).title).toBe('Alps in July')
    expect((await app.history()).past).toBe(before + 1)

    await page.keyboard.press('Control+z')
    await expect(title).toHaveText('My campervan trip')
    await expect(topBarTitle(page)).toHaveValue('My campervan trip')
    await page.keyboard.press('Control+Shift+z')
    await expect(title).toHaveText('Alps in July')
  })

  test('the top bar title edits the card title too; Escape discards a card edit; a blur commits it', async ({ page, app }) => {
    await app.goto()
    await topBarTitle(page).fill('From the top bar')
    await topBarTitle(page).press('Enter')
    await expect(page.getByTestId('card-title')).toHaveText('From the top bar')

    await page.getByTestId('card-title').click()
    await page.getByTestId('card-title-input').fill('Discard me')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('card-title')).toHaveText('From the top bar')
    expect((await app.trip()).title).toBe('From the top bar')

    await page.getByTestId('card-title').click()
    await page.getByTestId('card-title-input').fill('Committed by blur')
    await page.getByTestId('card-subtitle').click() // clicking elsewhere on the card blurs the field
    await expect(page.getByTestId('card-subtitle-input')).toBeFocused()
    expect((await app.trip()).title).toBe('Committed by blur')
  })

  test('an empty title shows its placeholder on the card and in the pill', async ({ page, app }) => {
    await app.goto()
    await page.getByTestId('card-title').click()
    await page.getByTestId('card-title-input').fill('   ')
    await page.keyboard.press('Enter')
    expect((await app.trip()).title).toBe('')
    await expect(page.getByTestId('card-title')).toHaveText('Untitled trip')
    await page.getByTestId('card-collapse').click()
    await expect(pill(page)).toContainText('Untitled trip')
  })

  test('the subtitle is optional: a placeholder, edited in place, one undo step, cleared by emptying it', async ({ page, app }) => {
    await app.goto()
    const subtitle = page.getByTestId('card-subtitle')
    await expect(subtitle).toHaveText('Add a subtitle')
    expect((await app.trip()).subtitle).toBeUndefined()

    await subtitle.click()
    await page.getByTestId('card-subtitle-input').fill('Two weeks, one van')
    await page.keyboard.press('Enter')
    await expect(subtitle).toHaveText('Two weeks, one van')
    expect((await app.trip()).subtitle).toBe('Two weeks, one van')

    await page.keyboard.press('Control+z')
    await expect(subtitle).toHaveText('Add a subtitle')
    expect((await app.trip()).subtitle).toBeUndefined()

    await page.keyboard.press('Control+Shift+z')
    await subtitle.click()
    await page.getByTestId('card-subtitle-input').fill('')
    await page.keyboard.press('Enter')
    await expect(subtitle).toHaveText('Add a subtitle')
    expect((await app.trip()).subtitle).toBeUndefined()
  })

  test('a start date shows the dates the trip covers, which follow the days', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    const date = page.getByTestId('start-date')
    await expect(date).toHaveText('Add dates')
    const before = (await app.history()).past

    await date.click()
    await page.getByTestId('start-date-input').fill('2026-07-01')
    await page.keyboard.press('Enter')
    await expect(date).toHaveText('1 – 3 Jul 2026')
    await expect(date).toBeFocused()
    expect((await app.trip()).startDate).toBe('2026-07-01')
    expect((await app.history()).past).toBe(before + 1)

    // More days: the range grows (and crosses into August).
    await app.page.evaluate(() => {
      const s = window.__ROADMAP__!.trip.getState()
      s.updatePlace(s.trip.places[2].id, { day: 33 })
    })
    await expect(date).toHaveText('1 Jul – 3 Aug 2026')

    await page.keyboard.press('Control+z') // undo the day change
    await page.keyboard.press('Control+z') // undo the date
    await expect(date).toHaveText('Add dates')
    expect((await app.trip()).startDate).toBeUndefined()
  })

  test('however a date is edited it is one undo step, committed on Enter, Apply or leaving the field; Escape discards', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    const date = page.getByTestId('start-date')
    const input = page.getByTestId('start-date-input')
    const start = (await app.history()).past

    // Several changes of the field (a day typed digit by digit, then another date) change nothing until Enter.
    await date.click()
    await input.fill('2026-07-02')
    await input.focus()
    await page.keyboard.press('ArrowRight') // to the day segment
    await page.keyboard.type('20')
    await input.fill('2026-07-20')
    expect((await app.trip()).startDate).toBeUndefined()
    expect((await app.history()).past).toBe(start)
    await page.keyboard.press('Enter')
    expect((await app.trip()).startDate).toBe('2026-07-20')
    expect((await app.history()).past).toBe(start + 1)
    await expect(date).toHaveText('20 Jul 2026')

    // Escape discards the edit.
    await date.click()
    await input.fill('2027-01-02')
    await page.keyboard.press('Escape')
    await expect(date).toHaveText('20 Jul 2026')
    expect((await app.trip()).startDate).toBe('2026-07-20')
    expect((await app.history()).past).toBe(start + 1)

    // Leaving the field commits it (here: a click on the subtitle).
    await date.click()
    await input.fill('2026-08-03')
    await page.getByTestId('card-subtitle').click()
    await expect(date).toHaveText('3 Aug 2026')
    expect((await app.history()).past).toBe(start + 2)
    await page.keyboard.press('Escape') // out of the subtitle field

    // The check button applies it too; an incomplete date is dropped.
    await date.click()
    await input.fill('2026-09-09')
    await page.getByTestId('start-date-apply').click()
    await expect(date).toHaveText('9 Sep 2026')
    await date.click()
    await input.fill('')
    await page.keyboard.press('Enter')
    await expect(date).toHaveText('9 Sep 2026')
    expect((await app.history()).past).toBe(start + 3)
  })

  test('the start date can be removed again', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await app.page.evaluate(() => window.__ROADMAP__!.trip.getState().setStartDate('2026-12-30'))
    const date = page.getByTestId('start-date')
    await expect(date).toHaveText('30 Dec 2026') // one place, one day

    await date.click()
    await page.getByTestId('start-date-input').fill('2027-01-02')
    await page.getByTestId('start-date-clear').click()
    await expect(date).toHaveText('Add dates')
    await expect(date).toBeFocused()
    expect((await app.trip()).startDate).toBeUndefined()
  })
})

test.describe('long texts', () => {
  test('a very long title and subtitle are cut to three and two lines, with the full text on hover', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const long = 'The grand tour of every mountain pass, lake, campsite and bakery between the Atlantic and the Black Sea in one summer'
    const longer = `${long}, with a rather long subtitle that goes on and on about how much fun the whole thing is going to be`
    await app.page.evaluate(
      ([title, subtitle]) => {
        const s = window.__ROADMAP__!.trip.getState()
        s.setTitle(title)
        s.setSubtitle(subtitle)
      },
      [long, longer],
    )
    const title = page.getByTestId('card-title')
    const subtitle = page.getByTestId('card-subtitle')
    await expect(title).toHaveAttribute('title', long)
    await expect(subtitle).toHaveAttribute('title', longer)
    expect((await title.boundingBox())!.height).toBeLessThan(90) // three lines of 25 px plus padding
    expect((await subtitle.boundingBox())!.height).toBeLessThan(50) // two lines of 20 px plus padding
    expect((await card(page).boundingBox())!.height).toBeLessThan(420)

    // Editing shows all of it again.
    await title.click()
    await expect(page.getByTestId('card-title-input')).toHaveValue(long)
  })
})

test.describe('automatic fits leave room for the card and the map tools', () => {
  test('Fit to trip keeps every place clear of them', async ({ page, app }) => {
    await app.goto()
    await addCornerPlaces(app)
    await page.getByTestId('fit-trip').click()
    await app.settle()
    await expectMarkersClearOfOverlays(page)
    // The card is where it was, and the whole trip is still on screen.
    await expect(card(page)).toBeVisible()
    const inside = await page.evaluate(() => {
      const map = window.__ROADMAP__!.getMap()!
      return window.__ROADMAP__!.trip.getState().trip.places.every((p) => map.getBounds().contains([p.lat, p.lng]))
    })
    expect(inside).toBe(true)
  })

  test('fitting a leg and the first view of a restored trip do too', async ({ page, app }) => {
    await app.goto()
    await addCornerPlaces(app)
    await page.getByTestId('fit-trip').click()
    await app.settle()

    // The leg between the first two places.
    await page.evaluate(() => window.__ROADMAP__!.getMap()!.setView([40, 0], 3, { animate: false }))
    await connector(page, 0).getByTestId('leg-summary').click()
    await app.settle()
    await expectMarkersClearOfOverlays(page, [1, 2])

    // A reload restores the trip from the autosave and fits it before anything else moves the map.
    await expect.poll(async () => (await app.savedFile())?.trip.places.length).toBe(4)
    await page.reload()
    await app.ready()
    await app.settle()
    await expectMarkersClearOfOverlays(page)
  })

  test('the folded pill needs little room: the fit then uses the height instead', async ({ page, app }) => {
    await app.goto()
    await page.getByTestId('card-collapse').click()
    await addCornerPlaces(app)
    await page.getByTestId('fit-trip').click()
    await app.settle()
    await expectMarkersClearOfOverlays(page)
  })

  test('a single place is centred in the part of the map the card leaves free', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await page.getByTestId('fit-trip').click()
    await app.settle()
    await expectMarkersClearOfOverlays(page)
    const marker = (await page.locator('.place-marker').boundingBox())!
    const map = (await page.getByTestId('map-area').boundingBox())!
    // The short card of a one-place trip is cleared at the top: the place sits below the middle of the map.
    expect(marker.y + marker.height / 2).toBeGreaterThan(map.y + map.height / 2 + 50)
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('an unfolded card pushes the fit below it', async ({ page, app }) => {
      await app.goto()
      await addCornerPlaces(app, 'tall')
      await pill(page).click()
      await page.getByTestId('fit-trip').click()
      await app.settle()
      await expect(card(page)).toBeVisible()
      await expectMarkersClearOfOverlays(page)
    })
  })
})

test.describe('collapsing the card', () => {
  test('folds into a pill with the title, unfolds again and remembers the choice', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await expect(pill(page)).toHaveCount(0)

    await page.getByTestId('card-collapse').click()
    await expect(card(page)).toHaveCount(0)
    await expect(pill(page)).toBeVisible()
    await expect(pill(page)).toContainText('My campervan trip')
    await expect(pill(page)).toHaveAttribute('aria-expanded', 'false')
    expect((await pill(page).boundingBox())!.height).toBeLessThan(44)

    await page.reload()
    await app.ready()
    await expect(pill(page)).toBeVisible()
    await expect(card(page)).toHaveCount(0)

    await pill(page).click()
    await expect(card(page)).toBeVisible()
    await expect(pill(page)).toHaveCount(0)
    await page.reload()
    await app.ready()
    await expect(card(page)).toBeVisible()
  })

  test('the pill follows the title', async ({ page, app }) => {
    await app.goto()
    await page.getByTestId('card-collapse').click()
    await topBarTitle(page).fill('A new name')
    await topBarTitle(page).press('Enter')
    await expect(pill(page)).toContainText('A new name')
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('starts as a pill; the opened card leaves the map tools free and fits the screen', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await expect(pill(page)).toBeVisible()
    await expect(card(page)).toHaveCount(0)

    await pill(page).click()
    await expect(card(page)).toBeVisible()
    const box = (await card(page).boundingBox())!
    const tools = (await page.getByTestId('map-tools').boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(tools.x - 4)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await expect(value(page, 'distance')).toBeVisible()
    await expect(flags(page)).toHaveCount(2)
  })
})
