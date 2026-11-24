import { expect, test } from './fixtures'
import { addPictures, expand, fileDrag, row, thumbs, toasts } from './photoHelpers'
import { asFile, makeJpeg, makePng, withExifOrientation } from './mocks/images'

test.describe('adding photos', () => {
  test('files picked in the expanded row become thumbnails, as ONE undo step', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await expand(page, 0)
    await expect(page.getByTestId('place-photos')).toContainText('No photos yet')
    const start = (await app.history()).past

    await page.getByTestId('photo-input').setInputFiles([
      asFile('one.png', makePng(120, 80), 'image/png'),
      asFile('two.png', makePng(80, 120, [30, 90, 200]), 'image/png'),
      asFile('three.png', makePng(100, 100, [20, 150, 80]), 'image/png'),
    ])
    await expect(thumbs(page)).toHaveCount(3)
    await expect(page.getByTestId('photo-count')).toHaveText('3')
    const photos = (await app.trip()).places[0].photos!
    expect(photos).toHaveLength(3)
    expect(photos.map((p) => [p.width, p.height])).toEqual([
      [120, 80],
      [80, 120],
      [100, 100],
    ])
    expect((await app.history()).past).toBe(start + 1)
    // The collapsed row says how many there are.
    await row(page, 0).getByTestId('place-main').click()
    await expect(row(page, 0).getByTestId('place-photos-indicator')).toContainText('3')

    // Undo takes the whole batch away, redo brings it back (the bytes are still stored).
    await page.keyboard.press('Control+z')
    expect((await app.trip()).places[0].photos).toBeUndefined()
    await expect(row(page, 0).getByTestId('place-photos-indicator')).toHaveCount(0)
    await page.keyboard.press('Control+Shift+z')
    expect((await app.trip()).places[0].photos).toHaveLength(3)
    await expand(page, 0)
    await expect(thumbs(page)).toHaveCount(3)
    await expect(thumbs(page).first().locator('img')).toBeVisible()
  })

  test('large pictures are shrunk to 2048 px and EXIF orientation is applied', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await expand(page, 0)
    const big = await makeJpeg(page, 3000, 1500)
    // 40 x 20 pixels stored sideways: a phone held upright. The picture must come out 20 x 40.
    const sideways = withExifOrientation(await makeJpeg(page, 40, 20, '#cc2222', '#2222cc'), 6)
    await page.getByTestId('photo-input').setInputFiles([asFile('big.jpg', big, 'image/jpeg'), asFile('phone.jpg', sideways, 'image/jpeg')])
    await expect(thumbs(page)).toHaveCount(2)
    const photos = (await app.trip()).places[0].photos!
    expect([photos[0].width, photos[0].height]).toEqual([2048, 1024])
    expect([photos[1].width, photos[1].height]).toEqual([20, 40])

    // The stored bytes are what the references say, and a thumbnail exists too.
    const stored = await page.evaluate(async (id) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('roadmap-overview')
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      const record = await new Promise<{ blob: Blob; thumb: Blob; width: number; height: number }>((resolve) => {
        const r = db.transaction('photos').objectStore('photos').get(id)
        r.onsuccess = () => resolve(r.result)
      })
      const bitmap = await createImageBitmap(record.blob)
      const thumb = await createImageBitmap(record.thumb)
      return { type: record.blob.type, w: bitmap.width, h: bitmap.height, tw: thumb.width, th: thumb.height }
    }, photos[0].id)
    expect(stored).toEqual({ type: 'image/jpeg', w: 2048, h: 1024, tw: 320, th: 160 })
  })

  test('a big batch shows its progress while the pictures are worked on, and not afterwards', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await expand(page, 0)
    const pictures = []
    for (let n = 0; n < 6; n++) pictures.push(asFile(`big-${n}.jpg`, await makeJpeg(page, 3200, 2400, '#2266cc', '#cc6622'), 'image/jpeg'))
    await page.getByTestId('photo-input').setInputFiles(pictures)
    await expect(page.getByTestId('photo-progress')).toContainText(/Adding photo \d of 6…/)
    // While it runs the button is off, so the same files are not added twice.
    await expect(page.getByTestId('photo-add')).toBeDisabled()
    await expect(thumbs(page)).toHaveCount(6, { timeout: 20_000 })
    await expect(page.getByTestId('photo-progress')).toHaveCount(0)
    await expect(page.getByTestId('photo-add')).toBeEnabled()
    expect((await app.trip()).places[0].photos).toHaveLength(6)
  })

  test('files that are not images, or cannot be read, are reported and the rest is added', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await expand(page, 0)
    await page.getByTestId('photo-input').setInputFiles([
      asFile('notes.txt', Buffer.from('hello'), 'text/plain'),
      asFile('good.png', makePng(60, 40), 'image/png'),
      asFile('IMG_0001.heic', Buffer.from('not really a heic'), 'image/heic'),
    ])
    await expect(thumbs(page)).toHaveCount(1)
    await expect(toasts(page).last()).toContainText('2 files were not added')
    await expect(toasts(page).last()).toContainText('notes.txt is not an image')
    expect((await app.trip()).places[0].photos).toHaveLength(1)

    await page.getByTestId('photo-input').setInputFiles([asFile('broken.jpg', Buffer.from('definitely not a jpeg'), 'image/jpeg')])
    await expect(toasts(page).last()).toContainText('broken.jpg could not be read as an image')
    await expect(thumbs(page)).toHaveCount(1)
  })
})

test.describe('managing photos in the row', () => {
  test('select, reorder, caption and remove: each is one undo step', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await addPictures(page, 0, 3)
    await expand(page, 0)
    const ids = (await app.trip()).places[0].photos!.map((p) => p.id)
    const order = async () => (await app.trip()).places[0].photos!.map((p) => p.id)
    const start = (await app.history()).past

    // Nothing is selected: no editor yet.
    await expect(page.getByTestId('photo-editor')).toHaveCount(0)
    await thumbs(page).nth(0).click()
    await expect(page.getByTestId('photo-editor')).toContainText('Photo 1 of 3')
    await expect(page.getByTestId('photo-move-earlier')).toBeDisabled()

    // Move it later twice: the selection follows the photo.
    await page.getByTestId('photo-move-later').click()
    await page.getByTestId('photo-move-later').click()
    expect(await order()).toEqual([ids[1], ids[2], ids[0]])
    await expect(page.getByTestId('photo-editor')).toContainText('Photo 3 of 3')
    await expect(page.getByTestId('photo-move-later')).toBeDisabled()
    expect((await app.history()).past).toBe(start + 2)
    await page.getByTestId('photo-move-earlier').click()
    expect(await order()).toEqual([ids[1], ids[0], ids[2]])

    // A caption is typed locally and saved when the field is left: one step. Enter saves too.
    const caption = page.getByTestId('photo-caption')
    const steps = (await app.history()).past
    await caption.fill('Sunset at the camp site')
    expect((await app.trip()).places[0].photos![1].caption).toBeUndefined()
    await caption.press('Enter')
    expect((await app.trip()).places[0].photos![1].caption).toBe('Sunset at the camp site')
    expect((await app.history()).past).toBe(steps + 1)
    await expect(thumbs(page).nth(1)).toHaveAttribute('aria-label', /Photo 2 of 3: Sunset at the camp site/)
    // Clearing it removes the key.
    await caption.fill('')
    await caption.press('Enter')
    expect((await app.trip()).places[0].photos![1].caption).toBeUndefined()

    // Remove with the ×; undo brings it back (the bytes are still stored).
    await page.getByTestId('photo-remove').nth(1).click()
    expect(await order()).toEqual([ids[1], ids[2]])
    await expect(thumbs(page)).toHaveCount(2)
    await page.keyboard.press('Control+z')
    expect(await order()).toEqual([ids[1], ids[0], ids[2]])
    await expect(thumbs(page)).toHaveCount(3)
    await expect(thumbs(page).nth(1).locator('img')).toBeVisible()
    // Removing the last photo takes the key away.
    for (let n = 3; n > 0; n--) await page.getByTestId('photo-remove').first().click()
    expect((await app.trip()).places[0].photos).toBeUndefined()
    await expect(page.getByTestId('place-photos')).toContainText('No photos yet')
  })

  test('a caption that is half typed when the row closes is kept; Escape discards it', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await addPictures(page, 0, 2)
    await expand(page, 0)
    await thumbs(page).nth(1).click()
    await page.getByTestId('photo-caption').fill('Kept when the row closes')
    await row(page, 0).getByTestId('place-main').click()
    expect((await app.trip()).places[0].photos![1].caption).toBe('Kept when the row closes')

    await expand(page, 0)
    await thumbs(page).nth(1).click()
    await page.getByTestId('photo-caption').fill('Thrown away')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('place-photos')).toHaveCount(0)
    expect((await app.trip()).places[0].photos![1].caption).toBe('Kept when the row closes')
  })

  test('a place holds at most 50 photos: adding is switched off with a reason', async ({ page, app }) => {
    await app.goto()
    const [id] = await app.addPlaces('Lyon')
    await page.evaluate((placeId) => {
      const photos = Array.from({ length: 50 }, (_, n) => ({ id: `ph_fake${n}`, width: 40, height: 30 }))
      window.__ROADMAP__!.trip.getState().updatePlace(placeId, { photos })
    }, id)
    await expand(page, 0)
    await expect(thumbs(page)).toHaveCount(50)
    await expect(page.getByTestId('photo-add')).toBeDisabled()
    await expect(page.getByTestId('photo-full')).toContainText('at most 50 photos')
    // Photos this browser does not have show a quiet placeholder, not a broken image.
    await expect(thumbs(page).first().getByRole('img', { name: 'Photo not available' })).toBeVisible()
    // The store refuses a 51st as well, whoever asks.
    await page.evaluate((placeId) => {
      const store = window.__ROADMAP__!.trip.getState()
      const photos = store.trip.places[0].photos!
      store.updatePlace(placeId, { photos: [...photos, { id: 'ph_one_too_many', width: 4, height: 3 }] })
    }, id)
    expect((await app.trip()).places[0].photos).toHaveLength(50)
  })

  test('images dropped on the photo area are added; a trip file dropped there is still the window’s', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await expand(page, 0)
    const area = page.getByTestId('place-photos')
    const dt = await fileDrag(page, [
      { name: 'a.png', type: 'image/png', buffer: makePng(90, 60) },
      { name: 'b.png', type: 'image/png', buffer: makePng(60, 90, [20, 140, 80]) },
    ])
    await area.dispatchEvent('dragenter', { dataTransfer: dt })
    await expect(area).toHaveAttribute('data-dropping', 'true')
    // Pictures are not trips: the window's "Drop to open trip" stays away.
    await page.waitForTimeout(150)
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0)
    await area.dispatchEvent('drop', { dataTransfer: dt })
    await expect(area).not.toHaveAttribute('data-dropping', 'true')
    await expect(thumbs(page)).toHaveCount(2)
    expect((await app.trip()).places[0].photos).toHaveLength(2)
    // No trip was opened by that drop, and no hint was needed.
    expect((await app.trip()).places).toHaveLength(2)
    await expect(toasts(page)).toHaveCount(0)

    const json = await fileDrag(page, [{ name: 'other.trip.json', type: 'application/json', buffer: Buffer.from('{"hello": "world"}') }])
    await area.dispatchEvent('dragenter', { dataTransfer: json })
    await area.dispatchEvent('drop', { dataTransfer: json })
    await expect(toasts(page).last()).toContainText('Could not open other.trip.json')
  })

  test('images dropped anywhere else are not opened as trips: a hint says where they go', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    const dt = await fileDrag(page, [{ name: 'holiday.jpg', type: 'image/jpeg', buffer: Buffer.from('x') }])
    await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt })
    await page.waitForTimeout(150)
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0)
    await page.dispatchEvent('body', 'drop', { dataTransfer: dt })
    await expect(toasts(page).last()).toContainText('To add photos, open a place in the list and drop them on its Photos area.')
    await expect(toasts(page).last()).not.toContainText('Could not open')
    expect((await app.trip()).places).toHaveLength(1)
  })

  test('photos are not editable while a ride runs', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await addPictures(page, 0, 2)
    await expand(page, 0)
    await expect(page.getByTestId('photo-add')).toBeEnabled()
    await expect(page.getByTestId('leg-connector').first()).toHaveAttribute('data-status', 'ok')
    await page.getByTestId('ride-button').click()
    // The places list is inert during a ride; a dropped picture is refused with the reason.
    await expect(page.getByTestId('places-panel')).toHaveAttribute('inert', '')
    const dt = await fileDrag(page, [{ name: 'late.png', type: 'image/png', buffer: makePng(40, 30) }])
    await page.dispatchEvent('body', 'drop', { dataTransfer: dt })
    await expect(toasts(page).last()).toContainText('close the ride')
    expect((await app.trip()).places[0].photos).toHaveLength(2)
  })
})
