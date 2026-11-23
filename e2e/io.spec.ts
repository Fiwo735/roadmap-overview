import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { createTrip, syncLegs } from '../src/lib/trip'
import { parseTripFile, serializeTripFile } from '../src/lib/tripFile'
import type { Place, Trip, TripFile } from '../src/types/trip'
import { expect, placeInput, STORAGE_KEYS, test, type App } from './fixtures'

// lz-string is a CommonJS package: Node's ESM loader only exposes it through require.
const lz = createRequire(import.meta.url)('lz-string') as typeof import('lz-string')

/** The `#trip=…` hash for `file` as the app's share links write it (no routes). Independent of the app's own code. */
function encodeShareHash(file: TripFile): string {
  const { routes: _routes, ...withoutRoutes } = file
  return '#trip=' + lz.compressToEncodedURIComponent(JSON.stringify(withoutRoutes))
}

/** What a share link carries, or null when it does not decode. */
function decodeShareHash(hash: string): TripFile | null {
  const text = lz.decompressFromEncodedURIComponent(hash.replace(/^#trip=/, ''))
  return text ? (JSON.parse(text) as TripFile) : null
}

const fileMenu = (page: Page) => page.getByTestId('file-menu')
const toasts = (page: Page) => page.getByTestId('toast')
const connector = (page: Page, i: number) => page.getByTestId('leg-connector').nth(i)

/** The recent trips as stored in localStorage (newest first). */
const recentEntries = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{ id: string; savedAt: number; file: TripFile }>, STORAGE_KEYS.recent)
const recentTitles = async (page: Page) => (await recentEntries(page)).map((e) => e.file.trip.title)

async function chooseFromMenu(page: Page, item: string) {
  await fileMenu(page).click()
  await page.getByRole('menuitem', { name: item }).click()
}

/** A trip through these gazetteer places, every leg a plain drive (so it needs OSRM). */
function tripOf(title: string, ...names: string[]): Trip {
  const places: Place[] = names.map((name, i) => ({ id: `p_${i}`, ...placeInput(name), day: i }))
  return createTrip({ id: `trip_${title}`, title, places, legs: syncLegs(places, []) })
}

/** The app with these places, routed through the mocked OSRM. */
async function openRoutedTrip(page: Page, app: App, ...names: string[]) {
  await app.goto()
  await app.addPlaces(...names)
  for (let i = 0; i + 1 < names.length; i++) await expect(connector(page, i)).toHaveAttribute('data-status', 'ok')
}

/** Save through the menu and return the text of the downloaded file. */
async function saveViaMenu(page: Page) {
  const downloading = page.waitForEvent('download')
  await chooseFromMenu(page, 'Save as JSON')
  const download = await downloading
  return { download, text: await readFile((await download.path())!, 'utf8') }
}

test.describe('save and open', () => {
  test('Save as JSON downloads a pretty-printed trip file with the routes of its legs', async ({ page, app }) => {
    await openRoutedTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await page.evaluate(() => window.__ROADMAP__!.trip.getState().setTitle('Alps & back!'))

    const { download, text } = await saveViaMenu(page)
    expect(download.suggestedFilename()).toBe('alps-back.trip.json')
    expect(text).toContain('\n  "format": "roadmap-overview/trip"')

    const parsed = parseTripFile(JSON.parse(text))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.warnings).toEqual([])
    const trip = await app.trip()
    expect(parsed.file.trip).toEqual(trip)
    // Routes of the current legs, keyed by leg id, accepted on parse because their keys match.
    expect(Object.keys(parsed.file.routes!)).toEqual(trip.legs.map((l) => l.id))
    expect(parsed.file.routes![trip.legs[0].id]).toEqual(await app.legRoute(0))
    await expect(toasts(page)).toContainText('Saved alps-back.trip.json')
  })

  test('Ctrl+S saves and Ctrl+O opens the file chooser, even while typing in the title', async ({ page, app }) => {
    await openRoutedTrip(page, app, 'Lyon', 'Annecy')
    await page.getByRole('textbox', { name: /trip title/i }).fill('Typed, not committed')

    // Playwright only intercepts the file chooser once a listener has been registered, and does so
    // asynchronously: a listener added in the same breath as the key press can lose that race (the chooser
    // then opens natively and no event comes). So the listener is registered well before Ctrl+O.
    const choosing = page.waitForEvent('filechooser')
    // What was typed is saved even though Enter was never pressed.
    const downloading = page.waitForEvent('download')
    await page.keyboard.press('Control+s')
    expect((await downloading).suggestedFilename()).toBe('typed-not-committed.trip.json')
    expect((await app.trip()).title).toBe('Typed, not committed')

    await page.keyboard.press('Control+o')
    const chooser = await choosing
    expect(chooser.isMultiple()).toBe(false)
  })

  test('saving and sharing an empty trip says there is nothing to do', async ({ page, app }) => {
    await app.goto()
    await fileMenu(page).click()
    await expect(page.getByRole('menuitem', { name: 'Save as JSON' })).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByRole('menuitem', { name: 'Copy share link' })).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+s')
    await expect(toasts(page)).toContainText('There is nothing to save yet')
  })

  test('opening a saved file restores the trip and its routes without asking OSRM', async ({ page, app, mocks }, testInfo) => {
    await openRoutedTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    const trip = await app.trip()
    const route = await app.legRoute(1)
    const { download } = await saveViaMenu(page)
    const path = testInfo.outputPath('saved.trip.json')
    await download.saveAs(path)

    // Start over: empty trip, empty route cache, no history.
    await page.evaluate(() => {
      const ro = window.__ROADMAP__!
      ro.trip.getState().newTrip()
      ro.routes.getState().clear()
      ro.trip.temporal.getState().clear()
    })
    expect((await app.trip()).places).toHaveLength(0)
    mocks.osrm.requests.length = 0

    const choosing = page.waitForEvent('filechooser')
    await chooseFromMenu(page, 'Open trip file…')
    await (await choosing).setFiles(path)

    await expect(page.getByTestId('place-list').getByRole('listitem')).toHaveCount(3)
    expect(await app.trip()).toEqual(trip)
    expect(await app.legRoute(1)).toEqual(route)
    for (const i of [0, 1]) await expect(connector(page, i)).toHaveAttribute('data-status', 'ok')
    await expect(toasts(page).last()).toContainText(`Opened “${trip.title}” (3 places).`)
    // The queue starts its first request at once, so half a second is enough to see one.
    await page.waitForTimeout(600)
    expect(mocks.osrm.requests).toHaveLength(0)

    // One undoable step; the toast's Undo takes it back.
    expect(await app.history()).toEqual({ past: 1, future: 0 })
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    expect((await app.trip()).places).toHaveLength(0)
  })

  test('a file without routes is opened and routed again', async ({ page, app, mocks }) => {
    await app.goto()
    const file = serializeTripFile(tripOf('No routes', 'Berlin', 'Prague'))
    await page.getByTestId('file-menu').click()
    const choosing = page.waitForEvent('filechooser')
    await page.getByRole('menuitem', { name: 'Open trip file…' }).click()
    await (await choosing).setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })

    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    expect(mocks.osrm.requests).toHaveLength(1)
    expect((await app.trip()).title).toBe('No routes')
  })

  test('an unusable file shows why and leaves the trip alone', async ({ page, app }) => {
    await openRoutedTrip(page, app, 'Lyon', 'Annecy')
    const before = await app.trip()
    const historyBefore = await app.history()
    const valid = JSON.parse(JSON.stringify(serializeTripFile(before)))

    const cases: Array<[string, string, string]> = [
      ['notes.json', 'this is not json', 'This is not a trip file: it is not valid JSON.'],
      ['other.json', JSON.stringify({ hello: 'world' }), 'This is not a Roadmap Overview trip file.'],
      ['empty.json', '', 'The file is empty.'],
      ['future.json', JSON.stringify({ ...valid, version: 2 }), 'This trip was saved by a newer version of Roadmap Overview.'],
    ]
    for (const [name, content, reason] of cases) {
      const choosing = page.waitForEvent('filechooser')
      await chooseFromMenu(page, 'Open trip file…')
      await (await choosing).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content) })
      await expect(toasts(page).last()).toContainText(`Could not open ${name}. ${reason}`)
    }
    expect(await app.trip()).toEqual(before)
    expect(await app.history()).toEqual(historyBefore)
  })
})

test.describe('new trip', () => {
  test('an empty trip is replaced at once', async ({ page, app }) => {
    await app.goto()
    await chooseFromMenu(page, 'New trip')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(toasts(page)).toContainText('Started a new trip.')
  })

  test('a trip with places asks first; one undoable step', async ({ page, app }) => {
    await openRoutedTrip(page, app, 'Lyon', 'Annecy')
    const before = await app.trip()
    await page.getByRole('textbox', { name: /trip title/i }).fill('Keep me')
    await page.keyboard.press('Enter')
    const history = await app.history()

    await chooseFromMenu(page, 'New trip')
    const dialog = page.getByRole('dialog', { name: 'Start a new trip?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('“Keep me” and its 2 places will be replaced')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect((await app.trip()).places).toHaveLength(2)

    await chooseFromMenu(page, 'New trip')
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(page.getByTestId('places-empty')).toBeVisible()
    const fresh = await app.trip()
    expect(fresh.places).toEqual([])
    expect(fresh.title).toBe('My campervan trip')
    expect(fresh.id).not.toBe(before.id)
    expect(await app.history()).toEqual({ past: history.past + 1, future: 0 })

    await page.getByTestId('undo').click()
    expect((await app.trip()).title).toBe('Keep me')
    expect((await app.trip()).places).toHaveLength(2)
  })
})

test.describe('share links', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  })

  const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

  test('Copy share link round-trips through a fresh page, with routes derived again', async ({ page, app, mocks }) => {
    await openRoutedTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    const trip = await app.trip()

    await chooseFromMenu(page, 'Copy share link')
    await expect(toasts(page)).toContainText('Share link copied to the clipboard.')
    const link = await clipboard(page)
    const url = new URL(link)
    expect(url.origin + url.pathname).toBe(new URL(page.url()).origin + '/')
    expect(link.length).toBeLessThan(8_000)

    // The link carries the trip, not its routes.
    const decoded = decodeShareHash(url.hash)
    expect(decoded?.trip).toEqual(trip)
    expect(decoded).not.toHaveProperty('routes')

    // A fresh page: empty storage, then the link. Leave the app first — its pagehide flush saves
    // the trip again — and clear the storage once, before the app boots on the link.
    await page.goto('about:blank')
    await page.addInitScript(() => {
      if (location.protocol === 'about:' || sessionStorage.getItem('e2e-fresh-storage')) return
      localStorage.clear()
      sessionStorage.setItem('e2e-fresh-storage', '1')
    })
    mocks.osrm.requests.length = 0
    await page.goto(link)
    await app.ready()

    expect(await app.trip()).toEqual(trip)
    await expect(toasts(page)).toContainText('Opened “My campervan trip” (3 places).')
    // The hash is gone, so a reload does not import it again ...
    expect(new URL(page.url()).hash).toBe('')
    // ... and the routes are computed (they were not in the link).
    for (const i of [0, 1]) await expect(connector(page, i)).toHaveAttribute('data-status', 'ok')
    expect(mocks.osrm.requests).toHaveLength(2)
    // Nothing of the user's was replaced, so nothing was kept.
    expect(await recentTitles(page)).toEqual([])

    await page.getByTestId('place-list').waitFor()
    await page.waitForTimeout(700) // autosave
    mocks.osrm.requests.length = 0
    await page.reload()
    await app.ready()
    expect(await app.trip()).toEqual(trip)
    await expect(toasts(page)).toHaveCount(0)
    // The autosave kept the routes: no new requests.
    for (const i of [0, 1]) await expect(connector(page, i)).toHaveAttribute('data-status', 'ok')
    expect(mocks.osrm.requests).toHaveLength(0)
  })

  test('a link replaces the open trip, which is kept and can be restored', async ({ page, app }) => {
    const mine = serializeTripFile(tripOf('Mine', 'Lyon', 'Annecy'))
    const shared = tripOf('Shared', 'Berlin', 'Prague', 'Vienna')
    await app.seedSavedTrip(mine)
    await page.goto('/' + encodeShareHash(serializeTripFile(shared)))
    await app.ready()

    expect(await app.trip()).toEqual(shared)
    const notice = toasts(page).filter({ hasText: 'Your previous trip was kept.' })
    await expect(notice).toContainText('Opened “Shared” (3 places).')
    expect(await app.history()).toEqual({ past: 0, future: 0 })
    expect((await recentEntries(page)).map((e) => e.file.trip)).toEqual([mine.trip])

    await notice.getByRole('button', { name: 'Restore previous trip' }).click()
    await expect.poll(async () => (await app.trip()).title).toBe('Mine')
    expect(await app.trip()).toEqual(mine.trip)
    await expect(toasts(page).last()).toContainText('Restored “Mine” (2 places).')
    // The link's trip took its place in the list.
    expect(await recentTitles(page)).toEqual(['Shared'])
    // The restore is an ordinary undoable step.
    await page.getByTestId('undo').click()
    expect((await app.trip()).title).toBe('Shared')
  })

  test('a second link does not cost the user their own trip: it is restored from Recent trips', async ({ page, app }) => {
    const mine = serializeTripFile(tripOf('Mine', 'Lyon', 'Annecy'))
    await app.seedSavedTrip(mine)
    await page.goto('/' + encodeShareHash(serializeTripFile(tripOf('Link A', 'Berlin', 'Prague'))))
    await app.ready()
    await expect(toasts(page)).toContainText('Opened “Link A” (2 places).')
    // The second link arrives in the open page (a link pasted into the address bar).
    await page.evaluate((hash) => (location.hash = hash), encodeShareHash(serializeTripFile(tripOf('Link B', 'Paris', 'Lyon', 'Zurich'))))
    await expect.poll(async () => (await app.trip()).title).toBe('Link B')
    expect(await recentTitles(page)).toEqual(['Link A', 'Mine'])

    await chooseFromMenu(page, 'Recent trips…')
    const dialog = page.getByRole('dialog', { name: 'Recent trips' })
    await expect(dialog.getByTestId('recent-trip')).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Restore Mine' }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(async () => (await app.trip()).title).toBe('Mine')
    expect(await app.trip()).toEqual(mine.trip)
    await expect(toasts(page).last()).toContainText('Restored “Mine” (2 places).')
    // Restoring did not lose the trip it replaced: the ring now holds Link B and Link A.
    expect(await recentTitles(page)).toEqual(['Link B', 'Link A'])
  })

  test('the same trip opened again does not push the open one into the recent trips', async ({ page, app }) => {
    const shared = tripOf('Shared', 'Berlin', 'Prague')
    await app.seedSavedTrip(serializeTripFile(shared))
    await page.goto('/' + encodeShareHash(serializeTripFile(shared)))
    await app.ready()
    await expect(toasts(page)).toContainText('Opened “Shared” (2 places).')
    expect(await recentTitles(page)).toEqual([])
    await expect(toasts(page).getByRole('button')).toHaveCount(1) // only "Dismiss"
  })

  test('a share link pasted into the open page is opened too', async ({ page, app }) => {
    await openRoutedTrip(page, app, 'Lyon', 'Annecy')
    const shared = tripOf('Pasted', 'Berlin', 'Prague')
    await page.evaluate((hash) => (location.hash = hash), encodeShareHash(serializeTripFile(shared)))
    await expect.poll(async () => (await app.trip()).title).toBe('Pasted')
    expect(new URL(page.url()).hash).toBe('')
    await expect(toasts(page).filter({ hasText: 'previous trip was kept' })).toBeVisible()
  })

  test('the link wins over a src parameter, and both leave the address', async ({ page, app }) => {
    const shared = tripOf('Linked', 'Berlin', 'Prague')
    await page.goto(`/?src=${encodeURIComponent('https://trips.example/other.json')}&keep=1${encodeShareHash(serializeTripFile(shared))}`)
    await app.ready()
    expect((await app.trip()).title).toBe('Linked')
    const url = new URL(page.url())
    expect(url.search).toBe('?keep=1')
    expect(url.hash).toBe('')
  })

  test('a damaged link shows an error, is removed from the address and changes nothing', async ({ page, app }) => {
    await app.seedSavedTrip(serializeTripFile(tripOf('Mine', 'Lyon', 'Annecy')))
    await page.goto('/#trip=N4IgbgpgTgzglgewHYgFwG0DaAGAdAFgHYBGAZjwDYAmbAVj2wA4A2AGhAA8BDEAXyA')
    await app.ready()
    await expect(toasts(page)).toContainText('Could not open the shared trip. This share link is damaged or incomplete.')
    expect(new URL(page.url()).hash).toBe('')
    expect((await app.trip()).title).toBe('Mine')
  })

  test('a very long link is copied, and the toast points to the JSON file', async ({ page, app }) => {
    await app.goto()
    // Many stops at unpredictable positions barely compress; train legs need no routing.
    const places: Place[] = Array.from({ length: 250 }, (_, i) => ({
      id: `p_${i}`,
      name: `Stop ${i}`,
      lat: 40 + ((i * 7919) % 2000) / 100,
      lng: ((i * 104729) % 2000) / 100,
      day: i,
    }))
    const legs = syncLegs(places, []).map((leg) => ({ ...leg, mode: 'train' as const }))
    await app.setTrip(createTrip({ title: 'Huge', places, legs }))

    await chooseFromMenu(page, 'Copy share link')
    await expect(toasts(page)).toContainText('very long')
    await expect(toasts(page)).toContainText('File → Save as JSON')
    expect((await clipboard(page)).length).toBeGreaterThan(8_000)
  })
})

test.describe('?src= loading', () => {
  const TRIP_URL = 'https://trips.example/gist/raw/alps.trip.json'
  const cors = { 'access-control-allow-origin': '*' }
  const openSrc = (page: Page, src: string) => page.goto(`/?src=${encodeURIComponent(src)}&keep=1`)

  test('loads a trip file from a URL, then cleans only src from the address', async ({ page, app }) => {
    const shared = tripOf('From a gist', 'Berlin', 'Prague', 'Vienna')
    await page.route(TRIP_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(serializeTripFile(shared)) }),
    )
    await openSrc(page, TRIP_URL)
    await app.ready()

    await expect.poll(async () => (await app.trip()).title).toBe('From a gist')
    expect(await app.trip()).toEqual(shared)
    await expect(toasts(page)).toContainText('Opened “From a gist” (3 places).')
    expect(new URL(page.url()).search).toBe('?keep=1')
    // The loading toast is gone.
    await expect(toasts(page).filter({ hasText: 'Loading the trip from' })).toHaveCount(0)
  })

  test('a relative address works too (the bundled sample)', async ({ page, app }) => {
    await page.goto('/?src=samples/hamburg-fjords.trip.json')
    await app.ready()
    await expect.poll(async () => (await app.trip()).places.length).toBe(12)
  })

  test('a failing server, a wrong file and a bad address each give a reason', async ({ page, app }) => {
    await page.route('https://trips.example/missing.json', (route) => route.fulfill({ status: 404, headers: cors, body: 'nope' }))
    await openSrc(page, 'https://trips.example/missing.json')
    await app.ready()
    await expect(toasts(page)).toContainText('trips.example answered with an error (404).')

    await page.route('https://trips.example/page.json', (route) =>
      route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"hello":"world"}' }),
    )
    await openSrc(page, 'https://trips.example/page.json')
    await app.ready()
    await expect(toasts(page)).toContainText('Could not open the trip from trips.example. This is not a Roadmap Overview trip file.')

    // What a server that does not allow cross-origin reads (or is unreachable) looks like to the page.
    await page.route('https://trips.example/private.json', (route) => route.abort('failed'))
    await openSrc(page, 'https://trips.example/private.json')
    await app.ready()
    await expect(toasts(page)).toContainText('Could not reach trips.example.')

    await openSrc(page, 'javascript:alert(1)')
    await app.ready()
    await expect(toasts(page)).toContainText('Only http and https addresses can be opened.')
    expect((await app.trip()).places).toHaveLength(0)
  })

  test('a trip that arrives after the user started editing is offered, not applied', async ({ page, app }) => {
    const shared = tripOf('From a gist', 'Berlin', 'Prague')
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    await page.route(TRIP_URL, async (route) => {
      await gate
      await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(serializeTripFile(shared)) })
    })
    await openSrc(page, TRIP_URL)
    await app.ready()
    await expect(toasts(page)).toContainText('Loading the trip from trips.example')
    await app.addPlaces('Lyon', 'Annecy')
    release()

    const offer = toasts(page).filter({ hasText: 'Open the linked trip “From a gist” from trips.example?' })
    await expect(offer).toBeVisible()
    expect((await app.trip()).places.map((p) => p.name)).toEqual(['Lyon', 'Annecy'])
    await expect(toasts(page).filter({ hasText: 'Loading the trip from' })).toHaveCount(0)

    await offer.getByRole('button', { name: 'Open linked trip' }).click()
    await expect.poll(async () => (await app.trip()).title).toBe('From a gist')
    // What the user had been editing is in the recent trips.
    expect(await recentTitles(page)).toEqual(['My campervan trip'])
  })
})

test.describe('drag and drop', () => {
  /** A DataTransfer holding a file, like the one a file manager drags over the page. */
  async function fileDrag(page: Page, name: string, content: string, type = 'application/json') {
    return page.evaluateHandle(
      ([n, c, t]) => {
        const dt = new DataTransfer()
        dt.items.add(new File([c], n, { type: t }))
        return dt
      },
      [name, content, type],
    )
  }

  test('a file dragged over the window shows the overlay, dropping opens it', async ({ page, app, mocks }) => {
    await app.goto()
    const shared = tripOf('Dropped', 'Berlin', 'Prague')
    const dt = await fileDrag(page, 'dropped.trip.json', JSON.stringify(serializeTripFile(shared)))
    const overlay = page.getByTestId('drop-overlay')

    await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt })
    await expect(overlay).toBeVisible()
    await expect(overlay).toContainText('Drop to open trip')
    // Moving between elements raises more enter/leave pairs; the overlay stays.
    await page.dispatchEvent('.leaflet-container', 'dragenter', { dataTransfer: dt })
    await page.dispatchEvent('body', 'dragleave', { dataTransfer: dt })
    await expect(overlay).toBeVisible()
    await page.dispatchEvent('.leaflet-container', 'dragleave', { dataTransfer: dt })
    await expect(overlay).toBeHidden()

    await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt })
    await expect(overlay).toBeVisible()
    // The browser must not navigate to the dropped file.
    const handled = await page.evaluate((transfer) => {
      const event = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
      document.body.dispatchEvent(event)
      return event.defaultPrevented
    }, dt)
    expect(handled).toBe(true)

    await expect(overlay).toBeHidden()
    await expect.poll(async () => (await app.trip()).title).toBe('Dropped')
    await expect(toasts(page)).toContainText('Opened “Dropped” (2 places).')
    await expect(connector(page, 0)).toHaveAttribute('data-status', 'ok')
    expect(mocks.osrm.requests).toHaveLength(1)
  })

  test('dragging text or a link shows nothing', async ({ page, app }) => {
    await app.goto()
    const dt = await page.evaluateHandle(() => {
      const data = new DataTransfer()
      data.setData('text/plain', 'hello')
      return data
    })
    await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt })
    await page.waitForTimeout(150)
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0)
  })

  test('a dropped file that is not a trip explains itself', async ({ page, app }) => {
    await app.goto()
    const dt = await fileDrag(page, 'holiday.json', '{"hello": "world"}')
    await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt })
    await page.dispatchEvent('body', 'drop', { dataTransfer: dt })
    await expect(toasts(page)).toContainText('Could not open holiday.json. This is not a Roadmap Overview trip file.')

    const photo = await fileDrag(page, 'photo.png', 'binary', 'image/png')
    await page.dispatchEvent('body', 'drop', { dataTransfer: photo })
    await expect(toasts(page).last()).toContainText('Could not open photo.png.')
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0)
  })
})

test.describe('sample trip', () => {
  test('the empty state loads a ready-made trip that needs no routing and fits the map', async ({ page, app, mocks }) => {
    await app.goto()
    await page.getByTestId('load-sample').click()

    await expect(page.getByTestId('place-list').getByRole('listitem')).toHaveCount(12)
    const trip = await app.trip()
    expect(trip.title).toBe('Hamburg to the Norwegian fjords')
    expect(trip.places.map((p) => p.name).slice(0, 4)).toEqual(['Hamburg', 'Aarhus', 'Hirtshals', 'Kristiansand'])
    expect(trip.legs.filter((leg) => leg.mode === 'ferry')).toHaveLength(1)

    // Every drive leg arrives with its route: all ok at once, no request to OSRM.
    await expect(page.getByTestId('leg-connector')).toHaveCount(11)
    for (let i = 0; i < 11; i++) await expect(connector(page, i)).toHaveAttribute('data-status', 'ok')
    await page.waitForTimeout(600)
    expect(mocks.osrm.requests).toHaveLength(0)
    await expect(connector(page, 2)).toContainText('Car ferry · Hirtshals → Kristiansand')
    await expect(connector(page, 2)).toContainText('3 h 15 min')
    await expect(toasts(page)).toContainText('Opened “Hamburg to the Norwegian fjords” (12 places).')

    // The map shows the whole trip.
    await app.settle()
    const allVisible = await page.evaluate(() => {
      const ro = window.__ROADMAP__!
      const bounds = ro.getMap()!.getBounds()
      return ro.trip.getState().trip.places.every((p) => bounds.contains([p.lat, p.lng]))
    })
    expect(allVisible).toBe(true)
  })

  test('the File menu loads it over a trip, and Undo brings the old trip back', async ({ page, app }) => {
    await openRoutedTrip(page, app, 'Lyon', 'Annecy')
    await chooseFromMenu(page, 'Load sample trip')
    await expect.poll(async () => (await app.trip()).places.length).toBe(12)
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    expect((await app.trip()).places.map((p) => p.name)).toEqual(['Lyon', 'Annecy'])
  })

  test('a missing sample file is reported', async ({ page, app }) => {
    await page.route('**/samples/hamburg-fjords.trip.json', (route) => route.fulfill({ status: 404, body: 'gone' }))
    await app.goto()
    await page.getByTestId('load-sample').click()
    await expect(toasts(page)).toContainText('Could not load the sample trip.')
    expect((await app.trip()).places).toHaveLength(0)
  })
})

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the File menu is an icon in the top bar and works', async ({ page, app }) => {
    await app.goto()
    const button = fileMenu(page)
    await expect(button).toBeVisible()
    await expect(button).toHaveAccessibleName('File')
    const box = (await button.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await button.click()
    await expect(page.getByRole('menuitem', { name: 'Load sample trip' })).toBeVisible()
  })
})

test.describe('recent trips', () => {
  test('every way of replacing a trip puts it in the list, newest first; the dialog restores and forgets', async ({ page, app }) => {
    await app.goto()
    await fileMenu(page).click()
    await expect(page.getByRole('menuitem', { name: 'Recent trips…' })).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')

    const openText = async (name: string, file: TripFile) => {
      const choosing = page.waitForEvent('filechooser')
      await chooseFromMenu(page, 'Open trip file…')
      await (await choosing).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
    }

    await app.setTrip(tripOf('One', 'Lyon', 'Annecy'))
    // The sample.
    await chooseFromMenu(page, 'Load sample trip')
    await expect.poll(async () => (await app.trip()).places.length).toBe(12)
    // A picked file.
    await openText('two.json', serializeTripFile(tripOf('Two', 'Berlin', 'Prague')))
    await expect.poll(async () => (await app.trip()).title).toBe('Two')
    // A dropped file.
    const dt = await page.evaluateHandle((text) => {
      const data = new DataTransfer()
      data.items.add(new File([text], 'three.trip.json', { type: 'application/json' }))
      return data
    }, JSON.stringify(serializeTripFile(tripOf('Three', 'Paris', 'Lyon'))))
    await page.dispatchEvent('body', 'drop', { dataTransfer: dt })
    await expect.poll(async () => (await app.trip()).title).toBe('Three')
    // A new trip.
    await chooseFromMenu(page, 'New trip')
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(page.getByTestId('places-empty')).toBeVisible()

    expect(await recentTitles(page)).toEqual(['Three', 'Two', 'Hamburg to the Norwegian fjords', 'One'])

    await chooseFromMenu(page, 'Recent trips…')
    const dialog = page.getByRole('dialog', { name: 'Recent trips' })
    const rows = dialog.getByTestId('recent-trip')
    await expect(rows).toHaveCount(4)
    await expect(rows.nth(0)).toContainText('Three')
    await expect(rows.nth(0)).toContainText('2 places · saved just now')
    await expect(rows.nth(2)).toContainText('Hamburg to the Norwegian fjords')
    await expect(rows.nth(2)).toContainText('12 places')

    await dialog.getByRole('button', { name: 'Forget One' }).click()
    await expect(rows).toHaveCount(3)
    expect(await recentTitles(page)).toEqual(['Three', 'Two', 'Hamburg to the Norwegian fjords'])

    // Restoring puts the open (here: empty) trip nowhere, and takes the restored one out of the list.
    await dialog.getByRole('button', { name: 'Restore Two' }).click()
    await expect.poll(async () => (await app.trip()).title).toBe('Two')
    expect(await recentTitles(page)).toEqual(['Three', 'Hamburg to the Norwegian fjords'])
  })

  test('the list survives a reload and ignores damaged entries', async ({ page, app }) => {
    const good = { id: 'r_good', savedAt: Date.now() - 2 * 3_600_000, file: serializeTripFile(tripOf('Kept', 'Lyon', 'Annecy', 'Zurich')) }
    await app.seedRawStorage(
      STORAGE_KEYS.recent,
      JSON.stringify([{ id: 'r_bad', savedAt: 1, file: { format: 'nope' } }, 'junk', good]),
    )
    await app.goto()
    await chooseFromMenu(page, 'Recent trips…')
    const rows = page.getByRole('dialog', { name: 'Recent trips' }).getByTestId('recent-trip')
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Kept')
    await expect(rows).toContainText('3 places · saved 2 h ago')
  })
})

test.describe('when the recent trips cannot be stored', () => {
  // A full quota for the recent trips only: autosave of the open trip keeps working.
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key.endsWith(':recent')) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        return original.call(this, key, value)
      }
    })
  })

  test('a link does not replace the open trip by itself: a toast asks', async ({ page, app }) => {
    const mine = serializeTripFile(tripOf('Mine', 'Lyon', 'Annecy'))
    await app.seedSavedTrip(mine)
    await page.goto('/' + encodeShareHash(serializeTripFile(tripOf('Shared', 'Berlin', 'Prague'))))
    await app.ready()

    const ask = toasts(page).filter({ hasText: 'no room to keep a copy of your open trip' })
    await expect(ask).toContainText('“Shared”')
    expect(await app.trip()).toEqual(mine.trip)
    expect(new URL(page.url()).hash).toBe('')

    await ask.getByRole('button', { name: 'Open linked trip anyway' }).click()
    await expect.poll(async () => (await app.trip()).title).toBe('Shared')
  })

  test('opening a file asks first; Cancel leaves the trip, Replace opens the file', async ({ page, app }) => {
    await openRoutedTrip(page, app, 'Lyon', 'Annecy')
    const before = await app.trip()
    const file = serializeTripFile(tripOf('Other', 'Berlin', 'Prague'))
    const open = async () => {
      const choosing = page.waitForEvent('filechooser')
      await chooseFromMenu(page, 'Open trip file…')
      await (await choosing).setFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
    }

    await open()
    const dialog = page.getByRole('dialog', { name: 'Replace the open trip?' })
    await expect(dialog).toContainText('no room to keep a copy of “My campervan trip”')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(await app.trip()).toEqual(before)
    await expect(toasts(page).filter({ hasText: 'Opened' })).toHaveCount(0)

    await open()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect.poll(async () => (await app.trip()).title).toBe('Other')
    await expect(toasts(page)).toContainText('Opened “Other” (2 places).')
  })
})
