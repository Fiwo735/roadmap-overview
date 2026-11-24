import type { Page } from '@playwright/test'
import { expect, test, type App } from './fixtures'
import { makePng } from './mocks/images'
import { addPictures, card, clickMarker, fileDrag, fitTrip, thumbs, toasts, viewer } from './photoHelpers'

/** Lyon (a note, three photos, captions on two) and Annecy (nothing), dated, the map fitted to both. */
async function tripWithPhotos(page: Page, app: App) {
  await app.goto()
  const [lyon] = await app.addPlaces('Lyon', 'Annecy')
  await page.evaluate((id) => {
    const store = window.__ROADMAP__!.trip.getState()
    store.setStartDate('2026-07-14')
    store.updatePlace(id, { note: 'Market on Sunday. Park by the river.' })
  }, lyon)
  await addPictures(page, 0, 3)
  await page.evaluate((id) => {
    const store = window.__ROADMAP__!.trip.getState()
    const photos = store.trip.places[0].photos!
    store.updatePlace(id, { photos: photos.map((p, i) => (i === 2 ? p : { ...p, caption: `Caption ${i + 1}` })) })
  }, lyon)
  await fitTrip(page, app)
}

test.describe('the place card', () => {
  test('nothing about photos shows on the map until a place is clicked', async ({ page, app }) => {
    await tripWithPhotos(page, app)
    await expect(card(page)).toHaveCount(0)
    await expect(page.locator('.map-area img[src^="blob:"]')).toHaveCount(0)
    // Selecting the place in the list does not open the card: only a click on the map does.
    await page.getByTestId('place-item').nth(0).getByTestId('place-main').click()
    await page.getByTestId('place-item').nth(0).getByTestId('place-main').click()
    await expect(card(page)).toHaveCount(0)
    await clickMarker(page, app, 0)
    await expect(card(page)).toBeVisible()
    await expect(page.locator('.map-area img[src^="blob:"]')).toHaveCount(3)
  })

  test('shows name, day and date, note and thumbnails, follows its marker and closes in the usual ways', async ({ page, app }) => {
    await tripWithPhotos(page, app)
    await clickMarker(page, app, 0)
    await expect(card(page)).toBeVisible()
    await expect(page.getByTestId('place-card-name')).toHaveText('Lyon')
    await expect(page.getByTestId('place-card-when')).toHaveText('Day 0 · Tue 14 Jul 2026')
    await expect(page.getByTestId('place-card-note')).toHaveText('Market on Sunday. Park by the river.')
    await expect(page.getByTestId('place-card-thumb')).toHaveCount(3)
    // The label of the place does not repeat the note while its card is open.
    await expect(page.locator('.leaflet-tooltip.place-label.is-carded .place-label__note')).toBeHidden()

    // Anchored to its marker: just above it, horizontally around it.
    const place = (await app.trip()).places[0]
    const at = await app.screenPoint(place.lat, place.lng)
    const box = (await card(page).boundingBox())!
    expect(box.y + box.height).toBeLessThan(at.y)
    expect(box.y + box.height).toBeGreaterThan(at.y - 60)
    expect(Math.abs(box.x + box.width / 2 - at.x)).toBeLessThan(box.width / 2)

    // It follows the marker when the map is dragged.
    await page.mouse.move(at.x + 250, at.y + 150)
    await page.mouse.down()
    await page.mouse.move(at.x + 330, at.y + 190, { steps: 5 })
    await page.mouse.up()
    const moved = await app.screenPoint(place.lat, place.lng)
    expect(moved.x).toBeGreaterThan(at.x + 40)
    const box2 = (await card(page).boundingBox())!
    expect(box2.y + box2.height).toBeLessThan(moved.y)
    expect(Math.abs(box2.x + box2.width / 2 - moved.x)).toBeLessThan(box2.width / 2)

    // The X, Escape, another place being clicked and a click on the empty map all end it.
    await page.getByTestId('place-card-close').click()
    await expect(card(page)).toHaveCount(0)
    await fitTrip(page, app)
    await clickMarker(page, app, 0)
    await expect(card(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(card(page)).toHaveCount(0)
    await clickMarker(page, app, 0)
    await expect(card(page)).toBeVisible()
    await clickMarker(page, app, 1)
    await expect(page.getByTestId('place-card-name')).toHaveText('Annecy')
    await expect(page.getByTestId('place-card-when')).toHaveText('Day 1 · Wed 15 Jul 2026')
    // Annecy has neither note nor photos: just its name and day.
    await expect(page.getByTestId('place-card-note')).toHaveCount(0)
    await expect(page.getByTestId('place-card-photos')).toHaveCount(0)
    const lyon = await app.screenPoint(place.lat, place.lng)
    await page.mouse.click(lyon.x + 120, lyon.y + 120)
    await expect(card(page)).toHaveCount(0)
  })

  test('Enter on a focused marker opens the card and moves the focus into it; closing it gives the focus back', async ({ page, app }) => {
    await tripWithPhotos(page, app)
    const marker = page.locator('.place-marker').first()
    await marker.focus()
    await page.keyboard.press('Enter')
    await expect(card(page)).toBeVisible()
    await expect(page.getByTestId('place-card-close')).toBeFocused()
    // Tab reaches the thumbnails, Enter opens the viewer, Escape twice puts everything back.
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('place-card-thumb').first()).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(viewer(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
    await expect(page.getByTestId('place-card-thumb').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(card(page)).toHaveCount(0)
    await expect(marker).toBeFocused()
  })

  test('a trip without a start date shows the day only; deleting the place closes its card', async ({ page, app }) => {
    await tripWithPhotos(page, app)
    await page.evaluate(() => window.__ROADMAP__!.trip.getState().setStartDate(undefined))
    await clickMarker(page, app, 1)
    await expect(page.getByTestId('place-card-when')).toHaveText('Day 1')
    await page.evaluate(() => {
      const store = window.__ROADMAP__!.trip.getState()
      store.removePlace(store.trip.places[1].id)
    })
    await expect(card(page)).toHaveCount(0)
  })

  test('a card with more than eight photos shows eight thumbnails, the last one says how many more', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await addPictures(page, 0, 5)
    // Nine references: the five photos and four more ids with copies of the first four stored bytes.
    await page.evaluate(async () => {
      const trip = window.__ROADMAP__!.trip.getState()
      const place = trip.trip.places[0]
      const open = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('roadmap-overview')
        r.onsuccess = () => resolve(r.result)
      })
      const copies: string[] = []
      for (const [n, photo] of place.photos!.slice(0, 4).entries()) {
        const record = await new Promise<Record<string, unknown>>((resolve) => {
          const r = open.transaction('photos').objectStore('photos').get(photo.id)
          r.onsuccess = () => resolve(r.result)
        })
        const tx = open.transaction('photos', 'readwrite')
        tx.objectStore('photos').put({ ...record, id: `ph_copy${n}` })
        await new Promise((resolve) => (tx.oncomplete = resolve))
        copies.push(`ph_copy${n}`)
      }
      trip.updatePlace(place.id, { photos: [...place.photos!, ...copies.map((id) => ({ id, width: 120, height: 80 }))] })
    })
    expect((await app.trip()).places[0].photos).toHaveLength(9)
    await fitTrip(page, app)
    await clickMarker(page, app, 0)
    await expect(page.getByTestId('place-card-thumb')).toHaveCount(8)
    await expect(page.getByTestId('place-card-more')).toHaveText('+2')
    // The viewer still has all nine.
    await page.getByTestId('place-card-thumb').last().click()
    await expect(page.getByTestId('photo-viewer-count')).toHaveText('8 / 9')
  })

  test('a place whose photos this browser does not have shows placeholders, not broken images', async ({ page, app }) => {
    await app.goto()
    const [id] = await app.addPlaces('Lyon')
    await page.evaluate((placeId) => {
      window.__ROADMAP__!.trip.getState().updatePlace(placeId, { photos: [{ id: 'ph_gone', width: 400, height: 300 }] })
    }, id)
    await fitTrip(page, app)
    await clickMarker(page, app, 0)
    await expect(card(page).getByRole('img', { name: 'Photo not available' })).toBeVisible()
    await page.getByTestId('place-card-thumb').click()
    await expect(viewer(page).getByRole('img', { name: 'Photo not available' }).first()).toBeVisible()
  })

  test('the card does not open during a ride', async ({ page, app }) => {
    await tripWithPhotos(page, app)
    await expect(page.getByTestId('leg-connector').first()).toHaveAttribute('data-status', 'ok')
    await page.getByTestId('ride-button').click()
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    const place = (await app.trip()).places[0]
    const at = await app.screenPoint(place.lat, place.lng)
    await page.mouse.click(at.x, at.y)
    await expect(card(page)).toHaveCount(0)
  })
})

test.describe('the place card on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('stays clear of the trip pill and the map tools at the top, and inside the map', async ({ page, app }) => {
    await app.goto()
    const [lyon] = await app.addPlaces('Lyon', 'Annecy')
    await page.evaluate((id) => {
      window.__ROADMAP__!.trip.getState().updatePlace(id, { note: 'Market on Sunday. Park by the river.' })
    }, lyon)
    await page.evaluate(() => {
      // Photos need no bytes for a card to be as tall as it is with them.
      const store = window.__ROADMAP__!.trip.getState()
      store.updatePlace(store.trip.places[0].id, { photos: Array.from({ length: 4 }, (_, i) => ({ id: `ph_x${i}`, width: 40, height: 30 })) })
    })
    await expect(page.getByTestId('trip-pill')).toBeVisible()
    // Put Lyon high up in the map, where a card above it would still fit on the map but not under the pill.
    await page.evaluate((id) => {
      const map = window.__ROADMAP__!.getMap()!
      const place = window.__ROADMAP__!.trip.getState().trip.places.find((p) => p.id === id)!
      map.setView([place.lat, place.lng], 9, { animate: false })
      const at = map.latLngToContainerPoint([place.lat, place.lng])
      map.panBy([0, at.y - 220], { animate: false })
    }, lyon)
    await app.settle()
    await clickMarker(page, app, 0)
    await expect(card(page)).toBeVisible()

    const pill = (await page.getByTestId('trip-pill').boundingBox())!
    const tools = (await page.locator('.map-slot--top-right').boundingBox())!
    const box = (await card(page).boundingBox())!
    const map = (await page.getByTestId('map-area').boundingBox())!
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    expect(overlaps(box, pill)).toBe(false)
    expect(overlaps(box, tools)).toBe(false)
    expect(box.x).toBeGreaterThanOrEqual(map.x)
    expect(box.x + box.width).toBeLessThanOrEqual(map.x + map.width)
    expect(box.y + box.height).toBeLessThanOrEqual(map.y + map.height)
    // It went below the marker instead.
    const place = (await app.trip()).places[0]
    const at = await app.screenPoint(place.lat, place.lng)
    expect(box.y).toBeGreaterThan(at.y)
  })
})

test.describe('the photo viewer', () => {
  test('a thumbnail opens it: caption, counter, previous/next, arrow keys, swipe, Escape', async ({ page, app }) => {
    await tripWithPhotos(page, app)
    await clickMarker(page, app, 0)
    await page.getByTestId('place-card-thumb').nth(1).click()
    await expect(viewer(page)).toBeVisible()
    await expect(page.getByTestId('photo-viewer-count')).toHaveText('2 / 3')
    await expect(page.getByTestId('photo-viewer-caption')).toHaveText('Caption 2')
    await expect(page.getByTestId('photo-viewer-title')).toHaveText('Lyon')
    // The big picture is on screen, loaded from the stored bytes.
    await expect(viewer(page).locator('img.lightbox__image:not(.lightbox__image--thumb)')).toBeVisible()

    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('photo-viewer-count')).toHaveText('3 / 3')
    // No caption on the third photo; the next button has nowhere to go.
    await expect(page.getByTestId('photo-viewer-caption')).toHaveCount(0)
    await expect(page.getByTestId('photo-viewer-next')).toBeDisabled()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('photo-viewer-count')).toHaveText('3 / 3')
    await page.getByTestId('photo-viewer-prev').click()
    await expect(page.getByTestId('photo-viewer-count')).toHaveText('2 / 3')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('photo-viewer-count')).toHaveText('1 / 3')
    await expect(page.getByTestId('photo-viewer-prev')).toBeDisabled()

    // A swipe to the left shows the next one, to the right the previous one; a tiny drag does nothing.
    const stage = (await page.getByTestId('photo-viewer-stage').boundingBox())!
    const y = stage.y + stage.height / 2
    const drag = async (from: number, to: number) => {
      await page.mouse.move(stage.x + stage.width * from, y)
      await page.mouse.down()
      await page.mouse.move(stage.x + stage.width * to, y + 8, { steps: 6 })
      await page.mouse.up()
    }
    await drag(0.7, 0.3)
    await expect(page.getByTestId('photo-viewer-count')).toHaveText('2 / 3')
    await drag(0.3, 0.7)
    await expect(page.getByTestId('photo-viewer-count')).toHaveText('1 / 3')
    await drag(0.5, 0.49)
    await expect(page.getByTestId('photo-viewer-count')).toHaveText('1 / 3')

    // Escape closes the viewer and leaves the card; a second Escape closes the card.
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
    await expect(card(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(card(page)).toHaveCount(0)

    // The ✕ closes it as well, and so does a click on the dark area beside the picture.
    await clickMarker(page, app, 0)
    await page.getByTestId('place-card-thumb').first().click()
    await page.getByTestId('photo-viewer-close').click()
    await expect(viewer(page)).toHaveCount(0)
    await page.getByTestId('place-card-thumb').first().click()
    await page.mouse.click(stage.x + 8, stage.y + 8)
    await expect(viewer(page)).toHaveCount(0)
  })
})

test.describe('presentation mode', () => {
  test('shows the card and the photos, and offers no way to change them', async ({ page, app }) => {
    await tripWithPhotos(page, app)
    await page.getByTestId('present-toggle').click()
    await expect(page.getByTestId('sidebar')).toBeHidden()
    // The map is fitted again to the wider area once the sidebar is gone: click until the marker is where it ends up.
    await expect(async () => {
      await app.settle()
      await clickMarker(page, app, 0)
      await expect(card(page)).toBeVisible({ timeout: 1_500 })
    }).toPass()
    await expect(page.getByTestId('place-card-thumb')).toHaveCount(3)
    await page.getByTestId('place-card-thumb').first().click()
    await expect(viewer(page)).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('photo-viewer-count')).toHaveText('2 / 3')
    // Escape peels one layer at a time: viewer, card, presentation mode.
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
    await expect(page.getByTestId('sidebar')).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(card(page)).toHaveCount(0)
    await expect(page.getByTestId('sidebar')).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('sidebar')).toBeVisible()

    // Presenting again: no editing surface, and a dropped picture is refused with the reason.
    await page.getByTestId('present-toggle').click()
    await expect(page.getByTestId('place-photos')).toHaveCount(0)
    const before = (await app.trip()).places[0].photos
    const dt = await fileDrag(page, [{ name: 'late.png', type: 'image/png', buffer: makePng(40, 30) }])
    await page.dispatchEvent('body', 'drop', { dataTransfer: dt })
    await expect(toasts(page).last()).toContainText('Leave presentation mode')
    expect((await app.trip()).places[0].photos).toEqual(before)
    await expect(thumbs(page)).toHaveCount(0)
  })
})
