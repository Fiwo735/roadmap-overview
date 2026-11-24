import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
// Loads the typing of `window.__ROADMAP__.photos`.
import type {} from '../src/features/photos/photoGc'
import type { TripFile } from '../src/types/trip'
import { expect, STORAGE_KEYS, test } from './fixtures'
import { makeJpeg } from './mocks/images'
import { addPictures, card, clickMarker, fitTrip, row, seedStored, storedIds, storedMarks, toasts, viewer } from './photoHelpers'

// lz-string is a CommonJS package: Node's ESM loader only exposes it through require.
const lz = createRequire(import.meta.url)('lz-string') as typeof import('lz-string')

/** Save through the File menu; the download and the text of the file. */
async function save(page: Page) {
  const downloading = page.waitForEvent('download')
  await page.getByTestId('file-menu').click()
  await page.getByRole('menuitem', { name: 'Save as JSON' }).click()
  const download = await downloading
  return { download, text: await readFile((await download.path())!, 'utf8') }
}

/** Open a trip file through the File menu. */
async function openFile(page: Page, path: string) {
  await page.getByTestId('file-menu').click()
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Open trip file…' }).click()
  await (await choosing).setFiles(path)
}

/** Forget everything this browser stored (photos included): what opening a file on another computer is like. */
async function startAfresh(page: Page) {
  // The page's own autosave must have run, or its pagehide flush would write the trip back.
  await expect.poll(async () => (await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEYS.trip))?.includes('"photos"') ?? false).toBe(true)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('roadmap-overview')
        request.onsuccess = () => resolve()
        request.onerror = () => resolve()
        request.onblocked = () => resolve()
      }),
  )
  await page.goto('about:blank')
  await page.addInitScript(() => {
    if (location.protocol === 'about:' || sessionStorage.getItem('e2e-fresh-storage')) return
    localStorage.clear()
    sessionStorage.setItem('e2e-fresh-storage', '1')
  })
}

test.describe('saving, opening and sharing', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  })

  test('Save as JSON embeds the photos; opening the file in a browser that has none restores them', async ({ page, app }, testInfo) => {
    await app.goto()
    const [lyon] = await app.addPlaces('Lyon', 'Annecy')
    await addPictures(page, 0, 3)
    await page.evaluate((id) => {
      const store = window.__ROADMAP__!.trip.getState()
      const photos = store.trip.places[0].photos!
      store.updatePlace(id, { photos: photos.map((p, i) => (i === 1 ? { ...p, caption: 'Second' } : p)) })
    }, lyon)
    const trip = await app.trip()
    const photos = trip.places[0].photos!

    const { download, text } = await save(page)
    const file = JSON.parse(text) as TripFile
    expect(Object.keys(file.photos!)).toEqual(photos.map((p) => p.id))
    for (const photo of photos) {
      const embedded = file.photos![photo.id]
      expect(embedded.mime).toBe('image/jpeg')
      expect([embedded.width, embedded.height]).toEqual([photo.width, photo.height])
      // A JPEG: FF D8 FF at the start.
      expect(Buffer.from(embedded.data, 'base64').subarray(0, 3).toString('hex')).toBe('ffd8ff')
    }
    // The trip itself holds references only, and the file is still pretty-printed JSON.
    expect(file.trip.places[0].photos).toEqual(photos)
    expect(text).toContain('\n  "photos": {')
    await expect(toasts(page)).toContainText('Saved')
    const path = testInfo.outputPath('with-photos.trip.json')
    await download.saveAs(path)

    // What the autosave keeps is references only: the bytes are in IndexedDB.
    const autosaved = await page.evaluate((k) => localStorage.getItem(k)!, STORAGE_KEYS.trip)
    expect(autosaved).not.toContain('/9j/')

    await startAfresh(page)
    await page.goto('/')
    await app.ready()
    expect((await app.trip()).places).toHaveLength(0)
    expect(await storedIds(page)).toEqual([])

    await openFile(page, path)
    await expect(page.getByTestId('place-list').getByRole('listitem')).toHaveCount(2)
    await expect(toasts(page).last()).toContainText('Opened')
    await expect(toasts(page).last()).not.toContainText('problems')
    expect((await app.trip()).places[0].photos).toEqual(photos)
    expect((await storedIds(page)).sort()).toEqual(photos.map((p) => p.id).sort())
    // One undoable step, as every open.
    expect((await app.history()).past).toBe(1)

    // The photos work: the row's count, the card on the map, the viewer.
    await expect(row(page, 0).getByTestId('place-photos-indicator')).toContainText('3')
    await fitTrip(page, app)
    await clickMarker(page, app, 0)
    await expect(page.getByTestId('place-card-thumb')).toHaveCount(3)
    await page.getByTestId('place-card-thumb').nth(1).click()
    await expect(page.getByTestId('photo-viewer-caption')).toHaveText('Second')
    await expect(viewer(page).locator('img.lightbox__image:not(.lightbox__image--thumb)')).toBeVisible()
    await page.keyboard.press('Escape')

    // They survive a reload, which restores the trip from the autosave and the photos from IndexedDB.
    await page.reload()
    await app.ready()
    await expect(row(page, 0).getByTestId('place-photos-indicator')).toContainText('3')
    await fitTrip(page, app)
    await clickMarker(page, app, 0)
    await expect(page.getByTestId('place-card-thumb').first().locator('img')).toBeVisible()
  })

  test('damaged and missing photos in a file are dropped with a note; the trip still opens', async ({ page, app }, testInfo) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await addPictures(page, 0, 2)
    const { text } = await save(page)
    const file = JSON.parse(text) as TripFile
    const [a, b] = Object.keys(file.photos!)
    // One photo is damaged (not a JPEG any more), one is not in the file at all, and a stranger is added.
    file.photos![a] = { ...file.photos![a], data: 'AAAAAAAA' }
    delete file.photos![b]
    file.photos!.ph_stranger = { ...file.photos![a], data: '/9j/AAAA' }
    const path = testInfo.outputPath('damaged.trip.json')
    await writeFile(path, JSON.stringify(file))

    await startAfresh(page)
    await page.goto('/')
    await app.ready()
    await openFile(page, path)
    await expect(page.getByTestId('place-list').getByRole('listitem')).toHaveCount(1)
    await expect(toasts(page).last()).toContainText('problems that were repaired')
    // Neither photo could be used, so the place keeps no references to nothing.
    expect((await app.trip()).places[0].photos).toBeUndefined()
    expect(await storedIds(page)).toEqual([])
  })

  test('a photo whose bytes cannot be read is left out of the saved file, with a warning; the file is still saved', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await addPictures(page, 0, 3)
    const photos = (await app.trip()).places[0].photos!
    // The browser fails to read one stored photo (a damaged disk, a revoked blob): the first read of a photo's bytes rejects.
    await page.evaluate(() => {
      const original = Blob.prototype.arrayBuffer
      let failed = false
      Blob.prototype.arrayBuffer = function (this: Blob) {
        if (!failed) {
          failed = true
          return Promise.reject(new DOMException('The requested file could not be read', 'NotReadableError'))
        }
        return original.call(this)
      }
    })
    const { text } = await save(page)
    const file = JSON.parse(text) as TripFile
    // Two of the three are in the file, with their references; the unreadable one is in neither.
    expect(Object.keys(file.photos!)).toEqual([photos[1].id, photos[2].id])
    expect(file.trip.places[0].photos?.map((p) => p.id)).toEqual([photos[1].id, photos[2].id])
    await expect(toasts(page).filter({ hasText: 'Saved' })).toBeVisible()
    await expect(toasts(page).filter({ hasText: '1 photo could not be read from this browser and was left out of the file.' })).toBeVisible()
    // The trip in the browser is untouched.
    expect((await app.trip()).places[0].photos).toEqual(photos)
  })

  test('a file whose embedded photo is bigger than the app makes them is shrunk when opened, and the references say what is stored', async ({ page, app }, testInfo) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await addPictures(page, 0, 1)
    const { text } = await save(page)
    const file = JSON.parse(text) as TripFile
    const [id] = Object.keys(file.photos!)
    // A 4000 x 3000 JPEG that claims to be 120 x 80.
    const big = await makeJpeg(page, 4000, 3000)
    file.photos![id] = { mime: 'image/jpeg', data: big.toString('base64'), width: 120, height: 80 }
    // And one whose header declares 30000 x 30000 pixels: refused before anything is decoded.
    const bomb = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x75, 0x30, 0x75, 0x30, 0x01, 0x01, 0x11, 0x00]), Buffer.alloc(32, 7)])
    file.photos!.ph_bomb = { mime: 'image/jpeg', data: bomb.toString('base64'), width: 120, height: 80 }
    file.trip.places[0].photos!.push({ id: 'ph_bomb', width: 120, height: 80 })
    const path = testInfo.outputPath('big.trip.json')
    await writeFile(path, JSON.stringify(file))

    await startAfresh(page)
    await page.goto('/')
    await app.ready()
    await openFile(page, path)
    await expect(page.getByTestId('place-list').getByRole('listitem')).toHaveCount(1)
    await expect(toasts(page).last()).toContainText('1 photo in the file was damaged or too large and was left out.')
    const refs = (await app.trip()).places[0].photos!
    expect(refs).toEqual([{ id, width: 2048, height: 1536 }])
    const stored = await page.evaluate(async (photoId) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('roadmap-overview')
        r.onsuccess = () => resolve(r.result)
      })
      const record = await new Promise<{ blob: Blob; thumb: Blob; width: number; height: number }>((resolve) => {
        const r = db.transaction('photos').objectStore('photos').get(photoId)
        r.onsuccess = () => resolve(r.result)
      })
      const bitmap = await createImageBitmap(record.blob)
      return { w: bitmap.width, h: bitmap.height, recorded: [record.width, record.height] }
    }, id)
    expect(stored).toEqual({ w: 2048, h: 1536, recorded: [2048, 1536] })
    expect(await storedIds(page)).toEqual([id])
  })

  test('a share link carries no photos, and says so', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await addPictures(page, 0, 2)
    await page.getByTestId('file-menu').click()
    await page.getByRole('menuitem', { name: 'Copy share link' }).click()
    await expect(toasts(page).last()).toContainText('Share link copied to the clipboard.')
    await expect(toasts(page).last()).toContainText('Photos are not part of links')
    const link = await page.evaluate(() => navigator.clipboard.readText())
    const text = lz.decompressFromEncodedURIComponent(new URL(link).hash.replace(/^#trip=/, ''))!
    expect(text).not.toContain('photos')
    expect(text).not.toContain('/9j/')
    const decoded = JSON.parse(text) as TripFile
    expect(decoded.trip.places).toHaveLength(2)
    expect(decoded.trip.places[0].photos).toBeUndefined()
    // The open trip keeps its photos.
    expect((await app.trip()).places[0].photos).toHaveLength(2)

    // A presentation link says it too; a trip without photos needs no remark.
    await page.getByTestId('file-menu').click()
    await page.getByRole('menuitem', { name: 'Copy presentation link' }).click()
    await expect(toasts(page).last()).toContainText('Presentation link copied')
    await expect(toasts(page).last()).toContainText('Photos are not part of links')
    await page.evaluate(() => {
      const store = window.__ROADMAP__!.trip.getState()
      store.updatePlace(store.trip.places[0].id, { photos: undefined })
    })
    await page.getByTestId('file-menu').click()
    await page.getByRole('menuitem', { name: 'Copy share link' }).click()
    await expect(toasts(page).last()).toContainText('Share link copied to the clipboard.')
    await expect(toasts(page).last()).not.toContainText('Photos')
  })
})

test.describe('storage upkeep', () => {
  const DAY = 24 * 3_600_000

  test('unreferenced photos are only marked at first, and deleted a week later; what is in use is never touched', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await addPictures(page, 0, 2)
    const kept = (await app.trip()).places[0].photos!.map((p) => p.id)
    const old = Date.now() - 30 * DAY
    for (const id of ['ph_orphan', 'ph_in_recent', 'ph_in_history', 'ph_used_again']) await seedStored(page, id, old)
    // One is only in a recent trip, one only in an undo step of this session, one was marked but is in use again.
    await page.evaluate(
      ([recent, history]) => {
        const trip = window.__ROADMAP__!.trip
        const place = trip.getState().trip.places[1]
        // A step that refers to it, then one that does not: the first stays in the history.
        trip.getState().updatePlace(place.id, { photos: [{ id: history, width: 8, height: 8 }] })
        trip.getState().updatePlace(place.id, { photos: undefined })
        const entry = {
          id: 'r_test',
          savedAt: Date.now(),
          file: {
            format: 'roadmap-overview/trip',
            version: 1,
            exportedAt: new Date().toISOString(),
            trip: { id: 't_old', title: 'Old trip', places: [{ id: 'p_old', name: 'X', lat: 1, lng: 1, day: 0, photos: [{ id: recent, width: 8, height: 8 }] }], legs: [] },
          },
        }
        localStorage.setItem('roadmap-overview:v1:recent', JSON.stringify([entry]))
      },
      ['ph_in_recent', 'ph_in_history'] as const,
    )
    await seedStored(page, 'ph_used_again', old, old)
    await page.evaluate((id) => {
      const store = window.__ROADMAP__!.trip.getState()
      store.updatePlace(store.trip.places[1].id, { photos: [{ id, width: 8, height: 8 }] })
    }, 'ph_used_again')
    const all = [...kept, 'ph_in_history', 'ph_in_recent', 'ph_orphan', 'ph_used_again'].sort()
    expect((await storedIds(page)).sort()).toEqual(all)

    // The first sweep deletes nothing: it marks the one photo that nothing refers to, and clears the mark of the one in use again.
    expect(await page.evaluate(() => window.__ROADMAP__!.photos!.collectGarbage())).toBe(0)
    expect((await storedIds(page)).sort()).toEqual(all)
    expect(Object.keys(await storedMarks(page))).toEqual(['ph_orphan'])

    // A week later the orphan goes; the open trip, the undo history, the recent trip and the photo in use stay.
    const deleted = await page.evaluate((later) => window.__ROADMAP__!.photos!.collectGarbage({ now: later }), Date.now() + 8 * DAY)
    expect(deleted).toBe(1)
    expect((await storedIds(page)).sort()).toEqual(all.filter((id) => id !== 'ph_orphan'))
    expect(await storedMarks(page)).toEqual({})
    // Undo still finds its photo.
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    expect((await app.trip()).places[1].photos?.[0].id).toBe('ph_in_history')
  })

  test('start-up marks what no trip refers to and collects what has been unreferenced for a week', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await addPictures(page, 0, 1)
    const used = (await app.trip()).places[0].photos![0].id
    await seedStored(page, 'ph_long_forgotten', Date.now() - 30 * DAY, Date.now() - 8 * DAY)
    await seedStored(page, 'ph_forgotten_lately', Date.now() - 30 * DAY)
    await expect.poll(async () => (await app.savedFile())?.trip.places[0].photos?.length).toBe(1)
    await page.reload()
    await app.ready()
    // The sweep runs a few seconds after start-up.
    await expect.poll(() => storedIds(page), { timeout: 20_000 }).not.toContain('ph_long_forgotten')
    expect((await storedIds(page)).sort()).toEqual([used, 'ph_forgotten_lately'].sort())
    expect(Object.keys(await storedMarks(page))).toEqual(['ph_forgotten_lately'])
  })

  test('photos of a trip that something replaced stay in Recent trips and come back with it', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await addPictures(page, 0, 2)
    const photos = (await app.trip()).places[0].photos!
    // File → New trip puts the open trip in the recent list.
    await page.getByTestId('file-menu').click()
    await page.getByRole('menuitem', { name: 'New trip' }).click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(page.getByTestId('places-empty')).toBeVisible()
    const recent = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!) as { file: TripFile }[], STORAGE_KEYS.recent)
    expect(recent[0].file.trip.places[0].photos).toEqual(photos)
    expect(JSON.stringify(recent)).not.toContain('/9j/')

    // Even sweeps a month apart leave them alone.
    await page.evaluate(() => window.__ROADMAP__!.photos!.collectGarbage())
    await page.evaluate((later) => window.__ROADMAP__!.photos!.collectGarbage({ now: later }), Date.now() + 30 * DAY)
    expect((await storedIds(page)).sort()).toEqual(photos.map((p) => p.id).sort())

    await page.getByTestId('file-menu').click()
    await page.getByRole('menuitem', { name: 'Recent trips…' }).click()
    await page.getByRole('button', { name: /Restore/ }).first().click()
    await expect(row(page, 0).getByTestId('place-photos-indicator')).toContainText('2')
    await fitTrip(page, app)
    await clickMarker(page, app, 0)
    await expect(card(page)).toBeVisible()
    await expect(page.getByTestId('place-card-thumb').first().locator('img')).toBeVisible()
  })
})
