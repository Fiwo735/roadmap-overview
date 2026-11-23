import type { BrowserContext, Page } from '@playwright/test'
import { App, expect, STORAGE_KEYS, test } from './fixtures'

const changed = (page: Page) => page.getByTestId('toast').filter({ hasText: 'This trip was changed in another tab.' })
const savedPlaces = async (app: App) => ((await app.savedFile())?.trip.places ?? []).map((p) => p.name)

/** Two tabs of one browser profile (they share the autosave slot), each on the same one-place trip. */
async function twoTabs({ page, app, context }: { page: Page; app: App; context: BrowserContext }) {
  await app.goto()
  await app.addPlaces('Lyon')
  await expect.poll(() => savedPlaces(app)).toEqual(['Lyon'])
  const page2 = await context.newPage()
  const app2 = new App(page2, context)
  await app2.goto()
  expect((await app2.trip()).places.map((p) => p.name)).toEqual(['Lyon'])
  return { page, app, page2, app2 }
}

test.describe('the same trip in two tabs', () => {
  test('a different trip saved by another tab asks which to keep: the toast offers "Load it" and "Keep mine" and has no dismiss button', async ({ page, app, context }) => {
    const { page2, app2 } = await twoTabs({ page, app, context })
    await app.addPlaces('Annecy')
    await expect(changed(page2)).toBeVisible()
    await expect(changed(page2).getByRole('button', { name: 'Load it' })).toBeVisible()
    await expect(changed(page2).getByRole('button', { name: 'Keep mine' })).toBeVisible()
    await expect(changed(page2).getByRole('button', { name: 'Dismiss' })).toHaveCount(0)
    // The tab that saved is not told about its own save.
    await expect(page.getByTestId('toast')).toHaveCount(0)
    // It does not go away by itself.
    await page2.waitForTimeout(500)
    await expect(changed(page2)).toBeVisible()
    expect((await app2.trip()).places).toHaveLength(1)
  })

  test('"Load it" replaces this tab’s trip with the saved one (one undo step, the old one kept in Recent trips)', async ({ page, app, context }) => {
    const { page2, app2 } = await twoTabs({ page, app, context })
    await app.addPlaces('Annecy')
    await expect(changed(page2)).toBeVisible()
    await app2.addPlaces('Zurich')
    const steps = (await app2.history()).past

    await changed(page2).getByRole('button', { name: 'Load it' }).click()
    await expect(changed(page2)).toHaveCount(0)
    await expect.poll(async () => (await app2.trip()).places.map((p) => p.name)).toEqual(['Lyon', 'Annecy'])
    expect((await app2.history()).past).toBe(steps + 1)
    await expect(page2.getByTestId('toast').filter({ hasText: 'Loaded the trip from the other tab.' })).toBeVisible()
    // What this tab had (Lyon, Zurich) is kept, not lost.
    const recent = await page2.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{ file: { trip: { places: Array<{ name: string }> } } }>, STORAGE_KEYS.recent)
    expect(recent[0].file.trip.places.map((p) => p.name)).toEqual(['Lyon', 'Zurich'])
    // Saving carries on from the loaded trip, and the other tab is not asked again: it is the same trip.
    await expect.poll(() => savedPlaces(app2)).toEqual(['Lyon', 'Annecy'])
    await page.waitForTimeout(1000)
    await expect(changed(page)).toHaveCount(0)

    // The load can be undone.
    await page2.getByTestId('toast').filter({ hasText: 'Loaded the trip' }).getByRole('button', { name: 'Undo' }).click()
    expect((await app2.trip()).places.map((p) => p.name)).toEqual(['Lyon', 'Zurich'])
  })

  test('"Keep mine" saves this tab’s trip again, and the other tab is then the one asked', async ({ page, app, context }) => {
    const { page2, app2 } = await twoTabs({ page, app, context })
    await app.addPlaces('Annecy')
    await expect(changed(page2)).toBeVisible()
    // While the question stands, this tab does not overwrite what the other saved ...
    await app2.addPlaces('Zurich')
    await page2.waitForTimeout(900)
    expect(await savedPlaces(app)).toEqual(['Lyon', 'Annecy'])

    await changed(page2).getByRole('button', { name: 'Keep mine' }).click()
    await expect(changed(page2)).toHaveCount(0)
    // ... until the answer: then it is saved at once.
    await expect.poll(() => savedPlaces(app2)).toEqual(['Lyon', 'Zurich'])
    expect((await app2.trip()).places.map((p) => p.name)).toEqual(['Lyon', 'Zurich'])
    await expect(changed(page)).toBeVisible()
    expect((await app.trip()).places.map((p) => p.name)).toEqual(['Lyon', 'Annecy'])
  })

  test('more saves from the other tab keep one question, and "Load it" brings the latest', async ({ page, app, context }) => {
    const { page2, app2 } = await twoTabs({ page, app, context })
    await app.addPlaces('Annecy')
    await expect(changed(page2)).toBeVisible()
    await app.addPlaces('Zurich')
    await expect.poll(() => savedPlaces(app)).toEqual(['Lyon', 'Annecy', 'Zurich'])
    await page2.waitForTimeout(300)
    await expect(changed(page2)).toHaveCount(1)
    await changed(page2).getByRole('button', { name: 'Load it' }).click()
    await expect.poll(async () => (await app2.trip()).places.map((p) => p.name)).toEqual(['Lyon', 'Annecy', 'Zurich'])
  })

  test('the question is gone when both tabs end up with the same trip', async ({ page, app, context }) => {
    const { page2, app2 } = await twoTabs({ page, app, context })
    await app.addPlaces('Annecy')
    await expect(changed(page2)).toBeVisible()
    // The same edit made here (the ids differ, so it is not the same trip) does not count; undoing the other's does.
    await app.page.keyboard.press('Control+z')
    await expect.poll(() => savedPlaces(app)).toEqual(['Lyon'])
    await expect(changed(page2)).toHaveCount(0)
    // Nothing is held back any more: this tab saves again.
    await app2.addPlaces('Zurich')
    await expect.poll(() => savedPlaces(app2)).toEqual(['Lyon', 'Zurich'])
  })

  test('routes arriving in the other tab, and data that is not a trip, ask nothing', async ({ page, app, context }) => {
    const { page2 } = await twoTabs({ page, app, context })
    await app.addPlaces('Annecy')
    await expect(changed(page2)).toBeVisible()
    await changed(page2).getByRole('button', { name: 'Load it' }).click()
    await expect(changed(page2)).toHaveCount(0)
    await page2.getByTestId('toast').filter({ hasText: 'Loaded the trip' }).getByRole('button', { name: 'Dismiss' }).click()
    // Routes are saved after the places were: the trips are the same.
    await expect(page.getByTestId('leg-connector').first()).toHaveAttribute('data-status', 'ok')
    await page.waitForTimeout(1000)
    await expect(changed(page2)).toHaveCount(0)
    // Garbage in the slot (another program, an old version) is not a question either.
    await page.evaluate((key) => localStorage.setItem(key, '{ not json'), STORAGE_KEYS.trip)
    await page2.waitForTimeout(500)
    await expect(changed(page2)).toHaveCount(0)
  })

  test('the toast fits a phone: both choices are in reach', async ({ page, app, context }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const { page2 } = await twoTabs({ page, app, context })
    await page2.setViewportSize({ width: 390, height: 844 })
    await app.addPlaces('Annecy')
    await expect(changed(page2)).toBeVisible()
    for (const name of ['Load it', 'Keep mine']) {
      const box = (await changed(page2).getByRole('button', { name }).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
      expect(box.y + box.height).toBeLessThanOrEqual(844)
    }
  })

  test('the question waits while this tab presents, with the autosave held, and comes when presenting ends', async ({ page, app, context }) => {
    const { page2, app2 } = await twoTabs({ page, app, context })
    await page2.keyboard.press('p')
    await expect(page2.locator('.app')).toHaveAttribute('data-presenting', 'true')
    await app.addPlaces('Annecy')
    await expect.poll(() => savedPlaces(app)).toEqual(['Lyon', 'Annecy'])
    await page2.waitForTimeout(800)
    await expect(changed(page2)).toHaveCount(0)
    // The other trip is held in the slot all the same: a change in this tab (made around the lock) is not saved over it.
    await app2.addPlaces('Zurich')
    await page2.waitForTimeout(900)
    expect(await savedPlaces(app)).toEqual(['Lyon', 'Annecy'])

    await page2.keyboard.press('Escape')
    await expect(changed(page2)).toBeVisible()
    await changed(page2).getByRole('button', { name: 'Load it' }).click()
    await expect.poll(async () => (await app2.trip()).places.map((p) => p.name)).toEqual(['Lyon', 'Annecy'])
  })

  test('a question that is up goes away when a ride starts and returns when it ends', async ({ page, app, context }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await expect(page.getByTestId('leg-connector').first()).toHaveAttribute('data-status', 'ok')
    await expect.poll(() => savedPlaces(app)).toEqual(['Lyon', 'Annecy'])
    const page2 = await context.newPage()
    const app2 = new App(page2, context)
    await app2.goto()
    await expect(page2.getByTestId('leg-connector').first()).toHaveAttribute('data-status', 'ok')

    await app.addPlaces('Zurich')
    await expect(changed(page2)).toBeVisible()
    await page2.getByTestId('ride-button').click()
    await expect(page2.getByTestId('ride-hud')).toBeVisible()
    await expect(changed(page2)).toHaveCount(0)
    // The trip a ride was made from does not change, and nothing is saved over the other tab's.
    await page2.waitForTimeout(600)
    expect(await savedPlaces(app)).toEqual(['Lyon', 'Annecy', 'Zurich'])
    expect((await app2.trip()).places).toHaveLength(2)

    await page2.getByTestId('ride-close').click()
    await expect(changed(page2)).toBeVisible()
    await changed(page2).getByRole('button', { name: 'Keep mine' }).click()
    await expect.poll(() => savedPlaces(app2)).toEqual(['Lyon', 'Annecy'])
  })

  test('a question that is up goes away while presenting and returns after it', async ({ page, app, context }) => {
    const { page2 } = await twoTabs({ page, app, context })
    await app.addPlaces('Annecy')
    await expect(changed(page2)).toBeVisible()
    await page2.keyboard.press('p')
    await expect(changed(page2)).toHaveCount(0)
    await page2.keyboard.press('Escape')
    await expect(changed(page2)).toBeVisible()
  })

  test('closing this tab with the question open puts its trip in Recent trips', async ({ page, app, context }) => {
    const { page2, app2 } = await twoTabs({ page, app, context })
    await app.addPlaces('Annecy')
    await expect(changed(page2)).toBeVisible()
    // This tab's edits are only in memory while the question stands (the slot belongs to the other tab).
    await app2.addPlaces('Zurich')
    expect(await savedPlaces(app)).toEqual(['Lyon', 'Annecy'])
    const recent = () =>
      page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{ file: { trip: { places: Array<{ name: string }> } } }>).map((e) => e.file.trip.places.map((p) => p.name)), STORAGE_KEYS.recent)
    expect(await recent()).toEqual([])

    await page2.close()
    await expect.poll(recent).toEqual([['Lyon', 'Zurich']])
    // The other tab's trip is still the saved one.
    expect(await savedPlaces(app)).toEqual(['Lyon', 'Annecy'])
  })

  test('closing a tab that was not asked anything leaves the recent trips alone', async ({ page, app, context }) => {
    const { page2 } = await twoTabs({ page, app, context })
    await page2.close()
    await page.waitForTimeout(300)
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.recent)).toBeNull()
  })

  test.describe('when the recent trips are full', () => {
    test('"Load it" asks before it replaces this tab’s trip for good; Cancel keeps the question', async ({ page, app, context }) => {
      await context.addInitScript(() => {
        const original = Storage.prototype.setItem
        Storage.prototype.setItem = function (key: string, value: string) {
          if (key.endsWith(':recent')) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
          return original.call(this, key, value)
        }
      })
      const { page2, app2 } = await twoTabs({ page, app, context })
      await app.addPlaces('Annecy')
      await expect(changed(page2)).toBeVisible()
      await changed(page2).getByRole('button', { name: 'Load it' }).click()

      const dialog = page2.getByRole('dialog', { name: 'Replace the open trip?' })
      await expect(dialog).toContainText('no room to keep a copy of “My campervan trip”')
      await expect(dialog).toContainText('the other tab’s trip')
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
      // Nothing was replaced, and the question is back.
      expect((await app2.trip()).places.map((p) => p.name)).toEqual(['Lyon'])
      await expect(changed(page2)).toBeVisible()

      await changed(page2).getByRole('button', { name: 'Load it' }).click()
      await page2.getByTestId('confirm-dialog-confirm').click()
      await expect.poll(async () => (await app2.trip()).places.map((p) => p.name)).toEqual(['Lyon', 'Annecy'])
      await expect(changed(page2)).toHaveCount(0)
    })
  })
})
